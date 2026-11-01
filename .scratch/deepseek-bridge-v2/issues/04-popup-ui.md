# Issue 04: Chrome 扩展可视化面板 (Extension Popup UI)

Type: task
Status: resolved

## 任务目标
1. 在 `chrome-extension/manifest.json` 中配置 `action: { default_popup: "popup/popup.html" }`。
2. 创建 `popup.html`、`popup.css` 与 `popup.js`，展示：
   - 本地服务端连接状态指示与一键启动/停止大开关。
   - DeepSeek 标签页状态指示灯与一键打开/聚焦按钮。
   - 一键复制 API 地址（`http://127.0.0.1:8765/v1`）。
   - 实时滚动调试日志框（支持清空日志）。

## 验证结果
已创建完成并通过语法与离线加载校验。
