$ErrorActionPreference = "Stop"

$referenceRoot = Join-Path $PSScriptRoot "dist"
$expectedCount = 92
$expectedBytes = 22835154
$expectedHashes = [ordered]@{
    "index.html" = "E54BCA0807E3FF54D147E34D29E2415EF5555BC413F1BD61656CA521851DDE9B"
    "assets\index-CTN4W5eG.js" = "E45E13D4F3706D01C2BFD533F1D644AC6D4E76E603CCC92EDBE851F6385E36CB"
    "assets\index-DDqxngMv.css" = "FEE9659B4FFC60A963EA1A6C2F93020639ABA372CF2E1F15D6C59F9282191EC4"
    "assets\ifc-convert.worker-BNq41fDG.js" = "4422AEED9A57EEC79CF6D3213D45762E378AEE702771C9FDE01F28889D91566C"
    "vendor\fragments\worker.mjs" = "ACC0CF3F5E2A70CCF769C9F6A239C81AB33C86A47D0A1E0827D44CB7A9E29A50"
}

$files = @(Get-ChildItem -LiteralPath $referenceRoot -Recurse -File)
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
$failures = [System.Collections.Generic.List[string]]::new()

if ($files.Count -ne $expectedCount) {
    $failures.Add("Expected $expectedCount files; found $($files.Count).")
}
if ($bytes -ne $expectedBytes) {
    $failures.Add("Expected $expectedBytes bytes; found $bytes.")
}

foreach ($entry in $expectedHashes.GetEnumerator()) {
    $path = Join-Path $referenceRoot $entry.Key
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $failures.Add("Missing reference file: $($entry.Key)")
        continue
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ne $entry.Value) {
        $failures.Add("Hash mismatch: $($entry.Key)")
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host "Reference frontend verified: $expectedCount files, $expectedBytes bytes, key hashes match."
