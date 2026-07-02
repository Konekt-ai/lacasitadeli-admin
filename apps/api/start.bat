@echo off
cd /d "%~dp0"
node src\index.js >> "..\..\logs\api.log" 2>&1
