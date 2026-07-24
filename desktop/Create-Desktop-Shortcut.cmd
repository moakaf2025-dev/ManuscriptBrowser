@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM =========================================================
REM   انشاء اختصار سطح المكتب لبرنامج متصفح المخطوطات
REM   Create Desktop Shortcut for ManuscriptBrowser
REM =========================================================

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

set "EXE_PATH=%APP_DIR%\ManuscriptBrowser.exe"
set "ICON_PATH=%APP_DIR%\resources\app.asar.unpacked\icon.ico"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP_DIR%\متصفح المخطوطات.lnk"

if not exist "%EXE_PATH%" (
    echo.
    echo [خطأ] لم يتم العثور على ملف البرنامج:
    echo   %EXE_PATH%
    echo.
    echo تأكد من وضع هذا الملف بجانب ManuscriptBrowser.exe
    echo.
    pause
    exit /b 1
)

if not exist "%ICON_PATH%" (
    set "ICON_PATH=%EXE_PATH%"
)

echo.
echo   انشاء اختصار على سطح المكتب...
echo   Creating desktop shortcut...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%'); ^
   $s.TargetPath = '%EXE_PATH%'; ^
   $s.WorkingDirectory = '%APP_DIR%'; ^
   $s.IconLocation = '%ICON_PATH%,0'; ^
   $s.Description = 'متصفح المخطوطات'; ^
   $s.WindowStyle = 1; ^
   $s.Save()"

if exist "%SHORTCUT%" (
    echo   ✔ تم انشاء الاختصار على سطح المكتب بنجاح
    echo   ✔ Shortcut created on desktop successfully
    echo.
    echo   الموقع: %SHORTCUT%
) else (
    echo   ✘ تعذر انشاء الاختصار
    echo   ✘ Failed to create shortcut
)

echo.
pause
endlocal
