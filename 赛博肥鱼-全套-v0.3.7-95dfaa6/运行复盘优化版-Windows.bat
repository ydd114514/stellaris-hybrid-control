@echo off
chcp 65001 >nul
set "reviewExe=%~dp0release\dsh-review-20261029-0.3.8\win-unpacked\大肥鱼 DSH.exe"
if not exist "%reviewExe%" (
  echo 尚未找到复盘优化版程序，请先完成打包。
  pause
  exit /b 1
)
start "" "%reviewExe%"
