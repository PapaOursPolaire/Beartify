// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — extensions.js  v2
//  Proxy-cache GitHub pour la Marketplace.
//
//  Usage dans drm.js (après `const app = express()`) :
//    require('./extensions')(app);
//
//  Routes exposées :
//    GET /api/extensions
//      → liste des manifestes du repo GitHub (cache TTL 10 min)
//        + champ `source: 'github'`
//
//    GET /api/extensions/file?url=<raw_github_url>
//      → proxy transparent vers raw.githubusercontent.com
//        (preview.png, main.js, main.css, …)
//        cache 30 min en mémoire pour les assets texte/binaires légers
//
//  Le cache mémoire évite le rate-limit GitHub (60 req/h unauthenticated)
//  quelque soit le nombre d'utilisateurs simultanés : tous partagent
//  le même cache serveur.
//
//  Repo GitHub :
//    GITHUB_REPO = "<owner>/<repo>"  (ex: "PapaOurs/beartify-marketplace")
//    Branche     : main
//    Structure   :
//      Extensions/<nom>/config.json  preview.png  main.js  …
//      Themes/<nom>/    config.json  preview.png  main.js  …
//      Snippets/<nom>/  config.json  preview.png  main.css …
//      Integrations/<nom>/config.json …
// ══════════════════════════════════════════════════════════════════════
'use strict';

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────
const GITHUB_REPO   = 'PapaOursPolaire/beartify-marketplace';
const GITHUB_BRANCH = 'Projets';
const GITHUB_TOKEN  = '';

const MANIFEST_TTL  = 10 * 60 * 1000;
const ASSET_TTL     = 30 * 60 * 1000;

const CATEGORIES = [
  { dir: 'Extensions',   type: 'extension'   },
  { dir: 'Themes',       type: 'theme'       },
  { dir: 'Snippets',     type: 'snippet'     },
  { dir: 'Integrations', type: 'integration' },
];

const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

// ── Cache mémoire ─────────────────────────────────────────────────────
// { [cacheKey]: { data: Buffer|string|object, at: Date.now() } }
const _cache = Object.create(null);

function _cacheGet(key, ttl) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) { delete _cache[key]; return null; }
  return entry.data;
}
function _cacheSet(key, data) {
  _cache[key] = { data, at: Date.now() };
}

// ── HTTP helper ───────────────────────────────────────────────────────
function _ghFetch(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':  'Beartify-Marketplace/2.0',
      'Accept':      'application/vnd.github.v3+json',
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

    const req = https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode === 404) { reject(new Error(`GH 404: ${url}`)); return; }
        if (res.statusCode === 403) { reject(new Error(`GH rate-limit: ${url}`)); return; }
        if (res.statusCode >= 400)  { reject(new Error(`GH ${res.statusCode}: ${url}`)); return; }
        resolve({ body, headers: res.headers, status: res.statusCode });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── Fetch texte (JSON, JS, CSS) ───────────────────────────────────────
async function _fetchText(url) {
  const cached = _cacheGet(url, ASSET_TTL);
  if (cached) return cached;
  const { body } = await _ghFetch(url);
  const text = body.toString('utf8');
  _cacheSet(url, text);
  return text;
}

// ── Fetch binaire (images) ────────────────────────────────────────────
async function _fetchBinary(url) {
  const cached = _cacheGet('bin:' + url, ASSET_TTL);
  if (cached) return cached;
  const { body, headers } = await _ghFetch(url);
  const result = { body, contentType: headers['content-type'] || _mimeFromUrl(url) };
  _cacheSet('bin:' + url, result);
  return result;
}

// ── Construction des manifestes ───────────────────────────────────────
async function _buildManifests() {
  const cached = _cacheGet('__manifests__', MANIFEST_TTL);
  if (cached) return cached;

  const results = [];

  for (const cat of CATEGORIES) {
    // Lister les dossiers de la catégorie via l'API GitHub Contents
    let entries;
    try {
      const url  = `${API_BASE}/${cat.dir}?ref=${GITHUB_BRANCH}`;
      const { body } = await _ghFetch(url);
      entries = JSON.parse(body.toString('utf8'));
    } catch (e) {
      console.warn(`[extensions] Impossible de lister ${cat.dir} :`, e.message);
      continue;
    }

    if (!Array.isArray(entries)) continue;

    // Pour chaque dossier d'extension, lire config.json
    const folders = entries.filter(e => e.type === 'dir');

    await Promise.allSettled(folders.map(async folder => {
      const name    = folder.name;
      const cfgUrl  = `${RAW_BASE}/${cat.dir}/${name}/config.json`;
      let cfg;
      try {
        const text = await _fetchText(cfgUrl);
        cfg = JSON.parse(text);
      } catch (e) {
        console.warn(`[extensions] config.json invalide pour ${cat.dir}/${name} :`, e.message);
        return;
      }

      // URL de preview (via notre proxy /api/extensions/file)
      const previewFile = cfg.preview || 'preview.png';
      const rawPreview  = `${RAW_BASE}/${cat.dir}/${name}/${previewFile}`;
      const previewUrl  = `/api/extensions/file?url=${encodeURIComponent(rawPreview)}`;

      results.push({
        id:          cfg.id || `${cat.dir}/${name}`,  // cfg.id prioritaire sur le chemin dossier
        category:    cat.dir,
        type:        cat.type,
        folderName:  name,
        source:      'github',
        rawBase:     `${RAW_BASE}/${cat.dir}/${name}`,
        name:        cfg.name        || name,
        author:      cfg.author      || '—',
        version:     cfg.version     || '0.0.1',
        description: cfg.description || '',
        tags:        Array.isArray(cfg.tags) ? cfg.tags : [],
        featured:    !!cfg.featured,
        entry:       cfg.entry       || 'main.js',
        files:       Array.isArray(cfg.files) ? cfg.files : [cfg.entry || 'main.js', previewFile],
        previewUrl,
        accentColor: cfg.accentColor || null,
      });
    }));
  }

  _cacheSet('__manifests__', results);
  console.log(`[extensions] ${results.length} extensions chargées depuis GitHub (cache 10 min)`);
  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────
function _mimeFromUrl(url) {
  const ext = url.split('.').pop().toLowerCase().split('?')[0];
  return {
    png:  'image/png',
    jpg:  'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif:  'image/gif',
    svg:  'image/svg+xml',
    js:   'application/javascript',
    css:  'text/css',
    json: 'application/json',
  }[ext] || 'application/octet-stream';
}

function _isGithubRawUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'raw.githubusercontent.com';
  } catch { return false; }
}

// ── Module export ─────────────────────────────────────────────────────
module.exports = function registerExtensionRoutes(app) {

  // ══════════════════════════════════════════════════════════════════
  //  GET /api/extensions
  //  Retourne la liste complète des extensions du repo GitHub.
  //  Réponse mise en cache 10 min côté serveur.
  //  Tous les clients partagent ce cache → 0 appels GitHub/client.
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/extensions', async (_req, res) => {
    try {
      const manifests = await _buildManifests();
      res.json(manifests);
    } catch (err) {
      console.error('[extensions] /api/extensions error:', err.message);
      res.status(502).json({ error: 'Impossible de contacter GitHub', detail: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  GET /api/extensions/file?url=<raw_github_url>
  //  Proxy vers raw.githubusercontent.com.
  //  Sert les preview.png, main.js, main.css, etc.
  //  Cache 30 min en mémoire.
  //
  //  Sécurité : seules les URLs raw.githubusercontent.com sont acceptées.
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/extensions/file', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Paramètre url manquant' });
    if (!_isGithubRawUrl(url)) return res.status(403).json({ error: 'URL non autorisée' });

    try {
      const isText = /\.(js|css|json|svg|txt|md)(\?|$)/i.test(url);
      if (isText) {
        const text = await _fetchText(url);
        res.setHeader('Content-Type', _mimeFromUrl(url));
        res.setHeader('Cache-Control', 'public, max-age=1800');
        res.send(text);
      } else {
        const { body, contentType } = await _fetchBinary(url);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=1800');
        res.send(body);
      }
    } catch (err) {
      const status = err.message.includes('404') ? 404 : 502;
      console.warn(`[extensions] /api/extensions/file ${status}:`, err.message);
      res.status(status).json({ error: 'Fichier introuvable', detail: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  POST /api/extensions/invalidate
  //  Vide le cache mémoire (webhook GitHub ou rechargement manuel).
  //  Protégé par X-Invalidate-Token si INVALIDATE_TOKEN est défini.
  // ══════════════════════════════════════════════════════════════════
  app.post('/api/extensions/invalidate', (req, res) => {
    const token = process.env.INVALIDATE_TOKEN;
    if (token && req.headers['x-invalidate-token'] !== token)
      return res.status(401).json({ error: 'Token invalide' });

    const count = Object.keys(_cache).length;
    Object.keys(_cache).forEach(k => delete _cache[k]);
    console.log(`[extensions] Cache vidé (${count} entrées)`);
    res.json({ ok: true, cleared: count });
  });

  console.log(`✅  Extensions Marketplace → GitHub (${GITHUB_REPO}@${GITHUB_BRANCH}) — cache 10 min`);
};
