/**
 * DeepSeek Web to API Bridge - Background Service Worker (MV3)
 * 支持 Native Messaging 静默拉起与经典 WebSocket 双模式
 */

const NATIVE_HOST_NAME = 'com.deepseek.web_bridge';
const WS_URL = 'ws://127.0.0.1:8765/ws';
const DEDICATED_URL = 'https://chat.deepseek.com/?_bridge=dedicated';

let nativePort = null;
let wsClient = null;
let dedicatedWindowId = null;
let dedicatedTabId = null;
const recentLogs = [];

function addLog(text, level = 'info') {
  const item = { text, level, time: Date.now() };
  recentLogs.push(item);
  if (recentLogs.length > 50) recentLogs.shift();
  // 广播给可能打开的 Popup 面板
  chrome.runtime.sendMessage({ type: 'NEW_LOG', text, level }).catch(() => {});
}

// 激活并置顶窗口与标签页
async function activateTabAndWindow(tab) {
  if (!tab) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: true }).catch(() => {});
    }
  } catch (e) {}
}

// 获取 API 专用实例标签页（精准匹配带 _bridge=dedicated 的专属实例，或已绑定的 dedicatedTabId）
async function getDedicatedTab() {
  if (dedicatedTabId) {
    try {
      const tab = await chrome.tabs.get(dedicatedTabId);
      if (tab && tab.url && tab.url.includes('chat.deepseek.com')) {
        return tab;
      }
    } catch (e) {
      dedicatedTabId = null;
    }
  }

  // Chrome match pattern 规范要求 host/path，不支持在 pattern 中带参数 query string
  // 所以检索所有 chat.deepseek.com/*，再在内存中精准匹配
  const allTabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' });
  if (allTabs && allTabs.length > 0) {
    // 1. 优先匹配明确带有 _bridge=dedicated 标识的专属实例
    const dedicated = allTabs.find(t => t.url && t.url.includes('_bridge=dedicated'));
    if (dedicated) {
      dedicatedTabId = dedicated.id;
      dedicatedWindowId = dedicated.windowId;
      return dedicated;
    }

    // 2. 兜底平滑兼容：若当前主窗口已打开 DeepSeek，直接无感复用，避免每次请求都触发耗时建窗
    if (allTabs.length >= 1) {
      dedicatedTabId = allTabs[0].id;
      dedicatedWindowId = allTabs[0].windowId;
      return allTabs[0];
    }
  }

  return null;
}

// 实时获取专用窗口的状态（是否处于前台显示态，还是最小化后台态）
async function checkDedicatedWindowState(windowId) {
  if (!windowId) return false;
  try {
    const win = await chrome.windows.get(windowId);
    return win && win.state !== 'minimized';
  } catch (e) {
    return false;
  }
}

// 检查是否存在已打开的对话调试台标签页
async function checkPlaygroundTabs() {
  const tabs = await chrome.tabs.query({
    url: ['http://127.0.0.1:8765/*', 'http://localhost:8765/*']
  });
  return tabs;
}

// 动态切换扩展图标（启动时为发光亮色 + 绿徽章，未启动时为暗淡灰色）
function updateExtensionIcon(isRunning) {
  const suffix = isRunning ? 'active' : 'inactive';
  try {
    chrome.action.setIcon({
      path: {
        16: `icons/icon-${suffix}-16.png`,
        32: `icons/icon-${suffix}-32.png`,
        48: `icons/icon-${suffix}-48.png`,
        128: `icons/icon-${suffix}-128.png`
      }
    }).catch(() => {});

    if (isRunning) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      chrome.action.setTitle({ title: 'DeepSeek 代理网关：运行中 (端口: 8765)' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'DeepSeek 代理网关：未启动 (点击启动)' });
    }
  } catch (e) {}
}

async function broadcastState() {
  const [dedicatedTab, pgTabs] = await Promise.all([
    getDedicatedTab(),
    checkPlaygroundTabs()
  ]);
  const isRunning = Boolean(nativePort || (wsClient && wsClient.readyState === WebSocket.OPEN));
  const hasDedicated = Boolean(dedicatedTab);
  let isVisible = false;
  if (hasDedicated && dedicatedTab.windowId) {
    isVisible = await checkDedicatedWindowState(dedicatedTab.windowId);
  }
  const state = {
    isRunning,
    hasDeepSeekTab: hasDedicated,
    hasDedicatedTab: hasDedicated,
    isDedicatedVisible: isVisible,
    hasPlaygroundTab: Boolean(pgTabs && pgTabs.length > 0)
  };
  updateExtensionIcon(isRunning);
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state }).catch(() => {});
  return state;
}

let creatingWorkerPromise = null;

// 确保 API 专属实例存在：以独立小窗口拉起（默认隐形静默在后台，完全不占用用户主浏览器标签栏）
async function ensureDedicatedWorker(show = false) {
  const existingTab = await getDedicatedTab();
  if (existingTab) {
    if (show) {
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { state: 'normal', focused: true }).catch(() => {});
      }
      await chrome.tabs.update(existingTab.id, { active: true }).catch(() => {});
      addLog(`API 专用窗口已呼出到前台 (Window ID: ${existingTab.windowId})`, 'info');
      chrome.tabs.sendMessage(existingTab.id, {
        type: 'SHOW_ACTIVATED_TOAST',
        text: '⚡ API 专用网页已呼出到前台'
      }).catch(() => {});
    }
    await broadcastState();
    return existingTab;
  }

  // 防并发重复创建锁
  if (creatingWorkerPromise) {
    return await creatingWorkerPromise;
  }

  creatingWorkerPromise = (async () => {
    try {
      addLog(`正在创建独立的 API 专属后台静默实例 (不占用主标签栏)...`, 'info');
      let win = null;
      try {
        const createOptions = {
          url: DEDICATED_URL,
          focused: Boolean(show)
        };
        if (show) {
          createOptions.type = 'popup';
          createOptions.width = 1024;
          createOptions.height = 720;
          createOptions.state = 'normal';
        } else {
          // 注意：Chrome 官方规范明确规定 minimized 状态不能与 width/height 同时使用
          createOptions.state = 'minimized';
        }
        win = await chrome.windows.create(createOptions);
      } catch (winErr) {
        // 若独立窗口最小化受系统限制，优雅降级为在当前窗口创建后台固定标签页
        addLog(`静默独立窗口创建受限 (${winErr?.message || 'minimized error'})，自动降级为后台固定标签页...`, 'warn');
        const fallbackTab = await chrome.tabs.create({
          url: DEDICATED_URL,
          active: false,
          pinned: true
        });
        dedicatedTabId = fallbackTab.id;
        dedicatedWindowId = fallbackTab.windowId;
        addLog(`API 专属实例已就绪 (后台固定标签页 ID: ${fallbackTab.id})`, 'success');
        await broadcastState();
        return fallbackTab;
      }

      dedicatedWindowId = win.id;
      dedicatedTabId = win.tabs?.[0]?.id || null;
      addLog(`API 专属实例已就绪 (Window ID: ${win.id}, Tab ID: ${dedicatedTabId}, 状态: ${show ? '前台可见' : '后台隐形静默'})`, 'success');
      await broadcastState();

      if (win.tabs && win.tabs[0]) {
        return win.tabs[0];
      }
      return await getDedicatedTab();
    } catch (err) {
      addLog(`创建 API 专属实例失败: ${err?.message || '未知错误'}`, 'err');
      throw err;
    } finally {
      creatingWorkerPromise = null;
    }
  })();

  return await creatingWorkerPromise;
}

// 呼出 / 隐藏 API 专用网页（一键在前台与后台隐形静默间切换）
async function toggleDedicatedWorkerVisibility() {
  let tab = await getDedicatedTab();
  if (!tab) {
    // 尚未拉起：直接以正常前台窗口拉起，让用户立即看到并登录
    tab = await ensureDedicatedWorker(true);
    await broadcastState();
    return { isVisible: true, exists: true };
  }

  const isVisible = await checkDedicatedWindowState(tab.windowId);
  if (isVisible) {
    // 当前处于前台可见态 -> 隐藏回后台静默最小化
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { state: 'minimized' }).catch(() => {});
    }
    addLog('已将 API 专用窗口隐藏回后台静默运行。', 'info');
    await broadcastState();
    return { isVisible: false, exists: true };
  } else {
    // 当前处于后台静默态 -> 呼出至前台置顶
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: true }).catch(() => {});
    }
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    addLog('已将 API 专用窗口呼出至前台。', 'info');
    chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_ACTIVATED_TOAST',
      text: '⚡ API 专用网页已呼出到前台'
    }).catch(() => {});
    await broadcastState();
    return { isVisible: true, exists: true };
  }
}

// 兼容别名
async function ensureDeepSeekTab(activate = false) {
  return await ensureDedicatedWorker(activate);
}

// 打开或激活对话调试台：单例模式，如果已经打开过直接激活，避免重复开启多个网页
async function openOrActivatePlayground() {
  const tabs = await checkPlaygroundTabs();
  if (tabs && tabs.length > 0) {
    const existingTab = tabs[0];
    await activateTabAndWindow(existingTab);
    addLog(`检测到已存在的调试工作台，直接切换激活 (Tab ID: ${existingTab.id})`, 'info');
    broadcastState();
    return { tab: existingTab, isNew: false };
  }

  addLog('正在新开标签页打开对话调试工作台...', 'info');
  const newTab = await chrome.tabs.create({
    url: 'http://127.0.0.1:8765/',
    active: true
  });
  broadcastState();
  return { tab: newTab, isNew: true };
}

// 等待标签页完成加载
function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // 超时降级继续尝试
      }
    }, timeoutMs);

    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 刷新标签页并等待加载完成
async function reloadTabAndWait(tabId, timeoutMs = 20000) {
  const waitPromise = waitForTabComplete(tabId, timeoutMs);
  await chrome.tabs.reload(tabId);
  await waitPromise;
}

// 向目标标签页派发任务，支持自动注入脚本补全与页面自愈重试
async function dispatchTaskToTab(targetTab, taskMsg) {
  // 1. 若标签页正在加载中，先等待加载完成
  if (targetTab.status === 'loading') {
    addLog('DeepSeek 网页正在加载中，等待就绪...', 'info');
    await waitForTabComplete(targetTab.id, 15000);
  }

  // 2. 尝试派发，具备自愈重试机制
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await chrome.tabs.sendMessage(targetTab.id, taskMsg);
      return resp;
    } catch (err) {
      lastError = err;
      const errMsg = err?.message || '';

      // 根因：扩展重载或刚安装时，旧标签页未被注入 content script，抛出 Receiving end does not exist
      if (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish connection')) {
        addLog(`检测到 DeepSeek 标签页通信未连接（通常因扩展重载后旧页面未刷新），正在尝试自愈激活 (尝试 ${attempt}/2)...`, 'warn');

        let injected = false;
        if (chrome.scripting) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['content.js']
            });
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['injected.js'],
              world: 'MAIN'
            });
            injected = true;
            addLog('通信脚本已动态注入，正在重新派发任务...', 'info');
          } catch (injectErr) {
            addLog(`动态注入脚本失败: ${injectErr.message}，准备刷新页面...`, 'warn');
          }
        }

        if (injected) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        // 若无法动态注入，则自动刷新页面并等待加载完成
        try {
          addLog('正在自动刷新 DeepSeek 标签页以彻底恢复桥接通信...', 'info');
          await reloadTabAndWait(targetTab.id, 20000);
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        } catch (reloadErr) {
          addLog(`自动刷新标签页失败: ${reloadErr.message}`, 'err');
        }
      }
      throw err;
    }
  }

  throw lastError;
}

// 统一任务派发调度器（严格派发给 API 专用后台实例，绝不污染用户日常聊天窗口）
async function handleIncomingTask(taskMsg, replyError) {
  addLog(`收到客户端请求: ${taskMsg.requestId} (模型: ${taskMsg.model || 'deepseek-chat'})`, 'info');
  let targetTab = await getDedicatedTab();

  if (!targetTab) {
    addLog('未检测到已启动的 API 专属后台实例，正在静默拉起...', 'warn');
    try {
      targetTab = await ensureDedicatedWorker(false); // 永远后台静默拉起，不弹窗打扰用户
      if (targetTab && targetTab.id) {
        // 等待网页完全加载
        await waitForTabComplete(targetTab.id, 20000);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (createErr) {
      replyError(taskMsg.requestId, `无法自动创建专用网页: ${createErr?.message || '请点击面板【呼出专用网页】或手动打开 DeepSeek'}`);
      return;
    }
  }

  try {
    await dispatchTaskToTab(targetTab, taskMsg);
  } catch (err) {
    const errMsg = err?.message || '未知通信错误';
    addLog('向页面派发任务失败: ' + errMsg, 'err');
    replyError(taskMsg.requestId, `派发到网页失败: ${errMsg} (可在插件面板点击“呼出专用网页”排查状态)`);
  }
}

// -----------------------------------------------------------------------------
// 1. Native Messaging 通信管理（零终端模式）
// -----------------------------------------------------------------------------
function startNativeHost() {
  if (nativePort) return true;

  try {
    addLog('正在唤起本地 Native 网关服务...', 'info');
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener(async (msg) => {
      if (msg.type === 'HOST_READY') {
        addLog(`本地代理网关已就绪 (端口: ${msg.port})`, 'success');
        broadcastState();
        return;
      }

      if (msg.type === 'TRANSLATE_TASK') {
        handleIncomingTask(msg, (reqId, errMsg) => {
          if (nativePort) {
            nativePort.postMessage({ requestId: reqId, error: errMsg });
          }
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || '';
      nativePort = null;
      addLog(`本地网关已断开连接: ${err || '已正常退出'}`, 'warn');
      broadcastState();
    });

    // 确保有网页
    ensureDeepSeekTab(false);
    return true;
  } catch (err) {
    nativePort = null;
    addLog(`拉起 Native 网关失败: ${err.message}`, 'err');
    return false;
  }
}

function stopNativeHost() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (e) {}
    nativePort = null;
    addLog('已停止本地 Native 网关。', 'warn');
    broadcastState();
  }
}

// -----------------------------------------------------------------------------
// 2. 经典独立终端 WebSocket 降级支持
// -----------------------------------------------------------------------------
function connectWebSocket() {
  if (nativePort) return; // 优先使用 Native Host
  if (wsClient && (wsClient.readyState === WebSocket.OPEN || wsClient.readyState === WebSocket.CONNECTING)) return;

  try {
    wsClient = new WebSocket(WS_URL);
    wsClient.onopen = () => {
      addLog('[WS] 已连接外部独立启动的本地代理服务', 'success');
      broadcastState();
    };
    wsClient.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'PONG') return;
        if (data.type === 'TRANSLATE_TASK') {
          handleIncomingTask(data, (reqId, errMsg) => {
            if (wsClient && wsClient.readyState === WebSocket.OPEN) {
              wsClient.send(JSON.stringify({ requestId: reqId, error: errMsg }));
            }
          });
        }
      } catch (e) {}
    };
    wsClient.onclose = () => {
      wsClient = null;
      broadcastState();
    };
    wsClient.onerror = () => {
      if (wsClient) wsClient.close();
    };
  } catch (e) {}
}

// 定时保活与状态刷新
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    broadcastState();
    if (!nativePort && (!wsClient || wsClient.readyState !== WebSocket.OPEN)) {
      // 尝试发现是否有外部运行的服务
      connectWebSocket();
    } else if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({ type: 'PING' }));
    }
  }
});

// 监听标签页与独立窗口关闭事件，更新状态
chrome.tabs.onRemoved.addListener(() => {
  setTimeout(broadcastState, 500);
});

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === dedicatedWindowId) {
    dedicatedWindowId = null;
    dedicatedTabId = null;
    addLog('API 专用窗口已被关闭。下次请求将自动后台静默重建。', 'warn');
    broadcastState();
  }
});

// -----------------------------------------------------------------------------
// 3. 接收网页端与 Popup 的消息
// -----------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 来自 Popup 的指令
  if (message.type === 'GET_STATE') {
    broadcastState().then((state) => {
      sendResponse({
        ...state,
        logs: recentLogs
      });
    });
    return true;
  }

  if (message.type === 'START_SERVICE') {
    const ok = startNativeHost();
    // 自动在后台静默建立 API 专属实例
    ensureDedicatedWorker(false);
    broadcastState().then((state) => {
      sendResponse({
        ok,
        state
      });
    });
    return true;
  }

  if (message.type === 'STOP_SERVICE') {
    stopNativeHost();
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
    broadcastState().then((state) => {
      sendResponse({
        ok: true,
        state
      });
    });
    return true;
  }

  // 呼出 / 隐藏 API 专用网页
  if (message.type === 'TOGGLE_DEDICATED_VISIBILITY') {
    toggleDedicatedWorkerVisibility().then((res) => {
      sendResponse({ ok: true, isVisible: res.isVisible });
    });
    return true;
  }

  if (message.type === 'ENSURE_DEEPSEEK_TAB') {
    ensureDedicatedWorker(message.active !== false).then((tab) => {
      sendResponse({ ok: true, tabId: tab?.id });
    });
    return true;
  }

  if (message.type === 'OPEN_PLAYGROUND') {
    openOrActivatePlayground().then((res) => {
      sendResponse({ ok: true, isNew: res.isNew, tabId: res.tab.id });
    });
    return true;
  }

  if (message.type === 'CLEAR_LOGS') {
    recentLogs.length = 0;
    return;
  }

  // 来自 content.js 的任务结果与流式增量
  if (message.type === 'TASK_RESULT') {
    if (nativePort) {
      nativePort.postMessage(message.payload);
    } else if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify(message.payload));
    }
  } else if (message.type === 'DEBUG_LOG') {
    addLog(message.payload.message || '', 'info');
  }
});

// 扩展初次启动时校准图标状态
broadcastState();
