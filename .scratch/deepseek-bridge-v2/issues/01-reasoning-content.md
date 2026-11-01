# Issue 01: 思考链透明流式透传 (Reasoning Content)

Type: task
Status: open

## 任务目标
1. 在 `injected.js` 中当处于 `THINK` 模式时，将思考增量块标记为 `{ chunk, isReasoning: true }` 并回传。
2. 在 `server.js` 中，当客户端传入 `include_reasoning: true` 或调用 `deepseek-reasoner` 时，将思考增量以 `choices[0].delta.reasoning_content` 的 SSE chunk 推送给客户端。
3. 保证不支持思考链的客户端继续接收纯净正文，支持思考链的客户端可折叠展示推演过程。
