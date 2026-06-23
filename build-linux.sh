#!/usr/bin/env bash
# ================================================================
#  Beartify - Script de compilation COMPLET pour Debian
#  Cibles : .AppImage (desktop) + .apk (Android)
#  Hypothese : MACHINE VIERGE (rien d installe)
#  Fichiers web dans src/ - Fichiers Tauri dans src-tauri/
# ================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Securite Anti-Root ───────────────────────────────────────────
if [[ "$EUID" -eq 0 ]]; then
  echo -e "\033[0;31m[ERREUR] Ne lancez pas ce script avec 'sudo ./build-linux.sh'.\033[0m"
  echo -e "\033[1;33mLancez-le normalement : './build-linux.sh'. Le script gérera sudo lui-même.\033[0m"
  exit 1
fi

# ── Configuration ────────────────────────────────────────────────
NODE_MAJOR="20"
ANDROID_SDK_ROOT="$HOME/.android/sdk"
ANDROID_API_LEVEL="34"
ANDROID_BUILD_TOOLS="34.0.0"
ANDROID_NDK_VERSION="26.3.11579264"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

# ── Couleurs & helpers ───────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "  ${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "  ${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "  ${RED}[ERR]${NC}   $*" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}================================================================${NC}"; echo -e "${BOLD}${CYAN}  $*${NC}"; echo -e "${BOLD}${CYAN}================================================================${NC}"; }
die()     { error "$*"; echo -e "\n${RED}Abandon.${NC}\n" >&2; exit 1; }
_T=0; timer_start() { _T=$SECONDS; }; timer_end() { info "Duree : $(( SECONDS - _T ))s"; }

# ── Arguments ────────────────────────────────────────────────────
BUILD_APPIMAGE=true; BUILD_APK=true; INSTALL_DEPS=true; COMPILE=true; DEBUG_MODE=false
for arg in "$@"; do
  case "$arg" in
    --appimage)  BUILD_APK=false ;;
    --apk)       BUILD_APPIMAGE=false ;;
    --deps-only) COMPILE=false ;;
    --skip-deps) INSTALL_DEPS=false ;;
    --debug)     DEBUG_MODE=true ;;
    --help|-h)   echo "Usage: $0 [--appimage|--apk|--deps-only|--skip-deps|--debug]"; exit 0 ;;
    *)           warn "Argument inconnu : $arg" ;;
  esac
done

# ── Detection projet ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[[ ! -f "package.json" && -f "../package.json" ]] && cd ..
[[ -f "package.json" ]] || die "package.json introuvable. Placez ce script a la racine du projet."
PROJECT_ROOT="$(pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
SRC_DIR="$PROJECT_ROOT/src"
[[ -d "$TAURI_DIR" ]] || die "src-tauri/ introuvable dans $PROJECT_ROOT"
[[ -d "$SRC_DIR"   ]] || die "src/ introuvable dans $PROJECT_ROOT (fichiers web)"
info "Projet  : $PROJECT_ROOT"
info "Web     : $SRC_DIR"
info "Tauri   : $TAURI_DIR"

# ── Sudo ─────────────────────────────────────────────────────────
if [[ "$INSTALL_DEPS" == true ]]; then
  echo -e "${YELLOW}Ce script necessite les droits administrateur pour les paquets systeme.${NC}"
  sudo -v || die "Impossible d obtenir sudo."
  ( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
  SUDO_KEEPER=$!
  trap 'kill "$SUDO_KEEPER" 2>/dev/null || true' EXIT
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 1/8 - PAQUETS SYSTEME DEBIAN
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 1/8 - Paquets systeme Debian"; timer_start
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends \
    build-essential curl wget git file unzip zip xz-utils \
    ca-certificates gnupg lsb-release pkg-config libssl-dev
  DEBIAN_CODENAME=$(lsb_release -sc 2>/dev/null || echo "bookworm")
  DEBIAN_VERSION=$(lsb_release -sr 2>/dev/null | cut -d. -f1 || echo "12")
  info "Debian $DEBIAN_VERSION ($DEBIAN_CODENAME)"
  if [[ "$DEBIAN_VERSION" -le 11 ]]; then
    warn "Debian $DEBIAN_VERSION : ajout backports pour webkit2gtk-4.1"
    echo "deb http://deb.debian.org/debian ${DEBIAN_CODENAME}-backports main contrib non-free" \
      | sudo tee /etc/apt/sources.list.d/${DEBIAN_CODENAME}-backports.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -t "${DEBIAN_CODENAME}-backports" \
      libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev 2>/dev/null || \
      sudo apt-get install -y libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev || \
      die "Impossible d installer webkit2gtk. Mettez a jour vers Debian 12."
  else
    sudo apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
  fi
  sudo apt-get install -y --no-install-recommends \
    libgtk-3-dev librsvg2-dev patchelf libxdo-dev libglib2.0-dev \
    libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libatk1.0-dev \
    squashfs-tools fuse libfuse2 2>/dev/null || \
  sudo apt-get install -y --no-install-recommends \
    libgtk-3-dev librsvg2-dev patchelf libxdo-dev libglib2.0-dev \
    libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libatk1.0-dev \
    squashfs-tools fuse libfuse2t64
  sudo apt-get install -y --no-install-recommends \
    libayatana-appindicator3-dev 2>/dev/null || \
  sudo apt-get install -y --no-install-recommends \
    libappindicator3-dev 2>/dev/null || warn "libayatana indisponible (non bloquant)"
  success "Paquets systeme OK"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 2/8 - RUST
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 2/8 - Rust + Cargo"; timer_start
  if command -v rustc &>/dev/null; then
    info "Rust $(rustc --version) deja installe - mise a jour..."
    rustup update stable 2>&1 | tail -3
  else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --no-modify-path 2>&1 | tail -5
  fi
  source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
  command -v rustc &>/dev/null || die "rustc introuvable apres installation."
  success "Rust  : $(rustc --version)"; success "Cargo : $(cargo --version)"; timer_end
fi
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

# ════════════════════════════════════════════════════════════════
# ETAPE 3/8 - NODE.JS
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 3/8 - Node.js $NODE_MAJOR LTS"; timer_start
  NEED_NODE=true
  if command -v node &>/dev/null; then
    NV=$(node --version | tr -d 'v' || echo "0"); NM="${NV%%.*}"
    if [[ "$NM" -ge 18 ]]; then
      success "Node.js v$NV deja installe"
      NEED_NODE=false
    else
      warn "Node.js v$NV trop ancien"
    fi
  fi
  if [[ "$NEED_NODE" == true ]]; then
    sudo rm -f /etc/apt/sources.list.d/nodesource.list /usr/share/keyrings/nodesource.gpg 2>/dev/null || true
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - 2>&1 | grep -E "^##|error" || true
    sudo apt-get install -y nodejs
  fi
  command -v node &>/dev/null || die "node introuvable apres installation."
  success "Node.js : $(node --version)"; success "npm : v$(npm --version)"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 4/8 - TAURI CLI V2
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 4/8 - Tauri CLI v2"; timer_start
  _tv() {
    local L="$PROJECT_ROOT/node_modules/.bin/tauri"
    [[ -x "$L" ]] && { "$L" --version 2>/dev/null && return; }
    command -v tauri &>/dev/null && tauri --version 2>/dev/null && return
    npx --no-install tauri --version 2>/dev/null || echo ""
  }
  EX=$(_tv)
  if echo "$EX" | grep -qE "^tauri-cli 2\.|^2\.[0-9]"; then
    success "Tauri CLI v2 deja present : $EX"
  else
    npm install -g @tauri-apps/cli@^2 2>/dev/null || { cd "$PROJECT_ROOT"; npm install -D @tauri-apps/cli@^2; }
  fi
  TF=$(_tv)
  echo "$TF" | grep -qE "^tauri-cli 2\.|^2\.[0-9]" || die "Tauri CLI v2 introuvable apres install (obtenu: '$TF')"
  success "Tauri CLI : $TF"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 5/8 - JDK (Android)
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 5/8 - OpenJDK (requis pour Android)"; timer_start
  NEED_JDK=true
  if command -v java &>/dev/null; then
    JV=$(java -version 2>&1 | head -1 | awk -F'"' '{print $2}' || echo "0")
    JM="${JV%%.*}"
    [[ "$JM" =~ ^[0-9]+$ ]] || JM=0
    if [[ "$JM" -ge 17 ]]; then
      success "JDK $JV deja installe"
      NEED_JDK=false
    else
      warn "Java $JV trop ancien"
    fi
  fi

  if [[ "$NEED_JDK" == true ]]; then
    JDKV_INSTALLED=false
    for TRY_VER in 21 17; do
      if sudo apt-get install -y --no-install-recommends "openjdk-${TRY_VER}-jdk" 2>/dev/null; then
        JDKV_INSTALLED=true; JDK_VER_USED="$TRY_VER"; break
      fi
    done
    [[ "$JDKV_INSTALLED" == true ]] || die "Impossible d installer OpenJDK (ni 21 ni 17 disponibles)"
    CHOSEN=$(update-java-alternatives -l 2>/dev/null | grep -i "java-${JDK_VER_USED}\|openjdk-${JDK_VER_USED}" | awk '{print $1}' | head -1 || true)
    if [[ -n "$CHOSEN" ]]; then
      sudo update-java-alternatives --set "$CHOSEN" 2>/dev/null || true
    fi
  fi

  if [[ -z "${JAVA_HOME:-}" ]]; then
    for TRY in 21 17; do
      JH=$(update-java-alternatives -l 2>/dev/null | grep -i "java-${TRY}\|openjdk-${TRY}" | awk '{print $3}' | head -1 || true)
      if [[ -n "$JH" ]]; then
        export JAVA_HOME="$JH"
        break
      fi
    done
    if [[ -z "${JAVA_HOME:-}" ]]; then
       export JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(command -v java || echo /usr/bin/java)")")")
    fi
  fi
  grep -qF "JAVA_HOME=" "$HOME/.bashrc" 2>/dev/null || echo "export JAVA_HOME=$JAVA_HOME" >> "$HOME/.bashrc"
  success "JDK : $(java -version 2>&1 | head -1)"; success "JAVA_HOME : $JAVA_HOME"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 6/8 - ANDROID SDK
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 6/8 - Android SDK"; timer_start
  CMDLINE_DIR="$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mkdir -p "$ANDROID_SDK_ROOT"
  if [[ ! -f "$CMDLINE_DIR/bin/sdkmanager" ]]; then
    info "Telechargement Android Command Line Tools..."
    TMP=$(mktemp -d)
    for a in 1 2 3; do
      wget -q --show-progress --timeout=120 "$CMDLINE_TOOLS_URL" -O "$TMP/ct.zip" && break
      warn "Tentative $a/3 echouee..."; sleep 5
      [[ $a -eq 3 ]] && { rm -rf "$TMP"; die "Telechargement impossible. Verifiez CMDLINE_TOOLS_URL."; }
    done
    mkdir -p "$TMP/ex"; unzip -q "$TMP/ct.zip" -d "$TMP/ex"
    rm -rf "$CMDLINE_DIR"
    if [[ -d "$TMP/ex/cmdline-tools" ]]; then
      mv "$TMP/ex/cmdline-tools" "$CMDLINE_DIR"
    else
      mv "$TMP/ex" "$CMDLINE_DIR"
    fi
    rm -rf "$TMP"; success "Command Line Tools extraits"
  else
    success "Command Line Tools deja presents"
  fi
  export ANDROID_HOME="$ANDROID_SDK_ROOT"; export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
  export PATH="$CMDLINE_DIR/bin:$ANDROID_HOME/platform-tools:$PATH"
  for LINE in "export ANDROID_HOME=$ANDROID_HOME" "export ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT" \
              'export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH'; do
    grep -qF "${LINE%%=*}" "$HOME/.bashrc" 2>/dev/null || echo "$LINE" >> "$HOME/.bashrc"
  done
  info "Acceptation des licences SDK..."
  yes 2>/dev/null | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
  info "Installation platform-tools, build-tools, android-$ANDROID_API_LEVEL..."
  sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" \
    "platforms;android-${ANDROID_API_LEVEL}" "build-tools;${ANDROID_BUILD_TOOLS}" >/dev/null 2>&1 || true
  success "Android SDK : $ANDROID_HOME"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 7/8 - ANDROID NDK
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 7/8 - Android NDK r26d ($ANDROID_NDK_VERSION)"; timer_start
  export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
  NDK_PATH="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"
  if [[ -d "$NDK_PATH/build" ]]; then
    success "NDK deja installe"
  else
    info "Installation NDK (~1.5 Go, patience...)..."
    sdkmanager --sdk_root="$ANDROID_HOME" "ndk;${ANDROID_NDK_VERSION}" >/dev/null || die "Echec installation NDK via sdkmanager"
    [[ -d "$NDK_PATH" ]] || die "NDK installe mais introuvable : $NDK_PATH"
  fi
  export NDK_HOME="$NDK_PATH"; export ANDROID_NDK_HOME="$NDK_PATH"
  grep -qF "NDK_HOME=" "$HOME/.bashrc" 2>/dev/null || echo "export NDK_HOME=$NDK_HOME" >> "$HOME/.bashrc"
  success "NDK : $NDK_HOME"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 8/8 - TARGETS RUST
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 8/8 - Targets Rust"; timer_start
  declare -a TARGETS=("x86_64-unknown-linux-gnu")
  [[ "$BUILD_APK" == true ]] && TARGETS+=("aarch64-linux-android" "armv7-linux-androideabi" "i686-linux-android" "x86_64-linux-android")
  INSTALLED=$(rustup target list --installed 2>/dev/null || true)
  for t in "${TARGETS[@]}"; do
    if echo "$INSTALLED" | grep -q "^${t}$"; then
      success "Deja installe : $t"
    else
      info "Ajout : $t"
      rustup target add "$t" || die "Impossible d ajouter $t"
      success "Ajoute : $t"
    fi
  done
  timer_end
fi

# ── Rechargement variables ────────────────────────────────────────
source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$NDK_HOME}"
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java 2>/dev/null || echo /usr/bin/java)")")")}"
export PATH="$HOME/.cargo/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:$JAVA_HOME/bin:$PATH"

# ── Verification finale ────────────────────────────────────────────
step "Verification de l environnement"
ERRORS=0
_chk() { local l="$1"; shift; eval "$*" &>/dev/null 2>&1 && success "$l" || { error "$l MANQUANT"; ((ERRORS++)); }; }
_chk "rustc"       "command -v rustc"
_chk "cargo"       "command -v cargo"
_chk "node >=18"   "node -e \"process.exit(parseInt(process.version.slice(1))<18?1:0)\""
_chk "npm"         "command -v npm"
_chk "tauri v2"    "\"$PROJECT_ROOT/node_modules/.bin/tauri\" --version 2>/dev/null | grep -qE '^(tauri-cli )?2\.' || tauri --version 2>/dev/null | grep -qE '2\.'"
if [[ "$BUILD_APK" == true ]]; then
  _chk "java >=17"   "java -version 2>&1 | grep -qE '\"1[7-9]\.|\"[2-9][0-9]\.'"
  _chk "ANDROID_HOME" "test -d '${ANDROID_HOME:-/x}'"
  _chk "sdkmanager"  "command -v sdkmanager"
  _chk "NDK"         "test -d '${NDK_HOME:-/x}/build'"
  _chk "aarch64-android" "rustup target list --installed | grep -q aarch64-linux-android"
fi
[[ "$ERRORS" -gt 0 ]] && die "$ERRORS prerequis manquants."
success "Environnement complet !"
if [[ "$COMPILE" == false ]]; then
  info "Mode --deps-only : done. Relancez sans --deps-only pour compiler."
  exit 0
fi

# ── npm install ───────────────────────────────────────────────────
step "Dependances npm du projet"
cd "$PROJECT_ROOT"
[[ -f "package-lock.json" ]] && npm ci || npm install
success "npm OK"

# ════════════════════════════════════════════════════════════════
# COMPILATION APPIMAGE
# ════════════════════════════════════════════════════════════════
APPIMAGE_FILE=""
if [[ "$BUILD_APPIMAGE" == true ]]; then
  step "COMPILATION AppImage"
  if [[ "$DEBUG_MODE" == true ]]; then warn "Mode DEBUG : DevTools s ouvrent automatiquement au lancement"; fi
  info "Duree estimee : 5-15 min (premiere fois)"
  timer_start
  LOG="/tmp/beartify-appimage-$(date +%s).log"
  info "Log : $LOG"
  set +e
  if [[ "$DEBUG_MODE" == true ]]; then
    npm run tauri build -- --bundles appimage --debug 2>&1 | tee "$LOG"
  else
    npm run tauri build -- --bundles appimage 2>&1 | tee "$LOG"
  fi
  EXIT=${PIPESTATUS[0]}
  set -e
  if [[ "$EXIT" -ne 0 ]]; then
    error "Compilation echouee (code $EXIT)"
    warn "Causes frequentes : libwebkit2gtk-4.1 manquant, Cargo.toml erreur, capabilities manquant"
    warn "Log : $LOG"; die "AppImage non genere."
  fi
  DIR="target/release/bundle/appimage"
  if [[ "$DEBUG_MODE" == true ]]; then DIR="target/debug/bundle/appimage"; fi
  APPIMAGE_FILE=$(find "$TAURI_DIR/$DIR" -name "*.AppImage" 2>/dev/null | tail -1 || true)
  if [[ -z "$APPIMAGE_FILE" ]]; then
    APPIMAGE_FILE=$(find "$TAURI_DIR/target" -name "*.AppImage" 2>/dev/null | tail -1 || true)
  fi
  [[ -n "$APPIMAGE_FILE" ]] || die ".AppImage introuvable"
  chmod +x "$APPIMAGE_FILE"
  success "AppImage : $APPIMAGE_FILE ($(du -sh "$APPIMAGE_FILE" | cut -f1))"
  timer_end
fi

# ════════════════════════════════════════════════════════════════
# COMPILATION APK
# ════════════════════════════════════════════════════════════════
APK_FILE=""
if [[ "$BUILD_APK" == true ]]; then
  step "COMPILATION APK Android"
  if [[ "$DEBUG_MODE" == true ]]; then warn "Mode DEBUG : utilisez chrome://inspect pour les DevTools Android"; fi
  info "Duree estimee : 15-40 min"
  info "ANDROID_HOME : $ANDROID_HOME | NDK : $NDK_HOME | JDK : $JAVA_HOME"
  timer_start
  export ANDROID_HOME NDK_HOME ANDROID_NDK_HOME JAVA_HOME ANDROID_SDK_ROOT
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
  if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
    info "Initialisation projet Android (premiere fois)..."
    LOG_INIT="/tmp/beartify-android-init-$(date +%s).log"
    set +e; npm run tauri android init 2>&1 | tee "$LOG_INIT"; INIT_EXIT=${PIPESTATUS[0]}; set -e
    [[ "$INIT_EXIT" -eq 0 ]] || { error "tauri android init echoue"; tail -20 "$LOG_INIT"; die "Init Android echoue."; }
    success "Projet Android initialise"
  fi
  LOG="/tmp/beartify-apk-$(date +%s).log"
  info "Log : $LOG"
  set +e
  if [[ "$DEBUG_MODE" == true ]]; then
    npm run tauri android build -- --apk --debug 2>&1 | tee "$LOG"
  else
    npm run tauri android build -- --apk 2>&1 | tee "$LOG"
  fi
  APK_EXIT=${PIPESTATUS[0]}; set -e
  if [[ "$APK_EXIT" -ne 0 ]]; then
    error "Compilation APK echouee (code $APK_EXIT)"
    warn "Causes : NDK version incorrecte, JDK < 17, espace disque insuffisant, timeout Gradle"
    warn "Log : $LOG"; die "APK non genere."
  fi
  APK_FILE=$(find "$TAURI_DIR/gen/android" -name "*release-unsigned*.apk" 2>/dev/null | head -1 || true)
  if [[ -z "$APK_FILE" ]]; then
    APK_FILE=$(find "$TAURI_DIR/gen/android" -name "*.apk" 2>/dev/null | tail -1 || true)
  fi
  [[ -n "$APK_FILE" ]] || die ".apk introuvable"
  success "APK : $APK_FILE ($(du -sh "$APK_FILE" | cut -f1))"
  timer_end
fi

# ── Resume ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   Compilation terminee avec succes !${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
[[ -n "$APPIMAGE_FILE" ]] && echo -e "  ${GREEN}AppImage${NC} : $APPIMAGE_FILE"
[[ -n "$APK_FILE"      ]] && echo -e "  ${GREEN}APK     ${NC} : $APK_FILE"
echo ""
echo "  DevTools : F12 / Ctrl+Shift+I dans l application"
echo "  Panneau debug Beartify : Ctrl+Shift+D"
echo ""
echo "  RAPPELS :"
echo "  1. Firebase Console -> Auth -> Authorized domains -> tauri://localhost"
echo "  2. Discord Dev Portal -> OAuth2 -> Redirects -> tauri://localhost"
echo "  3. URL proxy (si pas localhost:3000) : Parametres -> Serveur dans l app"
echo ""
