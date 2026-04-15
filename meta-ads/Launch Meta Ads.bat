@echo off
rem Double-click this file to start the Meta Ads Analytics server.
rem The terminal window that opens IS the server — close it to stop.
rem Requires Node.js (LTS) installed from https://nodejs.org.

cd /d "%~dp0"

rem Install dependencies the first time.
if not exist node_modules (
  echo Installing dependencies (first run only)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Make sure Node.js is installed from https://nodejs.org
    pause
    exit /b 1
  )
)

rem Open the browser after a short delay so the server has time to boot.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

echo.
echo Starting Meta Ads Analytics on http://localhost:5000
echo Close this window to stop the server.
echo.
npm start
pause
