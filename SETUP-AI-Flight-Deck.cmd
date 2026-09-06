@echo off
setlocal
cd /d "%~dp0"
title AI Flight Deck Setup

echo.
echo ============================================================
echo  AI Flight Deck - First-time setup
echo ============================================================
echo.
echo This setup checks the computer, installs missing user-level
echo prerequisites with your approval, and starts AI Flight Deck.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ai-flight-deck.ps1"
set "setupExit=%errorlevel%"

echo.
if not "%setupExit%"=="0" (
  echo Setup did not complete. Read the message above, then run this
  echo file again after correcting the problem.
) else (
  echo Setup completed.
)
echo.
pause
exit /b %setupExit%
