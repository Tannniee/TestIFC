@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not defined IFC_BUILD_DIST set "IFC_BUILD_DIST=dist"
if not defined IFC_BUILD_WORK set "IFC_BUILD_WORK=build"

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Missing .venv. Create it with Python 3.14 first.
  exit /b 1
)

echo [1/4] Running Python tests...
".venv\Scripts\python.exe" -m unittest discover -v -s tests -p "test_*.py"
if errorlevel 1 exit /b 1

echo [2/4] Checking and building the frontend...
call "frontend\BuildFrontend.cmd"
if errorlevel 1 exit /b 1

if not exist "frontend\dist\index.html" (
  echo ERROR: frontend\dist\index.html was not built.
  exit /b 1
)
if exist "frontend\dist\vendor\web-ifc" (
  echo ERROR: WebIFC assets remain in the frontend package.
  exit /b 1
)
if exist "frontend\dist\vendor\fragments" (
  echo ERROR: Fragments worker remains in the frontend package.
  exit /b 1
)

echo [3/4] Publishing the self-contained Engine V2 worker...
dotnet publish "engine_v2\IfcEngineV2.Scanner\IfcEngineV2.Scanner.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -p:DebugSymbols=false -o "engine_v2\publish\win-x64"
if errorlevel 1 exit /b 1

if not exist "engine_v2\publish\win-x64\ifc-engine-v2-scanner.exe" (
  echo ERROR: Engine V2 worker was not published.
  exit /b 1
)

echo [4/4] Packaging the desktop application...
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --distpath "%IFC_BUILD_DIST%" --workpath "%IFC_BUILD_WORK%" IFC_Viewer.spec
if errorlevel 1 exit /b 1

echo Package created in %IFC_BUILD_DIST%\ using APP_VERSION from src\version.py.
exit /b 0
