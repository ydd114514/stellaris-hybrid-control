param(
  [Parameter(Mandatory=$true)][ValidateSet('read','write')][string]$Command,
  [Parameter(Mandatory=$true)][string]$CredentialPath
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
  $taskEntropy = [Text.Encoding]::UTF8.GetBytes('cyberfish.stellaris-player.deepseek.v1')
  $taskScope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($Command -eq 'write') {
    $taskKey = [Console]::In.ReadToEnd().Trim()
    if ($taskKey -notmatch '^sk-[A-Za-z0-9_-]{20,200}$') { throw 'INVALID' }
    $taskPlain = [Text.Encoding]::UTF8.GetBytes($taskKey)
    try { $taskProtected = [Security.Cryptography.ProtectedData]::Protect($taskPlain,$taskEntropy,$taskScope) }
    finally { [Array]::Clear($taskPlain,0,$taskPlain.Length); $taskKey=$null }
    $taskDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($CredentialPath))
    [void][IO.Directory]::CreateDirectory($taskDirectory)
    $taskTemporary = $CredentialPath + '.tmp'
    [IO.File]::WriteAllBytes($taskTemporary,$taskProtected)
    [IO.File]::Move($taskTemporary,$CredentialPath,$true)
    [Console]::Out.Write('OK')
  } else {
    if (-not [IO.File]::Exists($CredentialPath)) { exit 3 }
    if (([IO.FileInfo]$CredentialPath).Length -gt 4096) { throw 'INVALID' }
    $taskProtected = [IO.File]::ReadAllBytes($CredentialPath)
    $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect($taskProtected,$taskEntropy,$taskScope)
    try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($taskPlain)) }
    finally { [Array]::Clear($taskPlain,0,$taskPlain.Length) }
  }
} catch { [Console]::Error.Write('CREDENTIAL_STORE_ERROR'); exit 1 }
