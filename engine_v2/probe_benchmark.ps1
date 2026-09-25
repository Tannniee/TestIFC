param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [switch]$WriteIndex,
    [switch]$CheckExtrusions,
    [switch]$CheckGraph,
    [switch]$WriteChunks,
    [int]$MaxSeconds = 0,
    [long]$MaxPrivateBytes = 0
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$scanner = Join-Path $PSScriptRoot 'IfcEngineV2.Scanner/bin/Release/net10.0/ifc-engine-v2-scanner.dll'
if (-not (Test-Path -LiteralPath $scanner)) { throw "Build the scanner first: $scanner" }
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$probeJson = Join-Path $outputPath 'probe.json'
$stdout = Join-Path $outputPath 'stdout.json'
$stderr = Join-Path $outputPath 'stderr.txt'
$arguments = @($scanner, 'probe', $sourcePath, '--output', $probeJson)
if ($WriteIndex) { $arguments += @('--index', (Join-Path $outputPath 'source.ifc2idx')) }
if ($CheckExtrusions) {
    if (-not $WriteIndex) { throw '-CheckExtrusions requires -WriteIndex.' }
    $arguments += '--check-extrusions'
}
if ($CheckGraph) {
    if (-not $WriteIndex) { throw '-CheckGraph requires -WriteIndex.' }
    $arguments += '--check-graph'
}
if ($WriteChunks) {
    if (-not $CheckGraph) { throw '-WriteChunks requires -CheckGraph.' }
    $arguments += @('--chunks', (Join-Path $outputPath 'chunks'))
}

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath 'dotnet' -ArgumentList $arguments -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$peakPrivate = 0L
$peakWorkingSet = 0L
$terminationReason = $null
while (-not $process.HasExited) {
    $process.Refresh()
    $peakPrivate = [Math]::Max($peakPrivate, $process.PrivateMemorySize64)
    $peakWorkingSet = [Math]::Max($peakWorkingSet, $process.WorkingSet64)
    if ($MaxSeconds -gt 0 -and $timer.Elapsed.TotalSeconds -gt $MaxSeconds) {
        $terminationReason = "Exceeded $MaxSeconds seconds"
        $process.Kill($true)
        break
    }
    if ($MaxPrivateBytes -gt 0 -and $peakPrivate -gt $MaxPrivateBytes) {
        $terminationReason = "Exceeded $MaxPrivateBytes private bytes"
        $process.Kill($true)
        break
    }
    Start-Sleep -Milliseconds 100
}
$process.WaitForExit()
$process.Refresh()
$peakPrivate = [Math]::Max($peakPrivate, $process.PeakPagedMemorySize64)
$peakWorkingSet = [Math]::Max($peakWorkingSet, $process.PeakWorkingSet64)
$timer.Stop()
$probe = if (Test-Path -LiteralPath $probeJson) { Get-Content -LiteralPath $probeJson -Raw | ConvertFrom-Json } else { $null }
$indexVerification = $null
if ($WriteIndex -and $process.ExitCode -eq 0) {
    $indexFile = [System.IO.File]::OpenRead((Join-Path $outputPath 'source.ifc2idx'))
    try {
        $header = [byte[]]::new(4096)
        $indexFile.ReadExactly($header, 0, $header.Length)
        $entriesRemaining = $indexFile.Length - 4096 - 48
        $entryHash = [System.Security.Cryptography.IncrementalHash]::CreateHash(
            [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        $buffer = [byte[]]::new(16 * 1024 * 1024)
        while ($entriesRemaining -gt 0) {
            $count = [int][Math]::Min($buffer.Length, $entriesRemaining)
            $indexFile.ReadExactly($buffer, 0, $count)
            $entryHash.AppendData($buffer, 0, $count)
            $entriesRemaining -= $count
        }
        $footer = [byte[]]::new(48)
        $indexFile.ReadExactly($footer, 0, $footer.Length)
        $indexVerification = [ordered]@{
            headerMagic = [System.Text.Encoding]::ASCII.GetString($header, 0, 8)
            footerMagic = [System.Text.Encoding]::ASCII.GetString($footer, 0, 8)
            sourceSizeMatches = [BitConverter]::ToInt64($header, 16) -eq $probe.SourceBytes
            sourceHashMatches = [Convert]::ToHexString($header, 40, 32) -eq $probe.SourceSha256
            countMatches = [BitConverter]::ToInt64($header, 32) -eq [BitConverter]::ToInt64($footer, 8)
            footerHashMatches = [Convert]::ToHexString($entryHash.GetHashAndReset()) -eq
                [Convert]::ToHexString($footer, 16, 32)
        }
    }
    finally { $indexFile.Dispose() }
}
$result = [ordered]@{
    source = $sourcePath
    sourceBytes = (Get-Item -LiteralPath $sourcePath).Length
    writeIndex = [bool]$WriteIndex
    checkExtrusions = [bool]$CheckExtrusions
    checkGraph = [bool]$CheckGraph
    writeChunks = [bool]$WriteChunks
    terminationReason = $terminationReason
    exitCode = $process.ExitCode
    wallMilliseconds = [Math]::Round($timer.Elapsed.TotalMilliseconds, 3)
    peakPrivateBytes = $peakPrivate
    peakWorkingSetBytes = $peakWorkingSet
    probe = $probe
    indexVerification = $indexVerification
    error = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'benchmark.json') -Encoding utf8
$result | ConvertTo-Json -Depth 3
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
