$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ExpectedExecutable = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'Runtime\electron.exe'))
$PidPath = Join-Path $ProjectRoot 'Run\LeslieTavern.pid'

if (-not (Test-Path -LiteralPath $PidPath)) {
    Write-Host 'LeslieTavern is not running.' -ForegroundColor Yellow
    exit 0
}

$processId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $PidPath -Raw).Trim(), [ref]$processId)) {
    throw 'The PID file is invalid. Refusing to stop an unknown process.'
}

$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -LiteralPath $PidPath -Force
    Write-Host 'LeslieTavern is already stopped.' -ForegroundColor Green
    exit 0
}

if ($process.Path -and [IO.Path]::GetFullPath($process.Path) -ne $ExpectedExecutable) {
    throw "PID $processId does not belong to this workspace. Stop refused."
}

$StopRequestPath = Join-Path $ProjectRoot "Run\LeslieTavern.stop-$processId"
[IO.File]::WriteAllText($StopRequestPath, 'quit', [Text.UTF8Encoding]::new($false))
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
        break
    }
}

if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    throw 'LeslieTavern did not complete a safe exit. The process was left running so its user space remains protected.'
}
Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
Write-Host 'LeslieTavern stopped.' -ForegroundColor Green
