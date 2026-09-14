import unittest
import httpx
from kanshan_search import ZhihuSearch

class SearchTests(unittest.TestCase):
    def call(self, payload, status=200):
        def handle(request):
            self.assertEqual('Bearer test-secret',request.headers['Authorization'])
            self.assertEqual('5',request.url.params['Count'])
            self.assertTrue(request.headers['X-Request-Timestamp'].isdigit())
            return httpx.Response(status,json=payload)
        return ZhihuSearch('test-secret',httpx.MockTransport(handle)).search('工作以后，还会交到很好的朋友吗？')
    def test_summary_scope_safe_links_and_limits(self):
        result=self.call({'Code':0,'Data':{'Items':[
            {'Title':'<em>朋友</em>','Url':'https://example.com/one?utm=x','ContentText':'<em>一起</em>做事。'*600},
            {'Title':'bad','Url':'javascript:alert(1)','ContentText':'bad'},
            {'Title':'duplicate','Url':'https://example.com/one?utm=x','ContentText':'copy'}]}})
        self.assertEqual('completed',result['status']);self.assertEqual(1,len(result['sources']))
        source=result['sources'][0];self.assertEqual('summary',source['scope']);self.assertEqual('朋友',source['title']);self.assertLessEqual(len(source['text']),1100)
        self.assertIn('utm=x',source['url']);self.assertNotIn('<em>',source['text'])
    def test_failures_are_explicit(self):
        self.assertEqual('authentication_error',self.call({'Code':20001})['status'])
        self.assertEqual('rate_limited',self.call({},429)['status'])
        self.assertEqual('empty',self.call({'Code':0,'Data':{'Items':[]}})['status'])
        self.assertEqual('not_configured',ZhihuSearch('').search('x')['status'])
        def timeout(request):raise httpx.ReadTimeout('test')
        self.assertEqual('timeout',ZhihuSearch('test',httpx.MockTransport(timeout)).search('x')['status'])
if __name__=='__main__':unittest.main()
