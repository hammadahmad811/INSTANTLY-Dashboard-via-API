@echo off
title Instantly Dashboard
color 0A

echo.
echo  ============================================
echo   Instantly Dashboard
echo  ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    cls
    echo.
    echo  ============================================
    echo   Node.js is required but NOT installed.
    echo  ============================================
    echo.
    echo  Opening the Node.js download page for you...
    echo.
    start "" "https://nodejs.org/en/download"
    echo  STEPS:
    echo.
    echo    1. The Node.js website just opened in your browser.
    echo    2. Click the big green LTS download button.
    echo    3. Run the installer ^(keep clicking Next / Install^).
    echo    4. Restart your computer when prompted.
    echo    5. Double-click start.bat again.
    echo.
    echo  ============================================
    echo.
    pause
    exit /b 1
)

:: Check if app.js exists in the same folder
if not exist "%~dp0app.js" (
    echo  ERROR: app.js not found.
    echo  Make sure start.bat and app.js are in the same folder.
    echo.
    pause
    exit /b 1
)

:: Check if dashboard.html exists
if not exist "%~dp0dashboard.html" (
    echo  ERROR: dashboard.html not found.
    echo  Make sure start.bat, app.js and dashboard.html are all in the same folder.
    echo.
    pause
    exit /b 1
)

:: Change to the folder where this .bat file lives
cd /d "%~dp0"

echo  Starting server...
echo.

:: Start app.js in the background so we can open the browser ourselves
start /B node app.js

:: Wait 2 seconds for the server to be ready
echo  Waiting for server to start...
timeout /t 2 /nobreak >nul

:: Open the browser directly from the .bat file (most reliable method on Windows)
echo  Opening browser at http://localhost:3000
start "" "http://localhost:3000"

echo.
echo  ============================================
echo   Dashboard is running at:
echo   http://localhost:3000
echo  ============================================
echo.
echo  * Keep this window open — closing it stops the server.
echo  * If the browser didn't open, go to: http://localhost:3000
echo.

:: Wait for the Node.js process to exit (keeps the window open)
:waitloop
timeout /t 5 /nobreak >nul
tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel% equ 0 goto waitloop

echo.
echo  Server stopped.
pause
