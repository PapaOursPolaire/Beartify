#!/usr/bin/env bash
# ================================================================
#  Beartify - Script de compilation COMPLET pour Debian
#  Cibles : .AppImage (desktop) + .apk (Android)
#  Hypothese : MACHINE VIERGE (rien d'installe)
# ================================================================
#  USAGE :
#    chmod +x build-linux.sh
#    ./build-linux.sh              -> installe tout + compile les deux
#    ./build-linux.sh --appimage   -> installe tout + compile AppImage
#    ./build-linux.sh --apk        -> installe tout + compile APK
#    ./build-linux.sh --deps-only  -> installe tout, ne compile pas
#    ./build-linux.sh --skip-deps  -> compile sans reinstaller
# ================================================================

set -euo pipefail
IFS=$'\n\t'

# ================================================================
# CONFIGURATION
# ================================================================
NODE_MAJOR="20"
ANDROID_SDK_ROOT="$HOME/.android/sdk"
ANDROID_API_LEVEL="34"
ANDROID_BUILD_TOOLS="34.0.0"
ANDROID_NDK_VERSION="26.3.11579264"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

# ================================================================
# COULEURS & HELPERS
# ================================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "  ${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "  ${RED}[ERREUR]${NC} $*" >&2; }
step()    {
  echo ""
  echo -e "${BOLD}${CYAN}================================================================${NC}"
  echo -e "${BOLD}${CYAN}  $*${NC}"
  echo -e "${BOLD}${CYAN}================================================================${NC}"
}
die() { error "$*"; echo -e "\n${RED}${BOLD}Abandon.${NC}\n" >&2; exit 1; }

_T=0
timer_start() { _T=$SECONDS; }
timer_end()   { info "Duree : $(( SECONDS - _T ))s"; }

# ================================================================
# ARGUMENTS
# ================================================================
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
    *) warn "Argument inconnu : $arg (ignore)" ;;
  esac
done

# ================================================================
# DETECTION DU PROJET
# ================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[[ ! -f "package.json" && -f "../package.json" ]] && cd ..
[[ -f "package.json" ]] || die "package.json introuvable. Placez ce script a la racine du projet."
PROJECT_ROOT="$(pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
[[ -d "$TAURI_DIR" ]] || die "src-tauri/ introuvable dans $PROJECT_ROOT"
info "Projet : $PROJECT_ROOT"

# ================================================================
# SUDO - garder actif pendant tout le script
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  echo -e "${YELLOW}Ce script installe des paquets systeme et necessite sudo.${NC}"
  sudo -v || die "Impossible d'obtenir les droits sudo."
  ( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
  SUDO_KEEPER=$!
  trap 'kill "$SUDO_KEEPER" 2>/dev/null || true' EXIT
fi

# ================================================================
# ETAPE 1/8 - PAQUETS SYSTEME DEBIAN
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 1/8 - Paquets systeme Debian"
  timer_start

  info "Mise a jour des sources apt..."
  sudo apt-get update -qq

  # Paquets de base universels sur Debian (sans software-properties-common
  # ni apt-transport-https qui sont specifiques a Ubuntu ou deja inclus)
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
    libssl-dev

  # Detection version Debian
  DEBIAN_CODENAME=$(lsb_release -sc 2>/dev/null || echo "bookworm")
  DEBIAN_VERSION=$(lsb_release -sr 2>/dev/null | cut -d. -f1 || echo "12")
  info "Debian $DEBIAN_VERSION ($DEBIAN_CODENAME) detecte"

  # webkit2gtk-4.1 est requis par Tauri V2.
  # Debian 11 (Bullseye) ne l'a pas nativement -> backports.
  # Debian 12 (Bookworm) et suivants : disponible directement.
  info "Installation de webkit2gtk (requis par Tauri V2)..."
  if [[ "$DEBIAN_VERSION" -le 11 ]]; then
    warn "Debian $DEBIAN_VERSION : ajout de ${DEBIAN_CODENAME}-backports pour webkit2gtk-4.1"
    echo "deb http://deb.debian.org/debian ${DEBIAN_CODENAME}-backports main contrib non-free" \
      | sudo tee /etc/apt/sources.list.d/${DEBIAN_CODENAME}-backports.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -t "${DEBIAN_CODENAME}-backports" \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev 2>/dev/null || {
        warn "webkit2gtk-4.1 indisponible via backports."
        warn "Tauri V2 necessite webkit2gtk >= 4.1."
        warn "Tentative avec webkit2gtk-4.0 (peut echouer a la compilation)..."
        sudo apt-get install -y libwebkit2gtk-4.0-dev \
          libjavascriptcoregtk-4.0-dev || \
          die "Impossible d'installer webkit2gtk.\nMettez a jour vers Debian 12 (Bookworm)."
      }
  else
    sudo apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev
  fi

  # Autres dependances Tauri (GTK, rsvg, AppImage tools, etc.)
  info "Dependances Tauri supplementaires..."
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

  # Indicateur systeme (optionnel - non bloquant)
  sudo apt-get install -y --no-install-recommends \
    libayatana-appindicator3-dev 2>/dev/null || \
  sudo apt-get install -y --no-install-recommends \
    libappindicator3-dev 2>/dev/null || \
    warn "libayatana-appindicator3-dev indisponible (non bloquant)"

  success "Paquets systeme installes"
  timer_end
fi

# ================================================================
# ETAPE 2/8 - RUST + CARGO
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 2/8 - Rust + Cargo (via rustup)"
  timer_start

  if command -v rustc &>/dev/null; then
    info "Rust deja present : $(rustc --version) - mise a jour..."
    rustup update stable 2>&1 | tail -3
  else
    info "Installation de Rust via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --no-modify-path 2>&1 | tail -5
  fi

  source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

  command -v rustc &>/dev/null || die "rustc introuvable apres installation."
  command -v cargo &>/dev/null || die "cargo introuvable apres installation."
  success "Rust  : $(rustc --version)"
  success "Cargo : $(cargo --version)"
  timer_end
fi

# Toujours sourcer Cargo (meme avec --skip-deps)
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

# ================================================================
# ETAPE 3/8 - NODE.JS 20 LTS + NPM
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 3/8 - Node.js $NODE_MAJOR LTS + npm (via NodeSource)"
  timer_start

  NEED_NODE=true
  if command -v node &>/dev/null; then
    NODE_VER=$(node --version | tr -d 'v')
    NODE_MAJOR_INSTALLED="${NODE_VER%%.*}"
    if [[ "$NODE_MAJOR_INSTALLED" -ge 18 ]]; then
      success "Node.js deja installe et suffisant : v$NODE_VER"
      NEED_NODE=false
    else
      warn "Node.js v$NODE_VER trop ancien (>=18 requis) - mise a jour..."
    fi
  fi

  if [[ "$NEED_NODE" == true ]]; then
    info "Ajout du depot NodeSource pour Node.js $NODE_MAJOR..."
    # Supprimer un eventuel depot NodeSource obsolete
    sudo rm -f /etc/apt/sources.list.d/nodesource.list \
               /usr/share/keyrings/nodesource.gpg 2>/dev/null || true

    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" \
      | sudo -E bash - 2>&1 | grep -E "^##|error" || true
    sudo apt-get install -y nodejs
  fi

  command -v node &>/dev/null || die "node introuvable apres installation."
  command -v npm  &>/dev/null || die "npm introuvable apres installation."
  success "Node.js : $(node --version)"
  success "npm     : v$(npm --version)"
  timer_end
fi

# ================================================================
# ETAPE 4/8 - TAURI CLI V2
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 4/8 - Tauri CLI v2"
  timer_start

  _tauri_ver() {
    npx --no tauri --version 2>/dev/null || tauri --version 2>/dev/null || echo ""
  }

  EXISTING=$(_tauri_ver)
  if echo "$EXISTING" | grep -qE "^(tauri-cli )?2\."; then
    success "Tauri CLI v2 deja present : $EXISTING"
  else
    info "Installation globale de Tauri CLI v2..."
    if npm install -g @tauri-apps/cli@^2 2>/dev/null; then
      success "Tauri CLI v2 installe globalement"
    else
      warn "Permission refusee pour install globale - installation locale..."
      cd "$PROJECT_ROOT"
      npm install -D @tauri-apps/cli@^2
      success "Tauri CLI v2 installe localement"
    fi
  fi

  TAURI_FINAL=$(_tauri_ver)
  [[ -n "$TAURI_FINAL" ]] || die "Tauri CLI introuvable apres installation."
  success "Tauri CLI : $TAURI_FINAL"
  timer_end
fi

# ================================================================
# ETAPE 5/8 - JDK 17 (Android uniquement)
# ================================================================
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 5/8 - OpenJDK 17 (requis pour Android)"
  timer_start

  NEED_JDK=true
  if command -v java &>/dev/null; then
    JAVA_VER_RAW=$(java -version 2>&1 | head -1 | awk -F'"' '{print $2}')
    JAVA_MAJOR="${JAVA_VER_RAW%%.*}"
    [[ "$JAVA_MAJOR" =~ ^[0-9]+$ ]] || JAVA_MAJOR=0
    if [[ "$JAVA_MAJOR" -ge 17 ]]; then
      success "JDK deja installe : $JAVA_VER_RAW"
      NEED_JDK=false
    else
      warn "Java $JAVA_VER_RAW trop ancien (JDK >=17 requis) - installation JDK 17..."
    fi
  fi

  if [[ "$NEED_JDK" == true ]]; then
    sudo apt-get install -y --no-install-recommends openjdk-17-jdk openjdk-17-jre
    CHOSEN=$(update-java-alternatives -l 2>/dev/null \
      | grep -i "java-1.17\|java-17\|openjdk-17" | awk '{print $1}' | head -1)
    [[ -n "$CHOSEN" ]] && sudo update-java-alternatives --set "$CHOSEN" 2>/dev/null || true
  fi

  if [[ -z "${JAVA_HOME:-}" ]]; then
    DETECTED_JH=$(update-java-alternatives -l 2>/dev/null \
      | grep -i "java-1.17\|java-17\|openjdk-17" | awk '{print $3}' | head -1)
    [[ -z "$DETECTED_JH" ]] && \
      DETECTED_JH=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
    export JAVA_HOME="$DETECTED_JH"
  fi

  grep -qF "export JAVA_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export JAVA_HOME=$JAVA_HOME" >> "$HOME/.bashrc"

  java -version 2>&1 | head -1 | grep -qE '"17\.|"18\.|"19\.|"20\.|"21\.' || \
    die "JDK >=17 introuvable apres installation."

  success "JDK       : $(java -version 2>&1 | head -1)"
  success "JAVA_HOME : $JAVA_HOME"
  timer_end
fi

# ================================================================
# ETAPE 6/8 - ANDROID SDK
# ================================================================
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 6/8 - Android SDK (platform-tools + build-tools + platform)"
  timer_start

  CMDLINE_DIR="$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mkdir -p "$ANDROID_SDK_ROOT"

  if [[ ! -f "$CMDLINE_DIR/bin/sdkmanager" ]]; then
    info "Telechargement des Android Command Line Tools..."
    info "URL : $CMDLINE_TOOLS_URL"

    TMP_SDK=$(mktemp -d)
    for attempt in 1 2 3; do
      wget -q --show-progress --timeout=120 \
        "$CMDLINE_TOOLS_URL" -O "$TMP_SDK/cmdline-tools.zip" && break
      warn "Tentative $attempt/3 echouee..."
      sleep 5
      if [[ $attempt -eq 3 ]]; then
        rm -rf "$TMP_SDK"
        die "Impossible de telecharger les Android Command Line Tools.\nVerifiez : https://developer.android.com/studio#command-tools"
      fi
    done

    info "Extraction..."
    mkdir -p "$TMP_SDK/extracted"
    unzip -q "$TMP_SDK/cmdline-tools.zip" -d "$TMP_SDK/extracted"

    rm -rf "$CMDLINE_DIR"
    if [[ -d "$TMP_SDK/extracted/cmdline-tools" ]]; then
      mv "$TMP_SDK/extracted/cmdline-tools" "$CMDLINE_DIR"
    else
      mv "$TMP_SDK/extracted" "$CMDLINE_DIR"
    fi
    rm -rf "$TMP_SDK"
    success "Command Line Tools extraits : $CMDLINE_DIR"
  else
    success "Command Line Tools deja presents"
  fi

  export ANDROID_HOME="$ANDROID_SDK_ROOT"
  export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
  export PATH="$CMDLINE_DIR/bin:$ANDROID_HOME/platform-tools:$PATH"

  # Persister dans .bashrc
  for LINE in \
    "export ANDROID_HOME=$ANDROID_HOME" \
    "export ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT" \
    'export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH'
  do
    grep -qF "${LINE%%=*}" "$HOME/.bashrc" 2>/dev/null || echo "$LINE" >> "$HOME/.bashrc"
  done

  info "Acceptation des licences Android SDK..."
  yes 2>/dev/null | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true

  info "Installation : platform-tools, build-tools;$ANDROID_BUILD_TOOLS, android-$ANDROID_API_LEVEL..."
  sdkmanager --sdk_root="$ANDROID_HOME" \
    "platform-tools" \
    "platforms;android-${ANDROID_API_LEVEL}" \
    "build-tools;${ANDROID_BUILD_TOOLS}" \
    2>&1 | grep -vE "^\[=|^Fetch|^Install|^Done|^Unzip" || \
    die "Echec sdkmanager. Verifiez votre connexion."

  success "Android SDK installe : $ANDROID_HOME"
  timer_end
fi

# ================================================================
# ETAPE 7/8 - ANDROID NDK r26d
# ================================================================
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 7/8 - Android NDK r26d ($ANDROID_NDK_VERSION)"
  timer_start

  export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
  NDK_PATH="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"

  if [[ -d "$NDK_PATH/build" ]]; then
    success "NDK deja installe : $NDK_PATH"
  else
    info "Installation du NDK $ANDROID_NDK_VERSION (environ 1.5 Go)..."
    sdkmanager --sdk_root="$ANDROID_HOME" \
      "ndk;${ANDROID_NDK_VERSION}" \
      2>&1 | grep -vE "^\[=|^Fetch|^Install|^Done|^Unzip" || \
      die "Echec installation NDK $ANDROID_NDK_VERSION"

    [[ -d "$NDK_PATH" ]] || die "NDK installe mais repertoire introuvable : $NDK_PATH"
  fi

  export NDK_HOME="$NDK_PATH"
  export ANDROID_NDK_HOME="$NDK_PATH"

  grep -qF "NDK_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export NDK_HOME=$NDK_HOME" >> "$HOME/.bashrc"
  grep -qF "ANDROID_NDK_HOME=" "$HOME/.bashrc" 2>/dev/null || \
    echo "export ANDROID_NDK_HOME=$ANDROID_NDK_HOME" >> "$HOME/.bashrc"

  success "NDK : $NDK_HOME"
  timer_end
fi

# ================================================================
# ETAPE 8/8 - TARGETS RUST
# ================================================================
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 8/8 - Targets Rust"
  timer_start

  declare -a TARGETS=("x86_64-unknown-linux-gnu")
  if [[ "$BUILD_APK" == true ]]; then
    TARGETS+=(
      "aarch64-linux-android"
      "armv7-linux-androideabi"
      "i686-linux-android"
      "x86_64-linux-android"
    )
  fi

  INSTALLED=$(rustup target list --installed 2>/dev/null)
  for target in "${TARGETS[@]}"; do
    if echo "$INSTALLED" | grep -q "^${target}$"; then
      success "Deja installe : $target"
    else
      info "Ajout : $target"
      rustup target add "$target" || die "Impossible d'ajouter : $target"
      success "Ajoute : $target"
    fi
  done

  timer_end
fi

# ================================================================
# RECHARGEMENT VARIABLES D'ENVIRONNEMENT
# ================================================================
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$NDK_HOME}"
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java 2>/dev/null || echo /usr/bin/java)")")")}"
export PATH="$HOME/.cargo/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:$JAVA_HOME/bin:$PATH"

# ================================================================
# VERIFICATION FINALE
# ================================================================
step "Verification finale de l'environnement"
ERRORS=0

_chk() {
  local label="$1"; shift
  if eval "$*" &>/dev/null 2>&1; then
    success "$label"
  else
    error "$label MANQUANT"
    ((ERRORS++))
  fi
}

_chk "rustc"        "command -v rustc"
_chk "cargo"        "command -v cargo"
_chk "node >=18"    "node -e \"process.exit(parseInt(process.version.slice(1))<18?1:0)\""
_chk "npm"          "command -v npm"
_chk "tauri CLI v2" "npx --no tauri --version 2>/dev/null | grep -qE '^(tauri-cli )?2\.' \
                     || tauri --version 2>/dev/null | grep -qE '2\.'"

if [[ "$BUILD_APK" == true ]]; then
  _chk "java >=17"        "java -version 2>&1 | grep -qE '\"1[7-9]\.|\"[2-9][0-9]\.'"
  _chk "JAVA_HOME"        "test -n '${JAVA_HOME:-}' && test -d '${JAVA_HOME:-/x}'"
  _chk "ANDROID_HOME"     "test -d '${ANDROID_HOME:-/x}'"
  _chk "sdkmanager"       "command -v sdkmanager"
  _chk "NDK installe"     "test -d '${NDK_HOME:-/x}/build'"
  _chk "Rust aarch64"     "rustup target list --installed | grep -q aarch64-linux-android"
  _chk "Rust armv7"       "rustup target list --installed | grep -q armv7-linux-androideabi"
fi

[[ "$ERRORS" -gt 0 ]] && die "$ERRORS prerequis manquants."
success "Environnement complet !"

[[ "$COMPILE" == false ]] && {
  info "Mode --deps-only termine."
  info "Relancez avec --skip-deps pour compiler."
  exit 0
}

# ================================================================
# DEPENDANCES NPM DU PROJET
# ================================================================
step "Installation des dependances npm du projet"
cd "$PROJECT_ROOT"
if [[ -f "package-lock.json" ]]; then
  npm ci
else
  npm install
fi
success "Dependances npm OK"

# ================================================================
# COMPILATION - APPIMAGE
# ================================================================
APPIMAGE_FILE=""
if [[ "$BUILD_APPIMAGE" == true ]]; then
  step "COMPILATION AppImage (Linux desktop)"
  info "Duree estimee : 5-15 min (premiere fois)"
  timer_start

  LOG_APPIMAGE="/tmp/beartify-appimage-$(date +%s).log"
  info "Log : $LOG_APPIMAGE"

  set +e
  npm run tauri build -- --bundles appimage 2>&1 | tee "$LOG_APPIMAGE"
  APPIMAGE_EXIT=${PIPESTATUS[0]}
  set -e

  if [[ "$APPIMAGE_EXIT" -ne 0 ]]; then
    error "Compilation AppImage echouee (code $APPIMAGE_EXIT)"
    echo ""
    warn "Causes frequentes :"
    warn "  libwebkit2gtk-4.1-dev manquant -> verifier etape 1"
    warn "  Tauri CLI v1 au lieu de v2    -> npm install -g @tauri-apps/cli@^2"
    warn "  Erreur Cargo                  -> verifier src-tauri/Cargo.toml"
    warn "  capabilities/ manquant        -> creer src-tauri/capabilities/default.json"
    warn "Log complet : $LOG_APPIMAGE"
    die "AppImage non genere."
  fi

  APPIMAGE_FILE=$(find "$TAURI_DIR/target/release/bundle/appimage" \
    -name "*.AppImage" 2>/dev/null | tail -1)
  [[ -n "$APPIMAGE_FILE" ]] || die ".AppImage introuvable dans target/release/bundle/appimage/"

  chmod +x "$APPIMAGE_FILE"
  APPIMAGE_SIZE=$(du -sh "$APPIMAGE_FILE" | cut -f1)
  success "AppImage genere ! ($APPIMAGE_SIZE)"
  success "Chemin : $APPIMAGE_FILE"
  timer_end
fi

# ================================================================
# COMPILATION - APK ANDROID
# ================================================================
APK_FILE=""
if [[ "$BUILD_APK" == true ]]; then
  step "COMPILATION APK (Android)"
  info "Duree estimee : 15-40 min (Gradle + cross-compilation Rust x4 archi)"
  info "ANDROID_HOME : $ANDROID_HOME"
  info "NDK_HOME     : $NDK_HOME"
  info "JAVA_HOME    : $JAVA_HOME"
  timer_start

  export ANDROID_HOME NDK_HOME ANDROID_NDK_HOME JAVA_HOME ANDROID_SDK_ROOT
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

  if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
    info "Initialisation du projet Gradle Android (premiere fois)..."
    LOG_INIT="/tmp/beartify-android-init-$(date +%s).log"
    set +e
    npm run tauri android init 2>&1 | tee "$LOG_INIT"
    INIT_EXIT=${PIPESTATUS[0]}
    set -e
    [[ "$INIT_EXIT" -eq 0 ]] || {
      error "tauri android init a echoue"
      tail -20 "$LOG_INIT"
      die "Initialisation Android echouee. Log : $LOG_INIT"
    }
    success "Projet Android initialise"
  fi

  LOG_APK="/tmp/beartify-apk-$(date +%s).log"
  info "Log : $LOG_APK"

  set +e
  npm run tauri android build -- --apk 2>&1 | tee "$LOG_APK"
  APK_EXIT=${PIPESTATUS[0]}
  set -e

  if [[ "$APK_EXIT" -ne 0 ]]; then
    error "Compilation APK echouee (code $APK_EXIT)"
    echo ""
    warn "Causes frequentes :"
    warn "  NDK version incorrecte  -> modifiez ANDROID_NDK_VERSION dans ce script"
    warn "  Gradle timeout          -> relancez (retry automatique Gradle)"
    warn "  JDK < 17               -> sudo apt install openjdk-17-jdk"
    warn "  ANDROID_HOME mal defini -> verifiez $ANDROID_HOME"
    warn "  Licences non acceptees  -> yes | sdkmanager --licenses"
    warn "  Espace disque insuffisant -> NDK + Gradle cache = ~5 Go"
    warn "Log complet : $LOG_APK"
    die "APK non genere."
  fi

  APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*release-unsigned*.apk" 2>/dev/null | head -1)
  [[ -z "$APK_FILE" ]] && APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*release*.apk" 2>/dev/null | head -1)
  [[ -z "$APK_FILE" ]] && APK_FILE=$(find "$TAURI_DIR/gen/android" \
    -name "*.apk" 2>/dev/null | tail -1)
  [[ -n "$APK_FILE" ]] || die ".apk introuvable dans src-tauri/gen/android/"

  APK_SIZE=$(du -sh "$APK_FILE" | cut -f1)
  success "APK genere ! ($APK_SIZE)"
  success "Chemin : $APK_FILE"
  timer_end
fi

# ================================================================
# RESUME FINAL
# ================================================================
echo ""
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   Compilation terminee avec succes !${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo ""
[[ -n "$APPIMAGE_FILE" ]] && echo -e "  ${GREEN}AppImage${NC} : $APPIMAGE_FILE"
[[ -n "$APK_FILE"      ]] && echo -e "  ${GREEN}APK     ${NC} : $APK_FILE"
echo ""
echo -e "${YELLOW}Actions requises avant distribution :${NC}"
echo ""
echo "  1. Firebase Console -> Authentication -> Authorized domains"
echo "     Ajoutez : tauri://localhost  et  tauri.localhost"
echo ""
echo "  2. Discord Developer Portal -> OAuth2 -> Redirects"
echo "     Ajoutez : beartify://discord-callback"
echo ""
echo "  3. Si proxy pas sur localhost:3000 :"
echo "     localStorage.setItem('beartify_server_url','http://IP:PORT')"
echo ""
echo "  4. Rechargez votre terminal pour les variables Android :"
echo "     source ~/.bashrc"
echo ""
