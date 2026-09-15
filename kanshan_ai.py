"""Persistent AI answer page, live evidence, and idempotent manual regeneration."""
import json
import sqlite3
import threading
import time
from contextlib import closing
from content_pipeline.model_adapter import ModelCallError
from kanshan_search import ZhihuSearch

from answer_agent import AnswerAgent, PROMPT_VERSION
SCHEMA = '''CREATE TABLE IF NOT EXISTS kanshan_answers(
 visitor_id TEXT NOT NULL REFERENCES sessions(id), question_id INTEGER NOT NULL REFERENCES questions(id),
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
 answer TEXT NOT NULL DEFAULT '', error_code TEXT, context_json TEXT NOT NULL, model TEXT,
 usage_json TEXT NOT NULL DEFAULT '{}', duration_ms INTEGER NOT NULL DEFAULT 0, prompt_version TEXT NOT NULL,
 created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(visitor_id,question_id));
CREATE TABLE IF NOT EXISTS kanshan_requests(
 visitor_id TEXT NOT NULL, question_id INTEGER NOT NULL, request_id TEXT NOT NULL,
 generation INTEGER NOT NULL, result_json TEXT,
 PRIMARY KEY(visitor_id,question_id,request_id),
 FOREIGN KEY(visitor_id,question_id) REFERENCES kanshan_answers(visitor_id,question_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS kanshan_search_cache(query TEXT PRIMARY KEY, result_json TEXT NOT NULL, created INTEGER NOT NULL);
'''
ERRORS = {'busy':'AI 正在忙，请稍后再试。', 'not_configured':'AI 尚未配置。',
 'disabled':'AI 暂未启用。', 'timeout':'本次生成超时，可以重新生成。', 'network_error':'模型连接失败，可以重新生成。',
 'authentication_error':'模型配置暂时不可用。', 'insufficient_balance':'模型额度不足。',
 'rate_limited':'模型请求受到限流。', 'interrupted':'本次生成被服务重启中断，可以重新生成。',
 'invalid_output':'本次回答未通过格式或引用校验，可以重新生成。'}
_SLOT = threading.BoundedSemaphore(1)


def migrate_kanshan(db):
    db.executescript(SCHEMA)
    columns = {row[1] for row in db.execute('PRAGMA table_info(kanshan_answers)')}
    for name, definition in {'generation':'INTEGER NOT NULL DEFAULT 1', 'phase':"TEXT NOT NULL DEFAULT 'idle'",
            'sources_json':"TEXT NOT NULL DEFAULT '[]'", 'retrieval_json':"TEXT NOT NULL DEFAULT '{}'"}.items():
        if name not in columns:
            db.execute(f'ALTER TABLE kanshan_answers ADD COLUMN {name} {definition}')
    db.execute("UPDATE kanshan_answers SET status='failed',phase='idle',error_code='interrupted',updated=? WHERE status='running'", (int(time.time()),))


class KanshanService:
    def __init__(self, db_path, client, search=None):
        self.db_path = str(db_path)
        self.client = client
        self.search = search or ZhihuSearch()

    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def snapshot(self, visitor_id, question_id):
        with closing(self.connect()) as db:
            if not db.execute('SELECT 1 FROM questions WHERE id=?', (question_id,)).fetchone():
                raise KeyError(question_id)
            row = db.execute('SELECT * FROM kanshan_answers WHERE visitor_id=? AND question_id=?', (visitor_id, question_id)).fetchone()
        result = {'question_id':question_id, 'status':'not_started', 'phase':'idle', 'answer':'', 'ai_generated':True,
                  'provider':'DeepSeek', 'prompt_version':PROMPT_VERSION, 'generation':0, 'sources':[], 'retrieval':{}}
        if row:
            result.update(status=row['status'], phase=row['phase'], answer=row['answer'], model=row['model'],
                generation=row['generation'], sources=json.loads(row['sources_json']), retrieval=json.loads(row['retrieval_json']),
                error_code=row['error_code'], error=ERRORS.get(row['error_code'], '本次生成未完成，可以重新生成。') if row['error_code'] else None)
        result['can_refresh'] = result['status'] != 'running'
        return result

    def start(self, visitor_id, question_id, *, refresh=False, client_turn_id=None, expected_generation=None):
        if not isinstance(refresh, bool):
            raise ValueError('refresh must be boolean')
        if refresh and (not isinstance(client_turn_id, str) or not 1 <= len(client_turn_id) <= 100
                        or type(expected_generation) is not int or expected_generation < 0):
            raise ValueError('refresh requires client_turn_id and expected_generation')
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            q = db.execute('SELECT title,body FROM questions WHERE id=?', (question_id,)).fetchone()
            if not q:
                raise KeyError(question_id)
            old = db.execute('SELECT * FROM kanshan_answers WHERE visitor_id=? AND question_id=?', (visitor_id, question_id)).fetchone()
            request = db.execute('SELECT * FROM kanshan_requests WHERE visitor_id=? AND question_id=? AND request_id=?',
                                 (visitor_id, question_id, client_turn_id)).fetchone() if refresh else None
            if request and request['result_json']:
                return json.loads(request['result_json'])
            created = not request and (not old or (refresh and old['status'] != 'running' and expected_generation == old['generation']))
            if created:
                rows = db.execute('SELECT body,stage,sample FROM answers WHERE question_id=? ORDER BY base_votes DESC,id LIMIT 4', (question_id,)).fetchall()
                context = {'question':q['title'], 'background':q['body'][:1000],
                    'community_perspectives':[{'text':r['body'][:600], 'stage':r['stage'], 'demo':bool(r['sample'])} for r in rows]}
                if old and old['answer']:
                    context['previous_ai_answer'] = old['answer'][:2400]
                generation = old['generation'] + 1 if old else 1
                now = int(time.time())
                if old:
                    db.execute("UPDATE kanshan_answers SET status='running',phase='searching',error_code=NULL,context_json=?,generation=?,prompt_version=?,updated=? WHERE visitor_id=? AND question_id=?",
                        (json.dumps(context, ensure_ascii=False), generation, PROMPT_VERSION, now, visitor_id, question_id))
                else:
                    db.execute("INSERT INTO kanshan_answers(visitor_id,question_id,status,phase,context_json,prompt_version,created,updated,generation) VALUES(?,?,'running','searching',?,?,?,?,?)",
                        (visitor_id, question_id, json.dumps(context, ensure_ascii=False), PROMPT_VERSION, now, now, generation))
                if refresh:
                    db.execute('INSERT INTO kanshan_requests(visitor_id,question_id,request_id,generation) VALUES(?,?,?,?)',
                        (visitor_id, question_id, client_turn_id, generation))
        if created:
            try:
                threading.Thread(target=self._generate, args=(visitor_id, question_id, generation, context), daemon=True).start()
            except RuntimeError:
                self._finish(visitor_id, question_id, generation, 'failed', error_code='interrupted')
        return self.snapshot(visitor_id, question_id)

    def _finish(self, visitor_id, question_id, generation, status, *, answer=None, sources=None, retrieval=None,
                error_code=None, model=None, usage=None, duration=0):
        with closing(self.connect()) as db, db:
            changed = db.execute("UPDATE kanshan_answers SET status=?,phase='idle',answer=COALESCE(?,answer),sources_json=COALESCE(?,sources_json),retrieval_json=COALESCE(?,retrieval_json),error_code=?,model=COALESCE(?,model),usage_json=?,duration_ms=?,updated=? WHERE visitor_id=? AND question_id=? AND generation=? AND status='running'",
                (status, answer, json.dumps(sources, ensure_ascii=False) if sources is not None else None,
                 json.dumps(retrieval, ensure_ascii=False) if retrieval is not None else None, error_code, model, json.dumps(usage or {}), duration,
                 int(time.time()), visitor_id, question_id, generation)).rowcount
            if changed:
                # Save this exact generation's response for retried request IDs.
                row = db.execute('SELECT * FROM kanshan_answers WHERE visitor_id=? AND question_id=?', (visitor_id, question_id)).fetchone()
                result = {'question_id':question_id, 'status':status, 'phase':'idle', 'answer':row['answer'], 'generation':generation,
                    'sources':json.loads(row['sources_json']), 'retrieval':json.loads(row['retrieval_json']), 'can_refresh':True,
                    'ai_generated':True, 'provider':'DeepSeek', 'model':row['model'], 'prompt_version':PROMPT_VERSION,
                    'error_code':error_code, 'error':ERRORS.get(error_code, '本次生成未完成。') if error_code else None}
                db.execute('UPDATE kanshan_requests SET result_json=? WHERE visitor_id=? AND question_id=? AND generation=?',
                    (json.dumps(result, ensure_ascii=False), visitor_id, question_id, generation))

    def _retrieve(self, question):
        with closing(self.connect()) as db:
            cached = db.execute('SELECT result_json FROM kanshan_search_cache WHERE query=? AND created>?', (question, int(time.time()) - 300)).fetchone()
        if cached:
            return {**json.loads(cached['result_json']), 'cached':True}
        result = self.search.search(question)
        if result['status'] in ('completed', 'empty'):
            with closing(self.connect()) as db, db:
                db.execute('INSERT OR REPLACE INTO kanshan_search_cache VALUES(?,?,?)', (question, json.dumps(result, ensure_ascii=False), int(time.time())))
        return {**result, 'cached':False}

    def _generate(self, visitor_id, question_id, generation, context):
        began = time.monotonic(); response = None
        if not _SLOT.acquire(blocking=False):
            self._finish(visitor_id, question_id, generation, 'failed', error_code='busy')
            return
        try:
            agent = AnswerAgent(self.db_path)
            evidence, context, messages = agent.prepare(context, self._retrieve)
            with closing(self.connect()) as db, db:
                db.execute("UPDATE kanshan_answers SET phase='generating',context_json=? WHERE visitor_id=? AND question_id=? AND generation=? AND status='running'",
                    (json.dumps(context, ensure_ascii=False), visitor_id, question_id, generation))
            response = self.client.complete_json(messages, wait_for_slot=False)
            answer, sources = agent.validate(response.content, evidence)
            self._finish(visitor_id, question_id, generation, 'completed', answer=answer.strip(), sources=sources,
                retrieval={k:v for k,v in evidence.items() if k != 'sources'}, model=response.actual_model,
                usage=response.usage, duration=int((time.monotonic()-began)*1000))
        except ModelCallError as exc:
            self._finish(visitor_id, question_id, generation, 'failed', error_code=exc.code, model=exc.actual_model, usage=exc.usage, duration=exc.duration_ms)
        except (ValueError, TypeError):
            self._finish(visitor_id, question_id, generation, 'failed', error_code='invalid_output',
                model=response.actual_model if response else None, usage=response.usage if response else None, duration=int((time.monotonic()-began)*1000))
        except Exception:
            self._finish(visitor_id, question_id, generation, 'failed', error_code='internal_error', duration=int((time.monotonic()-began)*1000))
        finally:
            _SLOT.release()
