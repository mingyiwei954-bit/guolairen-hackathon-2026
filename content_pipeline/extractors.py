"""Targeted Zhihu extraction followed by deterministic cleaning."""

from __future__ import annotations

import hashlib
import html as html_stdlib
import json
import re
from dataclasses import dataclass

from lxml import etree, html as lxml_html
import trafilatura

from .urls import answer_id_from_url

EXTRACTOR_NAME = "trafilatura+zhihu-target"
EXTRACTOR_VERSION = trafilatura.__version__
CLEANING_VERSION = "deterministic-v1"

NOISE_LINES = {
    "登录", "注册", "登录知乎", "写回答", "查看全部回答", "展开阅读全文", "收起",
    "推荐阅读", "相关推荐", "更多回答", "发布于", "编辑于", "赞同", "评论", "收藏",
}
NOISE_PATTERNS = (
    re.compile(r"^登录后.*$"),
    re.compile(r"^打开知乎.*$"),
    re.compile(r"^知乎[，,].*问题$"),
    re.compile(r"^©\s*\d{4}.*$", re.I),
)
SUSPICIOUS_MARKERS = ("登录知乎", "推荐阅读", "相关推荐", "下载知乎 App", "验证码", "安全验证")


@dataclass(frozen=True)
class Extraction:
    text: str
    title: str | None
    author_name: str | None
    extractor_name: str
    extractor_version: str
    warnings: tuple[str, ...] = ()


def _class_xpath(name: str) -> str:
    return "contains(concat(' ', normalize-space(@class), ' '), ' {} ')".format(name)


def _text_or_none(values: list[str]) -> str | None:
    value = " ".join(item.strip() for item in values if item and item.strip()).strip()
    return value or None


def _extract_with_trafilatura(fragment: str) -> str:
    return trafilatura.extract(
        fragment,
        output_format="txt",
        include_comments=False,
        include_tables=False,
        include_links=False,
        favor_precision=True,
    ) or ""


def _structured_block_text(element) -> str:
    """Keep paragraph/list boundaries inside an already identified content node."""
    blocks = element.xpath(".//p | .//li | .//blockquote | .//h1 | .//h2 | .//h3 | .//h4")
    lines = []
    for block in blocks:
        value = " ".join(block.text_content().split())
        if value:
            lines.append(("- " if block.tag.lower() == "li" else "") + value)
    return "\n".join(lines)


def extract_html(raw_html: str, source_url: str | None, content_kind: str) -> Extraction:
    if not raw_html.strip():
        return Extraction("", None, None, EXTRACTOR_NAME, EXTRACTOR_VERSION, ("empty_html",))
    try:
        tree = lxml_html.fromstring(raw_html)
    except (ValueError, etree.ParserError):
        return Extraction("", None, None, EXTRACTOR_NAME, EXTRACTOR_VERSION, ("invalid_html",))

    title = _text_or_none(tree.xpath("//title/text()"))
    author_name = None
    warnings: list[str] = []
    fragment = raw_html
    selected_text = ""

    if content_kind == "answer" or answer_id_from_url(source_url):
        answer_id = answer_id_from_url(source_url)
        candidates = tree.xpath("//*[%s]" % _class_xpath("AnswerItem"))
        target = None
        if answer_id:
            for candidate in candidates:
                data = " ".join(
                    value for value in (candidate.get("data-zop"), candidate.get("data-id"), candidate.get("id")) if value
                )
                links = candidate.xpath(".//@href")
                if answer_id in data or any("/answer/{}".format(answer_id) in link for link in links):
                    target = candidate
                    break
        if target is None and len(candidates) == 1:
            target = candidates[0]
        if target is None:
            warnings.append("target_answer_not_identified")
        else:
            author_name = _text_or_none(
                target.xpath(".//*[%s]//text()" % _class_xpath("AuthorInfo-name"))
                or target.xpath(".//*[@itemprop='name']/@content")
            )
            rich = target.xpath(".//*[%s]" % _class_xpath("RichContent-inner"))
            selected = rich[0] if rich else target
            fragment = lxml_html.tostring(selected, encoding="unicode", method="html")
            selected_text = _structured_block_text(selected)
    elif content_kind == "article":
        article = tree.xpath("//*[%s]" % _class_xpath("Post-RichTextContainer"))
        if not article:
            article = tree.xpath("//article")
        if article:
            fragment = lxml_html.tostring(article[0], encoding="unicode", method="html")
            selected_text = _structured_block_text(article[0])
        author_name = _text_or_none(tree.xpath("//*[@itemprop='name']/@content"))

    text = selected_text or _extract_with_trafilatura(fragment)
    if not text and not warnings:
        try:
            text = lxml_html.fromstring(fragment).text_content()
            warnings.append("trafilatura_empty_fallback_text")
        except (ValueError, etree.ParserError):
            pass
    try:
        metadata = trafilatura.extract_metadata(raw_html)
        if metadata:
            title = title or getattr(metadata, "title", None)
            author_name = author_name or getattr(metadata, "author", None)
    except (TypeError, ValueError):
        warnings.append("metadata_extraction_failed")
    return Extraction(text, title, author_name, EXTRACTOR_NAME, EXTRACTOR_VERSION, tuple(warnings))


def extract_json_record(raw_json: str) -> Extraction:
    try:
        record = json.loads(raw_json)
    except json.JSONDecodeError:
        return Extraction("", None, None, "json-import", "1", ("invalid_json",))
    if not isinstance(record, dict):
        return Extraction("", None, None, "json-import", "1", ("invalid_json_record",))
    text = record.get("content")
    if text is None:
        text = record.get("text")
    if text is None:
        text = record.get("summary")
    if not isinstance(text, str):
        text = ""
    if re.search(r"<\s*[a-zA-Z][^>]*>", text):
        text = _extract_with_trafilatura(text) or lxml_html.fromstring(text).text_content()
    return Extraction(
        text,
        record.get("title") if isinstance(record.get("title"), str) else None,
        record.get("author_name") if isinstance(record.get("author_name"), str) else None,
        "json-import",
        "1",
        (),
    )


def clean_text(value: str) -> str:
    text = html_stdlib.unescape(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    text = text.replace("\u200b", "").replace("\ufeff", "")
    output: list[str] = []
    previous = None
    blank = False
    for raw_line in text.split("\n"):
        line = re.sub(r"[\t \u3000]+", " ", raw_line).strip()
        if not line:
            if output and not blank:
                output.append("")
            blank = True
            continue
        blank = False
        if line in NOISE_LINES or any(pattern.match(line) for pattern in NOISE_PATTERNS):
            continue
        if line == previous:
            continue
        output.append(line)
        previous = line
    while output and not output[-1]:
        output.pop()
    return "\n".join(output).strip()


def body_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def suspicious_noise_reasons(text: str) -> list[str]:
    return ["template_noise_remaining"] if any(marker in text for marker in SUSPICIOUS_MARKERS) else []
