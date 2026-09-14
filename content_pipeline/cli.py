"""Local-only command line entry point for content ingestion and processing."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .ai_processor import AIInputError, AIProcessor
from .processor import ContentProcessor, PipelineInputError
from .storage import connect_content_db, get_library_item, list_library_items

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = PROJECT_ROOT / "data" / "app.sqlite3"


def _print(value: Any, *, stream=sys.stdout) -> None:
    json.dump(value, stream, ensure_ascii=False, indent=2)
    stream.write("\n")


def _positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须大于 0")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="content-pipeline", description="知乎资料采集与清洗本地管线")
    parser.add_argument("--db", default=os.environ.get("CONTENT_DB", str(DEFAULT_DB)), help="SQLite 数据库路径")
    commands = parser.add_subparsers(dest="command", required=True)

    ingest = commands.add_parser("ingest-urls", help="提交 1–5 个显式知乎 URL")
    ingest.add_argument("urls", nargs="+")

    html = commands.add_parser("import-html", help="导入操作者明确指定的 HTML")
    html.add_argument("file")
    html.add_argument("--source-url")
    html.add_argument("--scope", choices=("summary", "excerpt", "full", "unknown"), default="unknown")
    html.add_argument("--kind", choices=("answer", "article", "unknown"))
    html.add_argument("--title")
    html.add_argument("--author")

    json_parser = commands.add_parser("import-json", help="导入官方 API 摘要或整理好的来源 JSON")
    json_parser.add_argument("file")

    run_once = commands.add_parser("run-once", help="处理当前队列")
    run_once.add_argument("--limit", type=_positive, default=1)

    status = commands.add_parser("status", help="查询任务状态、错误与事件")
    status.add_argument("--job-id", type=_positive)
    status.add_argument("--limit", type=_positive, default=20)

    reprocess = commands.add_parser("reprocess", help="按来源 ID 重新执行清洗")
    reprocess.add_argument("source_id", type=_positive)

    export = commands.add_parser("export", help="导出 ready 资料及可公开来源信息")
    export.add_argument("--output", help="输出 JSON 文件；省略时写到标准输出")
    export.add_argument("--keyword", default="")
    export.add_argument("--topic", default="")

    ai_generate = commands.add_parser("ai-generate", help="串行生成已验证的资料问答候选")
    ai_generate.add_argument("--limit", type=_positive, default=5)
    ai_generate.add_argument("--document-id", type=_positive)
    ai_generate.add_argument("--force", action="store_true")

    ai_answer = commands.add_parser("ai-answer", help="使用本地资料做一次单轮问答")
    ai_answer.add_argument("question")
    ai_answer.add_argument("--topic")

    ai_status = commands.add_parser("ai-status", help="查询 AI 任务、调用耗时和错误")
    ai_status.add_argument("--job-id", type=_positive)
    ai_status.add_argument("--limit", type=_positive, default=20)
    return parser


def _export(processor: ContentProcessor, args: argparse.Namespace) -> dict[str, Any]:
    with connect_content_db(processor.db_path) as db:
        page_number = 1
        items = []
        while True:
            page = list_library_items(db, keyword=args.keyword, topic=args.topic, page=page_number, page_size=50)
            items.extend(get_library_item(db, item["id"]) for item in page["items"])
            if len(items) >= page["total"]:
                break
            page_number += 1
    result = {"count": len(items), "items": items}
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {"output": str(output), "count": len(items)}
    return result


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command in {"ai-generate", "ai-answer", "ai-status"}:
            ai = AIProcessor(args.db)
            try:
                if args.command == "ai-generate":
                    result = ai.generate_candidates(limit=args.limit, document_id=args.document_id, force=args.force)
                elif args.command == "ai-answer":
                    result = ai.answer(args.question, topic=args.topic, wait_for_slot=True)
                else:
                    result = ai.jobs(args.job_id, args.limit)
            finally:
                ai.close()
        else:
            processor = ContentProcessor(args.db)
            if args.command == "ingest-urls":
                result = processor.ingest_urls(args.urls)
            elif args.command == "import-html":
                result = processor.import_html(
                    args.file,
                    source_url=args.source_url,
                    content_scope=args.scope,
                    content_kind=args.kind,
                    title=args.title,
                    author_name=args.author,
                )
            elif args.command == "import-json":
                result = processor.import_json(args.file)
            elif args.command == "run-once":
                result = processor.run(args.limit)
            elif args.command == "status":
                result = processor.status(args.job_id, args.limit)
            elif args.command == "reprocess":
                result = processor.reprocess(args.source_id)
            elif args.command == "export":
                result = _export(processor, args)
            else:  # pragma: no cover
                parser.error("未知命令")
                return 2
        _print(result)
        return 0
    except (AIInputError, PipelineInputError, ValueError, OSError) as exc:
        _print({"error": str(exc)}, stream=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
