@echo off
rem PackingProof 快麦 ERP 适配器 - 手动启动入口（PPEXT external-adapter 建议查看/运行的文件）
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 20 或更高版本并勾选“添加到 PATH”
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在准备运行环境...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
)

if not exist .env (
  if exist .env.example (
    copy /y .env.example .env >nul
    echo 已从 .env.example 生成 .env，请填写快麦 API 配置后重新启动
  )
)

node src/index.js
pause
