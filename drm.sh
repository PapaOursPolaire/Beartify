#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — deploy-drm.sh
#  Déploiement automatisé du serveur DRM (drm.js)
#
#  Ce script :
#   1. Vérifie les prérequis (Node.js, npm, systemd)
#   2. Crée le dossier /opt/beartify-drm
#   3. Écrit drm.js et package.json
#   4. Génère SESSION_SECRET dans .env
#   5. Installe les dépendances npm
#   6. Crée et active le service systemd beartify-drm
#   7. Vérifie que le serveur répond sur /health
#
#  Usage :
#   sudo bash deploy-drm.sh
#   sudo bash deploy-drm.sh --jellyfin-token <TOKEN>  (surcharge le token)
#   sudo bash deploy-drm.sh --reinstall               (réinstalle proprement)
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Couleurs ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅  $*${NC}"; }
info() { echo -e "${CYAN}ℹ️   $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $*${NC}"; }
fail() { echo -e "${RED}❌  $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }

# ── Valeurs par défaut ────────────────────────────────────────────────
INSTALL_DIR="/opt/beartify-drm"
SERVICE_NAME="beartify-drm"
SERVICE_USER="www-data"
DRM_PORT="3001"
JELLYFIN_HOST="127.0.0.1"
JELLYFIN_PORT="8096"
JELLYFIN_TOKEN="aaa8a7df4b364cf7bcc76f351d768798"
REINSTALL=false

# ── Parsing des arguments ─────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --jellyfin-token) JELLYFIN_TOKEN="$2"; shift 2 ;;
    --jellyfin-host)  JELLYFIN_HOST="$2";  shift 2 ;;
    --jellyfin-port)  JELLYFIN_PORT="$2";  shift 2 ;;
    --port)           DRM_PORT="$2";       shift 2 ;;
    --dir)            INSTALL_DIR="$2";    shift 2 ;;
    --user)           SERVICE_USER="$2";   shift 2 ;;
    --reinstall)      REINSTALL=true;      shift   ;;
    *) warn "Argument inconnu : $1"; shift ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════╗"
echo -e "║   BEARTIFY DRM — Déploiement automatisé  ║"
echo -e "╚══════════════════════════════════════════╝${NC}\n"

# ── 0. Vérification root ──────────────────────────────────────────────
step "Vérification des permissions"
[[ $EUID -eq 0 ]] || fail "Ce script doit être exécuté avec sudo."
ok "Exécution en root"

# ── 1. Vérification des prérequis ─────────────────────────────────────
step "Vérification des prérequis"

command -v node >/dev/null 2>&1 || fail "Node.js non trouvé. Installer avec : curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt install -y nodejs"
command -v npm  >/dev/null 2>&1 || fail "npm non trouvé."

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
ok "Node.js $NODE_VER"
ok "npm $NPM_VER"

# Node >= 18 requis pour crypto.subtle natif
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
[[ $NODE_MAJOR -ge 18 ]] || fail "Node.js >= 18 requis (actuel : $NODE_VER)"

command -v systemctl >/dev/null 2>&1 || fail "systemd non disponible."
ok "systemd disponible"

# ── 2. Réinstallation propre si demandée ─────────────────────────────
if $REINSTALL && [[ -d "$INSTALL_DIR" ]]; then
  step "Réinstallation — suppression de l'ancienne installation"
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl stop "$SERVICE_NAME"
    ok "Service $SERVICE_NAME arrêté"
  fi
  if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl disable "$SERVICE_NAME"
  fi
  rm -rf "$INSTALL_DIR"
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  ok "Ancienne installation supprimée"
fi

# ── 3. Création du dossier d'installation ────────────────────────────
step "Création du dossier $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
ok "Dossier créé : $INSTALL_DIR"

# ── 4. Écriture de drm.js ─────────────────────────────────────────────
step "Écriture de drm.js"
cat > "$INSTALL_DIR/drm.js" << 'DRMEOF'
// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  (Secure Stream Server)
//  Node.js / Express — écoute sur 127.0.0.1 uniquement
//
//  GET /api/drm/session/:id   → clé AES-256 + token HMAC (TTL 10min)
//  GET /api/drm/stream/:id?s= → chiffre le flux Jellyfin AES-256-CTR
//  GET /health                → { status: "ok", sessions: N }
// ══════════════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();

const express = require('express');
const http    = require('http');
const crypto  = require('crypto');

const PORT           = parseInt(process.env.PORT          || '3001', 10);
const JELLYFIN_HOST  = process.env.JELLYFIN_HOST          || '127.0.0.1';
const JELLYFIN_PORT  = parseInt(process.env.JELLYFIN_PORT || '8096', 10);
const JELLYFIN_TOKEN = process.env.JELLYFIN_TOKEN         || '';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error('❌  SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt < now) sessions.delete(token);
  }
}, 5 * 60 * 1000);

function clientIp(req) {
  const raw = req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
}

const app = express();

// ── Session DRM ───────────────────────────────────────────────────────
app.get('/api/drm/session/:id', (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: 'ID invalide' });

  const ip        = clientIp(req);
  const key       = crypto.randomBytes(32);
  const iv        = crypto.randomBytes(16);
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const payload   = `${itemId}|${ip}|${expiresAt}`;
  const sig       = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const token     = `${expiresAt}.${sig}`;

  sessions.set(token, { itemId, key, iv, ip, expiresAt });

  res.setHeader('Cache-Control', 'no-store');
  res.json({ sessionToken: token, key: key.toString('hex'), iv: iv.toString('hex') });
});

// ── Stream chiffré ────────────────────────────────────────────────────
app.get('/api/drm/stream/:id', async (req, res) => {
  const itemId = req.params.id;
  const token  = req.query.s;

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  const sess = sessions.get(token);
  if (!sess)              return res.status(401).json({ error: 'Session inconnue ou expirée' });
  if (Date.now() > sess.expiresAt) { sessions.delete(token); return res.status(401).json({ error: 'Session expirée' }); }
  if (sess.itemId !== itemId)      return res.status(403).json({ error: 'Token non valide pour cet item' });

  const reqIp = clientIp(req);
  if (sess.ip !== reqIp) {
    console.warn(`[DRM] IP mismatch session=${sess.ip} req=${reqIp}`);
    return res.status(403).json({ error: 'IP non autorisée' });
  }

  sessions.delete(token); // usage unique

  const params = new URLSearchParams();
  params.set('static',  'true');
  params.set('api_key', JELLYFIN_TOKEN);
  if (req.query.MaxStreamingBitrate) params.set('MaxStreamingBitrate', req.query.MaxStreamingBitrate);
  if (req.query.AudioBitRate)        params.set('AudioBitRate',        req.query.AudioBitRate);

  try {
    const audioBuffer = await new Promise((resolve, reject) => {
      const jellyReq = http.request({
        hostname: JELLYFIN_HOST, port: JELLYFIN_PORT,
        path: `/Audio/${itemId}/stream?${params}`,
        method: 'GET',
        headers: { 'X-Emby-Token': JELLYFIN_TOKEN },
      }, (jellyRes) => {
        res.setHeader('X-Audio-Type', jellyRes.headers['content-type'] || 'audio/mpeg');
        const chunks = [];
        jellyRes.on('data', c => chunks.push(c));
        jellyRes.on('end',  () => resolve(Buffer.concat(chunks)));
        jellyRes.on('error', reject);
      });
      jellyReq.on('error', reject);
      jellyReq.end();
    });

    const cipher    = crypto.createCipheriv('aes-256-ctr', sess.key, sess.iv);
    const encrypted = Buffer.concat([cipher.update(audioBuffer), cipher.final()]);

    res.setHeader('Content-Type',           'application/octet-stream');
    res.setHeader('Content-Length',          encrypted.length);
    res.setHeader('Cache-Control',           'no-store, no-cache, private');
    res.setHeader('Content-Disposition',     'inline');
    res.setHeader('X-Content-Type-Options',  'nosniff');
    res.end(encrypted);

  } catch (err) {
    console.error('[DRM] Erreur stream Jellyfin:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Erreur upstream' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', sessions: sessions.size }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Beartify DRM Server sur 127.0.0.1:${PORT}`);
});
DRMEOF
ok "drm.js écrit"

# ── 5. Écriture de package.json ───────────────────────────────────────
step "Écriture de package.json"
cat > "$INSTALL_DIR/package.json" << PKGEOF
{
  "name": "beartify-drm",
  "version": "2.0.0",
  "description": "DRM Stream Server — AES-256-CTR encryption for Beartify",
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

# ── 6. Génération / conservation du .env ─────────────────────────────
step "Configuration .env"
ENV_FILE="$INSTALL_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Récupérer l'ancien secret pour ne pas le régénérer à chaque réinstall
  OLD_SECRET=$(grep '^SESSION_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "$OLD_SECRET" && "$OLD_SECRET" != "CHANGE_ME" ]]; then
    SESSION_SECRET_VAL="$OLD_SECRET"
    warn ".env existant détecté → SESSION_SECRET conservé"
  else
    SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    info "Nouveau SESSION_SECRET généré"
  fi
else
  SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  info "SESSION_SECRET généré pour la première fois"
fi

cat > "$ENV_FILE" << ENVEOF
# ══════════════════════════════════════════════════════
#  BEARTIFY DRM Server — Variables d'environnement
#  Généré automatiquement par deploy-drm.sh
#  ⚠️  Ne jamais committer ce fichier dans git !
# ══════════════════════════════════════════════════════

SESSION_SECRET=${SESSION_SECRET_VAL}

JELLYFIN_HOST=${JELLYFIN_HOST}
JELLYFIN_PORT=${JELLYFIN_PORT}
JELLYFIN_TOKEN=${JELLYFIN_TOKEN}
PORT=${DRM_PORT}
ENVEOF

chmod 600 "$ENV_FILE"
ok ".env créé avec permissions 600 (lecture root uniquement)"

# ── 7. Installation des dépendances npm ──────────────────────────────
step "Installation des dépendances npm"
cd "$INSTALL_DIR"
npm install --omit=dev --silent
ok "Dépendances installées (express, dotenv)"

# ── 8. Permissions du dossier ────────────────────────────────────────
step "Application des permissions"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null \
  || warn "Utilisateur $SERVICE_USER introuvable — permissions inchangées (non bloquant)"
chmod 750 "$INSTALL_DIR"
ok "Permissions appliquées sur $INSTALL_DIR"

# ── 9. Création du service systemd ────────────────────────────────────
step "Création du service systemd $SERVICE_NAME"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

cat > "$SERVICE_FILE" << SVCEOF
[Unit]
Description=Beartify DRM Stream Server
Documentation=https://github.com/beartify
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

# Sécurité systemd
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
SVCEOF

ok "Fichier service créé : $SERVICE_FILE"

# ── 10. Activation et démarrage du service ────────────────────────────
step "Activation et démarrage du service"
systemctl daemon-reload

# Si le service tournait déjà, le redémarrer ; sinon l'activer + démarrer
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl restart "$SERVICE_NAME"
  ok "Service redémarré"
else
  systemctl enable "$SERVICE_NAME"
  systemctl start  "$SERVICE_NAME"
  ok "Service activé et démarré"
fi

# ── 11. Vérification de santé ─────────────────────────────────────────
step "Vérification du serveur DRM"
echo -n "   Attente du démarrage"
for i in $(seq 1 10); do
  sleep 1
  echo -n "."
  if curl -sf "http://127.0.0.1:${DRM_PORT}/health" >/dev/null 2>&1; then
    echo ""
    HEALTH=$(curl -s "http://127.0.0.1:${DRM_PORT}/health")
    ok "Serveur DRM répond : $HEALTH"
    break
  fi
  if [[ $i -eq 10 ]]; then
    echo ""
    warn "Le serveur ne répond pas encore. Vérifier avec : journalctl -u $SERVICE_NAME -n 30"
  fi
done

# ── 12. Récapitulatif ─────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Déploiement terminé avec succès !        ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}\n"

echo -e "${BOLD}Résumé :${NC}"
echo -e "  📁 Dossier        : $INSTALL_DIR"
echo -e "  🔐 .env           : $ENV_FILE  (chmod 600)"
echo -e "  ⚙️  Service        : $SERVICE_NAME  (auto-démarrage activé)"
echo -e "  🌐 Port           : 127.0.0.1:$DRM_PORT  (loopback uniquement)"
echo -e "  🎵 Jellyfin       : $JELLYFIN_HOST:$JELLYFIN_PORT"

echo -e "\n${BOLD}Commandes utiles :${NC}"
echo -e "  systemctl status  $SERVICE_NAME"
echo -e "  journalctl -u     $SERVICE_NAME -f"
echo -e "  systemctl restart $SERVICE_NAME"
echo -e "  curl http://127.0.0.1:$DRM_PORT/health"

echo -e "\n${BOLD}${YELLOW}⚠️  Prochaine étape :${NC}"
echo -e "  Mettre à jour Caddy avec le snippet (drm_routes)"
echo -e "  puis : caddy validate && systemctl reload caddy\n"
