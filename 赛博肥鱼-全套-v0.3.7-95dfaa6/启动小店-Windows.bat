@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "VITE_DEV_SERVER_URL="
if exist "release\win-unpacked\赛博肥鱼.exe" (
  start "" "release\win-unpacked\赛博肥鱼.exe"
  exit /b
)
if exist "node_modules\electron\dist\electron.exe" if exist "dist\electron\main.cjs" (
  set ELECTRON_RUN_AS_NODE=
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b
)
echo 请先安装 release 文件夹里的 Windows 安装包，或在源码目录运行 pnpm install 和 pnpm build。
pause
