/// <reference path="../pb_data/types.d.ts" />

routerAdd("POST", "/api/beartify/session/google", (e) => {
  const utils = require(__hooks + "/bridge_utils.js");
  const body = e.requestInfo().body;
  const idToken = body.idToken;
  if (!idToken) return e.json(400, { error: "idToken manquant" });
  const verify = $http.send({
    url: "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + utils.FIREBASE_WEB_API_KEY,
    method: "POST",
    body: JSON.stringify({ idToken: idToken }),
    headers: { "Content-Type": "application/json" },
  });
  if (verify.statusCode !== 200) return e.json(401, { error: "Jeton Firebase invalide" });
  const data = JSON.parse(verify.raw);
  const fbUser = data.users && data.users[0];
  if (!fbUser) return e.json(401, { error: "Utilisateur Firebase introuvable" });
  if (fbUser.emailVerified !== true) return e.json(401, { error: "Email Google non vérifié" });
  const session = utils.upsertUserAndGetSession("google", fbUser.email, fbUser.displayName, fbUser.photoUrl);
  return e.json(200, session);
});

routerAdd("POST", "/api/beartify/session/discord", (e) => {
  const utils = require(__hooks + "/bridge_utils.js");
  const body = e.requestInfo().body;
  const accessToken = body.accessToken;
  if (!accessToken) return e.json(400, { error: "accessToken manquant" });
  const verify = $http.send({ url: "https://discord.com/api/users/@me", method: "GET", headers: { "Authorization": "Bearer " + accessToken } });
  if (verify.statusCode !== 200) return e.json(401, { error: "Jeton Discord invalide" });
  const discordUser = JSON.parse(verify.raw);
  const session = utils.upsertUserAndGetSession("discord", discordUser.id, discordUser.global_name || discordUser.username,
    discordUser.avatar ? "https://cdn.discordapp.com/avatars/" + discordUser.id + "/" + discordUser.avatar + ".png" : "");
  return e.json(200, session);
});

routerAdd("POST", "/api/beartify/track-play", (e) => {
  if (!e.auth) return e.json(401, { error: "Non authentifié" });
  const body = e.requestInfo().body;
  const { title, artist, album, imageUrl } = body;
  if (!title) return e.json(400, { error: "title manquant" });
  const safeKey = (s) => (s || "").replace(/[.#$\/\[\]]/g, "_").slice(0, 200) || "_";
  const today = new Date().toISOString().slice(0, 10);
  const trackKey = safeKey(title + "___" + (artist || ""));
  $app.runInTransaction((txApp) => {
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
