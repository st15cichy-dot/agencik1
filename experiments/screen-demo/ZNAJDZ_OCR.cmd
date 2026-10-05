@echo off
rem Shared discovery: only a working local Tesseract with the eng language.
set "TASK_TESSERACT="
if defined TESSERACT_CMD call :probe "%TESSERACT_CMD%"
if defined TASK_TESSERACT exit /b 0
for /f "delims=" %%T in ('where tesseract 2^>nul') do call :probe "%%T"
if defined TASK_TESSERACT exit /b 0
call :probe "%ProgramFiles%\Tesseract-OCR\tesseract.exe"
call :probe "%ProgramFiles(x86)%\Tesseract-OCR\tesseract.exe"
call :probe "%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"
call :probe "%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe"
if defined TASK_TESSERACT exit /b 0
exit /b 1

:probe
if defined TASK_TESSERACT exit /b 0
if /i not "%~x1"==".exe" exit /b 1
if not exist "%~1" exit /b 1
"%~1" --version >nul 2>&1
if errorlevel 1 exit /b 1
"%~1" --list-langs 2>nul | "%SystemRoot%\System32\findstr.exe" /x /c:"eng" >nul
if errorlevel 1 exit /b 1
set "TASK_TESSERACT=%~f1"
exit /b 0
