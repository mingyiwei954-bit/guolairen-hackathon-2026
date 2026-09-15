import base64
import http.cookiejar
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import server
import answer_media


class AnswerMediaAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = str(Path(self.temp.name) / 'app.sqlite3')
        server.initialize()
        self.launch = patch('server.demo_reactions.launch').start()
        self.httpd = server.Server(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:{}'.format(self.httpd.server_port)
        self.client = self.new_client()
        _, question = self.request('/api/questions', {'title':'带图片的回答测试','body':'','target':'working'})
        self.qid = question['id']

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(2)
        patch.stopall()
        server.DB_PATH = self.old_db
        self.temp.cleanup()

    def new_client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, body=None, client=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={'Content-Type':'application/json'})
        try:
            response = (client or self.client).open(req, timeout=10)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            raw = response.read()
            if response.headers.get('Content-Type','').startswith('application/json'):
                raw = json.loads(raw)
            return response.status, raw

    def data_url(self, fmt='PNG'):
        buffer = io.BytesIO()
        Image.new('RGB',(12,8),'blue').save(buffer,format=fmt)
        return 'data:image/{};base64,'.format('jpeg' if fmt=='JPEG' else fmt.lower()) + base64.b64encode(buffer.getvalue()).decode()

    def test_upload_publish_image_only_and_readback(self):
        for fmt in ['JPEG','PNG','WEBP']:
            status, upload = self.request('/api/uploads',{'data_url':self.data_url(fmt)})
            self.assertEqual(status,200,upload)
            status, raw = self.request(upload['url'])
            self.assertEqual(status,200)
            with Image.open(io.BytesIO(raw)) as image:
                self.assertEqual(image.size,(12,8))
        status, answer = self.request('/api/answers',{'question_id':self.qid,'body':'','tags':['经验','经验'],'topics':['#人生选择#'],'images':[upload['url']]})
        self.assertEqual(status,200,answer)
        _, detail = self.request('/api/questions/{}'.format(self.qid))
        record = next(a for a in detail['answers'] if a['id']==answer['id'])
        self.assertEqual(record['images'],[upload['url']])
        self.assertEqual(record['tags'],['经验'])
        self.assertEqual(record['topics'],['人生选择'])
        self.assertEqual(record['body'],'')
        self.assertNotIn('owner',record)
        _, old_question = self.request('/api/questions/1')
        self.assertEqual(old_question['answers'][0]['images'],[])

    def test_reject_foreign_and_untrusted_images(self):
        _, upload = self.request('/api/uploads',{'data_url':self.data_url()})
        status, _ = self.request('/api/answers',{'question_id':self.qid,'body':'图片','images':[upload['url']]},client=self.new_client())
        self.assertEqual(status,403)
        for images in [['https://example.com/image.jpg'],['/uploads/../secret.png'],['/uploads/'+('a'*64)+'.svg']]:
            status, _ = self.request('/api/answers',{'question_id':self.qid,'body':'图片','images':images})
            self.assertEqual(status,400)

    def test_reject_invalid_svg_large_and_mismatched_media(self):
        for url in ['data:image/svg+xml;base64,'+base64.b64encode(b'<svg/>').decode(),'data:image/png;base64,garbage',self.data_url().replace('image/png','image/jpeg')]:
            status, _ = self.request('/api/uploads',{'data_url':url})
            self.assertEqual(status,400)
        oversized = 'data:image/png;base64,'+base64.b64encode(b'x'*(answer_media.MAX_IMAGE_BYTES+1)).decode()
        self.assertEqual(self.request('/api/uploads',{'data_url':oversized})[0],413)
        with patch.object(answer_media, 'MAX_UPLOAD_BODY', 100):
            self.assertEqual(self.request('/api/uploads',{'data_url':'x'*101})[0],413)

    def test_answer_limits(self):
        for body in [ {'body':''}, {'body':'a'*1201}, {'body':'text','tags':['x']*6}, {'body':'text','topics':['a'*41]}, {'body':'text','images':['x']*5} ]:
            body['question_id'] = self.qid
            self.assertEqual(self.request('/api/answers',body)[0],400)

if __name__ == '__main__':
    unittest.main()
