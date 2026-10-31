@echo off
chcp 65001 >nul
set "DSH_NODE=%ProgramFiles%
odejs
ode.exe"
if not exist "%DSH_NODE%" (
  echo 未找到本机 Node.js，请检查 C: 的正常安装目录。
  exit /b 1
)
"%DSH_NODE%" "%~dp0scripts\open-dsh-local.mjs" --launch %*
exit /b %errorlevel%
