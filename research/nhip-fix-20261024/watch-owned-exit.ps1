param([Parameter(Mandatory=$true)][string]$Evidence,
      [Parameter(Mandatory=$true)][string]$ExpectedExe)
$deadline=(Get-Date).AddMinutes(22)
while(-not(Test-Path -LiteralPath "$Evidence\report.json") -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 200}
$report=Get-Content -LiteralPath "$Evidence\report.json" -Raw | ConvertFrom-Json
$nativeProcess=Get-Process -Id $report.pid -ErrorAction Stop
if($nativeProcess.Path -ne $ExpectedExe){throw 'Owned process path mismatch'}
$nativeHandle=$nativeProcess.Handle
while(-not $nativeProcess.WaitForExit(1000) -and (Get-Date) -lt $deadline){}
if(-not $nativeProcess.HasExited){throw 'Owned process has not exited'}
@{pid=$report.pid;exe=$ExpectedExe;handleCaptured=($nativeHandle -ne 0);
  exitCode=$nativeProcess.ExitCode;hasExited=$nativeProcess.HasExited;
  finished=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath "$Evidence\exit-code-witness.json"
if($nativeProcess.ExitCode -ne 0){throw "Native process exit code $($nativeProcess.ExitCode)"}
