const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// 读取版本号
const manifestPath = path.join(ROOT_DIR, 'chrome-extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '0.2.0';

const PACKAGE_NAME = `deepseek-bridge-v${version}-portable`;
const TARGET_DIR = path.join(DIST_DIR, PACKAGE_NAME);
const EXTENSION_ZIP = path.join(DIST_DIR, `deepseek-extension-v${version}.zip`);
const FULL_ZIP = path.join(DIST_DIR, `${PACKAGE_NAME}.zip`);

console.log(`========================================================`);
console.log(`📦 开始构建 DeepSeek Web Bridge 分发部署产物 (版本: v${version})`);
console.log(`========================================================`);

// 1. 清理并初始化 dist 目录
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });

// 递归拷贝函数（自动跳过系统无用文件）
function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((element) => {
    if (element === '.DS_Store' || element.endsWith('.tmp')) return;
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    const stat = fs.statSync(fromPath);
    if (stat.isFile()) {
      fs.copyFileSync(fromPath, toPath);
      // 保持可执行权限
      if (element.endsWith('.sh') || element.endsWith('.command')) {
        try { fs.chmodSync(toPath, 0o755); } catch (e) {}
      }
    } else if (stat.isDirectory()) {
      copyFolderSync(fromPath, toPath);
    }
  });
}

// 2. 复制 chrome-extension
console.log('👉 1/5 正在打包 Chrome 扩展目录 (含固定 Extension Key)...');
copyFolderSync(path.join(ROOT_DIR, 'chrome-extension'), path.join(TARGET_DIR, 'chrome-extension'));

// 3. 复制 local-server (包含预置生产 node_modules，开箱免 npm install)
console.log('👉 2/5 正在封装 local-server 服务端与预置依赖 (免除使用者 npm install)...');
copyFolderSync(path.join(ROOT_DIR, 'local-server'), path.join(TARGET_DIR, 'local-server'));

// 4. 复制双平台一键安装脚本与文档
console.log('👉 3/5 正在注入一键安装脚本与部署文档...');
fs.copyFileSync(path.join(ROOT_DIR, 'install.command'), path.join(TARGET_DIR, 'install.command'));
fs.chmodSync(path.join(TARGET_DIR, 'install.command'), 0o755);

fs.copyFileSync(path.join(ROOT_DIR, 'install.bat'), path.join(TARGET_DIR, 'install.bat'));
fs.copyFileSync(path.join(ROOT_DIR, 'README.md'), path.join(TARGET_DIR, 'README.md'));
if (fs.existsSync(path.join(ROOT_DIR, 'README_zh.md'))) {
  fs.copyFileSync(path.join(ROOT_DIR, 'README_zh.md'), path.join(TARGET_DIR, 'README_zh.md'));
}

// 生成小白专用快速指南
const guideText = `========================================================
 DeepSeek 网页端转本地 API 代理 (DeepSeek Web Bridge)
 版本：v${version} 绿色免安装分发版
========================================================

【第一步：安装 Chrome 扩展】
1. 打开谷歌浏览器（Google Chrome），地址栏输入：chrome://extensions/ 并回车。
2. 开启右上角的【开发者模式】。
3. 点击左上角的【加载已解压的扩展程序】，选中本文件夹内的 [chrome-extension] 目录。
4. 此时浏览器右上角扩展栏会出现 DeepSeek 桥接图标。

【第二步：双击一键注册服务】
- macOS 用户：双击运行本目录下的 [install.command]（系统会弹出成功提示）。
- Windows 用户：双击运行本目录下的 [install.bat]。
（此步骤将本地网关安全注册到 Chrome Native Messaging，后续浏览器可直接在后台静默拉起，完全无需打开命令行黑窗口！）

【第三步：准备 DeepSeek 网页环境】
1. 在浏览器中打开并登录：https://chat.deepseek.com/

【第四步：启动与使用】
1. 点击 Chrome 右上角插件图标，点击【启动服务】按钮。
2. 服务启动后，状态显示绿色【运行中】（本地监听端口 8765）。
3. 可以在任意支持 OpenAI 接口的客户端（如 Bob、沉浸式翻译、ChatBox、NextChat 等）中配置：
   - 接口服务地址 (Base URL): http://127.0.0.1:8765/v1/chat/completions
     (或基础地址): http://127.0.0.1:8765/v1
   - API Key: 任意字符串（如 sk-deepseek-bridge）
   - 模型名称: deepseek-chat 或 deepseek-reasoner
4. 在扩展面板中还可以点击【🎮 对话调试台】进行可视化交互测试！
`;
fs.writeFileSync(path.join(TARGET_DIR, '快速安装使用指南.txt'), guideText, 'utf8');

// 5. 压缩成独立分发 ZIP
console.log('👉 4/5 正在压缩生成全套独立分发便携包 (.zip)...');
try {
  // 打包全量绿色便携包
  execSync(`cd "${DIST_DIR}" && zip -rq "${PACKAGE_NAME}.zip" "${PACKAGE_NAME}"`);
  
  // 单独打包插件目录，方便单插件分发场景
  console.log('👉 5/5 正在生成纯插件单独分发包 (.zip)...');
  execSync(`cd "${TARGET_DIR}/chrome-extension" && zip -rq "${EXTENSION_ZIP}" .`);
} catch (e) {
  console.error('压缩过程异常:', e);
}

// 统计产物体积
const fullZipSize = (fs.statSync(FULL_ZIP).size / (1024 * 1024)).toFixed(2);
const extZipSize = (fs.statSync(EXTENSION_ZIP).size / 1024).toFixed(2);

console.log(`\n========================================================`);
console.log(`🎉 构建完成！分发产物已输出至 dist/ 目录：`);
console.log(`--------------------------------------------------------`);
console.log(`1. 🌟 全套开箱即用便携绿色包 (推荐向用户推广分发):`);
console.log(`   文件: dist/${PACKAGE_NAME}.zip (${fullZipSize} MB)`);
console.log(`   特点: 内置预置生产依赖，免除用户 npm install，解压双击即用！`);
console.log(`\n2. 🧩 Chrome 扩展独立分发包:`);
console.log(`   文件: dist/deepseek-extension-v${version}.zip (${extZipSize} KB)`);
console.log(`   特点: 供仅需安装或更新 Chrome 扩展程序的用户使用。`);
console.log(`\n3. 📂 未压缩绿色发布目录:`);
console.log(`   目录: dist/${PACKAGE_NAME}/`);
console.log(`========================================================\n`);

