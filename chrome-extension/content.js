/**
 * DeepSeek Web to API Bridge - 内容脚本 (Isolated World)
 * 负责在 Background Service Worker 与 MAIN 环境 Injected 脚本之间中继通信
 */

// 防重守卫：避免 background 动态执行 executeScript 时重复注册 listener
if (!window.__DEEPSEEK_PROXY_CONTENT_INJECTED__) {
  window.__DEEPSEEK_PROXY_CONTENT_INJECTED__ = true;

  // 网页端激活标识悬浮提醒
  function showActivationBadge(text) {
    try {
      let badge = document.getElementById('ds-bridge-activation-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'ds-bridge-activation-badge';
        badge.style.cssText = `
          position: fixed;
          top: 20px;
          right: 24px;
          z-index: 999999;
          background: rgba(15, 23, 42, 0.92);
          color: #38bdf8;
          border: 1px solid #0284c7;
          box-shadow: 0 8px 30px rgba(2, 132, 199, 0.35);
          padding: 10px 18px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          align-items: center;
          gap: 8px;
          pointer-events: none;
          transition: opacity 0.3s ease, transform 0.3s ease;
          opacity: 0;
          transform: translateY(-10px);
        `;
        document.body.appendChild(badge);
      }
      badge.innerHTML = `<span>⚡</span> <span>${text}</span>`;
      badge.style.opacity = '1';
      badge.style.transform = 'translateY(0)';
      setTimeout(() => {
        if (badge) {
          badge.style.opacity = '0';
          badge.style.transform = 'translateY(-10px)';
        }
      }, 2200);
    } catch (e) {}
  }

  // 1. 接收来自 background.js 后台的翻译任务与控制指令
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ pong: true, href: window.location.href });
      return true;
    }
    if (msg.type === 'SHOW_ACTIVATED_TOAST') {
      showActivationBadge(msg.text || 'DeepSeek 桥接实例已激活');
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'TRANSLATE_TASK') {
      window.postMessage({ source: 'DS_EXT_CONTENT', ...msg }, '*');
      sendResponse({ received: true });
      return true;
    }
  });

  // 2. 接收来自网页主执行环境（MAIN 环境）的拦截数据与调试日志 -> 转发给后台工作线程 background.js
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === 'DS_EXT_MAIN') {
      chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        payload: event.data.payload
      });
    } else if (event.data.source === 'DS_EXT_LOG') {
      chrome.runtime.sendMessage({
        type: 'DEBUG_LOG',
        payload: event.data.payload
      });
    }
  });
}
