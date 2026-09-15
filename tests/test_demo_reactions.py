import json,os,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import server, demo_reactions as demo

class FakeModel:
 def complete_json(self,messages):
  self.messages=messages
  return SimpleNamespace(content=json.dumps({'replies':['可以先给自己留一点不用完成任务的时间。','你最想从哪件小事开始改变呢？']},ensure_ascii=False))

class DemoReactionsTests(unittest.TestCase):
 def test_activity_idempotence_identity_and_role_constraints(self):
  old=server.DB_PATH
  with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'DEMO_INTERACTIONS':'1'}):
   server.DB_PATH=str(Path(folder)/'test.db');server.initialize()
   try:
    with server.connect() as db:
     db.execute('INSERT INTO sessions VALUES(?,?,?)',('reader','college',0))
     aid=db.execute('SELECT id FROM answers WHERE question_id=1 LIMIT 1').fetchone()[0]
     job=demo.queue_job(db,'reader','answer',aid,1,'我最近不太快乐，怎么办？')
    model=FakeModel()
    with patch.object(demo.AnswerAgent,'local_evidence',return_value={'sources':[{'id':'S1','text':'给时间留白'}]}):demo.run_job(server.DB_PATH,job,client=model,sleep=lambda _:None)
    demo.run_job(server.DB_PATH,job,client=model,sleep=lambda _:None)
    with server.connect() as db:
     self.assertEqual(db.execute('SELECT COUNT(*) FROM demo_events').fetchone()[0],4)
     self.assertEqual(db.execute('SELECT COUNT(*) FROM votes WHERE answer_id=?',(aid,)).fetchone()[0],2)
     self.assertEqual(db.execute("SELECT COUNT(*) FROM answer_replies WHERE client_id LIKE 'demo:%'").fetchone()[0],2)
     notices=demo.notifications(db,'reader')['items'];self.assertEqual(len(notices),4)
     self.assertTrue(all(n['author']['simulated'] for n in notices))
     self.assertEqual(demo.notifications(db,'other')['items'],[])
     self.assertEqual(db.execute('SELECT mode FROM demo_jobs').fetchone()[0],'ai')
    context=json.loads(model.messages[1]['content']);self.assertTrue(all(r['age']==11 and r['stage']=='primary' for r in context['characters']))
    with server.connect() as db:question_job=demo.queue_job(db,'reader','question',1,1,'一个新问题')
    with patch.object(demo.AnswerAgent,'local_evidence',return_value={'sources':[{'id':'S1','text':'参考资料'}]}):demo.run_job(server.DB_PATH,question_job,client=model,sleep=lambda _:None)
    with server.connect() as db:
     self.assertEqual(db.execute("SELECT COUNT(*) FROM demo_events WHERE job_id=? AND kind='reply'",(question_job,)).fetchone()[0],2)
     self.assertEqual(db.execute("SELECT COUNT(*) FROM answers WHERE owner LIKE 'demo-role:%'").fetchone()[0],2)

   finally:server.DB_PATH=old
 def test_default_disabled(self):
  with patch.dict(os.environ,{'DEMO_INTERACTIONS':'0'}):self.assertIsNone(demo.queue_job(None,'x','question',1,1,'test'))
if __name__=='__main__':unittest.main()
