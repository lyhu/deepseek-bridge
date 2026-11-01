(function () {
  if (window.__DEEPSEEK_PROXY_MAIN_INJECTED__) {
    return;
  }
  window.__DEEPSEEK_PROXY_MAIN_INJECTED__ = true;

  // 若当前页面为 API 专用实例，修改标题并做明显标识
  if (window.location.search.includes('_bridge=dedicated')) {
    try {
      document.title = '⚡ [API 专用] DeepSeek';
    } catch (e) {}
  }

  let currentRequestId = null;
  let translationCount = 0;
  const MAX_CONTEXT_TURNS = 25; // 每翻译 25 次自动优化防卡顿（开启新会话）

  function sendToContent(payload) {
    window.postMessage({ source: 'DS_EXT_MAIN', payload }, '*');
  }

  function sendLog(message, detail = '') {
    console.log(`[DeepSeek 桥接] ${message}`, detail);
    window.postMessage({
      source: 'DS_EXT_LOG',
      payload: {
        message,
        detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail)
      }
    }, '*');
  }

  // 创建单次请求的流式数据包状态解析器
  function createStreamParser() {
    let currentFragmentType = 'RESPONSE'; // 默认为 RESPONSE 模式

    return function parsePacket(jsonObj) {
      if (!jsonObj) return '';

      // 1. 检查会话初始化中的 fragments (区分 THINK 或 RESPONSE)
      if (jsonObj.v?.response?.fragments) {
        const frags = jsonObj.v.response.fragments;
        if (frags.length > 0) {
          const lastFrag = frags[frags.length - 1];
          if (lastFrag.type) currentFragmentType = lastFrag.type;
          if (currentFragmentType === 'RESPONSE' && lastFrag.content) {
            return lastFrag.content;
          }
        }
        return '';
      }

      // 2. 检查片段切换（例如由 THINK 思考片段切换为 RESPONSE 正式回复片段）
      if (jsonObj.p === 'response/fragments' && Array.isArray(jsonObj.v)) {
        for (const item of jsonObj.v) {
          if (item.type) {
            currentFragmentType = item.type;
            if (item.type === 'RESPONSE' && item.content) {
              return item.content;
            }
          }
        }
        return '';
      }

      // 3. 过滤状态控制包（如 response/status、response/quasi_status）
      if (jsonObj.p && (jsonObj.p.includes('status') || jsonObj.p.includes('token') || jsonObj.p.includes('elapsed'))) {
        return '';
      }

      // 4. 带路径的增量包 (APPEND)
      if (jsonObj.p && jsonObj.p.includes('fragments')) {
        if (currentFragmentType === 'RESPONSE' && typeof jsonObj.v === 'string') {
          return jsonObj.v;
        }
        return '';
      }

      // 5. 新版极简增量包 {"v": "..."}
      if (typeof jsonObj.v === 'string') {
        if (jsonObj.v === 'FINISHED' || jsonObj.v === 'WIP') return '';
        if (currentFragmentType === 'RESPONSE') {
          return jsonObj.v;
        }
        return ''; // 过滤处于 THINK 状态时的思考碎片
      }

      // 6. 标准 OpenAI 增量格式兜底
      const delta = jsonObj.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === 'string') return delta.content;
        if (typeof delta.text === 'string') return delta.text;
      }

      return '';
    };
  }

  // 平滑优化防卡顿：每累计达到 25 次翻译，自动触发开启新会话以避免长上下文卡顿
  function optimizeContextIfNeeded() {
    if (translationCount >= MAX_CONTEXT_TURNS) {
      translationCount = 0;
      try {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
        const newChatBtn = buttons.find((el) => {
          const text = el.innerText || el.textContent || '';
          const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
          return text.includes('新对话') || text.includes('新建对话') || title.includes('新对话') || title.includes('新建对话');
        });
        if (newChatBtn) {
          newChatBtn.click();
          sendLog('已触发开启新会话以优化上下文长度与页面性能');
        }
      } catch (e) {
        sendLog('触发新会话优化异常: ' + e.message);
      }
    }
  }

  // ========================================================
  // 核心拦截 1：XMLHttpRequest 拦截（DeepSeek 网页端真实请求通道）
  // ========================================================
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = String(url);
    this._method = String(method);
    return origXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const isCompletion = this._url && this._url.includes('chat/completion');

    if (isCompletion && currentRequestId) {
      const activeReqId = currentRequestId;
      sendLog(`[XHR] 命中 chat/completion 请求: ${this._url}, 关联任务: ${activeReqId}`);

      const parsePacket = createStreamParser();
      let lastIndex = 0;
      let fullText = '';
      let chunkCount = 0;
      let buffer = '';

      // 实时监听流式数据推入
      this.addEventListener('progress', () => {
        const currentText = this.responseText || '';
        const rawNewText = currentText.slice(lastIndex);
        lastIndex = currentText.length;

        buffer += rawNewText;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留尚未结束的残行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const chunkText = parsePacket(data);
            if (chunkText) {
              chunkCount++;
              fullText += chunkText;
              // 实时推送流式增量数据块给服务端
              sendToContent({ requestId: activeReqId, chunk: chunkText, done: false });
            }
          } catch (e) {
            // 忽略非 JSON 数据行
          }
        }
      });

      // 监听请求结束
      const onEnd = () => {
        // 处理最后残余的一行
        if (buffer.trim().startsWith('data:')) {
          try {
            const data = JSON.parse(buffer.trim().slice(5).trim());
            const chunkText = parsePacket(data);
            if (chunkText) {
              fullText += chunkText;
              sendToContent({ requestId: activeReqId, chunk: chunkText, done: false });
            }
          } catch (e) {}
        }

        sendLog(`[XHR] 完成数据流接收，共推送有效增量块: ${chunkCount}，总字符数: ${fullText.length}`);
        sendToContent({ requestId: activeReqId, text: fullText, done: true });

        if (currentRequestId === activeReqId) {
          currentRequestId = null;
        }
      };

      this.addEventListener('load', onEnd, { once: true });
      this.addEventListener('error', (e) => {
        sendLog('[XHR] 请求发生网络错误: ' + e.message);
        sendToContent({ requestId: activeReqId, error: 'XHR 网络连接异常' });
        if (currentRequestId === activeReqId) currentRequestId = null;
      }, { once: true });
    }

    return origXhrSend.apply(this, args);
  };

  // ========================================================
  // 核心拦截 2：Fetch 拦截（作为双重兜底）
  // ========================================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = '';
    if (typeof args[0] === 'string') {
      url = args[0];
    } else if (args[0] && typeof args[0] === 'object') {
      url = args[0].url || args[0].href || '';
    }

    const isCompletion = (url.includes('chat/completion') || url.includes('/completion')) && !url.includes('create_pow_challenge');

    if (currentRequestId && isCompletion) {
      sendLog(`[Fetch] 命中补全接口: ${url.slice(0, 100)}, 关联任务: ${currentRequestId}`);
    }

    const response = await originalFetch.apply(this, args);

    if (isCompletion && currentRequestId) {
      const activeReqId = currentRequestId;
      sendLog(`[Fetch] 收到响应状态 HTTP ${response.status}，准备读取流...`);

      try {
        const clonedRes = response.clone();
        const reader = clonedRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const parsePacket = createStreamParser();
        let fullText = '';
        let buffer = '';

        (async () => {
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
                const chunkText = parsePacket(data);
                if (chunkText) {
                  fullText += chunkText;
                  sendToContent({ requestId: activeReqId, chunk: chunkText, done: false });
                }
              } catch (e) {}
            }
          }
          sendToContent({ requestId: activeReqId, text: fullText, done: true });
          if (currentRequestId === activeReqId) currentRequestId = null;
        })();
      } catch (e) {
        sendLog('[Fetch] 读取流异常: ' + e.message);
      }
    }

    return response;
  };

  // ========================================================
  // 模拟操作 React 受控输入框并触发回车与发送
  // ========================================================
  function triggerWebSend(promptText) {
    const textarea = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
    if (!textarea) {
      throw new Error('未找到 DeepSeek 网页输入框，请确认页面已加载且处于登录状态');
    }

    textarea.focus();

    // 绕过 React 16+ 框架受控组件状态拦截
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, promptText);
    } else {
      textarea.value = promptText;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    setTimeout(() => {
      // 1. 派发回车按键事件
      const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      textarea.dispatchEvent(enterEvent);

      // 2. 备用策略：查找并点击发送按钮（按钮通常在输入区域内部或附近）
      setTimeout(() => {
        try {
          const parent = textarea.closest('div[class*="input"]') || textarea.parentElement?.parentElement || document.body;
          const sendBtn = parent.querySelector('div[role="button"]:not([aria-disabled="true"]), button:not([disabled])');
          if (sendBtn) {
            sendBtn.click();
          }
        } catch (e) {}
      }, 50);
    }, 60);
  }

  // 设置页面底部的开关状态（深度思考 / 智能搜索 / 联网搜索）
  function setToggleState(targetNames, shouldBeActive) {
    if (typeof shouldBeActive !== 'boolean') return;
    const names = Array.isArray(targetNames) ? targetNames : [targetNames];
    const toggles = Array.from(document.querySelectorAll('.ds-toggle-button, [role="button"], div[class*="toggle"], div[class*="btn"]'));
    const btn = toggles.find((el) => {
      const text = (el.innerText || el.textContent || '').trim();
      return names.some(name => text.includes(name));
    });

    const displayTarget = names[0];
    if (!btn) {
      sendLog(`未在界面找到功能开关: ${names.join('/')}`);
      return;
    }

    const isCurrentActive = btn.getAttribute('aria-pressed') === 'true' ||
                            btn.className.includes('selected') ||
                            btn.className.includes('active') ||
                            btn.querySelector('.active') !== null;
    if (isCurrentActive !== shouldBeActive) {
      sendLog(`自动调节开关 [${displayTarget}] 状态: ${isCurrentActive} -> ${shouldBeActive}`);
      btn.click();
    } else {
      sendLog(`功能开关 [${displayTarget}] 保持状态: ${shouldBeActive}`);
    }
  }

  // 监听来自内容脚本 content.js 的任务指令
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'DS_EXT_CONTENT') return;

    if (event.data.type === 'TRANSLATE_TASK') {
      currentRequestId = event.data.requestId;
      translationCount++;
      const { thinking, search } = event.data;
      sendLog(`收到来自后端的请求: ${currentRequestId}, 深度思考: ${thinking}, 联网搜索: ${search}`);
      optimizeContextIfNeeded();

      try {
        // 根据请求参数或模型配置，动态自适应切换深度思考与联网搜索开关（支持别名容错）
        setToggleState(['深度思考', 'R1'], thinking);
        setToggleState(['联网搜索', '智能搜索', '搜索'], search);

        // 稍作停顿确保 React 切换状态生效后填充输入框发送
        setTimeout(() => {
          triggerWebSend(event.data.prompt);
        }, 80);
      } catch (err) {
        sendLog('触发网页发送失败: ' + err.message);
        sendToContent({ requestId: currentRequestId, error: err.message });
        currentRequestId = null;
      }
    }
  });

  sendLog('页面主环境注入成功（已挂载 XHR 与 Fetch 双重监听），正在监听翻译指令...');
})();
