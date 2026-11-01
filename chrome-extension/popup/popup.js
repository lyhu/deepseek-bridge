document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('statusBadge');
  const toggleBtn = document.getElementById('toggleBtn');
  const dotPort = document.getElementById('dotPort');
  const dotWeb = document.getElementById('dotWeb');
  const webStatusText = document.getElementById('webStatusText');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const toggleDedicatedBtn = document.getElementById('toggleDedicatedBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const logsBox = document.getElementById('logsBox');

  let isRunning = false;

  function appendLog(text, level = 'info') {
    const line = document.createElement('div');
    line.className = `log-line log-${level}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${text}`;
    logsBox.appendChild(line);
    logsBox.scrollTop = logsBox.scrollHeight;
  }

  function updateUI(state) {
    isRunning = state.isRunning;

    const logoImg = document.getElementById('logoImg');
    if (isRunning) {
      statusBadge.textContent = '运行中';
      statusBadge.className = 'status-badge status-running';
      toggleBtn.textContent = '停止服务';
      toggleBtn.className = 'btn btn-danger';
      dotPort.className = 'dot dot-green';
      if (logoImg) logoImg.src = '../icons/icon-active-48.png';
    } else {
      statusBadge.textContent = '未启动';
      statusBadge.className = 'status-badge status-stopped';
      toggleBtn.textContent = '启动服务';
      toggleBtn.className = 'btn btn-primary';
      dotPort.className = 'dot dot-gray';
      if (logoImg) logoImg.src = '../icons/icon-inactive-48.png';
    }

    if (toggleDedicatedBtn) {
      if (!state.hasDedicatedTab) {
        dotWeb.className = 'dot dot-gray';
        webStatusText.textContent = 'API 专属实例 (未启动)';
        toggleDedicatedBtn.title = '尚未启动 API 专用网页，点击立即拉起并呼出到前台';
        toggleDedicatedBtn.innerHTML = '<span>⚡ 呼出专用网页</span><span class="active-pill" style="background:#f1f5f9;color:#64748b;">未启动</span>';
      } else if (state.isDedicatedVisible) {
        dotWeb.className = 'dot dot-green';
        webStatusText.innerHTML = 'API 专属实例 <span class="badge-exist">前台可见</span>';
        toggleDedicatedBtn.title = '当前 API 专用窗口处于前台，点击隐藏至后台静默运行';
        toggleDedicatedBtn.innerHTML = '<span>🙈 隐藏到后台</span><span class="active-pill">可见中</span>';
      } else {
        dotWeb.className = 'dot dot-green';
        webStatusText.innerHTML = 'API 专属实例 <span class="badge-exist">后台静默</span>';
        toggleDedicatedBtn.title = '当前 API 专用窗口处于后台静默，点击呼出至前台';
        toggleDedicatedBtn.innerHTML = '<span>👁️ 呼出专用网页</span><span class="active-pill">静默中</span>';
      }
    }

    const openPlaygroundBtn = document.getElementById('openPlaygroundBtn');
    if (openPlaygroundBtn) {
      if (state.hasPlaygroundTab) {
        openPlaygroundBtn.title = '调试工作台已在运行，点击直接置顶激活';
        openPlaygroundBtn.innerHTML = '<span>🎮 激活调试台</span><span class="active-pill">已有</span>';
      } else {
        openPlaygroundBtn.title = '在新标签页中打开可视化对话调试工作台';
        openPlaygroundBtn.innerHTML = '<span>🎮 对话调试台 ↗</span>';
      }
    }
  }

  // 1. 初始化拉取当前后台状态
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (res) {
      updateUI(res);
      if (Array.isArray(res.logs) && res.logs.length > 0) {
        logsBox.innerHTML = '';
        res.logs.forEach(l => appendLog(l.text, l.level));
      }
    }
  });

  // 2. 启动 / 停止 服务
  toggleBtn.addEventListener('click', () => {
    if (!isRunning) {
      appendLog('正在启动本地网关并检查网页...', 'info');
      toggleBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'START_SERVICE' }, (res) => {
        toggleBtn.disabled = false;
        if (res?.ok) {
          appendLog('本地网关已成功拉起，端口 8765 监听就绪！', 'success');
          updateUI(res.state);
        } else {
          appendLog('启动服务失败: ' + (res?.error || '未知错误'), 'err');
        }
      });
    } else {
      appendLog('正在停止本地网关服务...', 'info');
      toggleBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'STOP_SERVICE' }, (res) => {
        toggleBtn.disabled = false;
        if (res?.ok) {
          appendLog('服务已停止，端口已释放。', 'warn');
          updateUI(res.state);
        }
      });
    }
  });

  // 3. 复制 API 接口地址
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText('http://127.0.0.1:8765/v1/chat/completions').then(() => {
      const originalText = copyUrlBtn.innerHTML;
      copyUrlBtn.innerHTML = '<span>✅ 已复制到剪贴板</span>';
      setTimeout(() => {
        copyUrlBtn.innerHTML = originalText;
      }, 1500);
    });
  });

  // 4. 一键呼出 / 隐藏 API 专用网页（后台静默与前台查看自由切换）
  if (toggleDedicatedBtn) {
    toggleDedicatedBtn.addEventListener('click', () => {
      toggleDedicatedBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'TOGGLE_DEDICATED_VISIBILITY' }, (res) => {
        toggleDedicatedBtn.disabled = false;
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (latest) => {
          if (latest) updateUI(latest);
        });
      });
    });
  }

  // 5. 打开 / 激活交互式对话调试工作台 (Playground - 单例复用，不重复打开)
  const openPlaygroundBtn = document.getElementById('openPlaygroundBtn');
  if (openPlaygroundBtn) {
    openPlaygroundBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_PLAYGROUND' }, (res) => {
        const original = openPlaygroundBtn.innerHTML;
        if (res?.isNew) {
          openPlaygroundBtn.innerHTML = '<span>🚀 已新开调试台</span>';
        } else {
          openPlaygroundBtn.innerHTML = '<span>✅ 已置顶激活</span>';
        }
        setTimeout(() => {
          openPlaygroundBtn.innerHTML = original;
        }, 1500);
      });
    });
  }

  // 6. 模型卡片点击快速复制
  document.querySelectorAll('.model-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const modelName = chip.dataset.copy;
      navigator.clipboard.writeText(modelName).then(() => {
        const originalContent = chip.innerHTML;
        chip.innerHTML = '<span class="chip-name" style="color: #16a34a;">已复制!</span>';
        setTimeout(() => {
          chip.innerHTML = originalContent;
        }, 1200);
      });
    });
  });

  // 7. 清空日志
  clearLogsBtn.addEventListener('click', () => {
    logsBox.innerHTML = '';
    chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
  });

  // 8. 实时接收后台日志广播与状态推送
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NEW_LOG') {
      appendLog(msg.text, msg.level);
    } else if (msg.type === 'STATE_CHANGED') {
      updateUI(msg.state);
    }
  });
});
