@echo off
chcp 65001 > nul
title 食品营养分析工具 - 启动

echo ============================================
echo   食品营养分析工具  启动中
echo ============================================
echo.

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 python 命令。
  echo        请先安装 Python 并勾选 "Add Python to PATH"。
  echo.
  pause
  exit /b 1
)

if not exist "data\foods.json" (
  echo [错误] 找不到 data\foods.json，请确认脚本放在 web 目录下。
  echo.
  pause
  exit /b 1
)

echo [1/2] 启动前端网页服务（端口 8788）...
start "营养工具-前端" cmd /k "cd /d "%~dp0" && python -m http.server 8788 --bind ::"

timeout /t 2 /nobreak > nul

echo [2/2] 启动 AI 后端（端口 8000）...
start "营养工具-后端" cmd /k "cd /d "%~dp0" && python -m uvicorn server:app --host 127.0.0.1 --port 8000"

timeout /t 4 /nobreak > nul

start "" "http://localhost:8788/"

echo.
echo ============================================
echo   已启动，浏览器应该自动打开了。
echo.
echo   前端： http://localhost:8788/
echo   后端： http://127.0.0.1:8000/api/health
echo.
echo   注意：会弹出两个黑色命令行窗口，
echo         关掉它们就等于停止服务。
echo         不用了请双击 停止.bat
echo ============================================
echo.
pause
