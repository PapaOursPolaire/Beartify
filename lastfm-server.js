// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — lastfm-server.js
//  Partie serveur du scrobbling Last.fm : la seule à connaître le secret
//  API et donc la seule autorisée à signer les requêtes (api_sig).
//
//  Usage dans drm.js (après `const app = express()`, comme extensions.js) :
//    require('./lastfm-server')(app);
//
//  Variables d'environnement requises :
//    LASTFM_API_KEY     — clé API Last.fm (publique, visible côté client)
//    LASTFM_API_SECRET  — secret API Last.fm (JAMAIS exposé côté client)
//
//  Routes exposées :
//    GET  /lastfm-callback?token=...
//      → échange le token contre une session key (auth.getSession, signé),
//        puis renvoie une page HTML qui postMessage() le résultat à la
//        fenêtre parente (celle qui a ouvert le popup d'autorisation)
//        et se ferme automatiquement.
//
//    POST /api/lastfm/now-playing   { sk, artist, track, album?, duration? }
//      → relaie track.updateNowPlaying (signé)
//
//    POST /api/lastfm/scrobble      { sk, artist, track, album?, timestamp }
//      → relaie track.scrobble (signé)
//
//  Le serveur injecte aussi window._lastfmApiKey côté client : voir la
//  note en bas de fichier (à ajouter dans la route qui sert index.html,
//  ou dans un endpoint /api/lastfm/config dédié).
// ══════════════════════════════════════════════════════════════════════
'use strict';

const https  = require('https');
const crypto = require('crypto');

const API_KEY    = process.env.LASTFM_API_KEY    || '';
const API_SECRET = process.env.LASTFM_API_SECRET || '';
const API_BASE   = 'https://ws.audioscrobbler.com/2.0/';

// ── Signature Last.fm : md5(param1value1param2value2...secret), triés ──
function _sign(params) {
  const keys = Object.keys(params).filter(k => k !== 'format').sort();
  const base = keys.map(k => `${k}${params[k]}`).join('') + API_SECRET;
  return crypto.createHash('md5').update(base, 'utf8').digest('hex');
}

function _postForm(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _getJson(params) {
  const qs = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    https.get(`${API_BASE}?${qs}`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = function registerLastfmRoutes(app) {
  if (!API_KEY || !API_SECRET) {
    console.warn('[lastfm] LASTFM_API_KEY / LASTFM_API_SECRET manquants — scrobbling désactivé');
  }

  // ══════════════════════════════════════════════════════════════════
  //  GET /lastfm-callback?token=...
  //  Échange le token d'autorisation contre une session key, puis
  //  referme le popup en transmettant le résultat à la fenêtre parente.
  // ══════════════════════════════════════════════════════════════════
  app.get('/lastfm-callback', async (req, res) => {
    const token = req.query.token;
    const send = (payload) => res.send(`<!doctype html><html><body>
      <script>
        if (window.opener) {
          window.opener.postMessage(${JSON.stringify(payload)}, window.location.origin);
        }
        window.close();
      </script>
      <p>Vous pouvez fermer cette fenêtre.</p>
    </body></html>`);

    if (!token) return send({ type: 'beartify-lastfm-session', error: 'Token manquant' });

    try {
      const params = { method: 'auth.getSession', api_key: API_KEY, token, format: 'json' };
      params.api_sig = _sign(params);
      const data = await _getJson(params);
      if (data.session?.key) {
        send({ type: 'beartify-lastfm-session', sessionKey: data.session.key, username: data.session.name });
      } else {
        send({ type: 'beartify-lastfm-session', error: data.message || 'Autorisation refusée' });
      }
    } catch (err) {
      send({ type: 'beartify-lastfm-session', error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  POST /api/lastfm/now-playing
  // ══════════════════════════════════════════════════════════════════
  app.post('/api/lastfm/now-playing', async (req, res) => {
    const { sk, artist, track, album, duration } = req.body || {};
    if (!sk || !artist || !track) return res.status(400).json({ error: 'Paramètres manquants' });
    try {
      const params = {
        method: 'track.updateNowPlaying', api_key: API_KEY, sk,
        artist, track, format: 'json',
        ...(album ? { album } : {}),
        ...(duration ? { duration: String(duration) } : {}),
      };
      params.api_sig = _sign(params);
      const data = await _postForm(params);
      res.json({ ok: !data.error, detail: data });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  POST /api/lastfm/scrobble
  // ══════════════════════════════════════════════════════════════════
  app.post('/api/lastfm/scrobble', async (req, res) => {
    const { sk, artist, track, album, timestamp } = req.body || {};
    if (!sk || !artist || !track || !timestamp) return res.status(400).json({ error: 'Paramètres manquants' });
    try {
      const params = {
        method: 'track.scrobble', api_key: API_KEY, sk,
        'artist[0]': artist, 'track[0]': track, 'timestamp[0]': String(timestamp),
        format: 'json',
        ...(album ? { 'album[0]': album } : {}),
      };
      params.api_sig = _sign(params);
      const data = await _postForm(params);
      res.json({ ok: !data.error, detail: data });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  GET /api/lastfm/config
  //  Fournit la clé API publique au client (nécessaire pour ouvrir le
  //  popup d'autorisation depuis settings.js : window._lastfmApiKey).
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/lastfm/config', (_req, res) => {
    res.json({ apiKey: API_KEY });
  });

  console.log(`✅  Last.fm scrobbling → ${API_KEY ? 'clé API détectée' : 'NON CONFIGURÉ (variables manquantes)'}`);
};
