from __future__ import annotations

import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import server
from content_pipeline.ai_processor import AIProcessor
from content_pipeline.model_adapter import DeepSeekConfig, ModelCallError, ModelResponse
from content_pipeline.processor import ContentProcessor
from content_pipeline.storage import connect_content_db, migrate_content_schema, recover_interrupted_ai_work


FIXTURES = Path(__file__).parent / "fixtures"
QUOTE = "第一份工作不必一次定终身"


def answered(document_id: int, suffix: str = "") -> dict:
    return {
        "status": "answered",
        "answer": "根据资料，第一份工作不必一次定终身。{}".format(suffix),
        "followups": ["还想了解哪一部分？"],
        "citations": [{"document_id": document_id, "quote": QUOTE}],
    }


class SequenceClient:
    def __init__(self, outcomes):
        self.config = DeepSeekConfig("test-key", model="deepseek-flash")
        self.outcomes = list(outcomes)
        self.calls = 0
        self.messages = []

    def complete_json(self, messages, *, wait_for_slot=False):
        self.messages.append(messages)
        outcome = self.outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return ModelResponse(
            json.dumps(outcome, ensure_ascii=False),
            "deepseek-flash",
            {"total_tokens": 12},
            "stop",
            4,
            200,
        )


class BlockingClient(SequenceClient):
    def __init__(self, outcome):
        super().__init__([outcome])
        self.started = threading.Event()
        self.release = threading.Event()

    def complete_json(self, messages, *, wait_for_slot=False):
        self.started.set()
        if not self.release.wait(3):
            raise ModelCallError("timeout", "test timed out")
        return super().complete_json(messages, wait_for_slot=wait_for_slot)


class QuestionAIAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DB_PATH = str(Path(self.temp.name) / "api.sqlite3")
        server.initialize()
        processor = ContentProcessor(server.DB_PATH)
        processor.import_json(FIXTURES / "source_records.json")
        self.document_id = processor.run(1)[0]["document_id"]
        self.client = SequenceClient([answered(self.document_id, str(i)) for i in range(1, 8)])
        server._AI_SERVICES.clear()
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=self.client)

        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:{}".format(self.httpd.server_port)
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        _, created = self.request(
            "/api/questions",
            {"title": "第一份工作应该怎么选？", "body": "想听听资料与经历。", "target": "working"},
        )
        self.question_id = created["id"]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server._AI_SERVICES.clear()
        self.temp.cleanup()

    def request(self, path, payload=None, *, opener=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with (opener or self.opener).open(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_empty_get_validation_and_question_not_found(self):
        status, snapshot = self.request("/api/questions/{}/ai".format(self.question_id))
        self.assertEqual(200, status)
        self.assertEqual("ready", snapshot["status"])
        self.assertEqual(3, snapshot["turns_remaining"])
        self.assertEqual([], snapshot["turns"])
        self.assertEqual(0, self.client.calls)

        status, invalid = self.request(
            "/api/questions/{}/ai".format(self.question_id),
            {"question": "资料怎么看？", "client_turn_id": "bad id!"},
        )
        self.assertEqual(400, status)
        self.assertEqual("invalid_input", invalid["error_code"])
        status, missing = self.request("/api/questions/99999/ai")
        self.assertEqual(404, status)
        self.assertEqual("question_not_found", missing["error_code"])

    def test_three_turn_limit_idempotency_and_frozen_evidence(self):
        path = "/api/questions/{}/ai".format(self.question_id)
        status, first = self.request(path, {"question": "先看资料怎么说？", "client_turn_id": "turn_1"})
        self.assertEqual(200, status)
        self.assertEqual(1, first["turns_used"])
        self.assertEqual(2, first["turns_remaining"])
        self.assertEqual(1, self.client.calls)

        status, repeated = self.request(path, {"question": "这段文字不会覆盖原问题", "client_turn_id": "turn_1"})
        self.assertEqual(200, status)
        self.assertEqual(1, len(repeated["turns"]))
        self.assertEqual("先看资料怎么说？", repeated["turns"][0]["question"])
        self.assertEqual(1, self.client.calls)

        service = server.ai_service()
        service.search_evidence = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("evidence was searched again"))
        for number in (2, 3):
            status, snapshot = self.request(
                path,
                {"question": "第 {} 次追问".format(number), "client_turn_id": "turn_{}".format(number)},
            )
            self.assertEqual(200, status)
        self.assertEqual("limit_reached", snapshot["status"])
        self.assertEqual(3, snapshot["turns_used"])
        self.assertFalse(snapshot["can_ask"])
        self.assertIn("此前用户问题", self.client.messages[2][-1]["content"])

        status, limited = self.request(path, {"question": "第四问", "client_turn_id": "turn_4"})
        self.assertEqual(409, status)
        self.assertEqual("limit_reached", limited["status"])
        self.assertEqual(3, self.client.calls)

    def test_failure_is_idempotent_and_does_not_consume_a_turn(self):
        failing = SequenceClient([ModelCallError("timeout", "模型超时"), answered(self.document_id)])
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=failing)
        path = "/api/questions/{}/ai".format(self.question_id)

        status, failed = self.request(path, {"question": "先问一次", "client_turn_id": "failed_1"})
        self.assertEqual(504, status)
        self.assertEqual("ready", failed["status"])
        self.assertEqual(0, failed["turns_used"])
        self.assertEqual("failed", failed["turns"][0]["status"])
        self.assertEqual("timeout", failed["error_code"])

        status, same = self.request(path, {"question": "不会重发", "client_turn_id": "failed_1"})
        self.assertEqual(504, status)
        self.assertEqual(1, failing.calls)
        status, retried = self.request(path, {"question": "用户主动重试", "client_turn_id": "retry_2"})
        self.assertEqual(200, status)
        self.assertEqual(1, retried["turns_used"])
        self.assertEqual(2, failing.calls)
        status, old_failure = self.request(path, {"question": "仍不重发", "client_turn_id": "failed_1"})
        self.assertEqual(504, status)
        self.assertEqual("timeout", old_failure["error_code"])
        self.assertEqual("模型超时", old_failure["error"])
        self.assertEqual(2, failing.calls)

    def test_first_insufficient_closes_without_model_call(self):
        _, created = self.request(
            "/api/questions",
            {"title": "火星核聚变引擎", "body": "没有相关本地资料", "target": "working"},
        )
        path = "/api/questions/{}/ai".format(created["id"])
        before = self.client.calls
        status, snapshot = self.request(path, {"question": "怎么制造？", "client_turn_id": "mars_1"})
        self.assertEqual(200, status)
        self.assertEqual("insufficient_evidence", snapshot["status"])
        self.assertEqual(1, snapshot["turns_used"])
        self.assertEqual(2, snapshot["turns_remaining"])
        self.assertFalse(snapshot["can_ask"])
        self.assertEqual(before, self.client.calls)
        status, _ = self.request(path, {"question": "继续", "client_turn_id": "mars_2"})
        self.assertEqual(409, status)

    def test_later_insufficient_consumes_one_but_does_not_close_early(self):
        later_insufficient = SequenceClient(
            [
                answered(self.document_id),
                {"status": "insufficient_evidence", "answer": "", "citations": [], "followups": []},
                answered(self.document_id, "第三问"),
            ]
        )
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=later_insufficient)
        path = "/api/questions/{}/ai".format(self.question_id)
        self.assertEqual(200, self.request(path, {"question": "第一问", "client_turn_id": "later_1"})[0])
        status, second = self.request(path, {"question": "第二问", "client_turn_id": "later_2"})
        self.assertEqual(200, status)
        self.assertEqual("ready", second["status"])
        self.assertEqual(2, second["turns_used"])
        self.assertEqual(1, second["turns_remaining"])
        self.assertTrue(second["can_ask"])
        status, third = self.request(path, {"question": "第三问", "client_turn_id": "later_3"})
        self.assertEqual(200, status)
        self.assertEqual("limit_reached", third["status"])

    def test_conversations_are_isolated_by_visitor_and_question(self):
        path = "/api/questions/{}/ai".format(self.question_id)
        _, first = self.request(path, {"question": "访客一", "client_turn_id": "visitor_1"})
        self.assertEqual(1, first["turns_used"])

        second_cookies = http.cookiejar.CookieJar()
        second_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(second_cookies))
        _, empty = self.request(path, opener=second_opener)
        self.assertEqual(0, empty["turns_used"])
        _, second = self.request(
            path,
            {"question": "访客二", "client_turn_id": "visitor_1"},
            opener=second_opener,
        )
        self.assertEqual(1, second["turns_used"])
        self.assertEqual(2, self.client.calls)

        _, another = self.request(
            "/api/questions",
            {"title": "第一份工作的第二个问题", "body": "仍然是测试", "target": "working"},
        )
        _, other_question = self.request("/api/questions/{}/ai".format(another["id"]))
        self.assertEqual(0, other_question["turns_used"])

    def test_source_withdrawal_closes_and_scrubs_citations(self):
        path = "/api/questions/{}/ai".format(self.question_id)
        status, snapshot = self.request(path, {"question": "资料怎么说？", "client_turn_id": "source_1"})
        self.assertEqual(200, status)
        self.assertTrue(snapshot["turns"][0]["citations"])
        calls = self.client.calls
        with connect_content_db(server.DB_PATH) as db:
            db.execute("UPDATE content_source_documents SET quality_status='needs_review'")

        status, withdrawn = self.request(path)
        self.assertEqual(200, status)
        self.assertEqual("source_unavailable", withdrawn["status"])
        self.assertFalse(withdrawn["can_ask"])
        self.assertEqual([], withdrawn["turns"][0]["citations"])
        self.assertEqual("", withdrawn["turns"][0]["answer"])
        self.assertEqual([], withdrawn["turns"][0]["followups"])
        self.assertEqual("source_unavailable", withdrawn["turns"][0]["error_code"])
        status, _ = self.request(path, {"question": "还能继续吗？", "client_turn_id": "source_2"})
        self.assertEqual(409, status)
        self.assertEqual(calls, self.client.calls)

    def test_partial_source_withdrawal_only_hides_affected_answers(self):
        extra_path = Path(self.temp.name) / "extra.json"
        extra_path.write_text(
            json.dumps(
                [
                    {
                        "fixture_notice": "TEST DATA: second synthetic summary",
                        "source_url": "https://www.zhihu.com/question/222/answer/333",
                        "content_kind": "answer",
                        "content_scope": "summary",
                        "title": "第一份工作的另一种选择",
                        "summary": "第一份工作也可以先选择有明确导师和反馈机制的团队。",
                        "author_name": None,
                        "author_age": None,
                        "author_stage": None,
                    }
                ],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        processor = ContentProcessor(server.DB_PATH)
        processor.import_json(extra_path)
        second_document_id = processor.run(1)[0]["document_id"]
        second_quote = "选择有明确导师和反馈机制的团队"
        mixed = SequenceClient(
            [
                answered(self.document_id, "第一条"),
                {
                    "status": "answered",
                    "answer": "根据另一条资料，可以关注导师和反馈机制。",
                    "followups": ["你更在意哪种反馈？"],
                    "citations": [{"document_id": second_document_id, "quote": second_quote}],
                },
            ]
        )
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=mixed)
        path = "/api/questions/{}/ai".format(self.question_id)
        self.assertEqual(200, self.request(path, {"question": "先看一种建议", "client_turn_id": "mixed_1"})[0])
        self.assertEqual(200, self.request(path, {"question": "还有别的建议吗", "client_turn_id": "mixed_2"})[0])

        with connect_content_db(server.DB_PATH) as db:
            db.execute(
                """UPDATE content_source_documents SET quality_status='needs_review'
                   WHERE document_id=?""",
                (second_document_id,),
            )
        _, snapshot = self.request(path)
        self.assertEqual("source_unavailable", snapshot["status"])
        self.assertTrue(snapshot["turns"][0]["answer"])
        self.assertTrue(snapshot["turns"][0]["citations"])
        self.assertEqual("", snapshot["turns"][1]["answer"])
        self.assertEqual([], snapshot["turns"][1]["citations"])
        self.assertEqual("source_unavailable", snapshot["turns"][1]["error_code"])

    def test_source_withdrawn_during_model_call_is_not_published(self):
        blocking = BlockingClient(answered(self.document_id))
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=blocking)
        path = "/api/questions/{}/ai".format(self.question_id)
        cookie_header = "; ".join("{}={}".format(cookie.name, cookie.value) for cookie in self.cookies)
        result = []

        def send():
            payload = json.dumps({"question": "模型执行期间撤回", "client_turn_id": "withdraw_1"}, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(
                self.base + path,
                data=payload,
                headers={"Content-Type": "application/json", "Cookie": cookie_header},
            )
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    result.append((response.status, json.loads(response.read().decode("utf-8"))))
            except urllib.error.HTTPError as exc:
                result.append((exc.code, json.loads(exc.read().decode("utf-8"))))

        worker = threading.Thread(target=send)
        worker.start()
        self.assertTrue(blocking.started.wait(2))
        with connect_content_db(server.DB_PATH) as db:
            db.execute("UPDATE content_source_documents SET quality_status='needs_review'")
        get_status, closed = self.request(path)
        self.assertEqual(200, get_status)
        self.assertEqual("source_unavailable", closed["status"])
        with connect_content_db(server.DB_PATH) as db:
            db.execute("UPDATE content_source_documents SET quality_status='ready'")
        blocking.release.set()
        worker.join(timeout=5)
        self.assertEqual(409, result[0][0])
        snapshot = result[0][1]
        self.assertEqual("source_unavailable", snapshot["status"])
        self.assertEqual(0, snapshot["turns_used"])
        self.assertEqual("failed", snapshot["turns"][0]["status"])
        self.assertEqual("", snapshot["turns"][0]["answer"])
        with connect_content_db(server.DB_PATH) as db:
            job = db.execute(
                """SELECT j.status,j.error_code,j.result_json
                   FROM content_ai_conversation_turns t
                   JOIN content_ai_jobs j ON j.id=t.ai_job_id
                   WHERE t.client_turn_id='withdraw_1'"""
            ).fetchone()
        self.assertEqual(("failed", "source_unavailable", None), tuple(job))

    def test_concurrent_post_has_one_running_turn(self):
        blocking = BlockingClient(answered(self.document_id))
        server._AI_SERVICES[server.DB_PATH] = AIProcessor(server.DB_PATH, client=blocking)
        path = "/api/questions/{}/ai".format(self.question_id)
        cookie_header = "; ".join("{}={}".format(cookie.name, cookie.value) for cookie in self.cookies)
        first_result = []

        def send_first():
            payload = json.dumps({"question": "第一个请求", "client_turn_id": "race_1"}, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(
                self.base + path,
                data=payload,
                headers={"Content-Type": "application/json", "Cookie": cookie_header},
            )
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    first_result.append((response.status, json.loads(response.read().decode("utf-8"))))
            except urllib.error.HTTPError as exc:
                first_result.append((exc.code, json.loads(exc.read().decode("utf-8"))))

        worker = threading.Thread(target=send_first)
        worker.start()
        self.assertTrue(blocking.started.wait(2))
        status, running = self.request(path, {"question": "并发请求", "client_turn_id": "race_2"})
        self.assertEqual(503, status)
        self.assertEqual("running", running["status"])
        self.assertEqual("race_1", running["active_client_turn_id"])
        blocking.release.set()
        worker.join(timeout=5)
        self.assertEqual(200, first_result[0][0])
        self.assertEqual(1, blocking.calls)
        self.assertEqual(1, first_result[0][1]["turns_used"])


class AIRecoveryTests(unittest.TestCase):
    def test_running_turn_is_failed_without_consuming_or_replaying(self):
        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / "recovery.sqlite3"
            server.DB_PATH = str(db_path)
            server.initialize()
            now = 123
            with connect_content_db(db_path) as db:
                migrate_content_schema(db)
                migrate_content_schema(db)
                job_id = db.execute(
                    """INSERT INTO content_ai_jobs(
                           job_key,job_type,status,document_id,input_hash,input_json,requested_model,
                           prompt_version,force,created_at,updated_at)
                       VALUES('recovery-job','answer','running',NULL,'hash','{}','test','question-ai-v1',0,?,?)""",
                    (now, now),
                ).lastrowid
                conversation_id = db.execute(
                    """INSERT INTO content_ai_conversations(
                           visitor_id,question_id,status,evidence_json,created_at,updated_at)
                       VALUES('visitor',1,'running','[]',?,?)""",
                    (now, now),
                ).lastrowid
                db.execute(
                    """INSERT INTO content_ai_conversation_turns(
                           conversation_id,sequence_no,client_turn_id,question,status,ai_job_id,created_at,updated_at)
                       VALUES(?,1,'interrupted_1','问题','running',?,?,?)""",
                    (conversation_id, job_id, now, now),
                )
            with connect_content_db(db_path) as db:
                recovered = recover_interrupted_ai_work(db)
                turn = db.execute(
                    "SELECT status,error_code FROM content_ai_conversation_turns WHERE conversation_id=?",
                    (conversation_id,),
                ).fetchone()
                conversation = db.execute(
                    "SELECT status,error_code FROM content_ai_conversations WHERE id=?", (conversation_id,)
                ).fetchone()
                job = db.execute("SELECT status,error_code FROM content_ai_jobs WHERE id=?", (job_id,)).fetchone()
            self.assertEqual(1, recovered)
            self.assertEqual(("failed", "interrupted"), tuple(turn))
            self.assertEqual(("ready", "interrupted"), tuple(conversation))
            self.assertEqual(("failed", "interrupted"), tuple(job))


if __name__ == "__main__":
    unittest.main()
