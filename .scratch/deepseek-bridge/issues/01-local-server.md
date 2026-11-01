# Issue 01: 本地网关服务端开发

Type: task
Status: resolved

## 任务目标
实现 `local-server/` 目录下的服务端代码：
1. `package.json`：配置 dependencies (`express`, `cors`, `ws`) 与启动脚本。
2. `server.js`：
   - 串行任务队列与 300ms 人工间隔模拟（修复状态机冷却锁问题）。
   - WebSocket `/ws` 端点监听与心跳/响应处理。
   - `GET /v1/models` 模型列表。
   - `POST /v1/chat/completions` 支持流式 (SSE) 与普通 JSON。
   - `GET /health` 健康检测。
   - 客户端连接断开时清理监听（通过 `res.on('close')` 正确识别）。

## 交付产物
- `local-server/package.json`
- `local-server/server.js`

## 验证结果
已通过集成测试套件验证，接口与队列状态全部正常。
