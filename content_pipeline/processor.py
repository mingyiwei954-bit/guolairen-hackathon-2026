"""Recoverable content jobs and deterministic processing pipeline."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Iterable

from .extractors import (
    CLEANING_VERSION,
    Extraction,
    body_hash,
    clean_text,
    extract_html,
    extract_json_record,
    suspicious_noise_reasons,
)
from .fetcher import BlockedFetch, FetchFailure, HTTPXFetcher, looks_blocked
from .storage import connect_content_db, migrate_content_schema
from .urls import content_kind_from_url, normalize_zhihu_url

MAX_IMPORT_BYTES = 3 * 1024 * 1024
TRANSIENT_STATUSES = ("fetching", "importing", "extracting", "cleaning", "validating")
FINAL_STATUSES = ("ready", "needs_review", "blocked", "failed")


class PipelineInputError(ValueError):
    pass


def _now() -> int:
    return int(time.time())


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _optional_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _scope(value: Any) -> str:
    result = value if isinstance(value, str) else "unknown"
    if result not in ("summary", "excerpt", "full", "unknown"):
        raise PipelineInputError("content_scope 必须是 summary、excerpt、full 或 unknown")
    return result


def _kind(value: Any, source_url: str | None) -> str:
    result = value if isinstance(value, str) and value else content_kind_from_url(source_url)
    if result not in ("answer", "article", "unknown"):
        raise PipelineInputError("content_kind 必须是 answer、article 或 unknown")
    return result


def load_topic_rules(path: str | Path | None = None) -> dict[str, list[str]]:
    location = Path(path) if path else Path(__file__).with_name("config") / "topic_rules.json"
    data = json.loads(location.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise PipelineInputError("主题规则必须是对象")
    output: dict[str, list[str]] = {}
    for topic, keywords in data.items():
        if isinstance(topic, str) and isinstance(keywords, list):
            output[topic] = [word for word in keywords if isinstance(word, str) and word]
    return output


def classify_topics(title: str | None, body: str, rules: dict[str, list[str]]) -> list[str]:
    haystack = "{}\n{}".format(title or "", body).lower()
    return sorted(topic for topic, keywords in rules.items() if any(word.lower() in haystack for word in keywords))


class ContentProcessor:
    def __init__(
        self,
        db_path: str | Path,
        *,
        fetcher: Any | None = None,
        topic_rules_path: str | Path | None = None,
        stale_after_seconds: int = 300,
        retry_delay_seconds: int = 3,
    ) -> None:
        self.db_path = Path(db_path)
        self.fetcher = fetcher or HTTPXFetcher()
        self.topic_rules = load_topic_rules(topic_rules_path)
        self.stale_after_seconds = max(0, stale_after_seconds)
        self.retry_delay_seconds = max(0, retry_delay_seconds)
        with connect_content_db(self.db_path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            migrate_content_schema(db)

    def _event(
        self,
        db,
        job_id: int,
        step: str,
        status: str,
        *,
        duration_ms: int = 0,
        message: str | None = None,
        details: dict[str, Any] | None = None,
        source_id: int | None = None,
        document_id: int | None = None,
    ) -> None:
        db.execute(
            """INSERT INTO content_events(job_id,source_id,document_id,step,status,duration_ms,message,details_json,created_at)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (job_id, source_id, document_id, step, status, duration_ms, message, _json(details or {}), _now()),
        )

    def _upsert_source(self, db, source: dict[str, Any]) -> int:
        now = _now()
        row = db.execute("SELECT id,raw_format,raw_content FROM content_sources WHERE canonical_key=?", (source["canonical_key"],)).fetchone()
        if row:
            source_id = row["id"]
            updates = {
                "title": source.get("title"),
                "author_name": source.get("author_name"),
                "author_age": source.get("author_age"),
                "author_stage": source.get("author_stage"),
            }
            for field, value in updates.items():
                if value:
                    db.execute("UPDATE content_sources SET {}=COALESCE({},?),updated_at=? WHERE id=?".format(field, field), (value, now, source_id))
            if (row["raw_format"] == "pending" or row["raw_content"] is None) and source.get("raw_content") is not None:
                db.execute(
                    """UPDATE content_sources SET raw_format=?,raw_content=?,raw_origin=?,content_scope=?,
                              content_kind=?,collected_at=?,updated_at=? WHERE id=?""",
                    (
                        source["raw_format"], source["raw_content"], source.get("raw_origin"), source["content_scope"],
                        source["content_kind"], source.get("collected_at") or now, now, source_id,
                    ),
                )
            return source_id
        cursor = db.execute(
            """INSERT INTO content_sources(source_type,content_kind,canonical_key,canonical_url,original_url,title,
                      author_name,author_age,author_stage,content_scope,raw_format,raw_content,raw_origin,collected_at,
                      created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                source["source_type"], source["content_kind"], source["canonical_key"], source.get("canonical_url"),
                source.get("original_url"), source.get("title"), source.get("author_name"), source.get("author_age"),
                source.get("author_stage"), source["content_scope"], source["raw_format"], source.get("raw_content"),
                source.get("raw_origin"), source.get("collected_at"), now, now,
            ),
        )
        return int(cursor.lastrowid)

    def _enqueue(self, db, *, job_key: str, input_type: str, source_id: int, input_data: dict[str, Any]) -> tuple[int, bool]:
        now = _now()
        cursor = db.execute(
            """INSERT OR IGNORE INTO content_jobs(job_key,input_type,input_json,status,current_step,source_id,created_at,updated_at)
               VALUES(?,?,?,'queued','queued',?,?,?)""",
            (job_key, input_type, _json(input_data), source_id, now, now),
        )
        row = db.execute("SELECT id FROM content_jobs WHERE job_key=?", (job_key,)).fetchone()
        return int(row["id"]), cursor.rowcount == 1

    def ingest_urls(self, urls: Iterable[str]) -> list[dict[str, Any]]:
        values = list(urls)
        if not values or len(values) > 5:
            raise PipelineInputError("每批必须提交 1 到 5 个显式 URL")
        results = []
        with connect_content_db(self.db_path) as db:
            migrate_content_schema(db)
            for value in values:
                normalized = normalize_zhihu_url(value)
                source_id = self._upsert_source(
                    db,
                    {
                        "source_type": "url", "content_kind": content_kind_from_url(normalized.canonical_url),
                        "canonical_key": normalized.canonical_key, "canonical_url": normalized.canonical_url,
                        "original_url": normalized.original_url, "content_scope": "full", "raw_format": "pending",
                    },
                )
                db.execute(
                    """INSERT OR IGNORE INTO content_source_aliases(source_id,original_url,trace_query_json,created_at)
                       VALUES(?,?,?,?)""",
                    (source_id, normalized.original_url, normalized.trace_query_json, _now()),
                )
                job_id, created = self._enqueue(
                    db, job_key="fetch:" + _hash(normalized.canonical_url), input_type="url", source_id=source_id,
                    input_data={"source_id": source_id, "url": normalized.original_url},
                )
                results.append({"job_id": job_id, "source_id": source_id, "created": created, "canonical_url": normalized.canonical_url})
        return results

    def import_html(
        self,
        file_path: str | Path,
        *,
        source_url: str | None = None,
        content_scope: str = "unknown",
        content_kind: str | None = None,
        title: str | None = None,
        author_name: str | None = None,
    ) -> dict[str, Any]:
        path = Path(file_path).expanduser().resolve(strict=True)
        raw_bytes = path.read_bytes()
        if len(raw_bytes) > MAX_IMPORT_BYTES:
            raise PipelineInputError("HTML 文件超过 3MB 上限")
        raw = raw_bytes.decode("utf-8", errors="replace")
        normalized = normalize_zhihu_url(source_url) if source_url else None
        digest = hashlib.sha256(raw_bytes).hexdigest()
        canonical_key = "html:{}:{}".format(normalized.canonical_url if normalized else str(path), digest)
        kind = _kind(content_kind, normalized.canonical_url if normalized else None)
        with connect_content_db(self.db_path) as db:
            source_id = self._upsert_source(
                db,
                {
                    "source_type": "html", "content_kind": kind, "canonical_key": canonical_key,
                    "canonical_url": normalized.canonical_url if normalized else None,
                    "original_url": normalized.original_url if normalized else None,
                    "title": _optional_text(title), "author_name": _optional_text(author_name),
                    "content_scope": _scope(content_scope), "raw_format": "html", "raw_content": raw,
                    "raw_origin": str(path), "collected_at": _now(),
                },
            )
            if normalized:
                db.execute(
                    "INSERT OR IGNORE INTO content_source_aliases(source_id,original_url,trace_query_json,created_at) VALUES(?,?,?,?)",
                    (source_id, normalized.original_url, normalized.trace_query_json, _now()),
                )
            job_id, created = self._enqueue(
                db, job_key="html:" + _hash(canonical_key), input_type="html", source_id=source_id,
                input_data={"source_id": source_id},
            )
        return {"job_id": job_id, "source_id": source_id, "created": created}

    def import_json(self, file_path: str | Path) -> list[dict[str, Any]]:
        path = Path(file_path).expanduser().resolve(strict=True)
        raw_bytes = path.read_bytes()
        if len(raw_bytes) > MAX_IMPORT_BYTES:
            raise PipelineInputError("JSON 文件超过 3MB 上限")
        try:
            parsed = json.loads(raw_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PipelineInputError("JSON 文件格式错误") from exc
        records = parsed if isinstance(parsed, list) else [parsed]
        if not records or not all(isinstance(record, dict) for record in records):
            raise PipelineInputError("来源 JSON 必须是对象或对象数组")
        results = []
        with connect_content_db(self.db_path) as db:
            for index, record in enumerate(records):
                record_raw = _json(record)
                source_url = _optional_text(record.get("source_url"))
                normalized = normalize_zhihu_url(source_url) if source_url else None
                scope = "summary" if "summary" in record and "content" not in record and "text" not in record else _scope(record.get("content_scope", "unknown"))
                kind = _kind(record.get("content_kind"), normalized.canonical_url if normalized else None)
                identity = normalized.canonical_url if normalized else _optional_text(record.get("external_id")) or _hash(record_raw)
                canonical_key = "json:{}:{}".format(identity, _hash(record_raw))
                source_id = self._upsert_source(
                    db,
                    {
                        "source_type": "json", "content_kind": kind, "canonical_key": canonical_key,
                        "canonical_url": normalized.canonical_url if normalized else None,
                        "original_url": normalized.original_url if normalized else None,
                        "title": _optional_text(record.get("title")), "author_name": _optional_text(record.get("author_name")),
                        "author_age": _optional_text(record.get("author_age")), "author_stage": _optional_text(record.get("author_stage")),
                        "content_scope": scope, "raw_format": "json", "raw_content": record_raw,
                        "raw_origin": "{}#{}".format(path, index), "collected_at": _now(),
                    },
                )
                if normalized:
                    db.execute(
                        "INSERT OR IGNORE INTO content_source_aliases(source_id,original_url,trace_query_json,created_at) VALUES(?,?,?,?)",
                        (source_id, normalized.original_url, normalized.trace_query_json, _now()),
                    )
                job_id, created = self._enqueue(
                    db, job_key="json:" + _hash(canonical_key), input_type="json", source_id=source_id,
                    input_data={"source_id": source_id},
                )
                results.append({"job_id": job_id, "source_id": source_id, "created": created})
        return results

    def reprocess(self, source_id: int) -> dict[str, Any]:
        with connect_content_db(self.db_path) as db:
            row = db.execute("SELECT id FROM content_sources WHERE id=? AND raw_content IS NOT NULL", (source_id,)).fetchone()
            if not row:
                raise PipelineInputError("来源不存在或没有可重新处理的原始材料")
            nonce = time.time_ns()
            job_id, created = self._enqueue(
                db, job_key="reprocess:{}:{}:{}".format(source_id, CLEANING_VERSION, nonce), input_type="reprocess",
                source_id=source_id, input_data={"source_id": source_id},
            )
        return {"job_id": job_id, "source_id": source_id, "created": created}

    def recover_stale_jobs(self) -> int:
        threshold = _now() - self.stale_after_seconds
        with connect_content_db(self.db_path) as db:
            rows = db.execute(
                "SELECT id,source_id,current_step FROM content_jobs WHERE status IN ({}) AND updated_at<=?".format(
                    ",".join("?" for _ in TRANSIENT_STATUSES)
                ),
                (*TRANSIENT_STATUSES, threshold),
            ).fetchall()
            for row in rows:
                db.execute(
                    "UPDATE content_jobs SET status='queued',current_step='queued',retryable=1,updated_at=? WHERE id=?",
                    (_now(), row["id"]),
                )
                self._event(db, row["id"], row["current_step"], "recovered", message="恢复中断任务", source_id=row["source_id"])
        return len(rows)

    def _claim(self):
        self.recover_stale_jobs()
        db = connect_content_db(self.db_path)
        try:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                """SELECT * FROM content_jobs WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
                   ORDER BY id LIMIT 1""",
                (_now(),),
            ).fetchone()
            if not row:
                db.commit()
                return None
            initial = "fetching" if row["input_type"] == "url" else "importing"
            now = _now()
            db.execute(
                """UPDATE content_jobs SET status=?,current_step=?,attempts=attempts+1,retryable=0,
                          error_code=NULL,error_message=NULL,started_at=COALESCE(started_at,?),updated_at=? WHERE id=?""",
                (initial, initial, now, now, row["id"]),
            )
            self._event(db, row["id"], initial, "started", source_id=row["source_id"])
            db.commit()
            return db.execute("SELECT * FROM content_jobs WHERE id=?", (row["id"],)).fetchone()
        finally:
            db.close()

    def _transition(self, job_id: int, status: str, *, duration_ms: int = 0, message: str | None = None, details=None, document_id=None) -> None:
        with connect_content_db(self.db_path) as db:
            row = db.execute("SELECT source_id FROM content_jobs WHERE id=?", (job_id,)).fetchone()
            db.execute("UPDATE content_jobs SET status=?,current_step=?,document_id=COALESCE(?,document_id),updated_at=? WHERE id=?", (status, status, document_id, _now(), job_id))
            self._event(db, job_id, status, "completed", duration_ms=duration_ms, message=message, details=details, source_id=row["source_id"], document_id=document_id)

    def _finish_failure(self, job, failure: Exception) -> dict[str, Any]:
        is_blocked = isinstance(failure, BlockedFetch)
        retryable = isinstance(failure, FetchFailure) and failure.retryable
        if isinstance(failure, FetchFailure) and failure.raw_text:
            with connect_content_db(self.db_path) as db:
                db.execute(
                    "UPDATE content_sources SET raw_format='html',raw_content=?,collected_at=?,updated_at=? WHERE id=?",
                    (failure.raw_text, _now(), _now(), job["source_id"]),
                )
        if retryable and job["attempts"] < job["max_attempts"]:
            delay = self.retry_delay_seconds * (2 ** max(0, job["attempts"] - 1))
            with connect_content_db(self.db_path) as db:
                db.execute(
                    """UPDATE content_jobs SET status='queued',current_step='fetching',retryable=1,next_attempt_at=?,
                              error_code=?,error_message=?,updated_at=? WHERE id=?""",
                    (_now() + delay, getattr(failure, "code", "temporary_error"), str(failure), _now(), job["id"]),
                )
                self._event(db, job["id"], "fetching", "retry_scheduled", message=str(failure), details={"delay_seconds": delay, "attempt": job["attempts"]}, source_id=job["source_id"])
            return {"job_id": job["id"], "status": "queued", "retry_scheduled": True, "error": str(failure)}
        final = "blocked" if is_blocked else "failed"
        with connect_content_db(self.db_path) as db:
            db.execute(
                """UPDATE content_jobs SET status=?,current_step=?,retryable=?,error_code=?,error_message=?,
                          completed_at=?,updated_at=? WHERE id=?""",
                (final, job["current_step"], int(retryable), getattr(failure, "code", "processing_error"), str(failure), _now(), _now(), job["id"]),
            )
            self._event(db, job["id"], job["current_step"], final, message=str(failure), source_id=job["source_id"])
        return {"job_id": job["id"], "status": final, "error": str(failure)}

    def _load_source(self, source_id: int):
        with connect_content_db(self.db_path) as db:
            return db.execute("SELECT * FROM content_sources WHERE id=?", (source_id,)).fetchone()

    def _persist_document(self, job_id: int, source, extraction: Extraction, cleaned: str, quality_reasons: list[str]) -> tuple[int, str, bool]:
        status = "ready" if not quality_reasons else "needs_review"
        digest = body_hash(cleaned) if cleaned else None
        topics = classify_topics(source["title"] or extraction.title, cleaned, self.topic_rules)
        now = _now()
        with connect_content_db(self.db_path) as db:
            existing = db.execute("SELECT id,quality_status FROM content_documents WHERE body_hash=?", (digest,)).fetchone() if digest else None
            duplicate = existing is not None
            if existing:
                document_id = int(existing["id"])
                if status == "ready" and existing["quality_status"] != "ready":
                    db.execute(
                        "UPDATE content_documents SET quality_status='ready',quality_reasons_json='[]',updated_at=? WHERE id=?",
                        (now, document_id),
                    )
                elif existing["quality_status"] == "ready":
                    status = "ready" if not quality_reasons else "needs_review"
            else:
                cursor = db.execute(
                    """INSERT INTO content_documents(body_text,body_hash,extractor_name,extractor_version,cleaning_version,
                              quality_status,quality_reasons_json,topic_method,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (cleaned, digest, extraction.extractor_name, extraction.extractor_version, CLEANING_VERSION, status, _json(quality_reasons), "keyword_rules", now, now),
                )
                document_id = int(cursor.lastrowid)
                for topic in topics:
                    db.execute("INSERT INTO content_document_topics(document_id,topic,method) VALUES(?,?,'keyword_rules')", (document_id, topic))
            db.execute(
                """INSERT INTO content_source_documents(source_id,document_id,duplicate_body,linked_at,quality_status,quality_reasons_json)
                   VALUES(?,?,?,?,?,?)
                   ON CONFLICT(source_id) DO UPDATE SET document_id=excluded.document_id,
                     duplicate_body=excluded.duplicate_body,linked_at=excluded.linked_at,
                     quality_status=excluded.quality_status,quality_reasons_json=excluded.quality_reasons_json""",
                (source["id"], document_id, int(duplicate), now, status, _json(quality_reasons)),
            )
            db.execute(
                """UPDATE content_sources SET title=COALESCE(title,?),author_name=COALESCE(author_name,?),updated_at=? WHERE id=?""",
                (extraction.title, extraction.author_name, now, source["id"]),
            )
            db.execute(
                """UPDATE content_jobs SET status=?,current_step='validating',document_id=?,completed_at=?,updated_at=? WHERE id=?""",
                (status, document_id, now, now, job_id),
            )
            self._event(
                db, job_id, "validating", status, message="质量检查完成",
                details={"quality_reasons": quality_reasons, "duplicate_body": duplicate, "topics": topics},
                source_id=source["id"], document_id=document_id,
            )
        return document_id, status, duplicate

    def process_next(self) -> dict[str, Any] | None:
        job = self._claim()
        if job is None:
            return None
        try:
            source = self._load_source(job["source_id"])
            if not source:
                raise PipelineInputError("任务关联来源不存在")
            if job["input_type"] == "url":
                started = time.perf_counter()
                fetched = self.fetcher.fetch(json.loads(job["input_json"])["url"])
                duration = int((time.perf_counter() - started) * 1000)
                with connect_content_db(self.db_path) as db:
                    db.execute(
                        """UPDATE content_sources SET raw_format='html',raw_content=?,collected_at=?,updated_at=? WHERE id=?""",
                        (fetched.text, _now(), _now(), source["id"]),
                    )
                    self._event(db, job["id"], "fetching", "completed", duration_ms=duration, details={"status_code": fetched.status_code, "final_url": fetched.final_url, "bytes": len(fetched.text.encode('utf-8'))}, source_id=source["id"])
                source = self._load_source(source["id"])
            else:
                self._transition(job["id"], "importing", message="读取已保存的原始材料")

            if source["raw_format"] == "html" and looks_blocked(source["raw_content"] or ""):
                raise BlockedFetch("导入材料是登录、验证码或访问拦截页", raw_text=source["raw_content"] or "")

            self._transition(job["id"], "extracting")
            started = time.perf_counter()
            if source["raw_format"] == "html":
                extraction = extract_html(source["raw_content"] or "", source["canonical_url"], source["content_kind"])
            elif source["raw_format"] == "json":
                extraction = extract_json_record(source["raw_content"] or "")
            else:
                extraction = Extraction(source["raw_content"] or "", source["title"], source["author_name"], "plain-text", "1")
            self._transition(job["id"], "cleaning", duration_ms=int((time.perf_counter() - started) * 1000), details={"warnings": list(extraction.warnings)})
            started = time.perf_counter()
            cleaned = clean_text(extraction.text)
            self._transition(job["id"], "validating", duration_ms=int((time.perf_counter() - started) * 1000), details={"characters": len(cleaned)})

            reasons = list(extraction.warnings)
            if not cleaned:
                reasons.append("empty_body")
            reasons.extend(suspicious_noise_reasons(cleaned))
            if source["content_scope"] == "unknown":
                reasons.append("content_scope_unknown")
            if source["content_kind"] == "unknown":
                reasons.append("content_kind_unknown")
            if not source["canonical_url"] and source["source_type"] == "json":
                reasons.append("source_missing")
            reasons = sorted(set(reasons))
            document_id, status, duplicate = self._persist_document(job["id"], source, extraction, cleaned, reasons)
            return {"job_id": job["id"], "source_id": source["id"], "document_id": document_id, "status": status, "duplicate_body": duplicate, "quality_reasons": reasons}
        except Exception as exc:
            return self._finish_failure(job, exc)

    def run(self, limit: int = 1) -> list[dict[str, Any]]:
        if limit < 1:
            raise PipelineInputError("limit 必须大于 0")
        results = []
        for _ in range(limit):
            result = self.process_next()
            if result is None:
                break
            results.append(result)
        return results

    def status(self, job_id: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with connect_content_db(self.db_path) as db:
            query = "SELECT * FROM content_jobs"
            params: list[Any] = []
            if job_id is not None:
                query += " WHERE id=?"
                params.append(job_id)
            query += " ORDER BY id DESC LIMIT ?"
            params.append(min(100, max(1, limit)))
            rows = db.execute(query, params).fetchall()
            output = []
            for row in rows:
                item = dict(row)
                item["input"] = json.loads(item.pop("input_json"))
                item["events"] = [
                    dict(event)
                    for event in db.execute(
                        """SELECT step,status,duration_ms,message,details_json,created_at FROM content_events
                           WHERE job_id=? ORDER BY id""",
                        (row["id"],),
                    )
                ]
                for event in item["events"]:
                    event["details"] = json.loads(event.pop("details_json"))
                output.append(item)
            return output
