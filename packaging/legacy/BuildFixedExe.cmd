@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Missing .venv. Create it with Python 3.14 first.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Missing npm. Build frontend\recovered-dist before running this script.
) else (
  pushd frontend
  call npm run build
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

if not exist "frontend\recovered-dist\index.html" (
  echo Missing frontend\recovered-dist\index.html.
  exit /b 1
)

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean IFC_Viewer_Fixed.spec
exit /b %errorlevel%
