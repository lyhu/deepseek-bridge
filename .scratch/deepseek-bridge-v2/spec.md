# Spec: DeepSeek Web Bridge V0.2 增强规范

本特性为 DeepSeek Web Bridge 的第二个功能迭代里程碑（V0.2），主要聚焦于多标签并发吞吐、深度思考链透明透传、Token 消耗统计以及可视化操作面板。

## 目标组件
1. `chrome-extension/`：
   - 增加 `reasoning_content` 分离回传
   - 增加多标签页识别与任务分发池
   - 增加 `popup.html` 与 `popup.js` 交互面板
2. `local-server/`：
   - 升级并发队列为动态并发池（Concurrency = N）
   - 支持 `reasoning_content` 的 SSE 包装
   - 完善 `usage` Token 统计对象返回
