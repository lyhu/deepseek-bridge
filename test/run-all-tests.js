const { fork } = require('child_process');
const path = require('path');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const TEST_PORT = process.env.TEST_PORT || '8798';
  console.log(`🚀 正在启动 local-server 测试服务端进程 (端口: ${TEST_PORT})...`);
  const serverPath = path.resolve(__dirname, '../local-server/server.js');
  
  const serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: TEST_PORT },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('服务端启动失败:', err);
    process.exit(1);
  });

  // 等待服务监听就绪
  await sleep(1000);

  console.log('\n🏃 启动测试套件...\n');
  const testSuitePath = path.resolve(__dirname, 'test-suite.js');
  const { runTests } = require(testSuitePath);

  try {
    await runTests(parseInt(TEST_PORT, 10));
    console.log('🎉 所有自动化自测用例全部通过！');
    serverProcess.kill('SIGTERM');
    process.exit(0);
  } catch (err) {
    console.error('❌ 测试未全部通过:', err);
    serverProcess.kill('SIGTERM');
    process.exit(1);
  }
}

main();
