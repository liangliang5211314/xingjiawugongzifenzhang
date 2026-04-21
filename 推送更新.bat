@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===== 推送代码到服务器 =====
echo.

git add -A

set /p msg=请输入本次修改说明（直接回车则使用默认）:
if "%msg%"=="" set msg=update

git commit -m "%msg%"
git push origin main

echo.
echo ===== 推送完成！去服务器执行 deploy.sh 即可生效 =====
pause
