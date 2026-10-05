@echo off
if /i "%~1"=="--inside" goto inside
start "Agencik - lokalna makieta PAPER" "%ComSpec%" /k call "%~f0" --inside
exit /b

:inside
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if not exist "ZNAJDZ_OCR.cmd" goto incomplete_package
if not exist "screen_demo.py" goto incomplete_package
if not exist "requirements.txt" goto incomplete_package
set "TASK_LOG_DIR=%~dp0..\..\.development-output\screen-demo"
if not exist "%TASK_LOG_DIR%" mkdir "%TASK_LOG_DIR%"
set "TASK_DEMO_LOG=%TASK_LOG_DIR%\uruchomienie.log"
>"%TASK_DEMO_LOG%" echo Diagnostyka uruchomienia lokalnej makiety PAPER.

where py >nul 2>&1
if errorlevel 1 (
  echo Brak Python Launcher. Zainstaluj Python 3.11 lub nowszy z python.org.
  echo Podczas instalacji uwzglednij Tcl/Tk i Python Launcher.
  >>"%TASK_DEMO_LOG%" echo Brak Python Launcher py.
  exit /b 1
)
py -3 -c "import sys, tkinter; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >>"%TASK_DEMO_LOG%" 2>&1
if errorlevel 1 (
  echo Wymagany Python 3.11 lub nowszy z Tcl/Tk. Szczegoly w uruchomienie.log.
  exit /b 1
)

call "%~dp0ZNAJDZ_OCR.cmd"
if errorlevel 1 (
  echo Brak dzialajacego Tesseract OCR z jezykiem eng.
  echo Uruchom INSTALUJ_OCR.cmd z tego samego katalogu.
  >>"%TASK_DEMO_LOG%" echo Nie wykryto dzialajacego Tesseract OCR z jezykiem eng.
  exit /b 1
)
"%TASK_TESSERACT%" --version >>"%TASK_DEMO_LOG%" 2>&1
"%TASK_TESSERACT%" --list-langs >>"%TASK_DEMO_LOG%" 2>&1

if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv >>"%TASK_DEMO_LOG%" 2>&1
if errorlevel 1 (
  echo Nie udalo sie utworzyc srodowiska Python. Szczegoly w uruchomienie.log.
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt >>"%TASK_DEMO_LOG%" 2>&1
if errorlevel 1 (
  echo Nie udalo sie zainstalowac Pillow. Szczegoly w uruchomienie.log.
  exit /b 1
)

echo Uruchamianie wlasnej makiety. Ten program nie laczy sie z brokerem.
".venv\Scripts\python.exe" screen_demo.py --demo --tesseract "%TASK_TESSERACT%" >>"%TASK_DEMO_LOG%" 2>&1
set "TASK_DEMO_RESULT=%ERRORLEVEL%"
if not "%TASK_DEMO_RESULT%"=="0" echo Program zatrzymany. Szczegoly w .development-output\screen-demo\uruchomienie.log.
exit /b %TASK_DEMO_RESULT%

:incomplete_package
echo Rozpakuj CALY ZIP do nowego katalogu przed uruchomieniem demo.
echo Brakuje plikow makiety. Nie uruchamiam programu.
exit /b 1
