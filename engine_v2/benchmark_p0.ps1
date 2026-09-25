param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [ValidateRange(1, 20)]
    [int]$Runs = 3
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $PSScriptRoot 'IfcEngineV2.Scanner\IfcEngineV2.Scanner.csproj'
$executable = Join-Path $PSScriptRoot 'IfcEngineV2.Scanner\bin\Release\net10.0\ifc-engine-v2-scanner.exe'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [System.IO.Path]::GetFullPath($Output)

if (Test-Path -LiteralPath $outputPath) {
    throw "Choose a fresh output directory: $outputPath"
}

dotnet build $project -c Release --nologo
if ($LASTEXITCODE -ne 0) {
    throw 'Engine V2 scanner build failed.'
}

New-Item -ItemType Directory -Path $outputPath | Out-Null
$results = [System.Collections.Generic.List[object]]::new()

for ($run = 1; $run -le $Runs; $run++) {
    $runDirectory = Join-Path $outputPath ("run-{0:D2}" -f $run)
    New-Item -ItemType Directory -Path $runDirectory | Out-Null
    $manifestPath = Join-Path $runDirectory 'model.manifest.json'
    $indexPath = Join-Path $runDirectory 'model.ifc2idx'

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @('scan', $sourcePath, '--manifest', $manifestPath, '--index', $indexPath)) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not $process.Start()) {
        throw "Run $run did not start."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $maximumPrivateBytes = 0L
    $maximumWorkingSetBytes = 0L
    while (-not $process.HasExited) {
        $process.Refresh()
        $maximumPrivateBytes = [Math]::Max($maximumPrivateBytes, $process.PrivateMemorySize64)
        $maximumWorkingSetBytes = [Math]::Max($maximumWorkingSetBytes, $process.WorkingSet64)
        Start-Sleep -Milliseconds 50
    }
    $process.WaitForExit()
    $timer.Stop()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $stdout | Set-Content -LiteralPath (Join-Path $runDirectory 'stdout.jsonl') -Encoding utf8NoBOM
    $stderr | Set-Content -LiteralPath (Join-Path $runDirectory 'stderr.log') -Encoding utf8NoBOM
    if ($process.ExitCode -ne 0) {
        throw "Run $run failed with exit code $($process.ExitCode): $stderr"
    }

    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $results.Add([ordered]@{
        run = $run
        wallMilliseconds = $timer.Elapsed.TotalMilliseconds
        maximumPrivateBytes = $maximumPrivateBytes
        maximumWorkingSetBytes = $maximumWorkingSetBytes
        hashAndScanMilliseconds = $manifest.scan.hashAndScanMilliseconds
        indexMilliseconds = $manifest.scan.indexMilliseconds
        graphCoverageMilliseconds = $manifest.scan.graphCoverageMilliseconds
        graphStatus = $manifest.coverage.graph.status
        products = $manifest.coverage.graph.resolvedProductDefinitions
        baseDefinitions = $manifest.coverage.graph.geometryPlan.resolvedBaseDefinitions
        logicalInstances = $manifest.coverage.graph.logicalInstanceEstimate
        rawExpandedTriangles = $manifest.coverage.graph.geometryPlan.expandedTriangles
        cleanedExpandedTriangles = $manifest.coverage.graph.geometryPlan.cleanedExpandedTriangles
    })
}

$orderedWall = @($results | ForEach-Object { $_.wallMilliseconds } | Sort-Object)
$middle = [Math]::Floor($orderedWall.Count / 2)
$medianWall = if ($orderedWall.Count % 2 -eq 1) {
    $orderedWall[$middle]
} else {
    ($orderedWall[$middle - 1] + $orderedWall[$middle]) / 2
}
$summary = [ordered]@{
    format = 'ifc-engine-v2-p0-benchmark'
    version = 1
    source = $sourcePath
    runs = $results
    medianWallMilliseconds = $medianWall
    maximumPrivateBytes = (@($results | ForEach-Object { [long]$_['maximumPrivateBytes'] }) | Measure-Object -Maximum).Maximum
    maximumWorkingSetBytes = (@($results | ForEach-Object { [long]$_['maximumWorkingSetBytes'] }) | Measure-Object -Maximum).Maximum
}
$summaryPath = Join-Path $outputPath 'summary.json'
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
$summary | ConvertTo-Json -Depth 8
