param([Parameter(Mandatory=$true)][string]$Evidence,
      [Parameter(Mandatory=$true)][string]$ExpectedExe)
$deadline=(Get-Date).AddMinutes(20)
while(-not(Test-Path "$Evidence\report.json") -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 200}
$loadReport=Get-Content "$Evidence\report.json" -Raw | ConvertFrom-Json
$ownedProcess=Get-Process -Id $loadReport.pid -ErrorAction Stop
if($ownedProcess.Path -ne $ExpectedExe){throw 'Owned process path mismatch'}
while(-not $ownedProcess.HasExited -and -not(Test-Path "$Evidence\after-navigation.png") -and (Get-Date) -lt $deadline){
  Start-Sleep -Milliseconds 50
  $ownedProcess.Refresh()
}
$closeAccepted=$false
if(-not $ownedProcess.HasExited -and (Test-Path "$Evidence\after-navigation.png")){
  $closeAccepted=$ownedProcess.CloseMainWindow()
  $ownedProcess.WaitForExit(5000) | Out-Null
}
@{pid=$loadReport.pid;exe=$ExpectedExe;closeAccepted=$closeAccepted;hasExited=$ownedProcess.HasExited;
  finished=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content "$Evidence\clean-close.json"
