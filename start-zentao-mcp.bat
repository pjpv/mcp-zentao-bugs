@echo off
REM 禪道 MCP 服務器啟動腳本

setlocal

set ZENTAO_BASE_URL=http://192.168.88.12/zentao/
set ZENTAO_ACCOUNT=gapen
set ZENTAO_PASSWORD=gapen
set PORT=3000

echo.
echo ========================================
echo   禪道 MCP 服務器
echo   地址: http://localhost:3000/sse
echo ========================================
echo.
echo 按 Ctrl+C 停止服務器
echo.

npm exec -y mcp-zentao-bugs-v12@latest

endlocal
