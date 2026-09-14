from __future__ import annotations

import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

import server
from content_pipeline.ai_processor import AIProcessor
from content_pipeline.model_adapter import DeepSeekConfig, ModelResponse
from content_pipeline.processor import ContentProcessor

FIXTURES = Path(__file__).parent / "fixtures"


class APIFakeClient:
    def __init__(self, outputs):
        self.config = DeepSeekConfig("test-key", model="deepseek-flash")
        self.outputs = list(outputs)
        self.calls = 0

    def complete_json(self, messages, *, wait_for_slot=False):
        output = self.outputs[self.calls]
        self.calls += 1
        return ModelResponse(json.dumps(output, ensure_ascii=False), "deepseek-flash", {"total_tokens": 12}, "stop", 4, 200)


class ServerAPIRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DB_PATH = str(Path(self.temp.name) / "api.sqlite3")
        server.initialize()
        processor = ContentProcessor(server.DB_PATH)
        processor.import_json(FIXTURES / "source_records.json")
        self.document_id = processor.run(1)[0]["document_id"]
        quote = "第一份工作不必一次定终身"
        self.model = APIFakeClient(
            [
                {
                    "display_question": "根据资料整理：第一份工作应该怎么选？",
                    "answer_summary": "不必一次定终身，但要保留复盘记录。",
                    "topics": ["职业发展"], "followups": [], "author_age": None, "author_stage": None,
                    "evidence_quotes": [{"document_id": self.document_id, "quote": quote}],
                },
                {
                    "status": "answered", "answer": "根据资料，第一份工作不必一次定终身。", "followups": [],
                    "citations": [{"document_id": self.document_id, "quote": quote}],
                },
            ]
        )
        server._AI_SERVICES.clear()
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=self.model)

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:{}".format(self.httpd.server_port)
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        with self.opener.open(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_library_reads_and_original_qa_writes(self):
        status, listing = self.request("/api/library/items?q=%E8%81%8C%E4%B8%9A&page=1&page_size=20")
        self.assertEqual(200, status)
        self.assertEqual(1, listing["total"])
        item_id = listing["items"][0]["id"]
        _, detail = self.request("/api/library/items/{}".format(item_id))
        serialized = json.dumps(detail, ensure_ascii=False)
        self.assertNotIn("raw_content", serialized)
        self.assertNotIn("raw_origin", serialized)
        self.assertEqual("summary", detail["content_scope"])

        _, me = self.request("/api/me")
        self.assertEqual("college", me["stage"])
        _, feed = self.request("/api/feed?mode=older&stage=all")
        self.assertGreater(len(feed["items"]), 0)
        _, question = self.request(
            "/api/questions",
            {"title": "API 回归测试问题", "body": "合成测试数据", "target": "working"},
        )
        _, answer = self.request("/api/answers", {"question_id": question["id"], "body": "合成测试回答"})
        _, vote = self.request("/api/vote", {"answer_id": answer["id"], "active": True})
        self.assertTrue(vote["voted"])
        self.assertEqual(1, vote["votes"])

    def test_ai_status_derivatives_answer_and_no_evidence(self):
        _, status = self.request("/api/ai/status")
        self.assertEqual({"enabled": True, "configured": True, "model": "deepseek-flash"}, status)
        self.assertEqual(0, self.model.calls)

        generated = server.ai_service().derive_document(self.document_id)
        self.assertEqual("completed", generated["status"])
        _, derivatives = self.request("/api/library/items/{}/derivatives".format(self.document_id))
        self.assertEqual(1, len(derivatives["items"]))
        _, answer = self.request("/api/ai/answer", {"question": "第一份工作应该怎么选？"})
        self.assertEqual("answered", answer["status"])
        self.assertTrue(answer["ai_generated"])
        self.assertEqual(2, self.model.calls)

        _, insufficient = self.request("/api/ai/answer", {"question": "火星核聚变引擎怎么制造？"})
        self.assertEqual("insufficient_evidence", insufficient["status"])
        self.assertEqual(2, self.model.calls)


if __name__ == "__main__":
    unittest.main()
