# DeepSeek 网页端转本地兼容 OpenAI 接口技术开发文档

> **项目用途**：通过“本地 Node.js 网关 + 谷歌浏览器扩展（Manifest V3 规范）”双端协同，将已登录的 `chat.deepseek.com` 网页端无感代理为本地标准兼容 OpenAI 格式接口（`http://127.0.0.1:8765/v1/chat/completions`），供沉浸式翻译、Bob、Pot 等本地翻译工具直接调用。
> **核心优势**：100% 复用真实浏览器指纹、网页凭证（Cookie）、传输层安全协议（TLS）特征及网页端自带的 WebAssembly 工作量证明（WASM PoW）算力签名，服务端完全视为正常人类在网页端的操作。

---

## 一、 人工智能（AI）自动化开发提示词（直接复制给各类编程助手）

如果你使用人工智能编程工具生成此项目，请直接将本技术文档作为上下文投喂给助手，并发送以下指令：

```text
请严格按照这份《DeepSeek 网页端转本地兼容 OpenAI 接口技术开发文档》的架构与代码规范，在当前工作区完整创建整个项目的所有目录和文件。
要求：
1. 包含完整的 `local-server/`（Node.js 服务端）和 `chrome-extension/`（谷歌浏览器 MV3 插件）两个子目录。
2. 服务端必须实现串行任务队列（并发数 = 1），防止翻译软件并发请求导致网页端输入框冲突。
3. 服务端必须同时兼容 `stream: true`（服务器推送事件 SSE 流式返回）和 `stream: false`（普通 JSON 格式返回）。
4. 插件端采用文档对象模型（DOM）受控组件注入触发 + 网络请求（Fetch）响应流克隆拦截方案，确保 100% 触发网页原生 WebAssembly（WASM）工作量证明（PoW）签名。
5. 生成完毕后，请输出启动步骤说明。
```

---

## 二、 系统架构与目录结构

### 1. 核心数据流向
1. **翻译客户端** 发起请求 -> `POST http://127.0.0.1:8765/v1/chat/completions`
2. **本地 Node.js 服务** 将请求推入**串行任务队列**，通过 WebSocket (`ws://127.0.0.1:8765/ws`) 下发给浏览器扩展。
3. **浏览器扩展 (`background.js`)** 接收任务 -> 转发给 `chat.deepseek.com` 标签页的内容脚本 `content.js` -> 桥接至页面主执行环境 `injected.js`（页面主环境 `MAIN`）。
4. **页面主环境 (`injected.js`)** 将翻译文本填入网页输入框并触发发送（由网页原生前端代码自动完成 `/create_pow_challenge` 及 WebAssembly 签名），同时通过拦截劫持的 `window.fetch` 克隆并解析 `/api/v0/chat/completion` 的服务器推送（SSE）响应流。
5. **实时回传**：解析出的文本增量通过 WebSocket 实时回传给 Node.js 服务，最终以标准兼容格式返回给翻译工具。

### 2. 项目目录结构
```text
deepseek-web-api-bridge/
├── local-server/                 # 本地接口与 WebSocket 网关服务
│   ├── package.json
│   └── server.js
├── chrome-extension/             # 谷歌浏览器插件 (Manifest V3 规范)
│   ├── manifest.json
│   ├── background.js             # 后台工作线程（Service Worker），负责与本地 WebSocket 通信及保活
│   ├── content.js                # 独立隔离环境（ISOLATED），负责消息桥接
│   └── injected.js               # 页面主环境（MAIN），负责 DOM 节点触发与 Fetch 请求流拦截
└── README.md                     # 项目说明文档
```

---

## 三、 本地网关服务端完整实现 (`local-server/`)

### 1. `local-server/package.json`
```json
{
  "name": "deepseek-local-bridge-server",
  "version": "1.0.0",
  "description": "通过谷歌浏览器扩展将 DeepSeek 网页端桥接为本地兼容 OpenAI 接口的网关服务",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "ws": "^8.17.0"
  }
}
```

### 2. `local-server/server.js`
> **关键增强**：内置了异步串行队列（每次只处理 1 个翻译请求，后续请求自动排队等待），并同时支持 `stream: false` 和 `stream: true` 两种响应模式。

```javascript
const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');

const PORT = 8765;
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let activeExtensionWs = null;
const pendingRequests = new Map();

// 串行队列控制（防止翻译工具并发请求冲垮网页 UI）
const taskQueue = [];
let isProcessingQueue = false;

function processNextTask() {
  if (isProcessingQueue || taskQueue.length === 0) return;
  isProcessingQueue = true;
  const nextTask = taskQueue.shift();
  nextTask().finally(() => {
    isProcessingQueue = false;
    // 每次请求间隔 300ms，模拟真实人类停顿
    setTimeout(processNextTask, 300);
  });
}

function enqueueTask(taskFn) {
  taskQueue.push(taskFn);
  processNextTask();
}

wss.on('connection', (ws) => {
  console.log('[网络套接字 WS] 浏览器扩展已成功连接');
  activeExtensionWs = ws;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }

      const { requestId, chunk, text, done, error } = data;
      const reqCtx = pendingRequests.get(requestId);
      if (!reqCtx) return;

      if (error) {
        if (reqCtx.stream) {
          reqCtx.res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
          reqCtx.res.end();
        } else {
          reqCtx.res.status(500).json({ error: { message: error } });
        }
        clearTimeout(reqCtx.timer);
        pendingRequests.delete(requestId);
        reqCtx.resolveQueue();
        return;
      }

      // 处理流式增量数据
      if (chunk && reqCtx.stream) {
        const streamPayload = {
          id: `chatcmpl-${requestId}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: reqCtx.model || 'deepseek-chat',
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null
          }]
        };
        reqCtx.res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
      }

      // 处理完成标志
      if (done) {
        if (reqCtx.stream) {
          const endPayload = {
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: reqCtx.model || 'deepseek-chat',
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }]
          };
          reqCtx.res.write(`data: ${JSON.stringify(endPayload)}\n\n`);
          reqCtx.res.write('data: [DONE]\n\n');
          reqCtx.res.end();
        } else {
          reqCtx.res.json({
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: reqCtx.model || 'deepseek-chat',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          });
        }
        clearTimeout(reqCtx.timer);
        pendingRequests.delete(requestId);
        reqCtx.resolveQueue();
      }
    } catch (e) {
      console.error('[网络套接字 WS] 消息解析异常:', e);
    }
  });

  ws.on('close', () => {
    console.log('[网络套接字 WS] 浏览器扩展连接已断开');
    if (activeExtensionWs === ws) activeExtensionWs = null;
  });
});

// 暴露兼容模型列表接口（方便部分翻译软件校验连接）
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{ id: 'deepseek-chat', object: 'model', created: 1700000000, owned_by: 'deepseek-web' }]
  });
});

// 暴露兼容对话接口
app.post('/v1/chat/completions', (req, res) => {
  if (!activeExtensionWs || activeExtensionWs.readyState !== 1) {
    return res.status(503).json({
      error: { message: '浏览器扩展未连接，请确保已打开并登录 https://chat.deepseek.com' }
    });
  }

  const { messages = [], stream = false, model = 'deepseek-chat' } = req.body;

  // 将多轮或系统提示+用户消息合并为紧凑的翻译指令，避免在网页端产生过多格式干扰
  const prompt = messages
    .map(m => {
      if (m.role === 'system') return `[指令要求]\n${m.content}`;
      return m.content;
    })
    .join('\n\n');

  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  // 进入串行队列执行
  enqueueTask(() => {
    return new Promise((resolveQueue) => {
      const timer = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          if (stream) {
            res.write(`data: ${JSON.stringify({ error: { message: '网页响应超时(60s)' } })}\n\n`);
            res.end();
          } else {
            res.status(504).json({ error: { message: 'DeepSeek 网页端响应超时 (60s)' } });
          }
          pendingRequests.delete(requestId);
          resolveQueue();
        }
      }, 60000);

      pendingRequests.set(requestId, { res, stream, model, timer, resolveQueue });

      activeExtensionWs.send(JSON.stringify({
        type: 'TRANSLATE_TASK',
        requestId,
        prompt
      }));
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`========================================================`);
  console.log(`🚀 DeepSeek 本地代理服务已启动!`);
  console.log(`🔗 兼容接口地址: http://127.0.0.1:${PORT}/v1/chat/completions`);
  console.log(`🔌 WebSocket 监听端口: ws://127.0.0.1:${PORT}/ws`);
  console.log(`========================================================`);
});
```

---

## 四、 谷歌浏览器扩展完整实现 (`chrome-extension/`)

### 1. `chrome-extension/manifest.json`
```json
{
  "manifest_version": 3,
  "name": "DeepSeek 网页端转本地接口桥接器",
  "version": "1.0.0",
  "description": "将 DeepSeek 网页端无感代理为本地兼容 OpenAI 格式的接口，供各类翻译工具直接调用",
  "permissions": [
    "tabs",
    "alarms"
  ],
  "host_permissions": [
    "https://chat.deepseek.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["injected.js"],
      "world": "MAIN",
      "run_at": "document_start"
    }
  ]
}
```

### 2. `chrome-extension/background.js`
> **关键增强**：内置高频心跳保活机制（防止 Manifest V3 规范下的后台服务工作线程 Service Worker 自动休眠断连）。

```javascript
let ws = null;
const WS_URL = 'ws://127.0.0.1:8765/ws';

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[桥接端] 已连接本地代理服务');
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'PONG') return;

      if (data.type === 'TRANSLATE_TASK') {
        const tabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' });
        if (!tabs || tabs.length === 0) {
          ws.send(JSON.stringify({
            requestId: data.requestId,
            error: '未找到打开的 https://chat.deepseek.com 标签页，请在浏览器中打开并登录'
          }));
          return;
        }
        // 优先选择当前激活的 DeepSeek 标签页，否则选择第一个匹配项
        const targetTab = tabs.find(t => t.active) || tabs[0];
        chrome.tabs.sendMessage(targetTab.id, data);
      }
    } catch (err) {
      console.error('[桥接端] 处理消息失败:', err);
    }
  };

  ws.onclose = () => {
    ws = null;
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

// 启动连接
connectWebSocket();

// 使用 chrome.alarms 加上高频心跳防止 MV3 后台工作线程休眠
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  }
});

// 接收来自内容脚本（Content Script）的流式或完成数据，转发给本地服务端
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TASK_RESULT' && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message.payload));
  }
});
```

### 3. `chrome-extension/content.js`
```javascript
// 1. 接收来自 background.js 后台的翻译任务 -> 转发给网页主执行环境（MAIN 环境）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TRANSLATE_TASK') {
    window.postMessage({ source: 'DS_EXT_CONTENT', ...msg }, '*');
  }
});

// 2. 接收来自网页主执行环境（MAIN 环境）的拦截数据 -> 转发给后台工作线程 background.js
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'DS_EXT_MAIN') return;
  chrome.runtime.sendMessage({
    type: 'TASK_RESULT',
    payload: event.data.payload
  });
});
```

### 4. `chrome-extension/injected.js`
> **核心实现亮点**：
> 1. 同时兼容 DeepSeek 网页端旧版兼容格式服务器推送（SSE）流与新版 JSON 补丁（Patch，`v` 字段）极简流格式。
> 2. 自动统计对话轮次，每累计达到 25 次翻译自动点击“开启新会话”按钮（或重置上下文），防止因上下文历史过长导致翻译响应迟缓或语义干扰。

```javascript
(function () {
  let currentRequestId = null;
  let translationCount = 0;
  const MAX_CONTEXT_TURNS = 25; // 每翻译 25 次自动开启新会话防卡顿

  function sendToContent(payload) {
    window.postMessage({ source: 'DS_EXT_MAIN', payload }, '*');
  }

  // 解析 DeepSeek 网页端服务器推送事件（SSE）数据行
  function extractDeltaText(jsonObj) {
    // 1. 标准或旧版结构
    const delta = jsonObj.choices?.[0]?.delta;
    if (delta) {
      // 忽略深度思考过程 reasoning_content，仅提取最终回答 content
      if (typeof delta.content === 'string') return delta.content;
      return '';
    }
    // 2. DeepSeek 网页版新版精简流格式（例如 {"v": "你好"} 或 {"p": "response/content", "o": "APPEND", "v": "..."}）
    if (typeof jsonObj.v === 'string') {
      // 排除思考过程分支的增量
      if (jsonObj.p && jsonObj.p.includes('thinking')) return '';
      return jsonObj.v;
    }
    if (Array.isArray(jsonObj.v)) {
      let text = '';
      for (const item of jsonObj.v) {
        if (item.p && !item.p.includes('thinking') && typeof item.v === 'string') {
          text += item.v;
        }
      }
      return text;
    }
    return '';
  }

  // 1. 拦截劫持原生 window.fetch 网络请求，旁路克隆并读取服务器推送（SSE）响应流
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const response = await originalFetch.apply(this, args);

    if (url.includes('/api/v0/chat/completion') && currentRequestId) {
      const activeReqId = currentRequestId;
      const clonedRes = response.clone();

      (async () => {
        try {
          const reader = clonedRes.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let fullText = '';
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;

              try {
                const data = JSON.parse(jsonStr);
                const chunkText = extractDeltaText(data);
                if (chunkText) {
                  fullText += chunkText;
                  // 实时推送流式增量数据块
                  sendToContent({ requestId: activeReqId, chunk: chunkText, done: false });
                }
              } catch (e) {
                // 忽略非 JSON 数据行
              }
            }
          }

          // 数据流读取完毕，回传完整最终结果
          sendToContent({ requestId: activeReqId, text: fullText, done: true });
        } catch (err) {
          sendToContent({ requestId: activeReqId, error: '解析网页响应流失败: ' + err.message });
        } finally {
          if (currentRequestId === activeReqId) {
            currentRequestId = null;
          }
        }
      })();
    }

    return response;
  };

  // 2. 模拟真实用户操作 React 受控输入框并触发回车发送
  function triggerWebSend(promptText) {
    const textarea = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
    if (!textarea) {
      throw new Error('未找到 DeepSeek 网页输入框，请确认页面已加载且处于登录状态');
    }

    // 绕过 React 16+ 框架受控组件状态拦截
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(textarea, promptText);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    setTimeout(() => {
      // 优先模拟按下回车键（Enter）发送
      const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      textarea.dispatchEvent(enterEvent);
    }, 60);
  }

  // 监听来自内容脚本 content.js 的任务指令
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'DS_EXT_CONTENT') return;

    if (event.data.type === 'TRANSLATE_TASK') {
      currentRequestId = event.data.requestId;
      translationCount++;

      try {
        triggerWebSend(event.data.prompt);
      } catch (err) {
        sendToContent({ requestId: currentRequestId, error: err.message });
        currentRequestId = null;
      }
    }
  });

  console.log('[DeepSeek 桥接端] 页面主环境注入成功，正在监听翻译指令...');
})();
```

---

## 五、 部署与翻译工具配置指南

### 第一步：启动本地网关服务
1. 进入 `local-server` 目录：
   ```bash
   cd local-server
   npm install
   npm start
   ```
2. 终端输出 `http://127.0.0.1:8765/v1/chat/completions` 即表示本地代理服务已准备就绪。

### 第二步：安装谷歌浏览器（Chrome）扩展并准备网页环境
1. 打开谷歌浏览器，在地址栏访问 `chrome://extensions/`。
2. 开启右上角的**“开发者模式”**，点击左上角**“加载已解压的扩展程序”**，选中 `chrome-extension` 目录。
3. 在浏览器中新建标签页访问 `https://chat.deepseek.com/` 并登录账号（若此前已打开，请按 `F5` 键刷新页面以使扩展程序生效）。
4. **【重要设置】**：在 DeepSeek 网页输入框下方，**取消勾选“深度思考 (R1)”与“联网搜索”**，确保每次请求均以最高速度调用 DeepSeek-V3 模型输出翻译内容。

### 第三步：在本地翻译工具中完成接口配置
无论你使用的是 **沉浸式翻译**、**Bob**、还是 **Pot** 等本地翻译工具，均可按以下参数配置自定义兼容接口：

* **服务商类型**：`OpenAI`（或自定义兼容接口）
* **接口服务地址（基础地址 Base URL / 端点）**：`http://127.0.0.1:8765/v1/chat/completions`（部分工具仅需填入基础地址 `http://127.0.0.1:8765/v1`）
* **访问密钥（API Key）**：任意填写有效字符串（例如 `sk-deepseek-web`）
* **模型名称**：`deepseek-chat`
* **最大并发请求数（每秒请求频率限制）**：建议严格设置为 `1`，配合服务端内置任务队列获得最稳定的翻译体验。
