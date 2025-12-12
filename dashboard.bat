@echo off
SETLOCAL

REM ============================================
REM Website Monitoring Dashboard Launcher
REM ============================================

SET MONITOR_DIR=C:\WebsiteMonitor\monitor-system
SET NODE_EXE=node
SET DASHBOARD_PORT=3000

echo.
echo ============================================
echo  Website Monitoring Dashboard
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Change to monitor directory
cd /d "%MONITOR_DIR%"

REM Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install --silent
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo.
echo Starting dashboard on http://localhost:%DASHBOARD_PORT%
echo Press Ctrl+C to stop
echo.

REM Start dashboard
"%NODE_EXE%" dashboard/server.js