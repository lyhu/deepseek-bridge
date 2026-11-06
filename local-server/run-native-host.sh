#!/bin/bash
# 自动寻找系统中的 node 运行时
NODE_BIN=$(which node 2>/dev/null)

if [ -z "$NODE_BIN" ]; then
  # Chrome 以 GUI 方式拉起 Native Host 时 PATH 通常只有系统目录，
  # 因此需要枚举各版本管理器的绝对路径（fnm/nvm/volta/asdf 等）
  for p in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node "$HOME/.nvm/versions/node/"*/bin/node "$HOME/.asdf/shims/node" "$HOME/.volta/bin/node" "$HOME/.local/share/fnm/node-versions/"*/installation/bin/node "$HOME/.local/state/fnm_multishells/"*/bin/node; do
    if [ -x "$p" ]; then
      NODE_BIN="$p"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "Error: Node.js runtime not found" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$NODE_BIN" "$DIR/native-host.js"
