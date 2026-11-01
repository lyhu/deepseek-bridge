# Issue 03: Token 统计与流速计量 (Usage Telemetry)

Type: task
Status: open

## 任务目标
1. 从 DeepSeek 网页端返回的 `accumulated_token_usage` 控制包中提取实际消耗的 token 数量。
2. 在流式结束 `[DONE]` 前的一个 chunk，以及非流式响应的 JSON 体中，返回规范的 `usage: { prompt_tokens, completion_tokens, total_tokens }` 对象。
3. 在日志中输出单次请求的 Token 流速（Tokens Per Second, TPS）。
