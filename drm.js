// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — drm.js  v4  (HLS FLAC fMP4 + Honeypot 1:1)
//  Node.js / Express — port 3001 — loopback uniquement
//
//  Améliorations v4 :
//   ✅ FLAC lossless via fMP4 (pas de ré-encodage AAC)
//   ✅ Démarrage rapide : lecture dès init.mp4 + 2 segments dispo
//   ✅ Honeypot 1 sur 2 : chaque segment réel = 1 segment Rick Roll
//   ✅ Honeypot authentifié et chiffré → VDH ne peut plus les ignorer
//   ✅ HLS live-like polling → HLS.js lit au fur et à mesure
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
// HONEYPOT_EVERY=1 → 1 honeypot après chaque segment réel (50%)
// HONEYPOT_EVERY=2 → 1 honeypot tous les 2 segments réels (33%)
const HONEYPOT_EVERY = parseInt(process.env.HONEYPOT_EVERY || '1', 10);

if (!SESSION_SECRET) {
  console.error('❌ SESSION_SECRET manquant dans .env — arrêt.');
  process.exit(1);
}

// ── Sessions en mémoire ──────────────────────────────────────────────
const sessions = new Map();

// Segments Rick Roll pré-générés (FLAC fMP4, sans chiffrement)
let _honeypotDir  = null;
let _honeypotSegs = [];   // chemins des .m4s Rick Roll

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
    .update(`${itemId}|${ip}|${expiresAt}`)
    .digest('hex');
  return `${expiresAt}.${sig}`;
}

function validateSession(token, itemId, req) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  if (s.itemId !== itemId)      return null;
  if (s.ip !== clientIp(req))   return null;
  return s;
}

// ── Génération des segments honeypot (Rick Roll FLAC fMP4) ───────────
// Exécuté une seule fois au démarrage du serveur.
// Les segments sont réutilisés pour toutes les sessions (sans chiffrement).
// Le chiffrement AES est appliqué à la demande dans l'endpoint /segment.
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

  // Vérifier si déjà générés (survie aux redémarrages)
  const existing = fs.readdirSync(_honeypotDir)
    .filter(f => /^honey\d+\.m4s$/.test(f))
    .sort()
    .map(f => path.join(_honeypotDir, f));

  if (existing.length > 0) {
    _honeypotSegs = existing;
    console.log(`✅ Honeypot déjà généré : ${_honeypotSegs.length} segments Rick Roll`);
    return;
  }

  console.log('[Honeypot] Génération des segments Rick Roll FLAC fMP4...');

  return new Promise((resolve) => {
    // Même codec/params que les segments réels → init.mp4 compatible
    const ffArgs = [
      '-i',                  HONEYPOT_AUDIO,
      '-vn',
      '-c:a',                'flac',
      '-ar',                 '44100',
      '-ac',                 '2',
      '-hls_segment_type',   'fmp4',
      '-hls_fmp4_init_filename', path.join(_honeypotDir, 'honey_init.mp4'),
      '-hls_segment_filename',   path.join(_honeypotDir, 'honey%03d.m4s'),
      '-hls_time',           '4',
      '-hls_list_size',      '0',
      '-y',
      path.join(_honeypotDir, 'honey_playlist.m3u8'),
    ];
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d.toString(); });

    ff.on('close', (code) => {
      if (code === 0) {
        _honeypotSegs = fs.readdirSync(_honeypotDir)
          .filter(f => /^honey\d+\.m4s$/.test(f))
          .sort()
          .map(f => path.join(_honeypotDir, f));
        console.log(`✅ Honeypot : ${_honeypotSegs.length} segments Rick Roll prêts`);
      } else {
        console.error('[Honeypot] ffmpeg échoué code', code);
        // Afficher les 5 dernières lignes d'erreur ffmpeg
        const errLines = ffErr.trim().split('\n').slice(-5).join('\n');
        console.error('[Honeypot] stderr ffmpeg :\n' + errLines);
      }
      resolve();
    });
    ff.on('error', (e) => {
      console.error('[Honeypot] ffmpeg introuvable :', e.message);
      resolve();
    });
  });
}

// ── Transcodage ffmpeg → HLS FLAC fMP4 AES-128 ──────────────────────
// Lance ffmpeg en arrière-plan.
// Détection progressive : marque la session ready dès init.mp4 + 2 segments dispo.
// HLS.js commence à jouer sans attendre la fin du transcodage.
function startTranscode(itemId, token, tempDir) {
  const sess = sessions.get(token);
  if (!sess) return;

  // URL Jellyfin interne — static=true → fichier FLAC original
  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  // Capturer stderr pour diagnostic si ffmpeg échoue
  const ff = spawn('ffmpeg', [
    '-i',                      jellyUrl,
    '-vn',
    '-c:a',                    'flac',
    '-ar',                     '44100',
    '-ac',                     '2',
    '-hls_segment_type',       'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_key_info_file',      path.join(tempDir, 'key.keyinfo'),
    '-hls_segment_filename',   path.join(tempDir, 'seg%03d.m4s'),
    '-hls_time',               '4',
    '-hls_list_size',          '0',
    '-hls_flags',              'independent_segments',
    '-y',
    path.join(tempDir, 'playlist.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Accumuler stderr ffmpeg pour le reporter en cas d'erreur
  let _ffStderr = '';
  ff.stderr.on('data', d => {
    _ffStderr += d.toString();
    // Garder seulement les 8 dernières Ko pour ne pas saturer la mémoire
    if (_ffStderr.length > 8192) _ffStderr = _ffStderr.slice(-8192);
  });

  ff.on('close', (code) => {
    const s = sessions.get(token);
    if (code !== 0) {
      const lastLines = _ffStderr.trim().split('\n').slice(-8).join(' | ');
      const errMsg = `ffmpeg exit ${code} — ${lastLines}`;
      if (s && !s.ready) s.ffmpegError = errMsg;
      console.error(`[HLS] ffmpeg échoué pour ${itemId} :`, errMsg);
    } else {
      console.log(`[HLS] Transcodage terminé : ${itemId}`);
    }
  });
  ff.on('error', (e) => {
    const s = sessions.get(token);
    if (s && !s.ready) s.ffmpegError = `ffmpeg introuvable : ${e.message}`;
    console.error('[HLS] ffmpeg introuvable :', e.message);
  });

  // ── Détection progressive ─────────────────────────────────────────
  // Polling toutes les 300ms. Dès init.mp4 + 2 segments .m4s :
  // → ready = true → HLS.js peut commencer à jouer (4-8s après appel).
  const watcher = setInterval(() => {
    const s = sessions.get(token);
    if (!s || s.ready || s.ffmpegError) { clearInterval(watcher); return; }

    try {
      const initOk  = fs.existsSync(path.join(tempDir, 'init.mp4'));
      const segCount = fs.readdirSync(tempDir)
        .filter(f => /^seg\d+\.m4s$/.test(f)).length;

      if (initOk && segCount >= 2) {
        s.ready = true;
        clearInterval(watcher);
        console.log(`[HLS] ▶ Prêt (${segCount} segments dispo) — ${itemId}`);
      }
    } catch (_) {}
  }, 300);

  // Timeout de sécurité : 2 minutes
  setTimeout(() => {
    clearInterval(watcher);
    const s = sessions.get(token);
    if (s && !s.ready) s.ffmpegError = s.ffmpegError || 'Timeout 120s — ffmpeg installé ?';
  }, 120_000);
}

// ── Construction M3U8 avec honeypots ─────────────────────────────────
// Réécrit le M3U8 généré par ffmpeg pour :
//  1. Remplacer les URIs de clé + init par nos endpoints authentifiés
//  2. Intercaler 1 segment honeypot après chaque segment réel
//     (HONEYPOT_EVERY=1 → 50% honeypots)
//
// Structure pour VDH (ce qu'il voit et télécharge) :
//  seg000.m4s  (vrai, chiffré) → musique
//  honey_0.m4s (Rick Roll chiffré) → Rick Roll 4s ← VDH le télécharge
//  seg001.m4s  (vrai, chiffré) → musique
//  honey_1.m4s (Rick Roll chiffré) → Rick Roll 4s ← VDH le télécharge
//
// Structure pour HLS.js (le custom loader retire les #EXT-X-BEARTIFY-HONEYPOT) :
//  seg000.m4s → musique  ✓
//  seg001.m4s → musique  ✓
function buildHoneypotM3u8(rawM3u8, itemId, token, ivHex) {
  const lines = rawM3u8.split('\n');
  const out   = [];
  let realIdx  = 0;  // segments réels traités
  let honeyIdx = 0;  // honeypots injectés

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // ── Réécrire la clé AES ────────────────────────────────────────
    if (t.startsWith('#EXT-X-KEY')) {
      out.push(
        `#EXT-X-KEY:METHOD=AES-128,` +
        `URI="/api/hls/key/${itemId}?s=${encodeURIComponent(token)}",` +
        `IV=0x${ivHex}`
      );
      continue;
    }

    // ── Réécrire le MAP (init segment) → endpoint authentifié ─────
    if (t.startsWith('#EXT-X-MAP')) {
      out.push(`#EXT-X-MAP:URI="/api/hls/init/${itemId}?s=${encodeURIComponent(token)}"`);
      continue;
    }

    // ── Segments réels ────────────────────────────────────────────
    if (t.startsWith('#EXTINF')) {
      // Ligne #EXTINF
      out.push(lines[i]);
      i++;
      // Ligne URL du segment
      const segFile = (lines[i] || '').trim();
      if (segFile) {
        const segName = path.basename(segFile.split('?')[0]);
        out.push(`/api/hls/segment/${itemId}/${segName}?s=${encodeURIComponent(token)}`);
      }
      realIdx++;

      // ── Injecter honeypot ────────────────────────────────────────
      // realIdx % HONEYPOT_EVERY === 0 :
      //   HONEYPOT_EVERY=1 → après CHAQUE segment réel (50%)
      //   HONEYPOT_EVERY=2 → après tous les 2 segments réels (33%)
      if (_honeypotSegs.length > 0 && realIdx % HONEYPOT_EVERY === 0) {
        out.push('');
        out.push('#EXT-X-BEARTIFY-HONEYPOT');  // tag filtré par HLS.js
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

// ══════════════════════════════════════════════════════════════════════
//  1. Créer une session HLS
//  GET /api/hls/session/:id
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/session/:id', async (req, res) => {
  const itemId = req.params.id;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId))
    return res.status(400).json({ error: 'ID invalide' });

  const ip        = clientIp(req);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const key       = crypto.randomBytes(16);  // AES-128 (16 octets)
  const iv        = crypto.randomBytes(16);
  const token     = generateToken(itemId, ip, expiresAt);
  const safeId    = token.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const tempDir   = path.join(os.tmpdir(), `beartify-${safeId}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Fichier clé binaire pour ffmpeg
    await fs.promises.writeFile(path.join(tempDir, 'key.bin'), key);

    // Fichier keyinfo : URI_dans_M3U8\nchemin_clé\nIV_hex
    const keyUri = `/api/hls/key/${itemId}?s=${encodeURIComponent(token)}`;
    await fs.promises.writeFile(
      path.join(tempDir, 'key.keyinfo'),
      `${keyUri}\n${path.join(tempDir, 'key.bin')}\n${iv.toString('hex')}`
    );

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

// ══════════════════════════════════════════════════════════════════════
//  2. Clé AES-128 (IP-lockée, authentifiée)
//  GET /api/hls/key/:id?s=TOKEN
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/key/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();

  res.setHeader('Content-Type',  'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(s.key);
});

// ══════════════════════════════════════════════════════════════════════
//  3. Init segment fMP4 (non chiffré par spec HLS)
//  GET /api/hls/init/:id?s=TOKEN
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/init/:id', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();

  const initPath = path.join(s.tempDir, 'init.mp4');
  if (!fs.existsSync(initPath)) return res.status(404).end();

  res.setHeader('Content-Type',  'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  fs.createReadStream(initPath).pipe(res);
});

// ══════════════════════════════════════════════════════════════════════
//  4. Playlist M3U8 avec honeypots (polling live-like)
//  GET /api/hls/playlist/:id?s=TOKEN
//
//  HLS.js appelle cet endpoint toutes les ~3s.
//  La réponse grandit au fur et à mesure que ffmpeg génère des segments.
//  Quand ffmpeg termine, #EXT-X-ENDLIST apparaît → HLS.js passe en VOD.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/playlist/:id', async (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).json({ error: 'Session invalide' });

  // Attendre que init + 2 segments soient prêts (démarrage rapide ~4-8s)
  const deadline = Date.now() + 60_000;
  while (!s.ready && !s.ffmpegError && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300));
  }

  if (!s.ready) {
    const errDetail = s.ffmpegError || 'Timeout 60s';
    console.error(`[Playlist] Session non prête pour ${req.params.id} :`, errDetail);
    return res.status(500).json({
      error: errDetail,
      hint: 'Vérifier : journalctl -u beartify-drm -n 50',
    });
  }

  try {
    const raw  = await fs.promises.readFile(path.join(s.tempDir, 'playlist.m3u8'), 'utf8');
    const m3u8 = buildHoneypotM3u8(raw, req.params.id, req.query.s, s.iv);

    // no-cache (pas no-store) : HLS.js doit pouvoir re-fetcher le même URL
    // pour récupérer de nouveaux segments au fur et à mesure.
    res.setHeader('Content-Type',  'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(m3u8);

  } catch (err) {
    console.error('[Playlist] Erreur lecture :', err.message);
    res.status(500).json({ error: 'Playlist indisponible' });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  5. Segments — réels (chiffrés par ffmpeg) et honeypot (Rick Roll)
//  GET /api/hls/segment/:id/:seg?s=TOKEN
//
//  seg*.m4s   → fichier chiffré généré par ffmpeg, servi tel quel
//  honey_N.m4s → segment Rick Roll pré-généré, chiffré à la volée
//                avec la clé AES-128 de la session (même key+IV que vrais)
//
//  VDH télécharge tout sans distinction → Rick Roll 1 fois sur 2.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/segment/:id/:seg', (req, res) => {
  const s = validateSession(req.query.s, req.params.id, req);
  if (!s) return res.status(401).end();

  const seg = req.params.seg;

  // Whitelist stricte : seg000.m4s ou honey_0.m4s
  if (!/^(seg\d{3,6}|honey_\d+)\.m4s$/.test(seg)) return res.status(400).end();

  if (seg.startsWith('honey_')) {
    // ── Segment honeypot : Rick Roll chiffré à la volée ────────────
    if (_honeypotSegs.length === 0) return res.status(503).end();

    const idx       = parseInt(seg.match(/\d+/)[0], 10);
    const honeyPath = _honeypotSegs[idx % _honeypotSegs.length];

    try {
      const raw    = fs.readFileSync(honeyPath);
      const ivBuf  = Buffer.from(s.iv, 'hex');
      // AES-128-CBC — même algorithme que ffmpeg pour les segments réels
      // PKCS7 padding automatique (Node crypto)
      const cipher = crypto.createCipheriv('aes-128-cbc', s.key, ivBuf);
      const enc    = Buffer.concat([cipher.update(raw), cipher.final()]);

      res.setHeader('Content-Type',   'video/mp4');
      res.setHeader('Content-Length',  enc.length);
      res.setHeader('Cache-Control',  'no-store, private');
      res.end(enc);
    } catch (err) {
      console.error('[Honeypot] Erreur chiffrement :', err.message);
      res.status(500).end();
    }

  } else {
    // ── Segment réel : .m4s chiffré par ffmpeg ─────────────────────
    const segPath = path.join(s.tempDir, seg);
    if (!fs.existsSync(segPath)) return res.status(404).end();

    res.setHeader('Content-Type',  'video/mp4');
    res.setHeader('Cache-Control', 'no-store, private');
    fs.createReadStream(segPath).pipe(res);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  DIAGNOSTIC — /api/hls/test?item=ITEM_ID
//  Teste ffmpeg en conditions réelles et retourne le stderr complet.
//  Supprimer ou protéger cet endpoint en production après debug.
// ══════════════════════════════════════════════════════════════════════
app.get('/api/hls/test', (req, res) => {
  const itemId = req.query.item;
  if (!itemId || !/^[a-f0-9]{32}$/i.test(itemId)) {
    return res.status(400).json({ error: 'Paramètre ?item=<jellyfin_id> requis' });
  }

  const jellyUrl = `http://${JELLYFIN_HOST}:${JELLYFIN_PORT}/Audio/${itemId}/stream`
                 + `?static=true&api_key=${JELLYFIN_TOKEN}`;

  const outPath = `/tmp/beartify_test_${Date.now()}`;
  const args = [
    '-i', jellyUrl,
    '-vn',
    '-c:a', 'flac',
    '-t', '5',                     // 5 secondes seulement pour le test
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', `${outPath}_init.mp4`,
    '-hls_segment_filename',   `${outPath}_%03d.m4s`,
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-y', `${outPath}.m3u8`,
  ];

  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', d => { stderr += d.toString(); });

  ff.on('close', (code) => {
    // Nettoyer les fichiers de test
    try {
      require('fs').readdirSync('/tmp')
        .filter(f => f.startsWith(`beartify_test_`))
        .forEach(f => { try { require('fs').unlinkSync(`/tmp/${f}`); } catch (_) {} });
    } catch (_) {}

    const lastLines = stderr.trim().split('\n').slice(-15).join('\n');
    res.json({
      success:    code === 0,
      exitCode:   code,
      jellyfinUrl: jellyUrl.replace(JELLYFIN_TOKEN, '***'),
      ffmpegArgs: args.map(a => a.includes(JELLYFIN_TOKEN) ? a.replace(JELLYFIN_TOKEN, '***') : a),
      stderr_last15_lines: lastLines,
    });
  });

  ff.on('error', (e) => {
    res.status(500).json({
      success: false,
      error: e.message,
      hint: 'ffmpeg est-il installé ? Tester : ffmpeg -version',
    });
  });

  // Timeout 30s
  setTimeout(() => {
    if (!res.headersSent) {
      ff.kill();
      res.status(500).json({ success: false, error: 'Timeout 30s' });
    }
  }, 30000);
});

// ── Healthcheck ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:         'ok',
  sessions:       sessions.size,
  honeypot_segs:  _honeypotSegs.length,
  honeypot_every: `1 sur ${HONEYPOT_EVERY + 1}`,
}));

// ── Démarrage ─────────────────────────────────────────────────────────
generateHoneypotSegments().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`✅  Beartify DRM v4 → 127.0.0.1:${PORT}`);
    console.log(`    Audio   : FLAC lossless (fMP4 HLS)`);
    console.log(`    Honeypot: ${_honeypotSegs.length} segments Rick Roll | 1 sur ${HONEYPOT_EVERY + 1} (`);
  });
});
