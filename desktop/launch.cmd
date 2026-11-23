@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\desktop.ps1" -Action Start -Background
if errorlevel 1 pause
