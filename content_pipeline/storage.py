"""SQLite schema and read-only library queries.

This module intentionally uses only the Python standard library so the existing
web server can expose library reads even when ingestion dependencies are not on
its interpreter path.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 4


MIGRATION_V1 = """
CREATE TABLE IF NOT EXISTS content_schema_migrations(
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_sources(
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('url','html','json')),
  content_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(content_kind IN ('answer','article','unknown')),
  canonical_key TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  original_url TEXT,
  title TEXT,
  author_name TEXT,
  author_age TEXT,
  author_stage TEXT,
  content_scope TEXT NOT NULL DEFAULT 'unknown' CHECK(content_scope IN ('summary','excerpt','full','unknown')),
  raw_format TEXT NOT NULL CHECK(raw_format IN ('html','json','text','pending')),
  raw_content TEXT,
  raw_origin TEXT,
  collected_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_source_aliases(
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL UNIQUE,
  trace_query_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_documents(
  id INTEGER PRIMARY KEY,
  body_text TEXT NOT NULL,
  body_hash TEXT UNIQUE,
  extractor_name TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  cleaning_version TEXT NOT NULL,
  quality_status TEXT NOT NULL CHECK(quality_status IN ('ready','needs_review')),
  quality_reasons_json TEXT NOT NULL DEFAULT '[]',
  topic_method TEXT NOT NULL DEFAULT 'keyword_rules',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_source_documents(
  source_id INTEGER PRIMARY KEY REFERENCES content_sources(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES content_documents(id) ON DELETE CASCADE,
  duplicate_body INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_body IN (0,1)),
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_document_topics(
  document_id INTEGER NOT NULL REFERENCES content_documents(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'keyword_rules',
  PRIMARY KEY(document_id, topic)
);

CREATE TABLE IF NOT EXISTS content_jobs(
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  input_type TEXT NOT NULL CHECK(input_type IN ('url','html','json','reprocess')),
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','fetching','importing','extracting','cleaning','validating','ready','needs_review','blocked','failed')),
  current_step TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
  next_attempt_at INTEGER,
  source_id INTEGER REFERENCES content_sources(id),
  document_id INTEGER REFERENCES content_documents(id),
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_events(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES content_sources(id),
  document_id INTEGER REFERENCES content_documents(id),
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_derivatives(
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES content_documents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  derivative_type TEXT NOT NULL,
  body_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS content_sources_url ON content_sources(canonical_url);
CREATE INDEX IF NOT EXISTS content_documents_status ON content_documents(quality_status, id DESC);
CREATE INDEX IF NOT EXISTS content_jobs_status ON content_jobs(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS content_events_job ON content_events(job_id, id);
CREATE INDEX IF NOT EXISTS content_topics_topic ON content_document_topics(topic, document_id);
"""

MIGRATION_V3 = """
CREATE TABLE IF NOT EXISTS content_ai_jobs(
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL CHECK(job_type IN ('derive','answer')),
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','insufficient_evidence','busy','reused')),
  document_id INTEGER REFERENCES content_documents(id),
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  force INTEGER NOT NULL DEFAULT 0 CHECK(force IN (0,1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  result_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_ai_calls(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES content_ai_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  requested_model TEXT NOT NULL,
  actual_model TEXT,
  prompt_version TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE(job_id,attempt)
);

CREATE INDEX IF NOT EXISTS content_ai_jobs_status ON content_ai_jobs(status,job_type,id DESC);
CREATE INDEX IF NOT EXISTS content_ai_calls_job ON content_ai_calls(job_id,id);
"""

MIGRATION_V4 = """
CREATE TABLE IF NOT EXISTS content_ai_conversations(
  id INTEGER PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready','running','limit_reached','insufficient_evidence','source_unavailable')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(visitor_id,question_id)
);

CREATE TABLE IF NOT EXISTS content_ai_conversation_turns(
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES content_ai_conversations(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  client_turn_id TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','answered','insufficient_evidence','failed')),
  answer TEXT NOT NULL DEFAULT '',
  citations_json TEXT NOT NULL DEFAULT '[]',
  followups_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  ai_job_id INTEGER REFERENCES content_ai_jobs(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id,client_turn_id),
  UNIQUE(conversation_id,sequence_no)
);

CREATE INDEX IF NOT EXISTS content_ai_conversations_lookup
  ON content_ai_conversations(visitor_id,question_id);
CREATE INDEX IF NOT EXISTS content_ai_conversation_turns_lookup
  ON content_ai_conversation_turns(conversation_id,sequence_no);
"""


def connect_content_db(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=15000")
    return db


def migrate_content_schema(db: sqlite3.Connection) -> None:
    db.execute(
        "CREATE TABLE IF NOT EXISTS content_schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
    )
    if not db.execute("SELECT 1 FROM content_schema_migrations WHERE version=1").fetchone():
        db.executescript(MIGRATION_V1)
        db.execute(
            "INSERT OR IGNORE INTO content_schema_migrations(version,applied_at) VALUES(1,?)",
            (int(time.time()),),
        )
    if not db.execute("SELECT 1 FROM content_schema_migrations WHERE version=2").fetchone():
        columns = {row[1] for row in db.execute("PRAGMA table_info(content_source_documents)")}
        if "quality_status" not in columns:
            db.execute(
                "ALTER TABLE content_source_documents ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'needs_review'"
            )
        if "quality_reasons_json" not in columns:
            db.execute(
                "ALTER TABLE content_source_documents ADD COLUMN quality_reasons_json TEXT NOT NULL DEFAULT '[]'"
            )
        db.execute(
            """UPDATE content_source_documents
               SET quality_status=(SELECT quality_status FROM content_documents d WHERE d.id=document_id),
                   quality_reasons_json=(SELECT quality_reasons_json FROM content_documents d WHERE d.id=document_id)"""
        )
        db.execute(
            "INSERT OR IGNORE INTO content_schema_migrations(version,applied_at) VALUES(2,?)",
            (int(time.time()),),
        )
    if not db.execute("SELECT 1 FROM content_schema_migrations WHERE version=3").fetchone():
        db.executescript(MIGRATION_V3)
        columns = {row[1] for row in db.execute("PRAGMA table_info(content_derivatives)")}
        additions = {
            "input_hash": "TEXT",
            "request_model": "TEXT",
            "prompt_version": "TEXT",
            "validation_status": "TEXT NOT NULL DEFAULT 'legacy'",
            "evidence_json": "TEXT NOT NULL DEFAULT '[]'",
            "input_truncated": "INTEGER NOT NULL DEFAULT 0",
            "ai_job_id": "INTEGER",
        }
        for name, declaration in additions.items():
            if name not in columns:
                db.execute("ALTER TABLE content_derivatives ADD COLUMN {} {}".format(name, declaration))
        db.execute(
            "CREATE INDEX IF NOT EXISTS content_derivatives_lookup ON content_derivatives(document_id,provider,derivative_type,validation_status,id DESC)"
        )
        db.execute(
            "INSERT OR IGNORE INTO content_schema_migrations(version,applied_at) VALUES(3,?)",
            (int(time.time()),),
        )
    if not db.execute("SELECT 1 FROM content_schema_migrations WHERE version=4").fetchone():
        db.executescript(MIGRATION_V4)
        db.execute(
            "INSERT OR IGNORE INTO content_schema_migrations(version,applied_at) VALUES(4,?)",
            (int(time.time()),),
        )


def recover_interrupted_ai_work(db: sqlite3.Connection) -> int:
    """Fail unfinished AI work from an earlier server process without replaying it."""
    migrate_content_schema(db)
    now = int(time.time())
    running_turns = db.execute(
        "SELECT id,conversation_id,ai_job_id FROM content_ai_conversation_turns WHERE status='running'"
    ).fetchall()
    db.execute(
        """UPDATE content_ai_jobs
           SET status='failed',error_code='interrupted',error_message='服务重启，上一轮未完成',
               completed_at=?,updated_at=?
           WHERE status='running'""",
        (now, now),
    )
    if not running_turns:
        return 0

    turn_ids = [int(row["id"]) for row in running_turns]
    job_ids = [int(row["ai_job_id"]) for row in running_turns if row["ai_job_id"] is not None]
    placeholders = ",".join("?" for _ in turn_ids)
    db.execute(
        """UPDATE content_ai_conversation_turns
           SET status='failed',error_code='interrupted',error_message='服务重启，上一轮未完成',updated_at=?
           WHERE id IN ({})""".format(placeholders),
        [now] + turn_ids,
    )
    if job_ids:
        job_placeholders = ",".join("?" for _ in job_ids)
        db.execute(
            """UPDATE content_ai_jobs
               SET status='failed',error_code='interrupted',error_message='服务重启，上一轮未完成',
                   completed_at=?,updated_at=?
               WHERE id IN ({}) AND status IN ('queued','running')""".format(job_placeholders),
            [now, now] + job_ids,
        )
    conversation_ids = sorted({int(row["conversation_id"]) for row in running_turns})
    convo_placeholders = ",".join("?" for _ in conversation_ids)
    db.execute(
        """UPDATE content_ai_conversations
           SET status='ready',error_code='interrupted',error_message='服务重启，上一轮未完成',updated_at=?
           WHERE id IN ({}) AND status='running'""".format(convo_placeholders),
        [now] + conversation_ids,
    )
    return len(turn_ids)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _source_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["source_id"],
        "type": row["source_type"],
        "kind": row["content_kind"],
        "url": row["original_url"],
        "canonical_url": row["canonical_url"],
        "title": row["title"],
        "author": {
            "name": row["author_name"],
            "age": row["author_age"],
            "stage": row["author_stage"],
        },
        "content_scope": row["content_scope"],
        "collected_at": row["collected_at"],
    }


def list_library_items(
    db: sqlite3.Connection,
    *,
    keyword: str = "",
    topic: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    migrate_content_schema(db)
    page = max(1, int(page))
    page_size = min(50, max(1, int(page_size)))
    clauses = ["d.quality_status='ready'", "sd.quality_status='ready'"]
    params: list[Any] = []
    if keyword:
        pattern = "%{}%".format(_escape_like(keyword.strip()))
        clauses.append(
            """(d.body_text LIKE ? ESCAPE '\\' OR EXISTS(
                 SELECT 1 FROM content_source_documents sk
                 JOIN content_sources ss ON ss.id=sk.source_id
                 WHERE sk.document_id=d.id AND sk.quality_status='ready'
                   AND COALESCE(ss.title,'') LIKE ? ESCAPE '\\'))"""
        )
        params.extend([pattern, pattern])
    if topic:
        clauses.append(
            "EXISTS(SELECT 1 FROM content_document_topics dt WHERE dt.document_id=d.id AND dt.topic=?)"
        )
        params.append(topic.strip())
    where = " AND ".join(clauses)
    base = """
      FROM content_documents d
      JOIN content_source_documents sd ON sd.source_id=(
        SELECT MIN(sp.source_id) FROM content_source_documents sp
        WHERE sp.document_id=d.id AND sp.quality_status='ready'
      )
      JOIN content_sources s ON s.id=sd.source_id
      WHERE {where}
    """.format(where=where)
    total = db.execute("SELECT COUNT(*) " + base, params).fetchone()[0]
    query = """
      SELECT d.id,d.body_text,d.body_hash,d.quality_status,d.topic_method,d.created_at,
             s.id AS source_id,s.source_type,s.content_kind,s.original_url,s.canonical_url,
             s.title,s.author_name,s.author_age,s.author_stage,s.content_scope,s.collected_at
      {base}
      ORDER BY d.id DESC
      LIMIT ? OFFSET ?
    """.format(base=base)
    rows = db.execute(query, params + [page_size, (page - 1) * page_size]).fetchall()
    items = []
    for row in rows:
        topics = [
            item[0]
            for item in db.execute(
                "SELECT topic FROM content_document_topics WHERE document_id=? ORDER BY topic", (row["id"],)
            )
        ]
        items.append(
            {
                "id": row["id"],
                "title": row["title"],
                "excerpt": row["body_text"][:240],
                "body_hash": row["body_hash"],
                "quality_status": row["quality_status"],
                "topics": topics,
                "topic_method": row["topic_method"],
                "source": _source_dict(row),
            }
        )
    return {"page": page, "page_size": page_size, "total": total, "items": items}


def get_library_item(db: sqlite3.Connection, item_id: int) -> dict[str, Any] | None:
    migrate_content_schema(db)
    document = db.execute(
        """SELECT id,body_text,body_hash,extractor_name,extractor_version,cleaning_version,
                  quality_status,quality_reasons_json,topic_method,created_at,updated_at
           FROM content_documents WHERE id=? AND quality_status='ready'
             AND EXISTS(SELECT 1 FROM content_source_documents sd
                        WHERE sd.document_id=content_documents.id AND sd.quality_status='ready')""",
        (item_id,),
    ).fetchone()
    if not document:
        return None
    source_rows = db.execute(
        """SELECT s.id AS source_id,s.source_type,s.content_kind,s.original_url,s.canonical_url,
                  s.title,s.author_name,s.author_age,s.author_stage,s.content_scope,s.collected_at,
                  sd.duplicate_body,sd.quality_status AS source_quality_status,
                  sd.quality_reasons_json AS source_quality_reasons_json
           FROM content_source_documents sd JOIN content_sources s ON s.id=sd.source_id
           WHERE sd.document_id=? AND sd.quality_status='ready' ORDER BY s.id""",
        (item_id,),
    ).fetchall()
    sources = []
    for row in source_rows:
        value = _source_dict(row)
        value["duplicate_body"] = bool(row["duplicate_body"])
        value["quality_status"] = row["source_quality_status"]
        value["quality_reasons"] = json.loads(row["source_quality_reasons_json"])
        value["aliases"] = [
            alias[0]
            for alias in db.execute(
                "SELECT original_url FROM content_source_aliases WHERE source_id=? ORDER BY id",
                (row["source_id"],),
            )
        ]
        sources.append(value)
    topics = [
        row[0]
        for row in db.execute(
            "SELECT topic FROM content_document_topics WHERE document_id=? ORDER BY topic", (item_id,)
        )
    ]
    scope_rank = {"unknown": 0, "summary": 1, "excerpt": 2, "full": 3}
    conservative_scope = min(
        (source["content_scope"] for source in sources), key=lambda value: scope_rank.get(value, 0)
    ) if sources else "unknown"
    return {
        "id": document["id"],
        "body": document["body_text"],
        "body_hash": document["body_hash"],
        "content_scope": conservative_scope,
        "quality_status": document["quality_status"],
        "quality_reasons": json.loads(document["quality_reasons_json"]),
        "extractor": {"name": document["extractor_name"], "version": document["extractor_version"]},
        "cleaning_version": document["cleaning_version"],
        "topics": topics,
        "topic_method": document["topic_method"],
        "sources": sources,
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }
