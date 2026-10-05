@echo off
if /i "%~1"=="--inside" goto inside
start "Agencik - instalacja Tesseract OCR" "%ComSpec%" /k call "%~f0" --inside
exit /b

:inside
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if not exist "ZNAJDZ_OCR.cmd" goto incomplete_package
if not exist "URUCHOM_DEMO.cmd" goto incomplete_package
if not exist "screen_demo.py" goto incomplete_package
if not exist "requirements.txt" goto incomplete_package
set "TASK_LOG_DIR=%~dp0..\..\.development-output\screen-demo"
if not exist "%TASK_LOG_DIR%" mkdir "%TASK_LOG_DIR%"
set "TASK_INSTALL_LOG=%TASK_LOG_DIR%\instalacja-ocr.log"
>"%TASK_INSTALL_LOG%" echo Instalacja bezplatnego Tesseract OCR dla lokalnej makiety.

call "%~dp0ZNAJDZ_OCR.cmd"
if not errorlevel 1 goto ready

where winget >nul 2>&1
if errorlevel 1 (
  >>"%TASK_INSTALL_LOG%" echo Brak winget. Instalacja nie zostala wykonana.
  echo Brak winget - potrzebny Windows App Installer.
  echo Otwieram oficjalna instrukcje instalacji Tesseract dla Windows.
  start "" "https://tesseract-ocr.github.io/tessdoc/Installation.html"
  echo Po instalacji uruchom INSTALUJ_OCR.cmd ponownie.
  echo Szczegoly sa w pliku instalacja-ocr.log w .development-output\screen-demo.
  exit /b 1
)

echo Instalowanie bezplatnego Tesseract OCR z katalogu Microsoft winget.
echo Windows moze poprosic o potwierdzenie instalacji lub uprawnienia administratora.
winget install --exact --id UB-Mannheim.TesseractOCR --source winget --accept-package-agreements --accept-source-agreements --interactive
set "TASK_INSTALL_RESULT=%ERRORLEVEL%"
>>"%TASK_INSTALL_LOG%" echo Kod zakonczenia winget: %TASK_INSTALL_RESULT%

rem Re-discover after install: this process can have a stale PATH.
rem A nonzero winget result can also mean the package was already installed.
call "%~dp0ZNAJDZ_OCR.cmd"
if not errorlevel 1 goto ready
>>"%TASK_INSTALL_LOG%" echo Nie znaleziono dzialajacego Tesseract z jezykiem eng po instalacji.
echo Nie znaleziono dzialajacego OCR z jezykiem eng.
echo Sprawdz komunikat instalatora powyzej. Instalacja nie jest potwierdzona.
echo Jesli wybrales wlasny katalog, uruchom ponownie w tym oknie:
echo set "TESSERACT_CMD=C:\twoj-katalog\tesseract.exe"
echo INSTALUJ_OCR.cmd --inside
exit /b 1

:ready
>>"%TASK_INSTALL_LOG%" echo Tesseract dziala i zawiera jezyk eng.
echo Tesseract jest gotowy. Uruchamiam makiete.
call "%~dp0URUCHOM_DEMO.cmd" --inside
exit /b %ERRORLEVEL%

:incomplete_package
echo Rozpakuj CALY ZIP do nowego katalogu przed uruchomieniem instalatora.
echo Brakuje plikow makiety. Tesseract nie zostal zainstalowany przez ten skrypt.
exit /b 1
