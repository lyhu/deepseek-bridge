const http = require('http');
const { MockExtension } = require('./mock-extension');

const DEFAULT_PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 8798;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    let bodyStr = null;
    if (body) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });
    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function requestStream(options, body, onChunk) {
  return new Promise((resolve, reject) => {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    let bodyStr = null;
    if (body) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(opts, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        const text = chunk.toString();
        buffer += text;
        onChunk(text);
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: buffer
        });
      });
    });
    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    console.log(`  ✅ 通过: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ 失败: ${message}`);
    throw new Error(`断言失败: ${message}`);
  }
}

async function runTests(port = DEFAULT_PORT) {
  console.log('========================================================');
  console.log(`🧪 开始执行 DeepSeek 网页端本地代理端到端测试套件 (端口: ${port})`);
  console.log('========================================================\n');

  const mock = new MockExtension(`ws://127.0.0.1:${port}/ws`);

  try {
    // 1. 健康检测
    console.log('👉 [测试 1/7] GET /health 健康检测接口');
    const healthRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET'
    });
    assert(healthRes.statusCode === 200, '健康检查接口应返回 200 OK');
    const healthJson = JSON.parse(healthRes.data);
    assert(healthJson.status === 'ok', '健康状态应为 ok');

    // 2. 模型列表接口
    console.log('\n👉 [测试 2/7] GET /v1/models OpenAI 兼容模型列表');
    const modelsRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/models',
      method: 'GET'
    });
    assert(modelsRes.statusCode === 200, '模型列表接口应返回 200');
    const modelsJson = JSON.parse(modelsRes.data);
    assert(modelsJson.object === 'list', '返回结构 object 应为 list');
    assert(modelsJson.data.some(m => m.id === 'deepseek-chat'), '模型列表中应包含 deepseek-chat');

    // 3. 插件未连接时发起翻译请求
    console.log('\n👉 [测试 3/7] 扩展未连接时发起请求，应返回 503');
    const noExtRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      messages: [{ role: 'user', content: 'hello' }]
    });
    assert(noExtRes.statusCode === 503, '无扩展连接时应返回 503 Service Unavailable');
    const noExtJson = JSON.parse(noExtRes.data);
    assert(!!noExtJson.error, '应返回错误对象描述');

    // 连接 Mock 扩展
    console.log('\n👉 连接 Mock Chrome 扩展 WebSocket 客户端...');
    await mock.connect();
    await sleep(200); // 确保 ws 连接就绪
    console.log('   Mock 扩展客户端连接成功!');

    // 4. 普通非流式请求 (stream: false)
    console.log('\n👉 [测试 4/7] POST /v1/chat/completions (stream: false) 普通响应');
    const nonStreamRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Translate this: hello world' }],
      stream: false
    });
    assert(nonStreamRes.statusCode === 200, '非流式请求应返回 200');
    const nonStreamJson = JSON.parse(nonStreamRes.data);
    assert(nonStreamJson.object === 'chat.completion', '返回 object 应为 chat.completion');
    assert(nonStreamJson.choices && nonStreamJson.choices.length > 0, 'choices 数组应不为空');
    assert(nonStreamJson.choices[0].message.role === 'assistant', '角色应为 assistant');
    assert(typeof nonStreamJson.choices[0].message.content === 'string', '回答内容应为字符串');

    // 5. 流式响应 (stream: true)
    console.log('\n👉 [测试 5/7] POST /v1/chat/completions (stream: true) SSE 流式传输');
    const chunks = [];
    let receivedDone = false;
    const streamRes = await requestStream({
      hostname: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Stream test message' }],
      stream: true
    }, (rawChunk) => {
      const lines = rawChunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const val = trimmed.slice(5).trim();
        if (val === '[DONE]') {
          receivedDone = true;
          continue;
        }
        try {
          const parsed = JSON.parse(val);
          if (parsed.choices?.[0]?.delta?.content) {
            chunks.push(parsed.choices[0].delta.content);
          }
        } catch (e) {}
      }
    });

    assert(streamRes.statusCode === 200, '流式请求应返回 200');
    assert(streamRes.headers['content-type'].includes('text/event-stream'), 'Content-Type 应为 text/event-stream');
    assert(chunks.length > 0, '应成功收到 SSE 流式 chunk 增量');
    assert(receivedDone, 'SSE 流结尾必须包含 [DONE] 标志');

    // 等待前一个测试任务的 300ms 冷却期结束，确保纯净测试测试 6
    await sleep(350);

    // 6. 串行队列与并发排队验证
    console.log('\n👉 [测试 6/7] 串行队列测试（并发发起两个请求，验证排队执行与 300ms 间隔）');
    const taskStartTimes = [];
    const taskEndTimes = [];
    mock.setTaskHandler((task) => {
      const startTime = Date.now();
      taskStartTimes.push(startTime);
      setTimeout(() => {
        taskEndTimes.push(Date.now());
        mock.send({
          requestId: task.requestId,
          text: 'Queue test response',
          done: true
        });
      }, 150);
    });

    const startAll = Date.now();
    const [qRes1, qRes2] = await Promise.all([
      request({
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { messages: [{ role: 'user', content: 'Queue 1' }] }),
      request({
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { messages: [{ role: 'user', content: 'Queue 2' }] })
    ]);

    assert(qRes1.statusCode === 200 && qRes2.statusCode === 200, '并发两请求均应成功返回 200');
    assert(taskStartTimes.length === 2, '两个任务均应被派发');
    const task2StartAfterTask1End = taskStartTimes[1] - taskEndTimes[0];
    console.log(`   任务1耗时后与任务2启动间隔时间: ${task2StartAfterTask1End}ms (预期 >= 280ms)`);
    assert(task2StartAfterTask1End >= 250, '任务2必须在任务1执行完且等待至少 300ms 保护间隔后执行');

    // 7. 异常处理测试（扩展返回错误信息）
    console.log('\n👉 [测试 7/7] 错误处理测试（模拟扩展回传错误）');
    mock.setTaskHandler((task) => {
      mock.send({
        requestId: task.requestId,
        error: '网页端出现验证码拦截或未登录'
      });
    });

    const errRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { messages: [{ role: 'user', content: 'Trigger Error' }] });

    assert(errRes.statusCode === 500, '扩展返回错误时接口应响应 500');
    const errJson = JSON.parse(errRes.data);
    assert(errJson.error.message.includes('验证码拦截'), '错误信息应正确传递至客户端');

    // 8. 交互式调试工作台 Web 页面加载与模型列表测试
    console.log('\n👉 [测试 8/8] GET / 交互式对话调试工作台与模型一键复制');
    const pageRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET'
    });
    assert(pageRes.statusCode === 200, '对话调试台页面应返回 200 OK');
    assert(pageRes.data.includes('DeepSeek Bridge 对话调试台'), '页面应包含调试工作台标题');
    assert(pageRes.data.includes('deepseek-chat') && pageRes.data.includes('deepseek-reasoner'), '页面应呈现可用模型列表');
    assert(pageRes.data.includes('copyText'), '页面应具备模型名一键复制功能');
    assert(pageRes.data.includes('cURL 命令行调用'), '快捷预设用例应包含 cURL 命令行');
    assert(pageRes.data.includes('copyCurlCommand'), '应具备 cURL 命令行一键复制功能');

    console.log('\n========================================================');
    console.log(`🎉 全部测试用例运行完成! 通过: ${passedCount}/${totalCount}`);
    console.log('========================================================\n');
  } finally {
    mock.close();
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('测试运行失败:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
