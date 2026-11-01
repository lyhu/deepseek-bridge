# Spec: DeepSeek Web to OpenAI API Bridge

本特性通过本地 Node.js 代理服务端与 Chrome 扩展协同，将网页端 `chat.deepseek.com` 无感代理为标准的 OpenAI 兼容 API。

## 目标组件
1. `local-server/`：Express + WebSocket 服务，包含串行队列管理、OpenAI 接口兼容（流式与非流式）。
2. `chrome-extension/`：Manifest V3 扩展，负责 WebSocket 通信保活、网页 DOM 注入与 fetch 响应流拦截。
3. `test/`：端到端与模拟测试脚本，验证所有关键路径。
