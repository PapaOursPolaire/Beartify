#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — deploy-drm.sh  v4  (HLS FLAC + AES-128 + Honeypot 1/2)
#
#  Usage :
#   sudo bash deploy-drm.sh
#   sudo bash deploy-drm.sh --honeypot-audio /opt/rickroll.mp3
#   sudo bash deploy-drm.sh --honeypot-every 2   (1 sur 3 au lieu de 1 sur 2)
#   sudo bash deploy-drm.sh --reinstall
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $*${NC}"; }
info() { echo -e "${CYAN}ℹ️   $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $*${NC}"; }
fail() { echo -e "${RED}❌  $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }

INSTALL_DIR="/opt/beartify-drm"
SERVICE_NAME="beartify-drm"
SERVICE_USER="www-data"
DRM_PORT="3001"
JELLYFIN_HOST="127.0.0.1"
JELLYFIN_PORT="8096"
JELLYFIN_TOKEN="aaa8a7df4b364cf7bcc76f351d768798"
HONEYPOT_AUDIO=""
HONEYPOT_EVERY="1"
REINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --jellyfin-token)  JELLYFIN_TOKEN="$2"; shift 2 ;;
    --jellyfin-host)   JELLYFIN_HOST="$2";  shift 2 ;;
    --jellyfin-port)   JELLYFIN_PORT="$2";  shift 2 ;;
    --port)            DRM_PORT="$2";        shift 2 ;;
    --honeypot-audio)  HONEYPOT_AUDIO="$2"; shift 2 ;;
    --honeypot-every)  HONEYPOT_EVERY="$2"; shift 2 ;;
    --reinstall)       REINSTALL=true;       shift   ;;
    *) warn "Argument inconnu : $1"; shift ;;
  esac
done

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗"
echo -e "║   BEARTIFY DRM v4 — HLS FLAC + AES-128 + Honeypot 1/2   ║"
echo -e "╚══════════════════════════════════════════════════════════╝${NC}\n"

# ── 0. Root ───────────────────────────────────────────────────────────
step "Vérification des permissions"
[[ $EUID -eq 0 ]] || fail "Exécuter avec sudo."
ok "Exécution en root"

# ── 1. Prérequis ──────────────────────────────────────────────────────
step "Vérification des prérequis"
command -v node      >/dev/null 2>&1 || fail "Node.js requis : curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt install -y nodejs"
command -v npm       >/dev/null 2>&1 || fail "npm requis"
command -v ffmpeg    >/dev/null 2>&1 || fail "ffmpeg requis : apt install -y ffmpeg"
command -v systemctl >/dev/null 2>&1 || fail "systemd requis"

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
[[ $NODE_MAJOR -ge 18 ]] || fail "Node.js >= 18 requis (actuel : $(node --version))"

# Vérifier que ffmpeg supporte FLAC + fMP4
if ! ffmpeg -formats 2>/dev/null | grep -q fmp4; then
  warn "ffmpeg : format fmp4 non détecté — vérifier la version (>= 4.0)"
fi

ok "Node.js $(node --version)"
ok "npm $(npm --version)"
ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
ok "FLAC fMP4 HLS disponible"

# ── 2. Réinstallation propre ──────────────────────────────────────────
if $REINSTALL && [[ -d "$INSTALL_DIR" ]]; then
  step "Réinstallation propre"
  systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -rf "$INSTALL_DIR"
  rm -f  "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  ok "Ancienne installation supprimée"
fi

# ── 3. Dossier ────────────────────────────────────────────────────────
step "Création de $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
ok "Dossier : $INSTALL_DIR"

# ── 4. Copie de drm.js ────────────────────────────────────────────────
step "Déploiement de drm.js"
# drm.js doit être dans le même dossier que ce script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/drm.js" ]]; then
  cp "$SCRIPT_DIR/drm.js" "$INSTALL_DIR/drm.js"
  ok "drm.js copié depuis $SCRIPT_DIR"
else
  fail "drm.js introuvable dans $SCRIPT_DIR — copier drm.js à côté de deploy-drm.sh"
fi

# ── 5. package.json ───────────────────────────────────────────────────
step "Écriture de package.json"
cat > "$INSTALL_DIR/package.json" << PKGEOF
{
  "name": "beartify-drm",
  "version": "4.0.0",
  "description": "HLS FLAC + AES-128 + Honeypot DRM Server for Beartify",
  "main": "drm.js",
  "scripts": {
    "start": "node drm.js",
    "dev":   "node --watch drm.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "dotenv":  "^16.4.5"
  }
}
PKGEOF
ok "package.json écrit"

# ── 6. .env ───────────────────────────────────────────────────────────
step "Configuration .env"
ENV_FILE="$INSTALL_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  OLD_SECRET=$(grep '^SESSION_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "$OLD_SECRET" && "$OLD_SECRET" != "CHANGE_ME" ]]; then
    SESSION_SECRET_VAL="$OLD_SECRET"
    warn "SESSION_SECRET conservé (réinstallation)"
  else
    SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    info "Nouveau SESSION_SECRET généré"
  fi
else
  SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  info "SESSION_SECRET généré pour la première fois"
fi

HONEYPOT_LINE=""
[[ -n "$HONEYPOT_AUDIO" ]] && HONEYPOT_LINE="HONEYPOT_AUDIO=${HONEYPOT_AUDIO}"

cat > "$ENV_FILE" << ENVEOF
# BEARTIFY DRM v4 — généré par deploy-drm.sh
# ⚠️  NE JAMAIS COMMITTER CE FICHIER DANS GIT !
SESSION_SECRET=${SESSION_SECRET_VAL}
JELLYFIN_HOST=${JELLYFIN_HOST}
JELLYFIN_PORT=${JELLYFIN_PORT}
JELLYFIN_TOKEN=${JELLYFIN_TOKEN}
PORT=${DRM_PORT}
# HONEYPOT_EVERY=1 → 1 Rick Roll sur 2 segments (50% — défaut)
# HONEYPOT_EVERY=2 → 1 Rick Roll sur 3 segments (33%)
HONEYPOT_EVERY=${HONEYPOT_EVERY}
${HONEYPOT_LINE}
ENVEOF

chmod 600 "$ENV_FILE"
ok ".env créé (chmod 600)"

# ── 7. npm install ────────────────────────────────────────────────────
step "Installation des dépendances npm"
cd "$INSTALL_DIR" && npm install --omit=dev --silent
ok "express + dotenv installés"

# ── 8. Pré-génération des segments Rick Roll ──────────────────────────
if [[ -n "$HONEYPOT_AUDIO" ]]; then
  step "Pré-génération des segments Rick Roll (FLAC fMP4)"
  HONEY_DIR="/tmp/beartify-honeypot"
  mkdir -p "$HONEY_DIR"

  if ls "$HONEY_DIR"/honey*.m4s 2>/dev/null | head -1 | grep -q .; then
    warn "Segments honeypot déjà générés dans $HONEY_DIR — conservés"
  else
    info "Transcodage de $HONEYPOT_AUDIO en segments FLAC fMP4..."
    ffmpeg -i "$HONEYPOT_AUDIO" -vn \
      -c:a flac -ar 44100 -ac 2 \
      -hls_segment_type fmp4 \
      -hls_fmp4_init_filename "$HONEY_DIR/honey_init.mp4" \
      -hls_segment_filename   "$HONEY_DIR/honey%03d.m4s" \
      -hls_time 4 -hls_list_size 0 \
      -y "$HONEY_DIR/honey_playlist.m3u8" 2>/dev/null \
    && ok "$(ls "$HONEY_DIR"/honey*.m4s 2>/dev/null | wc -l) segments Rick Roll générés" \
    || warn "ffmpeg a échoué — les honeypots seront générés au premier démarrage"
  fi
fi

# ── 9. Permissions ────────────────────────────────────────────────────
step "Permissions"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null \
  || warn "Utilisateur $SERVICE_USER introuvable (non bloquant)"
chmod 750 "$INSTALL_DIR"
ok "Permissions appliquées"

# ── 10. Service systemd ───────────────────────────────────────────────
step "Service systemd $SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SVCEOF
[Unit]
Description=Beartify HLS DRM Stream Server v4 (FLAC + Honeypot)
After=network.target jellyfin.service
Wants=jellyfin.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/drm.js
EnvironmentFile=${INSTALL_DIR}/.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=beartify-drm
NoNewPrivileges=true
PrivateTmp=false
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR} /tmp

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl restart "$SERVICE_NAME"
  ok "Service redémarré"
else
  systemctl enable "$SERVICE_NAME"
  systemctl start  "$SERVICE_NAME"
  ok "Service activé et démarré"
fi

# ── 11. Healthcheck ───────────────────────────────────────────────────
step "Vérification du serveur DRM"
echo -n "   Attente du démarrage"
for i in $(seq 1 15); do
  sleep 1; echo -n "."
  if curl -sf "http://127.0.0.1:${DRM_PORT}/health" >/dev/null 2>&1; then
    echo ""
    HEALTH=$(curl -s "http://127.0.0.1:${DRM_PORT}/health")
    ok "Serveur DRM actif : $HEALTH"
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo ""
    warn "Pas de réponse après 15s — vérifier :"
    warn "  journalctl -u $SERVICE_NAME -n 50"
  fi
done

# ── Résumé ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Déploiement terminé !                                    ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════${NC}\n"
echo -e "  📁 Dossier      : $INSTALL_DIR"
echo -e "  🔐 .env         : $ENV_FILE  (chmod 600)"
echo -e "  ⚙️  Service      : $SERVICE_NAME  (auto-démarrage ON)"
echo -e "  🌐 Port         : 127.0.0.1:$DRM_PORT"
echo -e "  🎵 Audio        : FLAC lossless (fMP4 HLS)"
[[ -n "$HONEYPOT_AUDIO" ]] && \
echo -e "  🪤  Honeypot     : Rick Roll — 1 segment sur $((HONEYPOT_EVERY + 1))"
echo -e "\n${BOLD}Commandes utiles :${NC}"
echo -e "  journalctl -u $SERVICE_NAME -f"
echo -e "  systemctl restart $SERVICE_NAME"
echo -e "  curl http://127.0.0.1:$DRM_PORT/health"
echo -e "\n${BOLD}${YELLOW}⚠️  Étape finale — Caddy + script.js :${NC}"
echo -e "  scp Caddyfile.txt user@serveur:/etc/caddy/Caddyfile"
echo -e "  scp script.js     user@serveur:/var/www/html/player/script.js"
echo -e "  caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy\n"
