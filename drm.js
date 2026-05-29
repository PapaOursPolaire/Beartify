// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  (Secure Stream Server)
//  Node.js / Express — port 3001  —  écoute sur 127.0.0.1 uniquement
//
//  Endpoints exposés (tous routés par Caddy via /api/drm/*) :
//
//  GET /api/drm/session/:id
//      Génère une clé AES-256 one-shot + un token de session (TTL 10min).
//      Réponse : { sessionToken, key, iv }
//      La clé ne voyage qu'une seule fois et n'est plus accessible ensuite.
//
//  GET /api/drm/stream/:id?s=TOKEN[&MaxStreamingBitrate=N&AudioBitRate=N]
//      Valide le token de session, récupère l'audio chez Jellyfin en
//      interne, le chiffre à la volée avec AES-256-CTR, et renvoie
//      application/octet-stream.
//      Video DownloadHelper et toute extension réseau ne voient qu'un
//      flux binaire inconnu — aucun audio exploitable.
//
//  GET /health  →  { status: "ok" }
// ══════════════════════════════════════════════════════════════════════

'use strict';
require('dotenv').config();

const express = require('express');
const http    = require('http');
const crypto  = require('crypto');

// ── Config ──────────────────────────────────────────────────────────
const PORT           = parseInt(process.env.PORT          || '3001', 10);
const JELLYFIN_HOST  = process.env.JELLYFIN_HOST          || '127.0.0.1';
const JELLYFIN_PORT  = parseInt(process.env.JELLYFIN_PORT || '8096', 10);
const JELLYFIN_TOKEN = process.env.JELLYFIN_TOKEN         || 'aaa8a7df4b364cf7bcc76f351d768798';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error('❌  SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

// ── Store de sessions en mémoire ────────────────────────────────────
// Map<sessionToken, { itemId, key, iv, ip, expiresAt }>
// Les sessions expirent après 10 minutes (largement suffisant pour
// télécharger le buffer audio complet, même sur une connexion lente).
const sessions = new Map();

// Nettoyage automatique des sessions expirées toutes les 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt < now) sessions.delete(token);
  }
}, 5 * 60 * 1000);

// ── Helper IP ────────────────────────────────────────────────────────
function clientIp(req) {
  const raw = req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '';
  return raw.replace(/^::ffff:/, '');
}

const app = express();

// ══════════════════════════════════════════════════════════════════════
//  ENDPOINT 1 — Créer une session DRM
//  GET /api/drm/session/:id
//
//  Génère :
//   - une clé AES-256 aléatoire (32 octets)
//   - un IV aléatoire (16 octets)
//   - un token de session signé HMAC-SHA256 (TTL 10 min, lié à l'IP)
//
//  La clé est stockée dans la Map en mémoire, pas dans la réponse
//  de manière permanente : elle n'est transmise qu'une fois.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/drm/session/:id', (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId)) {
    return res.status(400).json({ error: 'ID invalide' });
  }

  const ip        = clientIp(req);
  const key       = crypto.randomBytes(32);   // AES-256
  const iv        = crypto.randomBytes(16);   // CTR counter
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min

  // Token = HMAC-SHA256(itemId|ip|expiresAt, SESSION_SECRET) + timestamp
  const payload   = `${itemId}|${ip}|${expiresAt}`;
  const sig       = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const token     = `${expiresAt}.${sig}`;

  sessions.set(token, { itemId, key, iv, ip, expiresAt });

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    sessionToken: token,
    key: key.toString('hex'),
    iv:  iv.toString('hex'),
  });
});

// ══════════════════════════════════════════════════════════════════════
//  ENDPOINT 2 — Stream chiffré AES-256-CTR
//  GET /api/drm/stream/:id?s=TOKEN[&MaxStreamingBitrate=N&AudioBitRate=N]
//
//  1. Valide le token (HMAC + expiry + IP + itemId)
//  2. Récupère l'audio en interne depuis Jellyfin (static=true)
//  3. Chiffre le buffer avec AES-256-CTR
//  4. Renvoie application/octet-stream + X-Audio-Type (MIME réel)
//
//  Le client (script.js) déchiffre avec SubtleCrypto et crée un blob:
//  URL local — invisible à toute extension réseau.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/drm/stream/:id', async (req, res) => {
  const itemId = req.params.id;
  const token  = req.query.s;

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  // ── Récupérer la session ──────────────────────────────────────────
  const sess = sessions.get(token);
  if (!sess) return res.status(401).json({ error: 'Session inconnue ou expirée' });

  // ── Vérifier expiry ───────────────────────────────────────────────
  if (Date.now() > sess.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expirée' });
  }

  // ── Vérifier itemId ───────────────────────────────────────────────
  if (sess.itemId !== itemId) {
    return res.status(403).json({ error: 'Token non valide pour cet item' });
  }

  // ── Vérifier IP ───────────────────────────────────────────────────
  const reqIp = clientIp(req);
  if (sess.ip !== reqIp) {
    console.warn(`[DRM] IP mismatch session=${sess.ip} req=${reqIp}`);
    return res.status(403).json({ error: 'IP non autorisée' });
  }

  // ── Consommer la session (usage unique) ───────────────────────────
  // On la supprime immédiatement pour éviter toute réutilisation du token.
  sessions.delete(token);

  // ── Construire l'URL Jellyfin interne ────────────────────────────
  const params = new URLSearchParams();
  params.set('static',  'true');
  params.set('api_key', JELLYFIN_TOKEN);
  if (req.query.MaxStreamingBitrate) params.set('MaxStreamingBitrate', req.query.MaxStreamingBitrate);
  if (req.query.AudioBitRate)        params.set('AudioBitRate',        req.query.AudioBitRate);

  const jellyfinPath = `/Audio/${itemId}/stream?${params}`;

  // ── Récupérer l'audio depuis Jellyfin ────────────────────────────
  try {
    const audioBuffer = await new Promise((resolve, reject) => {
      const jellyReq = http.request({
        hostname: JELLYFIN_HOST,
        port:     JELLYFIN_PORT,
        path:     jellyfinPath,
        method:   'GET',
        headers:  { 'X-Emby-Token': JELLYFIN_TOKEN },
      }, (jellyRes) => {
        // Capturer le Content-Type pour le passer au client
        res.setHeader('X-Audio-Type', jellyRes.headers['content-type'] || 'audio/mpeg');

        const chunks = [];
        jellyRes.on('data',  chunk => chunks.push(chunk));
        jellyRes.on('end',   ()    => resolve(Buffer.concat(chunks)));
        jellyRes.on('error', reject);
      });
      jellyReq.on('error', reject);
      jellyReq.end();
    });

    // ── Chiffrer avec AES-256-CTR ─────────────────────────────────
    const cipher     = crypto.createCipheriv('aes-256-ctr', sess.key, sess.iv);
    const encrypted  = Buffer.concat([cipher.update(audioBuffer), cipher.final()]);

    // ── Répondre avec le flux chiffré ─────────────────────────────
    // Content-Type volontairement opaque → DownloadHelper ne peut pas
    // identifier ni proposer le fichier comme audio téléchargeable.
    res.setHeader('Content-Type',        'application/octet-stream');
    res.setHeader('Content-Length',       encrypted.length);
    res.setHeader('Cache-Control',        'no-store, no-cache, private');
    res.setHeader('Content-Disposition',  'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(encrypted);

  } catch (err) {
    console.error('[DRM] Erreur stream Jellyfin:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Erreur upstream' });
  }
});

// ── Healthcheck ──────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', sessions: sessions.size }));

// ── Démarrage ────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Beartify DRM Server démarré sur 127.0.0.1:${PORT}`);
});
