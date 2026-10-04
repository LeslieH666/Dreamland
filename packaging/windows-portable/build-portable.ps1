param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [switch]$CleanExisting
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$MarkerPath = Join-Path $OutputPath '.leslie-portable-package'

# A MomoTalk build must not silently ship without its required artwork.
$assetPrepareScript = Join-Path $ProjectRoot 'scripts\prepare-blue-archive-assets.cjs'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$assetRuntime = if ($nodeCommand) { $nodeCommand.Source } else {
    @((Join-Path $ProjectRoot 'Runtime\electron.exe'), (Join-Path $ProjectRoot 'src\electron\node_modules\electron\dist\electron.exe')) |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $assetRuntime) { throw 'A Node or Electron runtime is required to verify the BA artwork.' }
function Invoke-BaAssetPreparation {
    param([string]$Destination)
    $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        if (-not $nodeCommand) { $env:ELECTRON_RUN_AS_NODE = '1' }
        & $assetRuntime $assetPrepareScript $Destination
        if ($LASTEXITCODE -ne 0) { throw 'Restore the local BA artwork before building this package.' }
    } finally { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
}
Invoke-BaAssetPreparation -Destination '--check'

if ([IO.Path]::GetPathRoot($OutputPath) -eq $OutputPath -or $OutputPath.Length -lt 10) {
    throw "Refusing to build into an unsafe output path: $OutputPath"
}

if (Test-Path -LiteralPath $OutputPath) {
    $existing = @(Get-ChildItem -LiteralPath $OutputPath -Force)
    if ($existing.Count -gt 0) {
        if (-not $CleanExisting) {
            throw "Output directory is not empty: $OutputPath"
        }
        if (-not (Test-Path -LiteralPath $MarkerPath)) {
            throw 'The existing directory is not a DreamLand portable package. Refusing to clean it.'
        }
        Get-ChildItem -LiteralPath $OutputPath -Force | Remove-Item -Recurse -Force
    }
} else {
    New-Item -ItemType Directory -Path $OutputPath | Out-Null
}

[IO.File]::WriteAllText($MarkerPath, "DreamLand Windows portable package`r`n", [Text.UTF8Encoding]::new($false))

$AppPath = Join-Path $OutputPath 'App'
$RuntimePath = Join-Path $OutputPath 'Runtime'
$ConfigPath = Join-Path $OutputPath 'Config'
$AssetsPath = Join-Path $PSScriptRoot 'assets'

foreach ($directory in @($AppPath, $RuntimePath, $ConfigPath, (Join-Path $OutputPath 'UserData'), (Join-Path $OutputPath 'Logs'), (Join-Path $OutputPath 'Backups'), (Join-Path $OutputPath 'Cache'), (Join-Path $OutputPath 'Run'), (Join-Path $OutputPath 'Scripts'))) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

function Invoke-RobocopyChecked {
    param([string[]]$Arguments)
    & robocopy.exe @Arguments | Out-Host
    if ($LASTEXITCODE -ge 8) {
        throw "Robocopy failed with exit code $LASTEXITCODE"
    }
}

$excludedDirectories = @(
    (Join-Path $ProjectRoot '.git'),
    (Join-Path $ProjectRoot '.github'),
    (Join-Path $ProjectRoot '.agents'),
    (Join-Path $ProjectRoot '.codex'),
    (Join-Path $ProjectRoot '.devcontainer'),
    (Join-Path $ProjectRoot '.gemini'),
    (Join-Path $ProjectRoot '.npm-test-cache'),
    (Join-Path $ProjectRoot '.vscode'),
    (Join-Path $ProjectRoot 'backups'),
    (Join-Path $ProjectRoot 'cache'),
    (Join-Path $ProjectRoot 'Cache'),
    (Join-Path $ProjectRoot 'character-card-sources'),
    (Join-Path $ProjectRoot 'Config'),
    (Join-Path $ProjectRoot 'data'),
    (Join-Path $ProjectRoot 'dist'),
    (Join-Path $ProjectRoot 'docs'),
    (Join-Path $ProjectRoot 'docker'),
    (Join-Path $ProjectRoot 'legacy-portable-package'),
    (Join-Path $ProjectRoot 'logs'),
    (Join-Path $ProjectRoot 'node_modules'),
    (Join-Path $ProjectRoot 'notes'),
    (Join-Path $ProjectRoot 'resources\blue-archive\ui-library'),
    (Join-Path $ProjectRoot 'packaging'),
    (Join-Path $ProjectRoot 'Run'),
    (Join-Path $ProjectRoot 'Runtime'),
    (Join-Path $ProjectRoot 'test-results'),
    (Join-Path $ProjectRoot 'tests'),
    (Join-Path $ProjectRoot 'src\electron\node_modules'),
    (Join-Path $ProjectRoot 'public\scripts\extensions\third-party'),
    (Join-Path $ProjectRoot 'public\img\blue-archive\local'),
    (Join-Path $ProjectRoot 'public\img\blue-archive\bundled')
)

$sourceArguments = @(
    $ProjectRoot,
    $AppPath,
    '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/MT:16', '/NP', '/NFL', '/NDL',
    '/XD'
) + $excludedDirectories + @(
    '/XF', '*.log', '.env', '.env.*', 'config.yaml', 'AGENTS.md', 'PROJECT_BRIEF.md', 'PROJECT_STATUS.md', 'design.md',
    '.dockerignore', '.editorconfig', '.eslintrc.cjs', '.gitignore', '.nomedia', '.npmignore', '.npmrc',
    'CHARACTER_CARD_WORKFLOW.md', 'CONTRIBUTING.md', 'Dockerfile', 'index.d.ts', 'jsconfig.json',
    'start.sh', '*.bat',
    'UNIFIED_WORKSPACE.md', 'merge-user-data.cjs', '*.cmd'
)
Invoke-RobocopyChecked -Arguments $sourceArguments

# The broad source copy excludes local previews. Include only verified artwork.
Invoke-BaAssetPreparation (Join-Path $AppPath 'public\img\blue-archive\bundled')

# The managed GGUF flow calls these scripts from the Electron app root. Keep
# them in portable builds even though the rest of packaging/ stays excluded.
$managedModelScripts = Join-Path $AppPath 'packaging\windows-local'
New-Item -ItemType Directory -Path $managedModelScripts -Force | Out-Null
foreach ($scriptName in @('Start-LocalModel.ps1', 'Stop-LocalModel.ps1')) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "packaging\windows-local\$scriptName") -Destination (Join-Path $managedModelScripts $scriptName) -Force
}

# Robocopy's /XF pattern applies at every depth. Restore the non-personal
# default config that SillyTavern uses to fill missing portable config values.
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'default\config.yaml') -Destination (Join-Path $AppPath 'default\config.yaml') -Force

Invoke-RobocopyChecked -Arguments @(
    (Join-Path $ProjectRoot 'node_modules'),
    (Join-Path $AppPath 'node_modules'),
    '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/MT:16', '/NP', '/NFL', '/NDL',
    '/XD', (Join-Path $ProjectRoot 'node_modules\.cache')
)

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
    Push-Location $AppPath
    try {
        & $npmCommand.Source prune --omit=dev --ignore-scripts --offline --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm prune failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} else {
    # The unified workspace already contains a complete node_modules tree. On
    # a machine without a global npm command, use lockfile v3's dev markers to
    # remove development-only package directories from the fresh output.
    $nodeRuntime = @(
        (Join-Path $ProjectRoot 'Runtime\electron.exe'),
        (Join-Path $ProjectRoot 'src\electron\node_modules\electron\dist\electron.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $nodeRuntime) {
        throw 'Neither npm.cmd nor a bundled Electron Node runtime is available for production dependency pruning.'
    }
    $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        $pruneInfo = New-Object Diagnostics.ProcessStartInfo
        $pruneInfo.FileName = $nodeRuntime
        $pruneInfo.Arguments = ('"{0}" "{1}" "{2}"' -f (Join-Path $PSScriptRoot 'prune-production-node-modules.cjs'), $AppPath, (Join-Path $ProjectRoot 'package-lock.json'))
        $pruneInfo.WorkingDirectory = $ProjectRoot
        $pruneInfo.UseShellExecute = $false
        $pruneInfo.CreateNoWindow = $true
        $pruneProcess = [Diagnostics.Process]::Start($pruneInfo)
        $pruneProcess.WaitForExit()
        if ($pruneProcess.ExitCode -ne 0) {
            throw "Lockfile production prune failed with exit code $($pruneProcess.ExitCode)"
        }
        $pruneProcess.Dispose()
    } finally {
        $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
}

Invoke-RobocopyChecked -Arguments @(
    (Join-Path $ProjectRoot 'src\electron\node_modules\electron\dist'),
    $RuntimePath,
    '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/MT:8', '/NP', '/NFL', '/NDL'
)

$portableConfig = Get-Content -LiteralPath (Join-Path $ProjectRoot 'config.yaml') -Raw -Encoding utf8
$portableConfig = $portableConfig -replace '(?m)^dataRoot:\s*.*$', 'dataRoot: ../UserData'
$portableConfig = $portableConfig -replace '(?m)^listen:\s*true\s*$', 'listen: false'
$portableConfig = $portableConfig -replace '(?m)^(\s+ipv4:)\s*0\.0\.0\.0\s*$', '$1 127.0.0.1'
$portableConfig = $portableConfig -replace '(?ms)(^browserLaunch:\s*\r?\n\s+enabled:)\s*true', '$1 false'
$portableConfig = $portableConfig -replace '(?m)^port:\s*\d+\s*$', 'port: 8127'
[IO.File]::WriteAllText((Join-Path $ConfigPath 'config.yaml'), $portableConfig, [Text.UTF8Encoding]::new($false))

Invoke-RobocopyChecked -Arguments @(
    $AssetsPath,
    $OutputPath,
    '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NP', '/NFL', '/NDL'
)

$gitCommit = (& git -C $ProjectRoot rev-parse HEAD 2>$null)
$dirtyFiles = @(& git -C $ProjectRoot status --porcelain 2>$null)
$manifest = @(
    'DreamLand Windows x64 portable package',
    "Built: $([DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))",
    "Source: $ProjectRoot",
    "Git commit: $gitCommit",
    "Working tree changes included: $($dirtyFiles.Count)",
    'Runtime: Electron 41.1.1 (bundled Node/Chromium)',
    'Network: localhost only, port 8127',
    'Data: .\UserData (empty on first package build)',
    'Sync modules: not included / not implemented',
    '',
    'This package includes SillyTavern-derived source under AGPL-3.0.'
) -join "`r`n"
[IO.File]::WriteAllText((Join-Path $OutputPath 'PACKAGE-MANIFEST.txt'), $manifest, [Text.UTF8Encoding]::new($false))

$hashTargets = @(
    (Join-Path $RuntimePath 'electron.exe'),
    (Join-Path $AppPath 'server.js'),
    (Join-Path $AppPath 'package.json'),
    (Join-Path $AppPath 'src\electron\index.js'),
    (Join-Path $ConfigPath 'config.yaml'),
    (Join-Path $OutputPath 'Scripts\Start-LeslieTavern.ps1'),
    (Join-Path $OutputPath 'Scripts\Stop-LeslieTavern.ps1'),
    (Join-Path $OutputPath 'Scripts\Backup-LeslieTavern.ps1')
)
$hashLines = foreach ($file in $hashTargets) {
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    "$($hash.Hash.ToLowerInvariant())  $($file.Substring($OutputPath.Length + 1))"
}
[IO.File]::WriteAllText((Join-Path $OutputPath 'SHA256SUMS.txt'), ($hashLines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))

Write-Host "Portable package built at $OutputPath" -ForegroundColor Green
