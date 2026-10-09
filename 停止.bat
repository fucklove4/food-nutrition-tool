@echo off
chcp 65001 > nul
title 食品营养分析工具 - 停止

echo ============================================
echo   正在停止服务...
echo ============================================
echo.

call :kill_port 8788 "前端"
call :kill_port 8000 "后端"

echo.
echo 如果上面显示"未占用"，说明服务本来就没在跑。
echo.
pause
exit /b 0

:kill_port
setlocal
set PORT=%~1
set NAME=%~2
set FOUND=0

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo   停止%NAME% (端口 %PORT%, PID %%p)
  taskkill /PID %%p /T /F >nul 2>nul
  set FOUND=1
)

if "%FOUND%"=="0" echo   %NAME%（端口 %PORT%）未占用

endlocal
exit /b 0
