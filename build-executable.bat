@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ========================================
echo Hanako 一键打包可执行程序脚本
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 20+
    pause
    exit /b 1
)

:: 检查 npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm，请确保 Node.js 安装正确
    pause
    exit /b 1
)

echo [1/8] 检查 Node.js 版本...
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo 当前 Node.js 版本: %NODE_VERSION%
echo.

echo [1.5/8] 检查签名密钥...
if not defined HANA_SIGN_KEY (
    echo [提示] 未设置 HANA_SIGN_KEY，自动生成本地测试密钥对...
    node "%~dp0scripts\generate-local-sign-key.mjs" --key "%~dp0.local-sign-key.pem" --keyset "%~dp0.local-keyset.json" || (
        echo [错误] 本地测试密钥对生成失败！
        pause
        exit /b 1
    )
    set "HANA_SIGN_KEY=%~dp0.local-sign-key.pem"
    set "HANA_SIGN_KEYSET=%~dp0.local-keyset.json"
    echo [设置] HANA_SIGN_KEY=%HANA_SIGN_KEY%
    echo [设置] HANA_SIGN_KEYSET=%HANA_SIGN_KEYSET%
) else (
    echo [复用] 已设置正式签名密钥 HANA_SIGN_KEY
)
echo.

echo [2/8] 构建预加载模块...
call npm run build:preload
if %errorlevel% neq 0 (
    echo [错误] 预加载模块构建失败！
    pause
    exit /b 1
)
echo [完成] 预加载模块构建成功！
echo.

echo [2.5/8] 编译 Windows 沙盒助手...
node "%~dp0scripts\build-windows-sandbox-helper.mjs" || (
    echo [错误] Windows 沙盒助手编译失败！
    pause
    exit /b 1
)
echo [完成] Windows 沙盒助手编译成功！
echo.

echo [3/8] 构建渲染进程 + 主题 + Splash...
rem 三者都必须先于 build:server，原因有二：
rem 1) build:server 的 seed 打包（build-server-artifact.mjs）消费 desktop/dist-renderer/
rem    树，顺序颠倒会把上一轮的旧 renderer 打进 seed（UI 改动滞后一轮）；
rem 2) build:renderer 的 emptyOutDir 会清空 dist-renderer/，而 lib/theme.js 由
rem    build:theme 产出——theme 必须紧跟 renderer 之后、seed 打包之前，否则 seed 里
rem    lib/ 缺 theme.js，前端主题切换全灭（<script src="lib/theme.js"> 404）。
call npm run build:renderer
if %errorlevel% neq 0 (
    echo [错误] 渲染进程构建失败！
    pause
    exit /b 1
)
echo [完成] 渲染进程构建成功！
call npm run build:theme
if %errorlevel% neq 0 (
    echo [错误] 主题模块构建失败！
    pause
    exit /b 1
)
echo [完成] 主题模块构建成功！
call npm run build:splash
if %errorlevel% neq 0 (
    echo [错误] Splash 构建失败！
    pause
    exit /b 1
)
echo [完成] Splash 构建成功！
echo.

echo [4/8] 构建服务器模块...
call npm run build:server
if %errorlevel% neq 0 (
    echo [错误] 服务器模块构建失败！
    pause
    exit /b 1
)
echo [完成] 服务器模块构建成功！
echo.

echo [5/8] 构建主进程...
call npm run build:main
if %errorlevel% neq 0 (
    echo [错误] 主进程构建失败！
    pause
    exit /b 1
)
echo [完成] 主进程构建成功！
echo.

echo [6.5/8] 准备 MinGit 运行时...
node "%~dp0scripts\download-mingit.js" || (
    echo [错误] MinGit 下载失败！
    pause
    exit /b 1
)
echo [完成] MinGit 运行时就绪！
echo.

echo [7/8] 检查并创建 NSIS 安装脚本...
if not exist "build" (
    mkdir build
    echo [创建] build 目录
)
if not exist "build\installer.nsh" (
    echo ; NSIS installer customization script > build\installer.nsh
    echo ; This file can be used to customize the NSIS installer >> build\installer.nsh
    echo [创建] build\installer.nsh 文件
)
echo [完成] NSIS 安装脚本检查完成！
echo.

echo [8/8] 打包 Windows 可执行程序 (NSIS 安装包)...
echo 这可能需要几分钟时间，请耐心等待...
echo.
call npx electron-builder --win nsis
if %errorlevel% neq 0 (
    echo [错误] 打包失败！
    pause
    exit /b 1
)

echo.
echo ========================================
echo 打包成功完成！
echo ========================================
echo.
echo 输出目录: dist\
echo.
echo 生成的文件:
dir /b dist\*.exe 2>nul
if %errorlevel% neq 0 (
    echo   (未找到 .exe 文件，请检查 dist 目录)
)
echo.
echo ========================================
echo 提示: 如需打包为便携版(免安装)，请运行:
echo   npm run pack
echo ========================================
echo.
pause