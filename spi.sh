#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Beartify — installation de playlist-import-service.js
# ═══════════════════════════════════════════════════════════════════
#  À coller tel quel dans un terminal Cockpit (ou tout shell root/sudo).
#  Crée le service, demande interactivement les identifiants Spotify,
#  installe et démarre un service systemd persistant (redémarre tout
#  seul en cas de crash, et au reboot).
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Authentification sudo (UNE SEULE FOIS) ────────────────────────────
# En collant tout le bloc d'un coup, le terminal Cockpit continue de
# recevoir les lignes suivantes du script pendant que sudo attend le
# mot de passe — ces lignes collées finissent lues comme de mauvaises
# tentatives de mot de passe, d'où le "3 saisies de mots de passe
# incorrectes / disconnected" que tu as eu. On demande donc le mot de
# passe UNE fois ici, tout au début, avant que quoi que ce soit d'autre
# ne soit collé/lu, puis on garde le ticket sudo actif en arrière-plan
# pour que tous les `sudo` suivants passent sans jamais re-demander.
echo "🔑 Mot de passe sudo (une seule fois) :"
sudo -v < /dev/tty
( while true; do sudo -n true; sleep 60; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
SUDO_KEEPALIVE_PID=$!
trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null' EXIT

INSTALL_DIR="/opt/beartify-playlist-import"
SERVICE_USER="${SUDO_USER:-$USER}"
PORT_DEFAULT=4501

echo "═══════════════════════════════════════════════════════════"
echo " Beartify — installation du service d'import de playlists"
echo "═══════════════════════════════════════════════════════════"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé ou pas dans le PATH."
  exit 1
fi
NODE_VERSION="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ requis (fetch natif). Version détectée : $(node -v)."
  exit 1
fi

echo "→ Création de $INSTALL_DIR ..."
sudo mkdir -p "$INSTALL_DIR"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

echo "→ Écriture de playlist-import-service.js ..."
cat > "$INSTALL_DIR/playlist-import-service.js" <<'JSEOF'
#!/usr/bin/env node
'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  Beartify – playlist-import-service.js
 * ═══════════════════════════════════════════════════════════════════
 *  Petit service Node AUTONOME (pas un module à greffer sur server.js,
 *  qui n'est qu'un serveur de test) — il tourne sur son propre port et
 *  expose uniquement les deux routes d'import de playlist. À déployer
 *  en process séparé (pm2/systemd) derrière Caddy, avec sa propre
 *  entrée de reverse-proxy, comme les autres services proxifiés du
 *  projet (Jellyfin, Last.fm, Grizzlyrics).
 *
 *  ── Pourquoi un service séparé plutôt qu'ajouté à un autre serveur ──
 *    • Isolation : un souci ici (quota Spotify, timeout Deezer) ne
 *      peut pas faire tomber le reste de la stack.
 *    • Déployable indépendamment, avec ses propres identifiants et son
 *      propre cycle de vie (redémarrage, logs, monitoring).
 *
 *  ── Pourquoi côté serveur (jamais dans le navigateur) ────────────────
 *    • Spotify : lire une playlist publique nécessite un token d'accès.
 *      Le "Client Credentials Flow" de Spotify permet de l'obtenir SANS
 *      connecter le compte de l'utilisateur — mais il faut un
 *      client_secret, qui ne doit JAMAIS être exposé côté navigateur.
 *    • Deezer : l'API publique (api.deezer.com) ne demande aucune
 *      authentification pour une playlist publique, MAIS elle bloque
 *      les requêtes CORS depuis un navigateur. Un simple relais suffit
 *      ici (pas de secret impliqué, juste un problème de CORS).
 *
 *  ── Démarrage ─────────────────────────────────────────────────────
 *    node playlist-import-service.js
 *    (ou via pm2 : pm2 start playlist-import-service.js --name beartify-playlist-import)
 *
 *  ── Configuration (variables d'environnement) ───────────────────────
 *    PORT                    port d'écoute (def: 4501)
 *    SPOTIFY_CLIENT_ID
 *    SPOTIFY_CLIENT_SECRET   créés gratuitement sur
 *                            https://developer.spotify.com/dashboard —
 *                            le Client Credentials Flow fonctionne dès
 *                            la création de l'app, pas besoin qu'elle
 *                            soit "publiée"
 *    ALLOWED_ORIGIN          origine autorisée en CORS pour l'app web
 *                            Beartify, ex: https://beartify.duckdns.org
 *                            (def: * — à restreindre en production)
 *
 *  ── Exemple de configuration Caddy (reverse-proxy) ──────────────────
 *    handle /api/playlist/* {
 *        reverse_proxy 127.0.0.1:4501
 *    }
 *  Puis dans onboarding.js, PLAYLIST_API_BASE pointe simplement vers
 *  '/api/playlist' (même origine que le site, via ce reverse-proxy) —
 *  ou directement vers l'URL publique de ce service si tu préfères ne
 *  pas passer par Caddy pour celui-ci.
 * ═══════════════════════════════════════════════════════════════════
 */

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 4501;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ── Cache mémoire du token Spotify (valable ~1h) ──────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiresAt = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiresAt) return _spotifyToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET non configurés.');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Auth Spotify a échoué (${res.status})`);
  const data = await res.json();
  _spotifyToken = data.access_token;
  _spotifyTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return _spotifyToken;
}

async function fetchSpotifyPlaylist(playlistId) {
  const token = await getSpotifyToken();
  const plRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.items(track(name,artists(name))),tracks.next`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!plRes.ok) {
    const err = new Error(`Playlist Spotify introuvable ou privée (${plRes.status})`);
    err.status = plRes.status;
    throw err;
  }
  const plData = await plRes.json();

  let items = plData.tracks?.items || [];
  let nextUrl = plData.tracks?.next;

  // Pagination plafonnée à 300 titres (3 pages de 100) — largement
  // suffisant pour l'usage réel, évite un temps de réponse excessif.
  let guard = 0;
  while (nextUrl && guard < 2) {
    const nextRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!nextRes.ok) break;
    const nextData = await nextRes.json();
    items = items.concat(nextData.items || []);
    nextUrl = nextData.next;
    guard++;
  }

  const tracksList = items
    .map(it => it.track)
    .filter(Boolean)
    .map(t => ({ title: t.name, artist: t.artists?.[0]?.name || '' }))
    .filter(t => t.title && t.artist);

  return { name: plData.name || 'Playlist Spotify', tracks: tracksList };
}

async function fetchDeezerPlaylist(playlistId) {
  const dzRes = await fetch(`https://api.deezer.com/playlist/${playlistId}`, { signal: AbortSignal.timeout(10000) });
  if (!dzRes.ok) {
    const err = new Error(`Playlist Deezer introuvable (${dzRes.status})`);
    err.status = dzRes.status;
    throw err;
  }
  const dzData = await dzRes.json();
  if (dzData.error) {
    const err = new Error(dzData.error.message || 'Playlist Deezer introuvable ou privée.');
    err.status = 404;
    throw err;
  }
  const tracksList = (dzData.tracks?.data || [])
    .map(t => ({ title: t.title, artist: t.artist?.name || '' }))
    .filter(t => t.title && t.artist);

  return { name: dzData.title || 'Playlist Deezer', tracks: tracksList };
}

// ── Serveur HTTP minimal (aucune dépendance externe requise) ─────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','playlist','spotify','ID'] ou ['playlist','spotify','ID']

  const platformIdx = parts.indexOf('playlist');
  const platform = platformIdx !== -1 ? parts[platformIdx + 1] : null;
  const playlistId = platformIdx !== -1 ? parts[platformIdx + 2] : null;

  function sendJson(status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  if (url.pathname === '/health') { sendJson(200, { ok: true }); return; }

  if (!platform || !playlistId || !['spotify', 'deezer'].includes(platform)) {
    sendJson(404, { error: 'Route inconnue. Utilise /playlist/spotify/:id ou /playlist/deezer/:id.' });
    return;
  }

  try {
    const data = platform === 'spotify'
      ? await fetchSpotifyPlaylist(playlistId)
      : await fetchDeezerPlaylist(playlistId);
    sendJson(200, data);
  } catch (e) {
    console.error(`[playlist-import] ${platform}:`, e.message);
    sendJson(e.status || 500, { error: e.message || 'Erreur serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`[playlist-import-service] à l'écoute sur le port ${PORT}`);
  console.log(`  GET /playlist/spotify/:id`);
  console.log(`  GET /playlist/deezer/:id`);
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.warn('  ⚠️  SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET non définis — les imports Spotify échoueront.');
  }
});
JSEOF

echo ""
echo "── Configuration Spotify (Client Credentials Flow) ──────────────"
echo "   Crée une app gratuite sur https://developer.spotify.com/dashboard"
echo "   si ce n'est pas déjà fait — pas besoin qu'elle soit \"publiée\"."
echo ""
read -rp "SPOTIFY_CLIENT_ID     : " SPOTIFY_CLIENT_ID < /dev/tty
read -rsp "SPOTIFY_CLIENT_SECRET : " SPOTIFY_CLIENT_SECRET < /dev/tty
echo ""
read -rp "Port d'écoute [$PORT_DEFAULT] : " SERVICE_PORT < /dev/tty
SERVICE_PORT="${SERVICE_PORT:-$PORT_DEFAULT}"
read -rp "Origine autorisée en CORS (ex: https://beartify.duckdns.org) [*] : " ALLOWED_ORIGIN < /dev/tty
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}"

ENV_FILE="$INSTALL_DIR/.env.playlist-import"
echo "→ Écriture de $ENV_FILE ..."
cat > "$ENV_FILE" <<EOF
PORT=$SERVICE_PORT
SPOTIFY_CLIENT_ID=$SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET=$SPOTIFY_CLIENT_SECRET
ALLOWED_ORIGIN=$ALLOWED_ORIGIN
EOF
chmod 600 "$ENV_FILE"

echo "→ Installation du service systemd (persistant, redémarre seul) ..."
sudo tee /etc/systemd/system/beartify-playlist-import.service > /dev/null <<EOF
[Unit]
Description=Beartify - service d'import de playlists Spotify/Deezer
After=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $INSTALL_DIR/playlist-import-service.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now beartify-playlist-import.service

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✅ Service démarré sur le port $SERVICE_PORT."
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Vérifications :"
echo "  systemctl status beartify-playlist-import.service"
echo "  journalctl -u beartify-playlist-import.service -f"
echo "  curl http://127.0.0.1:$SERVICE_PORT/health"
echo ""
echo "N'oublie pas : le Caddyfile fourni à côté route déjà /api/playlist/*"
echo "vers 127.0.0.1:$SERVICE_PORT (snippet playlist_import_proxy) — recharge"
echo "Caddy si ce n'est pas encore fait :"
echo "  sudo systemctl reload caddy"
echo ""
