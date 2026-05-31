// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  v5  (HLS FLAC fMP4 + chiffrement Node.js + Honeypot 1:1)
//  Node.js / Express — port 3001 — loopback uniquement
//
//  Fix v5 :
//   ✅ Chiffrement AES-128-CBC dans Node.js (ffmpeg 7.x ne supporte pas
//      "Encrypted fmp4" → on retire -hls_key_info_file de ffmpeg)
//   ✅ Segments .m4s générés en clair par ffmpeg → chiffrés à la volée
//      par drm.js au moment de les servir via /api/hls/segment
//   ✅ Honeypot : chemin relatif pour -hls_fmp4_init_filename (fix /tmp//tmp/)
//   ✅ #EXT-X-KEY injecté par buildHoneypotM3u8 (ffmpeg ne l'ajoute plus)
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

if (!SESSION_SECRET) {
  console.error('❌ SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

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
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  if (s.itemId !== itemId || s.ip !== clientIp(req)) return null;
  return s;
}

// ── Chiffrement AES-128-CBC d'un Buffer ──────────────────────────────
// Utilisé pour chiffrer chaque segment .m4s à la volée lors du service.
// HLS spec : AES-128-CBC, IV = segment sequence number (big-endian 16 bytes)
// ou IV fixe spécifié dans #EXT-X-KEY. On utilise l'IV de session (fixe).
function encryptSegment(rawBuf, key, ivHex) {
  const iv     = Buffer.from(ivHex, 'hex');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(rawBuf), cipher.final()]);
}

// ── Génération des segments honeypot (FLAC fMP4, non chiffrés) ───────
// Générés SANS chiffrement par ffmpeg — chiffrés à la demande dans /segment.
// Fix path : -hls_fmp4_init_filename = nom seul (pas chemin absolu)
// pour éviter le double /tmp//tmp/... que ffmpeg ajoutait.
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

  // Réutiliser les segments existants (survie aux redémarrages)
  const existing = fs.readdirSync(_honeypotDir)
    .filter(f => /^honey\d+\.m4s$/.test(f))
    .sort()
    .map(f => path.join(_honeypotDir, f));
  if (existing.length > 0) {
    _honeypotSegs = existing;
    console.log(`✅ Honeypot : ${_honeypotSegs.length} segments Rick Roll (cache)`);
    return;
  }

  console.log('[Honeypot] Génération des segments Rick Roll FLAC fMP4...');
  return new Promise((resolve) => {
    // ⚠️  -hls_fmp4_init_filename → NOM SEUL (pas chemin absolu)
    // ffmpeg préfixe avec le dossier de sortie automatiquement.
    // Chemin absolu → /tmp//tmp/xxx_init.mp4 (double slash → erreur)
    const ff = spawn('ffmpeg', [
      '-i',                      HONEYPOT_AUDIO,
      '-vn',
      '-c:a',                    'flac',
      '-ar',                     '44100',
      '-ac',                     '2',
      '-hls_segment_type',       'fmp4',
      '-hls_fmp4_init_filename', 'honey_init.mp4',     // ← nom seul, pas absolu
      '-hls_segment_filename',   path.join(_honeypotDir, 'honey%03d.m4s'),
      '-hls_time',               '4',
      '-hls_list_size',          '0',
      '-y',
      path.join(_honeypotDir, 'honey_playlist.m3u8'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d.toString(); if (ffErr.length > 8192) ffErr = ffErr.slice(-8192); });

    ff.on('close', (code) => {
      if (code === 0) {
        _honeypotSegs = fs.readdirSync(_honeypotDir)
          .filter(f => /^honey\d+\.m4s$/.test(f))
          .sort()
          .map(f => path.join(_honeypotDir, f));
        console.log(`✅ Honeypot : ${_honeypotSegs.length} segments Rick Roll prêts`);
      } else {
        console.error('[Honeypot] ffmpeg échoué code', code,
          '\n' + ffErr.trim().split('\n').slice(-5).join('\n'));
      }
      resolve();
    });
    ff.on('error', (e) => { console.error('[Honeypot] ffmpeg introuvable :', e.message); resolve(); });
  });
}

// ── Transcodage ffmpeg → HLS FLAC fMP4 (sans chiffrement ffmpeg) ─────
function startTranscode(itemId, token, tempDir) {
  const sess = sessions.get(token);
  if (!sess) return;

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  // ⚠️  PAS de -hls_key_info_file : ffmpeg 7.x ne supporte pas le
  //    chiffrement AES sur les segments fMP4 ("Encrypted fmp4 not yet supported").
  //    Les .m4s sont générés en clair. drm.js les chiffre AES-128-CBC
  //    à la volée dans l'endpoint /api/hls/segment.
  // ── Paramètres audio ──────────────────────────────────────────────
  // -c:a flac     : réencodage FLAC→FLAC = sans perte (compression lossless)
  // Pas de -ar    : conserve le sample rate original (44100/48000/96000…)
  // Pas de -ac    : conserve le nombre de canaux original (mono/stéréo/5.1…)
  // Pas de -ab    : FLAC est lossless, le bitrate n'a pas de sens
  // ⚠️  -ar 44100 et -ac 2 ont été RETIRÉS : ils causaient un rééchantillonnage
  //    et un downmix forcés → perte de qualité sur tout contenu hors CD 44.1kHz.
  const ff = spawn('ffmpeg', [
    '-i',                      jellyUrl,
    '-vn',
    '-c:a',                    'flac',
    '-hls_segment_type',       'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename',   path.join(tempDir, 'seg%03d.m4s'),
    '-hls_time',               '4',
    '-hls_list_size',          '0',
    '-hls_flags',              'independent_segments',
    '-y',
    path.join(tempDir, 'playlist.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let _ffStderr = '';
  ff.stderr.on('data', d => {
    _ffStderr += d.toString();
    if (_ffStderr.length > 8192) _ffStderr = _ffStderr.slice(-8192);
  });

  ff.on('close', (code) => {
    const s = sessions.get(token);
    if (code !== 0) {
      const lastLines = _ffStderr.trim().split('\n').slice(-8).join(' | ');
      if (s && !s.ready) s.ffmpegError = `ffmpeg exit ${code} — ${lastLines}`;
      console.error(`[HLS] ffmpeg échoué pour ${itemId} :`, s?.ffmpegError);
    } else {
      console.log(`[HLS] Transcodage terminé : ${itemId}`);
    }
  });
  ff.on('error', (e) => {
    const s = sessions.get(token);
    if (s && !s.ready) s.ffmpegError = `ffmpeg introuvable : ${e.message}`;
    console.error('[HLS] ffmpeg introuvable :', e.message);
  });

  // Polling : ready dès init.mp4 + 2 segments disponibles (~4-8s)
  const watcher = setInterval(() => {
    const s = sessions.get(token);
    if (!s || s.ready || s.ffmpegError) { clearInterval(watcher); return; }
    try {
      const initOk  = fs.existsSync(path.join(tempDir, 'init.mp4'));
      const segCount = fs.readdirSync(tempDir).filter(f => /^seg\d+\.m4s$/.test(f)).length;
      if (initOk && segCount >= 2) {
        s.ready = true;
        clearInterval(watcher);
        console.log(`[HLS] ▶ Prêt (${segCount} segments) — ${itemId}`);
      }
    } catch (_) {}
  }, 300);

  setTimeout(() => {
    clearInterval(watcher);
    const s = sessions.get(token);
    if (s && !s.ready) s.ffmpegError = s.ffmpegError || 'Timeout 120s — ffmpeg installé ?';
  }, 120_000);
}

// ── Construction M3U8 avec #EXT-X-KEY + honeypots ─────────────────────
// ffmpeg génère un M3U8 sans #EXT-X-KEY (pas de chiffrement ffmpeg).
// On injecte manuellement #EXT-X-KEY + #EXT-X-MAP + URLs sécurisées.
// On intercale 1 honeypot Rick Roll après chaque segment réel (HONEYPOT_EVERY=1).
function buildHoneypotM3u8(rawM3u8, itemId, token, ivHex) {
  const lines    = rawM3u8.split('\n');
  const out      = [];
  let realIdx    = 0;
  let honeyIdx   = 0;
  let keyInjected  = false;
  let typeInjected = false;

  // Détecter si le transcodage est terminé (#EXT-X-ENDLIST présent)
  const isComplete = rawM3u8.includes('#EXT-X-ENDLIST');

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // Injecter #EXT-X-PLAYLIST-TYPE juste après #EXT-X-VERSION
    // EVENT  = segments ajoutés en ordre depuis le début (transcodage en cours)
    //          → HLS.js SAIT que le flux commence au segment 0, pas au live edge
    // VOD    = playlist complète statique (transcodage terminé)
    //          → HLS.js traite comme un fichier entier, seek natif
    if (t.startsWith('#EXT-X-VERSION') && !typeInjected) {
      out.push(lines[i]);
      out.push(isComplete
        ? '#EXT-X-PLAYLIST-TYPE:VOD'
        : '#EXT-X-PLAYLIST-TYPE:EVENT');
      typeInjected = true;
      continue;
    }

    // ── #EXT-X-MAP : init segment ─────────────────────────────────
    // Stratégie clé :
    //   AVANT  le MAP → METHOD=NONE  : HLS.js ne tente pas de déchiffrer init.mp4
    //   APRÈS  le MAP → METHOD=AES-128 : tous les segments média sont chiffrés
    // Sans ça, HLS.js applique AES au MAP (servi en clair) → fragDecryptError.
    if (t.startsWith('#EXT-X-MAP')) {
      out.push('#EXT-X-KEY:METHOD=NONE');
      out.push(`#EXT-X-MAP:URI="/api/hls/init/${itemId}?s=${encodeURIComponent(token)}"`);
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="/api/hls/key/${itemId}?s=${encodeURIComponent(token)}",IV=0x${ivHex}`);
      keyInjected = true;
      continue;
    }

    // Si pas de #EXT-X-MAP (segments TS sans init), injecter la clé
    // avant le tout premier segment.
    if (!keyInjected && t.startsWith('#EXTINF')) {
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="/api/hls/key/${itemId}?s=${encodeURIComponent(token)}",IV=0x${ivHex}`);
      keyInjected = true;
    }

    // ── Segments réels + honeypots ────────────────────────────────
    if (t.startsWith('#EXTINF')) {
      out.push(lines[i]);
      i++;
      const segFile = (lines[i] || '').trim();
      if (segFile) {
        const segName = path.basename(segFile.split('?')[0]);
        out.push(`/api/hls/segment/${itemId}/${segName}?s=${encodeURIComponent(token)}`);
      }
      realIdx++;

      if (_honeypotSegs.length > 0 && realIdx % HONEYPOT_EVERY === 0) {
        out.push('');
        out.push('#EXT-X-BEARTIFY-HONEYPOT');
        out.push('#EXTINF:4.000,');
        out.push(`/api/hls/segment/${itemId}/honey_${honeyIdx}.m4s?s=${encodeURIComponent(token)}`);
        honeyIdx++;
      }
      continue;
    }

    out.push(lines[i]);
  }

  return out.join('\n');
}

// ── Nettoyage sessions expirées ───────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of sessions) {
    if (s.expiresAt < now) {
      sessions.delete(tok);
      if (s.tempDir) try { fs.rmSync(s.tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}, 5 * 60 * 1000);

const app = express();

// ── 1. Session HLS ────────────────────────────────────────────────────
app.get('/api/hls/session/:id', async (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: 'ID invalide' });

  const ip        = clientIp(req);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const key       = crypto.randomBytes(16);  // AES-128
  const iv        = crypto.randomBytes(16);
  const token     = generateToken(itemId, ip, expiresAt);
  const safeId    = token.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const tempDir   = path.join(os.tmpdir(), `beartify-${safeId}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Clé et IV stockés uniquement en mémoire (pas de fichiers disque)
    sessions.set(token, {
      itemId, key, iv: iv.toString('hex'),
      ip, expiresAt, tempDir,
      ready: false, ffmpegError: null,
    });

    startTranscode(itemId, token, tempDir);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessionToken: token });

  } catch (err) {
    console.error('[Session] Erreur :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. Clé AES-128 (IP-lockée) ────────────────────────────────────────
app.get('/api/hls/key/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(s.key);
});

// ── 3. Init segment fMP4 ──────────────────────────────────────────────
app.get('/api/hls/init/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();
  const initPath = path.join(s.tempDir, 'init.mp4');
  if (!fs.existsSync(initPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  fs.createReadStream(initPath).pipe(res);
});

// ── 4. Playlist M3U8 avec #EXT-X-KEY + honeypots ─────────────────────
app.get('/api/hls/playlist/:id', async (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).json({ error: 'Session invalide' });

  const deadline = Date.now() + 60_000;
  while (!s.ready && !s.ffmpegError && Date.now() < deadline)
    await new Promise(r => setTimeout(r, 300));

  if (!s.ready) {
    const errDetail = s.ffmpegError || 'Timeout 60s';
    console.error(`[Playlist] Non prêt pour ${req.params.id} :`, errDetail);
    return res.status(500).json({ error: errDetail, hint: 'journalctl -u beartify-drm -n 50' });
  }

  try {
    const raw  = await fs.promises.readFile(path.join(s.tempDir, 'playlist.m3u8'), 'utf8');
    const m3u8 = buildHoneypotM3u8(raw, req.params.id, req.query.s, s.iv);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(m3u8);
  } catch (err) {
    res.status(500).json({ error: 'Playlist indisponible' });
  }
});

// ── 5. Segments (réels + honeypots) — chiffrés AES-128-CBC ───────────
app.get('/api/hls/segment/:id/:seg', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();

  const seg = req.params.seg;
  if (!/^(seg\d{3,6}|honey_\d+)\.m4s$/.test(seg)) return res.status(400).end();

  try {
    let rawBuf;
    if (seg.startsWith('honey_')) {
      // Segment honeypot Rick Roll
      if (_honeypotSegs.length === 0) return res.status(503).end();
      const idx = parseInt(seg.match(/\d+/)[0], 10);
      rawBuf = fs.readFileSync(_honeypotSegs[idx % _honeypotSegs.length]);
    } else {
      // Segment réel FLAC (généré en clair par ffmpeg)
      const segPath = path.join(s.tempDir, seg);
      if (!fs.existsSync(segPath)) return res.status(404).end();
      rawBuf = fs.readFileSync(segPath);
    }

    // Chiffrement AES-128-CBC (ce que ffmpeg aurait fait s'il le supportait)
    // HLS.js utilise la clé de /api/hls/key et l'IV du #EXT-X-KEY pour déchiffrer.
    const encrypted = encryptSegment(rawBuf, s.key, s.iv);

    res.setHeader('Content-Type',   'video/mp4');
    res.setHeader('Content-Length',  encrypted.length);
    res.setHeader('Cache-Control',  'no-store, private');
    res.end(encrypted);

  } catch (err) {
    console.error('[Segment] Erreur :', err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// ── 6. Endpoint diagnostic ────────────────────────────────────────────
app.get('/api/hls/test', (req, res) => {
  const itemId = req.query.item;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: '?item=<jellyfin_id> requis' });

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;
  const ts    = Date.now();
  const tmpDir = path.join(os.tmpdir(), `btest_${ts}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const ff = spawn('ffmpeg', [
    '-i',  jellyUrl,
    '-vn', '-c:a', 'flac', '-t', '5',
    '-hls_segment_type',       'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename',   path.join(tmpDir, 'seg%03d.m4s'),
    '-hls_time', '4', '-hls_list_size', '0',
    '-y', path.join(tmpDir, 'out.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  ff.stderr.on('data', d => { stderr += d.toString(); });
  ff.on('close', (code) => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    res.json({
      success: code === 0,
      exitCode: code,
      stderr_last15: stderr.trim().split('\n').slice(-15).join('\n'),
    });
  });
  ff.on('error', (e) => res.status(500).json({ error: e.message }));
  setTimeout(() => { if (!res.headersSent) { ff.kill(); res.status(500).json({ error: 'Timeout' }); } }, 30000);
});

// ── Healthcheck ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok', sessions: sessions.size,
  honeypot_segs: _honeypotSegs.length,
  honeypot_ratio: `1 sur ${HONEYPOT_EVERY + 1}`,
}));

// ── Démarrage ─────────────────────────────────────────────────────────
generateHoneypotSegments().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`✅  Beartify DRM v5 → 127.0.0.1:${PORT}`);
    console.log(`    Chiffrement : AES-128-CBC dans Node.js (fix ffmpeg 7.x)`);
    console.log(`    Honeypot    : ${_honeypotSegs.length} segments | 1 sur ${HONEYPOT_EVERY + 1}`);
  });
});
