# 看山回答与来源库

## 当前交互

详情页连续滚动阅读。每次进入先显示「问问看山」横向入口；点击后显示居中书写动画。真实响应到达后，将文字分段淡入。已有回答直接读取，GET、恢复和轮询不重复调用模型。刷新按钮显式生成新版本。页面离开后旧请求不会重新展开新页面。

## Agent 链路

`AnswerAgent.prepare → DeepSeek → AnswerAgent.validate → 保存 → 前端分段淡入`。

`answer_agent.py` 的 `kanshan-agent-v4` 统一管理角色、检索、输出检查。沿用单模型调用，不额外增加一轮模型等待。

- 检索最多 5,000 条 ready 来源，按文档去重，排除标记为 fiction 的故事。
- 以当前问题关键词为主；已有社区回答只影响排序，不能单独触发资料命中。
- 结合词频、标题匹配排序；从正文中选择最相关的 900 字段落窗口，每次最多 5 个来源。
- 本地没有匹配时，沿用官方联网搜索和原有缓存。
- 看山以自然第一人称表达观察，不冒充知乎官方、不编造个人经历；摘要不能冒充已读全文。
- 输出检查拒绝 HTML、Markdown 代码块、模型自行生成的 URL、未知引用 ID 和常见虚构自述；检查属于规则校验，不能保证语义事实正确。
- 保存引用时保留实际 URL、作者、资料范围、入库时间与来源 ID。没有引用时明确资料不足。

## 采集与来源

2026-09-15 本地资料库共有 **97 个去重、ready 文档，117,142 个正文字符**：

- 原有 17 个文档；
- 60 条知乎官方搜索返回的社区摘要，涵盖大学学习、工作沟通、人际边界、情绪、家庭、消费生活；
- 20 条黑客松官方故事接口返回的正文片段，标记 fiction，不作为看山事实证据；
- 知识列表再次采集的 10 条摘要与已有正文去重，仅增加来源记录。

活动接口 `knowledge/list` 与 `story/list` 可读；知识详情实测 HTTP 400，未伪造全文。故事详情使用官方 `story/{work_id}`，返回内容按 excerpt 保存，不承诺完整作品。

原始 JSON、标准化记录、采集报告在 `work/source-expansion/`（已加入 gitignore）。数据库仍为 `data/app.sqlite3`。不写入社区真人回答表。

```sh
.venv-content/bin/python scripts/collect_zhihu_library.py --db data/app.sqlite3 --out work/source-expansion/batch --cli '<已验证的 zhihu-cli 绝对路径>' --query '第一份工作 职场 沟通'
```

采集器固定调用官方活动域名，不携带 Cookie；搜索通过已配置官方 CLI，每批最多 6 个查询、每题 10 条。遇到业务接口错误停止剩余搜索。按真实来源 URL 去重，可重跑。配额有限，先使用已存快照可避免重复搜索。

## GitHub 工具调查

- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)：支持知乎，依赖浏览器登录态，项目使用限制型非商业学习许可证。本次未安装或运行其浏览器采集程序。
- [wycm/zhihu-crawler](https://github.com/wycm/zhihu-crawler)：依赖 Java、Redis、MongoDB；README 中问题、回答抓取仍列于 TODO，不适合本次限时接入。

新增独立的 MediaCrawler JSON 字段适配器，基于公开 `model/m_zhihu.py` 格式，将用户提供的知乎导出接入同一个库，无需引入其代码或运行依赖：

```sh
.venv-content/bin/python scripts/import_mediacrawler.py --file <导出.json> --db data/app.sqlite3 --out work/source-expansion/import
```

## 来源库页面

`/library.html` 支持搜索、分页、展开已收录内容与访问原始来源。标明摘要、片段、故事类型、作者。故事不会混入事实引用。

## 接口与验证

- `GET /api/questions/{id}/kanshan`：只读状态与已有答案。
- `POST /api/questions/{id}/kanshan`，`{}`：仅在没有记录时生成。
- 显式刷新：`{"refresh":true,"client_turn_id":"唯一ID","expected_generation":3}`。
- 原有并发限制、幂等、失败保留旧答案及来源校验继续有效。
- `tests/test_answer_agent.py` 检查角色、相关片段、排除虚构故事、背景不可独立命中、引用与输出格式。
- `tests/test_kanshan_reveal.cjs` 检查入口、缓存、动画、旧请求隔离与错误恢复。
- 真实 DeepSeek 联调记录保存于 `work/source-expansion/agent-live-check.json`。
