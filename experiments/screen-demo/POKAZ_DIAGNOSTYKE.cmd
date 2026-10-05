@echo off
if /i "%~1"=="--inside" goto inside
start "Agencik - odczyt diagnostyki" "%ComSpec%" /k call "%~f0" --inside
exit /b

:inside
setlocal DisableDelayedExpansion
set "TASK_LOG_DIR=%~dp0..\..\.development-output\screen-demo"
echo Odczyt diagnostyki lokalnej makiety PAPER_MOCK.
echo Ten skrypt tylko czyta pliki. Nie uruchamia demo ani nie odblokowuje HALT.
echo.
echo DZIENNIK WYKONANIA: "%TASK_LOG_DIR%\native-execution.jsonl"
if exist "%TASK_LOG_DIR%\native-execution.jsonl" (
  type "%TASK_LOG_DIR%\native-execution.jsonl"
) else (
  echo Brak dziennika wykonania w tej paczce.
  echo Uruchom ten przycisk z folderu paczki, w ktorej wystapil problem.
)
echo.
echo LOG URUCHOMIENIA: "%TASK_LOG_DIR%\uruchomienie.log"
if exist "%TASK_LOG_DIR%\uruchomienie.log" (
  type "%TASK_LOG_DIR%\uruchomienie.log"
) else (
  echo Brak loga uruchomienia w tej paczce.
)
echo.
echo Do diagnozy potrzebna jest pelna historia: PENDING, CONFIRMED i pierwszy HALT.
echo Zamkniecie okna demo takze zapisuje OPERATOR_STOP.
echo Zachowaj dziennik. Nie usuwaj go w celu ponowienia proby.
exit /b 0
