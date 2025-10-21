@echo off
echo Starting Telegram Airdrop Bot for Windows...
echo.

REM Kill any process using port 3001
echo Cleaning up port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill any process using port 3002
echo Cleaning up port 3002...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3002') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Ports cleaned successfully.
echo.

REM Start the bot
echo Starting the bot...
npm run start:win

echo.
echo Bot stopped.
pause