@echo off
chcp 65001 >nul
set "closureExe=%~dp0release\dsh-closure-20261029-0.3.9\win-unpacked\大肥鱼 DSH.exe"
if not exist "%closureExe%" (
  echo 尚未找到0.3.9闭环新版程序，请先完成打包。
  pause
  exit /b 1
)
start "" "%closureExe%"
