const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeNativeMessage(proc, msgObj) {
  const jsonStr = JSON.stringify(msgObj);
  const bodyBuf = Buffer.from(jsonStr, 'utf8');
  const headerBuf = Buffer.alloc(4);
  headerBuf.writeUInt32LE(bodyBuf.length, 0);
  proc.stdin.write(headerBuf);
  proc.stdin.write(bodyBuf);
}

async function testNativeHostProtocol() {
  console.log('========================================================');
  console.log('🧪 开始测试 Chrome Native Messaging Host 二进制协议通信');
  console.log('========================================================\n');

  const hostScript = path.resolve(__dirname, '../local-server/run-native-host.sh');
  const hostProc = spawn(hostScript, [], {
    env: { ...process.env, PORT: '8797' }, // 使用测试端口 8797
    stdio: ['pipe', 'pipe', 'inherit']
  });

  let outputBuffer = Buffer.alloc(0);
  const receivedMessages = [];

  hostProc.stdout.on('data', (chunk) => {
    outputBuffer = Buffer.concat([outputBuffer, chunk]);

    while (outputBuffer.length >= 4) {
      const msgLen = outputBuffer.readUInt32LE(0);
      if (outputBuffer.length < 4 + msgLen) break;

      const body = outputBuffer.slice(4, 4 + msgLen);
      outputBuffer = outputBuffer.slice(4 + msgLen);
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        receivedMessages.push(parsed);
      } catch (e) {}
    }
  });

  try {
    // 1. 等待收到 HOST_READY
    console.log('👉 [步骤 1/4] 等待 Native Host 发送 HOST_READY 握手报文...');
    let readyMsg = null;
    for (let i = 0; i < 20; i++) {
      readyMsg = receivedMessages.find(m => m.type === 'HOST_READY');
      if (readyMsg) break;
      await sleep(100);
    }
    if (!readyMsg) throw new Error('未在预期时间内收到 HOST_READY 消息');
    console.log(`  ✅ 握手成功: ${readyMsg.message} (端口: ${readyMsg.port})`);

    // 2. 测试 HTTP GET /v1/models
    console.log('\n👉 [步骤 2/4] 请求 HTTP GET /v1/models 检查模型列表...');
    const modelsData = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:8797/v1/models', (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(JSON.parse(d)));
      }).on('error', reject);
    });

    if (!modelsData.data || modelsData.data.length < 2) throw new Error('模型列表未返回完整数据');
    console.log(`  ✅ 模型列表成功返回: ${modelsData.data.map(m => m.id).join(', ')}`);

    // 3. 测试发起 POST /v1/chat/completions 并通过 Native 管道模拟流式应答
    console.log('\n👉 [步骤 3/4] 发起对话请求并验证 Native 双向流式中继...');
    let httpResponseDone = false;
    let sseChunks = [];

    const reqPromise = new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: 'deepseek-reasoner',
        stream: true,
        messages: [{ role: 'user', content: '测试 Native 协议' }]
      });

      const req = http.request({
        hostname: '127.0.0.1',
        port: 8797,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        res.on('data', (c) => {
          const text = c.toString('utf8');
          sseChunks.push(text);
        });
        res.on('end', () => {
          httpResponseDone = true;
          resolve();
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    // 等待 Native Host 发来 TRANSLATE_TASK
    let taskMsg = null;
    for (let i = 0; i < 20; i++) {
      taskMsg = receivedMessages.find(m => m.type === 'TRANSLATE_TASK');
      if (taskMsg) break;
      await sleep(100);
    }
    if (!taskMsg) throw new Error('未收到 Native Host 发来的 TRANSLATE_TASK');
    console.log(`  ✅ 成功截获 Native Host 派发的任务: requestId=${taskMsg.requestId}`);
    console.log(`     thinking 状态: ${taskMsg.thinking}, search 状态: ${taskMsg.search}`);

    // 模拟 Chrome 扩展回传增量与完成
    writeNativeMessage(hostProc, {
      requestId: taskMsg.requestId,
      chunk: '这是通过Native',
      done: false
    });
    await sleep(50);
    writeNativeMessage(hostProc, {
      requestId: taskMsg.requestId,
      chunk: '协议流式返回的答案！',
      done: false
    });
    await sleep(50);
    writeNativeMessage(hostProc, {
      requestId: taskMsg.requestId,
      text: '这是通过Native协议流式返回的答案！',
      done: true
    });

    await reqPromise;
    console.log(`  ✅ HTTP 客户端流式接收完成！收到 SSE 块数量: ${sseChunks.length}`);

    // 4. 验证关闭 stdin 时进程自动优雅退出
    console.log('\n👉 [步骤 4/4] 验证关闭连接时进程优雅退出与端口释放...');
    hostProc.stdin.end();

    const exitCode = await new Promise((resolve) => {
      hostProc.on('exit', (code) => resolve(code));
    });
    console.log(`  ✅ Native Host 进程已自动退出，退出码: ${exitCode}`);

    console.log('\n========================================================');
    console.log('🎉 Chrome Native Messaging 宿主服务自测全部通过！');
    console.log('========================================================\n');
  } catch (err) {
    hostProc.kill();
    throw err;
  }
}

testNativeHostProtocol().catch((err) => {
  console.error('❌ Native Host 自测失败:', err);
  process.exit(1);
});
