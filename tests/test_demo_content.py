import collections
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
import server

class DemoContentTests(unittest.TestCase):
    def setUp(self):
        self.old_db=server.DB_PATH
        self.temp=tempfile.TemporaryDirectory()
        server.DB_PATH=str(Path(self.temp.name)/'app.sqlite3')
        server.initialize()
        self.httpd=server.Server(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.httpd.server_port)
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def tearDown(self):
        self.httpd.shutdown();self.httpd.server_close();self.thread.join();server.DB_PATH=self.old_db;self.temp.cleanup()
    def request(self,path,data=None):
        req=urllib.request.Request(self.url+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        return json.load(self.opener.open(req))
    def test_every_stage_direction_and_rotation(self):
        for pos,stage in enumerate(server.STAGE_IDS):
            self.request('/api/profile',{'stage':stage})
            for mode,allowed in [('older',server.STAGE_IDS[pos+1:]),('younger',server.STAGE_IDS[:pos])]:
                for chosen in ['all']+allowed:
                    path='/api/feed?mode='+mode+'&stage='+chosen
                    first=self.request(path);second=self.request(path+'&refresh=1');again=self.request(path)
                    self.assertEqual(second['items'],again['items'],'ordinary reads must not rotate')
                    if not allowed:
                        self.assertEqual([],first['items']);continue
                    ids=lambda page:[q['id'] for q in page['items']]
                    self.assertEqual(12,len(first['items']));self.assertNotEqual(ids(first),ids(second))
                    self.assertFalse(set(ids(first))&set(ids(second)),'successive batches should not overlap')
                    for q in second['items']:
                        self.assertEqual(1,q['sample']);self.assertEqual(1,q['answer']['sample'])
                        self.assertIn(q['answer']['stage'],allowed if chosen=='all' else [chosen])
    def test_idempotent_seed_and_real_interaction(self):
        data=json.loads((server.ROOT/'fixtures'/'guolairen_mock.json').read_text())['items']
        self.assertEqual(90,len(data));self.assertEqual(90,len({q['title'] for q in data}))
        self.assertEqual(30,len({(q['stage'],a['stage']) for q in data for a in q['answers']}))
        self.assertEqual({s:30 for s in server.STAGE_IDS},dict(collections.Counter(a['stage'] for q in data for a in q['answers'])))
        first=self.request('/api/feed?mode=older');qid=first['items'][-1]['id'];detail=self.request('/api/questions/'+str(qid))
        self.assertGreaterEqual(len(detail['answers']),1)
        answer=detail['answers'][0];vote=self.request('/api/vote',{'answer_id':answer['id'],'active':True});self.assertEqual(answer['votes']+1,vote['votes'])
        q=self.request('/api/questions',{'title':'真实问题应当保留','body':'','stage':'college','targets':[]})
        self.request('/api/answers',{'question_id':qid,'body':'真人对示例的回复也需要保留'})
        for _ in range(4):
            batch=self.request('/api/feed?mode=older&refresh=1');ids={x['id'] for x in batch['items']}
            self.assertIn(q['id'],ids);self.assertIn(qid,ids)
        with server.connect() as db: before=tuple(db.execute('SELECT (SELECT COUNT(*) FROM questions),(SELECT COUNT(*) FROM answers)').fetchone())
        server.initialize()
        with server.connect() as db:
            self.assertEqual(before,tuple(db.execute('SELECT (SELECT COUNT(*) FROM questions),(SELECT COUNT(*) FROM answers)').fetchone()))
            self.assertEqual(90,db.execute('SELECT COUNT(*) FROM demo_content_keys').fetchone()[0])
        self.assertTrue(next(a for a in self.request('/api/questions/'+str(qid))['answers'] if a['id']==answer['id'])['voted'])

if __name__=='__main__':unittest.main()
