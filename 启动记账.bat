@echo off
rem 六芒星记账 - 一键启动脚本
rem 双击本文件即可启动应用;如果依赖没装过,会自动先装一次
cd /d "%~dp0"

rem 开发环境里可能带了这个变量,会把应用当成普通程序运行导致打不开,先关掉
set ELECTRON_RUN_AS_NODE=

if not exist node_modules\electron\dist\electron.exe (
  echo 首次运行,正在安装依赖(需要联网,可能要等几分钟)...
  call npm install
)
echo 正在启动六芒星记账...
call npm start
