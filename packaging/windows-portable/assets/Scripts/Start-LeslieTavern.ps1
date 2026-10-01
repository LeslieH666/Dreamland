$ErrorActionPreference = 'Stop'
$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ElectronPath = Join-Path $PackageRoot 'Runtime\electron.exe'
$AppEntry = Join-Path $PackageRoot 'App\src\electron'
$AppRoot = Join-Path $PackageRoot 'App'
$ConfigPath = Join-Path $PackageRoot 'Config\config.yaml'
$DataPath = Join-Path $PackageRoot 'UserData'
$CachePath = Join-Path $PackageRoot 'Cache'
$LogsPath = Join-Path $PackageRoot 'Logs'
$RunPath = Join-Path $PackageRoot 'Run'
$PidPath = Join-Path $RunPath 'LeslieTavern.pid'

foreach ($required in @($ElectronPath, $AppEntry, $ConfigPath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Portable package file is missing: $required"
    }
}

foreach ($directory in @($DataPath, $CachePath, $LogsPath, $RunPath)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

if (Test-Path -LiteralPath $PidPath) {
    $oldPid = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidPath -Raw).Trim(), [ref]$oldPid)
    if ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Write-Host "DreamLand is already running (PID $oldPid)." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $LogsPath "LeslieTavern-$timestamp.stdout.log"
$stderrLog = Join-Path $LogsPath "LeslieTavern-$timestamp.stderr.log"
$arguments = @(
    ('"{0}"' -f $AppEntry),
    ('--configPath="{0}"' -f $ConfigPath),
    ('--dataRoot="{0}"' -f $DataPath),
    ('--electronDataRoot="{0}"' -f $CachePath),
    '--width=1280',
    '--height=800'
)

$process = Start-Process -FilePath $ElectronPath -ArgumentList $arguments -WorkingDirectory $AppRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
[IO.File]::WriteAllText($PidPath, [string]$process.Id, [Text.UTF8Encoding]::new($false))

$started = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        $errorText = if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue } else { '' }
        throw "DreamLand failed to start. Check $stderrLog`r`n$errorText"
    }
    if (Test-Path -LiteralPath $stdoutLog) {
        $logText = Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue
        if ($logText -match 'Using data root:\s*(.+)') {
            $actualDataRoot = [IO.Path]::GetFullPath($Matches[1].Trim())
            if ($actualDataRoot -ne [IO.Path]::GetFullPath($DataPath)) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
                throw "Data-root safety check failed. Actual: $actualDataRoot Expected: $DataPath"
            }
        }
        if ($logText -match 'SillyTavern is listening on IPv4:\s*127\.0\.0\.1:8127') {
            $started = $true
            break
        }
    }
}

if ($started) {
    Write-Host 'LeslieTavern started. Closing the window keeps it in the system tray; use the tray Exit command or the stop shortcut to end it.' -ForegroundColor Green
} else {
    Write-Host "DreamLand is still initializing. Logs: $LogsPath" -ForegroundColor Yellow
}
