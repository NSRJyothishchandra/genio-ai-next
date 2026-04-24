@echo off
title Genio AI — Next.js Dev Server
color 0B
echo ============================================
echo   Genio AI — Next.js Development Server
echo ============================================
echo.
cd /d "%~dp0"
echo [..] Installing dependencies (if needed)...
if not exist "node_modules" (
    npm install
)
echo.
echo [..] Starting Genio AI on http://localhost:3000 ...
echo.
echo  NOTE: Keep this window open while using Genio AI.
echo  To stop, press Ctrl+C
echo.
npm run dev
pause
