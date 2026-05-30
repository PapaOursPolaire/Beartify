#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — deploy-drm.sh  (HLS + AES-128 + Honeypot)
#
#  Usage :
#   sudo bash deploy-drm.sh
#   sudo bash deploy-drm.sh --jellyfin-token <TOKEN>
#   sudo bash deploy-drm.sh --honeypot-audio /path/to/audio.mp3
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
HONEYPOT_EVERY="3"
REINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --jellyfin-token)  JELLYFIN_TOKEN="$2";  shift 2 ;;
    --jellyfin-host)   JELLYFIN_HOST="$2";   shift 2 ;;
    --jellyfin-port)   JELLYFIN_PORT="$2";   shift 2 ;;
    --port)            DRM_PORT="$2";         shift 2 ;;
    --honeypot-audio)  HONEYPOT_AUDIO="$2";  shift 2 ;;
    --honeypot-every)  HONEYPOT_EVERY="$2";  shift 2 ;;
    --reinstall)       REINSTALL=true;        shift   ;;
    *) warn "Argument inconnu : $1"; shift ;;
  esac
done

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗"
echo -e "║   BEARTIFY DRM — HLS + AES-128 + Honeypot            ║"
echo -e "╚══════════════════════════════════════════════════════╝${NC}\n"

# ── 0. Root ───────────────────────────────────────────────────────────
step "Vérification des permissions"
[[ $EUID -eq 0 ]] || fail "Exécuter avec sudo."
ok "Exécution en root"

# ── 1. Prérequis ──────────────────────────────────────────────────────
step "Vérification des prérequis"
command -v node     >/dev/null 2>&1 || fail "Node.js requis : curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt install -y nodejs"
command -v npm      >/dev/null 2>&1 || fail "npm requis"
command -v ffmpeg   >/dev/null 2>&1 || fail "ffmpeg requis : apt install -y ffmpeg"
command -v systemctl>/dev/null 2>&1 || fail "systemd requis"

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
[[ $NODE_MAJOR -ge 18 ]] || fail "Node.js >= 18 requis (actuel : $(node --version))"

ok "Node.js $(node --version)"
ok "npm $(npm --version)"
ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"

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

# ── 3. Dossier d'installation ─────────────────────────────────────────
step "Création de $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
ok "Dossier : $INSTALL_DIR"

# ── 4. Écriture de drm.js ─────────────────────────────────────────────
step "Écriture de drm.js"
cat > "$INSTALL_DIR/drm.js" << 'DRMEOF'
'use strict';
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const crypto    = require('crypto');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');

const PORT           = parseInt(process.env.PORT          || '3001', 10);
const JELLYFIN_HOST  = process.env.JELLYFIN_HOST          || '127.0.0.1';
const JELLYFIN_PORT  = parseInt(process.env.JELLYFIN_PORT || '8096', 10);
const JELLYFIN_TOKEN = process.env.JELLYFIN_TOKEN         || '';
const SESSION_SECRET = process.env.SESSION_SECRET;
const HONEYPOT_AUDIO = process.env.HONEYPOT_AUDIO         || null;
const HONEYPOT_EVERY = parseInt(process.env.HONEYPOT_EVERY || '3', 10);

if (!SESSION_SECRET) { console.error('❌ SESSION_SECRET manquant'); process.exit(1); }

const sessions = new Map();
let _fakeSegPath = null;

function clientIp(req) {
  return (req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function generateToken(itemId, ip, expiresAt) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${itemId}|${ip}|${expiresAt}`).digest('hex');
  return `${expiresAt}.${sig}`;
}
function validateSession(token, itemId, req) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  if (s.itemId !== itemId || s.ip !== clientIp(req)) return null;
  return s;
}

function generateFakeSegment() {
  return new Promise((resolve) => {
    const outPath = path.join(os.tmpdir(), 'beartify-honeypot.ts');
    const inputArgs = HONEYPOT_AUDIO ? ['-i', HONEYPOT_AUDIO, '-t', '4'] : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'];
    const ff = spawn('ffmpeg', [...inputArgs, '-c:a', 'aac', '-b:a', '32k', '-f', 'mpegts', '-y', outPath], { stdio: 'ignore' });
    ff.on('close', (c) => { if (c === 0) { _fakeSegPath = outPath; console.log('✅ Honeypot généré'); } resolve(); });
    ff.on('error', () => resolve());
  });
}

function startTranscode(itemId, token, tempDir, bitrate) {
  const sess = sessions.get(token);
  if (!sess) return;
  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream?static=true&api_key=${JELLYFIN_TOKEN}`;
  const args = ['-i', jellyUrl, '-vn', '-c:a', 'aac', '-b:a', bitrate ? `${Math.floor(bitrate/1000)}k` : '192k', '-hls_time', '4', '-hls_list_size', '0', '-hls_key_info_file', path.join(tempDir, 'key.keyinfo'), '-hls_segment_filename', path.join(tempDir, 'seg%03d.ts'), '-hls_flags', 'independent_segments', '-y', path.join(tempDir, 'playlist.m3u8')];
  const ff = spawn('ffmpeg', args, { stdio: 'ignore' });
  ff.on('close', (c) => { const s = sessions.get(token); if (s) { s.ready = c === 0; s.ffmpegError = c !== 0 ? `exit ${c}` : null; } });
  ff.on('error', (e) => { const s = sessions.get(token); if (s) s.ffmpegError = e.message; });
}

function buildHoneypotM3u8(rawM3u8, itemId, token, ivHex) {
  const lines = rawM3u8.split('\n');
  const out = [];
  let segIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('#EXT-X-KEY')) {
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="/api/hls/key/${itemId}?s=${encodeURIComponent(token)}",IV=0x${ivHex}`);
      continue;
    }
    if (t.startsWith('#EXTINF')) {
      if (segIndex > 0 && segIndex % HONEYPOT_EVERY === 0) {
        out.push(''); out.push('#EXT-X-BEARTIFY-HONEYPOT');
        out.push('#EXTINF:4.000,'); out.push(`/api/hls/fake/honey_${segIndex}.ts`);
      }
      out.push(lines[i]); i++;
      const segFile = (lines[i] || '').trim();
      if (segFile) out.push(`/api/hls/segment/${itemId}/${path.basename(segFile)}?s=${encodeURIComponent(token)}`);
      segIndex++; continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) {
    if (s.expiresAt < now) {
      sessions.delete(t);
      if (s.tempDir) try { fs.rmSync(s.tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}, 5 * 60 * 1000);

const app = express();

app.get('/api/hls/session/:id', async (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId)) return res.status(400).json({ error: 'ID invalide' });
  const ip = clientIp(req);
  const bitrate = req.query.bitrate ? parseInt(req.query.bitrate, 10) : null;
  const key = crypto.randomBytes(16);
  const iv  = crypto.randomBytes(16);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const token = generateToken(itemId, ip, expiresAt);
  const safeId = token.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const tempDir = path.join(os.tmpdir(), `beartify-${safeId}`);
  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.writeFile(path.join(tempDir, 'key.bin'), key);
    const keyUri  = `/api/hls/key/${itemId}?s=${encodeURIComponent(token)}`;
    await fs.promises.writeFile(path.join(tempDir, 'key.keyinfo'), `${keyUri}\n${path.join(tempDir, 'key.bin')}\n${iv.toString('hex')}`);
    sessions.set(token, { itemId, key, iv: iv.toString('hex'), ip, expiresAt, tempDir, ready: false, ffmpegError: null });
    startTranscode(itemId, token, tempDir, bitrate);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessionToken: token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hls/key/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(s.key);
});

app.get('/api/hls/playlist/:id', async (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).json({ error: 'Session invalide' });
  const deadline = Date.now() + 90_000;
  while (!s.ready && !s.ffmpegError && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
  if (!s.ready) return res.status(500).json({ error: s.ffmpegError || 'Timeout — ffmpeg installé ?' });
  try {
    const raw = await fs.promises.readFile(path.join(s.tempDir, 'playlist.m3u8'), 'utf8');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildHoneypotM3u8(raw, req.params.id, req.query.s, s.iv));
  } catch { res.status(500).json({ error: 'Playlist indisponible' }); }
});

app.get('/api/hls/segment/:id/:seg', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  const seg = req.params.seg;
  if (!/^seg\d{3,6}\.ts$/.test(seg)) return res.status(400).end();
  const segPath = path.join(s.tempDir, seg);
  if (!fs.existsSync(segPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store, private');
  fs.createReadStream(segPath).pipe(res);
});

app.get('/api/hls/fake/:seg', (_req, res) => {
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (_fakeSegPath && fs.existsSync(_fakeSegPath)) fs.createReadStream(_fakeSegPath).pipe(res);
  else res.end(crypto.randomBytes(188 * 100));
});

app.get('/health', (_req, res) => res.json({ status: 'ok', sessions: sessions.size, honeypot: !!_fakeSegPath }));

generateFakeSegment().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Beartify DRM Server → 127.0.0.1:${PORT}`);
    console.log(`   Honeypot : ${_fakeSegPath ? 'son 440Hz' : 'bruit aléatoire'} (1/${HONEYPOT_EVERY} segments)`);
  });
});
DRMEOF
ok "drm.js écrit"

# ── 5. package.json ───────────────────────────────────────────────────
step "Écriture de package.json"
cat > "$INSTALL_DIR/package.json" << PKGEOF
{
  "name": "beartify-drm",
  "version": "3.0.0",
  "description": "HLS + AES-128 + Honeypot DRM Server for Beartify",
  "main": "drm.js",
  "scripts": { "start": "node drm.js", "dev": "node --watch drm.js" },
  "dependencies": { "express": "^4.19.2", "dotenv": "^16.4.5" }
}
PKGEOF
ok "package.json écrit"

# ── 6. .env ───────────────────────────────────────────────────────────
step "Configuration .env"
ENV_FILE="$INSTALL_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  OLD_SECRET=$(grep '^SESSION_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
  if [[ -n "$OLD_SECRET" && "$OLD_SECRET" != "CHANGE_ME" ]]; then
    SESSION_SECRET_VAL="$OLD_SECRET"; warn "SESSION_SECRET conservé"
  else
    SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    info "Nouveau SESSION_SECRET généré"
  fi
else
  SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  info "SESSION_SECRET généré"
fi

HONEYPOT_LINE=""
[[ -n "$HONEYPOT_AUDIO" ]] && HONEYPOT_LINE="HONEYPOT_AUDIO=${HONEYPOT_AUDIO}"

cat > "$ENV_FILE" << ENVEOF
# BEARTIFY DRM — généré par deploy-drm.sh — NE PAS COMMITTER
SESSION_SECRET=${SESSION_SECRET_VAL}
JELLYFIN_HOST=${JELLYFIN_HOST}
JELLYFIN_PORT=${JELLYFIN_PORT}
JELLYFIN_TOKEN=${JELLYFIN_TOKEN}
PORT=${DRM_PORT}
HONEYPOT_EVERY=${HONEYPOT_EVERY}
${HONEYPOT_LINE}
ENVEOF

chmod 600 "$ENV_FILE"
ok ".env créé (chmod 600)"

# ── 7. npm install ────────────────────────────────────────────────────
step "Installation des dépendances npm"
cd "$INSTALL_DIR" && npm install --omit=dev --silent
ok "express + dotenv installés"

# ── 8. Permissions ────────────────────────────────────────────────────
step "Permissions"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null \
  || warn "Utilisateur $SERVICE_USER introuvable (non bloquant)"
chmod 750 "$INSTALL_DIR"
ok "Permissions : $SERVICE_USER"

# ── 9. Service systemd ────────────────────────────────────────────────
step "Service systemd $SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SVCEOF
[Unit]
Description=Beartify HLS DRM Stream Server
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
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR} /tmp

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl restart "$SERVICE_NAME"; ok "Service redémarré"
else
  systemctl enable "$SERVICE_NAME"; systemctl start "$SERVICE_NAME"; ok "Service activé et démarré"
fi

# ── 10. Healthcheck ───────────────────────────────────────────────────
step "Vérification du serveur"
echo -n "   Attente"
for i in $(seq 1 12); do
  sleep 1; echo -n "."
  if curl -sf "http://127.0.0.1:${DRM_PORT}/health" >/dev/null 2>&1; then
    echo ""
    ok "Serveur DRM actif : $(curl -s http://127.0.0.1:${DRM_PORT}/health)"
    break
  fi
  [[ $i -eq 12 ]] && { echo ""; warn "Pas de réponse — vérifier : journalctl -u $SERVICE_NAME -n 30"; }
done

# ── Résumé ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Déploiement terminé !                               ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════${NC}\n"
echo -e "  📁 Dossier     : $INSTALL_DIR"
echo -e "  🔐 .env        : $ENV_FILE  (chmod 600)"
echo -e "  ⚙️  Service     : $SERVICE_NAME  (auto-démarrage ON)"
echo -e "  🌐 Port        : 127.0.0.1:$DRM_PORT"
echo -e "  🎵 Honeypot    : 1 segment faux tous les $HONEYPOT_EVERY vrais\n"
echo -e "${BOLD}Commandes utiles :${NC}"
echo -e "  journalctl -u $SERVICE_NAME -f"
echo -e "  curl http://127.0.0.1:$DRM_PORT/health\n"
echo -e "${BOLD}${YELLOW}⚠️  Étape Caddy :${NC}"
echo -e "  caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy\n"
