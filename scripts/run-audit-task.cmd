@echo off
setlocal

set "BUNDLE=%~1"
if "%BUNDLE%"=="" (
    echo Usage: run-audit-task.cmd daily^|weekly^|biweekly^|monthly^|quarterly
    endlocal & exit /b 64
)

if /I "%BUNDLE%"=="daily" goto valid
if /I "%BUNDLE%"=="weekly" goto valid
if /I "%BUNDLE%"=="biweekly" goto valid
if /I "%BUNDLE%"=="monthly" goto valid
if /I "%BUNDLE%"=="quarterly" goto valid
echo Invalid audit bundle: %BUNDLE%
endlocal & exit /b 64

:valid
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_DIR=%%~fI"
if defined CLAUDE_REPO_ROOT set "REPO_DIR=%CLAUDE_REPO_ROOT%"

set "LOG_DIR=%USERPROFILE%\memory"
set "LOGFILE=%LOG_DIR%\audit-%BUNDLE%.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%REPO_DIR%\package.json" (
    echo Repository non valido: %REPO_DIR% > "%LOGFILE%"
    endlocal & exit /b 2
)

cd /d "%REPO_DIR%"
echo === LinkedIn AI Audit %BUNDLE% === > "%LOGFILE%"
echo Date: %date% %time% >> "%LOGFILE%"
echo Repo: %REPO_DIR% >> "%LOGFILE%"
echo. >> "%LOGFILE%"

call npm run audit:%BUNDLE% >> "%LOGFILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo. >> "%LOGFILE%"
echo Exit code: %EXIT_CODE% >> "%LOGFILE%"
echo === END === >> "%LOGFILE%"

endlocal & exit /b %EXIT_CODE%
