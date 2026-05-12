#!/bin/bash

# ====================================================
#   BEARTIFY - SCRIPT D'INITIALISATION DEBIAN 13
# ====================================================

set -e

echo "===================================================="
echo "      INITIALISATION ENVIRONNEMENT BEARTIFY"
echo "===================================================="

# ----------------------------------------------------
# Vérification sudo
# ----------------------------------------------------
if [ "$EUID" -eq 0 ]; then
    echo "[ERREUR] Ne lance pas ce script en root."
    echo "Utilise simplement : ./init.sh"
    exit 1
fi

# ----------------------------------------------------
# Mise à jour système
# ----------------------------------------------------
echo "[1/8] Mise à jour des dépôts..."
sudo apt update

# ----------------------------------------------------
# Dépendances système
# ----------------------------------------------------
echo "[2/8] Installation des dépendances système..."

sudo apt install -y \
    build-essential \
    curl \
    wget \
    file \
    git \
    unzip \
    zip \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    libwebkit2gtk-4.1-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    librust-alsa-sys-dev \
    clang \
    cmake \
    ninja-build \
    default-jdk \
    adb \
    npm \
    nodejs

# ----------------------------------------------------
# Installation Rust
# ----------------------------------------------------
echo "[3/8] Vérification de Rust..."

if ! command -v rustc &> /dev/null; then
    echo "Installation de Rust..."

    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

    source "$HOME/.cargo/env"
else
    echo "Rust déjà installé."
fi

# ----------------------------------------------------
# Mise à jour Rust
# ----------------------------------------------------
echo "[4/8] Mise à jour Rust..."
rustup update

# ----------------------------------------------------
# Cibles Android Rust
# ----------------------------------------------------
echo "[5/8] Installation des targets Android Rust..."

rustup target add \
    aarch64-linux-android \
    armv7-linux-androideabi \
    x86_64-linux-android \
    i686-linux-android

# ----------------------------------------------------
# Installation Tauri CLI
# ----------------------------------------------------
echo "[6/8] Installation de la CLI Tauri..."

cargo install tauri-cli --locked || true

# ----------------------------------------------------
# Vérification Android SDK
# ----------------------------------------------------
echo "[7/8] Vérification Android SDK..."

if [ -z "$ANDROID_HOME" ]; then
    echo ""
    echo "[ATTENTION]"
    echo "ANDROID_HOME n'est pas défini."
    echo ""
    echo "Pour compiler les APK Android, installe :"
    echo "  - Android Studio"
    echo "  - Android SDK"
    echo "  - Android NDK"
    echo ""
    echo "Puis ajoute dans ~/.bashrc :"
    echo ""
    echo 'export ANDROID_HOME=$HOME/Android/Sdk'
    echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools'
    echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin'
    echo ""
else
    echo "ANDROID_HOME détecté : $ANDROID_HOME"
fi

# ----------------------------------------------------
# Vérification Node.js
# ----------------------------------------------------
echo "[8/8] Vérification versions..."

echo "--------------------------------"
echo "Node.js : $(node -v)"
echo "npm     : $(npm -v)"
echo "Rust    : $(rustc --version)"
echo "Cargo   : $(cargo --version)"
echo "Java    :"
java -version
echo "--------------------------------"

echo ""
echo "===================================================="
echo " INITIALISATION TERMINÉE"
echo "===================================================="
echo ""
echo "Tu peux maintenant lancer :"
echo ""
echo "chmod +x compilateur-beartify.sh"
echo "./compilateur-beartify.sh"
echo ""
