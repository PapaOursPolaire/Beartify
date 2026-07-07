#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — Installation & configuration complète de PocketBase
#  Remplace : playlists, présence/amis, stats/reports, requests
#  Conserve : Firebase Auth UNIQUEMENT pour la connexion Google
#             (Discord bascule sur vérification native dans PocketBase)
#
#  Testé pour Debian 13 (trixie), à exécuter en root ou via sudo.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# 0. CONFIGURATION — à adapter avant de lancer le script
# ─────────────────────────────────────────────────────────────────────
PB_DIR="/opt/pocketbase"
PB_USER="pocketbase"
PB_PORT="8090"                     # écoute en local uniquement, Caddy fait le proxy
PB_DOMAIN_PATH="/api/pb"           # chemin exposé par Caddy (ex: beartify.duckdns.org/api/pb)

# ⚠️ REMPLACE ceci par le Web Client ID OAuth de ton projet Firebase
# (Firebase Console > Authentification > Sign-in method > Google > Client ID web)
FIREBASE_WEB_CLIENT_ID="REMPLACE_MOI.apps.googleusercontent.com"

# Secret serveur utilisé pour dériver un mot de passe PocketBase déterministe
# par utilisateur (jamais transmis au client). Généré automatiquement si vide.
SERVER_BRIDGE_SECRET="$(openssl rand -hex 32)"

echo "════════════════════════════════════════════════════"
echo " Installation PocketBase pour Beartify"
echo "════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────
# 1. UTILISATEUR SYSTÈME DÉDIÉ (principe de moindre privilège)
# ─────────────────────────────────────────────────────────────────────
if ! id "$PB_USER" &>/dev/null; then
    useradd --system --home "$PB_DIR" --shell /usr/sbin/nologin "$PB_USER"
    echo "✅ Utilisateur système '$PB_USER' créé"
fi

mkdir -p "$PB_DIR"/{pb_data,pb_migrations,pb_hooks,pb_public,backups}

# ─────────────────────────────────────────────────────────────────────
# 2. TÉLÉCHARGEMENT DE LA DERNIÈRE VERSION DE POCKETBASE
# ─────────────────────────────────────────────────────────────────────
echo "→ Récupération de la dernière version de PocketBase..."
LATEST_URL=$(curl -s https://api.github.com/repos/pocketbase/pocketbase/releases/latest \
    | grep "browser_download_url.*linux_amd64.zip" \
    | cut -d '"' -f 4)

if [ -z "$LATEST_URL" ]; then
    echo "❌ Impossible de récupérer l'URL de téléchargement. Vérifie ta connexion réseau/DNS."
    exit 1
fi

curl -L "$LATEST_URL" -o /tmp/pocketbase.zip
apt-get update -qq && apt-get install -y -qq unzip >/dev/null
unzip -o /tmp/pocketbase.zip -d "$PB_DIR"
rm /tmp/pocketbase.zip
chmod +x "$PB_DIR/pocketbase"
echo "✅ Binaire PocketBase installé dans $PB_DIR"

# ─────────────────────────────────────────────────────────────────────
# 3. MIGRATION — CRÉATION DES COLLECTIONS
#    (équivalent des collections Firestore: users, playlists, presence,
#     follows, reports, requests, trackStats, artistStats, albumStats,
#     globalStats)
# ─────────────────────────────────────────────────────────────────────
cat > "$PB_DIR/pb_migrations/1_init_collections.js" << 'MIGRATION_EOF'
migrate((app) => {

  // ── USERS (collection auth) ──────────────────────────────────────
  // L'identité réelle reste gérée par Firebase (Google) ou Discord.
  // Ce compte PocketBase sert uniquement de "session technique" pour
  // que les API rules (owner-only) fonctionnent normalement.
  let users = new Collection({
    type: "auth",
    name: "users",
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null,   // création uniquement via le hook serveur
    updateRule: "id = @request.auth.id",
    deleteRule: null,
    fields: [
      { name: "provider",     type: "select", values: ["google", "discord"], maxSelect: 1 },
      { name: "externalId",   type: "text", required: true },   // email Google ou discordId
      { name: "displayName",  type: "text" },
      { name: "avatarUrl",    type: "url" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_users_externalId ON users (externalId)"
    ],
  })
  app.save(users)

  // ── PLAYLISTS ─────────────────────────────────────────────────────
  let playlists = new Collection({
    type: "base",
    name: "playlists",
    listRule:   "user = @request.auth.id || (private = false)",
    viewRule:   "user = @request.auth.id || (private = false)",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    fields: [
      { name: "user",        type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "name",        type: "text", required: true, max: 200 },
      { name: "description", type: "text", max: 1000 },
      { name: "tracks",      type: "json" },       // tableau normalisé, comme côté Firestore
      { name: "coverUrl",    type: "text" },        // dataURL base64 ou URL — text pour accepter les gros base64
      { name: "private",     type: "bool" },
    ],
  })
  app.save(playlists)

  // ── PRESENCE (remplace firebase-sync.js + friends-panel.js) ───────
  let presence = new Collection({
    type: "base",
    name: "presence",
    listRule:   "@request.auth.id != ''",   // lecture ouverte aux users connectés (liste d'amis)
    viewRule:   "@request.auth.id != ''",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    fields: [
      { name: "user",      type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "status",    type: "select", values: ["playing", "paused", "offline"], maxSelect: 1 },
      { name: "track",     type: "json" },
      { name: "position",  type: "number" },
      { name: "updatedAt", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_presence_user ON presence (user)"
    ],
  })
  app.save(presence)

  // ── FOLLOWS (remplace le système following/followers de firebase-social.js) ──
  let follows = new Collection({
    type: "base",
    name: "follows",
    listRule:   "follower = @request.auth.id || following = @request.auth.id",
    viewRule:   "follower = @request.auth.id || following = @request.auth.id",
    createRule: "follower = @request.auth.id",
    updateRule: null,
    deleteRule: "follower = @request.auth.id",
    fields: [
      { name: "follower",  type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "following", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_follows_pair ON follows (follower, following)"
    ],
  })
  app.save(follows)

  // ── REPORTS ────────────────────────────────────────────────────────
  let reports = new Collection({
    type: "base",
    name: "reports",
    listRule:   null,   // admin uniquement (via console PocketBase)
    viewRule:   "user = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user",        type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "type",        type: "text" },
      { name: "category",    type: "text" },
      { name: "description", type: "text", max: 5000 },
      { name: "status",      type: "select", values: ["pending", "reviewed", "closed"], maxSelect: 1 },
      { name: "meta",        type: "json" },
    ],
  })
  app.save(reports)

  // ── REQUESTS (demandes d'ajout, avec votes) ────────────────────────
  let requests = new Collection({
    type: "base",
    name: "requests",
    listRule:   "@request.auth.id != ''",
    viewRule:   "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: null,
    fields: [
      { name: "type",   type: "text", required: true },
      { name: "name",   type: "text", required: true },
      { name: "artist", type: "text" },
      { name: "info",   type: "text" },
      { name: "status", type: "select", values: ["pending", "added", "rejected"], maxSelect: 1 },
      { name: "votes",  type: "number" },
      { name: "voters", type: "json" },
    ],
  })
  app.save(requests)

  // ── STATS (trackStats / artistStats / albumStats / globalStats) ───
  // PocketBase n'a pas d'équivalent direct à FieldValue.increment() ;
  // l'incrément se fait via le hook serveur (voir pb_hooks) en lecture-
  // modification-écriture protégée par une transaction SQLite.
  let trackStats = new Collection({
    type: "base", name: "trackStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "trackKey",    type: "text", required: true },
      { name: "title",       type: "text" },
      { name: "artist",      type: "text" },
      { name: "album",       type: "text" },
      { name: "imageUrl",    type: "text" },
      { name: "plays",       type: "number" },
      { name: "playsToday",  type: "number" },
      { name: "lastPlayedAt", type: "date" },
      { name: "lastDate",    type: "text" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_trackStats_key ON trackStats (trackKey)"],
  })
  app.save(trackStats)

  let artistStats = new Collection({
    type: "base", name: "artistStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "artistKey",    type: "text", required: true },
      { name: "name",         type: "text" },
      { name: "plays",        type: "number" },
      { name: "lastPlayedAt", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_artistStats_key ON artistStats (artistKey)"],
  })
  app.save(artistStats)

  let albumStats = new Collection({
    type: "base", name: "albumStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "albumKey",     type: "text", required: true },
      { name: "name",         type: "text" },
      { name: "artist",       type: "text" },
      { name: "plays",        type: "number" },
      { name: "lastPlayedAt", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_albumStats_key ON albumStats (albumKey)"],
  })
  app.save(albumStats)

  let globalStats = new Collection({
    type: "base", name: "globalStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "day",         type: "text", required: true },  // YYYY-MM-DD
      { name: "totalPlays",  type: "number" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_globalStats_day ON globalStats (day)"],
  })
  app.save(globalStats)

}, (app) => {
  // Rollback : supprime tout si besoin de revenir en arrière
  for (const name of ["playlists","presence","follows","reports","requests",
                       "trackStats","artistStats","albumStats","globalStats","users"]) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch {}
  }
})
MIGRATION_EOF

echo "✅ Migration des collections écrite dans pb_migrations/1_init_collections.js"

# ─────────────────────────────────────────────────────────────────────
# 4. HOOK — PONT D'AUTHENTIFICATION (Google via Firebase + Discord)
#
#    Le client continue de se connecter via Firebase (Google) ou via
#    Discord OAuth exactement comme avant. Une fois connecté, il envoie
#    le jeton obtenu à PocketBase, qui le VÉRIFIE server-side auprès de
#    Google/Discord (jamais de confiance aveugle dans le client), puis
#    ouvre une vraie session PocketBase (auth-with-password interne,
#    mot de passe déterministe jamais exposé au client).
# ─────────────────────────────────────────────────────────────────────
cat > "$PB_DIR/pb_hooks/beartify_auth_bridge.pb.js" << HOOK_EOF
/// <reference path="../pb_data/types.d.ts" />

const SERVER_BRIDGE_SECRET = "${SERVER_BRIDGE_SECRET}";
const FIREBASE_WEB_CLIENT_ID = "${FIREBASE_WEB_CLIENT_ID}";
const PB_BASE_URL = "http://127.0.0.1:${PB_PORT}";

// Dérive un mot de passe PocketBase stable et jamais transmis au client
function derivePassword(externalId) {
  return \$security.hs256(externalId, SERVER_BRIDGE_SECRET);
}

function upsertUserAndGetSession(provider, externalId, displayName, avatarUrl) {
  const collection = \$app.findCollectionByNameOrId("users");
  const password = derivePassword(externalId);
  const email = provider + "_" + externalId.replace(/[^a-zA-Z0-9]/g, "_") + "@bridge.local";

  let record;
  try {
    record = \$app.findFirstRecordByFilter("users", "externalId = {:eid}", { eid: externalId });
    record.set("displayName", displayName || record.get("displayName"));
    record.set("avatarUrl", avatarUrl || record.get("avatarUrl"));
  } catch (e) {
    record = new Record(collection);
    record.set("provider", provider);
    record.set("externalId", externalId);
    record.set("displayName", displayName || "");
    record.set("avatarUrl", avatarUrl || "");
    record.set("email", email);
    record.set("emailVisibility", false);
    record.set("password", password);
    record.set("passwordConfirm", password);
    record.set("verified", true);
  }
  \$app.save(record);

  // Ouvre une vraie session PocketBase via son propre endpoint public
  // (garantit un token toujours correctement signé, quelle que soit
  // la version de PocketBase installée).
  const res = \$http.send({
    url: PB_BASE_URL + "/api/collections/users/auth-with-password",
    method: "POST",
    body: JSON.stringify({ identity: email, password: password }),
    headers: { "Content-Type": "application/json" },
  });

  return JSON.parse(res.raw);
}

// ── Connexion via Google (le client fournit l'idToken déjà obtenu via Firebase) ──
routerAdd("POST", "/api/beartify/session/google", (e) => {
  const body = e.requestInfo().body;
  const idToken = body.idToken;
  if (!idToken) return e.json(400, { error: "idToken manquant" });

  // Vérification server-side du jeton Google — jamais de confiance
  // dans ce que le client prétend être.
  const verify = \$http.send({
    url: "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    method: "GET",
  });

  if (verify.statusCode !== 200) {
    return e.json(401, { error: "Jeton Google invalide" });
  }
  const claims = JSON.parse(verify.raw);

  if (claims.aud !== FIREBASE_WEB_CLIENT_ID) {
    return e.json(401, { error: "Jeton Google émis pour un autre client" });
  }
  if (claims.email_verified !== "true" && claims.email_verified !== true) {
    return e.json(401, { error: "Email Google non vérifié" });
  }

  const session = upsertUserAndGetSession("google", claims.email, claims.name, claims.picture);
  return e.json(200, session);
});

// ── Connexion via Discord (le client fournit l'access token OAuth Discord) ──
routerAdd("POST", "/api/beartify/session/discord", (e) => {
  const body = e.requestInfo().body;
  const accessToken = body.accessToken;
  if (!accessToken) return e.json(400, { error: "accessToken manquant" });

  const verify = \$http.send({
    url: "https://discord.com/api/users/@me",
    method: "GET",
    headers: { "Authorization": "Bearer " + accessToken },
  });

  if (verify.statusCode !== 200) {
    return e.json(401, { error: "Jeton Discord invalide" });
  }
  const discordUser = JSON.parse(verify.raw);

  const session = upsertUserAndGetSession(
    "discord",
    discordUser.id,
    discordUser.global_name || discordUser.username,
    discordUser.avatar
      ? "https://cdn.discordapp.com/avatars/" + discordUser.id + "/" + discordUser.avatar + ".png"
      : ""
  );
  return e.json(200, session);
});

// ── Incrément atomique des stats d'écoute (remplace FieldValue.increment) ──
routerAdd("POST", "/api/beartify/track-play", (e) => {
  if (!e.auth) return e.json(401, { error: "Non authentifié" });
  const body = e.requestInfo().body;
  const { title, artist, album, imageUrl } = body;
  if (!title) return e.json(400, { error: "title manquant" });

  const safeKey = (s) => (s || "").replace(/[.#$\\/\\[\\]]/g, "_").slice(0, 200) || "_";
  const today = new Date().toISOString().slice(0, 10);
  const trackKey = safeKey(title + "___" + (artist || ""));

  \$app.runInTransaction((txApp) => {
    // trackStats
    let t;
    try {
      t = txApp.findFirstRecordByFilter("trackStats", "trackKey = {:k}", { k: trackKey });
      t.set("plays", (t.get("plays") || 0) + 1);
      t.set("playsToday", t.get("lastDate") === today ? (t.get("playsToday") || 0) + 1 : 1);
    } catch (err) {
      t = new Record(txApp.findCollectionByNameOrId("trackStats"));
      t.set("trackKey", trackKey);
      t.set("plays", 1);
      t.set("playsToday", 1);
    }
    t.set("title", title); t.set("artist", artist || ""); t.set("album", album || "");
    t.set("imageUrl", imageUrl || ""); t.set("lastPlayedAt", new Date().toISOString()); t.set("lastDate", today);
    txApp.save(t);

    // globalStats (sparkline)
    let g;
    try {
      g = txApp.findFirstRecordByFilter("globalStats", "day = {:d}", { d: today });
      g.set("totalPlays", (g.get("totalPlays") || 0) + 1);
    } catch (err) {
      g = new Record(txApp.findCollectionByNameOrId("globalStats"));
      g.set("day", today); g.set("totalPlays", 1);
    }
    txApp.save(g);
  });

  return e.json(200, { ok: true });
});
HOOK_EOF

echo "✅ Hook d'authentification et de stats écrit dans pb_hooks/beartify_auth_bridge.pb.js"

# ─────────────────────────────────────────────────────────────────────
# 5. PERMISSIONS
# ─────────────────────────────────────────────────────────────────────
chown -R "$PB_USER":"$PB_USER" "$PB_DIR"
chmod -R 750 "$PB_DIR"

# ─────────────────────────────────────────────────────────────────────
# 6. SERVICE SYSTEMD
# ─────────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/pocketbase-beartify.service << SERVICE_EOF
[Unit]
Description=PocketBase - Beartify backend
After=network.target

[Service]
Type=simple
User=${PB_USER}
Group=${PB_USER}
LimitNOFILE=4096
Restart=on-failure
RestartSec=5
WorkingDirectory=${PB_DIR}
ExecStart=${PB_DIR}/pocketbase serve --http=127.0.0.1:${PB_PORT}
# Durcissement
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${PB_DIR}
ProtectHome=true

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable pocketbase-beartify
systemctl restart pocketbase-beartify
sleep 2
systemctl --no-pager status pocketbase-beartify || true

# ─────────────────────────────────────────────────────────────────────
# 7. PARE-FEU — PocketBase n'écoute qu'en local, jamais exposé directement
# ─────────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    ufw deny "${PB_PORT}"/tcp || true
    echo "✅ Port ${PB_PORT} bloqué en accès direct (accessible uniquement via Caddy en local)"
fi

# ─────────────────────────────────────────────────────────────────────
# 8. SAUVEGARDE AUTOMATIQUE QUOTIDIENNE (fichier SQLite)
# ─────────────────────────────────────────────────────────────────────
cat > /usr/local/bin/backup-pocketbase-beartify.sh << 'BACKUP_EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="/opt/pocketbase/backups/pb_data_${STAMP}.tar.gz"
tar -czf "$DEST" -C /opt/pocketbase pb_data
# Ne garde que les 14 dernières sauvegardes
find /opt/pocketbase/backups -name "pb_data_*.tar.gz" -mtime +14 -delete
echo "Sauvegarde créée : $DEST"
BACKUP_EOF
chmod +x /usr/local/bin/backup-pocketbase-beartify.sh

( crontab -l 2>/dev/null | grep -v backup-pocketbase-beartify ; \
  echo "0 4 * * * /usr/local/bin/backup-pocketbase-beartify.sh >> /var/log/pocketbase-backup.log 2>&1" ) | crontab -
echo "✅ Sauvegarde quotidienne planifiée à 4h du matin (crontab), rétention 14 jours"

# ─────────────────────────────────────────────────────────────────────
# 9. SNIPPET CADDY À AJOUTER MANUELLEMENT (par sécurité, ne modifie pas
#    ton Caddyfile de prod automatiquement)
# ─────────────────────────────────────────────────────────────────────
cat > "$PB_DIR/caddy-snippet-a-integrer.conf" << CADDY_EOF
# ── À ajouter dans le bloc "beartify.duckdns.org { ... }" de ton Caddyfile,
#    au même endroit que les autres "handle /api/..." (avant @notFile) ──

    handle ${PB_DOMAIN_PATH}/* {
        uri strip_prefix ${PB_DOMAIN_PATH}
        reverse_proxy 127.0.0.1:${PB_PORT} {
            header_up  X-Real-IP       {remote_host}
            header_up  X-Forwarded-For {remote_host}
        }
    }
CADDY_EOF

echo ""
echo "════════════════════════════════════════════════════"
echo " ✅ Installation terminée"
echo "════════════════════════════════════════════════════"
echo ""
echo "ÉTAPES MANUELLES RESTANTES :"
echo "1. Édite $PB_DIR/pb_hooks/beartify_auth_bridge.pb.js si besoin"
echo "   et remplace FIREBASE_WEB_CLIENT_ID (actuellement: ${FIREBASE_WEB_CLIENT_ID})"
echo "   par le vrai Client ID Web de ton projet Firebase, puis:"
echo "   systemctl restart pocketbase-beartify"
echo ""
echo "2. Crée le compte super-admin PocketBase :"
echo "   sudo -u $PB_USER $PB_DIR/pocketbase superuser create ton-email@example.com 'un-mot-de-passe-fort'"
echo ""
echo "3. Ajoute le contenu de $PB_DIR/caddy-snippet-a-integrer.conf"
echo "   dans ton Caddyfile existant, puis: sudo systemctl reload caddy"
echo ""
echo "4. Le secret de dérivation de mot de passe a été généré aléatoirement :"
echo "   ${SERVER_BRIDGE_SECRET}"
echo "   Il est déjà inscrit dans le hook — pas d'action requise, mais"
echo "   NE JAMAIS le committer dans un dépôt public."
echo ""
echo "5. Console d'admin accessible en local via : http://127.0.0.1:${PB_PORT}/_/"
echo "   (utilise un tunnel SSH depuis ta machine : ssh -L 8090:127.0.0.1:8090 user@serveur)"
echo ""
echo "⚠️  RAPPEL SÉCURITÉ (déjà signalé précédemment, toujours pas fait ?) :"
echo "   Le firebase-service-account.json partagé plus tôt contient une clé"
echo "   privée active à révoquer. Le Caddyfile contient aussi en clair un"
echo "   token Jellyfin, une clé API Last.fm et un Basic Auth Nextcloud —"
echo "   envisage de les déplacer vers des variables d'environnement."
echo "════════════════════════════════════════════════════"
