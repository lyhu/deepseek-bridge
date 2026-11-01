# Issue 02: 多标签页并发调度池 (Multi-Tab Concurrency Pool)

Type: task
Status: open

## 任务目标
1. 在 `background.js` 中扫描并维护所有打开的 `chat.deepseek.com` 标签页，建立空闲标签池（`idleTabs`）。
2. 当有任务到达时，分配一个空闲标签页处理，并在任务期间标记为占用。
3. 在 `server.js` 中将并发上限 `concurrency` 设为活跃标签页数量，突破单个输入框的限制，实现真正的多请求并行并发处理。
