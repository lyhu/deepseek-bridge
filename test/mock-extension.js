const WebSocket = require('ws');

class MockExtension {
  constructor(wsUrl = 'ws://127.0.0.1:8765/ws') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.connected = false;
    this.taskHandler = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err) => {
        if (!this.connected) reject(err);
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'PING') {
            this.send({ type: 'PONG' });
            return;
          }
          if (msg.type === 'TRANSLATE_TASK') {
            if (this.taskHandler) {
              this.taskHandler(msg);
            } else {
              // 默认模拟返回
              this.simulateDefaultResponse(msg);
            }
          }
        } catch (e) {
          console.error('[MockExtension] 解析消息失败:', e);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  setTaskHandler(handler) {
    this.taskHandler = handler;
  }

  simulateDefaultResponse(task) {
    const { requestId, prompt } = task;
    const replyText = `[Mock翻译结果]: ${prompt.slice(0, 30)}`;
    const words = replyText.split('');

    // 模拟逐字流式返回
    let i = 0;
    const interval = setInterval(() => {
      if (i < words.length) {
        this.send({
          requestId,
          chunk: words[i],
          done: false
        });
        i++;
      } else {
        clearInterval(interval);
        this.send({
          requestId,
          text: replyText,
          done: true
        });
      }
    }, 20);
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

module.exports = { MockExtension };
