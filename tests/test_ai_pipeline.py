from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import httpx

from content_pipeline.ai_processor import AIInputError, AIProcessor
from content_pipeline.model_adapter import DeepSeekClient, DeepSeekConfig, ModelCallError, ModelResponse
from content_pipeline.processor import ContentProcessor
from content_pipeline.storage import connect_content_db


BODY = "在陌生城市工作时，可以从稳定参加同一种线下活动开始，关系往往在重复见面中慢慢建立。"
URL = "https://www.zhihu.com/question/321/answer/654"


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
        content = outcome if isinstance(outcome, str) else json.dumps(outcome, ensure_ascii=False)
        return ModelResponse(content, "deepseek-flash", {"prompt_tokens": 10, "completion_tokens": 20}, "stop", 7, 200)


def candidate(document_id, *, quote=BODY, age=None, stage=None):
    return {
        "display_question": "根据资料整理：在陌生城市如何交到朋友？",
        "answer_summary": "可以从稳定参加同一类线下活动开始，让关系在重复见面中建立。",
        "topics": ["职场", "交友"],
        "followups": ["你愿意稳定参加哪类活动？"],
        "author_age": age,
        "author_stage": stage,
        "evidence_quotes": [{"document_id": document_id, "quote": quote}],
    }


class AIPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = self.root / "ai.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def import_records(self, records):
        path = self.root / "records.json"
        path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
        processor = ContentProcessor(self.db)
        imported = processor.import_json(path)
        processed = processor.run(len(imported))
        return imported, processed

    def ready_document(self):
        _, processed = self.import_records(
            [{"source_url": URL, "content_kind": "answer", "content_scope": "summary", "summary": BODY,
              "title": "陌生城市的工作与交友", "author_name": "某答主", "author_age": None, "author_stage": None}]
        )
        return processed[0]["document_id"]

    def test_derivation_is_validated_idempotent_forceable_and_does_not_change_source(self):
        document_id = self.ready_document()
        client = SequenceClient([candidate(document_id), candidate(document_id)])
        ai = AIProcessor(self.db, client=client)
        with connect_content_db(self.db) as db:
            before = db.execute("SELECT body_text FROM content_documents WHERE id=?", (document_id,)).fetchone()[0]
        first = ai.derive_document(document_id)
        reused = ai.derive_document(document_id)
        forced = ai.derive_document(document_id, force=True)
        self.assertEqual("completed", first["status"])
        self.assertEqual("reused", reused["status"])
        self.assertEqual("completed", forced["status"])
        self.assertEqual(2, client.calls)
        self.assertIsNone(first["candidate"]["author_age"])
        self.assertEqual("summary", first["candidate"]["content_scope"])
        with connect_content_db(self.db) as db:
            after = db.execute("SELECT body_text FROM content_documents WHERE id=?", (document_id,)).fetchone()[0]
            derivative_count = db.execute("SELECT COUNT(*) FROM content_derivatives").fetchone()[0]
        self.assertEqual(before, after)
        self.assertEqual(2, derivative_count)

    def test_invalid_json_gets_one_repair_and_invalid_citations_never_persist(self):
        document_id = self.ready_document()
        repaired_client = SequenceClient(["not-json", candidate(document_id)])
        repaired = AIProcessor(self.db, client=repaired_client).derive_document(document_id)
        self.assertEqual("completed", repaired["status"])
        self.assertEqual(2, repaired_client.calls)
        self.assertIn("仅修复", repaired_client.messages[1][-1]["content"])

        invalid = candidate(document_id, quote="资料中不存在的引用")
        invalid_client = SequenceClient([invalid, invalid])
        failed = AIProcessor(self.db, client=invalid_client).derive_document(document_id, force=True)
        self.assertEqual("failed", failed["status"])
        self.assertEqual("invalid_citations", failed["error_code"])

        fabricated = candidate(document_id)
        fabricated["answer_summary"] = "作者 30 岁，详情见 https://example.com"
        fabricated_client = SequenceClient([fabricated, fabricated])
        fabricated_result = AIProcessor(self.db, client=fabricated_client).derive_document(document_id, force=True)
        self.assertEqual("failed", fabricated_result["status"])
        self.assertIn(fabricated_result["error_code"], {"fabricated_source", "unsupported_identity"})
        with connect_content_db(self.db) as db:
            self.assertEqual(1, db.execute("SELECT COUNT(*) FROM content_derivatives").fetchone()[0])

    def test_grounded_answer_and_no_evidence_short_circuit(self):
        document_id = self.ready_document()
        response = {
            "status": "answered",
            "answer": "根据资料，可从稳定参加同一种线下活动开始。",
            "citations": [{"document_id": document_id, "quote": "稳定参加同一种线下活动"}],
            "followups": ["你身边有哪些可重复参加的活动？"],
        }
        client = SequenceClient([response])
        ai = AIProcessor(self.db, client=client)
        answered = ai.answer("在陌生城市工作，怎样交到志同道合的朋友？")
        self.assertEqual("answered", answered["status"])
        self.assertEqual(URL, answered["citations"][0]["source_url"])
        self.assertEqual("summary", answered["citations"][0]["content_scope"])
        self.assertEqual(1, client.calls)

        no_call_client = SequenceClient([])
        insufficient = AIProcessor(self.db, client=no_call_client).answer("火星移民的核聚变发动机怎么造？")
        self.assertEqual("insufficient_evidence", insufficient["status"])
        self.assertFalse(insufficient["ai_generated"])
        self.assertEqual(0, no_call_client.calls)

    def test_source_metadata_stays_grouped_and_identity_conflicts_are_not_combined(self):
        records = [
            {"source_url": "https://www.zhihu.com/question/1/answer/322", "content_kind": "answer", "content_scope": "full",
             "content": BODY, "title": "A工作经验", "author_age": "20", "author_stage": "college"},
            {"source_url": "https://www.zhihu.com/question/1/answer/321", "content_kind": "answer", "content_scope": "summary",
             "content": BODY, "title": "Z工作经验", "author_age": "60", "author_stage": "retired"},
        ]
        imported, processed = self.import_records(records)
        document_id = processed[0]["document_id"]
        ai = AIProcessor(self.db, client=SequenceClient([]))
        context = ai._document_context(document_id)
        self.assertEqual([], context["allowed_ages"])
        self.assertEqual([], context["allowed_stages"])

        with connect_content_db(self.db) as db:
            db.execute("UPDATE content_source_documents SET quality_status='needs_review' WHERE source_id=?", (imported[0]["source_id"],))
        context = ai._document_context(document_id)
        self.assertEqual(["60"], context["allowed_ages"])
        self.assertEqual("summary", context["item"]["content_scope"])
        evidence = ai.search_evidence("陌生城市工作经验")
        self.assertEqual("Z工作经验", evidence[0]["title"])
        self.assertTrue(evidence[0]["source_url"].endswith("/321"))
        self.assertEqual("summary", evidence[0]["content_scope"])

        with connect_content_db(self.db) as db:
            db.execute("UPDATE content_source_documents SET quality_status='needs_review'")
        with self.assertRaises(AIInputError):
            ai._document_context(document_id)


class DeepSeekAdapterTests(unittest.TestCase):
    def config(self):
        return DeepSeekConfig("secret-test-key", model="deepseek-flash")

    def test_429_string_error_is_classified_and_secret_is_redacted(self):
        def handler(request):
            return httpx.Response(429, json={"error": "rate limit secret-test-key"}, request=request)

        client = DeepSeekClient(self.config(), client=httpx.Client(transport=httpx.MockTransport(handler)))
        with self.assertRaises(ModelCallError) as raised:
            client.complete_json([{"role": "user", "content": "json"}])
        self.assertEqual("rate_limited", raised.exception.code)
        self.assertNotIn("secret-test-key", str(raised.exception))

    def test_protocol_error_is_mapped_to_network_error(self):
        def handler(request):
            raise httpx.RemoteProtocolError("broken", request=request)

        client = DeepSeekClient(self.config(), client=httpx.Client(transport=httpx.MockTransport(handler)))
        with self.assertRaises(ModelCallError) as raised:
            client.complete_json([{"role": "user", "content": "json"}])
        self.assertEqual("network_error", raised.exception.code)

    def test_authentication_balance_and_timeout_errors_are_distinct(self):
        cases = ((401, "authentication_error"), (402, "insufficient_balance"))
        for status, code in cases:
            with self.subTest(code=code):
                transport = httpx.MockTransport(
                    lambda request, value=status: httpx.Response(value, json={"error": {"message": "upstream"}}, request=request)
                )
                client = DeepSeekClient(self.config(), client=httpx.Client(transport=transport))
                with self.assertRaises(ModelCallError) as raised:
                    client.complete_json([{"role": "user", "content": "json"}])
                self.assertEqual(code, raised.exception.code)

        def timeout_handler(request):
            raise httpx.ReadTimeout("slow", request=request)

        timeout_client = DeepSeekClient(self.config(), client=httpx.Client(transport=httpx.MockTransport(timeout_handler)))
        with self.assertRaises(ModelCallError) as raised:
            timeout_client.complete_json([{"role": "user", "content": "json"}])
        self.assertEqual("timeout", raised.exception.code)

    def test_truncated_and_empty_responses_keep_usage_and_model(self):
        payloads = [
            {"model": "deepseek-flash", "choices": [{"message": {"content": "{}"}, "finish_reason": "length"}], "usage": {"prompt_tokens": 10, "completion_tokens": 20}},
            {"model": "deepseek-flash", "choices": [{"message": {"content": ""}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 11, "completion_tokens": 1}},
        ]
        for payload, code, total in ((payloads[0], "truncated", 30), (payloads[1], "empty_content", 12)):
            with self.subTest(code=code):
                transport = httpx.MockTransport(lambda request, value=payload: httpx.Response(200, json=value, request=request))
                client = DeepSeekClient(self.config(), client=httpx.Client(transport=transport))
                with self.assertRaises(ModelCallError) as raised:
                    client.complete_json([{"role": "user", "content": "json"}])
                self.assertEqual(code, raised.exception.code)
                self.assertEqual("deepseek-flash", raised.exception.actual_model)
                self.assertEqual(total, raised.exception.usage["prompt_tokens"] + raised.exception.usage["completion_tokens"])


if __name__ == "__main__":
    unittest.main()
