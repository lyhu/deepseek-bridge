# DeepSeek Web Bridge v0.2.0

[English](#english) | [简体中文](#简体中文)

---

## English

🎉 **DeepSeek Web Bridge v0.2.0** is officially released!  
This release introduces a zero-terminal, one-click architecture that bridges your authenticated DeepSeek Web session to a local, standard OpenAI-compatible HTTP API (`http://127.0.0.1:8765/v1/chat/completions`) for tools like **Immersive Translate**, **Bob**, **Pot**, **Chatbox**, and **NextChat**.

### ✨ Highlights & New Features

1. **Chrome Extension Control Panel (Popup UI)**
   - Dark-themed popup panel with a prominent one-click toggle to start/stop the local proxy service.
   - Real-time status indicators for both port `8765` and the DeepSeek web session.
   - Live scrolling debug log terminal with one-click log clearing and endpoint URL copying.

2. **Zero-Terminal Native Messaging Host**
   - Built on Chrome's standard Native Messaging specification.
   - Clicking [Start Service] silently launches the lightweight local gateway in the background; closing Chrome or stopping the service automatically cleans up processes and releases port `8765`—zero command-line windows needed.

3. **Double-Click Installers (macOS & Windows)**
   - OS-native one-click registration: `install.command` for macOS and `install.bat` for Windows. Registers the Native Messaging Host in seconds with a native dialog confirmation.

4. **Dedicated Background Web Instance & Isolation**
   - Automatically provisions an isolated background tab (`chat.deepseek.com/?_bridge=dedicated`), completely separating API traffic from your daily interactive chat tabs.
   - Easily bring the dedicated window to the foreground or hide it back with a single click.

5. **Deterministic Extension Key & Fixed ID**
   - Ships with a preset RSA public key in `manifest.json`, ensuring the exact same extension ID across different machines and paths, eliminating Native Messaging host permission mismatches.

6. **Interactive Web Playground & cURL Command Card**
   - Built-in visual testing workbench at `http://127.0.0.1:8765/`.
   - Real-time model switching (`deepseek-chat` / `deepseek-reasoner`), live raw SSE stream inspection, and a quick-preset cURL terminal command card with one-click copy.

7. **All-in-One Portable Green Release**
   - Pre-bundled production dependencies in a ~1.10 MB archive (`deepseek-bridge-v0.2.0-portable.zip`). End users do not need `npm install` or developer setups—just unzip and run.

---

### 📦 Asset Downloads & Quick Start

* **Recommended**: `deepseek-bridge-v0.2.0-portable.zip` (Complete portable package with pre-built server, Chrome extension, and double-click installers)
* **Extension Only**: `deepseek-extension-v0.2.0.zip` (For users who only need to load or update the Chrome extension)

#### 🚀 3-Step Setup:
1. **Load Extension**: Open Chrome at `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `chrome-extension` directory.
2. **Register Service**: Double-click `install.command` (macOS) or `install.bat` (Windows).
3. **Start & Use**: Log in to `https://chat.deepseek.com/`, open the extension popup, and click **Start Service**.
   - Configure your client with Base URL: `http://127.0.0.1:8765/v1/chat/completions` (or `http://127.0.0.1:8765/v1`), API Key: `sk-deepseek`, Model: `deepseek-chat` or `deepseek-reasoner`.

---

## 简体中文

🎉 **DeepSeek Web Bridge (v0.2.0)** 现已正式发布！  
本项目通过“本地代理服务端 + 浏览器扩展”协同架构，为沉浸式翻译、Bob、Pot、Chatbox、NextChat 等客户端工具提供免费、稳定、高精度的 DeepSeek 本地中继代理，无缝复用网页端真实浏览器指纹与原生 WASM PoW 签名。

### ✨ 核心亮点与新特性

1. **Chrome 扩展控制面板（Popup UI）**
   - 现代化暗黑风格操作面板，配备【启动/停止代理服务】大开关与 8765 端口运行状态指示灯。
   - 实时滚动调试日志终端，支持一键清空日志与一键复制 API 地址。

2. **Chrome Native Messaging 零终端静默拉起**
   - 基于 Chrome 官方标准 Native Messaging 规范，点击【启动服务】自动在后台静默拉起本地网关，关闭时自动安全回收端口，全程零命令行、零黑窗口。

3. **双击免配置安装器（OS 原生一键部署）**
   - 提供 macOS 双击执行的 `install.command` 与 Windows 双击执行的 `install.bat`，3 秒内完成系统级原生通信宿主注册并弹出原生完成提示。

4. **网页生命周期托管与专属后台实例隔离**
   - 支持 API 专属后台静默实例（`_bridge=dedicated`），自动保持会话就绪，支持一键呼出与隐藏，彻底与用户日常聊天网页物理隔离。

5. **确定性扩展公钥**
   - 预设固定 Extension Key，跨系统任何路径加载均恒定生成相同 Extension ID，彻底杜绝原生通道权限配置错位。

6. **交互式对话调试工作台（Web Playground）**
   - 访问 `http://127.0.0.1:8765/` 即可直接使用内置的对话测试工作台，支持在线模型即时切换与实时 SSE 数据包原始日志监控。
   - 预设快捷测试用例，提供 **cURL 终端命令行调用卡片** 与**一键复制**功能。

7. **一键便携式绿色打包（Portable Release）**
   - 绿色分发包仅约 1.10MB，内置预置生产依赖，终端用户完全免 `npm install`，解压即用。

---

### 📦 资产下载与快速安装指南

* **推荐下载**：`deepseek-bridge-v0.2.0-portable.zip`（全套绿色开箱即用便携包，包含插件、网关服务端与双击安装脚本）
* **插件单独包**：`deepseek-extension-v0.2.0.zip`（供仅需安装或更新 Chrome 扩展程序的用户使用）

#### 快速使用 3 步走：
1. **安装 Chrome 扩展**：解压便携包，进入 Chrome `chrome://extensions/` 开启开发者模式，点击【加载已解压的扩展程序】选择 `chrome-extension` 目录。
2. **注册系统服务**：macOS 用户双击 `install.command`，Windows 用户双击 `install.bat`。
3. **启动代理**：浏览器中登录 `chat.deepseek.com`，点击扩展图标上的【启动服务】大开关即可！
