$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host '大肥鱼：DeepSeek / DSH 群星原生玩家'
Write-Host '使用实时游戏数据和正常引擎指令。游戏未开时会恢复已配置的独立测试存档。'
Write-Host '需要停止时运行同目录的「停止群星AI.bat」，控制器会暂停游戏。'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$taskHasStoredKey = Test-Path -LiteralPath (Join-Path $PSScriptRoot '.local\credentials\deepseek.dpapi')
if ($taskHasStoredKey) {
  Write-Host '使用已加密保存的 DeepSeek 密钥。'
} elseif (-not $env:DEEPSEEK_API_KEY) {
  $taskKey = Read-Host '输入 DeepSeek API Key（仅本次进程使用）' -AsSecureString
  $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskKey)
  try { $env:DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
}
try {
  & 'C:\Program Files\Git\bin\bash.exe' -lc 'node scripts/autoplay-native.mjs'
} finally { Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue }
Read-Host '本轮结束，按回车关闭'
