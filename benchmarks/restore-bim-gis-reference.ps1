param([string]$ReferenceDirectory = 'F:\Steel\VBA\bim-gis-reference')
$ErrorActionPreference = 'Stop'
$commit = 'e3de3b97c0d37b7feb3211b30cd8fe8393c31e01'
if (-not (Test-Path -LiteralPath $ReferenceDirectory)) {
    git clone https://github.com/helenkwok/bim-gis-viewer.git $ReferenceDirectory
    if ($LASTEXITCODE) { throw 'Reference clone failed' }
    git -C $ReferenceDirectory checkout $commit
    if ($LASTEXITCODE) { throw 'Reference checkout failed' }
}
if ((git -C $ReferenceDirectory rev-parse HEAD) -ne $commit) { throw 'Reference HEAD differs from the pinned upstream commit' }
$gisPath = Join-Path $ReferenceDirectory 'src\gis.js'
$source = [IO.File]::ReadAllText($gisPath)
if (-not $source.Contains('let coordinatesData')) {
    $source = [regex]::Replace($source, '(?m)^let coordinates\r?$', "let coordinates`nlet coordinatesData")
}
$source = $source.Replace('process.env.MAPBOX_API_KEY', 'localStorage.getItem("mapbox-public-token") || ""')
# Mapbox 2.10 queries marker opacity while fog initialized in `load` has not
# yet been evaluated. Initialize it in style.load before the first style paint.
$fogLine = "    map.setFog({'range': [0.8, 8]});"
$source = [regex]::Replace($source, [regex]::Escape($fogLine) + '\r?\n', '')
$source = $source.Replace("map.on('style.load', () => {", "map.on('style.load', () => {`n$fogLine")
[IO.File]::WriteAllText($gisPath, $source, [Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $ReferenceDirectory
try {
    npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'Reference dependency installation failed' }
    npm run build
    if ($LASTEXITCODE) { throw 'Reference build failed' }
} finally { Pop-Location }
Write-Output 'Restored the pinned BIM-GIS reference with runtime token, coordinate declaration and fog initialization fixes.'
