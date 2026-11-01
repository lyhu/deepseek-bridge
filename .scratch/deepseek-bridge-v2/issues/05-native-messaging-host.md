# Issue 05: Chrome Native Messaging 宿主服务与一键安装器

Type: task
Status: resolved

## 任务目标
1. 实现 `local-server/native-host.js` 遵循 Chrome 官方 4 字节长度头通信协议。
2. 实现 `local-server/run-native-host.sh` 自动探查系统的 Node.js 运行时。
3. 提供双击即可运行的 `install.command`（Mac）与 `install.bat`（Windows）。
4. 在 `manifest.json` 中配置固定公钥 Key，确保 Extension ID 在所有机器恒定为 `oghpkkcfomnabdlcjpcgpknjekghlbgn`。

## 验证结果
通过 `test/test-native-host-protocol.js` 自动化测试，验证握手、HTTP 请求转发、SSE 流式回传与 stdin 自动退出全部通过。
