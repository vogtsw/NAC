@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==================================
echo   NAC Web Console Launcher
echo ==================================
echo.

REM 检查Node.js
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo Node.js版本: %NODE_VERSION%

REM 检查.env文件
if not exist .env (
    echo.
    echo ⚠️  警告: .env文件不存在
    echo 请先复制.env.example并配置API密钥:
    echo   copy .env.example .env
    echo.
    pause
    exit /b 1
)

REM 检查API密钥
findstr /C:"ZHIPU_API_KEY=your_" .env >nul
if not errorlevel 1 (
    echo.
    echo ⚠️  警告: API密钥未配置
    echo 请在.env文件中配置ZHIPU_API_KEY
    echo.
    pause
    exit /b 1
)

echo.
echo 🚀 正在启动NAC Web服务...
echo.
echo 访问地址: http://localhost:3000
echo 按 Ctrl+C 停止服务
echo.
echo ==================================
echo.

REM 启动服务
pnpm web

pause
