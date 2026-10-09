@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Food Nutrition Tool - Stopping
echo ============================================
echo.

set SEEN=%TEMP%\fnt_stop_seen.txt
if exist "%SEEN%" del "%SEEN%" >nul 2>nul

call :killport 8788 "Frontend"
call :killport 8000 "Backend"

if exist "%SEEN%" del "%SEEN%" >nul 2>nul

echo.
echo Done. Both ports should now be free.
echo.
pause
exit /b 0

:killport
rem A single process may listen on both IPv4 and IPv6, so the same PID can
rem appear twice in netstat output. Keep a seen-list to report each once.
set PORT=%~1
set LABEL=%~2
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  findstr /C:"[%%p]" "%SEEN%" >nul 2>nul
  if errorlevel 1 (
    echo   Stopping %LABEL% on port %PORT% ^(PID %%p^)
    echo [%%p]>>"%SEEN%"
    taskkill /PID %%p /T /F >nul 2>nul
  )
)
exit /b 0
