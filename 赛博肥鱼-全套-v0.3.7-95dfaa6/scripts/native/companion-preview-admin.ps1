param([ValidateSet('Inspect','StopCompanion','StartCompanion','StartFish')][string]$Action='Inspect',[string]$FishPath)
$ErrorActionPreference='Stop'
$mate=@(Get-Process -Name '直播伴侣' -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -eq '直播伴侣')
if($mate.Count -gt 1){throw '发现多个直播伴侣主窗口，停止自动重配。'}
switch($Action){
 'Inspect' { [pscustomobject]@{matePids=@($mate | ForEach-Object Id);fishRunning=[bool](Get-Process -Name '赛博肥鱼' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $FishPath -and $_.MainWindowTitle -like '赛博肥鱼*'})} | ConvertTo-Json -Compress }
 'StopCompanion' {foreach($item in $mate){Stop-Process -Id $item.Id -Force}}
 'StartCompanion' {$launcher=Join-Path $env:ProgramFiles 'Douyin Live Mate\webcast_mate\直播伴侣 Launcher.exe';Start-Process -FilePath $launcher -WindowStyle Normal}
 'StartFish' {Start-Process -FilePath $FishPath -ArgumentList '--force-renderer-accessibility' -WindowStyle Normal}
}
