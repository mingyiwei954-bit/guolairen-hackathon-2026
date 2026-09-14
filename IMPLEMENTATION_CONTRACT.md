# 入围版本接口与协作契约

2026-09-14 用户已批准执行。主工程为当前目录；本地端口 5174，线上 zhihu.yunzhicompany.com。只由集成人提交 Git、重启服务和部署。

## 所有权

- 架构：server.py、content_pipeline/、后端 tests/、AI_INTEGRATION.md。
- ui审美：public/app.js、public/style.css；欢迎页、顶部频道与底栏结构保留。
- 知乎提示词：本文件、README、docs/、scripts/、独立验收和发布。所有人不得覆盖别人的整文件或提交别人的改动。

## 三问接口（服务端是状态事实源）

GET /api/questions/{id}/ai：取得当前访客在此问题下的记录，不调用模型。
POST 同路径，JSON：`{"question":"完整的用户追问","client_turn_id":"客户端生成的 UUID"}`。问题 1–1000 字符，client_turn_id 1–80 字符，仅字母数字、短横线与下划线。

所有正常业务响应及 busy/limit 等响应都返回下面的 snapshot；HTTP 失败前端仍应读取 JSON。字段不能自行另起名字：

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

- snapshot.status：ready / running / limit_reached / insufficient_evidence / source_unavailable。
- 每条 turns 元素包含 client_turn_id、question、status（running / answered / insufficient_evidence / failed）、answer、citations、followups、error_code、error。
- citations 沿用旧 API：document_id、quote、title、source_url、content_scope；没有年龄与阶段标签。
- POST 正常完成 HTTP 200；正在执行/模型繁忙 503；达到上限或已关闭 409；输入错误 400；问题不存在 404。后两类可只返回 error/error_code。
- 模型等失败时记录 failed turn，snapshot 回到 ready（可重试）并带 error_code/error；不扣次数。相同 client_turn_id 永远幂等返回已记录结果，不重新调用；用户主动重试须新 UUID。
- 同一访客 cookie + question_id 唯一一轮，首次未创建时 GET 直接返回空 snapshot；不同标签复用同一轮。达到三次后 can_ask=false。
- answered 与 insufficient_evidence 消耗一次；首问没有足够证据则 status=insufficient_evidence、can_ask=false，即使剩余次数仍大于零。剩余表示数值次数，不可覆盖 can_ask。
- 第一问检索 ready 资料后固定证据；后续原问题和前序用户问题仅供语境，不能作为原文证据。旧 /api/ai/answer 与 CLI 保持兼容。
- 来源有效性每轮校验；GET 不可返回已撤回来源的引用，无法继续时 status=source_unavailable、can_ask=false。
- 网络等待不持有写事务；原子占位、三问限制、client_turn_id 唯一索引。模型并发仍为 1，每次任务最多两次模型请求，只允许一次输出修复。
- 服务启动时将遗留 running 任务标为 interrupted 失败，不自动重发、不扣次数。主项目只运行一个进程，测试使用隔离库。

## 前端约定

- 详情按“问题→阶段筛选→真人回答→折叠资料三问”组织，阶段默认全部，只列有回答阶段。
- 进入详情前保存 feed 的 mode/stage、首可见 questionId、卡片相对视口偏移、scrollTop、筛选显示状态和焦点。返回先恢复布局、再恢复位置、最后绑定滚动监听。
- 打开资料区只 GET。显式点击发送 POST；请求中禁用该发送按钮。离开后不把旧响应写到另一个问题。
- 刷新/返回通过 GET 恢复；running 时允许有限轮询 GET 恢复状态（2 秒一次，最长 150 秒），绝不自动重发 POST。手动“检查结果”可再次 GET。
- 草稿/浏览状态可放 sessionStorage；模型配置不得进入前端。
- 第三次完成，或首问资料不足后，显示“带着这个问题问大家”；选择用户自己的一条追问带入现有提问表单，超 100 字要求编辑、不截断，取消返回原详情，显式发布才写入。
- 正文最多问题 2 行/代表答案 4 行；标签固定列内排版。滚动结束 160ms 后，将筛选进度按 >=0.5 展开、<0.5 收起，隐藏时 inert/不可点击且不留空位；保留滚动过程渐隐与恢复位置补偿。减少动态效果模式下直接切换。
- 不引入登录、真人追问房间、评论、支付、限时过期、新导航或新框架。

## 交接

架构先实现接口与模拟测试，ui审美可按本契约用模拟响应开发，最后共同对真实服务联调。完成后把修改范围、运行命令、验证结果和未验证项发送回知乎提示词任务。不要自行部署或操作主库制造测试数据。

## 2026-09-14 提问页与多阶段补充

- 发布属于过来人频道，其他频道不新增发布入口。前端为原位展开的阶段多选标签，最少一个、最多六个；用户点击完成收起，不在第一次选择后收起。
- POST /api/questions 新增 targets 数组，同时存在时优先于旧 target。去重、验证后保存；旧 target 请求继续可用。GET feed/detail 返回 targets 并保留 target（首项）。阶段表达回答偏好，不作为回答权限。
- SQLite 通过 question_targets 增量保存并回填旧问题。无匹配回答时，任一目标命中当前阶段筛选即进入 feed；真人回答代表项及排序维持原逻辑。
- 首页标签列仅显示首个目标及“另 N 个阶段”，详情显示全部；不可扩大固定标签列挤占正文。
- 普通发布和 AI 转提问分别保存草稿，包含标题、背景和阶段；取消保留，发布成功清除。切换 AI 追问时不使用另一个追问的旧草稿覆盖新句。
- 顶栏发布按钮关联同一表单，提交中必须禁用；成功写入与详情刷新错误分别反馈。
- 本轮仅本地开发和隔离库验收，由集成人完成快照与重启；不部署、不修改已提交的线上项目。

## 轻量发布页补充（覆盖前版必选规则）

- 新提问stage与targets默认均为空；targets允许0–6项，stage可显式null/空字符串，不修改访客阶段。
- 方向保存在草稿中，仅限制已填写自我阶段时的候选；未知自我阶段时可选全部。
- 不限目标且尚无回答的问题可进入两个方向，已有回答按原阶段规则筛选；空标签不显示。
- 当前发布页去掉字段聚焦亮边和标签底色，返回仅箭头，顶部发布带纸飞机；完成按钮位于候选下方普通文档流。
