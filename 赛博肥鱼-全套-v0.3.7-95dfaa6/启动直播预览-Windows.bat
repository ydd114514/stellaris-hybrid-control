@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "CYBER_FISH_TEST_DATA_DIR="
set "VITE_DEV_SERVER_URL="
node scripts\start-windows-preview.mjs --apply
if errorlevel 1 pause
