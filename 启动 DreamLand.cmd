@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0packaging\windows-local\Start-LeslieTavern.ps1"
if errorlevel 1 pause
