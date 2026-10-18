@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node 18+ is required: https://nodejs.org & pause & exit /b 1)
if not exist .env (copy .env.example .env >nul & echo Created .env - add OPENAI_API_KEY, or enter your key in app Settings.)
node server.js
pause
