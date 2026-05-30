// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  (HLS Secure Stream Server)
//  Node.js / Express — port 3001 — écoute sur 127.0.0.1 uniquement
//
//  Endpoints HLS :
//   GET /api/hls/session/:id   → démarre ffmpeg, retourne sessionToken
//   GET /api/hls/key/:id?s=   → clé AES-128 (IP-lockée, authentifiée)
//   GET /api/hls/playlist/:id?s= → M3U8 avec vrais + faux segments
//   GET /api/hls/segment/:id/:seg?s= → segment .ts réel (auth requise)
//   GET /api/hls/fake/:seg     → segment honeypot (SANS auth — piège)
//   GET /health                → { status, sessions }
// ══════════════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();

const express        = require('express');
const http           = require('http');
const crypto         = require('crypto');
const path           = require('path');
const fs             = require('fs');
const os             = require('os');
const { spawn }      = require('child_process');

// ── Config ──────────────────────────────────────────────────────────
const PORT           = parseInt(process.env.PORT          || '3001', 10);
const JELLYFIN_HOST  = process.env.JELLYFIN_HOST          || '127.0.0.1';
const JELLYFIN_PORT  = parseInt(process.env.JELLYFIN_PORT || '8096', 10);
const JELLYFIN_TOKEN = process.env.JELLYFIN_TOKEN         || '';
const SESSION_SECRET = process.env.SESSION_SECRET;
// Optionnel : chemin vers un fichier audio pour les segments honeypot
// Ex: HONEYPOT_AUDIO=/opt/beartify-drm/honeypot.mp3
const HONEYPOT_AUDIO = process.env.HONEYPOT_AUDIO         || null;
// Injecter 1 faux segment tous les N vrais (défaut : 3)
const HONEYPOT_EVERY = parseInt(process.env.HONEYPOT_EVERY || '3', 10);

if (!SESSION_SECRET) {
  console.error('❌  SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

// ── Store de sessions HLS ─────────────────────────────────────────────
// Map<token, { itemId, key:Buffer, iv:string, ip, expiresAt,
//              tempDir, ready:bool, ffmpegError:string|null }>
const sessions = new Map();

// Chemin du segment honeypot pré-généré
let _fakeSegPath = null;

// ── Helpers ──────────────────────────────────────────────────────────
function clientIp(req) {
  const raw = req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
}

function generateToken(itemId, ip, expiresAt) {
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${itemId}|${ip}|${expiresAt}`)
    .digest('hex');
  return `${expiresAt}.${sig}`;
}

function validateSession(token, itemId, req) {
  const sess = sessions.get(token);
  if (!sess)                       return null;
  if (Date.now() > sess.expiresAt) { sessions.delete(token); return null; }
  if (sess.itemId !== itemId)      return null;
  if (sess.ip !== clientIp(req))   return null;
  return sess;
}

// ── Génération du segment honeypot au démarrage ───────────────────────
// Un segment MPEG-TS de 4 secondes contenant un son parasite (440 Hz)
// ou l'audio défini par HONEYPOT_AUDIO.
// Servi sans authentification aux outils de téléchargement.
function generateFakeSegment() {
  return new Promise((resolve) => {
    const outPath = path.join(os.tmpdir(), 'beartify-honeypot.ts');

    const inputArgs = HONEYPOT_AUDIO
      ? ['-i', HONEYPOT_AUDIO, '-t', '4']
      : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'];

    const args = [
      ...inputArgs,
      '-c:a', 'aac', '-b:a', '32k',
      '-f', 'mpegts',
      '-y', outPath
    ];

    const ff = spawn('ffmpeg', args, { stdio: 'ignore' });
    ff.on('close', (code) => {
      if (code === 0) {
        _fakeSegPath = outPath;
        console.log('✅ Segment honeypot généré :', outPath);
      } else {
        console.warn('⚠️  ffmpeg honeypot échoué — fallback sur bruit aléatoire');
      }
      resolve();
    });
    ff.on('error', () => {
      console.warn('⚠️  ffmpeg introuvable pour honeypot — fallback sur bruit aléatoire');
      resolve();
    });
  });
}

// ── Transcodage ffmpeg → HLS chiffré AES-128 ─────────────────────────
function startTranscode(itemId, token, tempDir, bitrate) {
  const sess = sessions.get(token);
  if (!sess) return;

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  const args = [
    '-i',                    jellyUrl,
    '-vn',                                   // audio seulement
    '-c:a',                  'aac',
    '-b:a',                  bitrate ? `${Math.floor(bitrate / 1000)}k` : '192k',
    '-hls_time',             '4',            // segments de 4 secondes
    '-hls_list_size',        '0',            // garder tous les segments
    '-hls_key_info_file',    path.join(tempDir, 'key.keyinfo'),
    '-hls_segment_filename', path.join(tempDir, 'seg%03d.ts'),
    '-hls_flags',            'independent_segments',
    '-y',
    path.join(tempDir, 'playlist.m3u8')
  ];

  const ff = spawn('ffmpeg', args, { stdio: 'ignore' });

  ff.on('close', (code) => {
    const s = sessions.get(token);
    if (!s) return;
    if (code === 0) {
      s.ready = true;
      console.log(`[HLS] Transcodage terminé pour ${itemId}`);
    } else {
      s.ffmpegError = `ffmpeg code de sortie ${code}`;
      console.error(`[HLS] ffmpeg échoué pour ${itemId} (code ${code})`);
    }
  });

  ff.on('error', (err) => {
    const s = sessions.get(token);
    if (s) s.ffmpegError = `ffmpeg non disponible : ${err.message}`;
    console.error('[HLS] Impossible de lancer ffmpeg :', err.message);
  });
}

// ── Génération du M3U8 avec segments honeypot ─────────────────────────
// Principe :
//  - Segments réels   → /api/hls/segment/:id/:seg?s=TOKEN (auth requise)
//  - Segments honeypot → /api/hls/fake/honey_N.ts         (sans auth)
//  - Tag custom avant chaque honeypot → filtré par HLS.js côté client
//  - Un téléchargeur qui récupère le M3U8 brut obtient les deux types
//    de segments → fichier final corrompu par le son parasite.
function buildHoneypotM3u8(rawM3u8, itemId, token, ivHex) {
  const lines = rawM3u8.split('\n');
  const out   = [];
  let segIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();

    // Remplacer le header EXT-X-KEY par notre endpoint authentifié
    if (trimmed.startsWith('#EXT-X-KEY')) {
      out.push(
        `#EXT-X-KEY:METHOD=AES-128,` +
        `URI="/api/hls/key/${itemId}?s=${encodeURIComponent(token)}",` +
        `IV=0x${ivHex}`
      );
      continue;
    }

    // À chaque segment réel, injecter un honeypot tous les N segments
    if (trimmed.startsWith('#EXTINF')) {
      if (segIndex > 0 && segIndex % HONEYPOT_EVERY === 0) {
        out.push('');
        out.push('#EXT-X-BEARTIFY-HONEYPOT');      // tag filtré par HLS.js custom loader
        out.push('#EXTINF:4.000,');
        out.push(`/api/hls/fake/honey_${segIndex}.ts`);
      }

      // Réécrire l'URL du vrai segment avec le token
      out.push(line);
      i++;
      const segFile = (lines[i] || '').trim();
      if (segFile) {
        const segName = path.basename(segFile);
        out.push(`/api/hls/segment/${itemId}/${segName}?s=${encodeURIComponent(token)}`);
      }
      segIndex++;
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

// ── Nettoyage automatique des sessions expirées ───────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt < now) {
      sessions.delete(token);
      if (sess.tempDir) {
        try { fs.rmSync(sess.tempDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  }
}, 5 * 60 * 1000);

const app = express();

// ══════════════════════════════════════════════════════════════════════
//  1. Créer une session HLS
//  GET /api/hls/session/:id[?bitrate=N]
//
//  - Génère une clé AES-128 + IV
//  - Crée le répertoire temporaire des segments
//  - Lance ffmpeg en arrière-plan (transcodage Jellyfin → HLS chiffré)
//  - Retourne { sessionToken }
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/session/:id', async (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: 'ID invalide' });

  const ip        = clientIp(req);
  const bitrate   = req.query.bitrate ? parseInt(req.query.bitrate, 10) : null;
  const key       = crypto.randomBytes(16);    // AES-128 (16 octets)
  const iv        = crypto.randomBytes(16);
  const expiresAt = Date.now() + 30 * 60 * 1000; // TTL 30 min
  const token     = generateToken(itemId, ip, expiresAt);

  // Répertoire temporaire unique par session
  const safeId  = token.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const tempDir = path.join(os.tmpdir(), `beartify-${safeId}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Fichier clé binaire pour ffmpeg
    await fs.promises.writeFile(path.join(tempDir, 'key.bin'), key);

    // Fichier keyinfo : URI_dans_M3U8 \n chemin_local_clé \n IV_hex
    const keyUri  = `/api/hls/key/${itemId}?s=${encodeURIComponent(token)}`;
    const keyInfo = `${keyUri}\n${path.join(tempDir, 'key.bin')}\n${iv.toString('hex')}`;
    await fs.promises.writeFile(path.join(tempDir, 'key.keyinfo'), keyInfo);

    sessions.set(token, {
      itemId, key, iv: iv.toString('hex'),
      ip, expiresAt, tempDir,
      ready: false, ffmpegError: null,
    });

    // Lancer ffmpeg en arrière-plan
    startTranscode(itemId, token, tempDir, bitrate);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessionToken: token });

  } catch (err) {
    console.error('[HLS] Erreur session :', err.message);
    res.status(500).json({ error: 'Création session échouée' });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  2. Clé AES-128
//  GET /api/hls/key/:id?s=TOKEN
//
//  Authentifiée + IP-lockée.
//  HLS.js la récupère une fois et la met en cache pour tous les segments.
//  Un téléchargeur depuis une autre IP ne peut pas l'obtenir.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/key/:id', (req, res) => {
  const sess = validateSession(req.query.s, req.params.id, req);
  if (!sess) return res.status(401).end();

  res.setHeader('Content-Type',  'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(sess.key);
});

// ══════════════════════════════════════════════════════════════════════
//  3. Playlist M3U8 avec segments honeypot
//  GET /api/hls/playlist/:id?s=TOKEN
//
//  Attend la fin du transcodage ffmpeg (max 90s), puis retourne
//  le M3U8 modifié avec vrais segments + faux segments honeypot.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/playlist/:id', async (req, res) => {
  const sess = validateSession(req.query.s, req.params.id, req);
  if (!sess) return res.status(401).json({ error: 'Session invalide' });

  // Attendre la fin du transcodage ffmpeg (polling toutes les 500ms, max 90s)
  const deadline = Date.now() + 90_000;
  while (!sess.ready && !sess.ffmpegError && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (!sess.ready) {
    return res.status(500).json({
      error: sess.ffmpegError || 'Timeout transcodage — vérifier que ffmpeg est installé',
    });
  }

  try {
    const rawM3u8      = await fs.promises.readFile(path.join(sess.tempDir, 'playlist.m3u8'), 'utf8');
    const honeypotM3u8 = buildHoneypotM3u8(rawM3u8, req.params.id, req.query.s, sess.iv);

    res.setHeader('Content-Type',  'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(honeypotM3u8);
  } catch (err) {
    console.error('[HLS] Lecture playlist :', err.message);
    res.status(500).json({ error: 'Playlist indisponible' });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  4. Segments réels chiffrés (AES-128)
//  GET /api/hls/segment/:id/:seg?s=TOKEN
//
//  Authentifié + IP-locké.
//  Sert les fichiers .ts chiffrés générés par ffmpeg.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/segment/:id/:seg', (req, res) => {
  const sess = validateSession(req.query.s, req.params.id, req);
  if (!sess) return res.status(401).end();

  const seg = req.params.seg;
  // Whitelist stricte du nom de segment
  if (!/^seg\d{3,6}\.ts$/.test(seg)) return res.status(400).end();

  const segPath = path.join(sess.tempDir, seg);
  if (!fs.existsSync(segPath)) return res.status(404).end();

  res.setHeader('Content-Type',           'video/mp2t');
  res.setHeader('Cache-Control',          'no-store, private');
  res.setHeader('Content-Disposition',    'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  fs.createReadStream(segPath).pipe(res);
});

// ══════════════════════════════════════════════════════════════════════
//  5. Segments honeypot (piège — SANS authentification)
//  GET /api/hls/fake/:seg
//
//  Servis volontairement SANS token pour que les outils de téléchargement
//  puissent les récupérer.
//  Contenu : son parasite (440 Hz) ou bruit aléatoire.
//  Résultat pour le téléchargeur : son parasite toutes les ~12 secondes
//  dans le fichier téléchargé, rendant l'écoute impossible.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/fake/:seg', (_req, res) => {
  res.setHeader('Content-Type', 'video/mp2t');
  // Cache-Control public : on encourage les outils à le stocker
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (_fakeSegPath && fs.existsSync(_fakeSegPath)) {
    fs.createReadStream(_fakeSegPath).pipe(res);
  } else {
    // Fallback : 100 paquets MPEG-TS de 188 bytes de bruit aléatoire
    res.end(crypto.randomBytes(188 * 100));
  }
});

// ── Healthcheck ──────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, honeypot: !!_fakeSegPath });
});

// ── Démarrage ────────────────────────────────────────────────────────
generateFakeSegment().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`✅  Beartify DRM Server  →  127.0.0.1:${PORT}`);
    console.log(`    Honeypot  : ${_fakeSegPath ? 'son parasite (440 Hz)' : 'bruit aléatoire'}`);
    console.log(`    Fréquence : 1 honeypot tous les ${HONEYPOT_EVERY} segments réels`);
  });
});
