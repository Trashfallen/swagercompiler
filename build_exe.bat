@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto fail
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt pyinstaller pillow
if errorlevel 1 goto fail

".venv\Scripts\python.exe" tools\make_icon.py
if errorlevel 1 goto fail

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onefile --windowed --name SwaggerCompiler --icon assets\app.ico --add-data "template.html;." --add-data "renderer-core.js;." --add-data "renderer-page.js;." --add-data "app_ui.html;." --add-data "wiki.css;." app.py
if errorlevel 1 goto fail

if not exist bin mkdir bin
copy /y "dist\SwaggerCompiler.exe" "bin\SwaggerCompiler.exe" >nul
if errorlevel 1 goto fail

echo Done: bin\SwaggerCompiler.exe
exit /b 0

:fail
echo Build failed
exit /b 1
