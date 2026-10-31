$ErrorActionPreference='Stop'
$taskStopDirectory=Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $taskStopDirectory -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskStopDirectory 'STOP') -Value ([DateTime]::UtcNow.ToString('O')) -Encoding utf8
Write-Host '停止指令已发送；控制器将结束当前步骤并暂停群星。'
