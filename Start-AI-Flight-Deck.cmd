@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run AI Flight Deck.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

node server.js 8080 --open
if errorlevel 1 (
  echo.
  echo AI Flight Deck stopped with an error.
  pause
)
