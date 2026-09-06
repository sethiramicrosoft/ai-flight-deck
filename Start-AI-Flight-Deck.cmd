@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is not ready.
  echo Starting the guided first-time setup...
  echo.
  call "%~dp0SETUP-AI-Flight-Deck.cmd"
  exit /b %errorlevel%
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 (
  echo AI Flight Deck requires Node.js 18 or later.
  echo Starting the guided setup to update it...
  echo.
  call "%~dp0SETUP-AI-Flight-Deck.cmd"
  exit /b %errorlevel%
)

echo Starting AI Flight Deck...
echo Keep this window open while you use the application.
echo.
node server.js 8080 --open
if errorlevel 1 (
  echo.
  echo AI Flight Deck stopped with an error.
  pause
)
