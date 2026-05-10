@echo off
:: On ne force pas l'UTF-8 tout de suite, certains Windows n'aiment pas
:: chcp 65001 >nul 

echo Verification du dossier...
cd /d "%~dp0"
echo Dossier actuel : %cd%

:: --- 0. VERIFICATION ADMIN ---
echo Verification des droits...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo [ERREUR] TU DOIS EXECUTER EN TANT QU'ADMINISTRATEUR.
    echo Fais un clic droit sur le fichier puis "Executer en tant qu'administrateur".
    echo.
    pause
    exit /b 1
)

:: --- 1. MENU ---
echo.
echo [1] Rapide (Pas de nettoyage)
echo [2] Nettoyage Standard (Recommande)
echo [3] Grand Menage (Reset complet)
echo.
set /p choix="Ton choix (1, 2 ou 3) : "

if "%choix%"=="2" (
    echo Nettoyage en cours...
    if exist "src-tauri\target" rd /s /q "src-tauri\target"
    if exist "src-tauri\gen" rd /s /q "src-tauri\gen"
)
if "%choix%"=="3" (
    echo Nettoyage total...
    if exist "src-tauri\target" rd /s /q "src-tauri\target"
    if exist "src-tauri\gen" rd /s /q "src-tauri\gen"
    if exist "node_modules" rd /s /q "node_modules"
    call npm install
)

:: --- 2. BUILD ---
echo Lancement du Build Windows...
call npm run tauri build

echo.
echo Lancement du Build Android...
:: Si le dossier gen a ete rase, on force l'init
if not exist "src-tauri\gen\android" (
    echo Initialisation Android...
    call npm run tauri android init
)
call npm run tauri android build

echo.
echo Termine ! Verifie le dossier src-tauri/target/release
pause