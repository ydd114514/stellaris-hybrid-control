# Experimental diagnostic only: startup succeeded but loading has NOT been runtime-validated.
# Never use processStarted or the static proof as benchmark admission; read back the real world.
param([switch]$Execute,[int]$ExpectedPid=0,[string]$ExpectedCreationTime='',[switch]$Windowed)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$gameRoot='C:/Users/YDD/Documents/Paradox Interactive/Stellaris'
$gameExe='D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe'
$recordPath=Join-Path $gameRoot 'continue_game.json'
$relativeSave='save games/4_-1439839595/cyberfish_hybrid_baseline_2202.07.01'
$savePath=Join-Path $gameRoot ($relativeSave+'.sav')
$saveHash='576884af4e1a54d9bb13f429b93a96225a639ee719dd5644921351e57993b99e'
$exeHash='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83'
if ((Get-FileHash -LiteralPath $savePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $saveHash) { throw '初始存档哈希不符' }
if ((Get-FileHash -LiteralPath $gameExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $exeHash) { throw '群星EXE不符' }
$proof=Get-Content -LiteralPath (Join-Path $projectRoot '.local/hybrid-control/continue-loader/startup-proof.json') -Raw | ConvertFrom-Json
if ($proof.exeSha256 -ne $exeHash -or $proof.normalStartupFlag -ne '-continuelastsave') { throw '缺少已核对的正常续玩路径证据' }
$runDirectory=Join-Path $projectRoot ('.local/hybrid-control/reload-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($runDirectory) | Out-Null
$record=[ordered]@{directory=$runDirectory;execute=[bool]$Execute;savePath=$savePath;saveSha256=$saveHash;startupFlag='-continuelastsave';metadataModified=$false;processStopped=$false;processStarted=$false;runtimeValidated=$false}
try {
 if ($Execute) {
  if ($ExpectedPid -le 0 -or $ExpectedCreationTime -notmatch '^[0-9]{1,20}$') { throw '需要明确游戏PID及创建时间' }
  $selected=Get-Process -Id $ExpectedPid
  if (![string]::Equals($selected.Path,$gameExe.Replace('/','\'),[StringComparison]::OrdinalIgnoreCase) -or $selected.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $ExpectedCreationTime) { throw '选定游戏进程身份已变化' }
  $instances=@(Get-Process -Name stellaris -ErrorAction SilentlyContinue)
  if ($instances.Count -ne 1 -or $instances[0].Id -ne $ExpectedPid) { throw '群星进程不唯一' }
  Copy-Item -LiteralPath $recordPath -Destination (Join-Path $runDirectory 'continue_game.before.json')
  $lastAuto=Join-Path $gameRoot 'save games/4_-1439839595/autosave_2207.01.01.sav'
  if (Test-Path -LiteralPath $lastAuto) { Copy-Item -LiteralPath $lastAuto -Destination (Join-Path $runDirectory 'pre-reload-autosave_2207.01.01.sav') }
  Stop-Process -InputObject $selected
  if (!$selected.WaitForExit(15000)) { throw '旧游戏未退出，未写续玩记录或启动第二实例' }
  $record.processStopped=$true
  if ($Windowed) {
   $settingsPath=Join-Path $gameRoot 'settings.txt'
   $settingsText=[IO.File]::ReadAllText($settingsPath)
   Copy-Item -LiteralPath $settingsPath -Destination (Join-Path $runDirectory 'settings.before.txt')
   $sizePattern='(?s)(graphics\s*=\s*\{\s*size\s*=\s*\{\s*x=)[0-9]+(\s*y=)[0-9]+'
   if ([regex]::Matches($settingsText,$sizePattern).Count -ne 1 -or $settingsText -notmatch 'borderless=yes' -or $settingsText -notmatch 'fullScreen=no') { throw '图形设置与已核对结构不同' }
   $settingsText=[regex]::Replace($settingsText,$sizePattern,'${1}1920${2}1080')
   $settingsText=$settingsText.Replace('borderless=yes','borderless=no')
   [IO.File]::WriteAllText($settingsPath,$settingsText,[Text.UTF8Encoding]::new($false));$record.windowedSettingsModified=$true
  }
  $next=[ordered]@{title=$relativeSave;desc='地球联合国 4';date='2202.07.01'} | ConvertTo-Json
  [IO.File]::WriteAllText($recordPath,$next,[Text.UTF8Encoding]::new($false));$record.metadataModified=$true
  $started=Start-Process -FilePath $gameExe -WorkingDirectory (Split-Path -Parent $gameExe) -ArgumentList @('-dx11','-continuelastsave','-gdpr-compliant') -WindowStyle Normal -PassThru
  $record.processStarted=$true;$record.newPid=$started.Id
 }
} catch { $record.error=$_.Exception.Message; throw }
finally { $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runDirectory 'lifecycle.json') -Encoding utf8; $record | ConvertTo-Json -Depth 5 -Compress }
