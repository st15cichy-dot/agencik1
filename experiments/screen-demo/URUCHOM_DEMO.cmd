@echo off
setlocal
cd /d "%~dp0"
title Agencik - lokalna makieta PAPER

where py >nul 2>&1
if errorlevel 1 (
  echo Brak Python Launcher. Zainstaluj Python 3.11 lub nowszy z python.org.
  echo Podczas instalacji uwzglednij Tcl/Tk i Python Launcher.
  pause
  exit /b 1
)
py -3 -c "import sys, tkinter; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
  echo Wymagany Python 3.11 lub nowszy z Tcl/Tk.
  pause
  exit /b 1
)

where tesseract >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\Tesseract-OCR\tesseract.exe" set "PATH=%ProgramFiles%\Tesseract-OCR;%PATH%"
)
where tesseract >nul 2>&1
if errorlevel 1 (
  echo Brak lokalnego Tesseract OCR. Zainstaluj bezplatny Tesseract dla Windows.
  echo Instrukcja i wymagania znajduja sie w README.md.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv
if errorlevel 1 (
  echo Nie udalo sie utworzyc lokalnego srodowiska Python.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Nie udalo sie zainstalowac bezplatnych zaleznosci z requirements.txt.
  pause
  exit /b 1
)

echo Uruchamianie wlasnej makiety. Ten program nie laczy sie z brokerem.
".venv\Scripts\python.exe" screen_demo.py --demo
set "TASK_DEMO_RESULT=%ERRORLEVEL%"
if not "%TASK_DEMO_RESULT%"=="0" echo Program zakonczyl sie bledem. Sprawdz komunikat powyzej.
pause
exit /b %TASK_DEMO_RESULT%
