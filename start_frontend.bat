@echo off
echo ======================================
echo   Starting Frontend Server
echo ======================================

cd /d %~dp0\frontend

echo.
echo 🌐 Frontend running at: http://localhost:3000
echo.

:: Start frontend server in background
start cmd /k python -m http.server 3000

:: Wait a bit so server starts
timeout /t 2 >nul

:: Open frontend in browser
start http://localhost:3000