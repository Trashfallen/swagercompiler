@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto fail
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt pyinstaller
if errorlevel 1 goto fail

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onefile --console --name openapi2html --add-data "template.html;." --add-data "renderer-core.js;." --add-data "renderer-page.js;." openapi2html.py
if errorlevel 1 goto fail

if not exist bin mkdir bin
copy /y "dist\openapi2html.exe" "bin\openapi2html.exe" >nul
if errorlevel 1 goto fail

echo Done: bin\openapi2html.exe
exit /b 0

:fail
echo Build failed
exit /b 1
