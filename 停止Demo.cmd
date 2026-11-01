@echo off
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\desktop-launch.ps1" -Action stop -Background
exit /b %errorlevel%
