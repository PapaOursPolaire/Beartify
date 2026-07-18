#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — setup-lastfm-server.sh
#  Installe, configure, lance et automatise (systemd) le module
#  lastfm-server.js (scrobbling Last.fm).
#
#  Usage :
#    chmod +x setup-lastfm-server.sh
#    ./setup-lastfm-server.sh install     # 1ère installation complète
#    ./setup-lastfm-server.sh start       # démarre le service
#    ./setup-lastfm-server.sh stop        # arrête le service
#    ./setup-lastfm-server.sh restart     # redémarre le service
#    ./setup-lastfm-server.sh status      # état du service
#    ./setup-lastfm-server.sh logs        # logs en direct
#    ./setup-lastfm-server.sh uninstall   # retire le service systemd
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration (adapte ces chemins à ton installation) ──────────────
APP_DIR="${BEARTIFY_DIR:-/opt/beartify}"           # dossier contenant drm.js, extensions.js, lastfm-server.js…
ENV_FILE="$APP_DIR/.env"
SERVICE_NAME="beartify-lastfm"
SERVICE_USER="${BEARTIFY_USER:-$(whoami)}"
NODE_BIN="$(command -v node || true)"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Couleurs (désactivées si pas de TTY) ────────────────────────────────
if [ -t 1 ]; then
  C_OK='\033[0;32m'; C_WARN='\033[0;33m'; C_ERR='\033[0;31m'; C_RESET='\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_RESET=''
fi
log()  { echo -e "${C_OK}[lastfm-server]${C_RESET} $*"; }
warn() { echo -e "${C_WARN}[lastfm-server]${C_RESET} $*"; }
err()  { echo -e "${C_ERR}[lastfm-server]${C_RESET} $*" >&2; }

# ── Prérequis ────────────────────────────────────────────────────────
_check_requirements() {
  if [ -z "$NODE_BIN" ]; then
    err "Node.js introuvable dans le PATH. Installe-le avant de continuer."
    exit 1
  fi
  if [ "$(id -u)" -ne 0 ] && [ "${1:-}" = "systemd" ]; then
    err "L'installation du service systemd nécessite sudo/root."
    exit 1
  fi
  if [ ! -d "$APP_DIR" ]; then
    err "Dossier introuvable : $APP_DIR (définis BEARTIFY_DIR si besoin)."
    exit 1
  fi
  if [ ! -f "$APP_DIR/lastfm-server.js" ]; then
    err "lastfm-server.js absent de $APP_DIR — copie-le d'abord dans ce dossier."
    exit 1
  fi
}

# ── Création du .env (clé/secret Last.fm) si absent ─────────────────────
_setup_env() {
  if [ -f "$ENV_FILE" ] && grep -q "LASTFM_API_KEY" "$ENV_FILE" 2>/dev/null; then
    log ".env déjà configuré, on ne le régénère pas (édite-le manuellement si besoin)."
    return
  fi
  log "Configuration de l'API Last.fm (crée une appli sur https://www.last.fm/api/account/create)"
  read -rp "  LASTFM_API_KEY    : " lf_key
  read -rp "  LASTFM_API_SECRET : " lf_secret
  {
    echo "LASTFM_API_KEY=${lf_key}"
    echo "LASTFM_API_SECRET=${lf_secret}"
  } >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Clés enregistrées dans $ENV_FILE (permissions 600)."
}

# ── Vérifie que lastfm-server.js est bien require() dans drm.js ────────
_check_wired() {
  local entry="$APP_DIR/drm.js"
  if [ -f "$entry" ] && ! grep -q "lastfm-server" "$entry"; then
    warn "drm.js ne semble pas require('./lastfm-server')(app) — ajoute cette ligne"
    warn "juste après la ligne équivalente pour extensions.js, sinon les routes"
    warn "/api/lastfm/* et /lastfm-callback ne seront jamais enregistrées."
  fi
}

# ── Génère l'unité systemd ───────────────────────────────────────────────
_write_systemd_unit() {
  log "Écriture de l'unité systemd : $SYSTEMD_UNIT"
  sudo tee "$SYSTEMD_UNIT" > /dev/null <<UNIT
[Unit]
Description=Beartify — serveur principal (inclut le proxy Last.fm)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${APP_DIR}/drm.js
Restart=on-failure
RestartSec=5
# Redémarre aussi si le process reste bloqué trop longtemps
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  log "Unité créée. Active-la avec : $0 start"
}

# ── Sous-commandes ───────────────────────────────────────────────────────
cmd_install() {
  _check_requirements systemd
  _setup_env
  _check_wired
  _write_systemd_unit
  sudo systemctl enable "$SERVICE_NAME"
  log "Installation terminée. Lance avec : $0 start"
}

cmd_start()   { sudo systemctl start   "$SERVICE_NAME"; log "Service démarré.";  cmd_status; }
cmd_stop()    { sudo systemctl stop    "$SERVICE_NAME"; log "Service arrêté."; }
cmd_restart() { sudo systemctl restart "$SERVICE_NAME"; log "Service redémarré."; cmd_status; }
cmd_status()  { sudo systemctl status  "$SERVICE_NAME" --no-pager || true; }
cmd_logs()    { sudo journalctl -u "$SERVICE_NAME" -f -n 100; }

cmd_uninstall() {
  sudo systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "$SYSTEMD_UNIT"
  sudo systemctl daemon-reload
  log "Service systemd retiré (le .env et le code restent en place)."
}

# ── Dispatch ─────────────────────────────────────────────────────────────
case "${1:-}" in
  install)   cmd_install ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  uninstall) cmd_uninstall ;;
  *)
    echo "Usage: $0 {install|start|stop|restart|status|logs|uninstall}"
    echo ""
    echo "  Variables d'environnement optionnelles :"
    echo "    BEARTIFY_DIR   dossier de l'app (défaut: /opt/beartify)"
    echo "    BEARTIFY_USER  utilisateur système du service (défaut: utilisateur courant)"
    exit 1
    ;;
esac
