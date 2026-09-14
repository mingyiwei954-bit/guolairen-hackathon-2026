import json
import tempfile
import threading
import time
import unittest
import http.cookiejar
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
import server
from kanshan_ai import KanshanService, migrate_kanshan
from content_pipeline.model_adapter import ModelResponse, ModelCallError

class FakeClient:
    def __init__(self, output='{"answer":"可以换个角度，先找一个能一起做的小事情。"}', error=None, blocked=False):
        self.calls=0;self.output=output;self.error=error;self.started=threading.Event();self.release=threading.Event()
        if not blocked:self.release.set()
    def complete_json(self,messages,**kwargs):
        self.calls+=1;self.messages=messages;self.started.set();self.release.wait(5)
        if self.error:raise ModelCallError(self.error,'test')
        return ModelResponse(self.output,'test-model',{'total_tokens':30},'stop',3,200)

class KanshanTests(unittest.TestCase):
    def setUp(self):
        self.old=server.DB_PATH;self.tmp=tempfile.TemporaryDirectory();server.DB_PATH=str(Path(self.tmp.name)/'app.sqlite3');server.initialize()
        with server.connect() as db:
            db.execute("INSERT INTO sessions VALUES('visitor-a','college',1)")
            db.execute("INSERT INTO sessions VALUES('visitor-b','college',1)")
        self.client=FakeClient();self.service=KanshanService(server.DB_PATH,self.client)
    def tearDown(self):
        self.client.release.set();server._AI_SERVICES.pop(server.DB_PATH,None);server.DB_PATH=self.old;self.tmp.cleanup()
    def done(self,visitor='visitor-a'):
        for _ in range(200):
            result=self.service.snapshot(visitor,1)
            if result['status']!='running':return result
            time.sleep(.01)
        self.fail('worker did not finish')
    def test_reads_do_not_generate_and_success_is_persistent(self):
        self.assertEqual('not_started',self.service.snapshot('visitor-a',1)['status']);self.assertEqual(0,self.client.calls)
        with server.connect() as db:before=db.execute('SELECT COUNT(*) FROM answers').fetchone()[0]
        self.service.start('visitor-a',1);self.assertEqual('completed',self.done()['status'])
        for _ in range(4):self.service.start('visitor-a',1)
        self.assertEqual(1,self.client.calls)
        other=KanshanService(server.DB_PATH,self.client);self.assertEqual('completed',other.start('visitor-a',1)['status'])
        with server.connect() as db:self.assertEqual(before,db.execute('SELECT COUNT(*) FROM answers').fetchone()[0])
    def test_concurrent_tabs_only_one_call(self):
        self.client=FakeClient(blocked=True);self.service=KanshanService(server.DB_PATH,self.client)
        with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda _:self.service.start('visitor-a',1),range(8)))
        self.assertTrue(self.client.started.wait(1));self.assertEqual(1,self.client.calls)
        # No database write transaction is held while the model waits.
        with server.connect() as db:db.execute("UPDATE sessions SET stage='working' WHERE id='visitor-b'")
        self.client.release.set();self.assertEqual('completed',self.done()['status'])
    def test_failure_and_invalid_json_are_not_retried(self):
        for error,output in [('timeout','{}'),('busy','{}'),('insufficient_balance','{}'),(None,'not-json'),(None,'{"answer":""}')]:
            with server.connect() as db:db.execute('DELETE FROM kanshan_answers')
            self.client=FakeClient(output,error);self.service=KanshanService(server.DB_PATH,self.client)
            self.service.start('visitor-a',1);result=self.done();self.assertEqual('failed',result['status']);self.assertEqual('',result['answer'])
            self.service.start('visitor-a',1);self.assertEqual(1,self.client.calls)
    def test_visitors_are_separate_and_missing_question_rejected(self):
        self.service.start('visitor-a',1);self.done();self.assertEqual('not_started',self.service.snapshot('visitor-b',1)['status'])
        self.service.start('visitor-b',1);self.done('visitor-b');self.assertEqual(2,self.client.calls)
        with self.assertRaises(KeyError):self.service.start('visitor-a',999999)
    def test_restart_does_not_restart_generation(self):
        with server.connect() as db:
            db.execute("INSERT INTO kanshan_answers(visitor_id,question_id,status,context_json,prompt_version,created,updated) VALUES('visitor-a',1,'running','{}','test',1,1)")
            migrate_kanshan(db)
        result=self.service.start('visitor-a',1);self.assertEqual('interrupted',result['error_code']);self.assertEqual(0,self.client.calls)
    def test_http_get_post_and_duplicate(self):
        server._AI_SERVICES[server.DB_PATH]=SimpleNamespace(client=self.client)
        httpd=server.Server(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        url='http://127.0.0.1:'+str(httpd.server_port)+'/api/questions/1/kanshan'
        try:
            self.assertEqual('not_started',json.load(opener.open(url))['status']);self.assertEqual(0,self.client.calls)
            req=lambda:urllib.request.Request(url,data=b'{}',headers={'Content-Type':'application/json'})
            json.load(opener.open(req()))
            for _ in range(200):
                result=json.load(opener.open(url))
                if result['status']!='running':break
                time.sleep(.01)
            self.assertEqual('completed',result['status']);json.load(opener.open(req()));self.assertEqual(1,self.client.calls)
        finally:httpd.shutdown();httpd.server_close();thread.join()

if __name__=='__main__':unittest.main()
