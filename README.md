# 过来人

同一个问题，听见不同阶段的声音；借助知乎资料深入三问，再把新问题交给真实的人。

知乎黑客松 2026 校园新锐季 · 灵魂匹配局。独立 Web 体验版；手机直接浏览，电脑以手机容器展示。项目从零开发，页面借鉴知乎的频道组织方式，不是已上线的知乎站内插件。

## 体验与项目说明

- [线上体验](https://zhihu.yunzhicompany.com/)
- [产品计划书](docs/PRODUCT_PLAN.md)
- [演示脚本](docs/DEMO_SCRIPT.md)
- [接口与协作契约](IMPLEMENTATION_CONTRACT.md)
- [模型接入](AI_INTEGRATION.md) · [资料管线](CONTENT_PIPELINE.md)
- 验证状态与已知限制见 [交付检查](docs/VERIFICATION.md)。线上候选版已部署，具体核验日期与范围见交付检查。

## 本地启动

需要 Python 3.11+；前端无构建步骤。

```sh
python3.11 -m venv .venv-content
.venv-content/bin/python -m pip install -r requirements-content.lock
APP_PORT=5174 .venv-content/bin/python server.py
```

浏览器打开 http://127.0.0.1:5174/ 。SQLite 首次启动自动创建，包含明确标记的示例问题、回答与初始赞数。访客可以选择自述阶段并提交自己的内容，无需注册。

AI 使用服务端环境变量：DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL、DEEPSEEK_ENABLED；样例在 examples/deepseek.env.example。没有模型配置时，真人问答仍可使用。资料库默认为空；按 CONTENT_PIPELINE.md 导入有合法来源的 JSON，不能用合成测试夹具冒充真实资料。

```sh
.venv-content/bin/python -m unittest discover -s tests -v
node --check public/app.js
```

## 实现与边界

原生 HTML/CSS/JavaScript + Python HTTP 服务 + SQLite + HTTPX + DeepSeek。资料来自官方接口的选定摘要，经清洗、来源校验后用于检索；无批量爬虫、向量数据库或本地大模型。

示例跨阶段问答、真实访客发言、AI 根据资料整理的回答是三类不同内容。阶段为自述，不代表实名认证。真实知乎摘要未提供作者年龄或阶段时保持未知，AI 不扮演某个年龄的真人。

本版没有知乎 OAuth、真人私信、真人限时会话、支付或广告。访客 Cookie 不等于自然人身份；三问上限是同一访客在同一问题下的产品机制。

## 源码与素材

代码公开用于赛事评审与学习；公开仓库不等于授予第三方内容或形象的商业使用权。第三方依赖及素材边界见 THIRD_PARTY_NOTICES.md。不得将密钥、运行数据库或虚拟环境提交到仓库。
