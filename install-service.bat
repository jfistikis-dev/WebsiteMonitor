@echo off
REM Install as Windows Service using NSSM
REM Download NSSM from: https://nssm.cc/download

set SERVICE_NAME="WebsiteMonitor"
set APP_PATH="C:\WebsiteMonitor\monitor.bat"
set NSSM_PATH="C:\Tools\nssm\nssm.exe"

if not exist "%NSSM_PATH%" (
    echo Download NSSM from https://nssm.cc/download
    echo Extract to C:\Tools\nssm\
    pause
    exit /b 1
)

"%NSSM_PATH%" install %SERVICE_NAME% "%APP_PATH%"
"%NSSM_PATH%" set %SERVICE_NAME% Description "Website Monitoring Service"
"%NSSM_PATH%" set %SERVICE_NAME% Start SERVICE_DELAYED_AUTO_START
"%NSSM_PATH%" set %SERVICE_NAME% AppStdout "C:\WebsiteMonitor\service.log"
"%NSSM_PATH%" set %SERVICE_NAME% AppStderr "C:\WebsiteMonitor\service-error.log"

echo Service installed. Start with: net start WebsiteMonitor
pause