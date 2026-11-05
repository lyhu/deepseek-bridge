#!/usr/bin/env node

/**
 * DeepSeek Web to API Bridge - Chrome Native Messaging Host
 * 供 Chrome 扩展静默拉起，作为底层 HTTP 本地网关 (127.0.0.1:8765)
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');

const PORT = process.env.PORT || 8765;
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get(['/', '/playground'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 维护与 Chrome 扩展的双向通信与任务队列
const pendingRequests = new Map();
const taskQueue = [];
let isProcessingQueue = false;

// Native Messaging 发送消息给 Chrome 扩展 (4字节小端长度头 + JSON)
function sendNativeMessage(msg) {
  try {
    const jsonStr = JSON.stringify(msg);
    const bodyBuf = Buffer.from(jsonStr, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(bodyBuf.length, 0);
    process.stdout.write(headerBuf);
    process.stdout.write(bodyBuf);
  } catch (err) {
    // 忽略发送异常
  }
}

// 串行队列控制
function processNextTask() {
  if (isProcessingQueue || taskQueue.length === 0) return;
  isProcessingQueue = true;
  const nextTask = taskQueue.shift();
  nextTask().finally(() => {
    setTimeout(() => {
      isProcessingQueue = false;
      processNextTask();
    }, 300);
  });
}

function enqueueTask(taskFn) {
  taskQueue.push(taskFn);
  processNextTask();
}

// 模型定义
const SUPPORTED_MODELS = [
  {
    id: 'deepseek-reasoner',
    object: 'model',
    created: 1700000000,
    owned_by: 'deepseek',
    permission: [],
    root: 'deepseek-reasoner',
    parent: null
  },
  {
    id: 'deepseek-chat',
    object: 'model',
    created: 1700000001,
    owned_by: 'deepseek',
    permission: [],
    root: 'deepseek-chat',
    parent: null
  }
];

// 健康检测接口
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'native-host',
    pendingRequests: pendingRequests.size,
    queuedTasks: taskQueue.length,
    timestamp: new Date().toISOString()
  });
});

// 模型列表
app.get('/v1/models', (req, res) => {
  res.json({ object: 'list', data: SUPPORTED_MODELS });
});

app.get('/v1/models/:model', (req, res) => {
  const modelId = req.params.model;
  const found = SUPPORTED_MODELS.find(m => m.id === modelId);
  res.json(found || { id: modelId, object: 'model', created: 1700000000, owned_by: 'deepseek' });
});

// 对话补全接口
app.post('/v1/chat/completions', (req, res) => {
  const {
    messages = [],
    stream = false,
    model = 'deepseek-chat',
    thinking,
    search,
    web_search
  } = req.body;

  const isThinkingEnabled = typeof thinking === 'boolean'
    ? thinking
    : (model.toLowerCase().includes('reasoner') || model.toLowerCase().includes('r1'));

  const isSearchEnabled = typeof web_search === 'boolean'
    ? web_search
    : (typeof search === 'boolean' ? search : true);

  // 兼容 OpenAI 的 content 数组格式 (如 [{type:'text',text:'...'}])
  function normalizeContent(c) {
    if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
    return c == null ? '' : String(c);
  }

  const prompt = messages
    .map(m => {
      const text = normalizeContent(m.content);
      if (m.role === 'system') return `[指令要求]\n${text}`;
      return text;
    })
    .join('\n\n');

  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  let isCanceled = false;
  let currentResolveQueue = null;

  res.on('close', () => {
    if (!res.writableEnded) {
      isCanceled = true;
      const ctx = pendingRequests.get(requestId);
      if (ctx) {
        if (ctx.timer) clearTimeout(ctx.timer);
        pendingRequests.delete(requestId);
        if (typeof ctx.resolveQueue === 'function') ctx.resolveQueue();
      } else if (currentResolveQueue) {
        currentResolveQueue();
      }
    }
  });

  enqueueTask(() => {
    return new Promise((resolveQueue) => {
      currentResolveQueue = resolveQueue;
      if (isCanceled || res.writableEnded) return resolveQueue();

      const timeoutMs = parseInt(process.env.REQUEST_TIMEOUT || '180000', 10);
      const timer = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          if (!res.writableEnded) {
            const timeoutSec = Math.round(timeoutMs / 1000);
            if (stream) {
              res.write(`data: ${JSON.stringify({ error: { message: `DeepSeek 响应超时 (${timeoutSec}s)` } })}\n\n`);
              res.end();
            } else {
              res.status(504).json({ error: { message: `DeepSeek 响应超时 (${timeoutSec}s)` } });
            }
          }
          pendingRequests.delete(requestId);
          resolveQueue();
        }
      }, timeoutMs);

      pendingRequests.set(requestId, { res, stream, model, timer, resolveQueue });

      // 发送任务给 Chrome 扩展
      sendNativeMessage({
        type: 'TRANSLATE_TASK',
        requestId,
        prompt,
        thinking: isThinkingEnabled,
        search: isSearchEnabled
      });
    });
  });
});

// 处理来自 Chrome 扩展的消息
function handleMessageFromExtension(data) {
  if (!data) return;

  if (data.type === 'PING') {
    sendNativeMessage({ type: 'PONG' });
    return;
  }

  const { requestId, chunk, text, done, error } = data;
  const reqCtx = pendingRequests.get(requestId);
  if (!reqCtx) return;

  if (error) {
    if (!reqCtx.res.writableEnded) {
      if (reqCtx.stream) {
        reqCtx.res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
        reqCtx.res.end();
      } else {
        reqCtx.res.status(500).json({ error: { message: error } });
      }
    }
    if (reqCtx.timer) clearTimeout(reqCtx.timer);
    pendingRequests.delete(requestId);
    reqCtx.resolveQueue();
    return;
  }

  // 流式增量
  if (chunk && reqCtx.stream && !reqCtx.res.writableEnded) {
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

  // 任务完成
  if (done) {
    if (!reqCtx.res.writableEnded) {
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
            message: { role: 'assistant', content: text || '' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        });
      }
    }
    if (reqCtx.timer) clearTimeout(reqCtx.timer);
    pendingRequests.delete(requestId);
    reqCtx.resolveQueue();
  }
}

// 启动 HTTP 服务
const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => {
  // 向 Chrome 报告服务启动就绪
  sendNativeMessage({
    type: 'HOST_READY',
    port: PORT,
    message: `本地网关已启动: http://127.0.0.1:${PORT}`
  });
});

// Native Messaging 输入流解析（处理粘包与分包）
let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length >= 4) {
    const msgLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLength) {
      // 报文尚未接收完整，等待后续 chunk
      break;
    }

    const msgBytes = inputBuffer.slice(4, 4 + msgLength);
    inputBuffer = inputBuffer.slice(4 + msgLength);

    try {
      const msgObj = JSON.parse(msgBytes.toString('utf8'));
      handleMessageFromExtension(msgObj);
    } catch (e) {
      // 忽略无法解析的报文
    }
  }
});

// 当 Chrome 扩展断开连接（如浏览器关闭或点击停止）时，自动退出并释放端口
process.stdin.on('end', () => {
  server.close(() => {
    process.exit(0);
  });
  // 500ms 强制保护退出
  setTimeout(() => process.exit(0), 500);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
