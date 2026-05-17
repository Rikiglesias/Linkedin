@echo off
REM Wrapper per Windows Task Scheduler: audit:monthly
REM Esegue audit mensile del sistema AI e logga output in %USERPROFILE%\memory\audit-monthly-YYYYMMDD.log
REM Schedulato via schtasks /create /TN "LinkedIn-AI-Audit-Monthly" /SC MONTHLY /D 1 /ST 09:00

setlocal

if defined CLAUDE_REPO_ROOT (
    set "REPO_DIR=%CLAUDE_REPO_ROOT%"
) else (
    set "REPO_DIR=C:\Users\albie\Desktop\Programmi\Linkedin"
)
set "LOG_DIR=%USERPROFILE%\memory"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "DATESTAMP=%%I"
if not defined DATESTAMP set "DATESTAMP=%date:/=%"
set "LOGFILE=%LOG_DIR%\audit-monthly-%DATESTAMP%.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%REPO_DIR%\package.json" (
    echo Repository non valido: %REPO_DIR% > "%LOGFILE%"
    endlocal & exit /b 2
)

cd /d "%REPO_DIR%"
echo === LinkedIn AI Audit Monthly === > "%LOGFILE%"
echo Date: %date% %time% >> "%LOGFILE%"
echo Repo: %REPO_DIR% >> "%LOGFILE%"
echo. >> "%LOGFILE%"

call npm run audit:monthly >> "%LOGFILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo. >> "%LOGFILE%"
echo Exit code: %EXIT_CODE% >> "%LOGFILE%"
echo === END === >> "%LOGFILE%"

endlocal & exit /b %EXIT_CODE%
