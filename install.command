#!/bin/bash

# 获取脚本所在根目录绝对路径
DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$DIR/local-server/run-native-host.sh"
EXTENSION_ID="oghpkkcfomnabdlcjpcgpknjekghlbgn"

# 赋予宿主脚本执行权限
chmod +x "$HOST_SCRIPT"
chmod +x "$DIR/local-server/native-host.js"

# 目标安装目录 (macOS Google Chrome)
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$TARGET_DIR"

MANIFEST_FILE="$TARGET_DIR/com.deepseek.web_bridge.json"

cat <<EOF > "$MANIFEST_FILE"
{
  "name": "com.deepseek.web_bridge",
  "description": "DeepSeek Local OpenAI Bridge Native Messaging Host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

# 赋予配置文件读取权限
chmod 644 "$MANIFEST_FILE"

echo "========================================================"
echo "🎉 安装成功！DeepSeek 本地网关已成功注册到 Chrome。"
echo "配置文件路径: $MANIFEST_FILE"
echo "========================================================"

# 使用原生 macOS 弹窗提示
osascript -e 'display dialog "🎉 DeepSeek 本地网关已成功注册到 Chrome！\n\n现在您可以直接在 Chrome 浏览器右上角点击插件图标，在面板中一键【启动服务】即可！" with title "DeepSeek 代理网关安装就绪" buttons {"好的"} default button "好的"' 2>/dev/null || true

exit 0
