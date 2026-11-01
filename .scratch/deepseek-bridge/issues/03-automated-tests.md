# Issue 03: 自动化自测验证与套件开发

Type: task
Status: resolved

## 任务目标
构建本地完整闭环的自动化测试工具：
1. 编写 Mock WebSocket 客户端模拟 Chrome 插件行为。
2. 自动化执行以下用例并输出结果：
   - 用例 1：`GET /health` 健康检查。
   - 用例 2：`GET /v1/models` 模型列表校验。
   - 用例 3：无扩展连接时 503 异常校验。
   - 用例 4：`POST /v1/chat/completions` (stream: false) 完整 JSON 响应校验。
   - 用例 5：`POST /v1/chat/completions` (stream: true) SSE 流式传输校验。
   - 用例 6：串行队列控制与 300ms 保护间隔校验。
   - 用例 7：扩展返回错误信息时的错误传递校验。
3. 提供启动脚本与自测验证运行命令。

## 交付产物
- `test/mock-extension.js`
- `test/test-suite.js`
- `test/run-all-tests.js`
- `package.json`（支持 `npm test`）

## 验证结果
全套 21 项断言均 100% 自动化测试通过。
