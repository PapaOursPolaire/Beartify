// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  v6
//  Node.js / Express — port 3001 — loopback uniquement
//
//  v6 — Toutes les améliorations sécurité + performance :
//   ✅ Fix 1 : Tag honeypot aléatoire par session (anti-filtrage)
//   ✅ Fix 2 : IV différent par segment (numéro de séquence HLS)
//   ✅ Fix 3 : Kill ffmpeg à la destruction de session (anti-fuite)
//   ✅ Fix 4 : Renouvellement automatique de session avant expiration
//   ✅ Fix 5 : Segments servis en async stream (non-bloquant)
//   ✅ Fix 6 : FLAC lossless sans -ar/-ac (passthrough sample rate/canaux)
// ══════════════════════════════════════════════════════════════════════
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
const HONEYPOT_EVERY = parseInt(process.env.HONEYPOT_EVERY || '1', 10);
// TTL session en millisecondes (défaut 30 min)
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || String(30 * 60 * 1000), 10);
// Renouvellement automatique si moins de X ms avant expiration (défaut 5 min)
const SESSION_RENEW_THRESHOLD_MS = 5 * 60 * 1000;

if (!SESSION_SECRET) {
  console.error('❌ SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════
//  Store de sessions
//  Map<token, {
//    itemId, key:Buffer, ip, expiresAt, tempDir,
//    ready:bool, ffmpegError:string|null,
//    ffProcess: ChildProcess|null,   ← Fix 3 : référence pour kill
//    honeypotTag: string,            ← Fix 1 : tag aléatoire par session
//    segCount: number,               ← nombre de segments générés
//  }>
// ══════════════════════════════════════════════════════════════════════
const sessions    = new Map();
let _honeypotDir  = null;
let _honeypotSegs = [];

// ── Helpers ──────────────────────────────────────────────────────────
function clientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress || ''
  ).replace(/^::ffff:/, '');
}

function generateToken(itemId, ip, expiresAt) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET)
    .update(`${itemId}|${ip}|${expiresAt}`).digest('hex');
  return `${expiresAt}.${sig}`;
}

function validateSession(token, itemId, req) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { destroySession(token); return null; }
  if (s.itemId !== itemId || s.ip !== clientIp(req)) return null;
  return s;
}

// ── Fix 3 : Destruction propre d'une session ─────────────────────────
// Tue ffmpeg si encore en cours, supprime le tempDir, retire de la Map.
function destroySession(token) {
  const s = sessions.get(token);
  if (!s) return;
  sessions.delete(token);
  // Tuer ffmpeg proprement (SIGTERM d'abord, SIGKILL après 2s si nécessaire)
  if (s.ffProcess && !s.ffProcess.killed) {
    try {
      s.ffProcess.kill('SIGTERM');
      setTimeout(() => {
        if (s.ffProcess && !s.ffProcess.killed) {
          try { s.ffProcess.kill('SIGKILL'); } catch (_) {}
        }
      }, 2000);
    } catch (_) {}
  }
  // Supprimer les fichiers temporaires
  if (s.tempDir) {
    try { fs.rmSync(s.tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ── Fix 2 : Calcul de l'IV par numéro de segment ─────────────────────
// HLS spec §4.3.2.4 : l'IV par défaut est le numéro de séquence
// encodé en big-endian sur 16 octets.
// Cryptographiquement plus solide qu'un IV fixe.
function segmentIv(mediaSequence) {
  const iv = Buffer.alloc(16, 0);
  iv.writeUInt32BE(mediaSequence >>> 0, 12);
  return iv;
}

// ── Fix 5 : Chiffrement async d'un segment ───────────────────────────
// Lit le fichier en stream, chiffre chunk par chunk (non-bloquant).
// Retourne une Promise<Buffer>.
function encryptSegmentAsync(filePath, key, iv) {
  return new Promise((resolve, reject) => {
    const cipher  = crypto.createCipheriv('aes-128-cbc', key, iv);
    const chunks  = [];
    const stream  = fs.createReadStream(filePath);
    stream.on('data', chunk => chunks.push(cipher.update(chunk)));
    stream.on('end',  ()    => {
      chunks.push(cipher.final());
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', reject);
  });
}

// ── Chiffrement async d'un Buffer (pour honeypots déjà en mémoire) ───
function encryptBufferAsync(buf, key, iv) {
  return new Promise((resolve, reject) => {
    try {
      const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
      resolve(Buffer.concat([cipher.update(buf), cipher.final()]));
    } catch (e) { reject(e); }
  });
}

// ── Fix 4 : Renouvellement automatique de session ────────────────────
// Appelé lors de chaque requête segment. Si la session expire dans
// moins de SESSION_RENEW_THRESHOLD_MS, on prolonge son TTL.
function maybeRenewSession(token) {
  const s = sessions.get(token);
  if (!s) return;
  if (s.expiresAt - Date.now() < SESSION_RENEW_THRESHOLD_MS) {
    s.expiresAt = Date.now() + SESSION_TTL_MS;
    console.log(`[Session] Renouvelée : ${s.itemId} (nouveau TTL ${SESSION_TTL_MS / 60000} min)`);
  }
}

// ── Nettoyage automatique des sessions expirées ───────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of sessions) {
    if (s.expiresAt < now) {
      console.log(`[Session] Expirée (nettoyage) : ${s.itemId}`);
      destroySession(tok);
    }
  }
}, 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════
//  Génération des segments honeypot (Rick Roll, FLAC fMP4, sans chiffrement)
// ══════════════════════════════════════════════════════════════════════
async function generateHoneypotSegments() {
  if (!HONEYPOT_AUDIO) {
    console.warn('[Honeypot] HONEYPOT_AUDIO non défini — honeypots désactivés');
    return;
  }
  if (!fs.existsSync(HONEYPOT_AUDIO)) {
    console.warn('[Honeypot] Fichier introuvable :', HONEYPOT_AUDIO);
    return;
  }

  _honeypotDir = path.join(os.tmpdir(), 'beartify-honeypot');
  await fs.promises.mkdir(_honeypotDir, { recursive: true });

  const existing = fs.readdirSync(_honeypotDir)
    .filter(f => /^honey\d+\.m4s$/.test(f)).sort()
    .map(f => path.join(_honeypotDir, f));
  if (existing.length > 0) {
    _honeypotSegs = existing;
    console.log(`✅ Honeypot : ${_honeypotSegs.length} segments Rick Roll (cache)`);
    return;
  }

  console.log('[Honeypot] Génération des segments Rick Roll FLAC fMP4...');
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-i',                      HONEYPOT_AUDIO,
      '-vn',
      '-c:a',                    'flac',
      '-ar',                     '44100',  // normalisation pour compat. init.mp4
      '-ac',                     '2',
      '-hls_segment_type',       'fmp4',
      '-hls_fmp4_init_filename', 'honey_init.mp4',
      '-hls_segment_filename',   path.join(_honeypotDir, 'honey%03d.m4s'),
      '-hls_time',               '4',
      '-hls_list_size',          '0',
      '-y',
      path.join(_honeypotDir, 'honey_playlist.m3u8'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d; if (ffErr.length > 8192) ffErr = ffErr.slice(-8192); });
    ff.on('close', (code) => {
      if (code === 0) {
        _honeypotSegs = fs.readdirSync(_honeypotDir)
          .filter(f => /^honey\d+\.m4s$/.test(f)).sort()
          .map(f => path.join(_honeypotDir, f));
        console.log(`✅ Honeypot : ${_honeypotSegs.length} segments Rick Roll prêts`);
      } else {
        console.error('[Honeypot] ffmpeg échoué :', ffErr.trim().split('\n').slice(-3).join(' | '));
      }
      resolve();
    });
    ff.on('error', (e) => { console.error('[Honeypot] ffmpeg introuvable :', e.message); resolve(); });
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Transcodage ffmpeg → HLS FLAC fMP4 (segments en clair sur disque)
// ══════════════════════════════════════════════════════════════════════
function startTranscode(itemId, token, tempDir) {
  const sess = sessions.get(token);
  if (!sess) return;

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  const ff = spawn('ffmpeg', [
    '-i',                      jellyUrl,
    '-vn',
    '-c:a',                    'flac',     // LOSSLESS — sans -ar ni -ac (passthrough)
    '-hls_segment_type',       'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename',   path.join(tempDir, 'seg%03d.m4s'),
    '-hls_time',               '4',
    '-hls_list_size',          '0',
    '-hls_flags',              'independent_segments',
    '-y',
    path.join(tempDir, 'playlist.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Fix 3 : stocker la référence du processus pour pouvoir le tuer
  sess.ffProcess = ff;

  let _ffStderr = '';
  ff.stderr.on('data', d => {
    _ffStderr += d;
    if (_ffStderr.length > 8192) _ffStderr = _ffStderr.slice(-8192);
  });

  ff.on('close', (code) => {
    const s = sessions.get(token);
    if (s) s.ffProcess = null; // processus terminé, plus besoin de la référence
    if (code !== 0 && code !== null) {
      const last = _ffStderr.trim().split('\n').slice(-8).join(' | ');
      if (s && !s.ready) s.ffmpegError = `ffmpeg exit ${code} — ${last}`;
      console.error(`[HLS] ffmpeg échoué pour ${itemId} :`, s?.ffmpegError);
    } else if (code === 0) {
      if (s) { s.ready = true; s.ffmpegDone = true; } console.log(`[HLS] Transcodage terminé : ${itemId}`);
    }
  });
  ff.on('error', (e) => {
    const s = sessions.get(token);
    if (s) { s.ffProcess = null; if (!s.ready) s.ffmpegError = `ffmpeg introuvable : ${e.message}`; }
    console.error('[HLS] ffmpeg introuvable :', e.message);
  });

  // Polling : ready dès init.mp4 + 2 segments disponibles
  const watcher = setInterval(() => {
    const s = sessions.get(token);
    if (!s || s.ready || s.ffmpegError) { clearInterval(watcher); return; }
    try {
      const initOk   = fs.existsSync(path.join(tempDir, 'init.mp4'));
      const segFiles = fs.readdirSync(tempDir).filter(f => /^seg\d+\.m4s$/.test(f));
      s.segCount = segFiles.length;
      if (initOk && segFiles.length >= 2) {
        s.ready = true;
        clearInterval(watcher);
        console.log(`[HLS] ▶ Prêt (${segFiles.length} segments) — ${itemId}`);
      }
    } catch (_) {}
  }, 300);

  setTimeout(() => {
    clearInterval(watcher);
    const s = sessions.get(token);
    if (s && !s.ready) s.ffmpegError = s.ffmpegError || 'Timeout 120s';
  }, 120_000);
}

// ══════════════════════════════════════════════════════════════════════
//  Construction M3U8 avec :
//   - Fix 1 : tag honeypot aléatoire (stocké dans sess.honeypotTag)
//   - Fix 2 : IV par numéro de séquence dans #EXT-X-KEY
//   - METHOD=NONE avant MAP, METHOD=AES-128 après MAP
//   - PLAYLIST-TYPE:EVENT ou VOD selon état transcodage
// ══════════════════════════════════════════════════════════════════════
function buildHoneypotM3u8(rawM3u8, itemId, token, sess) {
  const lines       = rawM3u8.split('\n');
  const out         = [];
  let realIdx       = 0;
  let honeyIdx      = 0;
  let keyInjected   = false;
  let typeInjected  = false;
  let seqNumber     = 0;   // numéro de séquence pour IV par segment

  // Lire le numéro de séquence initial depuis le M3U8
  const seqMatch = rawM3u8.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  if (seqMatch) seqNumber = parseInt(seqMatch[1], 10);

  const isComplete    = rawM3u8.includes('#EXT-X-ENDLIST');
  // Fix 1 : utiliser le tag aléatoire de cette session
  const honeypotTag   = sess.honeypotTag;

  // Construire l'URL de clé (Fix 2 : sans IV fixe — l'IV sera par segment)
  const keyUri = `/api/hls/key/${itemId}?s=${encodeURIComponent(token)}`;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // ── PLAYLIST-TYPE ─────────────────────────────────────────────
    if (t.startsWith('#EXT-X-VERSION') && !typeInjected) {
      out.push(lines[i]);
      out.push(isComplete ? '#EXT-X-PLAYLIST-TYPE:VOD' : '#EXT-X-PLAYLIST-TYPE:EVENT');
      typeInjected = true;
      continue;
    }

    // ── MAP (init segment) : METHOD=NONE → MAP → METHOD=AES-128 ──
    if (t.startsWith('#EXT-X-MAP')) {
      out.push('#EXT-X-KEY:METHOD=NONE');
      out.push(`#EXT-X-MAP:URI="/api/hls/init/${itemId}?s=${encodeURIComponent(token)}"`);
      // Fix 2 : IV du premier segment = numéro de séquence initial
      const ivHex = segmentIv(seqNumber).toString('hex');
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);
      keyInjected = true;
      continue;
    }

    // Si pas de MAP (TS legacy), injecter clé avant le 1er segment
    if (!keyInjected && t.startsWith('#EXTINF')) {
      const ivHex = segmentIv(seqNumber).toString('hex');
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);
      keyInjected = true;
    }

    // ── Segments réels ────────────────────────────────────────────
    if (t.startsWith('#EXTINF')) {
      // Fix 2 : mettre à jour l'IV avant chaque segment réel
      const ivHex = segmentIv(seqNumber).toString('hex');
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);

      out.push(lines[i]);
      i++;
      const segFile = (lines[i] || '').trim();
      if (segFile) {
        const segName = path.basename(segFile.split('?')[0]);
        // Passer le numéro de séquence pour le déchiffrement côté serveur
        out.push(`/api/hls/segment/${itemId}/${segName}?s=${encodeURIComponent(token)}&seq=${seqNumber}`);
      }
      realIdx++;
      seqNumber++;

      // ── Honeypot intercalé ──────────────────────────────────────
      if (_honeypotSegs.length > 0 && realIdx % HONEYPOT_EVERY === 0) {
        // Fix 1 : tag aléatoire par session
        out.push('');
        out.push(`#${honeypotTag}`);
        // Fix 2 : IV du segment honeypot = son propre numéro de séquence
        const honeyIvHex = segmentIv(seqNumber).toString('hex');
        out.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${honeyIvHex}`);
        out.push('#EXTINF:4.000,');
        out.push(`/api/hls/segment/${itemId}/honey_${honeyIdx}.m4s?s=${encodeURIComponent(token)}&seq=${seqNumber}`);
        honeyIdx++;
        seqNumber++;
      }
      continue;
    }

    out.push(lines[i]);
  }

  return out.join('\n');
}

const app = express();

// ══════════════════════════════════════════════════════════════════════
//  1. Créer une session HLS
//  GET /api/hls/session/:id
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/session/:id', async (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: 'ID invalide' });

  const ip        = clientIp(req);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const key       = crypto.randomBytes(16);  // AES-128
  const token     = generateToken(itemId, ip, expiresAt);
  const safeId    = token.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const tempDir   = path.join(os.tmpdir(), `beartify-${safeId}`);

  // Fix 1 : tag honeypot aléatoire et opaque (ressemble à un tag HLS inconnu)
  // Format : EXT-X- suivi de 12 caractères hex → indiscernable d'un vrai tag HLS
  const honeypotTag = 'EXT-X-' + crypto.randomBytes(6).toString('hex').toUpperCase();

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    sessions.set(token, {
      itemId, key, ip, expiresAt, tempDir,
      ready: false, ffmpegDone: false, ffmpegError: null,
      ffProcess: null,     // Fix 3
      honeypotTag,         // Fix 1
      segCount: 0,
    });

    startTranscode(itemId, token, tempDir);

    res.setHeader('Cache-Control', 'no-store');
    // Retourner aussi le honeypotTag pour que le client puisse le filtrer
    res.json({ sessionToken: token, honeypotTag });

  } catch (err) {
    console.error('[Session] Erreur :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  2. Clé AES-128 (IP-lockée)
//  GET /api/hls/key/:id?s=TOKEN
//  Fix 4 : renouvelle la session à chaque accès à la clé
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/key/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  maybeRenewSession(req.query.s);  // Fix 4
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(s.key);
});

// ══════════════════════════════════════════════════════════════════════
//  3. Init segment fMP4 (non chiffré, METHOD=NONE dans le M3U8)
//  GET /api/hls/init/:id?s=TOKEN
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/init/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  const initPath = path.join(s.tempDir, 'init.mp4');
  if (!fs.existsSync(initPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  // Fix 5 : stream async
  fs.createReadStream(initPath).pipe(res);
});

// ══════════════════════════════════════════════════════════════════════
//  4. Playlist M3U8
//  GET /api/hls/playlist/:id?s=TOKEN
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/playlist/:id', async (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).json({ error: 'Session invalide' });

  const deadline = Date.now() + 60_000;
  while (!s.ffmpegDone && !s.ffmpegError && Date.now() < deadline)
    await new Promise(r => setTimeout(r, 300));

  if (!s.ffmpegDone) {
    const err = s.ffmpegError || 'Timeout 60s';
    return res.status(500).json({ error: err, hint: 'journalctl -u beartify-drm -n 50' });
  }

  try {
    const raw  = await fs.promises.readFile(path.join(s.tempDir, 'playlist.m3u8'), 'utf8');
    const m3u8 = buildHoneypotM3u8(raw, req.params.id, req.query.s, s);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(m3u8);
  } catch (err) {
    res.status(500).json({ error: 'Playlist indisponible' });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  5. Segments (réels + honeypots) — chiffrés AES-128-CBC
//  GET /api/hls/segment/:id/:seg?s=TOKEN&seq=N
//
//  Fix 2 : IV = segmentIv(seq) — numéro de séquence passé en query
//  Fix 5 : lecture async (non-bloquant)
//  Fix 4 : renouvellement de session à chaque segment
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/segment/:id/:seg', async (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();

  const seg = req.params.seg;
  if (!/^(seg\d{3,6}|honey_\d+)\.m4s$/.test(seg)) return res.status(400).end();

  // Fix 4 : renouveler la session à chaque segment consommé
  maybeRenewSession(req.query.s);

  // Fix 2 : IV par numéro de séquence
  const seqNum = parseInt(req.query.seq || '0', 10);
  const iv     = segmentIv(seqNum);

  try {
    let encrypted;

    if (seg.startsWith('honey_')) {
      // ── Segment honeypot (Rick Roll) ────────────────────────────
      if (_honeypotSegs.length === 0) return res.status(503).end();
      const idx      = parseInt(seg.match(/\d+/)[0], 10);
      const honeyBuf = await fs.promises.readFile(_honeypotSegs[idx % _honeypotSegs.length]);
      // Fix 5 + Fix 2 : chiffrement async avec IV par séquence
      encrypted = await encryptBufferAsync(honeyBuf, s.key, iv);
    } else {
      // ── Segment réel (FLAC, en clair sur disque) ─────────────────
      const segPath = path.join(s.tempDir, seg);
      if (!fs.existsSync(segPath)) return res.status(404).end();
      // Fix 5 + Fix 2 : stream async avec IV par séquence
      encrypted = await encryptSegmentAsync(segPath, s.key, iv);
    }

    res.setHeader('Content-Type',   'video/mp4');
    res.setHeader('Content-Length',  encrypted.length);
    res.setHeader('Cache-Control',  'no-store, private');
    res.end(encrypted);

  } catch (err) {
    console.error('[Segment] Erreur :', err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// ══════════════════════════════════════════════════════════════════════
//  6. Endpoint diagnostic
//  GET /api/hls/test?item=ITEM_ID
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/test', (req, res) => {
  const itemId = req.query.item;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: '?item=<jellyfin_id> requis' });

  const ts     = Date.now();
  const tmpDir = path.join(os.tmpdir(), `btest_${ts}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  const ff = spawn('ffmpeg', [
    '-i',  jellyUrl, '-vn', '-c:a', 'flac', '-t', '5',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename',   path.join(tmpDir, 'seg%03d.m4s'),
    '-hls_time', '4', '-hls_list_size', '0',
    '-y', path.join(tmpDir, 'out.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  ff.stderr.on('data', d => { stderr += d; });
  ff.on('close', (code) => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    res.json({ success: code === 0, exitCode: code,
               stderr_last15: stderr.trim().split('\n').slice(-15).join('\n') });
  });
  ff.on('error', (e) => !res.headersSent && res.status(500).json({ error: e.message }));
  setTimeout(() => { if (!res.headersSent) { ff.kill(); res.status(500).json({ error: 'Timeout 30s' }); } }, 30000);
});

// ── Healthcheck ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok', sessions: sessions.size,
  honeypot_segs:  _honeypotSegs.length,
  honeypot_ratio: `1 sur ${HONEYPOT_EVERY + 1}`,
}));

// ── Démarrage ─────────────────────────────────────────────────────────
generateHoneypotSegments().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`✅  Beartify DRM v6 → 127.0.0.1:${PORT}`);
    console.log(`    Chiffrement : AES-128-CBC, IV par numéro de séquence`);
    console.log(`    Honeypot    : ${_honeypotSegs.length} segs | tag aléatoire | 1 sur ${HONEYPOT_EVERY + 1}`);
    console.log(`    Session TTL : ${SESSION_TTL_MS / 60000} min (renouvellement auto actif)`);
  });
});
