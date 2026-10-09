@echo off
chcp 65001 > nul
title 部署前安全检查

echo ============================================
echo   部署前安全检查
echo   目的：确认密钥不会被提交到 GitHub
echo ============================================
echo.

cd /d "%~dp0"
set PROBLEM=0

echo [1/5] 检查 .gitignore 是否存在...
if exist ".gitignore" (
  echo       OK   web\.gitignore
) else (
  echo       缺少 web\.gitignore
  set PROBLEM=1
)
if exist "..\.gitignore" (
  echo       OK   项目根 .gitignore
) else (
  echo       缺少项目根 .gitignore
  set PROBLEM=1
)

echo.
echo [2/5] 确认 .env 被忽略...
findstr /C:".env" .gitignore >nul 2>nul
if errorlevel 1 (
  echo       .gitignore 里没有 .env 规则
  set PROBLEM=1
) else (
  echo       OK   .env 已在忽略列表
)

echo.
echo [3/5] 检查 server.py 是否残留明文密钥...
findstr /R /C:"sk-[a-zA-Z0-9]\{20,\}" server.py >nul 2>nul
if errorlevel 1 (
  echo       OK   server.py 中未发现明文密钥
) else (
  echo       警告：server.py 里疑似仍有明文密钥！
  set PROBLEM=1
)

echo.
echo [4/5] 检查 .env 是否存在（本地需要，但不该提交）...
if exist ".env" (
  echo       OK   .env 存在（本地开发用）
) else (
  echo       .env 不存在，AI 功能将无法使用
  echo       请复制 .env.example 为 .env 并填入密钥
  set PROBLEM=1
)

echo.
echo [5/5] 检查前端后端地址配置...
findstr /C:"AI_URL" js\app.js

echo.
echo ============================================
if "%PROBLEM%"=="1" (
  echo   发现待处理项，请先解决再部署。
) else (
  echo   安全检查通过，可以部署。
)
echo ============================================
echo.
pause
