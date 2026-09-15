import http.cookiejar, json, tempfile, threading, unittest, urllib.request, urllib.error
from pathlib import Path
import server

class RepliesTests(unittest.TestCase):
 def test_persistence_identity_validation_and_retry(self):
  old=server.DB_PATH
  with tempfile.TemporaryDirectory() as folder:
   server.DB_PATH=str(Path(folder)/'replies.db');server.initialize()
   httpd=server.Server(('127.0.0.1',0),server.Handler)
   thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
   opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
   def request(path,data=None):
    req=urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
    with opener.open(req) as r:return json.load(r)
   try:
    me=request('/api/me');q=request('/api/questions/1');aid=q['answers'][0]['id']
    payload={'answer_id':aid,'body':'我也有过类似的经历 <script>','client_id':'retry-one'}
    reply=request('/api/replies',payload);retry=request('/api/replies',payload)
    self.assertEqual(reply['id'],retry['id']);self.assertEqual(reply['author'],me['author']);self.assertNotIn('owner',reply)
    q=request('/api/questions/1');rows=[r for r in next(a for a in q['answers'] if a['id']==aid)['replies'] if r['author']==me['author']];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['body'],payload['body'])
    for updates,code in [({'body':' '},400),({'body':'x'*601},400),({'answer_id':999999},404),({'body':'changed'},409)]:
     with self.assertRaises(urllib.error.HTTPError) as error:request('/api/replies',payload|updates)
     self.assertEqual(error.exception.code,code)
    with server.connect() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM answer_replies WHERE client_id='retry-one'").fetchone()[0],1)
   finally:httpd.shutdown();httpd.server_close();thread.join();server.DB_PATH=old
if __name__=='__main__':unittest.main()
