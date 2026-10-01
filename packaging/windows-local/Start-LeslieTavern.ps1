$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ElectronPath = Join-Path $ProjectRoot 'Runtime\electron.exe'
$AppEntry = Join-Path $ProjectRoot 'src\electron'
$ConfigPath = Join-Path $ProjectRoot 'Config\config.yaml'
$DataPath = Join-Path $ProjectRoot 'data'
$CachePath = Join-Path $ProjectRoot 'Cache'
$LogsPath = Join-Path $ProjectRoot 'logs\desktop'
$RunPath = Join-Path $ProjectRoot 'Run'
$PidPath = Join-Path $RunPath 'LeslieTavern.pid'
$LanAddressPath = Join-Path $RunPath 'LeslieTavern-lan-addresses.txt'

foreach ($required in @($ElectronPath, $AppEntry, $ConfigPath, $DataPath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Unified workspace file is missing: $required"
    }
}

$configText = Get-Content -LiteralPath $ConfigPath -Raw -Encoding utf8
$portMatch = [regex]::Match($configText, '(?m)^port:\s*(\d+)\s*$')
if (-not $portMatch.Success) {
    throw "Unable to resolve the server port from $ConfigPath"
}
$expectedPort = [int]$portMatch.Groups[1].Value
$listenEnabled = [regex]::IsMatch($configText, '(?m)^listen:\s*true\s*$')
$listenAddressMatch = [regex]::Match($configText, '(?ms)^listenAddress:\s*\r?\n\s+ipv4:\s*["'']?([^"''#\r\n]+)')
$configuredIpv4 = if ($listenAddressMatch.Success) { $listenAddressMatch.Groups[1].Value.Trim() } else { '0.0.0.0' }
$expectedIpv4 = if ($listenEnabled) { $configuredIpv4 } else { '127.0.0.1' }
$expectedListener = '{0}:{1}' -f $expectedIpv4, $expectedPort

# The desktop app owns one process-scoped companion token. AIRI may be started
# later from Settings without writing that token into source or user settings.
if (-not $env:LESLIE_BRIDGE_TOKEN) {
    $tokenBytes = New-Object byte[] 32
    $tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $tokenGenerator.GetBytes($tokenBytes)
    } finally {
        $tokenGenerator.Dispose()
    }
    $env:LESLIE_BRIDGE_TOKEN = [BitConverter]::ToString($tokenBytes).Replace('-', '').ToLowerInvariant()
}
$env:LESLIE_BRIDGE_BASE_URL = "http://127.0.0.1:$expectedPort/api/leslie/bridge/v1/"
$env:LESLIE_COMPANION_MODE = '1'

function Get-LanAccessDetails {
    param([int]$Port)

    $lanAddresses = [Collections.Generic.List[string]]::new()
    $dnsSuffixes = [Collections.Generic.List[string]]::new()

    foreach ($networkInterface in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($networkInterface.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up) {
            continue
        }

        $ipProperties = $networkInterface.GetIPProperties()
        $hasIpv4Gateway = $ipProperties.GatewayAddresses | Where-Object {
            $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
        }
        if (-not $hasIpv4Gateway) {
            continue
        }

        if (-not [string]::IsNullOrWhiteSpace($ipProperties.DnsSuffix)) {
            $dnsSuffixes.Add($ipProperties.DnsSuffix.Trim('.'))
        }

        foreach ($unicastAddress in $ipProperties.UnicastAddresses) {
            $address = $unicastAddress.Address
            if ($address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
                continue
            }

            $addressBytes = $address.GetAddressBytes()
            $isPrivateAddress = $addressBytes[0] -eq 10 -or
                ($addressBytes[0] -eq 172 -and $addressBytes[1] -ge 16 -and $addressBytes[1] -le 31) -or
                ($addressBytes[0] -eq 192 -and $addressBytes[1] -eq 168)
            if ($isPrivateAddress) {
                $lanAddresses.Add($address.IPAddressToString)
            }
        }
    }

    $lanAddresses = @($lanAddresses | Sort-Object -Unique)
    $hostName = [Net.Dns]::GetHostName()
    $hostCandidates = @($hostName) + @($dnsSuffixes | Sort-Object -Unique | ForEach-Object { "$hostName.$_" })
    $resolvableHostNames = foreach ($candidate in ($hostCandidates | Sort-Object -Unique)) {
        try {
            $resolvedAddresses = @([Net.Dns]::GetHostAddresses($candidate) | Where-Object {
                $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
            } | ForEach-Object { $_.IPAddressToString })
            if ($resolvedAddresses | Where-Object { $_ -in $lanAddresses }) {
                $candidate
            }
        } catch {
            # A hostname URL is optional. The numeric LAN URL remains available.
        }
    }

    [pscustomobject]@{
        HostUrls = @($resolvableHostNames | ForEach-Object { 'http://{0}:{1}/' -f $_, $Port })
        IpUrls = @($lanAddresses | ForEach-Object { 'http://{0}:{1}/' -f $_, $Port })
    }
}

foreach ($directory in @($CachePath, $LogsPath, $RunPath)) {
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
Remove-Item -LiteralPath $LanAddressPath -Force -ErrorAction SilentlyContinue

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

# Some automation environments expose both Path and PATH. Windows PowerShell
# treats environment names case-insensitively when Start-Process copies them,
# so normalize the process-local value before launching Electron.
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
[Environment]::SetEnvironmentVariable('Path', $null, 'Process')
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')

$process = Start-Process -FilePath $ElectronPath -ArgumentList $arguments -WorkingDirectory $ProjectRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
[IO.File]::WriteAllText($PidPath, [string]$process.Id, [Text.UTF8Encoding]::new($false))

$started = $false
$actualListener = $null
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
        if ($logText -match 'SillyTavern is listening on IPv4:\s*([^\s:]+):(\d+)') {
            $actualListener = '{0}:{1}' -f $Matches[1], $Matches[2]
            if ($actualListener -ne $expectedListener) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
                throw "Listener safety check failed. Actual: $actualListener Expected: $expectedListener"
            }
            $started = $true
            break
        }
    }
}

if ($started) {
    Write-Host "DreamLand started on $actualListener. Closing the window keeps it in the system tray; use the tray Exit command or the stop shortcut to end it." -ForegroundColor Green
    if ($expectedIpv4 -eq '0.0.0.0') {
        $lanAccess = Get-LanAccessDetails -Port $expectedPort
        [string[]]$addressFileLines = @(
            'Stable LAN names (use these first when available):'
            $lanAccess.HostUrls
            ''
            'Current numeric LAN addresses:'
            $lanAccess.IpUrls
            ''
            'This file is regenerated whenever DreamLand starts.'
        )
        [IO.File]::WriteAllLines($LanAddressPath, $addressFileLines, [Text.UTF8Encoding]::new($false))

        if ($lanAccess.HostUrls) {
            Write-Host ('Stable LAN URL: ' + ($lanAccess.HostUrls -join '  ')) -ForegroundColor Cyan
        }
        if ($lanAccess.IpUrls) {
            Write-Host ('Current LAN URL: ' + ($lanAccess.IpUrls -join '  ')) -ForegroundColor Cyan
        }
        Write-Host "LAN addresses were saved to $LanAddressPath" -ForegroundColor DarkCyan
        Write-Host 'Devices on the directly connected private subnet are allowed automatically; Windows Firewall still enforces the inbound boundary.' -ForegroundColor Yellow
    }
} else {
    Write-Host "DreamLand is still initializing. Logs: $LogsPath" -ForegroundColor Yellow
}
