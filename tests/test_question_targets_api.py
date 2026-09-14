from __future__ import annotations

import http.cookiejar
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import server


class QuestionTargetsAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DB_PATH = str(Path(self.temp.name) / "targets.sqlite3")
        server._AI_SERVICES.clear()
        server.initialize()
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:{}".format(self.httpd.server_port)
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server._AI_SERVICES.clear()
        self.temp.cleanup()

    def request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def create_question(self, **overrides):
        payload = {
            "title": "多阶段测试问题",
            "body": "TEST DATA: 只用于隔离接口测试",
            "target": "working",
        }
        payload.update(overrides)
        return self.request("/api/questions", payload)

    def test_legacy_single_target_request_stays_compatible(self):
        status, created = self.create_question(target="retired")
        self.assertEqual(200, status)
        _, detail = self.request("/api/questions/{}".format(created["id"]))
        self.assertEqual("retired", detail["target"])
        self.assertEqual(["retired"], detail["targets"])

        _, feed = self.request("/api/feed?mode=older&stage=retired")
        item = next(value for value in feed["items"] if value["id"] == created["id"])
        self.assertEqual("retired", item["target"])
        self.assertEqual(["retired"], item["targets"])

    def test_targets_are_deduplicated_ordered_and_preferred_over_target(self):
        status, created = self.create_question(
            target="not-a-stage",
            targets=["retired", "working", "retired"],
        )
        self.assertEqual(200, status)
        _, detail = self.request("/api/questions/{}".format(created["id"]))
        self.assertEqual(["working", "retired"], detail["targets"])
        self.assertEqual("working", detail["target"])

        status, all_created = self.create_question(
            targets=["retired", "primary", "college", "middle", "working", "secondary"]
        )
        self.assertEqual(200, status)
        _, all_detail = self.request("/api/questions/{}".format(all_created["id"]))
        self.assertEqual(server.STAGE_IDS, all_detail["targets"])
        self.assertEqual("primary", all_detail["target"])

    def test_invalid_targets_are_rejected_without_inserting(self):
        with server.connect() as db:
            before = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        invalid_values = (
            [],
            "working",
            ["working", "unknown"],
            ["working", 1],
            ["working"] * 7,
        )
        for index, targets in enumerate(invalid_values):
            with self.subTest(targets=targets):
                status, response = self.create_question(
                    title="无效目标 {}".format(index),
                    targets=targets,
                )
                self.assertEqual(400, status)
                self.assertIn("error", response)
        with server.connect() as db:
            after = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        self.assertEqual(before, after)

    def test_second_target_matches_feed_even_without_an_answer(self):
        status, created = self.create_question(targets=["primary", "working"])
        self.assertEqual(200, status)
        _, feed = self.request("/api/feed?mode=older&stage=working")
        item = next(value for value in feed["items"] if value["id"] == created["id"])
        self.assertEqual("primary", item["target"])
        self.assertEqual(["primary", "working"], item["targets"])
        self.assertIsNone(item["answer"])
        self.assertEqual(0, item["answer_count"])

    def test_targets_do_not_restrict_who_can_answer(self):
        _, created = self.create_question(targets=["working", "retired"])
        status, answer = self.request(
            "/api/answers",
            {"question_id": created["id"], "body": "大学阶段访客也可以回答。"},
        )
        self.assertEqual(200, status)
        _, detail = self.request("/api/questions/{}".format(created["id"]))
        stored = next(value for value in detail["answers"] if value["id"] == answer["id"])
        self.assertEqual("college", stored["stage"])


class QuestionTargetsMigrationTests(unittest.TestCase):
    def test_legacy_database_backfill_is_repeatable(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "legacy.sqlite3"
            with sqlite3.connect(path) as db:
                db.executescript(
                    """
                    CREATE TABLE questions(
                      id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,stage TEXT NOT NULL,
                      target TEXT NOT NULL,owner TEXT,sample INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
                    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
                    INSERT INTO metadata(key,value) VALUES('seed_v1','1');
                    INSERT INTO questions(id,title,body,stage,target,created)
                      VALUES(41,'历史问题','','college','working',1);
                    """
                )
            server.DB_PATH = str(path)
            server._AI_SERVICES.clear()
            server.initialize()
            server.initialize()
            with server.connect() as db:
                targets = db.execute(
                    "SELECT stage,position FROM question_targets WHERE question_id=41 ORDER BY position"
                ).fetchall()
                question = db.execute("SELECT target FROM questions WHERE id=41").fetchone()
            self.assertEqual([("working", 0)], [tuple(row) for row in targets])
            self.assertEqual("working", question["target"])


if __name__ == "__main__":
    unittest.main()
