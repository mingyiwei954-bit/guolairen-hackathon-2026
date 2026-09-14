# 知乎登录接入与初始化

本项目继续使用 Python、SQLite 和 HTTPX，不覆盖已有前端。2026-09-14 安装官方 zhihu-hackathon Skill 到 ~/.codex/skills/zhihu-hackathon，来源 https://zhstatic.zhihu.com/skill/zhihu-hackathon-skill_v2026s2.zip。

官方初始化包附带 zhihu Skill 0.2.1 和 Node 空白模板；本项目已经存在，生成器要求空目录，因此不在主项目运行覆盖式生成器，不降级已安装的 zhihu 0.7.2。保留 hackathon.config.json 公开元数据，按当前 Skill 的 hackathon-oauth.md 和 hackathon-user-profile-api.md 适配现有后端。CLI 已安装且 compatible=true，Access Secret 已配置于钥匙串，现有内容能力不重复初始化。

## 配置与运行

本地 App Key 已通过官方 set_app_key.mjs 的交互标准输入存入 macOS 钥匙串。凭据服务名见 hackathon.config.json。服务端优先使用环境变量，其次 ZHIHU_OAUTH_ENV_FILE 指定的文件（默认 ~/.config/zhihu-hackathon/oauth.env）；缺少 Key 时本机读取钥匙串。配置文件不能放入代码包。

变量：ZHIHU_OAUTH_APP_ID、ZHIHU_OAUTH_APP_KEY、ZHIHU_OAUTH_REDIRECT_URI。当前 App ID 为 576，登记回调为 https://zhihu.yunzhicompany.com/（含末尾斜杠），沿用官方现有登记值，无需改成模板的 /auth/callback。

运行：APP_PORT=5174 .venv-content/bin/python server.py。

接口：GET /api/auth/me 查询 enabled/configured 与本人身份；GET /api/auth/start 开始登录；根路径接收 authorization_code 和 state；POST /api/auth/logout 退出。实际 /api/auth/me 字段为 authenticated、configured、user（uid、name、avatar）。未登录 user=null。

## 状态与边界

授权前生成 10 分钟一次性 state，绑定现有访客；缺失、不匹配、跨浏览器、过期、重复回调均拒绝。网络请求不持有 SQLite 写事务。用户 ID 以字符串向前端传递，保留 int64 精度。只读取基础资料，不读取创作、关注、收藏、邮箱或手机。

OAuth Token 仅用于本次基础信息请求，随后丢弃；数据库保存最小账号信息与应用会话摘要。登录有效期不超过 Token 返回时长且最多 24 小时。退出清除当前应用登录与浏览器访客 Cookie，历史内容保留；不提供跨设备历史合并。问题卡片仍显示阶段自述。

首次登录沿用游客的阶段与本地提问记录；个人页使用独立 auth-ui.js/css，不改写其他 AI 的主交互代码。未登录点击底栏“未登录”跳到官方授权。已登录显示“我的”、昵称头像、阶段设置与退出。其他入口保持访客可用。

本地登录入口跳转公网后建立 state，真实登录只在公网进行。需用户本人完成知乎最终授权确认，模拟测试不能替代真实授权验收。

## 发布与回退

scripts/deploy_release.py 新增可选 --oauth-env，上传到 /etc/zhihu-hackathon/oauth.env，root 600，独立 systemd oauth.conf 注入。迁移仅新增四张 oauth 表；不覆盖线上问答库。发布脚本备份原数据库、代码入口、Nginx 和服务配置，失败回退代码与配置，保留增量数据库。

Nginx 为本站使用仅记录 $uri（无 Query）的日志格式，Python 日志也脱敏授权 code/state。不要在调试输出中打印授权地址完整查询或 OAuth 响应。

## 验证

.venv-content/bin/python -m unittest discover -s tests -v
node --check public/auth-ui.js
node --check public/app.js

专项 Mock 覆盖：登录/退出、UID 精度、过期/错误/缺失/跨浏览器/重复 state、取消和配置缺失、登录过期、官方业务包装、静态资源与公网入口。真实 OAuth 状态另存发布验收记录；未授权之前只声明模拟通过。
