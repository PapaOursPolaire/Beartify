@echo off
set FXPATH=lib\javafx-sdk-24.0.1\lib
set TAGGER=lib\jaudiotagger-2.2.6.jar

REM Récupère tous les JAR JavaFX dans un seul classpath
set FXJARS=
for %%f in (%FXPATH%\*.jar) do (
    set FXJARS=!FXJARS!;%%f
)

REM Active l'expansion des variables retardée
setlocal enabledelayedexpansion

echo Compilation...
javac --module-path "%FXPATH%" --add-modules javafx.controls,javafx.media,javafx.swing -cp ".;%TAGGER%" Lyrics.java

if %errorlevel% neq 0 (
    echo Erreur de compilation.
    pause
    exit /b
)

echo Lancement...
java --module-path "%FXPATH%" --add-modules javafx.controls,javafx.media,javafx.swing -cp ".;%TAGGER%" Lyrics
pause
