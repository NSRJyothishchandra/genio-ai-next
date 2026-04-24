@echo off
title Genio AI — n8n Setup
color 0A
echo ============================================
echo   Genio AI — n8n Local Automation Setup
echo ============================================
echo.

:: Check if n8n is already installed
where n8n >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] n8n is already installed.
    goto :start_n8n
)

echo [..] Installing n8n globally (this may take a few minutes)...
npm install -g n8n
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] n8n installation failed. Make sure Node.js is installed.
    pause
    exit /b 1
)
echo [OK] n8n installed successfully!

:start_n8n
echo.
echo [..] Starting n8n on http://localhost:5678 ...
echo.
echo  NOTE: Keep this window open while using Genio AI.
echo  To stop n8n, close this window or press Ctrl+C
echo.
n8n start
pause
