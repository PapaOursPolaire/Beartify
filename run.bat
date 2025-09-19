@echo off
setlocal

REM === Configuration ===
set JAVA_FX_LIB=lib\javafx-sdk-24.0.1\lib
set LIB_PATH=lib\*
set OUTPUT_DIR=out
set MAIN_CLASS=Beartify
set JAVA_RELEASE=24

echo ----------------------------
echo Compilation de %MAIN_CLASS%.java
echo ----------------------------

REM === Compilation avec preview features ===
javac -d %OUTPUT_DIR% ^
  --enable-preview ^
  --release %JAVA_RELEASE% ^
  --module-path "%JAVA_FX_LIB%" ^
  --add-modules javafx.controls,javafx.fxml,javafx.media,javafx.swing ^
  -cp "%LIB_PATH%;." ^
  %MAIN_CLASS%.java

IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Compilation échouée.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ✅ Compilation réussie.
echo ----------------------------
echo Lancement de l'application...
echo ----------------------------

REM === Exécution avec preview features ===
java --enable-preview ^
  --module-path "%JAVA_FX_LIB%" ^
  --add-modules javafx.controls,javafx.fxml,javafx.media,javafx.swing ^
  -cp "%LIB_PATH%;%OUTPUT_DIR%" ^
  %MAIN_CLASS%

pause