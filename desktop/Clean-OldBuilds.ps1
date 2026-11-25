# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

<#
.SYNOPSIS
Preview or remove only audited IFC-Lite intermediate builds.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\Clean-OldBuilds.ps1
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\Clean-OldBuilds.ps1 -Apply
.NOTES
Default: preview only. Compatible with Windows PowerShell 5.1 and PowerShell 7.
Keep source, models, dependencies, current frontend, reports, release build
outputs and three delivered releases. Never stop processes automatically.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([switch]$Apply)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$WorkspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$AuditCutoffUtc = [DateTimeOffset]::Parse('2026-10-14T02:57:58Z').UtcDateTime
$GitExe = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

# Fixed allowlist, not a glob or paths taken from an editable JSON report.
$CacheDirectories = @('desktop/src-tauri/target/debug', 'target/debug', '.turbo/cache', 'desktop/dist/assets')
$OldExecutables = @(
    @('desktop/release/10.3.0-native-72420ce/IFC-Lite-10.3.0.exe', '33C75969596C8C772E65206B4BB0CEA650CF53471C85BC9C935904DBF2AEBEB0'),
    @('desktop/release/10.3.0-native-audit-20261009/IFC-Lite.exe', '3A1F8166EEEEDE26812447F720EB966A4D80EC870DE09A7ECCA61419F51C9079'),
    @('desktop/release/10.3.0-native-fixes-b13725a/IFC-Lite-10.3.0.exe', '91858E97CCB9FA6ECD7C0A8AB36E5E8E16B11E192D9290CFAA2472F72A3E1312'),
    @('desktop/release/10.3.0-native-preview-eadd8f5/IFC-Lite-Native-Preview.exe', '3B09A0A596B63E224703F4F316EC9E3624C74DC5A197F8B8DF1BF1DAC5C79AF7'),
    @('desktop/release/10.3.0-native-pvf-20261009/IFC-Lite-10.3.0.exe', '5334A036AD8170C01F905F4BC951B318514ECCC17B5B83876766D63821309659'),
    @('desktop/release/10.3.0-native-pvf-responsive-20261009/IFC-Lite.exe', '6827568D097BCC984E55178A5E8FC429B57B8F9D90EC68C2788F0B9EAA7E706F'),
    @('desktop/release/10.3.0-oled-native-d40f7e8/IFC-Lite-10.3.0.exe', '144D8CD6CDEB3521C0D2893E32D8C4B1145CD636A327687D7021A91E4FA617CD'),
    @('desktop/release/10.3.0-ui-0756f24/IFC-Lite.exe', '2FE2F91D6AF00B3A55D18E0BB20D1A429E00EA5CDB7CEEFA46A17EC9F7239658'),
    @('desktop/release/10.3.0-ui-0756f24/IFC-Lite_10.3.0_x64-setup.exe', '9C94EB5233AC0F16AEF70F2D4F0722CC12B740334C0F45B2D3AE73883FE01A1F')
)
$ProtectedExecutables = @(
    @('desktop/release/10.3.0/IFC-Lite.exe', '67AEE7AD58F8A7E69ADA890CA11A950D8ABD4C80A18A90465212434D2AF8629C'),
    @('desktop/release/10.3.0/IFC-Lite_10.3.0_x64-setup.exe', '0B7C0BDE14FCB12CA6B814A67ECAF4290C07318468F771D290FAB034C0C917ED'),
    @('desktop/release/10.3.0-native-followup-20261010/IFC-Lite.exe', '62802ABCE58035684AF3E2EDAE82BD3873AEE63AEEE9260ED6B545A9D39F537B'),
    @('desktop/release/10.3.0-native-navigation-250ms-20261010/IFC-Lite.exe', 'B2161DB529B151814AD0D9F3217CEDDF94C537A689BAFA1DBB450BCD49A774AA')
)
$OldHashes = @{}
foreach ($entry in $OldExecutables) { $OldHashes[$entry[0]] = $entry[1] }

function Test-Within([string]$Path, [string]$Parent) {
    return $Path.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or
        $Path.StartsWith($Parent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoLinkAncestors([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link/junction is not allowed: $cursor" }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\', '/'))
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-SafePath([string]$Relative) {
    $path = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot $Relative))
    if ($path -eq $WorkspaceRoot -or -not (Test-Within $path $WorkspaceRoot)) { throw "Outside allowed workspace: $path" }
    Assert-NoLinkAncestors $path
    return $path
}

function Get-Sha256([string]$Path) {
    # A direct read also works under Windows PowerShell 5.1 -WhatIf;
    # some versions of Get-FileHash propagate WhatIf to path resolution.
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-Hash([string]$Relative, [string]$Expected) {
    $path = Get-SafePath $Relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required EXE is missing: $path" }
    if ((Get-Sha256 $path) -ne $Expected) { throw "EXE changed since audit; stop and re-audit: $path" }
}

function Assert-ProtectedReleases {
    foreach ($entry in $ProtectedExecutables) { Assert-Hash $entry[0] $entry[1] }
}

function Assert-NoActiveUsers {
    $active = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.ProcessId -ne $PID -and (
            $_.Name -match '^(IFC-Lite.*|ifc-lite-desktop|ifc_lite_server|cargo|rustc|rustdoc|rust-analyzer)\.exe$' -or
            ($_.ExecutablePath -and (Test-Within $_.ExecutablePath $WorkspaceRoot)) -or
            ($_.Name -match '^node\.exe$' -and $_.CommandLine -and (
                $_.CommandLine.IndexOf($WorkspaceRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $_.CommandLine -match '[\\/](vite|turbo|tauri|pnpm)([\\/]|\.js|\.cjs|\.mjs)'
            ))
        )
    })
    if ($active.Count) {
        $names = ($active | ForEach-Object { '{0} (PID {1})' -f $_.Name, $_.ProcessId }) -join ', '
        throw "App, development tools or compiler may be using builds. Close/wait for these processes first: $names"
    }
}

function Assert-UntrackedAndIgnored([string]$Relative) {
    $tracked = @(& $GitExe --literal-pathspecs -C $WorkspaceRoot ls-files -- $Relative)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify tracked files with Git.' }
    if ($tracked.Count) { throw "Contains Git-tracked files; refusing cleanup: $Relative" }
    & $GitExe -C $WorkspaceRoot check-ignore -q -- $Relative
    if ($LASTEXITCODE -ne 0) { throw "Not an ignored build artifact: $Relative" }
}

function Get-Inventory([string]$Relative, [bool]$Directory) {
    $path = Get-SafePath $Relative
    if (-not (Test-Path -LiteralPath $path)) { Write-Host "Already absent: $Relative"; return $null }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -ne $Directory) { throw "Unexpected file/directory type: $path" }
    Assert-UntrackedAndIgnored $Relative
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $records = New-Object 'System.Collections.Generic.List[object]'
    if ($Directory) { $stack.Push($path) } else { $records.Add($item) }
    while ($stack.Count) {
        foreach ($child in Get-ChildItem -LiteralPath $stack.Pop() -Force) {
            if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link/junction inside cleanup target: $($child.FullName)" }
            if (-not (Test-Within $child.FullName $path)) { throw 'Enumeration escaped the cleanup target.' }
            if ($child.PSIsContainer) {
                if ($child.Name -eq '.git') { throw "Nested Git repository: $($child.FullName)" }
                $stack.Push($child.FullName)
            } else { $records.Add($child) }
        }
    }
    [long]$bytes = 0
    [DateTime]$latest = [DateTime]::MinValue
    foreach ($file in $records) {
        if ($file.LastWriteTimeUtc -gt $AuditCutoffUtc) { throw "New files since audit; stop and re-audit: $($file.FullName)" }
        if ($file.Extension -match '^\.(ifc|ifcx|ifczip|ifcw|pvf|dwg|dxf)$') { throw "Model/CAD data found; keep it: $($file.FullName)" }
        $bytes += $file.Length
        if ($file.LastWriteTimeUtc -gt $latest) { $latest = $file.LastWriteTimeUtc }
    }
    return [pscustomobject]@{ Relative = $Relative; Path = $path; Directory = $Directory; Files = $records.Count; Bytes = $bytes; LatestUtc = $latest }
}

# The script is tied to the repo next to it, never to the current terminal folder.
Assert-NoLinkAncestors $WorkspaceRoot
$gitRoot = & $GitExe -C $WorkspaceRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($gitRoot.Trim()).TrimEnd('\', '/') -ne $WorkspaceRoot) {
    throw 'Script must live in the desktop directory of the intended IFC-Lite Git checkout.'
}
$tauriPath = Get-SafePath 'desktop/src-tauri/tauri.conf.json'
$tauri = Get-Content -LiteralPath $tauriPath -Raw | ConvertFrom-Json
$currentFrontend = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $tauriPath) $tauri.build.frontendDist))
foreach ($relative in $CacheDirectories) {
    $candidate = Get-SafePath $relative
    if ((Test-Within $currentFrontend $candidate) -or (Test-Within $candidate $currentFrontend)) {
        throw "Current frontend is inside a cleanup target: $currentFrontend"
    }
}
Assert-ProtectedReleases
Assert-NoActiveUsers

$plan = New-Object 'System.Collections.Generic.List[object]'
foreach ($relative in $CacheDirectories) {
    Write-Host "Inspecting: $relative"
    $entry = Get-Inventory $relative $true
    if ($entry) { $plan.Add($entry) }
}
foreach ($old in $OldExecutables) {
    $path = Get-SafePath $old[0]
    if (Test-Path -LiteralPath $path) {
        Assert-Hash $old[0] $old[1]
        $entry = Get-Inventory $old[0] $false
        $plan.Add($entry)
    } else { Write-Host "Already absent: $($old[0])" }
}
$plan | Select-Object Relative, Files, @{ Name = 'GiB'; Expression = { [math]::Round($_.Bytes / 1GB, 3) } } | Format-Table -AutoSize
Write-Host 'Preserved: all source/models/dependencies/reports, current frontend, target/release,'
Write-Host 'target/server-release, and releases 10.3.0, native-followup, native-navigation-250ms.'
Write-Host 'Sizes are file totals; recovered disk space is smaller where files share hardlinks.'
if (-not $Apply) {
    Write-Host 'PREVIEW ONLY. Nothing deleted. Add -Apply to execute, or -Apply -WhatIf to preview actions.'
    return
}

# Finish ALL checks before the first removal. Recheck each target before use.
$drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($WorkspaceRoot))
$freeBefore = $drive.AvailableFreeSpace
$results = New-Object 'System.Collections.Generic.List[object]'
$failure = $null
try {
    foreach ($target in $plan) {
        Assert-NoActiveUsers
        Assert-ProtectedReleases
        $current = Get-Inventory $target.Relative $target.Directory
        if (-not $current -or $current.Path -ne $target.Path -or $current.Bytes -ne $target.Bytes -or
            $current.Files -ne $target.Files -or $current.LatestUtc -ne $target.LatestUtc) {
            throw "Cleanup target changed during preflight: $($target.Relative)"
        }
        if (-not $target.Directory) {
            Assert-Hash $target.Relative $OldHashes[$target.Relative]
        }
        if ($PSCmdlet.ShouldProcess($target.Path, 'Delete audited intermediate build')) {
            # Absolute target and all descendants were checked for containment,
            # tracked files, new files and links. No shell handoff or wildcard.
            Remove-Item -LiteralPath $current.Path -Recurse:$current.Directory -Force -Confirm:$false -ErrorAction Stop
            $results.Add([pscustomobject]@{ Path = $current.Path; LogicalBytes = $current.Bytes; Deleted = $true })
            Write-Host "Deleted: $($target.Relative)"
        }
    }
    Assert-ProtectedReleases
} catch {
    $failure = $_.Exception.Message
    throw
} finally {
    if (-not $WhatIfPreference) {
        $logFolder = Get-SafePath 'desktop/reports'
        if (-not (Test-Path -LiteralPath $logFolder)) { New-Item -ItemType Directory -Path $logFolder | Out-Null }
        $logPath = Join-Path $logFolder ('cleanup-run-{0}-{1}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID)
        $summary = [pscustomobject]@{ Workspace = $WorkspaceRoot; CompletedAt = (Get-Date).ToUniversalTime().ToString('o'); Deleted = $results.ToArray(); Failure = $failure; DriveFreeDeltaBytes = ($drive.AvailableFreeSpace - $freeBefore) }
        $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $logPath -Encoding UTF8
        Write-Host "Cleanup log: $logPath"
        Write-Host ('Volume free-space change: {0:N2} GiB (other activity can affect this).' -f (($drive.AvailableFreeSpace - $freeBefore) / 1GB))
    }
}
Write-Host 'Done. Preserved EXE hashes verified. Future Debug builds will regenerate their cache.'
