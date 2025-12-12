@echo off
SETLOCAL

REM ============================================
REM Website Monitoring System Launcher
REM ============================================

REM Set paths
SET MONITOR_DIR=C:\WebsiteMonitor\monitor-system
SET NODE_EXE=node
SET LOG_DIR=%MONITOR_DIR%\logs

REM Create log directory if it doesn't exist
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Generate log filename with timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set LOG_FILE=%LOG_DIR%\monitor-%datetime:~0,8%-%datetime:~8,6%.log

REM Display start message
echo.
echo ============================================
echo  Website Monitoring System
echo  Starting: %date% %time%
echo ============================================
echo.

REM Change to monitor directory
cd /d "%MONITOR_DIR%"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

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

REM Run the monitoring system and log output
echo Running website tests...
echo Log file: %LOG_FILE%
echo.

"%NODE_EXE%" index.js >> "%LOG_FILE%" 2>&1

REM Check exit code
if %ERRORLEVEL% equ 0 (
    echo.
    echo Monitoring completed successfully.
    echo Check %LOG_FILE% for details.
) else (
    echo.
    echo ERROR: Monitoring failed with exit code %ERRORLEVEL%.
    echo Check %LOG_FILE% for error details.
)

echo.
echo ============================================
echo  Monitoring finished: %date% %time%
echo ============================================

REM Keep window open for 10 seconds if running manually
if "%1"=="" (
    timeout /t 10 >nul
)