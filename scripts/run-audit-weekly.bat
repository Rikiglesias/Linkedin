@echo off
REM Wrapper per Windows Task Scheduler: audit:weekly
REM Esegue audit settimanale del sistema AI e logga output in %USERPROFILE%\memory\audit-weekly-YYYYMMDD.log
REM Schedulato via schtasks /create /TN "LinkedIn-AI-Audit-Weekly" /SC WEEKLY /D MON /ST 09:00

setlocal

set "REPO_DIR=C:\Users\albie\Desktop\Programmi\Linkedin"
set "LOG_DIR=%USERPROFILE%\memory"
set "DATESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%"
set "LOGFILE=%LOG_DIR%\audit-weekly-%DATESTAMP%.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%REPO_DIR%"
echo === LinkedIn AI Audit Weekly === > "%LOGFILE%"
echo Date: %date% %time% >> "%LOGFILE%"
echo Repo: %REPO_DIR% >> "%LOGFILE%"
echo. >> "%LOGFILE%"

call npm run audit:weekly >> "%LOGFILE%" 2>&1

echo. >> "%LOGFILE%"
echo === END === >> "%LOGFILE%"

endlocal
