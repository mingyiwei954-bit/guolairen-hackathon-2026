import http.cookiejar
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs
import server
import oauth_login

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();server.DB_PATH=str(Path(self.tmp.name)/'app.db');server.initialize()
        self.cfg={'app_id':'demo','app_key':'secret','redirect_uri':'https://example.test/'}
        self.config=patch('oauth_login.config',return_value=self.cfg);self.config.start()
        self.httpd=server.Server(('127.0.0.1',0),server.Handler);self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.httpd.server_port)
        self.op=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def tearDown(self):
        self.httpd.shutdown();self.httpd.server_close();self.thread.join();self.config.stop();self.tmp.cleanup()
    def request(self,path,data=None,op=None):
        r=urllib.request.Request(self.base+path,headers={'Host':'example.test','Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
        try:resp=(op or self.op).open(r)
        except urllib.error.HTTPError as e:resp=e
        return resp.status,resp.headers,resp.read()
    def start(self):
        status,h,_=self.request('/api/auth/start');self.assertEqual(303,status);return parse_qs(urlsplit(h['Location']).query)['state'][0]
    def test_login_logout_preserves_visitor_then_expires_auth(self):
        self.request('/api/me');state=self.start()
        with patch('oauth_login.oauth_exchange',return_value=({'uid':'969570047710216200','name':'Tester','avatar':''},3600)) as exchange:
            status,h,_=self.request('/?authorization_code=abc&state='+state)
            self.assertEqual('/?login=success',h['Location']);self.assertEqual(1,exchange.call_count)
            self.assertIn('HttpOnly',h.get_all('Set-Cookie')[0])
            _,_,body=self.request('/api/auth/me');self.assertEqual('969570047710216200',json.loads(body)['user']['uid'])
            _,h,_=self.request('/?authorization_code=abc&state='+state);self.assertIn('invalid',h['Location']);self.assertEqual(1,exchange.call_count)
        self.request('/api/auth/logout',{});_,_,body=self.request('/api/auth/me');self.assertFalse(json.loads(body)['authenticated'])
    def test_bad_expired_and_cross_browser_states(self):
        with patch('oauth_login.oauth_exchange') as exchange:
            for query in ('authorization_code=x','authorization_code=x&state=wrong'):
                _,h,_=self.request('/?'+query);self.assertIn('invalid',h['Location'])
            state=self.start();other=urllib.request.build_opener(NoRedirect())
            _,h,_=self.request('/?authorization_code=x&state='+state,op=other);self.assertIn('invalid',h['Location'])
            with server.connect() as db:db.execute('UPDATE oauth_states SET expires=0')
            _,h,_=self.request('/?authorization_code=x&state='+state);self.assertIn('invalid',h['Location']);exchange.assert_not_called()
    def test_cancel_failure_and_no_configuration(self):
        state=self.start();_,h,_=self.request('/?error=denied&state='+state);self.assertIn('cancelled',h['Location'])
        state=self.start()
        with patch('oauth_login.oauth_exchange',side_effect=ValueError('invalid profile')):
            _,h,_=self.request('/?authorization_code=x&state='+state);self.assertIn('failed',h['Location'])
        self.cfg['app_key']='';_,h,_=self.request('/api/auth/start');self.assertIn('unavailable',h['Location'])
    def test_expired_login_is_not_authenticated(self):
        state=self.start()
        with patch('oauth_login.oauth_exchange',return_value=({'uid':'42','name':'User','avatar':''},1)):
            self.request('/?authorization_code=x&state='+state)
        with server.connect() as db:db.execute('UPDATE oauth_logins SET expires=0')
        _,_,body=self.request('/api/auth/me');self.assertFalse(json.loads(body)['authenticated'])
    def test_assets_and_canonical_public_login(self):
        for path in ('/auth-ui.js','/auth-ui.css'):
            status,headers,body=self.request(path)
            self.assertEqual(200,status);self.assertTrue(body)
        r=urllib.request.Request(self.base+'/api/auth/start')
        with self.assertRaises(urllib.error.HTTPError) as error:self.op.open(r)
        self.assertEqual('https://example.test/api/auth/start',error.exception.headers['Location'])
    def test_profile_uid_keeps_int64_and_business_wrapper(self):
        import httpx
        def response(url,data):return httpx.Response(200,json=data,request=httpx.Request('GET',url))
        class Client:
            def __init__(self,**kwargs):pass
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def post(self,*args,**kwargs):return response('https://openapi.zhihu.com/access_token',{'code':20000,'data':{'access_token':'mock','expires_in':3600}})
            def get(self,*args,**kwargs):return response('https://openapi.zhihu.com/user',{'code':20000,'data':{'uid':969570047710216200,'fullname':'User'}})
        with patch('oauth_login.httpx.Client',Client):
            user,ttl=oauth_login.oauth_exchange(self.cfg,'x');self.assertEqual('969570047710216200',user['uid']);self.assertEqual(3600,ttl)
