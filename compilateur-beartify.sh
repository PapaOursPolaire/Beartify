#!/bin/bash

# --- CONFIGURATION ---
PROJECT_NAME="beartify"
OUTPUT_DIR="./RELEASES_LINUX"

echo "===================================================="
echo "   BEARTIFY - COMPILATEUR UNIVERSEL (LINUX & APK)   "
echo "===================================================="

# 1. Installation des dépendances système (Ubuntu/Debian)
echo "[1/5] Vérification des dépendances système..."
sudo apt-get update
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libwebkit2gtk-4.1-dev \
    libappindicator3-dev librsvg2-dev patchelf librust-alsa-sys-dev \
    build-essential curl wget

# 2. Vérification de Rust et des cibles Android
echo "[2/5] Configuration de Rust pour Android..."
if ! command -v rustc &> /dev/null; then
    echo "Rust n'est pas installé. Installation en cours..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Ajout des architectures Android courantes
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android

# 3. Installation des dépendances Node.js
echo "[3/5] Installation des modules Node.js..."
npm install

# 4. Compilation
echo "[4/5] Lancement de la compilation..."

# --- Build Linux (.AppImage & .deb) ---
echo "--- Build Linux ---"
npm run tauri build

# --- Build Android (.apk) ---
echo "--- Build Android ---"
# Note : S'assure que ANDROID_HOME est bien défini sur ta machine Linux
if [ -z "$ANDROID_HOME" ]; then
    echo "[ATTENTION] ANDROID_HOME n'est pas défini. Le build Android risque d'échouer."
    echo "Assure-toi d'avoir installé Android SDK et NDK."
fi

# Initialisation si le dossier a été supprimé
if [ ! -d "src-tauri/gen/android" ]; then
    echo "Initialisation du projet Android..."
    npm run tauri android init
fi

npm run tauri android build

# 5. Rangement des fichiers
echo "[5/5] Collecte des exécutables..."
mkdir -p "$OUTPUT_DIR"

# Récupération Linux
cp src-tauri/target/release/bundle/appimage/*.AppImage "$OUTPUT_DIR/" 2>/dev/null
cp src-tauri/target/release/bundle/deb/*.deb "$OUTPUT_DIR/" 2>/dev/null

# Récupération Android
cp src-tauri/gen/android/app/build/outputs/apk/release/*.apk "$OUTPUT_DIR/" 2>/dev/null

echo "===================================================="
echo " TERMINE !"
echo " Tes fichiers sont dans : $OUTPUT_DIR"
echo " Fichiers générés :"
ls -1 "$OUTPUT_DIR"
echo "===================================================="