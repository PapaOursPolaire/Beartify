#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  Correctif ciblé : remplace uniquement le hook d'authentification
#  pour utiliser l'API Identity Toolkit de Firebase (accounts:lookup)
#  au lieu de oauth2.googleapis.com/tokeninfo, qui ne peut PAS
#  vérifier un jeton Firebase (user.getIdToken()) — d'où les 401
#  systématiques ("Jeton Google invalide") observés jusqu'ici.
#
#  ⚠️ Renseigne FIREBASE_WEB_API_KEY avant de lancer (Firebase Console
#  → Paramètres du projet → Général → "Clé API Web" — PAS le Client ID
#  OAuth utilisé précédemment, c'est un champ différent).
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

FIREBASE_WEB_API_KEY="AIzaSyAN1U4kdJl7BRbi7FB3aAdNwrqBQZLQhSk"
PB_PORT="8095"

[ "$FIREBASE_WEB_API_KEY" != "REMPLACE_MOI_PAR_TA_CLE_API_WEB" ] || {
    echo "❌ Édite ce script et renseigne FIREBASE_WEB_API_KEY avant de le lancer."
    exit 1
}

SERVER_BRIDGE_SECRET="$(openssl rand -hex 32)"

sudo tee /opt/pocketbase/pb_hooks/beartify_auth_bridge.pb.js > /dev/null << HOOK_EOF
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

sudo chown pocketbase:pocketbase /opt/pocketbase/pb_hooks/beartify_auth_bridge.pb.js
sudo chmod 640 /opt/pocketbase/pb_hooks/beartify_auth_bridge.pb.js
sudo sed -i 's/\r$//' /opt/pocketbase/pb_hooks/beartify_auth_bridge.pb.js

echo "→ Redémarrage du service..."
sudo systemctl restart pocketbase-beartify
sleep 2

echo "→ Test en local..."
curl -s -X POST "http://127.0.0.1:${PB_PORT}/api/beartify/session/google" \
  -H "Content-Type: application/json" -d '{}'
echo ""
echo "✅ Si tu vois {\"error\":\"idToken manquant\"} ci-dessus, le hook est correctement rechargé."
echo "   Reteste maintenant la connexion Google depuis le vrai site (192.168.0.18 ou le domaine public)."
