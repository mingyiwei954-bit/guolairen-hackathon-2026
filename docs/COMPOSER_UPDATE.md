# 提问页与多阶段目标（2026-09-14）

本轮改版在现有过来人频道内完成。加号继续进入频道提问页，不新增推荐频道、登录或模型功能。

## 接口

`POST /api/questions` 使用 `{"title":"工作以后如何交朋友？","body":"","targets":["working","retired"]}`。目标最少一个、最多六个，服务端按固定阶段顺序去重规范化。旧 `target` 单值仍支持；同时提供两个字段时以 `targets` 为准。

`GET /api/feed` 和 `GET /api/questions/{id}` 同时返回 `targets` 和旧 `target`。旧字段代表规范化后的首个目标。目标表示希望谁回答，其他阶段仍可回答。

六个阶段为 `primary / middle / secondary / college / working / retired`。已有题目在启动时回填到 `question_targets`，原始题目、回答和点赞不改写。执行新版本前使用 SQLite backup 保存数据库；不要用本地数据库覆盖线上数据库。

## 交互

选择“# 想听谁说”在页面内展开候选，允许连续多选，选择“完成”收起。已选目标以小标签展示并可移除。首页固定标签列显示首项和额外数量，详情显示全部目标。

普通提问与 AI 追问转提问分别保存草稿。发布仍需明确点击；失败保留输入。正常保存后清理相应草稿，详情读取失败与发布失败分别处理。

## 验证和本地运行

后端新增六项多阶段请求与迁移测试，沿用完整测试命令：

```sh
.venv-content/bin/python -m unittest discover -s tests -v
APP_PORT=5174 .venv-content/bin/python server.py
```

本轮改版前源码、补丁、页面截图和数据库快照保存在集成人工作目录 `outputs/composer-polish/baseline-20260914T204416/`。浏览器发布验收使用独立 QA 数据库；具体检查结果记录在同级 `ACCEPTANCE.md`。本轮不会自动部署到公网。
