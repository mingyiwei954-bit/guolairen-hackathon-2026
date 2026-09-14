# 知乎资料采集与清洗底座

该模块在现有 SQLite 上增量扩展，不更改原有问题、回答、点赞和访客会话表。资料导入和队列处理仅能由本地 CLI 触发；资料只读查询与独立 AI 问答接口不改变原有 feed 数据。

## 环境

使用 Python 3.11 独立环境，不运行远程安装脚本：

```bash
cd /Users/frihed/Desktop/知乎黑客松链路测试-20260914/product
python3.11 -m venv .venv-content
.venv-content/bin/python -m pip install -r requirements-content.lock
```

直接依赖是 HTTPX 0.28.1 和 Trafilatura 2.2.0；完整锁定见 `requirements-content.lock`，许可证说明见 `THIRD_PARTY_NOTICES.md`。Crawl4AI 和 `wycm/zhihu-crawler` 本轮都未安装。

## 处理流程与数据表

```text
queued → fetching/importing → extracting → cleaning
       → validating → ready / needs_review

访问拦截 → blocked
不可恢复错误 → failed
```

- `content_sources`：来源类型、原始/规范 URL、作者可缺省字段、内容范围和原始材料。
- `content_source_aliases`：保留带溯源参数的原始 URL，规范 URL 用于去重。
- `content_documents`：清洗文本、正文 SHA-256、提取/清洗版本和文档级质量状态。
- `content_source_documents`：来源与去重正文的关系，单独保存该来源的质检结果，避免不同来源相互污染。
- `content_jobs` / `content_events`：可恢复任务和步骤级耗时、错误、输入输出关联。
- `content_document_topics`：可配置关键词规则分类，规则在 `content_pipeline/config/topic_rules.json`。
- `content_derivatives` / `content_ai_jobs` / `content_ai_calls`：保存已校验候选与模型任务/调用日志；原文不被覆盖。详见 `AI_INTEGRATION.md`。

`content_pipeline/storage.py` 保存幂等迁移：版本 1 创建内容表，版本 2 将质检结果下沉到来源—正文关系，版本 3 增加 AI 任务、调用记录和候选校验字段。每次启动或使用 CLI 都可重复安全执行。网络请求不持有数据库写事务。

## 本地命令

默认数据库为 `data/app.sqlite3`，所有命令都可以在子命令前加 `--db /path/to/isolated.sqlite3`。

```bash
# 一批最多 5 个显式 URL；不递归发现链接
.venv-content/bin/python -m content_pipeline ingest-urls \
  'https://www.zhihu.com/question/651409603/answer/3466677972'

# 本地 HTML；来源和内容范围由操作者明确提供
.venv-content/bin/python -m content_pipeline import-html /absolute/page.html \
  --source-url 'https://www.zhihu.com/question/651409603/answer/3466677972' \
  --scope full --kind answer

# 官方 API 摘要或已整理来源记录，不会自动消耗 API 额度
.venv-content/bin/python -m content_pipeline import-json examples/source-record.example.json

.venv-content/bin/python -m content_pipeline run-once --limit 5
.venv-content/bin/python -m content_pipeline status --limit 20
.venv-content/bin/python -m content_pipeline status --job-id 1
.venv-content/bin/python -m content_pipeline reprocess 1
.venv-content/bin/python -m content_pipeline export --output /tmp/library-export.json
```

URL 请求只允许 HTTPS 的 `zhihu.com`、`www.zhihu.com`、`zhuanlan.zhihu.com`，每次重定向都会重新验证。单请求超时 15 秒，响应体上限 3MB，同站请求间隔至少 3 秒，并发数为 1。只有超时、网络临时错误、429 和部分 5xx 最多额外重试两次；403、登录拦截和验证码不重试。

JSON 支持单对象或对象数组。正文字段依次为 `content`、`text`、`summary`；`content_scope` 只能是 `summary | excerpt | full | unknown`，`content_kind` 只能是 `answer | article | unknown`。仅有 `summary` 时会强制保留为摘要。缺失作者姓名、年龄、阶段时保持 `null`，不推断。

## 只读查询接口

```text
GET /api/library/items?page=1&page_size=20&q=职业&topic=职业发展
GET /api/library/items/1
```

列表默认只返回 `ready`，`page_size` 最大 50。`q` 使用 SQLite 参数化 `LIKE` 查询标题和清洗正文；`topic` 是精确的规则主题。详情返回清洗正文、正文范围、作者可缺省字段、原始链接与规范链接；不返回 `raw_content` 或 `raw_origin`。质量状态只表示提取完整性和噪声检查，不是对内容事实真伪的认证。原 `/api/feed` 及问题、回答、点赞接口不变。

## 验收方法与当前结果

```bash
.venv-content/bin/python -m unittest discover -s tests -v
```

2026-09-14 本地验收：17 个自动化测试全部通过，同时覆盖内容管线、DeepSeek 输出/引用校验、来源指纹缓存、无证据短路与 AI/legacy API 回归。完整 AI 验收和真实调用记录见 `AI_INTEGRATION.md`。

两条真实 URL 都已使用本管线实际请求，均在首次尝试收到 HTTP 403，记录为 `blocked`、未重试、未进入展示库：

- `https://www.zhihu.com/question/651409603/answer/3466677972`
- `https://www.zhihu.com/question/1917945141651531276/answer/1918321647406015688`

因此，当前实际跑通的输入是操作者指定的本地 HTML 和来源 JSON；真实公开 URL 采集成功数为 0，被阻断数为 2。测试夹具均在 `tests/fixtures/` 中明确标记为合成测试数据，不可当作真实采集成功。
