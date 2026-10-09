@echo off
rem ============================================================
rem  Food Nutrition Tool - start frontend + AI backend
rem
rem  ASCII-only on purpose: a .bat containing Chinese characters
rem  plus "chcp 65001" makes cmd.exe mis-parse the file (it seeks
rem  by byte offset, so multi-byte chars shift it and commands get
rem  truncated, e.g. "timeout" -> "imeout"). Keeping this file
rem  ASCII avoids that whole class of failure.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

title NutritionTool-Launcher

echo ============================================
echo   Food Nutrition Tool - Starting
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 goto :nopython

if not exist "data\foods.json" goto :nodata
if not exist "server.py" goto :noserver

rem --- warn if ports are already taken ---
set BUSY=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8788" ^| findstr "LISTENING"') do set BUSY=1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do set BUSY=1
if "%BUSY%"=="1" (
  echo   NOTE: a port is already in use - services may already be running.
  echo         If the page does not load, run stop.bat first.
  echo.
)

rem ------------------------------------------------------------
rem  Launch the two servers in their own windows.
rem  "start /d <dir>" avoids nested-quote problems and handles
rem  paths containing spaces or non-ASCII characters.
rem ------------------------------------------------------------
echo [1/2] Starting frontend on port 8788 ...
start "NutritionTool-Frontend" /min /d "%~dp0" cmd /k "python -m http.server 8788 --bind ::"

timeout /t 2 /nobreak >nul

echo [2/2] Starting AI backend on port 8000 ...
start "NutritionTool-Backend" /min /d "%~dp0" cmd /k "python -m uvicorn server:app --port 8000"

rem ------------------------------------------------------------
rem  Wait until the frontend actually answers before opening the
rem  browser, so the user never sees a connection error.
rem ------------------------------------------------------------
echo.
echo Waiting for services to be ready ...
set READY=0
for /l %%i in (1,1,20) do (
  if "!READY!"=="0" (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try{if((Invoke-WebRequest -Uri 'http://127.0.0.1:8788/index.html' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}" >nul 2>nul
    if not errorlevel 1 set READY=1
  )
)

if "%READY%"=="1" (
  echo   Frontend is up.
  start "" "http://localhost:8788/"
) else (
  echo   Frontend did not respond. Check the NutritionTool-Frontend window.
)

echo.
echo ============================================
echo   Frontend : http://localhost:8788/
echo   Backend  : http://127.0.0.1:8000/api/health
echo.
echo   Two minimized console windows were opened.
echo   Those windows ARE the servers - closing them stops the service.
echo   Or just run stop.bat
echo ============================================
echo.
pause
exit /b 0

:nopython
echo [ERROR] python not found in PATH.
echo         Install Python and tick "Add Python to PATH".
echo.
pause
exit /b 1

:nodata
echo [ERROR] data\foods.json not found.
echo         This script must sit next to index.html.
echo.
pause
exit /b 1

:noserver
echo [ERROR] server.py not found.
echo         This script must sit next to index.html.
echo.
pause
exit /b 1
