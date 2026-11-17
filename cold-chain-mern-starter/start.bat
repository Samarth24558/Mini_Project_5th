@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install Node.js LTS and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm is required. Install Node.js LTS and try again.
    pause
    exit /b 1
)

if not exist "backend\.env" (
    echo Missing backend\.env. Copy backend\.env.example to backend\.env and configure it.
    pause
    exit /b 1
)

if not exist "frontend\.env" (
    echo Missing frontend\.env. Copy frontend\.env.example to frontend\.env and configure it.
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    pushd "backend"
    call npm install
    if errorlevel 1 (
        popd
        echo Backend dependency installation failed.
        pause
        exit /b 1
    )
    popd
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd "frontend"
    call npm install
    if errorlevel 1 (
        popd
        echo Frontend dependency installation failed.
        pause
        exit /b 1
    )
    popd
)

start "Cold Chain Backend" /D "%~dp0backend" cmd /k "npm run dev"
start "Cold Chain Frontend" /D "%~dp0frontend" cmd /k "npm run dev"

echo Backend and frontend are starting in separate windows.
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:5000
exit /b 0