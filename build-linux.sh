#!/usr/bin/env bash
# ================================================================
#  Beartify - Script de compilation COMPLET
#  Distros : Debian/Ubuntu/Mint + Arch Linux/Manjaro
#  Cibles  : .AppImage + .deb/.pkg.tar.zst + .apk signé + install Arch
#  Usage   : ./build-linux.sh [--no-appimage] [--no-apk] [--no-sign]
#             [--no-deps] [--debug] [--help]
# ================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Anti-Root ────────────────────────────────────────────────────
if [[ "$EUID" -eq 0 ]]; then
  echo -e "\033[0;31m[ERREUR] Ne lancez pas ce script avec sudo.\033[0m"
  echo -e "\033[1;33mLancez : ./build-linux.sh\033[0m"
  exit 1
fi

# ════════════════════════════════════════════════════════════════
#  CONFIGURATION SIGNATURE APK  ← modifiez uniquement ici
# ════════════════════════════════════════════════════════════════
SIGN_KEYSTORE="$HOME/beartify.jks"
SIGN_ALIAS="beartify"
SIGN_KS_PASS="290809"
SIGN_KEY_PASS=""   # vide = identique a SIGN_KS_PASS
# ════════════════════════════════════════════════════════════════

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
BUILD_APPIMAGE=true; BUILD_APK=true; INSTALL_DEPS=true; COMPILE=true
DEBUG_MODE=false; SIGN_APK=true
for arg in "$@"; do
  case "$arg" in
    --no-appimage) BUILD_APPIMAGE=false ;;
    --no-apk)      BUILD_APK=false ;;
    --no-sign)     SIGN_APK=false ;;
    --no-deps)     INSTALL_DEPS=false ;;
    --debug)       DEBUG_MODE=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Sans argument : compile tout (AppImage + .deb/.pkg + APK signe) et installe les deps."
      echo ""
      echo "  --no-appimage   Ne compile pas l AppImage ni le .deb/.pkg"
      echo "  --no-apk        Ne compile pas l APK Android"
      echo "  --no-sign       Ne signe pas l APK"
      echo "  --no-deps       Ne reinstalle pas les dependances systeme"
      echo "  --debug         Mode debug (DevTools ouverts au lancement)"
      echo ""
      echo "Variables de signature : bloc CONFIGURATION SIGNATURE APK en haut du script."
      exit 0 ;;
    *) warn "Argument inconnu : $arg" ;;
  esac
done

# ── Detection projet ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[[ ! -f "package.json" && -f "../package.json" ]] && cd ..
[[ -f "package.json" ]] || die "package.json introuvable."
PROJECT_ROOT="$(pwd)"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
SRC_DIR="$PROJECT_ROOT/src"
[[ -d "$TAURI_DIR" ]] || die "src-tauri/ introuvable dans $PROJECT_ROOT"
[[ -d "$SRC_DIR"   ]] || die "src/ introuvable dans $PROJECT_ROOT"
info "Projet  : $PROJECT_ROOT"
info "Web     : $SRC_DIR"
info "Tauri   : $TAURI_DIR"

# ── Detection distro ─────────────────────────────────────────────
DISTRO="unknown"
PKG_MANAGER="apt"
if command -v apt-get &>/dev/null; then
  DISTRO="debian"
  PKG_MANAGER="apt"
elif command -v pacman &>/dev/null; then
  DISTRO="arch"
  PKG_MANAGER="pacman"
else
  warn "Distro non reconnue (ni apt ni pacman) — installation deps ignoree"
  INSTALL_DEPS=false
fi
info "Distro  : $DISTRO ($PKG_MANAGER)"

# ── Branchement variables de signature ───────────────────────────
KEYSTORE_PATH="$SIGN_KEYSTORE"
KEYSTORE_ALIAS="$SIGN_ALIAS"
KEYSTORE_PASS="$SIGN_KS_PASS"
KEY_PASS="${SIGN_KEY_PASS:-}"
[[ -z "$KEY_PASS" ]] && KEY_PASS="$KEYSTORE_PASS"

if [[ "$SIGN_APK" == true && "$BUILD_APK" == true ]]; then
  KEYSTORE_PATH="${KEYSTORE_PATH/#\~/$HOME}"
  KEYSTORE_PATH="$(realpath "$KEYSTORE_PATH" 2>/dev/null || echo "$KEYSTORE_PATH")"
  [[ -f "$KEYSTORE_PATH" ]] || die "Keystore introuvable : $KEYSTORE_PATH\nVerifiez SIGN_KEYSTORE en haut du script."
  [[ -n "$KEYSTORE_PASS" ]] || die "SIGN_KS_PASS est vide — renseignez le mot de passe en haut du script."
  success "Signature APK configuree : $KEYSTORE_PATH (alias: $KEYSTORE_ALIAS)"
fi

# ── Sudo keepalive ────────────────────────────────────────────────
if [[ "$INSTALL_DEPS" == true ]]; then
  echo -e "${YELLOW}Ce script necessite les droits administrateur pour les paquets systeme.${NC}"
  sudo -v || die "Impossible d obtenir sudo."
  ( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
  SUDO_KEEPER=$!
  trap 'kill "$SUDO_KEEPER" 2>/dev/null || true' EXIT
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 1/8 - PAQUETS SYSTEME
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true ]]; then
  step "ETAPE 1/8 - Paquets systeme ($DISTRO)"; timer_start

  if [[ "$DISTRO" == "debian" ]]; then
    # Nettoyage préventif des anciens dépôts NodeSource cassés avant apt update
    sudo rm -f /etc/apt/sources.list.d/nodesource*.list \
               /etc/apt/sources.list.d/nodesource*.sources \
               /usr/share/keyrings/nodesource*.gpg \
               /etc/apt/keyrings/nodesource*.gpg 2>/dev/null || true

    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends \
      build-essential curl wget git file unzip zip xz-utils \
      ca-certificates gnupg lsb-release pkg-config libssl-dev
    DEBIAN_CODENAME=$(lsb_release -sc 2>/dev/null || echo "bookworm")
    DEBIAN_VERSION=$(lsb_release -sr 2>/dev/null | cut -d. -f1 || echo "12")
    info "Debian/Ubuntu $DEBIAN_VERSION ($DEBIAN_CODENAME)"
    sudo apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev 2>/dev/null || \
      sudo apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev || \
      die "Impossible d installer webkit2gtk."
    sudo apt-get install -y --no-install-recommends \
      libgtk-3-dev librsvg2-dev patchelf libxdo-dev libglib2.0-dev \
      libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libatk1.0-dev \
      squashfs-tools fuse libfuse2t64 2>/dev/null || \
    sudo apt-get install -y --no-install-recommends \
      libgtk-3-dev librsvg2-dev patchelf libxdo-dev libglib2.0-dev \
      libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libatk1.0-dev \
      squashfs-tools fuse libfuse2
    sudo apt-get install -y --no-install-recommends \
      libayatana-appindicator3-dev 2>/dev/null || \
      sudo apt-get install -y --no-install-recommends libappindicator3-dev 2>/dev/null || \
      warn "libayatana indisponible (non bloquant)"
    sudo apt-get install -y --no-install-recommends imagemagick dpkg 2>/dev/null || true

  elif [[ "$DISTRO" == "arch" ]]; then
    sudo pacman -Syu --noconfirm --needed \
      base-devel curl wget git file unzip zip xz \
      ca-certificates gnupg openssl pkg-config \
      webkit2gtk-4.1 gtk3 librsvg patchelf xdotool glib2 \
      cairo pango gdk-pixbuf2 atk squashfs-tools fuse2 \
      libayatana-appindicator imagemagick dpkg 2>/dev/null || \
    sudo pacman -Syu --noconfirm --needed \
      base-devel curl wget git file unzip zip xz \
      ca-certificates gnupg openssl pkg-config \
      webkit2gtk gtk3 librsvg patchelf xdotool glib2 \
      cairo pango gdk-pixbuf2 atk squashfs-tools fuse2 imagemagick dpkg
    # libayatana optionnel sur Arch
    sudo pacman -S --noconfirm --needed libayatana-appindicator 2>/dev/null || \
      warn "libayatana-appindicator non disponible (non bloquant)"
  fi

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
    if [[ "$NM" -ge 18 ]]; then success "Node.js v$NV deja installe"; NEED_NODE=false
    else warn "Node.js v$NV trop ancien"; fi
  fi
  if [[ "$NEED_NODE" == true ]]; then
    if [[ "$DISTRO" == "debian" ]]; then
      # Configuration du nouveau dépôt NodeSource v2 avec keyring dédié
      sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --overwrite
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list > /dev/null

      sudo apt-get update -qq
      sudo apt-get install -y nodejs
    elif [[ "$DISTRO" == "arch" ]]; then
      sudo pacman -S --noconfirm --needed nodejs npm
    fi
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
  echo "$TF" | grep -qE "^tauri-cli 2\.|^2\.[0-9]" || die "Tauri CLI v2 introuvable (obtenu: '$TF')"
  success "Tauri CLI : $TF"; timer_end
fi

# ════════════════════════════════════════════════════════════════
# ETAPE 5/8 - JDK
# ════════════════════════════════════════════════════════════════
if [[ "$INSTALL_DEPS" == true && "$BUILD_APK" == true ]]; then
  step "ETAPE 5/8 - OpenJDK (requis pour Android)"; timer_start
  NEED_JDK=true
  if command -v java &>/dev/null; then
    JV=$(java -version 2>&1 | head -1 | awk -F'"' '{print $2}' || echo "0")
    JM="${JV%%.*}"; [[ "$JM" =~ ^[0-9]+$ ]] || JM=0
    if [[ "$JM" -ge 17 ]]; then success "JDK $JV deja installe"; NEED_JDK=false
    else warn "Java $JV trop ancien"; fi
  fi
  if [[ "$NEED_JDK" == true ]]; then
    if [[ "$DISTRO" == "debian" ]]; then
      JDKV_INSTALLED=false
      for TRY_VER in 21 17; do
        if sudo apt-get install -y --no-install-recommends "openjdk-${TRY_VER}-jdk" 2>/dev/null; then
          JDKV_INSTALLED=true; break
        fi
      done
      [[ "$JDKV_INSTALLED" == true ]] || die "Impossible d installer OpenJDK."
    elif [[ "$DISTRO" == "arch" ]]; then
      sudo pacman -S --noconfirm --needed jdk21-openjdk 2>/dev/null || \
        sudo pacman -S --noconfirm --needed jdk17-openjdk || die "Impossible d installer OpenJDK."
    fi
  fi
  if [[ -z "${JAVA_HOME:-}" ]]; then
    if [[ "$DISTRO" == "debian" ]]; then
      for TRY in 21 17; do
        JH=$(update-java-alternatives -l 2>/dev/null | grep -i "java-${TRY}\|openjdk-${TRY}" | awk '{print $3}' | head -1 || true)
        [[ -n "$JH" ]] && { export JAVA_HOME="$JH"; break; }
      done
    elif [[ "$DISTRO" == "arch" ]]; then
      JAVA_HOME=$(archlinux-java status 2>/dev/null | grep default | awk '{print "/usr/lib/jvm/"$1}' || true)
      [[ -z "$JAVA_HOME" ]] && JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
      export JAVA_HOME
    fi
    [[ -z "${JAVA_HOME:-}" ]] && export JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
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
      [[ $a -eq 3 ]] && { rm -rf "$TMP"; die "Telechargement impossible."; }
    done
    mkdir -p "$TMP/ex"; unzip -q "$TMP/ct.zip" -d "$TMP/ex"
    rm -rf "$CMDLINE_DIR"
    [[ -d "$TMP/ex/cmdline-tools" ]] && mv "$TMP/ex/cmdline-tools" "$CMDLINE_DIR" || mv "$TMP/ex" "$CMDLINE_DIR"
    rm -rf "$TMP"; success "Command Line Tools extraits"
  else
    success "Command Line Tools deja presents"
  fi
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
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
    sdkmanager --sdk_root="$ANDROID_HOME" "ndk;${ANDROID_NDK_VERSION}" >/dev/null || die "Echec installation NDK"
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
    if echo "$INSTALLED" | grep -q "^${t}$"; then success "Deja installe : $t"
    else info "Ajout : $t"; rustup target add "$t" || die "Impossible d ajouter $t"; success "Ajoute : $t"; fi
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

# ── Verification finale ───────────────────────────────────────────
step "Verification de l environnement"
ERRORS=0
_chk() { local l="$1"; shift; eval "$*" &>/dev/null 2>&1 && success "$l" || { error "$l MANQUANT"; ((ERRORS++)); }; }
_chk "rustc"      "command -v rustc"
_chk "cargo"      "command -v cargo"
_chk "node >=18"  "node -e \"process.exit(parseInt(process.version.slice(1))<18?1:0)\""
_chk "npm"        "command -v npm"
_chk "tauri v2"   "\"$PROJECT_ROOT/node_modules/.bin/tauri\" --version 2>/dev/null | grep -qE '^(tauri-cli )?2\.' || tauri --version 2>/dev/null | grep -qE '2\.'"
if [[ "$BUILD_APK" == true ]]; then
  _chk "java >=17"       "java -version 2>&1 | grep -qE '\"1[7-9]\.|\"[2-9][0-9]\.'"
  _chk "ANDROID_HOME"    "test -d '${ANDROID_HOME:-/x}'"
  _chk "sdkmanager"      "command -v sdkmanager"
  _chk "NDK"             "test -d '${NDK_HOME:-/x}/build'"
  _chk "aarch64-android" "rustup target list --installed | grep -q aarch64-linux-android"
  if [[ "$SIGN_APK" == true ]]; then
    _chk "keytool"   "command -v keytool"
    _chk "apksigner" "test -x '${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}/apksigner' || command -v apksigner"
  fi
fi
[[ "$ERRORS" -gt 0 ]] && die "$ERRORS prerequis manquants."
success "Environnement complet !"
[[ "$COMPILE" == false ]] && { info "Mode --deps-only : done."; exit 0; }

# ── npm install ───────────────────────────────────────────────────
step "Dependances npm du projet"
cd "$PROJECT_ROOT"
[[ -f "package-lock.json" ]] && npm ci || npm install
success "npm OK"

# ── Build frontend (Vite) ─────────────────────────────────────────
step "Build frontend (Vite -> src/dist)"
cd "$PROJECT_ROOT"
if npm run build 2>&1; then
  DIST_INDEX=$(find "$SRC_DIR/dist" -name "index.html" 2>/dev/null | head -1 || true)
  if [[ -z "$DIST_INDEX" ]]; then
    DIST_INDEX=$(find "$PROJECT_ROOT/dist" -name "index.html" 2>/dev/null | head -1 || true)
    [[ -n "$DIST_INDEX" ]] && warn "Vite a sorti dans $(dirname "$DIST_INDEX") au lieu de src/dist" \
      || die "Build Vite termine mais index.html introuvable."
  fi
  success "Frontend build OK : $(dirname "$DIST_INDEX")"
else
  die "Build Vite echoue."
fi
cd "$PROJECT_ROOT"

# ── Diagnostic icones ─────────────────────────────────────────────
step "Verification des icones src-tauri/icons/"
ICON_ERRORS=0
for ICO in "icons/32x32.png" "icons/64x64.png" "icons/128x128.png" "icons/128x128@2x.png" "icons/icon.png"; do
  FULL="$TAURI_DIR/$ICO"
  if [[ ! -f "$FULL" ]]; then
    error "Icone manquante : $FULL"; ((ICON_ERRORS++))
  elif ! file "$FULL" 2>/dev/null | grep -q "PNG"; then
    warn "Fichier suspect (pas un PNG valide) : $FULL"
  else
    success "OK : $ICO"
  fi
done
if [[ "$ICON_ERRORS" -gt 0 ]]; then
  warn "$ICON_ERRORS icone(s) manquante(s)."
  die "Icones manquantes — utilisez : npm run tauri icon chemin/vers/source-1024.png"
fi
success "Toutes les icones sont presentes"

# ════════════════════════════════════════════════════════════════
# COMPILATION APPIMAGE + DEB
# ════════════════════════════════════════════════════════════════
APPIMAGE_FILE=""; DEB_FILE=""
if [[ "$BUILD_APPIMAGE" == true ]]; then
  step "COMPILATION AppImage + .deb"
  info "Duree estimee : 5-15 min (premiere fois)"
  timer_start
  LOG="/tmp/beartify-appimage-$(date +%s).log"
  info "Log : $LOG"
  set +e
  if [[ "$DEBUG_MODE" == true ]]; then
    npm run tauri build -- --bundles appimage,deb --debug 2>&1 | tee "$LOG"
  else
    npm run tauri build -- --bundles appimage,deb 2>&1 | tee "$LOG"
  fi
  EXIT=${PIPESTATUS[0]}
  set -e
  if [[ "$EXIT" -ne 0 ]]; then
    error "Compilation echouee (code $EXIT)"; warn "Log : $LOG"
    die "AppImage non genere."
  fi
  BUNDLE_DIR="target/release/bundle"
  [[ "$DEBUG_MODE" == true ]] && BUNDLE_DIR="target/debug/bundle"
  APPIMAGE_FILE=$(find "$TAURI_DIR/$BUNDLE_DIR/appimage" -name "*.AppImage" 2>/dev/null | tail -1 || \
                  find "$TAURI_DIR/target" -name "*.AppImage" 2>/dev/null | tail -1 || true)
  # Nettoie les anciens .deb patchés pour éviter le repackaging en cascade
  find "$TAURI_DIR/$BUNDLE_DIR/deb" -name "*-patched*.deb" -delete 2>/dev/null || true
  DEB_FILE=$(find "$TAURI_DIR/$BUNDLE_DIR/deb" -name "*.deb" ! -name "*-patched*" 2>/dev/null | tail -1 || \
             find "$TAURI_DIR/target" -name "*.deb" ! -name "*-patched*" 2>/dev/null | tail -1 || true)
  [[ -n "$APPIMAGE_FILE" ]] || die ".AppImage introuvable"
  chmod +x "$APPIMAGE_FILE"
  success "AppImage : $APPIMAGE_FILE ($(du -sh "$APPIMAGE_FILE" | cut -f1))"
  [[ -n "$DEB_FILE" ]] && success ".deb : $DEB_FILE ($(du -sh "$DEB_FILE" | cut -f1))" || warn ".deb non trouve"
  timer_end

  # ── Patch icone .deb ─────────────────────────────────────────────
  if [[ -n "$DEB_FILE" && "$DISTRO" == "debian" ]]; then
    step "Patch icone .deb"
    DEB_WORK=$(mktemp -d)
    dpkg-deb -R "$DEB_FILE" "$DEB_WORK"
    DETECTED_ICON_BASENAME=""
    for ICON_PATH in $(find "$DEB_WORK/usr/share/icons" -name "*.png" 2>/dev/null); do
      info "Icone : $ICON_PATH"
      SIZE=$(basename "$(dirname "$(dirname "$ICON_PATH")")")
      SRC_ICON=""
      case "$SIZE" in
        32x32)       SRC_ICON="$TAURI_DIR/icons/32x32.png" ;;
        64x64)       SRC_ICON="$TAURI_DIR/icons/64x64.png" ;;
        128x128)     SRC_ICON="$TAURI_DIR/icons/128x128.png" ;;
        256x256*|512x512) SRC_ICON="$TAURI_DIR/icons/icon.png" ;;
        *)           SRC_ICON="$TAURI_DIR/icons/128x128.png" ;;
      esac
      [[ -f "$SRC_ICON" ]] && cp "$SRC_ICON" "$ICON_PATH" 2>/dev/null || true
      # Retient le nom de fichier reel utilise par Tauri (sans extension)
      # pour faire correspondre EXACTEMENT le champ Icon= du .desktop a ce nom.
      [[ -z "$DETECTED_ICON_BASENAME" ]] && DETECTED_ICON_BASENAME="$(basename "$ICON_PATH" .png)"
    done
    DESKTOP_FILE=$(find "$DEB_WORK/usr/share/applications" -name "*.desktop" 2>/dev/null | head -1 || true)
    if [[ -n "$DESKTOP_FILE" ]]; then
      grep -q "^StartupWMClass=" "$DESKTOP_FILE" \
        && sed -i 's/^StartupWMClass=.*/StartupWMClass=Beartify/' "$DESKTOP_FILE" \
        || echo "StartupWMClass=Beartify" >> "$DESKTOP_FILE"
      # IMPORTANT : Icon= doit correspondre EXACTEMENT au nom de fichier installe
      # dans usr/share/icons/hicolor/*/apps/ pour que le theme freedesktop le trouve.
      # Forcer "org.beartify.player" alors que Tauri nomme le fichier differemment
      # (ex: "beartify.png") fait echouer la recherche d icone -> icone generique.
      if [[ -n "$DETECTED_ICON_BASENAME" ]]; then
        sed -i "s/^Icon=.*/Icon=${DETECTED_ICON_BASENAME}/" "$DESKTOP_FILE"
        info "  Icon= aligne sur le nom de fichier reel : $DETECTED_ICON_BASENAME"
      else
        warn "Aucune icone trouvee dans usr/share/icons — Icon= non modifie"
      fi
      success "Patch .desktop OK"
      info "  StartupWMClass=$(grep '^StartupWMClass=' "$DESKTOP_FILE" | cut -d= -f2)"
      info "  Icon=$(grep '^Icon=' "$DESKTOP_FILE" | cut -d= -f2)"
    fi
    ORIGINAL_DEB="$DEB_FILE"
    dpkg-deb --root-owner-group -b "$DEB_WORK" "${DEB_FILE%.deb}-patched.deb"       && mv "${DEB_FILE%.deb}-patched.deb" "$ORIGINAL_DEB"       && DEB_FILE="$ORIGINAL_DEB"       && success ".deb patche (icone + StartupWMClass) : $(basename "$DEB_FILE")"       || warn "Repackaging .deb echoue (non bloquant)"
    rm -rf "$DEB_WORK"
  fi

  # ── Patch icone AppImage ──────────────────────────────────────────
  # Strategie 1 : appimagetool (officiel, le plus fiable)
  # Strategie 2 : --appimage-extract integre dans l AppImage elle-meme
  # Strategie 3 : unsquashfs/mksquashfs manuel avec detection compression
  step "Patch icone AppImage"
  set +e
  AI_PATCH_OK=false
  AI_WORK=$(mktemp -d)

  # ── Copie de travail pour ne pas corrompre l original si echec ───
  AI_COPY="$AI_WORK/Beartify.AppImage"
  cp "$APPIMAGE_FILE" "$AI_COPY"
  chmod +x "$AI_COPY"

  # ── Strategie 1 : appimagetool ───────────────────────────────────
  APPIMAGETOOL=""
  if command -v appimagetool &>/dev/null; then
    APPIMAGETOOL="appimagetool"
  elif [[ -f "$AI_WORK/appimagetool" ]]; then
    APPIMAGETOOL="$AI_WORK/appimagetool"
  else
    # Telechargement appimagetool si absent
    info "Telechargement appimagetool..."
    wget -q --timeout=30       "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"       -O "$AI_WORK/appimagetool" 2>/dev/null && chmod +x "$AI_WORK/appimagetool"       && APPIMAGETOOL="$AI_WORK/appimagetool"       || warn "Telechargement appimagetool echoue — passage a la strategie 2"
  fi

  # Extraction via --appimage-extract (fonctionne avec n importe quelle AppImage)
  info "Extraction AppImage via --appimage-extract..."
  cd "$AI_WORK"
  APPIMAGE_EXTRACT_AND_RUN=1 "$AI_COPY" --appimage-extract >/dev/null 2>&1 ||     "$AI_COPY" --appimage-extract >/dev/null 2>&1 || true
  cd "$PROJECT_ROOT"
  SQUASHFS_DIR="$AI_WORK/squashfs-root"

  if [[ -d "$SQUASHFS_DIR" ]]; then
    NB=$(find "$SQUASHFS_DIR" -type f 2>/dev/null | wc -l)
    info "--appimage-extract OK : $NB fichiers dans squashfs-root"

    # 1. .DirIcon = icone du fichier AppImage dans Nautilus/Dolphin/Thunar
    # rm -f OBLIGATOIRE : .DirIcon est un lien symbolique dans le squashfs Tauri.
    # Sans rm, cp suit le lien et ecrit dans le fichier cible (hors squashfs-root)
    # au lieu de creer un vrai fichier PNG a cet emplacement.
    rm -f "$SQUASHFS_DIR/.DirIcon"
    cp "$TAURI_DIR/icons/128x128.png" "$SQUASHFS_DIR/.DirIcon" 2>/dev/null       && info ".DirIcon injecte : $(file "$SQUASHFS_DIR/.DirIcon" | cut -d: -f2 | xargs)"       || { cp "$TAURI_DIR/icons/icon.png" "$SQUASHFS_DIR/.DirIcon" 2>/dev/null; warn ".DirIcon fallback icon.png"; }

    # 2. Remplace tous les PNG existants en preservant leur taille
    PNG_COUNT=0
    while IFS= read -r -d "" ICON_F; do
      W=$(python3 -c "
import struct,sys
try:
    d=open(sys.argv[1],'rb').read(24)
    if d[:4]==b'\x89PNG': print(struct.unpack('>I',d[16:20])[0])
    else: print(128)
except: print(128)" "$ICON_F" 2>/dev/null); W="${W:-128}"
      # rm -f pour casser le lien symbolique eventuel avant d ecrire le vrai fichier
      rm -f "$ICON_F"
      if command -v convert &>/dev/null; then
        convert "$TAURI_DIR/icons/icon.png" -resize "${W}x${W}" "$ICON_F" 2>/dev/null           || cp "$TAURI_DIR/icons/icon.png" "$ICON_F" 2>/dev/null
      else
        cp "$TAURI_DIR/icons/icon.png" "$ICON_F" 2>/dev/null
      fi
      ((PNG_COUNT++)) || true
    done < <(find "$SQUASHFS_DIR" -name "*.png" -not -name ".DirIcon" -print0 2>/dev/null)
    info "$PNG_COUNT PNG remplaces"

# 3. Patch .desktop : StartupWMClass uniquement.
    # IMPORTANT : on NE TOUCHE PAS au champ Icon= !
    # Notre boucle PNG ci-dessus remplace deja le CONTENU de tous les fichiers
    # PNG du squashfs-root (recursif), y compris celui que Icon= reference et
    # vers lequel .DirIcon pointera (symlink genere par appimagetool selon le
    # spec AppImage). Forcer Icon=beartify alors que le vrai fichier racine
    # s appelle differemment (ex: "Beartify.png" avec majuscule) cassait la
    # resolution d icone -> appimagetool retombait sur son icone par defaut.
    AI_DESKTOP=$(find "$SQUASHFS_DIR" -maxdepth 2 -name "*.desktop" 2>/dev/null | head -1)
    if [[ -n "$AI_DESKTOP" ]]; then
      grep -q "^StartupWMClass=" "$AI_DESKTOP" \
        && sed -i 's/^StartupWMClass=.*/StartupWMClass=Beartify/' "$AI_DESKTOP" \
        || echo "StartupWMClass=Beartify" >> "$AI_DESKTOP"
      info ".desktop patche : $(basename "$AI_DESKTOP") (Icon= preserve : $(grep '^Icon=' "$AI_DESKTOP" | cut -d= -f2))"
    else
      warn ".desktop non trouve dans squashfs-root"
    fi

    # 3b. Patch AppRun : auto-intégration au premier lancement ──────────
    # Quand un utilisateur lance l AppImage pour la premiere fois,
    # ce wrapper cree automatiquement .desktop + icones dans ~/.local/
    # → l icone Beartify apparait sur le fichier dans Nautilus/Thunar
    # sans aucune action supplementaire et sans appimaged.
    APPRUN="$SQUASHFS_DIR/AppRun"
    if [[ -f "$APPRUN" ]]; then
      if file "$APPRUN" | grep -qiE "shell script|text"; then
        # AppRun est un script shell — on prepend notre integration
        ORIG=$(cat "$APPRUN")
        cat > "$APPRUN" << 'APPRUN_EOF'
#!/bin/bash
# ── Auto-intégration Beartify (premier lancement) ─────────────────
SELF="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
AI_PATH="${APPIMAGE:-$(readlink -f "${BASH_SOURCE[0]}")}"
DESK="$HOME/.local/share/applications/beartify.desktop"
PREV="$(grep '^X-AppImage-Path=' "$DESK" 2>/dev/null | cut -d= -f2)"
if [[ ! -f "$DESK" || "$PREV" != "$AI_PATH" ]]; then
  for SZ in 32 64 128 256 512; do
    IDIR="$HOME/.local/share/icons/hicolor/${SZ}x${SZ}/apps"
    mkdir -p "$IDIR"
    SRC="$(find "$SELF/usr/share/icons" -name "*.png" -path "*${SZ}x${SZ}*" 2>/dev/null | head -1)"
    [[ -z "$SRC" ]] && SRC="$SELF/.DirIcon"
    [[ -f "$SRC" ]] && cp "$SRC" "$IDIR/beartify.png" 2>/dev/null
    [[ -f "$SRC" ]] && cp "$SRC" "$IDIR/org.beartify.player.png" 2>/dev/null
  done
  mkdir -p "$HOME/.local/share/applications"
  cat > "$DESK" << DESK_EOF
[Desktop Entry]
Name=Beartify
GenericName=Music Player
Comment=Beartify Music Player
Exec=${AI_PATH} %U
Icon=beartify
Terminal=false
Type=Application
Categories=Audio;Music;Player;
StartupWMClass=Beartify
MimeType=x-scheme-handler/beartify;
Keywords=music;player;audio;beartify;
X-AppImage-Path=${AI_PATH}
DESK_EOF
  update-desktop-database "$HOME/.local/share/applications/" 2>/dev/null &
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor/" 2>/dev/null &
fi
# ── AppRun original ────────────────────────────────────────────────
APPRUN_EOF
        # Remet le contenu original sans son shebang
        echo "$ORIG" | grep -v '^#!/' >> "$APPRUN"
        chmod +x "$APPRUN"
        info "AppRun (script) patche avec auto-integration"
      else
        # AppRun est un binaire ELF — on le renomme et cree un wrapper
        mv "$APPRUN" "$APPRUN.bin"
        cat > "$APPRUN" << 'APPRUN_WRAPPER'
#!/bin/bash
SELF="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
AI_PATH="${APPIMAGE:-$(readlink -f "${BASH_SOURCE[0]}")}"
DESK="$HOME/.local/share/applications/beartify.desktop"
PREV="$(grep '^X-AppImage-Path=' "$DESK" 2>/dev/null | cut -d= -f2)"
if [[ ! -f "$DESK" || "$PREV" != "$AI_PATH" ]]; then
  for SZ in 32 64 128 256 512; do
    IDIR="$HOME/.local/share/icons/hicolor/${SZ}x${SZ}/apps"
    mkdir -p "$IDIR"
    SRC="$(find "$SELF/usr/share/icons" -name "*.png" -path "*${SZ}x${SZ}*" 2>/dev/null | head -1)"
    [[ -z "$SRC" ]] && SRC="$SELF/.DirIcon"
    [[ -f "$SRC" ]] && cp "$SRC" "$IDIR/beartify.png" 2>/dev/null
    [[ -f "$SRC" ]] && cp "$SRC" "$IDIR/org.beartify.player.png" 2>/dev/null
  done
  mkdir -p "$HOME/.local/share/applications"
  cat > "$DESK" << DESK_EOF
[Desktop Entry]
Name=Beartify
GenericName=Music Player
Exec=${AI_PATH} %U
Icon=beartify
Terminal=false
Type=Application
Categories=Audio;Music;Player;
StartupWMClass=Beartify
X-AppImage-Path=${AI_PATH}
DESK_EOF
  update-desktop-database "$HOME/.local/share/applications/" 2>/dev/null &
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor/" 2>/dev/null &
fi
exec "$SELF/AppRun.bin" "$@"
APPRUN_WRAPPER
        chmod +x "$APPRUN"
        info "AppRun (ELF) enveloppe avec auto-integration"
      fi
    fi

    # 4. Reconstruction via appimagetool — methode officielle, garantit un
    # AppImage qui demarre correctement (un repackaging manuel via mksquashfs
    # s est avere risque et a deja casse le demarrage de l AppImage).
    if [[ -n "$APPIMAGETOOL" ]]; then
      info "Reconstruction via appimagetool..."
      ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 \
        "$APPIMAGETOOL" --no-appstream "$SQUASHFS_DIR" "$AI_WORK/Beartify-rebuilt.AppImage" \
        >/dev/null 2>&1
      if [[ -f "$AI_WORK/Beartify-rebuilt.AppImage" && -s "$AI_WORK/Beartify-rebuilt.AppImage" ]]; then
        chmod +x "$AI_WORK/Beartify-rebuilt.AppImage"
        # Validation AVANT remplacement : --appimage-offset doit repondre par
        # un nombre > 0, sinon l AppImage reconstruite est invalide et on
        # garde l originale plutot que de produire un fichier casse.
        REBUILT_OFFSET=$("$AI_WORK/Beartify-rebuilt.AppImage" --appimage-offset 2>/dev/null | tr -d '[:space:]')
        if [[ "$REBUILT_OFFSET" =~ ^[0-9]+$ ]] && [[ "$REBUILT_OFFSET" -gt 0 ]]; then
          cp "$AI_WORK/Beartify-rebuilt.AppImage" "$APPIMAGE_FILE"
          AI_PATCH_OK=true
          info "Reconstruction appimagetool OK (offset valide=$REBUILT_OFFSET)"
        else
          warn "AppImage reconstruite invalide (offset='$REBUILT_OFFSET') — original conserve"
        fi
      else
        warn "appimagetool n a pas produit de fichier valide — fallback mksquashfs"
      fi
    fi

    # 4b. Fallback : reconstruction manuelle via mksquashfs + recolle ELF
    if [[ "$AI_PATCH_OK" == false ]] && command -v mksquashfs &>/dev/null; then
      info "Fallback : reconstruction mksquashfs..."

      # Detection compression du squashfs original
      AI_COMP=$(python3 -c "
import sys
data = open('$APPIMAGE_FILE','rb').read(4*1024*1024)
for i in range(len(data)-4):
    if data[i:i+4] in (b'hsqs', b'sqsh'):
        comp_id = data[i+20] if i+20 < len(data) else 1
        comp_map = {1:'gzip',2:'lzma',3:'lzo',4:'xz',5:'lz4',6:'zstd'}
        print(comp_map.get(comp_id, 'gzip')); sys.exit(0)
print('gzip')" 2>/dev/null); AI_COMP="${AI_COMP:-gzip}"

      # --appimage-offset interroge le RUNTIME lui-meme (officiel, fiable a 100%).
      # Le scan d octets "hsqs"/"sqsh" peut tomber sur un faux positif PLUS TOT
      # dans le binaire ELF (string accidentelle dans le code compile Rust/WebKit),
      # ce qui coupait l ELF header trop court et rendait l AppImage injouable.
      AI_OFFSET=$("$APPIMAGE_FILE" --appimage-offset 2>/dev/null | tr -d '[:space:]')
      if ! [[ "$AI_OFFSET" =~ ^[0-9]+$ ]]; then
        warn "--appimage-offset indisponible, fallback scan d octets (moins fiable)"
        AI_OFFSET=$(python3 -c "
import sys
data = open('$APPIMAGE_FILE','rb').read(4*1024*1024)
for i in range(len(data)-4):
    if data[i:i+4] in (b'hsqs', b'sqsh'):
        print(i); sys.exit(0)
print(0)" 2>/dev/null); AI_OFFSET="${AI_OFFSET:-0}"
      fi

      info "mksquashfs comp=$AI_COMP offset=$AI_OFFSET"
      # fakeroot force uid/gid=0 dans le squashfs.
      # Sans fakeroot les fichiers ont uid=1000 (user courant) et l AppImage
      # ne demarre plus car le runtime verifie les permissions du squashfs.
      if command -v fakeroot &>/dev/null; then
        fakeroot mksquashfs "$SQUASHFS_DIR" "$AI_WORK/fs-new.squashfs"           -comp "$AI_COMP" -noappend -no-progress 2>/dev/null ||         fakeroot mksquashfs "$SQUASHFS_DIR" "$AI_WORK/fs-new.squashfs"           -comp gzip -noappend -no-progress 2>/dev/null
      else
        sudo apt-get install -y --no-install-recommends fakeroot >/dev/null 2>&1 || true
        if command -v fakeroot &>/dev/null; then
          fakeroot mksquashfs "$SQUASHFS_DIR" "$AI_WORK/fs-new.squashfs"             -comp "$AI_COMP" -noappend -no-progress 2>/dev/null
        else
          mksquashfs "$SQUASHFS_DIR" "$AI_WORK/fs-new.squashfs"             -comp "$AI_COMP" -noappend -no-progress             -force-uid 0 -force-gid 0 2>/dev/null ||           mksquashfs "$SQUASHFS_DIR" "$AI_WORK/fs-new.squashfs"             -comp gzip -noappend -no-progress             -force-uid 0 -force-gid 0 2>/dev/null
        fi
      fi

      if [[ -f "$AI_WORK/fs-new.squashfs" && -s "$AI_WORK/fs-new.squashfs" && "$AI_OFFSET" -gt 0 ]]; then
        dd if="$APPIMAGE_FILE" bs=1 count="$AI_OFFSET" of="$AI_WORK/elf-header" 2>/dev/null
        cat "$AI_WORK/elf-header" "$AI_WORK/fs-new.squashfs" > "$AI_WORK/Beartify-manual.AppImage"
        chmod +x "$AI_WORK/Beartify-manual.AppImage"
        # Validation avant remplacement : verifie que l AppImage reconstruite
        # repond a --appimage-offset, sinon on garde l originale (qui fonctionne).
        MANUAL_OFFSET=$("$AI_WORK/Beartify-manual.AppImage" --appimage-offset 2>/dev/null | tr -d '[:space:]')
        if [[ "$MANUAL_OFFSET" =~ ^[0-9]+$ ]] && [[ "$MANUAL_OFFSET" -gt 0 ]]; then
          cp "$AI_WORK/Beartify-manual.AppImage" "$APPIMAGE_FILE"
          AI_PATCH_OK=true
          info "Reconstruction mksquashfs OK (offset valide=$MANUAL_OFFSET)"
        else
          warn "AppImage reconstruite (mksquashfs) invalide — original conserve"
        fi
      else
        warn "mksquashfs echec — squashfs vide ou offset invalide"
      fi
    fi
  else
    warn "--appimage-extract n a rien extrait (NB_FILES=0 ou dossier absent)"
    warn "L AppImage est peut-etre corrompue ou utilise un format non standard"
  fi

  rm -rf "$AI_WORK"
  set -e
  if [[ "$AI_PATCH_OK" == true ]]; then
    success "AppImage patchee : icone Beartify + StartupWMClass"

    # ── Icone personnalisee AppImage ─────────────────────────────────
    # Approche 1 : gio set (la plus fiable, aucun thumbnailer requis)
    # Nautilus lit "metadata::custom-icon" directement depuis les attributs
    # etendus du fichier — fonctionne meme sans thumbnailer installe.
    ICON_ABS="$(realpath "$TAURI_DIR/icons/icon.png")"
    if command -v gio &>/dev/null; then
      gio set "$APPIMAGE_FILE" "metadata::custom-icon" "file://${ICON_ABS}" 2>/dev/null         && success "Icone personnalisee AppImage via gio set"         || warn "gio set echoue (non bloquant)"
    fi

    # ── Intégration desktop complète (solution définitive pour l icone) ──
    # Installe Beartify comme une application du bureau :
    # - icones dans ~/.local/share/icons/hicolor/
    # - .desktop dans ~/.local/share/applications/
    # Nautilus associe le fichier .AppImage a l application installee
    # et affiche son icone sans thumbnailer ni cache a gerer.
    info "Integration desktop de l AppImage..."
    APPIMAGE_REALPATH="$(realpath "$APPIMAGE_FILE")"

    # Icones hicolor (toutes tailles)
    for ICON_DEF in "32:32x32" "64:64x64" "128:128x128" "256:icon" "512:icon"; do
      SZ="${ICON_DEF%%:*}"
      SRC_NAME="${ICON_DEF##*:}"
      DEST_DIR="$HOME/.local/share/icons/hicolor/${SZ}x${SZ}/apps"
      mkdir -p "$DEST_DIR"
      cp "$TAURI_DIR/icons/${SRC_NAME}.png" "$DEST_DIR/beartify.png" 2>/dev/null || true
      cp "$TAURI_DIR/icons/${SRC_NAME}.png" "$DEST_DIR/org.beartify.player.png" 2>/dev/null || true
    done
    mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
    cp "$TAURI_DIR/icons/icon.png" "$HOME/.local/share/icons/hicolor/scalable/apps/beartify.png" 2>/dev/null || true

    # Fichier .desktop utilisateur
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/beartify.desktop" << DESKEOF
[Desktop Entry]
Name=Beartify
GenericName=Music Player
Comment=Beartify Music Player
Exec=${APPIMAGE_REALPATH} %U
Icon=beartify
Terminal=false
Type=Application
Categories=Audio;Music;Player;
StartupWMClass=Beartify
MimeType=x-scheme-handler/beartify;
Keywords=music;player;audio;beartify;
X-AppImage-Path=${APPIMAGE_REALPATH}
DESKEOF

    update-desktop-database "$HOME/.local/share/applications/" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor/" 2>/dev/null || true

    # Thumbnailer user-local pour les futurs .AppImage
    mkdir -p "$HOME/.local/share/thumbnailers"
    cat > "$HOME/.local/share/thumbnailers/appimage.thumbnailer" << 'THUMBCONF'
[Thumbnailer Entry]
TryExec=bash
Exec=bash -c 'D=$(mktemp -d);cd "$D";APPIMAGE_EXTRACT_AND_RUN=1 "$1" --appimage-extract .DirIcon >/dev/null 2>&1;[ -f squashfs-root/.DirIcon ] && convert squashfs-root/.DirIcon -resize "${3}x${3}" "$2" && rm -rf "$D" && exit 0;rm -rf "$D";exit 1' -- %i %o %s
MimeType=application/x-iso9660-appimage;application/vnd.appimage;
THUMBCONF

    # Thumbnail Freedesktop via fichier Python temporaire
    # (evite les problemes d echappement dans les heredoc bash)
    PY_THUMB=$(mktemp /tmp/beartify_thumb_XXXXXX.py)
    APPIMAGE_PATH_ESC="$APPIMAGE_REALPATH"
    ICON128_ESC="$TAURI_DIR/icons/128x128.png"
    ICON512_ESC="$TAURI_DIR/icons/icon.png"
    python3 - "$APPIMAGE_PATH_ESC" "$ICON128_ESC" "$ICON512_ESC" << 'PYSCRIPT'
import hashlib,struct,zlib,os,subprocess,shutil,sys
ap,i128,i512 = sys.argv[1],sys.argv[2],sys.argv[3]
PNG_SIG=bytes([137,80,78,71,13,10,26,10])
def pct(s):
    safe=set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/:@!+,;=")
    return ''.join(c if c in safe else '%{:02X}'.format(ord(c)) for c in s)
def add_txt(png,kv):
    if png[:8]!=PNG_SIG: return png
    il=struct.unpack('>I',png[8:12])[0]; cut=8+4+4+il+4; out=b''
    for k,v in kv:
        b=(k+'\x00'+v).encode('latin-1')
        out+=struct.pack('>I',len(b))+b'tEXt'+b+struct.pack('>I',zlib.crc32(b'tEXt'+b)&0xffffffff)
    return png[:cut]+out+png[cut:]
uri="file://"+pct(os.path.realpath(ap))
md5=hashlib.md5(uri.encode()).hexdigest()
mt=str(int(os.path.getmtime(ap))); sz=str(os.path.getsize(ap))
kv=[("Thumb::URI",uri),("Thumb::MTime",mt),("Thumb::Size",sz)]
home=os.path.expanduser("~")
for name,px,src in [("normal","128",i128),("large","256",i512),("x-large","512",i512),("xx-large","1024",i512)]:
    dst=f"{home}/.cache/thumbnails/{name}/{md5}.png"; os.makedirs(os.path.dirname(dst),exist_ok=True)
    tmp=dst+".tmp"
    if subprocess.run(["convert",src,"-resize",f"{px}x{px}",tmp],capture_output=True).returncode!=0: shutil.copy2(src,tmp)
    with open(tmp,"rb") as f: data=add_txt(f.read(),kv)
    with open(dst,"wb") as f: f.write(data)
    os.chmod(dst,0o600); os.unlink(tmp)
    print(f"[thumb/{name}] OK")
print(f"[URI] {uri}")
PYSCRIPT
    rm -f "$PY_THUMB"

    nautilus -q 2>/dev/null || true
    success "Integration desktop complete : Beartify dans le lanceur + icone AppImage"
  else
    warn "Patch AppImage echoue sur les 3 strategies — icone par defaut conservee"
    warn "Solution manuelle : installez appimagetool et relancez"
  fi

  # ── Installation Arch Linux (AppImage → paquet .pkg.tar.zst) ─────
  if [[ "$DISTRO" == "arch" ]]; then
    step "Packaging Arch Linux (AppImage → .pkg.tar.zst)"
    APP_VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_ROOT/package.json'))['version'])" 2>/dev/null || echo "1.0.0")
    ARCH_PKG_DIR=$(mktemp -d)
    ARCH_PKG_NAME="beartify"

    # Structure du paquet
    mkdir -p "$ARCH_PKG_DIR/usr/bin"
    mkdir -p "$ARCH_PKG_DIR/usr/share/applications"
    mkdir -p "$ARCH_PKG_DIR/usr/share/icons/hicolor/128x128/apps"
    mkdir -p "$ARCH_PKG_DIR/usr/share/icons/hicolor/256x256/apps"
    mkdir -p "$ARCH_PKG_DIR/usr/share/icons/hicolor/scalable/apps"

    # Copie l AppImage dans /opt/beartify/
    mkdir -p "$ARCH_PKG_DIR/opt/beartify"
    cp "$APPIMAGE_FILE" "$ARCH_PKG_DIR/opt/beartify/Beartify.AppImage"
    chmod +x "$ARCH_PKG_DIR/opt/beartify/Beartify.AppImage"

    # Wrapper dans /usr/bin pour lancer depuis le terminal et le lanceur
    cat > "$ARCH_PKG_DIR/usr/bin/beartify" << 'WRAPPER_EOF'
#!/bin/bash
exec /opt/beartify/Beartify.AppImage --no-sandbox "$@"
WRAPPER_EOF
    chmod +x "$ARCH_PKG_DIR/usr/bin/beartify"

    # Icones
    cp "$TAURI_DIR/icons/128x128.png" "$ARCH_PKG_DIR/usr/share/icons/hicolor/128x128/apps/org.beartify.player.png"
    cp "$TAURI_DIR/icons/icon.png"    "$ARCH_PKG_DIR/usr/share/icons/hicolor/256x256/apps/org.beartify.player.png"
    cp "$TAURI_DIR/icons/icon.png"    "$ARCH_PKG_DIR/usr/share/icons/hicolor/scalable/apps/org.beartify.player.png" 2>/dev/null || true

    # Fichier .desktop
    cat > "$ARCH_PKG_DIR/usr/share/applications/org.beartify.player.desktop" << DESKTOP_EOF
[Desktop Entry]
Name=Beartify
Comment=Beartify Music Player
Exec=beartify %U
Icon=org.beartify.player
Terminal=false
Type=Application
Categories=Audio;Music;Player;
StartupWMClass=Beartify
MimeType=x-scheme-handler/beartify;
Keywords=music;player;audio;beartify;
DESKTOP_EOF

    # .PKGINFO (metadata paquet Arch)
    INSTALLED_SIZE=$(du -sk "$ARCH_PKG_DIR" | cut -f1)
    cat > "$ARCH_PKG_DIR/.PKGINFO" << PKGINFO_EOF
pkgname = $ARCH_PKG_NAME
pkgver = ${APP_VERSION}-1
arch = x86_64
pkgdesc = Beartify Music Player
url = https://beartify.duckdns.org
builddate = $(date +%s)
packager = Beartify Build Script
size = $INSTALLED_SIZE
depend = fuse2
PKGINFO_EOF

    # Construction du .pkg.tar.zst
    ARCH_PKG_FILE="$TAURI_DIR/target/release/bundle/${ARCH_PKG_NAME}-${APP_VERSION}-1-x86_64.pkg.tar.zst"
    mkdir -p "$(dirname "$ARCH_PKG_FILE")"
    ( cd "$ARCH_PKG_DIR" && bsdtar -czf "$ARCH_PKG_FILE" --zstd . 2>/dev/null ) || \
    ( cd "$ARCH_PKG_DIR" && tar --use-compress-program=zstd -cf "$ARCH_PKG_FILE" . 2>/dev/null ) || \
    ( cd "$ARCH_PKG_DIR" && tar -cf "${ARCH_PKG_FILE%.zst}" . && zstd -q "${ARCH_PKG_FILE%.zst}" -o "$ARCH_PKG_FILE" && rm "${ARCH_PKG_FILE%.zst}" )

    rm -rf "$ARCH_PKG_DIR"

    if [[ -f "$ARCH_PKG_FILE" ]]; then
      success "Paquet Arch : $ARCH_PKG_FILE ($(du -sh "$ARCH_PKG_FILE" | cut -f1))"
      info "Installation : sudo pacman -U $ARCH_PKG_FILE"
    else
      warn "Construction .pkg.tar.zst echouee (non bloquant)"
    fi
  fi
fi

# ════════════════════════════════════════════════════════════════
# COMPILATION APK Android
# ════════════════════════════════════════════════════════════════
APK_FILE=""; APK_SIGNED_FILE=""
if [[ "$BUILD_APK" == true ]]; then
  step "COMPILATION APK Android"
  info "Duree estimee : 15-40 min"
  info "ANDROID_HOME : $ANDROID_HOME | NDK : $NDK_HOME | JDK : $JAVA_HOME"
  timer_start
  export ANDROID_HOME NDK_HOME ANDROID_NDK_HOME JAVA_HOME ANDROID_SDK_ROOT
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

  # ── Detection de changement de plugins Cargo.toml ─────────────────
  # gen/android n est genere QU UNE SEULE FOIS par "tauri android init".
  # Si des plugins (opener, notification, etc.) sont ajoutes a Cargo.toml
  # APRES cette premiere generation, le pont Kotlin/Gradle pour ces plugins
  # n est JAMAIS cree — ils existent cote Rust mais Android ne sait pas
  # les appeler (notifications muettes, deep links non recus, etc.).
  # On hash Cargo.toml et on force la regeneration si ca a change.
  CARGO_HASH_FILE="$TAURI_DIR/gen/android/.cargo-toml-hash"
  CARGO_HASH_NOW=$(sha256sum "$TAURI_DIR/Cargo.toml" 2>/dev/null | cut -d' ' -f1)
  if [[ -d "$TAURI_DIR/gen/android" ]]; then
    CARGO_HASH_OLD=$(cat "$CARGO_HASH_FILE" 2>/dev/null || echo "")
    if [[ "$CARGO_HASH_NOW" != "$CARGO_HASH_OLD" ]]; then
      warn "Cargo.toml a change depuis la derniere generation Android"
      warn "Regeneration de gen/android pour reconnecter les plugins (opener, notification, etc.)"
      rm -rf "$TAURI_DIR/gen/android"
    fi
  fi

  # Init Android (premiere fois ou apres changement de plugins)
  if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
    info "Initialisation/regeneration projet Android..."
    LOG_INIT="/tmp/beartify-android-init-$(date +%s).log"
    set +e; npm run tauri android init 2>&1 | tee "$LOG_INIT"; INIT_EXIT=${PIPESTATUS[0]}; set -e
    [[ "$INIT_EXIT" -eq 0 ]] || { error "tauri android init echoue"; tail -20 "$LOG_INIT"; die "Init Android echoue."; }
    mkdir -p "$TAURI_DIR/gen/android"
    echo "$CARGO_HASH_NOW" > "$CARGO_HASH_FILE"
    success "Projet Android initialise (plugins synchronises avec Cargo.toml)"
  fi

  # ── Restauration des fichiers Kotlin ecrits a la main ─────────────
  # gen/android/app/src/main/java/.../MainActivity.kt et
  # MediaPlaybackService.kt sont regeneres par "tauri android init"
  # (template par defaut, sans nos ajouts : chien de garde, permission
  # notification runtime, bridge BeartifyNative, foreground service...).
  # Toute modification manuelle faite directement dans gen/android est
  # donc perdue a chaque regeneration (declenchee par un changement de
  # Cargo.toml, cf. bloc juste au-dessus) — c'est la cause des mysterieux
  # "retours en arriere" sur ces deux fichiers constates plusieurs fois.
  # On garde donc les versions maintenues ICI, hors de gen/ (qui peut etre
  # supprime a tout moment), et on les recopie a CHAQUE build, pas
  # seulement lors d'une regeneration — au cas ou elles auraient ete
  # ecrasees par un autre moyen entre deux runs.
  KOTLIN_OVERRIDES_DIR="$TAURI_DIR/android-kotlin-overrides"
  KOTLIN_DEST_DIR="$TAURI_DIR/gen/android/app/src/main/java/org/beartify/player"
  if [[ -d "$KOTLIN_OVERRIDES_DIR" ]]; then
    for KT_FILE in "$KOTLIN_OVERRIDES_DIR"/*.kt; do
      [[ -f "$KT_FILE" ]] || continue
      KT_NAME=$(basename "$KT_FILE")
      cp "$KT_FILE" "$KOTLIN_DEST_DIR/$KT_NAME"
      success "Restaure : $KT_NAME (depuis android-kotlin-overrides/)"
    done
  else
    warn "android-kotlin-overrides/ introuvable — MainActivity.kt et MediaPlaybackService.kt"
    warn "restent ceux du template Tauri par defaut (chien de garde, permission"
    warn "notification et bridge BeartifyNative absents). Cree ce dossier a cote"
    warn "de Cargo.toml avec tes versions maintenues de ces fichiers."
  fi

  # ── Garantit les permissions notification/foreground apres regeneration ──
  # NE TOUCHE JAMAIS aux intent-filter deep-link : Tauri les genere seul,
  # un ajout manuel cree des doublons qui cassent la resolution d intent.
  ANDROID_MANIFEST="$TAURI_DIR/gen/android/app/src/main/AndroidManifest.xml"
  if [[ -f "$ANDROID_MANIFEST" ]]; then
    MANIFEST_CHANGED=false
    for PERM in \
      "android.permission.POST_NOTIFICATIONS" \
      "android.permission.FOREGROUND_SERVICE" \
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
    do
      if ! grep -q "$PERM" "$ANDROID_MANIFEST"; then
        sed -i "0,/<application/s//<uses-permission android:name=\"$PERM\" \/>\n    <application/" "$ANDROID_MANIFEST"
        MANIFEST_CHANGED=true
      fi
    done
    [[ "$MANIFEST_CHANGED" == true ]] && success "Permissions notification/foreground ajoutees au manifest" \
      || info "Permissions notification/foreground deja presentes"
  fi

  # Injection icones Beartify dans les mipmap Android
  info "Injection icones Beartify dans les mipmap Android..."
  if ! command -v convert &>/dev/null; then
    info "Installation ImageMagick..."
    if [[ "$DISTRO" == "debian" ]]; then
      sudo apt-get install -y --no-install-recommends imagemagick >/dev/null 2>&1 || true
    elif [[ "$DISTRO" == "arch" ]]; then
      sudo pacman -S --noconfirm --needed imagemagick >/dev/null 2>&1 || true
    fi
  fi

  MIPMAP_BASE="$TAURI_DIR/gen/android/app/src/main/res"
  ICON_SOURCE="$TAURI_DIR/icons/icon.png"
  declare -A MIPMAP_SIZES=( [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
  ALL_MIPMAP_OK=true

  for DENSITY in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
    SIZE="${MIPMAP_SIZES[$DENSITY]}"
    DEST_DIR="$MIPMAP_BASE/mipmap-${DENSITY}"
    mkdir -p "$DEST_DIR"
    for VARIANT in ic_launcher ic_launcher_round ic_launcher_foreground; do
      DEST="$DEST_DIR/${VARIANT}.png"
      if command -v convert &>/dev/null; then
        convert "$ICON_SOURCE" -resize "${SIZE}x${SIZE}" "$DEST" 2>/dev/null \
          || { cp "$ICON_SOURCE" "$DEST" 2>/dev/null || true; }
      else
        cp "$ICON_SOURCE" "$DEST" 2>/dev/null || { warn "Copie echouee : $DEST"; ALL_MIPMAP_OK=false; }
      fi
    done
  done

  # ic_launcher_background (fond blanc pour icone adaptative)
  for DENSITY in mdpi hdpi xhdpi xxhdpi xxxhdpi anydpi-v26; do
    BG_DIR="$MIPMAP_BASE/mipmap-${DENSITY}"
    mkdir -p "$BG_DIR"
    cat > "$BG_DIR/ic_launcher_background.xml" << 'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#FFFFFF"/>
</shape>
XMLEOF
  done

  # Icone adaptative Android 8+ (anydpi-v26)
  ANYDPI_DIR="$MIPMAP_BASE/mipmap-anydpi-v26"
  mkdir -p "$ANYDPI_DIR"
  for VARIANT in ic_launcher ic_launcher_round; do
    cat > "$ANYDPI_DIR/${VARIANT}.xml" << 'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XMLEOF
  done

  [[ "$ALL_MIPMAP_OK" == true ]] \
    && success "Icones Beartify injectees dans tous les mipmap Android" \
    || warn "Certaines icones n ont pas pu etre injectees"

  # Compilation APK
  LOG="/tmp/beartify-apk-$(date +%s).log"
  info "Log : $LOG"

  # Purge les anciens .apk AVANT la compilation : sans ca, "find | head -1"
  # plus bas peut recuperer un fichier d un build precedent (l ordre de
  # find n est pas garanti par date) et signer/livrer un binaire perime
  # sans qu aucune erreur ne le signale.
  OLD_APK_COUNT=$(find "$TAURI_DIR/gen/android" -path "*/build/outputs/apk/*" -name "*.apk" 2>/dev/null | wc -l)
  if [[ "$OLD_APK_COUNT" -gt 0 ]]; then
    info "Purge de $OLD_APK_COUNT ancien(s) .apk avant compilation..."
    find "$TAURI_DIR/gen/android" -path "*/build/outputs/apk/*" -name "*.apk" -delete 2>/dev/null || true
  fi

  set +e
  if [[ "$DEBUG_MODE" == true ]]; then
    npm run tauri android build -- --apk --debug 2>&1 | tee "$LOG"
  else
    npm run tauri android build -- --apk 2>&1 | tee "$LOG"
  fi
  APK_EXIT=${PIPESTATUS[0]}; set -e

  if [[ "$APK_EXIT" -ne 0 ]]; then
    error "Compilation APK echouee (code $APK_EXIT)"
    warn "Log : $LOG"; die "APK non genere."
  fi

  # IMPORTANT : "find | head -1" ne garantit PAS de recuperer le fichier le
  # plus recent (ordre de parcours du systeme de fichiers, pas la date).
  # On trie explicitement par mtime decroissant pour etre certain de signer
  # le binaire qui vient d etre produit, pas un ancien qui traine.
  APK_FILE=$(find "$TAURI_DIR/gen/android" -name "*release-unsigned*.apk" -printf '%T@ %p\n' 2>/dev/null \
             | sort -rn | head -1 | cut -d' ' -f2-)
  if [[ -z "$APK_FILE" ]]; then
    APK_FILE=$(find "$TAURI_DIR/gen/android" -name "*.apk" -printf '%T@ %p\n' 2>/dev/null \
               | sort -rn | head -1 | cut -d' ' -f2-)
  fi
  [[ -n "$APK_FILE" ]] || die ".apk introuvable"
  info "APK selectionne (le plus recent) : $APK_FILE"
  info "Date de modification : $(date -r "$APK_FILE" '+%Y-%m-%d %H:%M:%S')"
  success "APK brut : $APK_FILE ($(du -sh "$APK_FILE" | cut -f1))"

  # ── SIGNATURE APK ─────────────────────────────────────────────
  if [[ "$SIGN_APK" == true ]]; then
    step "SIGNATURE APK"
    info "Keystore : $KEYSTORE_PATH"
    info "Alias    : $KEYSTORE_ALIAS"

    APK_DIR="$(dirname "$APK_FILE")"
    APK_ALIGNED="${APK_DIR}/beartify-aligned.apk"
    APP_VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_ROOT/package.json'))['version'])" 2>/dev/null || echo "1.0.0")
    APK_SIGNED_FILE="${APK_DIR}/Beartify_${APP_VERSION}_universal-signed.apk"

    APKSIGNER="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}/apksigner"
    ZIPALIGN="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}/zipalign"
    [[ -x "$APKSIGNER" ]] || APKSIGNER=$(command -v apksigner 2>/dev/null || true)
    [[ -x "$ZIPALIGN"  ]] || ZIPALIGN=$(command -v zipalign 2>/dev/null || true)
    [[ -x "$APKSIGNER" ]] || die "apksigner introuvable dans $ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS"
    [[ -x "$ZIPALIGN"  ]] || die "zipalign introuvable dans $ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS"

    info "Alignement zipalign..."
    # -f : force l ecrasement si le fichier existe deja (build precedent)
    # sans -v : zipalign retourne 1 avec -v quand l APK necessite un alignement (normal)
    "$ZIPALIGN" -f -p 4 "$APK_FILE" "$APK_ALIGNED" 2>/dev/null
    [[ -f "$APK_ALIGNED" ]] || die "zipalign n a pas produit de fichier : $APK_ALIGNED"
    success "APK aligne : $APK_ALIGNED"

    info "Signature apksigner (v2 / v3)..."
    "$APKSIGNER" sign \
      --ks            "$KEYSTORE_PATH" \
      --ks-key-alias  "$KEYSTORE_ALIAS" \
      --ks-pass       "pass:${KEYSTORE_PASS}" \
      --key-pass      "pass:${KEY_PASS}" \
      --out           "$APK_SIGNED_FILE" \
      "$APK_ALIGNED" \
      || die "apksigner a echoue. Verifiez SIGN_KS_PASS en haut du script."

    info "Verification de la signature..."
    "$APKSIGNER" verify --verbose "$APK_SIGNED_FILE" 2>&1 | head -10 || warn "Verification incomplete (non bloquant)"
    success "APK signe : $APK_SIGNED_FILE ($(du -sh "$APK_SIGNED_FILE" | cut -f1))"

    rm -f "$APK_ALIGNED"
  fi

  timer_end
fi

# ── Resume ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   Compilation terminee avec succes !${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
[[ -n "$APPIMAGE_FILE"  ]] && echo -e "  ${GREEN}AppImage${NC}   : $APPIMAGE_FILE"
[[ -n "$DEB_FILE"       ]] && echo -e "  ${GREEN}.deb    ${NC}   : $DEB_FILE"
ARCH_PKG_FILE_FINAL=$(find "${TAURI_DIR}/target/release/bundle" -name "*.pkg.tar.zst" 2>/dev/null | tail -1 || true)
[[ -n "$ARCH_PKG_FILE_FINAL" ]] && echo -e "  ${GREEN}.pkg    ${NC}   : $ARCH_PKG_FILE_FINAL"
if [[ -n "$APK_FILE" ]]; then
  if [[ -n "$APK_SIGNED_FILE" ]]; then
    echo -e "  ${GREEN}APK signe${NC}  : $APK_SIGNED_FILE"
  else
    echo -e "  ${GREEN}APK brut${NC}   : $APK_FILE"
    warn "APK non signe — relancez sans --no-sign pour signer automatiquement."
  fi
fi
echo ""
echo "  DevTools : F12 / Ctrl+Shift+I dans l application"
if [[ "$DISTRO" == "arch" && -n "$ARCH_PKG_FILE_FINAL" ]]; then
  echo ""
  echo -e "  ${CYAN}Installation Arch Linux :${NC}"
  echo -e "    sudo pacman -U $ARCH_PKG_FILE_FINAL"
fi
echo ""
echo "  RAPPELS :"
echo "  1. Firebase Console -> Auth -> Authorized domains -> tauri://localhost"
echo "  2. Discord Dev Portal -> OAuth2 -> Redirects -> tauri://localhost"
echo "  3. URL proxy (si pas localhost:3000) : Parametres -> Serveur dans l app"
echo ""
