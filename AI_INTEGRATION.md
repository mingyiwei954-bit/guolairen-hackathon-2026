# DeepSeek 资料加工与资料问答

该实现只读取已通过质检的清洗资料。模型输出保存为独立衍生记录，不覆盖原始材料或清洗正文，也不自动写入真人问答表。

## 配置

默认安全读取 `~/.config/zhihu-hackathon/deepseek.env`；文件必须没有 group/world 权限。进程环境变量优先，也可通过 `DEEPSEEK_ENV_FILE` 选择其他配置文件。样例见 `examples/deepseek.env.example`。

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_ENABLED=1
```

密钥不进入数据库、日志、API 响应或任务输入。`GET /api/ai/status` 只返回 `enabled`、`configured`、`model`，不会调用模型。缺少密钥或设置 `DEEPSEEK_ENABLED=0` 时，原服务和资料检索仍可使用。

## 请求参数

- Base URL：`https://api.deepseek.com`
- Endpoint：`POST /chat/completions`
- Model：`deepseek-flash`
- 非流式，`thinking: {"type":"disabled"}`
- `response_format: {"type":"json_object"}`，提示词含 JSON 格式和示例
- `max_tokens: 2000`，超时 60 秒
- 单进程模型并发数 1

每个任务最多两次模型请求。第二次只在第一次输出为非法 JSON、字段不合法或引用不匹配时进行修复。超时、网络失败、认证失败、余额不足、429、空内容和截断输出均不自动反复请求。

## 资料加工

```bash
# 默认串行处理 5 条尚无当前候选的 ready 资料
.venv-content/bin/python -m content_pipeline ai-generate

# 指定资料；force 显式生成新候选
.venv-content/bin/python -m content_pipeline ai-generate --document-id 1 --limit 1
.venv-content/bin/python -m content_pipeline ai-generate --document-id 1 --force

.venv-content/bin/python -m content_pipeline ai-status --limit 20
.venv-content/bin/python -m content_pipeline ai-status --job-id 1
```

输入最多 12000 字，按段落截取并保存 `input_truncated`。候选输出包含明确的“根据资料整理”问题、回答摘要、主题、最多 3 个追问、资料 ID、与当次输入精确匹配的证据片段、模型和提示词版本。

年龄和阶段只在当前所有 `ready` 来源的身份元组唯一且一致时允许输出；否则必须为 `null`。缓存键包含正文、模型、提示词版本和当前可用来源/身份/内容范围指纹；来源被撤回后，旧候选保留在库中但不再展示。

```text
GET /api/library/items/1/derivatives
```

该接口只返回当前来源上下文指纹仍有效且已通过校验的候选。

## 资料问答

```bash
.venv-content/bin/python -m content_pipeline ai-answer '在陌生城市工作，怎样交到志同道合的朋友？'
```

```bash
curl -X POST http://127.0.0.1:5174/api/ai/answer \
  -H 'Content-Type: application/json' \
  -d '{"question":"在陌生城市工作，怎样交到志同道合的朋友？","topic":"关系与情绪"}'
```

问题长度 1–1000 字。检索使用中文二元词片和英文单词匹配，可选精确主题过滤；最多提供 5 个正文片段、合计 6000 字。AI 衍生内容不参与检索证据。无本地匹配时直接返回 `insufficient_evidence` 且模型调用数为 0。

模型只能引用本次提供的资料 ID 和原文子串。程序验证通过后才从 SQLite 回填标题、原始链接和 `content_scope`，模型无权生成来源链接。如果在线请求已占用单并发槽，API 立即返回 HTTP 503 和 `status: busy`，不阻塞 feed。

## 问题详情三问

详情页使用服务端持久化的三问接口。旧 `POST /api/ai/answer` 和 CLI 保持不变。

```text
GET /api/questions/{question_id}/ai
POST /api/questions/{question_id}/ai
```

GET 只读取当前访客 cookie 在该问题下的状态，不调用模型。尚未提问时也不会创建三问记录：

```json
{
  "question_id": 2,
  "status": "ready",
  "turns_used": 0,
  "turns_remaining": 3,
  "can_ask": true,
  "active_client_turn_id": null,
  "turns": [],
  "error_code": null,
  "error": null
}
```

POST 请求示例：

```json
{
  "question": "如果预算有限，应该先看什么？",
  "client_turn_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

- `question` 为 1–1000 字符；`client_turn_id` 为 1–80 个字母、数字、短横线或下划线。客户端每次主动重试生成新 ID。
- 同一访客 cookie 与问题只有一组三问记录。相同 `client_turn_id` 永远返回已记录结果，不会再次请求模型。
- 首问检索当时所有 `ready` 资料并冻结证据快照，后两问只复用该快照。社区原问题与此前用户问题仅作为语境，不是引用证据。
- `answered` 和 `insufficient_evidence` 消耗一次；模型忙、超时、网络或输出校验失败记录为 `failed`，但不消耗次数。第三次完成后为 `limit_reached`。
- 首问证据不足时返回 `insufficient_evidence`，`turns_used=1`、`turns_remaining=2`，但 `can_ask=false`，不会用无来源回答补位。
- 模型调用前后与每次 GET 都复核冻结来源。来源或正文被撤回时状态为 `source_unavailable`，停止继续提问；受影响的历史 AI 正文、追问和引用不会再通过 API 展示。
- 同一问题已有运行请求时，其他标签页得到 HTTP 503 和同一份 `running` snapshot；达到上限或会话关闭时得到 HTTP 409。输入错误为 400，问题不存在为 404。
- 服务启动会把遗留的 `running` 轮次标为 `failed/interrupted`，恢复到可手动重试状态；不会自动重新发送模型请求，也不会计入已用次数。

每个 `turns` 元素固定返回 `client_turn_id`、`question`、`status`、`answer`、`citations`、`followups`、`error_code`、`error`。引用仍只有 `document_id`、`quote`、`title`、`source_url`、`content_scope`，不附加或推测作者年龄与阶段。

V4 增量迁移新增 `content_ai_conversations` 与 `content_ai_conversation_turns`。原子占位和三次上限在短 SQLite 写事务内完成，模型网络等待不持有事务。

## 任务记录与错误

增量迁移版本 3 新增 `content_ai_jobs`、`content_ai_calls`，并扩展 `content_derivatives`。每次实际请求记录耗时、requested/actual model、usage、提示词版本、HTTP 状态和明确错误码。模型网络请求期间不持有 SQLite 连接或写事务。

错误码包括：`not_configured`、`disabled`、`busy`、`authentication_error`、`insufficient_balance`、`rate_limited`、`timeout`、`network_error`、`upstream_error`、`invalid_response`、`empty_content`、`truncated`、`invalid_json`、`invalid_schema`、`invalid_citations`、`unsupported_identity`、`fabricated_source`。任何失败都不新增候选记录。

## 2026-09-14 真实联调

本次使用的两条资料是通过知乎官方搜索获得的真实来源摘要，不是公开页全文采集；两条均以 `content_scope=summary` 入库，作者年龄和阶段为 `null`。之前两条公开页 URL 的 HTTP 采集仍为 403，未被这次摘要导入冒充为全文成功。

- 真实加工：资料 1，`deepseek-flash`，1 次请求，HTTP 200，573 tokens，1570ms；候选通过问题标记、身份缺省、内容范围和 3 条原文引用校验。
- 真实问答：“在陌生城市工作，怎样交到志同道合的朋友？”，`deepseek-flash`，1 次请求，HTTP 200，732 tokens，1770ms；程序验证了来自资料 1 和 2 的 4 条引用。
- 模拟验收：非法 JSON、非法引用、身份冲突、429、传输中断、空/截断输出、幂等/force、来源撤回、无证据零调用和 API 并发均有隔离测试。
