#!/usr/bin/env python3
"""Small, dependency-free demo server; compatible with Python 3.6+."""
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

from content_pipeline.ai_processor import AIInputError, AIProcessor
from content_pipeline.storage import (
    get_library_item,
    list_library_items,
    migrate_content_schema,
    recover_interrupted_ai_work,
)

ROOT = Path(__file__).resolve().parent
DB_PATH = os.environ.get('APP_DB', str(ROOT / 'data' / 'app.sqlite3'))
STAGES = [
    {'id': 'primary', 'label': '小学阶段'}, {'id': 'middle', 'label': '初中阶段'},
    {'id': 'secondary', 'label': '高中 / 中专'}, {'id': 'college', 'label': '大学阶段'},
    {'id': 'working', 'label': '已经工作'}, {'id': 'retired', 'label': '退休生活'}]
STAGE_IDS = [s['id'] for s in STAGES]
_AI_SERVICES = {}
_AI_SERVICES_LOCK = threading.Lock()

def ai_service():
    with _AI_SERVICES_LOCK:
        if DB_PATH not in _AI_SERVICES:
            _AI_SERVICES[DB_PATH] = AIProcessor(DB_PATH)
        return _AI_SERVICES[DB_PATH]

def connect():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def initialize():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, stage TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
          stage TEXT NOT NULL, target TEXT NOT NULL, owner TEXT, sample INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS question_targets(
          question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
          stage TEXT NOT NULL CHECK(stage IN ('primary','middle','secondary','college','working','retired')),
          position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 5),
          PRIMARY KEY(question_id,stage), UNIQUE(question_id,position));
        CREATE TABLE IF NOT EXISTS answers(id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id),
          body TEXT NOT NULL, stage TEXT NOT NULL, owner TEXT, sample INTEGER NOT NULL DEFAULT 0,
          base_votes INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS votes(session_id TEXT NOT NULL REFERENCES sessions(id),
          answer_id INTEGER NOT NULL REFERENCES answers(id), PRIMARY KEY(session_id,answer_id));
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX IF NOT EXISTS answers_question ON answers(question_id);
        CREATE INDEX IF NOT EXISTS votes_answer ON votes(answer_id);
        CREATE INDEX IF NOT EXISTS questions_recent ON questions(created DESC);
        CREATE INDEX IF NOT EXISTS question_targets_stage ON question_targets(stage,question_id);
        ''')
        migrate_content_schema(db)
        recover_interrupted_ai_work(db)
        if not db.execute("SELECT 1 FROM metadata WHERE key='seed_v1'").fetchone():
            seed = [
                ('我最近不太快乐，怎么办？', '想知道，你们会怎么让自己开心起来。', 'college', 'primary', [
                    ('吃个雪糕吧。\n选你最喜欢的味道，今天可以先开心这一小会儿。', 'primary', 24),
                    ('放学之后去踢球！跑到顾不上想那些事情。', 'primary', 12),
                    ('我会先出门走走，不给这次散步安排目的地。', 'working', 36)]),
                ('工作以后，还会交到很好的朋友吗？', '', 'college', 'working', [
                    ('会的，只是慢了一点。\n不再每天见面，但有人会记得你说过的小事。', 'working', 38),
                    ('我和最好的朋友是在三十岁学游泳时认识的。一起笨拙过，很容易亲近。', 'working', 16)]),
                ('长大后，你们还有暑假吗？', '', 'middle', 'working', [
                    ('没有那么长的假期了。\n但我学会给星期天留白，那是我给自己放的小小暑假。', 'working', 19)]),
                ('你最近最快乐的一件事，是什么？', '', 'college', 'middle', [
                    ('我种的薄荷长新叶子了。\n每天看一眼，好像也没发生什么，但就是很高兴。', 'middle', 21)]),
                ('我在读中专，以后还有很多可能吗？', '想听听走过这一段的人，后来走了什么路。', 'secondary', 'working', [
                    ('有，但路不会自己变清楚。\n我先从一项愿意练下去的技能开始，找到第一份工作，再一点点调整方向。你不必现在就给一生下结论。', 'working', 32)]),
                ('退休以后，时间变慢了吗？', '', 'college', 'retired', [
                    ('钟走得一样快，我吃早饭慢下来了。\n终于能等阳光挪到餐桌上，再喝那杯茶。', 'retired', 27)]),
                ('现在的校园里，你们会为什么事情激动？', '', 'working', 'college', [
                    ('和朋友赶在截止之前，把一个乱七八糟的想法真的做出来。完成那一下，特别开心。', 'college', 18)]),
                ('有没有一门课，让你看到了不一样的世界？', '', 'college', 'secondary', [
                    ('实训课。第一次把自己画的零件做出来，原来图纸上的线是真的能变成东西的。', 'secondary', 9)])]
            for i, (title, body, stage, target, answers) in enumerate(seed):
                qid = db.execute('INSERT INTO questions(title,body,stage,target,sample,created) VALUES(?,?,?,?,1,?)',
                                 (title, body, stage, target, 1700000000-i)).lastrowid
                for text, astage, count in answers:
                    db.execute('INSERT INTO answers(question_id,body,stage,sample,base_votes,created) VALUES(?,?,?,1,?,?)',
                               (qid, text, astage, count, 1700000000-i))
            db.execute("INSERT INTO metadata(key,value) VALUES('seed_v1','1')")
        db.execute(
            """INSERT OR IGNORE INTO question_targets(question_id,stage,position)
               SELECT id,target,0 FROM questions
               WHERE target IN ('primary','middle','secondary','college','working','retired')"""
        )

class RequestError(Exception):
    def __init__(self, message, status=400, code=None):
        self.message, self.status, self.code = message, status, code

class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if getattr(self, 'new_session', None):
            secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
            self.send_header('Set-Cookie', 'glr_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000{}'.format(self.new_session, secure))
        self.end_headers()
        self.wfile.write(raw)

    def session(self, db):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except Exception:
            pass
        token = cookie.get('glr_session')
        sid = token.value if token else ''
        row = db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if not row:
            sid = secrets.token_hex(24)
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (sid, 'college', int(time.time())))
            self.new_session = sid
            return {'id': sid, 'stage': 'college'}
        return dict(row)

    def payload(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 16000:
                raise RequestError('内容太长了', 413)
            value = json.loads(self.rfile.read(size).decode('utf-8'))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeError):
            raise RequestError('请求格式不正确')

    def field(self, data, key, max_len, required=True):
        value = data.get(key, '')
        if not isinstance(value, str):
            raise RequestError('字段格式不正确')
        value = value.strip()
        if (required and not value) or len(value) > max_len:
            raise RequestError('请填写合适长度的内容（最多 {} 字）'.format(max_len))
        return value

    def stage(self, value):
        if value not in STAGE_IDS:
            raise RequestError('请选择一个人生阶段')
        return value

    def question_targets(self, data):
        if 'targets' not in data:
            return [self.stage(data.get('target'))]
        values = data.get('targets')
        if not isinstance(values, list) or not 1 <= len(values) <= len(STAGE_IDS):
            raise RequestError('请选择 1 至 6 个人生阶段')
        if any(not isinstance(value, str) or value not in STAGE_IDS for value in values):
            raise RequestError('目标阶段格式不正确')
        selected = set(values)
        normalized = [stage_id for stage_id in STAGE_IDS if stage_id in selected]
        if not normalized:
            raise RequestError('请选择至少一个人生阶段')
        return normalized

    def target_rows(self, db, qid, fallback):
        selected = {
            row[0]
            for row in db.execute('SELECT stage FROM question_targets WHERE question_id=?', (qid,))
            if row[0] in STAGE_IDS
        }
        if not selected and fallback in STAGE_IDS:
            selected.add(fallback)
        return [stage_id for stage_id in STAGE_IDS if stage_id in selected]

    def answer_rows(self, db, qid, sid, stages=None):
        args = [sid, qid]
        sql = '''SELECT a.id,a.question_id,a.body,a.stage,a.sample,a.created,
                 a.base_votes+(SELECT COUNT(*) FROM votes v WHERE v.answer_id=a.id) AS votes,
                 EXISTS(SELECT 1 FROM votes v WHERE v.answer_id=a.id AND v.session_id=?) AS voted
                 FROM answers a WHERE a.question_id=?'''
        if stages is not None:
            sql += ' AND a.stage IN ({})'.format(','.join('?' for _ in stages))
            args.extend(stages)
        sql += ' ORDER BY votes DESC,a.created ASC,a.id ASC'
        return [dict(row) for row in db.execute(sql, args)]

    def do_GET(self):
        self.new_session = None
        path = urlsplit(self.path)
        if not path.path.startswith('/api/'):
            return self.static(path.path)
        try:
            if path.path == '/api/ai/status':
                return self.send_json(ai_service().public_status())
            question_ai_parts = [part for part in path.path.split('/') if part]
            if len(question_ai_parts) == 4 and question_ai_parts[:2] == ['api', 'questions'] and question_ai_parts[3] == 'ai':
                try:
                    question_id = int(question_ai_parts[2])
                except ValueError:
                    raise RequestError('问题不存在', 404, 'question_not_found')
                with connect() as db:
                    user = self.session(db)
                    db.commit()
                try:
                    result = ai_service().question_ai_snapshot(user['id'], question_id)
                except AIInputError:
                    raise RequestError('问题不存在', 404, 'question_not_found')
                return self.send_json(result)
            derivative_parts = [part for part in path.path.split('/') if part]
            if len(derivative_parts) == 5 and derivative_parts[:3] == ['api', 'library', 'items'] and derivative_parts[4] == 'derivatives':
                try:
                    document_id = int(derivative_parts[3])
                except ValueError:
                    raise RequestError('资料不存在', 404)
                result = ai_service().derivatives(document_id)
                if not result:
                    raise RequestError('资料不存在', 404)
                return self.send_json(result)
            with connect() as db:
                if path.path == '/api/health':
                    db.execute('SELECT 1 FROM questions LIMIT 1').fetchone()
                    return self.send_json({'ok': True, 'version': '0.1.0'})
                if path.path == '/api/library/items':
                    params = parse_qs(path.query)
                    try:
                        page = int(params.get('page', ['1'])[0])
                        page_size = int(params.get('page_size', ['20'])[0])
                    except (TypeError, ValueError):
                        raise RequestError('分页参数格式不正确')
                    if page < 1 or page_size < 1:
                        raise RequestError('分页参数必须大于 0')
                    result = list_library_items(
                        db,
                        keyword=params.get('q', [''])[0],
                        topic=params.get('topic', [''])[0],
                        page=page,
                        page_size=min(page_size, 50),
                    )
                    return self.send_json(result)
                if path.path.startswith('/api/library/items/'):
                    try:
                        item_id = int(path.path.rsplit('/', 1)[1])
                    except ValueError:
                        raise RequestError('资料不存在', 404)
                    result = get_library_item(db, item_id)
                    if not result:
                        raise RequestError('资料不存在', 404)
                    return self.send_json(result)
                user = self.session(db)
                sid = user['id']
                if path.path == '/api/me':
                    result = {'stage': user['stage'], 'stages': STAGES}
                elif path.path == '/api/feed':
                    params = parse_qs(path.query)
                    mode = params.get('mode', ['older'])[0]
                    if mode not in ('older', 'younger'):
                        raise RequestError('浏览方向不正确')
                    index = STAGE_IDS.index(user['stage'])
                    allowed = STAGE_IDS[index+1:] if mode == 'older' else STAGE_IDS[:index]
                    chosen = params.get('stage', ['all'])[0]
                    if chosen != 'all' and chosen not in allowed:
                        raise RequestError('这个阶段不在当前浏览方向内')
                    answer_stages = [chosen] if chosen != 'all' else allowed
                    items = []
                    for row in db.execute('SELECT id,title,body,stage,target,sample,created FROM questions ORDER BY created DESC,id DESC LIMIT 200'):
                        q = dict(row)
                        q['targets'] = self.target_rows(db, q['id'], q['target'])
                        eligible = self.answer_rows(db, q['id'], sid, answer_stages) if answer_stages else []
                        if not eligible and not set(q['targets']).intersection(answer_stages):
                            continue
                        q['answer'] = eligible[0] if eligible else None
                        q['answer_count'] = len(eligible)
                        items.append(q)
                    result = {'items': items, 'allowed_stages': allowed, 'stage': user['stage']}
                elif path.path.startswith('/api/questions/'):
                    try:
                        qid = int(path.path.rsplit('/', 1)[1])
                    except ValueError:
                        raise RequestError('问题不存在', 404)
                    row = db.execute('SELECT id,title,body,stage,target,sample,created FROM questions WHERE id=?', (qid,)).fetchone()
                    if not row:
                        raise RequestError('问题不存在', 404)
                    result = dict(row)
                    result['targets'] = self.target_rows(db, qid, result['target'])
                    result['answers'] = self.answer_rows(db, qid, sid)
                else:
                    raise RequestError('页面不存在', 404)
            self.send_json(result)
        except RequestError as e:
            payload = {'error': e.message}
            if e.code:
                payload['error_code'] = e.code
            self.send_json(payload, e.status)
        except sqlite3.Error:
            self.send_json({'error': '数据暂时不可用，请稍后再试'}, 503)

    def do_POST(self):
        self.new_session = None
        try:
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                raise RequestError('请求来源不匹配', 403)
            data = self.payload()
            path = urlsplit(self.path).path
            question_ai_parts = [part for part in path.split('/') if part]
            if len(question_ai_parts) == 4 and question_ai_parts[:2] == ['api', 'questions'] and question_ai_parts[3] == 'ai':
                try:
                    question_id = int(question_ai_parts[2])
                except ValueError:
                    raise RequestError('问题不存在', 404, 'question_not_found')
                with connect() as db:
                    user = self.session(db)
                    if not db.execute('SELECT 1 FROM questions WHERE id=?', (question_id,)).fetchone():
                        raise RequestError('问题不存在', 404, 'question_not_found')
                    db.commit()
                try:
                    result, status = ai_service().question_ai_answer(
                        user['id'], question_id, data.get('question'), data.get('client_turn_id')
                    )
                except AIInputError as exc:
                    raise RequestError(str(exc), 400, 'invalid_input')
                return self.send_json(result, status)
            if path == '/api/ai/answer':
                question = data.get('question')
                topic = data.get('topic')
                try:
                    result = ai_service().answer(question, topic=topic, wait_for_slot=False)
                except AIInputError as exc:
                    raise RequestError(str(exc), 400)
                if result['status'] == 'busy':
                    return self.send_json(result, 503)
                if result['status'] == 'failed':
                    code = result.get('error_code')
                    status = 429 if code == 'rate_limited' else 504 if code == 'timeout' else 503 if code in ('not_configured', 'disabled', 'insufficient_balance') else 502
                    return self.send_json(result, status)
                return self.send_json(result)
            with connect() as db:
                user = self.session(db)
                sid = user['id']
                if path == '/api/profile':
                    stage = self.stage(data.get('stage'))
                    db.execute('UPDATE sessions SET stage=? WHERE id=?', (stage, sid))
                    result = {'stage': stage}
                elif path == '/api/questions':
                    title = self.field(data, 'title', 100)
                    body = self.field(data, 'body', 1000, False)
                    targets = self.question_targets(data)
                    target = targets[0]
                    recent = db.execute('SELECT COUNT(*) FROM questions WHERE owner=? AND created>?', (sid, int(time.time())-60)).fetchone()[0]
                    if recent >= 5:
                        raise RequestError('已经收到你的问题，稍等一下再发吧', 429)
                    qid = db.execute('INSERT INTO questions(title,body,stage,target,owner,created) VALUES(?,?,?,?,?,?)',
                                     (title, body, user['stage'], target, sid, int(time.time()))).lastrowid
                    db.executemany(
                        'INSERT INTO question_targets(question_id,stage,position) VALUES(?,?,?)',
                        [(qid, stage_id, position) for position, stage_id in enumerate(targets)],
                    )
                    result = {'id': qid}
                elif path == '/api/answers':
                    body = self.field(data, 'body', 1200)
                    qid = data.get('question_id')
                    if not isinstance(qid, int) or not db.execute('SELECT 1 FROM questions WHERE id=?', (qid,)).fetchone():
                        raise RequestError('问题不存在', 404)
                    recent = db.execute('SELECT COUNT(*) FROM answers WHERE owner=? AND created>?', (sid, int(time.time())-60)).fetchone()[0]
                    if recent >= 10:
                        raise RequestError('稍等一下再回答吧', 429)
                    aid = db.execute('INSERT INTO answers(question_id,body,stage,owner,created) VALUES(?,?,?,?,?)',
                                     (qid, body, user['stage'], sid, int(time.time()))).lastrowid
                    result = {'id': aid}
                elif path == '/api/vote':
                    aid, active = data.get('answer_id'), data.get('active')
                    if not isinstance(aid, int) or not isinstance(active, bool):
                        raise RequestError('点赞请求格式不正确')
                    if not db.execute('SELECT 1 FROM answers WHERE id=?', (aid,)).fetchone():
                        raise RequestError('回答不存在', 404)
                    if active:
                        db.execute('INSERT OR IGNORE INTO votes(session_id,answer_id) VALUES(?,?)', (sid, aid))
                    else:
                        db.execute('DELETE FROM votes WHERE session_id=? AND answer_id=?', (sid, aid))
                    count = db.execute('SELECT base_votes+(SELECT COUNT(*) FROM votes WHERE answer_id=?) FROM answers WHERE id=?', (aid, aid)).fetchone()[0]
                    result = {'votes': count, 'voted': active}
                else:
                    raise RequestError('接口不存在', 404)
            self.send_json(result)
        except RequestError as e:
            payload = {'error': e.message}
            if e.code:
                payload['error_code'] = e.code
            self.send_json(payload, e.status)
        except sqlite3.Error:
            self.send_json({'error': '保存失败，请稍后再试'}, 503)

    def static(self, path):
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/index.html': ('index.html', 'text/html; charset=utf-8'),
                 '/style.css': ('style.css', 'text/css; charset=utf-8'), '/splash.css': ('splash.css', 'text/css; charset=utf-8'),
                 '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/splash.js': ('splash.js', 'text/javascript; charset=utf-8'),
                 '/assets/welcome-page.jpg': ('assets/welcome-page.jpg', 'image/jpeg')}
        if path not in files:
            self.send_error(404)
            return
        name, mime = files[path]
        raw = (ROOT / 'public' / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    initialize()
    Server((os.environ.get('APP_HOST', '127.0.0.1'), int(os.environ.get('APP_PORT', '5173'))), Handler).serve_forever()
