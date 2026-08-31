@echo off
setlocal
cd /d "%~dp0"

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

if exist "%CODEX_NODE%\node.exe" set "PATH=%CODEX_NODE%;%PATH%"

if exist "%CODEX_PNPM%" goto bundled_pnpm

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found.
  exit /b 1
)

call pnpm install --frozen-lockfile
if errorlevel 1 exit /b 1
call pnpm run test
if errorlevel 1 exit /b 1
call pnpm run check
if errorlevel 1 exit /b 1
call pnpm run build
exit /b %errorlevel%

:bundled_pnpm
call "%CODEX_PNPM%" install --frozen-lockfile
if errorlevel 1 exit /b 1
call "%CODEX_PNPM%" run test
if errorlevel 1 exit /b 1
call "%CODEX_PNPM%" run check
if errorlevel 1 exit /b 1
call "%CODEX_PNPM%" run build
exit /b %errorlevel%
