#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  BEARTIFY — Réinstallation PROPRE de PocketBase (port 8095)
#
#  Corrige les problèmes de la v1 :
#   - Port changé de 8090 → 8095 (8090 déjà occupé)
#   - Migration des collections appliquée EXPLICITEMENT via
#     `./pocketbase migrate up` AVANT le premier démarrage du service,
#     au lieu de compter sur l'auto-migration implicite de `serve`
#     (cause probable de l'échec précédent : le service démarrait sans
#     que les collections aient eu le temps d'être créées, ou une
#     erreur silencieuse dans la migration n'était pas remontée).
#   - Vérification réelle à la fin (lecture directe de la base SQLite)
#     que les 9 collections attendues existent bien.
#   - Nettoyage complet de toute installation précédente avant de
#     recommencer (service, utilisateur, dossier).
#
#  À exécuter en root (sudo bash reinstall.sh) sur Debian 13.
# ══════════════════════════════════════════════════════════════════════
set -uo pipefail   # (pas de -e : on veut gérer chaque erreur nous-mêmes et logger clairement)

PB_DIR="/opt/pocketbase"
PB_USER="pocketbase"
PB_PORT="8095"
SERVICE_NAME="pocketbase-beartify"
FIREBASE_WEB_API_KEY="REMPLACE_MOI"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo "════════════════════════════════════════════════════"
echo " Réinstallation propre PocketBase — port ${PB_PORT}"
echo "════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────
# 0. VÉRIFICATIONS PRÉALABLES
# ─────────────────────────────────────────────────────────────────────
[ "$EUID" -eq 0 ] || fail "Ce script doit être exécuté en root (sudo bash reinstall.sh)"

if ss -tlnp 2>/dev/null | grep -q ":${PB_PORT} "; then
    fail "Le port ${PB_PORT} est déjà occupé par un autre processus. Vérifie avec: ss -tlnp | grep ${PB_PORT}"
fi

for cmd in curl unzip systemctl; do
    command -v "$cmd" &>/dev/null || fail "Commande manquante : $cmd (installe-la d'abord : apt install $cmd)"
done

# ─────────────────────────────────────────────────────────────────────
# 1. NETTOYAGE COMPLET DE L'INSTALLATION PRÉCÉDENTE
# ─────────────────────────────────────────────────────────────────────
echo "→ Arrêt et nettoyage de toute installation précédente..."

for svc in pocketbase-beartify pocketbase; do
    if systemctl list-unit-files | grep -q "^${svc}.service"; then
        systemctl stop "$svc" 2>/dev/null || true
        systemctl disable "$svc" 2>/dev/null || true
        rm -f "/etc/systemd/system/${svc}.service"
        ok "Ancien service '$svc' arrêté et supprimé"
    fi
done
systemctl daemon-reload

if [ -d "$PB_DIR" ]; then
    STAMP=$(date +%Y%m%d_%H%M%S)
    mv "$PB_DIR" "${PB_DIR}.old_${STAMP}" \
        && ok "Ancienne installation déplacée vers ${PB_DIR}.old_${STAMP} (à supprimer manuellement une fois vérifié que tout fonctionne)"
fi

if ufw status 2>/dev/null | grep -q "8090"; then
    ufw delete deny 8090/tcp 2>/dev/null || true
    echo "  (règle pare-feu obsolète pour l'ancien port 8090 retirée)"
fi

mkdir -p "$PB_DIR"/{pb_data,pb_migrations,pb_hooks,pb_public,backups}

# ─────────────────────────────────────────────────────────────────────
# 2. UTILISATEUR SYSTÈME
# ─────────────────────────────────────────────────────────────────────
if ! id "$PB_USER" &>/dev/null; then
    useradd --system --home "$PB_DIR" --shell /usr/sbin/nologin "$PB_USER"
    ok "Utilisateur système '$PB_USER' créé"
else
    ok "Utilisateur système '$PB_USER' déjà présent"
fi

# ─────────────────────────────────────────────────────────────────────
# 3. TÉLÉCHARGEMENT DE POCKETBASE
# ─────────────────────────────────────────────────────────────────────
echo "→ Téléchargement de la dernière version de PocketBase..."
LATEST_URL=$(curl -s https://api.github.com/repos/pocketbase/pocketbase/releases/latest \
    | grep "browser_download_url.*linux_amd64.zip" | cut -d '"' -f 4)

[ -n "$LATEST_URL" ] || fail "Impossible de récupérer l'URL de téléchargement (vérifie la connexion réseau/DNS/rate-limit GitHub API)"
echo "  URL: $LATEST_URL"

curl -sL "$LATEST_URL" -o /tmp/pocketbase.zip || fail "Échec du téléchargement"
unzip -o -q /tmp/pocketbase.zip -d "$PB_DIR" || fail "Échec de la décompression"
rm -f /tmp/pocketbase.zip
chmod +x "$PB_DIR/pocketbase"

[ -x "$PB_DIR/pocketbase" ] || fail "Le binaire pocketbase n'est pas exécutable après extraction"
VERSION=$("$PB_DIR/pocketbase" --version 2>&1) || fail "Le binaire pocketbase ne s'exécute pas (incompatibilité d'architecture ?)"
ok "Binaire installé : $VERSION"

# ─────────────────────────────────────────────────────────────────────
# 4. MIGRATION — CRÉATION DES COLLECTIONS
# ─────────────────────────────────────────────────────────────────────
cat > "$PB_DIR/pb_migrations/1_init_collections.js" << 'MIGRATION_EOF'
migrate((app) => {
  // ⚠️ PocketBase crée TOUJOURS une collection "users" par défaut dès
  // l'installation (migration système interne). Créer une nouvelle
  // collection du même nom provoque l'erreur "Collection name must be
  // unique (case insensitive)". La bonne pratique consiste donc à
  // ÉTENDRE cette collection existante avec nos champs, pas à en créer une.
  let users = app.findCollectionByNameOrId("users")
  users.listRule = "id = @request.auth.id"
  users.viewRule = "id = @request.auth.id"
  users.createRule = null
  users.updateRule = "id = @request.auth.id"
  users.deleteRule = null
  users.fields.add(new SelectField({ name: "provider", values: ["google", "discord"], maxSelect: 1 }))
  users.fields.add(new TextField({ name: "externalId", required: true }))
  users.fields.add(new TextField({ name: "displayName" }))
  users.fields.add(new URLField({ name: "avatarUrl" }))
  users.indexes = [...users.indexes, "CREATE UNIQUE INDEX idx_users_externalId ON users (externalId)"]
  app.save(users)

  let playlists = new Collection({
    type: "base", name: "playlists",
    listRule: "user = @request.auth.id || (private = false)",
    viewRule: "user = @request.auth.id || (private = false)",
    createRule: "user = @request.auth.id", updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  })
  playlists.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  playlists.fields.add(new TextField({ name: "name", required: true, max: 200 }))
  playlists.fields.add(new TextField({ name: "description", max: 1000 }))
  playlists.fields.add(new JSONField({ name: "tracks" }))
  playlists.fields.add(new TextField({ name: "coverUrl" }))
  playlists.fields.add(new BoolField({ name: "private" }))
  app.save(playlists)

  let presence = new Collection({
    type: "base", name: "presence",
    listRule: "@request.auth.id != ''", viewRule: "@request.auth.id != ''",
    createRule: "user = @request.auth.id", updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  })
  presence.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  presence.fields.add(new SelectField({ name: "status", values: ["playing", "paused", "offline"], maxSelect: 1 }))
  presence.fields.add(new JSONField({ name: "track" }))
  presence.fields.add(new NumberField({ name: "position" }))
  presence.fields.add(new DateField({ name: "updatedAt" }))
  presence.indexes = ["CREATE UNIQUE INDEX idx_presence_user ON presence (user)"]
  app.save(presence)

  let follows = new Collection({
    type: "base", name: "follows",
    listRule: "follower = @request.auth.id || following = @request.auth.id",
    viewRule: "follower = @request.auth.id || following = @request.auth.id",
    createRule: "follower = @request.auth.id", updateRule: null,
    deleteRule: "follower = @request.auth.id",
  })
  follows.fields.add(new RelationField({ name: "follower", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  follows.fields.add(new RelationField({ name: "following", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  follows.indexes = ["CREATE UNIQUE INDEX idx_follows_pair ON follows (follower, following)"]
  app.save(follows)

  let reports = new Collection({
    type: "base", name: "reports",
    listRule: null, viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != ''", updateRule: null, deleteRule: null,
  })
  reports.fields.add(new RelationField({ name: "user", maxSelect: 1, collectionId: users.id }))
  reports.fields.add(new TextField({ name: "type" }))
  reports.fields.add(new TextField({ name: "category" }))
  reports.fields.add(new TextField({ name: "description", max: 5000 }))
  reports.fields.add(new SelectField({ name: "status", values: ["pending", "reviewed", "closed"], maxSelect: 1 }))
  reports.fields.add(new JSONField({ name: "meta" }))
  app.save(reports)

  let requests = new Collection({
    type: "base", name: "requests",
    listRule: "@request.auth.id != ''", viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''", updateRule: "@request.auth.id != ''", deleteRule: null,
  })
  requests.fields.add(new TextField({ name: "type", required: true }))
  requests.fields.add(new TextField({ name: "name", required: true }))
  requests.fields.add(new TextField({ name: "artist" }))
  requests.fields.add(new TextField({ name: "info" }))
  requests.fields.add(new SelectField({ name: "status", values: ["pending", "added", "rejected"], maxSelect: 1 }))
  requests.fields.add(new NumberField({ name: "votes" }))
  requests.fields.add(new JSONField({ name: "voters" }))
  app.save(requests)

  let trackStats = new Collection({
    type: "base", name: "trackStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
  })
  trackStats.fields.add(new TextField({ name: "trackKey", required: true }))
  trackStats.fields.add(new TextField({ name: "title" }))
  trackStats.fields.add(new TextField({ name: "artist" }))
  trackStats.fields.add(new TextField({ name: "album" }))
  trackStats.fields.add(new TextField({ name: "imageUrl" }))
  trackStats.fields.add(new NumberField({ name: "plays" }))
  trackStats.fields.add(new NumberField({ name: "playsToday" }))
  trackStats.fields.add(new DateField({ name: "lastPlayedAt" }))
  trackStats.fields.add(new TextField({ name: "lastDate" }))
  trackStats.indexes = ["CREATE UNIQUE INDEX idx_trackStats_key ON trackStats (trackKey)"]
  app.save(trackStats)

  let artistStats = new Collection({
    type: "base", name: "artistStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
  })
  artistStats.fields.add(new TextField({ name: "artistKey", required: true }))
  artistStats.fields.add(new TextField({ name: "name" }))
  artistStats.fields.add(new NumberField({ name: "plays" }))
  artistStats.fields.add(new DateField({ name: "lastPlayedAt" }))
  artistStats.indexes = ["CREATE UNIQUE INDEX idx_artistStats_key ON artistStats (artistKey)"]
  app.save(artistStats)

  let albumStats = new Collection({
    type: "base", name: "albumStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
  })
  albumStats.fields.add(new TextField({ name: "albumKey", required: true }))
  albumStats.fields.add(new TextField({ name: "name" }))
  albumStats.fields.add(new TextField({ name: "artist" }))
  albumStats.fields.add(new NumberField({ name: "plays" }))
  albumStats.fields.add(new DateField({ name: "lastPlayedAt" }))
  albumStats.indexes = ["CREATE UNIQUE INDEX idx_albumStats_key ON albumStats (albumKey)"]
  app.save(albumStats)

  let globalStats = new Collection({
    type: "base", name: "globalStats",
    listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null,
  })
  globalStats.fields.add(new TextField({ name: "day", required: true }))
  globalStats.fields.add(new NumberField({ name: "totalPlays" }))
  globalStats.indexes = ["CREATE UNIQUE INDEX idx_globalStats_day ON globalStats (day)"]
  app.save(globalStats)

}, (app) => {
  // "users" n'est PAS supprimée ici : c'est la collection système par
  // défaut de PocketBase, on l'a seulement étendue avec nos champs.
  // La supprimer casserait l'authentification PocketBase elle-même.
  for (const name of ["playlists","presence","follows","reports","requests",
                       "trackStats","artistStats","albumStats","globalStats"]) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch {}
  }
})
MIGRATION_EOF
ok "Fichier de migration écrit"

# ─────────────────────────────────────────────────────────────────────
# 5. HOOK D'AUTHENTIFICATION (Google via Firebase + Discord natif)
# ─────────────────────────────────────────────────────────────────────
SERVER_BRIDGE_SECRET="$(openssl rand -hex 32)"
cat > "$PB_DIR/pb_hooks/beartify_auth_bridge.pb.js" << HOOK_EOF
/// <reference path="../pb_data/types.d.ts" />
const SERVER_BRIDGE_SECRET = "${SERVER_BRIDGE_SECRET}";
const FIREBASE_WEB_API_KEY = "${FIREBASE_WEB_API_KEY}";
const PB_BASE_URL = "http://127.0.0.1:${PB_PORT}";

function derivePassword(externalId) { return \$security.hs256(externalId, SERVER_BRIDGE_SECRET); }

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
    record.set("provider", provider); record.set("externalId", externalId);
    record.set("displayName", displayName || ""); record.set("avatarUrl", avatarUrl || "");
    record.set("email", email); record.set("emailVisibility", false);
    record.set("password", password); record.set("passwordConfirm", password);
    record.set("verified", true);
  }
  \$app.save(record);
  const res = \$http.send({
    url: PB_BASE_URL + "/api/collections/users/auth-with-password",
    method: "POST", body: JSON.stringify({ identity: email, password: password }),
    headers: { "Content-Type": "application/json" },
  });
  return JSON.parse(res.raw);
}

routerAdd("POST", "/api/beartify/session/google", (e) => {
  const body = e.requestInfo().body;
  const idToken = body.idToken;
  if (!idToken) return e.json(400, { error: "idToken manquant" });
  // ⚠️ user.getIdToken() (Firebase) n'est PAS un jeton Google OAuth classique —
  // oauth2.googleapis.com/tokeninfo le rejette toujours. La vérification
  // correcte d'un jeton Firebase se fait via l'API Identity Toolkit.
  const verify = \$http.send({
    url: "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_WEB_API_KEY,
    method: "POST",
    body: JSON.stringify({ idToken: idToken }),
    headers: { "Content-Type": "application/json" },
  });
  if (verify.statusCode !== 200) return e.json(401, { error: "Jeton Firebase invalide" });
  const data = JSON.parse(verify.raw);
  const fbUser = data.users && data.users[0];
  if (!fbUser) return e.json(401, { error: "Utilisateur Firebase introuvable" });
  if (fbUser.emailVerified !== true) return e.json(401, { error: "Email Google non vérifié" });
  const session = upsertUserAndGetSession("google", fbUser.email, fbUser.displayName, fbUser.photoUrl);
  return e.json(200, session);
});

routerAdd("POST", "/api/beartify/session/discord", (e) => {
  const body = e.requestInfo().body;
  const accessToken = body.accessToken;
  if (!accessToken) return e.json(400, { error: "accessToken manquant" });
  const verify = \$http.send({ url: "https://discord.com/api/users/@me", method: "GET", headers: { "Authorization": "Bearer " + accessToken } });
  if (verify.statusCode !== 200) return e.json(401, { error: "Jeton Discord invalide" });
  const discordUser = JSON.parse(verify.raw);
  const session = upsertUserAndGetSession("discord", discordUser.id, discordUser.global_name || discordUser.username,
    discordUser.avatar ? "https://cdn.discordapp.com/avatars/" + discordUser.id + "/" + discordUser.avatar + ".png" : "");
  return e.json(200, session);
});

routerAdd("POST", "/api/beartify/track-play", (e) => {
  if (!e.auth) return e.json(401, { error: "Non authentifié" });
  const body = e.requestInfo().body;
  const { title, artist, album, imageUrl } = body;
  if (!title) return e.json(400, { error: "title manquant" });
  const safeKey = (s) => (s || "").replace(/[.#\$\\/\\[\\]]/g, "_").slice(0, 200) || "_";
  const today = new Date().toISOString().slice(0, 10);
  const trackKey = safeKey(title + "___" + (artist || ""));
  \$app.runInTransaction((txApp) => {
    let t;
    try {
      t = txApp.findFirstRecordByFilter("trackStats", "trackKey = {:k}", { k: trackKey });
      t.set("plays", (t.get("plays") || 0) + 1);
      t.set("playsToday", t.get("lastDate") === today ? (t.get("playsToday") || 0) + 1 : 1);
    } catch (err) {
      t = new Record(txApp.findCollectionByNameOrId("trackStats"));
      t.set("trackKey", trackKey); t.set("plays", 1); t.set("playsToday", 1);
    }
    t.set("title", title); t.set("artist", artist || ""); t.set("album", album || "");
    t.set("imageUrl", imageUrl || ""); t.set("lastPlayedAt", new Date().toISOString()); t.set("lastDate", today);
    txApp.save(t);
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
ok "Hook d'authentification écrit"

chown -R "$PB_USER":"$PB_USER" "$PB_DIR"
chmod -R 750 "$PB_DIR"

# ─────────────────────────────────────────────────────────────────────
# 6. MIGRATION EXPLICITE — AVANT tout démarrage du service
#    (c'est le point critique qui a probablement échoué silencieusement
#    la dernière fois avec l'auto-migration au démarrage de `serve`)
# ─────────────────────────────────────────────────────────────────────
echo "→ Application explicite des migrations (avant le premier démarrage)..."
MIGRATE_OUTPUT=$(sudo -u "$PB_USER" "$PB_DIR/pocketbase" migrate up --dir "$PB_DIR/pb_data" 2>&1)
echo "$MIGRATE_OUTPUT"

if echo "$MIGRATE_OUTPUT" | grep -qi "error\|panic"; then
    fail "La migration a échoué — voir le message ci-dessus. Le service n'a PAS été démarré."
fi
ok "Migrations appliquées"

# ─────────────────────────────────────────────────────────────────────
# 7. VÉRIFICATION RÉELLE — lecture directe de la base SQLite
# ─────────────────────────────────────────────────────────────────────
EXPECTED_COLLECTIONS="users playlists presence follows reports requests trackStats artistStats albumStats globalStats"
if command -v sqlite3 &>/dev/null; then
    echo "→ Vérification des collections créées (lecture directe SQLite)..."
    ACTUAL=$(sqlite3 "$PB_DIR/pb_data/data.db" "SELECT name FROM _collections;" 2>/dev/null || echo "ERREUR_LECTURE")
    MISSING=""
    for c in $EXPECTED_COLLECTIONS; do
        echo "$ACTUAL" | grep -qx "$c" || MISSING="$MISSING $c"
    done
    if [ -n "$MISSING" ]; then
        fail "Collections manquantes après migration :$MISSING — la migration a un problème, ne démarre pas le service tant que ce n'est pas corrigé."
    fi
    ok "Les 10 collections attendues sont bien présentes dans la base"
else
    warn "sqlite3 non installé — vérification automatique impossible (apt install sqlite3 pour l'activer). On continue quand même."
fi

# ─────────────────────────────────────────────────────────────────────
# 8. SERVICE SYSTEMD
# ─────────────────────────────────────────────────────────────────────
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SERVICE_EOF
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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${PB_DIR}
ProtectHome=true

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" &>/dev/null
systemctl restart "$SERVICE_NAME"
sleep 2

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    fail "Le service n'a pas démarré. Diagnostic : journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
fi
ok "Service '${SERVICE_NAME}' démarré et actif"

# ─────────────────────────────────────────────────────────────────────
# 9. VÉRIFICATION HTTP FINALE
# ─────────────────────────────────────────────────────────────────────
sleep 1
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PB_PORT}/api/health" || echo "000")
if [ "$HEALTH" = "200" ]; then
    ok "PocketBase répond correctement sur le port ${PB_PORT} (/api/health → 200)"
else
    fail "PocketBase ne répond pas correctement (code HTTP: $HEALTH). Diagnostic : journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
fi

# ─────────────────────────────────────────────────────────────────────
# 10. PARE-FEU
# ─────────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    ufw deny "${PB_PORT}"/tcp &>/dev/null || true
    ok "Port ${PB_PORT} bloqué en accès direct depuis l'extérieur"
fi

# ─────────────────────────────────────────────────────────────────────
# 11. SAUVEGARDE QUOTIDIENNE
# ─────────────────────────────────────────────────────────────────────
cat > /usr/local/bin/backup-pocketbase-beartify.sh << 'BACKUP_EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="/opt/pocketbase/backups/pb_data_${STAMP}.tar.gz"
tar -czf "$DEST" -C /opt/pocketbase pb_data
find /opt/pocketbase/backups -name "pb_data_*.tar.gz" -mtime +14 -delete
echo "Sauvegarde créée : $DEST"
BACKUP_EOF
chmod +x /usr/local/bin/backup-pocketbase-beartify.sh
( crontab -l 2>/dev/null | grep -v backup-pocketbase-beartify ; \
  echo "0 4 * * * /usr/local/bin/backup-pocketbase-beartify.sh >> /var/log/pocketbase-backup.log 2>&1" ) | crontab -
ok "Sauvegarde quotidienne planifiée (4h du matin, rétention 14 jours)"

# ─────────────────────────────────────────────────────────────────────
# 12. SNIPPET CADDY
# ─────────────────────────────────────────────────────────────────────
cat > "$PB_DIR/caddy-snippet-a-integrer.conf" << CADDY_EOF
    handle /api/pb/* {
        uri strip_prefix /api/pb
        reverse_proxy 127.0.0.1:${PB_PORT} {
            header_up  X-Real-IP       {remote_host}
            header_up  X-Forwarded-For {remote_host}
        }
    }
CADDY_EOF

echo ""
echo "════════════════════════════════════════════════════"
ok "Réinstallation terminée avec succès sur le port ${PB_PORT}"
echo "════════════════════════════════════════════════════"
echo ""
echo "ÉTAPES MANUELLES RESTANTES :"
echo "1. Remplace FIREBASE_WEB_API_KEY dans :"
echo "   $PB_DIR/pb_hooks/beartify_auth_bridge.pb.js"
echo "   puis: systemctl restart ${SERVICE_NAME}"
echo ""
echo "2. Crée le compte super-admin :"
echo "   sudo -u $PB_USER $PB_DIR/pocketbase superuser create ton-email@example.com 'mot-de-passe-fort'"
echo ""
echo "3. Le Caddyfile fourni séparément utilise déjà le port ${PB_PORT} —"
echo "   vérifie juste qu'il correspond bien après import."
echo ""
echo "4. Ancienne installation sauvegardée dans : ${PB_DIR}.old_* (si existait)"
echo "   à supprimer une fois que tu as vérifié que tout fonctionne :"
echo "   rm -rf ${PB_DIR}.old_*"
echo "════════════════════════════════════════════════════"
