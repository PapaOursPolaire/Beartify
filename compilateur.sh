#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║         Beartify — Script de compilation COMPLET pour Debian        ║
# ║         Cibles : .AppImage (desktop) + .apk (Android)              ║
# ║         Hypothèse : MACHINE VIERGE (rien d'installé)               ║
# ╠══════════════════════════════════════════════════════════════════════╣
# ║  Ce script installe TOUT depuis zéro :                              ║
# ║    • Paquets système Debian (apt)                                   ║
# ║    • Rust + Cargo (via rustup)                                      ║
# ║    • Node.js 20 LTS + npm (via NodeSource)                         ║
# ║    • Tauri CLI v2                                                   ║
# ║    • JDK 17 (OpenJDK, requis pour Android)                         ║
# ║    • Android SDK Command Line Tools (via Google)                    ║
# ║    • Android Build-Tools, Platform 34, NDK r26d (via sdkmanager)   ║
# ║    • Targets Rust Android (aarch64, armv7, i686, x86_64)           ║
# ║  Puis compile l'AppImage et l'APK.                                  ║
# ╠══════════════════════════════════════════════════════════════════════╣
# ║  USAGE :                                                            ║
# ║    chmod +x build-linux.sh                                         ║
# ║    ./build-linux.sh              → installe tout + compile les deux ║
# ║    ./build-linux.sh --appimage   → installe tout + compile AppImage ║
# ║    ./build-linux.sh --apk        → installe tout + compile APK      ║
# ║    ./build-linux.sh --deps-only  → installe tout, ne compile pas    ║
# ║    ./build-linux.sh --skip-deps  → suppose tout installé, compile   ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -euo pipefail
IFS=$'\n\t'

# ══════════════════════════════════════════════════════════════════════
# CONFIGURATION — modifiez ces variables si besoin
# ══════════════════════════════════════════════════════════════════════
NODE_MAJOR="20"
ANDROID_SDK_ROOT="$HOME/.android/sdk"
ANDROID_API_LEVEL="34"
ANDROID_BUILD_TOOLS="34.0.0"
ANDROID_NDK_VERSION="26.3.11579264"
# Si cette URL est périmée : https://developer.android.com/studio#command-tools
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

# ══════════════════════════════════════════════════════════════════════
# COULEURS & HELPERS
# ══════════════════════════════════════════════════════════════════════
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
TICK="${GREEN}✔${NC}"; CROSS="${RED}✘${NC}"

info()    { echo -e "  ${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "  ${TICK} $*"; }
warn()    { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "  ${CROSS} ${RED}$*${NC}" >&2; }
step()    {
  echo ""
  echo -e "${BOLD}${CYAN}┌──────────────────────────────────────────────────┐${NC}"
  printf "${BOLD}${CYAN}│  %-48s│${NC}\n" "$*"
  echo -e "${BOLD}${CYAN}└──────────────────────────────────────────────────┘${NC}"
}
die() { error "$*"; echo -e "\n${RED}${BOLD}Compilation abandonnée.${NC}\n" >&2; exit 1; }

_STEP_START=0
timer_start() { _STEP_START=$SECONDS; }
timer_end()   { local s=$(( SECONDS - _STEP_START )); info "Durée : ${s}s"; }

# ══════════════════════════════════════════════════════════════════════
# ARGUMENTS
# ══════════════════════════════════════════════════════════════════════
BUILD_APPIMAGE=true
BUILD_APK=true
INSTALL_DEPS=true
COMPILE=true

for arg in "$@"; do
  case "$arg" in
    --appimage)  BUILD_APK=false ;;
    --apk)       BUILD_APPIMAGE=false ;;
    --deps-only) COMPILE=false ;;
    --skip-deps) INSTALL_DEPS=false ;;
    --help|-h)
      echo "Usage: $0 [--appimage|--apk|--deps-only|--skip-deps]"
      exit 0 ;;
    *) warn "Argument inconnu : $arg (ignoré)" ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════
# DÉTECTION DU PROJET
# ══════════════════════════════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[[ ! -f "package.json" && -f "../package.json" ]] && cd ..
[[ -f "package.json" ]] || die "package.json introuvable. Placez ce script à la racine du projet."
PROJECT_ROOT="$(pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
[[ -d "$TAURI_DIR" ]] || die "src-tauri/ introuvable dans $PROJECT_ROOT"
info "Projet : $PROJECT_ROOT"

# ══════════════════════════════════════════════════════════════════════
# SUDO — garder actif pendant toute la durée du script
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  echo -e "${YELLOW}Ce script installe des paquets système et nécessite sudo.${NC}"
  sudo -v || die "Impossible d'obtenir les droits sudo."
  ( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
  SUDO_KEEPER=$!
  trap 'kill "$SUDO_KEEPER" 2>/dev/null || true' EXIT
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 1/8 — PAQUETS SYSTÈME DEBIAN
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ÉTAPE 1/8 — Paquets système Debian"
  timer_start

  info "Mise à jour des sources apt..."
  sudo apt-get update -qq

  info "Outils de base..."
  sudo apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    git \
    file \
    unzip \
    zip \
    xz-utils \
    ca-certificates \
    gnupg \
    lsb-release \
    pkg-config \
    libssl-dev \
    apt-transport-https \
    software-properties-common

  # Détection version Debian
  DEBIAN_CODENAME=$(lsb_release -sc 2>/dev/null || echo "bookworm")
  DEBIAN_VERSION=$(lsb_release -sr 2>/dev/null | cut -d. -f1 || echo "12")
  info "Debian $DEBIAN_VERSION ($DEBIAN_CODENAME) détecté"

  info "Dépendances Tauri V2 (WebKit, GTK, AppImage)..."

  # webkit2gtk-4.1 est REQUIS par Tauri V2.
  # Debian 11 (Bullseye) ne l'a pas en dépôt standard → backports.
  # Debian 12 (Bookworm) l'a nativement.
  if [[ "$DEBIAN_VERSION" -le 11 ]]; then
    warn "Debian $DEBIAN_VERSION : activation de ${DEBIAN_CODENAME}-backports pour webkit2gtk-4.1"
    echo "deb http://deb.debian.org/debian ${DEBIAN_CODENAME}-backports main contrib non-free" \
      | sudo tee /etc/apt/sources.list.d/${DEBIAN_CODENAME}-backports.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -t "${DEBIAN_CODENAME}-backports" \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev 2>/dev/null || {
        warn "webkit2gtk-4.1 indisponible même via backports."
        warn "Tauri V2 nécessite webkit2gtk ≥ 4.1."
        warn "Tentative avec webkit2gtk-4.0 (peut échouer à la compilation Tauri)..."
        sudo apt-get install -y libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev || \
          die "Impossible d'installer webkit2gtk.\nMettez à jour vers Debian 12 (Bookworm) recommandé pour Tauri V2."
      }
  else
    sudo apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev
  fi

  sudo apt-get install -y --no-install-recommends \
    libgtk-3-dev \
    librsvg2-dev \
    patchelf \
    libxdo-dev \
    libglib2.0-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libgdk-pixbuf-2.0-dev \
    libatk1.0-dev \
    squashfs-tools \
    fuse \
    libfuse2

  # Indicateur système (barre de tâches) — libayatana en priorité, fallback libappindicator
  sudo apt-get install -y --no-install-recommends \
    libayatana-appindicator3-dev 2>/dev/null || \
  sudo apt-get install -y --no-install-recommends \
    libappindicator3-dev 2>/dev/null || \
    warn "libayatana-appindicator3-dev introuvable (non bloquant pour la compilation)"

  success "Paquets système installés"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 2/8 — RUST + CARGO
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ÉTAPE 2/8 — Rust + Cargo (via rustup)"
  timer_start

  if command -v rustc &>/dev/null; then
    info "Rust déjà présent ($(rustc --version)) — mise à jour vers stable..."
    rustup update stable 2>&1 | tail -3
  else
    info "Installation de Rust via rustup (sans modification du PATH système)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --no-modify-path 2>&1 | tail -5
  fi

  # Charger l'environnement Cargo immédiatement dans ce script
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

  command -v rustc &>/dev/null || die "rustc introuvable après installation de Rust."
  command -v cargo &>/dev/null || die "cargo introuvable après installation de Rust."

  success "Rust  : $(rustc --version)"
  success "Cargo : $(cargo --version)"
  timer_end
fi

# Toujours sourcer Cargo (même avec --skip-deps)
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 3/8 — NODE.JS 20 LTS + NPM
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ÉTAPE 3/8 — Node.js $NODE_MAJOR LTS + npm (via NodeSource)"
  timer_start

  NEED_NODE=true
  if command -v node &>/dev/null; then
    NODE_VER=$(node --version | tr -d 'v')
    NODE_MAJOR_INSTALLED="${NODE_VER%%.*}"
    if [[ "$NODE_MAJOR_INSTALLED" -ge 18 ]]; then
      success "Node.js déjà installé et suffisant : v$NODE_VER"
      NEED_NODE=false
    else
      warn "Node.js v$NODE_VER trop ancien (≥18 requis) — mise à jour..."
    fi
  fi

  if [[ "$NEED_NODE" == true ]]; then
    info "Ajout du dépôt NodeSource pour Node.js $NODE_MAJOR..."
    # Supprimer un éventuel dépôt NodeSource obsolète
    sudo rm -f /etc/apt/sources.list.d/nodesource.list \
               /usr/share/keyrings/nodesource.gpg 2>/dev/null || true

    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" \
      | sudo -E bash - 2>&1 | grep -E "^##|error" || true
    sudo apt-get install -y nodejs
  fi

  command -v node &>/dev/null || die "node introuvable après installation."
  command -v npm  &>/dev/null || die "npm introuvable après installation de Node.js."
  success "Node.js : $(node --version)"
  success "npm     : v$(npm --version)"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 4/8 — TAURI CLI V2
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ÉTAPE 4/8 — Tauri CLI v2"
  timer_start

  # Vérifier si v2 est déjà présent (global ou local dans le projet)
  TAURI_OK=false
  _tauri_ver() { npx --no tauri --version 2>/dev/null || tauri --version 2>/dev/null || echo ""; }
  EXISTING=$(_tauri_ver)
  if echo "$EXISTING" | grep -qE "^(tauri-cli )?2\."; then
    TAURI_OK=true
    success "Tauri CLI v2 déjà présent : $EXISTING"
  fi

  if [[ "$TAURI_OK" == false ]]; then
    info "Installation globale de Tauri CLI v2..."
    # Préfère npm global ; si permission refusée → installe localement dans le projet
    if npm install -g @tauri-apps/cli@^2 2>/dev/null; then
      success "Tauri CLI v2 installé globalement"
    else
      warn "Permission refusée pour l'install globale — installation locale dans le projet..."
      cd "$PROJECT_ROOT"
      npm install -D @tauri-apps/cli@^2
      success "Tauri CLI v2 installé localement (node_modules/.bin/tauri)"
    fi
  fi

  TAURI_FINAL=$(_tauri_ver)
  [[ -n "$TAURI_FINAL" ]] || die "Tauri CLI introuvable après installation."
  success "Tauri CLI : $TAURI_FINAL"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 5/8 — JDK 17 (Android uniquement)
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ÉTAPE 5/8 — OpenJDK 17 (requis pour Android)"
  timer_start

  NEED_JDK=true
  if command -v java &>/dev/null; then
    JAVA_VER_RAW=$(java -version 2>&1 | head -1 | awk -F'"' '{print $2}')
    JAVA_MAJOR="${JAVA_VER_RAW%%.*}"
    [[ "$JAVA_MAJOR" =~ ^[0-9]+$ ]] || JAVA_MAJOR=0
    if [[ "$JAVA_MAJOR" -ge 17 ]]; then
      success "JDK déjà installé : $JAVA_VER_RAW"
      NEED_JDK=false
    else
      warn "Java $JAVA_VER_RAW trop ancien (JDK ≥17 requis) — installation JDK 17..."
    fi
  fi

  if [[ "$NEED_JDK" == true ]]; then
    sudo apt-get install -y --no-install-recommends openjdk-17-jdk openjdk-17-jre
    # Forcer l'alternative vers JDK 17
    JDK17_PATH=$(update-java-alternatives -l 2>/dev/null \
      | grep -i "java-1.17\|java-17\|openjdk-17" | awk '{print $3}' | head -1)
    if [[ -n "$JDK17_PATH" ]]; then
      sudo update-java-alternatives --set "$( \
        update-java-alternatives -l 2>/dev/null \
        | grep -i "java-1.17\|java-17\|openjdk-17" | awk '{print $1}' | head -1)" \
        2>/dev/null || true
    fi
  fi

  # Déduire JAVA_HOME automatiquement si non défini
  if [[ -z "${JAVA_HOME:-}" ]]; then
    DETECTED_JH=$(update-java-alternatives -l 2>/dev/null \
      | grep -i "java-1.17\|java-17\|openjdk-17" | awk '{print $3}' | head -1)
    if [[ -z "$DETECTED_JH" ]]; then
      DETECTED_JH=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
    fi
    export JAVA_HOME="$DETECTED_JH"
  fi

  # Persister JAVA_HOME dans .bashrc
  grep -qF "export JAVA_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export JAVA_HOME=$JAVA_HOME" >> "$HOME/.bashrc"

  java -version 2>&1 | head -1 | grep -qE '"17\.|"18\.|"19\.|"20\.|"21\.' || \
    die "JDK ≥17 introuvable après installation. java=$(java -version 2>&1 | head -1)"

  success "JDK       : $(java -version 2>&1 | head -1)"
  success "JAVA_HOME : $JAVA_HOME"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 6/8 — ANDROID SDK (cmdline-tools + sdkmanager)
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ÉTAPE 6/8 — Android SDK (platform-tools + build-tools + platform)"
  timer_start

  CMDLINE_DIR="$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mkdir -p "$ANDROID_SDK_ROOT"

  if [[ ! -f "$CMDLINE_DIR/bin/sdkmanager" ]]; then
    info "Téléchargement des Android Command Line Tools..."
    info "URL : $CMDLINE_TOOLS_URL"

    TMP_SDK=$(mktemp -d)
    # Nettoyage du répertoire temporaire à la sortie
    # (on ne peut pas utiliser trap RETURN ici car on est dans le script principal)

    for attempt in 1 2 3; do
      wget -q --show-progress --timeout=120 \
        "$CMDLINE_TOOLS_URL" -O "$TMP_SDK/cmdline-tools.zip" && break || {
          warn "Tentative $attempt/3 échouée..."
          sleep 5
        }
      if [[ $attempt -eq 3 ]]; then
        rm -rf "$TMP_SDK"
        die "Impossible de télécharger les Android Command Line Tools après 3 tentatives.\n  Vérifiez votre connexion ou mettez à jour CMDLINE_TOOLS_URL dans ce script.\n  Page officielle : https://developer.android.com/studio#command-tools"
      fi
    done

    info "Extraction..."
    mkdir -p "$TMP_SDK/extracted"
    unzip -q "$TMP_SDK/cmdline-tools.zip" -d "$TMP_SDK/extracted"

    # L'archive contient toujours un dossier racine "cmdline-tools"
    if [[ -d "$TMP_SDK/extracted/cmdline-tools" ]]; then
      # S'assurer que le dossier de destination n'existe pas déjà en partie
      rm -rf "$CMDLINE_DIR"
      mv "$TMP_SDK/extracted/cmdline-tools" "$CMDLINE_DIR"
    else
      rm -rf "$CMDLINE_DIR"
      mv "$TMP_SDK/extracted" "$CMDLINE_DIR"
    fi

    rm -rf "$TMP_SDK"
    success "Command Line Tools extraits : $CMDLINE_DIR"
  else
    success "Command Line Tools déjà présents"
  fi

  # Exporter les variables Android SDK pour la suite du script
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
  export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
  export PATH="$CMDLINE_DIR/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools/bin:$PATH"

  # Persister dans .bashrc
  declare -a BASHRC_LINES=(
    "export ANDROID_HOME=$ANDROID_HOME"
    "export ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
    "export PATH=\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/tools/bin:\$PATH"
  )
  for LINE in "${BASHRC_LINES[@]}"; do
    grep -qF "${LINE%%=*}" "$HOME/.bashrc" 2>/dev/null || echo "$LINE" >> "$HOME/.bashrc"
  done

  # Accepter les licences (non-interactif — requis pour sdkmanager)
  info "Acceptation des licences Android SDK..."
  yes 2>/dev/null | sdkmanager \
    --sdk_root="$ANDROID_HOME" \
    --licenses > /dev/null 2>&1 || true

  # Installer platform-tools, build-tools, platform Android
  info "Installation : platform-tools, build-tools;${ANDROID_BUILD_TOOLS}, platforms;android-${ANDROID_API_LEVEL}..."
  sdkmanager \
    --sdk_root="$ANDROID_HOME" \
    "platform-tools" \
    "platforms;android-${ANDROID_API_LEVEL}" \
    "build-tools;${ANDROID_BUILD_TOOLS}" \
    2>&1 | grep -vE "^\[=|^Fetch|^Install|^Done|^Unzip" \
    || die "Échec sdkmanager. Vérifiez votre connexion internet."

  success "Android SDK installé : $ANDROID_HOME"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 7/8 — ANDROID NDK r26d
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ÉTAPE 7/8 — Android NDK r26d ($ANDROID_NDK_VERSION)"
  timer_start

  export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

  NDK_PATH="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"

  if [[ -d "$NDK_PATH/build" ]]; then
    success "NDK déjà installé : $NDK_PATH"
  else
    info "Téléchargement et installation du NDK $ANDROID_NDK_VERSION..."
    info "(Le NDK fait environ 1.5 Go — patience...)"
    sdkmanager \
      --sdk_root="$ANDROID_HOME" \
      "ndk;${ANDROID_NDK_VERSION}" \
      2>&1 | grep -vE "^\[=|^Fetch|^Install|^Done|^Unzip" \
      || die "Échec de l'installation du NDK $ANDROID_NDK_VERSION.\n  Versions disponibles : sdkmanager --sdk_root=$ANDROID_HOME --list | grep ndk"

    [[ -d "$NDK_PATH" ]] || \
      die "NDK installé selon sdkmanager mais répertoire introuvable : $NDK_PATH"
  fi

  export NDK_HOME="$NDK_PATH"
  export ANDROID_NDK_HOME="$NDK_PATH"

  # Persister dans .bashrc
  grep -qF "NDK_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export NDK_HOME=$NDK_HOME" >> "$HOME/.bashrc"
  grep -qF "ANDROID_NDK_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export ANDROID_NDK_HOME=$ANDROID_NDK_HOME" >> "$HOME/.bashrc"

  success "NDK : $NDK_HOME"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# ÉTAPE 8/8 — TARGETS RUST (desktop + Android)
# ══════════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ÉTAPE 8/8 — Targets Rust"
  timer_start

  declare -a TARGETS_TO_ADD=("x86_64-unknown-linux-gnu")
  if [[ "$BUILD_APK" == true ]]; then
    TARGETS_TO_ADD+=(
      "aarch64-linux-android"
      "armv7-linux-androideabi"
      "i686-linux-android"
      "x86_64-linux-android"
    )
  fi

  INSTALLED_TARGETS=$(rustup target list --installed 2>/dev/null)
  for target in "${TARGETS_TO_ADD[@]}"; do
    if echo "$INSTALLED_TARGETS" | grep -q "^${target}$"; then
      success "Déjà installé : $target"
    else
      info "Ajout : $target"
      rustup target add "$target" || die "Impossible d'ajouter le target Rust : $target"
      success "Ajouté : $target"
    fi
  done

  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# RECHARGEMENT DES VARIABLES D'ENVIRONNEMENT
# ══════════════════════════════════════════════════════════════════════
# Toujours re-définir pour le cas --skip-deps ou après install
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$NDK_HOME}"
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java 2>/dev/null || echo /usr/bin/java)")")")}"
export PATH="$HOME/.cargo/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

# ══════════════════════════════════════════════════════════════════════
# VÉRIFICATION FINALE DE L'ENVIRONNEMENT
# ══════════════════════════════════════════════════════════════════════
step "Vérification finale de l'environnement"

ERRORS=0
_chk() {
  local label="$1"; shift
  if eval "$*" &>/dev/null 2>&1; then
    success "$label"
  else
    error "$label — MANQUANT ou invalide"
    ((ERRORS++))
  fi
}

_chk "rustc"        "command -v rustc"
_chk "cargo"        "command -v cargo"
_chk "node ≥18"    "node -e \"process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)\""
_chk "npm"          "command -v npm"
_chk "tauri CLI v2" "npx --no tauri --version 2>/dev/null | grep -qE '^(tauri-cli )?2\.' \
                     || tauri --version 2>/dev/null | grep -qE '^(tauri-cli )?2\.'"

if [[ "$BUILD_APK" == true ]]; then
  _chk "java ≥17"         "java -version 2>&1 | grep -qE '\"1[7-9]\.|\"[2-9][0-9]\.'"
  _chk "JAVA_HOME défini" "test -n '${JAVA_HOME:-}' && test -d '${JAVA_HOME:-/x}'"
  _chk "ANDROID_HOME"     "test -d '${ANDROID_HOME:-/x}'"
  _chk "sdkmanager"       "command -v sdkmanager"
  _chk "NDK installé"     "test -d '${NDK_HOME:-/x}/build'"
  _chk "Rust target aarch64-android" "rustup target list --installed | grep -q aarch64-linux-android"
  _chk "Rust target armv7-android"   "rustup target list --installed | grep -q armv7-linux-androideabi"
fi

if [[ "$ERRORS" -gt 0 ]]; then
  die "$ERRORS prérequis manquants. Consultez les messages ci-dessus et corrigez avant de relancer."
fi
success "Environnement complet !"

[[ "$COMPILE" == false ]] && {
  info "Mode --deps-only : toutes les dépendances sont installées."
  info "Relancez avec ./build-linux.sh --skip-deps pour compiler."
  exit 0
}

# ══════════════════════════════════════════════════════════════════════
# DÉPENDANCES NPM DU PROJET
# ══════════════════════════════════════════════════════════════════════
step "Dépendances npm du projet"
cd "$PROJECT_ROOT"
# npm ci est plus rapide et strict si package-lock.json existe
if [[ -f "package-lock.json" ]]; then
  npm ci
else
  npm install
fi
success "Dépendances npm OK"

# ══════════════════════════════════════════════════════════════════════
# COMPILATION — APPIMAGE
# ══════════════════════════════════════════════════════════════════════
APPIMAGE_FILE=""
if [[ "$BUILD_APPIMAGE" == true ]]; then
  step "COMPILATION AppImage (Linux desktop)"
  info "Durée estimée : 5–15 min (première fois) / 2–5 min (recompilation)"
  timer_start

  LOG_APPIMAGE="/tmp/beartify-appimage-$(date +%s).log"
  info "Log complet : $LOG_APPIMAGE"

  set +e
  npm run tauri build -- --bundles appimage 2>&1 | tee "$LOG_APPIMAGE"
  APPIMAGE_EXIT=${PIPESTATUS[0]}
  set -e

  if [[ "$APPIMAGE_EXIT" -ne 0 ]]; then
    echo ""
    error "Compilation AppImage échouée (code $APPIMAGE_EXIT)"
    echo -e "${YELLOW}── Dernières 30 lignes du log ──${NC}"
    tail -30 "$LOG_APPIMAGE"
    echo ""
    echo -e "${YELLOW}Causes fréquentes :${NC}"
    echo "  • libwebkit2gtk-4.1-dev manquant  → vérifier étape 1"
    echo "  • Tauri CLI v1 au lieu de v2      → npm install -g @tauri-apps/cli@^2"
    echo "  • Erreur Cargo (lib.rs/Cargo.toml) → vérifier les fichiers src-tauri/"
    echo "  • Fichier de capacités manquant   → créer src-tauri/capabilities/default.json"
    echo ""
    die "AppImage non généré. Log : $LOG_APPIMAGE"
  fi

  # Localiser le .AppImage généré
  APPIMAGE_FILE=$(find "$TAURI_DIR/target/release/bundle/appimage" \
    -name "*.AppImage" 2>/dev/null | tail -1)
  [[ -n "$APPIMAGE_FILE" ]] || die ".AppImage introuvable dans target/release/bundle/appimage/"

  chmod +x "$APPIMAGE_FILE"
  APPIMAGE_SIZE=$(du -sh "$APPIMAGE_FILE" | cut -f1)
  success "AppImage généré ! ($APPIMAGE_SIZE)"
  success "Chemin : $APPIMAGE_FILE"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# COMPILATION — APK ANDROID
# ══════════════════════════════════════════════════════════════════════
APK_FILE=""
if [[ "$BUILD_APK" == true ]]; then
  step "COMPILATION APK (Android)"
  info "Durée estimée : 15–40 min (Gradle + cross-compilation Rust × 4 architectures)"
  info "ANDROID_HOME : $ANDROID_HOME"
  info "NDK_HOME     : $NDK_HOME"
  info "JAVA_HOME    : $JAVA_HOME"
  timer_start

  # Re-exporter toutes les variables nécessaires à Tauri Android build
  export ANDROID_HOME NDK_HOME ANDROID_NDK_HOME JAVA_HOME ANDROID_SDK_ROOT
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

  # Initialisation du projet Android (première fois seulement)
  if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
    info "Initialisation du projet Gradle Android (première fois)..."
    LOG_INIT="/tmp/beartify-android-init-$(date +%s).log"
    set +e
    npm run tauri android init 2>&1 | tee "$LOG_INIT"
    INIT_EXIT=${PIPESTATUS[0]}
    set -e
    if [[ "$INIT_EXIT" -ne 0 ]]; then
      error "tauri android init a échoué (code $INIT_EXIT)"
      tail -20 "$LOG_INIT"
      die "Initialisation Android échouée. Log : $LOG_INIT"
    fi
    success "Projet Android initialisé (src-tauri/gen/android/)"
  fi

  LOG_APK="/tmp/beartify-apk-$(date +%s).log"
  info "Log complet : $LOG_APK"

  set +e
  npm run tauri android build -- --apk 2>&1 | tee "$LOG_APK"
  APK_EXIT=${PIPESTATUS[0]}
  set -e

  if [[ "$APK_EXIT" -ne 0 ]]; then
    echo ""
    error "Compilation APK échouée (code $APK_EXIT)"
    echo -e "${YELLOW}── Dernières 40 lignes du log ──${NC}"
    tail -40 "$LOG_APK"
    echo ""
    echo -e "${YELLOW}Causes fréquentes :${NC}"
    echo "  • NDK version incorrecte          → modifiez ANDROID_NDK_VERSION (actuellement $ANDROID_NDK_VERSION)"
    echo "  • Gradle download timeout         → relancez le script (retry automatique Gradle)"
    echo "  • JDK < 17                        → sudo apt install openjdk-17-jdk"
    echo "  • ANDROID_HOME mal défini         → vérifiez $ANDROID_HOME"
    echo "  • Licences SDK refusées           → yes | sdkmanager --licenses"
    echo "  • Espace disque insuffisant       → le NDK + Gradle cache ≈ 5 Go"
    echo "  • Erreur 'Could not find NDK'     → vérifiez NDK_HOME=$NDK_HOME"
    echo ""
    die "APK non généré. Log : $LOG_APK"
  fi

  # Localiser l'APK généré (release unsigned en priorité, puis tout .apk)
  APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*release-unsigned*.apk" 2>/dev/null | head -1)
  [[ -z "$APK_FILE" ]] && APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*release*.apk" 2>/dev/null | head -1)
  [[ -z "$APK_FILE" ]] && APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*.apk" 2>/dev/null | tail -1)
  [[ -n "$APK_FILE" ]] || die ".apk introuvable dans src-tauri/gen/android/"

  APK_SIZE=$(du -sh "$APK_FILE" | cut -f1)
  success "APK généré ! ($APK_SIZE)"
  success "Chemin : $APK_FILE"
  timer_end
fi

# ══════════════════════════════════════════════════════════════════════
# RÉSUMÉ FINAL
# ══════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║       🎉  Compilation terminée avec succès !             ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
[[ -n "$APPIMAGE_FILE" ]] && echo -e "  ${GREEN}● AppImage${NC} : $APPIMAGE_FILE"
[[ -n "$APK_FILE"      ]] && echo -e "  ${GREEN}● APK      ${NC} : $APK_FILE"
echo ""
echo -e "${BOLD}${YELLOW}⚠  Actions manuelles requises avant distribution :${NC}"
echo ""
echo -e "  ${CYAN}1. Firebase Console${NC} → Authentication → Authorized domains"
echo "     Ajoutez : tauri://localhost  et  tauri.localhost"
echo ""
echo -e "  ${CYAN}2. Discord Developer Portal${NC} → OAuth2 → Redirects"
echo "     Ajoutez : beartify://discord-callback"
echo ""
echo -e "  ${CYAN}3. Si votre proxy ne tourne pas sur localhost:3000${NC}"
echo "     Dans l'app : localStorage.setItem('beartify_server_url','http://IP:PORT')"
echo ""
echo -e "  ${CYAN}4. Rechargez votre terminal${NC} pour disposer des variables Android :"
echo "     source ~/.bashrc"
echo ""
