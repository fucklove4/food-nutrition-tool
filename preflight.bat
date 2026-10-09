@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Pre-deploy safety check
echo   Goal: make sure your API key is NOT committed
echo ============================================
echo.

set PROBLEM=0

echo [1/4] Checking .gitignore files ...
if exist ".gitignore" (
  echo       OK   .gitignore present
) else (
  echo       MISSING .gitignore in this folder
  set PROBLEM=1
)
if exist "..\.gitignore" (
  echo       OK   parent .gitignore present
) else (
  echo       note: no parent .gitignore ^(fine if this folder is its own repo^)
)

echo.
echo [2/4] Confirming .env is ignored ...
findstr /C:".env" .gitignore >nul 2>nul
if errorlevel 1 (
  echo       .gitignore has no .env rule  ^<-- security risk
  set PROBLEM=1
) else (
  echo       OK   .env is in the ignore list
)

echo.
echo [3/4] Scanning server.py for a hard-coded key ...
findstr /R /C:"sk-[a-zA-Z0-9][a-zA-Z0-9]*" server.py >nul 2>nul
if errorlevel 1 (
  echo       OK   no plaintext key found in server.py
) else (
  echo       WARNING: server.py may still contain a plaintext key
  set PROBLEM=1
)

echo.
echo [4/4] Checking local .env ...
if exist ".env" (
  echo       OK   .env exists ^(needed locally for the AI feature^)
) else (
  echo       .env not found - copy .env.example to .env and fill in your key
)

echo.
echo ============================================
if "%PROBLEM%"=="1" (
  echo   FIX THE ITEMS ABOVE BEFORE DEPLOYING.
) else (
  echo   All checks passed. Safe to deploy.
)
echo ============================================
echo.
pause
exit /b 0
