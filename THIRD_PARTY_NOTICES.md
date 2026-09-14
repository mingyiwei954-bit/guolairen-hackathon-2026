# 内容管线第三方依赖说明

本轮直接使用两个开源包：

- [HTTPX 0.28.1](https://github.com/encode/httpx)，BSD-3-Clause License，Copyright © 2019 Encode OSS Ltd.
- [Trafilatura 2.2.0](https://github.com/adbar/trafilatura)，Apache License 2.0。

安装后，完整许可证文本位于对应 Python 环境的 `*.dist-info/licenses/` 目录。间接依赖及确切版本见 `requirements-content.lock`。

Crawl4AI 仅作为后续动态页面适配器候选，本轮未安装、未引入浏览器运行环境。`wycm/zhihu-crawler` 未被集成。
