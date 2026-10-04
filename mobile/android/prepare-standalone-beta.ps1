$ErrorActionPreference = 'Stop'

$androidRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $androidRoot '..\..')).Path
$cacheRoot = Join-Path $androidRoot '.runtime-cache'
$archiveName = 'nodejs-mobile-android-24.21.0-0.zip'
$archivePath = Join-Path $cacheRoot $archiveName
$runtimeRoot = Join-Path $cacheRoot 'node24'
$serverRoot = Join-Path $cacheRoot 'standalone-server'
$expectedSha256 = 'e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76'
$runtimeUrl = 'https://github.com/fogtape/nodejs-mobile/releases/download/v24.21.0-0/nodejs-mobile-android-24.21.0-0.zip'

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri $runtimeUrl -OutFile $archivePath -TimeoutSec 180
}
$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "Node mobile runtime checksum mismatch. Expected $expectedSha256, received $actualSha256."
}

$nodeLibrary = Join-Path $runtimeRoot 'bin\arm64-v8a\libnode.so'
$nodeHeader = Join-Path $runtimeRoot 'include\node\node.h'
if (-not (Test-Path -LiteralPath $nodeLibrary) -or -not (Test-Path -LiteralPath $nodeHeader) -or -not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'include\node\v8.h'))) {
    if (Test-Path -LiteralPath $runtimeRoot) {
        Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeRoot -Force
}
if (-not (Test-Path -LiteralPath $nodeLibrary) -or -not (Test-Path -LiteralPath $nodeHeader) -or -not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'include\node\v8.h'))) {
    throw 'The verified runtime archive does not contain the required arm64 library and headers.'
}
$nodeJniLibrary = Join-Path $runtimeRoot 'jniLibs\arm64-v8a\libnode.so'
New-Item -ItemType Directory -Force -Path (Split-Path $nodeJniLibrary) | Out-Null
Copy-Item -LiteralPath $nodeLibrary -Destination $nodeJniLibrary -Force

$serverRootFull = [IO.Path]::GetFullPath($serverRoot)
$cacheRootFull = [IO.Path]::GetFullPath($cacheRoot)
if (-not $serverRootFull.StartsWith($cacheRootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to replace the standalone server staging directory outside the local build cache.'
}
if (Test-Path -LiteralPath $serverRootFull) {
    Remove-Item -LiteralPath $serverRootFull -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $serverRootFull | Out-Null

$allowedFile = '^(server\.js|package\.json|package-lock\.json|webpack\.config\.js|LICENSE)$'
$allowedDirectory = '^(default|public|src|plugins)/'
$trackedFiles = & git -C $repoRoot ls-files
if ($LASTEXITCODE -ne 0) {
    throw 'Could not enumerate tracked DreamLand runtime source files.'
}
foreach ($relativePath in $trackedFiles) {
    if ($relativePath -notmatch $allowedFile -and $relativePath -notmatch $allowedDirectory) {
        continue
    }
    if ($relativePath -match '^src/electron/') {
        continue
    }
    $source = Join-Path $repoRoot $relativePath
    $destination = Join-Path $serverRootFull $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

# Mobile capability checks are shared by the connected WebView and standalone
# settings module. This small source file may be new and not yet tracked by Git.
$mobileCapabilityShim = Join-Path $repoRoot 'public\scripts\leslie-mobile-client.js'
if (-not (Test-Path -LiteralPath $mobileCapabilityShim -PathType Leaf)) {
    throw 'The Android mobile capability module is missing from the project source.'
}
$mobileCapabilityDestination = Join-Path $serverRootFull 'public\scripts\leslie-mobile-client.js'
Copy-Item -LiteralPath $mobileCapabilityShim -Destination $mobileCapabilityDestination -Force

Copy-Item -LiteralPath (Join-Path $repoRoot 'node_modules') -Destination (Join-Path $serverRootFull 'node_modules') -Recurse -Force
$env:HOME = $cacheRoot
Push-Location $serverRootFull
try {
    & npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not prune Android server dependencies using the existing local npm cache.'
    }
} finally {
    Pop-Location
}

# Local transformer pipelines are intentionally disabled in the phone beta.
# Their ONNX WASM bundles add over 100 MiB and are not needed for ordinary chat.
foreach ($package in @('sillytavern-transformers', 'onnxruntime-web')) {
    $packagePath = Join-Path $serverRootFull "node_modules\$package"
    if (Test-Path -LiteralPath $packagePath) {
        Remove-Item -LiteralPath $packagePath -Recurse -Force
    }
}

$nodeModulesRoot = (Resolve-Path (Join-Path $serverRootFull 'node_modules')).Path
$pruneDirectories = @(Get-ChildItem -LiteralPath $nodeModulesRoot -Directory -Recurse -Force |
    Where-Object { $_.Name -match '^(test|tests|__tests__|examples|benchmarks?)$' } |
    Sort-Object { $_.FullName.Length } -Descending)
foreach ($directory in $pruneDirectories) {
    if (-not (Test-Path -LiteralPath $directory.FullName)) { continue }
    $fullPath = [IO.Path]::GetFullPath($directory.FullName)
    if (-not $fullPath.StartsWith($nodeModulesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to prune files outside the staged npm dependency tree.'
    }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
}
$pruneFiles = @(Get-ChildItem -LiteralPath $nodeModulesRoot -File -Recurse -Force |
    Where-Object { $_.Name -match '\.(map|d\.ts)$|^(README|CHANGELOG|CONTRIBUTING)(\..*)?$' })
foreach ($file in $pruneFiles) {
    $fullPath = [IO.Path]::GetFullPath($file.FullName)
    if (-not $fullPath.StartsWith($nodeModulesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to prune files outside the staged npm dependency tree.'
    }
    if (Test-Path -LiteralPath $fullPath) { Remove-Item -LiteralPath $fullPath -Force }
}

$size = (Get-ChildItem -LiteralPath $serverRootFull -File -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Output "Node runtime verified: $actualSha256"
Write-Output "Standalone server staged at $serverRootFull ($([Math]::Round($size / 1MB, 1)) MiB before APK compression)."
