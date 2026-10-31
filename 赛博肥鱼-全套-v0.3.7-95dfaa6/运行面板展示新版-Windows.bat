@echo off
chcp 65001 >nul
set "presentationExe=%~dp0release\dsh-presentation-20261029-0.3.10\win-unpacked\大肥鱼 DSH.exe"
if not exist "%presentationExe%" (
  echo 尚未找到0.3.10面板展示新版程序，请先完成打包。
  pause
  exit /b 1
)
start "" "%presentationExe%"
