$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$voiceRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$caption = [string]$voiceRequest.text
if ($caption.Length -lt 1 -or $caption.Length -gt 180) { throw 'Caption length out of range' }
$audioRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.local\commentary\audio'))
$outputFile = [System.IO.Path]::GetFullPath([string]$voiceRequest.output)
if (-not $outputFile.StartsWith($audioRoot + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($outputFile) -ne '.wav') { throw 'Unexpected audio output path' }
$speaker = New-Object -ComObject SAPI.SpVoice
$audioStream = New-Object -ComObject SAPI.SpFileStream
try {
  $chineseVoice = @($speaker.GetVoices() | Where-Object { $_.GetAttribute('Language') -match '(^|;)804($|;)' }) | Select-Object -First 1
  if (-not $chineseVoice) { throw 'No installed Simplified Chinese SAPI voice' }
  $speaker.Voice = $chineseVoice
  $speaker.Rate = 0
  $speaker.Volume = 85
  $audioStream.Open($outputFile,3,$false)
  $speaker.AudioOutputStream = $audioStream
  # SVSFIsNotXML: text is literal audience commentary, never SSML or code.
  $null = $speaker.Speak($caption,16)
  $audioStream.Close()
  @{ok=$true;voice=$chineseVoice.GetDescription()} | ConvertTo-Json -Compress
} finally {
  try { $audioStream.Close() } catch {}
  [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($audioStream)
  [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($speaker)
}
