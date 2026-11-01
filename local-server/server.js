const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let activeExtensionWs = null;
const pendingRequests = new Map();

// 串行队列控制（Concurrency = 1，防止并发请求冲垮网页 UI）
const taskQueue = [];
let isProcessingQueue = false;

function processNextTask() {
  if (isProcessingQueue || taskQueue.length === 0) return;
  isProcessingQueue = true;
  const nextTask = taskQueue.shift();
  nextTask().finally(() => {
    // 请求处理完毕后保持队列占用并延迟 300ms，模拟真实人类停顿并防止输入冲突
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

wss.on('connection', (ws) => {
  console.log('[WS] Chrome 扩展已成功连接');
  activeExtensionWs = ws;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }

      if (data.type === 'DEBUG_LOG') {
        console.log(`[网页扩展调试] ${data.message || ''}`, data.detail || '');
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

      // 处理流式增量数据
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

      // 处理完成标志
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
    } catch (e) {
      console.error('[WS] 消息解析异常:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Chrome 扩展连接已断开');
    if (activeExtensionWs === ws) activeExtensionWs = null;
  });

  ws.on('error', (err) => {
    console.error('[WS] 连接异常:', err);
  });
});

// 健康检查接口
app.get('/health', (req, res) => {
  const extensionConnected = Boolean(activeExtensionWs && activeExtensionWs.readyState === 1);
  res.json({
    status: 'ok',
    extensionConnected,
    pendingRequests: pendingRequests.size,
    queuedTasks: taskQueue.length,
    timestamp: new Date().toISOString()
  });
});

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

// 暴露 OpenAI 兼容模型列表接口
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: SUPPORTED_MODELS
  });
});

// 暴露单个模型查询接口
app.get('/v1/models/:model', (req, res) => {
  const modelId = req.params.model;
  const found = SUPPORTED_MODELS.find(m => m.id === modelId);
  if (found) {
    return res.json(found);
  }
  res.json({
    id: modelId,
    object: 'model',
    created: 1700000000,
    owned_by: 'deepseek'
  });
});

// 暴露 OpenAI 兼容对话接口
app.post('/v1/chat/completions', (req, res) => {
  if (!activeExtensionWs || activeExtensionWs.readyState !== 1) {
    return res.status(503).json({
      error: { message: 'Chrome 扩展未连接，请确保已打开并登录 https://chat.deepseek.com' }
    });
  }

  const {
    messages = [],
    stream = false,
    model = 'deepseek-chat',
    thinking,
    search,
    web_search
  } = req.body;

  // 1. 判断是否开启深度思考 (R1):
  // 优先级: 显式传 thinking 参数 > 模型名称中包含 reasoner / r1 > 默认 false
  const isThinkingEnabled = typeof thinking === 'boolean'
    ? thinking
    : (model.toLowerCase().includes('reasoner') || model.toLowerCase().includes('r1'));

  // 2. 判断是否开启联网搜索 (智能搜索):
  // 优先级: 显式传 search / web_search 参数 > 默认 true (满足用户默认开启联网搜索的需求)
  const isSearchEnabled = typeof web_search === 'boolean'
    ? web_search
    : (typeof search === 'boolean' ? search : true);

  // 将多轮或 system+user 消息合并为紧凑的翻译指令
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

  let isCanceled = false;
  let currentResolveQueue = null;

  // 客户端连接异常提前断开时，主动清理定时器并从 pendingRequests 移除，避免挂起队列
  res.on('close', () => {
    if (!res.writableEnded) {
      isCanceled = true;
      const ctx = pendingRequests.get(requestId);
      if (ctx) {
        if (ctx.timer) clearTimeout(ctx.timer);
        pendingRequests.delete(requestId);
        if (typeof ctx.resolveQueue === 'function') {
          ctx.resolveQueue();
        }
      } else if (currentResolveQueue) {
        currentResolveQueue();
      }
    }
  });

  // 进入串行队列执行
  enqueueTask(() => {
    return new Promise((resolveQueue) => {
      currentResolveQueue = resolveQueue;
      if (isCanceled || res.writableEnded) {
        return resolveQueue();
      }

      const timeoutMs = parseInt(process.env.REQUEST_TIMEOUT || '180000', 10);
      const timer = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          if (!res.writableEnded) {
            const timeoutSec = Math.round(timeoutMs / 1000);
            if (stream) {
              res.write(`data: ${JSON.stringify({ error: { message: `DeepSeek 网页端响应超时 (${timeoutSec}s)` } })}\n\n`);
              res.end();
            } else {
              res.status(504).json({ error: { message: `DeepSeek 网页端响应超时 (${timeoutSec}s)` } });
            }
          }
          pendingRequests.delete(requestId);
          resolveQueue();
        }
      }, timeoutMs);

      pendingRequests.set(requestId, { res, stream, model, timer, resolveQueue });

      try {
        activeExtensionWs.send(JSON.stringify({
          type: 'TRANSLATE_TASK',
          requestId,
          prompt,
          thinking: isThinkingEnabled,
          search: isSearchEnabled
        }));
      } catch (err) {
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        if (!res.writableEnded) {
          res.status(500).json({ error: { message: `发送指令到扩展失败: ${err.message}` } });
        }
        resolveQueue();
      }
    });
  });
});

function startServer(port = PORT, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(`========================================================`);
      console.log(`🚀 DeepSeek 本地代理服务已启动!`);
      console.log(`🎮 对话调试工作台: http://${host}:${port}/`);
      console.log(`🔗 OpenAI 接口地址: http://${host}:${port}/v1/chat/completions`);
      console.log(`🔌 WebSocket 监听: ws://${host}:${port}/ws`);
      console.log(`========================================================`);
      resolve(server);
    }).on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('启动服务失败:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  wss,
  startServer,
  pendingRequests,
  taskQueue
};
