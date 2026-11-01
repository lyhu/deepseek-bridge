# Issue 02: Chrome MV3 浏览器扩展开发

Type: task
Status: resolved

## 任务目标
实现 `chrome-extension/` 目录下的 Chrome 扩展代码：
1. `manifest.json`：MV3 规范配置权限及 content_scripts (ISOLATED + MAIN)。
2. `background.js`：WebSocket 客户端维护，Alarms 心跳保活，任务下发至当前激活的 DeepSeek 页面。
3. `content.js`：双向 message 桥梁。
4. `injected.js`：MAIN 环境下劫持原生 fetch 拦截 `/api/v0/chat/completion`，解析 SSE 提取 content 增量；模拟受控组件 input 及回车事件触发发送；轮次控制（25次防卡顿）。

## 交付产物
- `chrome-extension/manifest.json`
- `chrome-extension/background.js`
- `chrome-extension/content.js`
- `chrome-extension/injected.js`

## 验证结果
已通过 Node.js 完整语法与 JSON 解析校验。
