@echo off
REM Wrapper per Windows Task Scheduler: audit:monthly
REM Esegue audit mensile del sistema AI e logga output in %USERPROFILE%\memory\audit-monthly-YYYYMMDD.log
REM Schedulato via schtasks /create /TN "LinkedIn-AI-Audit-Monthly" /SC MONTHLY /D 1 /ST 09:00

setlocal

set "REPO_DIR=C:\Users\albie\Desktop\Programmi\Linkedin"
set "LOG_DIR=%USERPROFILE%\memory"
set "DATESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%"
set "LOGFILE=%LOG_DIR%\audit-monthly-%DATESTAMP%.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%REPO_DIR%"
echo === LinkedIn AI Audit Monthly === > "%LOGFILE%"
echo Date: %date% %time% >> "%LOGFILE%"
echo Repo: %REPO_DIR% >> "%LOGFILE%"
echo. >> "%LOGFILE%"

call npm run audit:monthly >> "%LOGFILE%" 2>&1

echo. >> "%LOGFILE%"
echo === END === >> "%LOGFILE%"

endlocal
