@echo off
setlocal
if "%~1"=="" (
  echo Drag a spec file ^(.yaml, .yml, .json^) onto this icon.
  pause
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Use bin\SwaggerCompiler.exe or install Python 3.8+ and run: pip install -r requirements.txt
  pause
  exit /b 1
)
python "%~dp0openapi2html.py" --open %*
if errorlevel 1 pause
