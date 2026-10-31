$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
& 'C:\Program Files\Git\bin\bash.exe' -lc 'node scripts/start-commentary.mjs'
if ($LASTEXITCODE -ne 0) { throw '解说面板启动失败' }
Start-Process 'http://127.0.0.1:17655'
