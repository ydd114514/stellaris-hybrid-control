#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ -d "release/v0.3.2/赛博肥鱼.app" ]]; then
  open -n "release/v0.3.2/赛博肥鱼.app"
  exit 0
elif [[ -d "release/v0.3.0/赛博肥鱼.app" ]]; then
  open -n "release/v0.3.0/赛博肥鱼.app"
  exit 0
elif [[ -d "release/v0.2.0/赛博肥鱼.app" ]]; then
  open -n "release/v0.2.0/赛博肥鱼.app"
  exit 0
fi
if [[ -d "release/mac-arm64/赛博肥鱼.app" ]]; then
  open -n "release/mac-arm64/赛博肥鱼.app"
  exit 0
fi
if command -v node >/dev/null 2>&1; then
  task_node="$(command -v node)"
else
  task_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$task_node" || ! -d node_modules ]]; then
  print '请先打开 release 文件夹内的安装包，或按 README 安装开发环境。'
  read -k 1
  exit 1
fi
export PATH="$(dirname "$task_node"):$PATH"
"$task_node" scripts/dev.mjs
