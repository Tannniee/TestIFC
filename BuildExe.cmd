@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not defined IFC_BUILD_DIST set "IFC_BUILD_DIST=dist"
if not defined IFC_BUILD_WORK set "IFC_BUILD_WORK=build"

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Missing .venv. Create it with Python 3.14 first.
  exit /b 1
)

echo [1/3] Running Python tests...
".venv\Scripts\python.exe" -m unittest discover -v -s tests -p "test_*.py"
if errorlevel 1 exit /b 1

echo [2/3] Checking and building the frontend...
call "frontend\BuildFrontend.cmd"
if errorlevel 1 exit /b 1

if not exist "frontend\dist\index.html" (
  echo ERROR: frontend\dist\index.html was not built.
  exit /b 1
)

echo [3/3] Packaging the desktop application...
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --distpath "%IFC_BUILD_DIST%" --workpath "%IFC_BUILD_WORK%" IFC_Viewer.spec
if errorlevel 1 exit /b 1

echo Package created in %IFC_BUILD_DIST%\ using APP_VERSION from src\version.py.
exit /b 0
