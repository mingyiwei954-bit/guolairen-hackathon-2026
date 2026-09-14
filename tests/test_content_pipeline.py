from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from content_pipeline.fetcher import BlockedFetch, FetchResult, RetryableFetch
from content_pipeline.processor import ContentProcessor
from content_pipeline.storage import connect_content_db, get_library_item, list_library_items
from content_pipeline.urls import URLValidationError, normalize_zhihu_url

FIXTURES = Path(__file__).parent / "fixtures"
TARGET_URL = "https://www.zhihu.com/question/651409603/answer/3466677972"


class SequenceFetcher:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def fetch(self, url):
        outcome = self.outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class ContentPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / "test.sqlite3"
        self.processor = ContentProcessor(self.db_path, retry_delay_seconds=0)

    def tearDown(self):
        self.temp.cleanup()

    def write_json(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def test_url_policy_rejects_non_https_credentials_ports_and_other_hosts(self):
        rejected = (
            "http://www.zhihu.com/question/1",
            "https://127.0.0.1/question/1",
            "https://example.com/question/1",
            "https://root@www.zhihu.com/question/1",
            "https://www.zhihu.com:8443/question/1",
        )
        for value in rejected:
            with self.subTest(value=value), self.assertRaises(URLValidationError):
                normalize_zhihu_url(value)

    def test_targeted_html_extraction_and_ready_query(self):
        imported = self.processor.import_html(
            FIXTURES / "zhihu_answer.html", source_url=TARGET_URL, content_scope="full", content_kind="answer"
        )
        result = self.processor.run(1)[0]
        self.assertEqual("ready", result["status"])
        with connect_content_db(self.db_path) as db:
            item = get_library_item(db, result["document_id"])
        self.assertIn("不因一次失败", item["body"])
        self.assertNotIn("其他作者", item["body"])
        self.assertEqual("作者甲", item["sources"][0]["author"]["name"])
        self.assertEqual(imported["source_id"], item["sources"][0]["id"])

    def test_json_summary_preserves_scope_and_unknown_identity(self):
        result = self.processor.import_json(FIXTURES / "source_records.json")[0]
        processed = self.processor.run(1)[0]
        self.assertEqual("ready", processed["status"])
        with connect_content_db(self.db_path) as db:
            item = get_library_item(db, processed["document_id"])
            matches = list_library_items(db, keyword="职业", topic="职业发展")
        self.assertEqual("summary", item["content_scope"])
        self.assertIsNone(item["sources"][0]["author"]["name"])
        self.assertIsNone(item["sources"][0]["author"]["age"])
        self.assertIsNone(item["sources"][0]["author"]["stage"])
        self.assertEqual(1, matches["total"])
        self.assertEqual(result["source_id"], item["sources"][0]["id"])

    def test_url_and_body_deduplication_preserve_sources(self):
        url_db = self.root / "url-dedupe.sqlite3"
        url_processor = ContentProcessor(url_db)
        first = TARGET_URL + "?utm_source=alpha&share_code=one"
        second = TARGET_URL + "?utm_source=beta"
        urls = url_processor.ingest_urls([first, second])
        self.assertEqual(urls[0]["source_id"], urls[1]["source_id"])
        self.assertTrue(urls[0]["created"])
        self.assertFalse(urls[1]["created"])

        records = [
            {"source_url": "https://www.zhihu.com/question/1/answer/11", "content_kind": "answer", "content_scope": "full", "content": "两个作者独立的同文本。", "author_name": "甲"},
            {"source_url": "https://www.zhihu.com/question/1/answer/12", "content_kind": "answer", "content_scope": "full", "content": "两个作者独立的同文本。", "author_name": "乙"},
        ]
        self.processor.import_json(self.write_json("duplicates.json", records))
        results = self.processor.run(2)
        self.assertFalse(results[0]["duplicate_body"])
        self.assertTrue(results[1]["duplicate_body"])
        with connect_content_db(self.db_path) as db:
            self.assertEqual(1, db.execute("SELECT COUNT(*) FROM content_documents WHERE body_text=?", ("两个作者独立的同文本。",)).fetchone()[0])
            item = get_library_item(db, results[0]["document_id"])
        self.assertEqual({"甲", "乙"}, {source["author"]["name"] for source in item["sources"]})

    def test_blocked_and_empty_pages_are_not_listed(self):
        self.processor.import_html(FIXTURES / "blocked.html", source_url=TARGET_URL, content_scope="full", content_kind="answer")
        blocked = self.processor.run(1)[0]
        self.assertEqual("blocked", blocked["status"])
        empty = self.root / "empty.html"
        empty.write_text("<html><body></body></html>", encoding="utf-8")
        self.processor.import_html(empty, source_url="https://www.zhihu.com/question/1/answer/2", content_scope="full", content_kind="answer")
        reviewed = self.processor.run(1)[0]
        self.assertEqual("needs_review", reviewed["status"])
        with connect_content_db(self.db_path) as db:
            self.assertEqual(0, list_library_items(db)["total"])

    def test_retry_block_and_interrupted_job_recovery(self):
        html = (FIXTURES / "zhihu_answer.html").read_text(encoding="utf-8")
        success = FetchResult(TARGET_URL, TARGET_URL, 200, html, "text/html")
        fetcher = SequenceFetcher([RetryableFetch("timeout"), RetryableFetch("temporary"), success])
        processor = ContentProcessor(self.db_path, fetcher=fetcher, retry_delay_seconds=0)
        processor.ingest_urls([TARGET_URL])
        self.assertEqual("queued", processor.run(1)[0]["status"])
        self.assertEqual("queued", processor.run(1)[0]["status"])
        self.assertEqual("ready", processor.run(1)[0]["status"])
        self.assertEqual(3, fetcher.calls)

        recovery_db = self.root / "recovery.sqlite3"
        recovery = ContentProcessor(recovery_db, stale_after_seconds=0)
        job = recovery.import_html(FIXTURES / "zhihu_answer.html", source_url=TARGET_URL, content_scope="full", content_kind="answer")
        with connect_content_db(recovery_db) as db:
            db.execute("UPDATE content_jobs SET status='extracting',current_step='extracting',updated_at=? WHERE id=?", (int(time.time()) - 10, job["job_id"]))
        self.assertEqual(1, recovery.recover_stale_jobs())
        self.assertEqual("ready", recovery.run(1)[0]["status"])

        blocked_db = self.root / "blocked-fetch.sqlite3"
        blocked_fetcher = SequenceFetcher([BlockedFetch("403")])
        blocked_processor = ContentProcessor(blocked_db, fetcher=blocked_fetcher, retry_delay_seconds=0)
        blocked_processor.ingest_urls([TARGET_URL])
        self.assertEqual("blocked", blocked_processor.run(1)[0]["status"])
        self.assertEqual(1, blocked_fetcher.calls)

    def test_reprocess_pagination_and_ready_filter(self):
        records = [
            {"source_url": "https://www.zhihu.com/question/2/answer/21", "content_kind": "answer", "content_scope": "summary", "summary": "中文查询甲 工作经验"},
            {"source_url": "https://www.zhihu.com/question/2/answer/22", "content_kind": "answer", "content_scope": "summary", "summary": "中文查询乙 学习经验"},
            {"source_url": "https://www.zhihu.com/question/2/answer/23", "content_kind": "answer", "content_scope": "summary", "summary": "中文查询丙 生活经验"},
            {"external_id": "unknown-source", "content_kind": "unknown", "content_scope": "unknown", "content": "不应公开展示"},
        ]
        imported = self.processor.import_json(self.write_json("pagination.json", records))
        processed = self.processor.run(4)
        self.assertEqual(["ready", "ready", "ready", "needs_review"], [item["status"] for item in processed])
        with connect_content_db(self.db_path) as db:
            page1 = list_library_items(db, keyword="中文查询", page=1, page_size=2)
            page2 = list_library_items(db, keyword="中文查询", page=2, page_size=2)
        self.assertEqual(3, page1["total"])
        self.assertEqual(2, len(page1["items"]))
        self.assertEqual(1, len(page2["items"]))
        job = self.processor.reprocess(imported[0]["source_id"])
        result = self.processor.run(1)[0]
        self.assertEqual(job["job_id"], result["job_id"])
        self.assertEqual("ready", result["status"])
        self.assertTrue(result["duplicate_body"])


if __name__ == "__main__":
    unittest.main()
