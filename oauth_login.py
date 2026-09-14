"""Zhihu OAuth login; separate application authentication from visitor records."""
import hashlib
import json
import os
import re
import secrets
import subprocess
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
import httpx

CONFIG_PATH = Path.home() / '.config/zhihu-hackathon/oauth.env'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS oauth_states(digest TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_accounts(uid TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_logins(digest TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, uid TEXT NOT NULL REFERENCES oauth_accounts(uid), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_visitor_links(visitor_id TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY(visitor_id,uid));
'''

def config():
    values = {}
    path = Path(os.environ.get('ZHIHU_OAUTH_ENV_FILE', str(CONFIG_PATH)))
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k,v=line.split('=',1); values[k.strip()]=v.strip()
    get=lambda k: os.environ.get(k, values.get(k,''))
    result = {k:get('ZHIHU_OAUTH_'+k.upper()) for k in ('app_id','app_key','redirect_uri')}
    project_config = Path(__file__).with_name('hackathon.config.json')
    if not result['app_key'] and project_config.is_file() and Path('/usr/bin/security').exists():
        app = json.loads(project_config.read_text())['oauth']
        secret = subprocess.run(['/usr/bin/security','find-generic-password','-s',app['credentialService'],'-a',app['credentialAccount'],'-w'],capture_output=True,text=True,timeout=5)
        if secret.returncode == 0:
            result['app_key'] = secret.stdout.strip()
            result['app_id'] = result['app_id'] or app['appId']
            result['redirect_uri'] = result['redirect_uri'] or app['redirectUri']
    return result

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def cookie(headers,name):
    try:
        c=SimpleCookie();c.load(headers.get('Cookie',''));return c[name].value if name in c else ''
    except Exception:return ''

def oauth_exchange(cfg, code):
    # No automatic retries: authorization codes are single-use.
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        r=client.post('https://openapi.zhihu.com/access_token',data={**cfg,'grant_type':'authorization_code','code':code})
        r.raise_for_status(); token=r.json()
        if not isinstance(token,dict):raise ValueError('invalid token response')
        if isinstance(token.get('data'),dict):token=token['data']
        access=token.get('access_token')
        if not isinstance(access,str) or not access:raise ValueError('missing token')
        expiry=token.get('expires_in')
        if isinstance(expiry,bool) or not isinstance(expiry,(int,str)):raise ValueError('missing expiry')
        expiry=int(expiry)
        if expiry<=0:raise ValueError('expired token')
        r=client.get('https://openapi.zhihu.com/user',headers={'Authorization':'Bearer '+access})
        r.raise_for_status(); user=r.json()  # Python preserves int64 uid without precision loss.
        if not isinstance(user,dict):raise ValueError('invalid profile response')
        if isinstance(user.get('data'),dict):user=user['data']
        uid=user.get('uid')
        if isinstance(uid,bool) or not isinstance(uid,(int,str)) or not str(uid).isdigit():raise ValueError('missing identity')
        avatar=user.get('avatar_path') or ''
        if not isinstance(avatar,str) or urlsplit(avatar).scheme!='https':avatar=''
        return {'uid':str(uid),'name':str(user.get('fullname') or '知乎用户')[:100],'avatar':avatar[:2048]}, min(expiry,86400)
    # Access token is deliberately discarded after identity lookup; no content scopes are used.

class OAuthMixin:
    def oauth_redirect(self, location, cookies=()):
        self.send_response(303);self.send_header('Location',location)
        self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer')
        if getattr(self,'new_session',None):self.send_header('Set-Cookie',self.oauth_cookie('glr_session',self.new_session,2592000))
        for value in cookies:self.send_header('Set-Cookie',value)
        self.send_header('Content-Length','0');self.end_headers()

    def oauth_cookie(self,name,value,age):
        secure='; Secure' if self.headers.get('X-Forwarded-Proto')=='https' else ''
        return '{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}'.format(name,value,age,secure)

    def oauth_identity(self,db):
        token=cookie(self.headers,'glr_auth');visitor=cookie(self.headers,'glr_session')
        if not token:return None
        row=db.execute('SELECT a.uid,a.name,a.avatar FROM oauth_logins l JOIN oauth_accounts a ON a.uid=l.uid WHERE l.digest=? AND l.visitor_id=? AND l.expires>?',(digest(token),visitor,int(time.time()))).fetchone()
        return dict(row) if row else None

    def oauth_get(self,path,connect):
        cfg=config(); query=parse_qs(path.query,keep_blank_values=True)
        callback=path.path==urlsplit(cfg['redirect_uri']).path and any(k in query for k in ('authorization_code','code','state','error'))
        if path.path=='/api/auth/me':
            with connect() as db:identity=self.oauth_identity(db)
            self.send_json({'authenticated':bool(identity),'user':identity,'configured':all(cfg.values())});return True
        if path.path=='/api/auth/start':
            if not all(cfg.values()):self.oauth_redirect('/?login=unavailable');return True
            host=urlsplit(cfg['redirect_uri']).netloc
            if self.headers.get('Host')!=host:
                self.oauth_redirect('https://'+host+'/api/auth/start');return True
            with connect() as db:
                visitor=self.session(db);state=secrets.token_urlsafe(32)
                db.execute('DELETE FROM oauth_states WHERE expires<=?',(int(time.time()),))
                db.execute('DELETE FROM oauth_logins WHERE expires<=?',(int(time.time()),))
                db.execute('INSERT INTO oauth_states VALUES(?,?,?)',(digest(state),visitor['id'],int(time.time())+600))
            self.oauth_redirect('https://openapi.zhihu.com/authorize?'+urlencode({'app_id':cfg['app_id'],'redirect_uri':cfg['redirect_uri'],'response_type':'code','state':state}));return True
        if not callback:return False
        state=query.get('state',[''])[0];visitor=cookie(self.headers,'glr_session')
        if len(query.get('state',[]))!=1 or not state or not visitor:self.oauth_redirect('/?login=invalid');return True
        with connect() as db:
            consumed=db.execute('DELETE FROM oauth_states WHERE digest=? AND visitor_id=? AND expires>?',(digest(state),visitor,int(time.time()))).rowcount
        if not consumed:self.oauth_redirect('/?login=invalid');return True
        codes=query.get('authorization_code',query.get('code',[]))
        if query.get('error') or len(codes)!=1 or not codes[0]:self.oauth_redirect('/?login=cancelled');return True
        try:
            user,ttl=oauth_exchange(cfg,codes[0])
            token=secrets.token_urlsafe(32)
            with connect() as db:
                db.execute('INSERT INTO oauth_accounts VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name,avatar=excluded.avatar',(user['uid'],user['name'],user['avatar']))
                db.execute('DELETE FROM oauth_logins WHERE visitor_id=?',(visitor,))
                db.execute('INSERT INTO oauth_logins VALUES(?,?,?,?)',(digest(token),visitor,user['uid'],int(time.time())+ttl))
                db.execute('INSERT OR IGNORE INTO oauth_visitor_links VALUES(?,?)',(visitor,user['uid']))
            self.oauth_redirect('/?login=success',(self.oauth_cookie('glr_auth',token,ttl),))
        except (httpx.HTTPError,ValueError,TypeError,KeyError):self.oauth_redirect('/?login=failed')
        return True

    def oauth_post(self,path,connect):
        if path!='/api/auth/logout':return False
        with connect() as db:
            db.execute('DELETE FROM oauth_logins WHERE digest=?',(digest(cookie(self.headers,'glr_auth')),))
        # A new visitor cookie is created by the next normal /api/me request.
        self.oauth_redirect('/?login=logout',(self.oauth_cookie('glr_auth','',0),self.oauth_cookie('glr_session','',0)))
        return True

    def log_message(self,fmt,*args):
        sanitized=tuple(re.sub(r'((?:authorization_code|code|state|access_token)=)[^&\s]*',r'\1[redacted]',str(a)) for a in args)
        super().log_message(fmt,*sanitized)
