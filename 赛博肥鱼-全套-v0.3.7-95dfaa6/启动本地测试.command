#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ -d "release/v0.3.2/赛博肥鱼.app" ]]; then
  open -n "release/v0.3.2/赛博肥鱼.app" --args --cyberfish-local-test
  exit 0
elif [[ -d "release/v0.3.0/赛博肥鱼.app" ]]; then
  open -n "release/v0.3.0/赛博肥鱼.app" --args --cyberfish-local-test
  exit 0
elif [[ -d "release/v0.2.0/赛博肥鱼.app" ]]; then
  open -n "release/v0.2.0/赛博肥鱼.app" --args --cyberfish-local-test
  exit 0
fi
if [[ -d "release/mac-arm64/赛博肥鱼.app" ]]; then
  open -n "release/mac-arm64/赛博肥鱼.app" --args --cyberfish-local-test
else
  print '请先安装依赖并构建应用，或使用工作台里的独立本地测试按钮。'
fi
