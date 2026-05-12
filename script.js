// ══════════════════════════════════════════════════════════════════
//  Beartify – script.js  (v2 — SpicyLyrics + carousels + favorites)
//  ✅ Compatible Tauri V2 : desktop (.exe / .AppImage) + Android (.apk)
// ══════════════════════════════════════════════════════════════════

// ── Détection Tauri V2 ────────────────────────────────────────────
/**
 * _IS_TAURI  : true quand le code tourne dans un WebView Tauri (desktop ou mobile).
 *   window.__TAURI__           → Tauri v1 (legacy)
 *   window.__TAURI_INTERNALS__ → Tauri v2
 *
 * _IS_ANDROID : true sur Android (.apk) — les popups OAuth ne fonctionnent
 *   pas dans le WebView Android → firebase-config.js utilise signInWithRedirect.
 *
 * Ces deux valeurs sont exposées sur window pour que firebase-config.js
 * (chargé après) puisse les lire directement.
 */
const _IS_TAURI   = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
const _IS_ANDROID = _IS_TAURI && /Android/i.test(navigator.userAgent);
window._IS_TAURI   = _IS_TAURI;
window._IS_ANDROID = _IS_ANDROID;

/**
 * URL de base du serveur proxy (Caddy / Node.js).
 *
 * En navigateur : '' → les chemins /api/* sont relatifs à l'origine courante.
 * En Tauri      : URL absolue, car l'origine est tauri://localhost et le proxy
 *                 est un process séparé. Lue depuis localStorage pour que
 *                 l'utilisateur puisse la configurer dans les Paramètres.
 *
 * Valeur par défaut : http://localhost:3000 (serveur en local).
 * Pour pointer vers un NAS ou un serveur LAN :
 *   localStorage.setItem('beartify_server_url', 'http://192.168.1.10:3000')
 *   puis relancer l'application.
 */
const _TAURI_SERVER_BASE = _IS_TAURI
  ? (localStorage.getItem('beartify_server_url') || 'http://localhost:3000')
  : '';
window._TAURI_SERVER_BASE = _TAURI_SERVER_BASE;

/**
 * Résout un chemin /api/... en URL complète quand on est dans Tauri.
 * En navigateur la fonction retourne le chemin tel quel (relatif fonctionne).
 *
 * @param  {string} path  Chemin commençant par '/' (ex: '/api/jellyfin/Items')
 * @returns {string}      URL prête à passer à fetch()
 */
function _resolveProxyUrl(path) {
  if (!_IS_TAURI) return path;
  if (path.startsWith('/')) return _TAURI_SERVER_BASE + path;
  return path;
}
// Exposé sur window pour que firebase-sync.js puisse l'appeler
window._resolveProxyUrl = _resolveProxyUrl;

// ── Configuration ─────────────────────────────────────────────────
// Toutes les APIs passent TOUJOURS par le proxy local (/api/*).
// Les clés et domaines réels ne sont jamais envoyés ni visibles côté client.
// server.js (dev) et Caddy (prod/LAN) gèrent les routes /api/* dans tous
// les environnements.
// En Tauri : _resolveProxyUrl() transforme les chemins relatifs en URLs
// absolues pointant vers le serveur proxy (_TAURI_SERVER_BASE).

// Références internes uniquement — construites à l'exécution pour ne pas
// apparaître comme chaînes literals dans la source distribuée.
// [0] = hôte streaming  [1] = hôte lyrics
const _SVC = [
  ['grizzly-stream', 'duckdns', 'org'].join('.'),
  ['grizzlyrics',    'duckdns', 'org'].join('.'),
];

const _JELLY_KEY       = '';   // clé injectée par le proxy — jamais côté client
const _LASTFM_KEY      = '';   // clé injectée par le proxy — jamais côté client
const _USE_PROXY       = true; // toujours actif

// ✅ TAURI : LYRICS_API utilise _resolveProxyUrl() → URL absolue en Tauri
const LYRICS_API       = _resolveProxyUrl('/api/lyrics/api/search.php');
const JELLYFIN_URL     = '';   // legacy — utiliser jellyfinUrl()
const JELLYFIN_API_KEY = '';   // clé injectée par le proxy
const LASTFM_API_KEY   = '';   // clé injectée par le proxy

/**
 * Réécrit toute URL du service lyrics en chemin proxy /api/lyrics/...
 * ✅ TAURI FIX : appelle _resolveProxyUrl() pour obtenir une URL absolue
 * en Tauri (tauri://localhost n'a pas de route /api/*).
 *
 * Gère trois formes :
 *   1. Absolue  (hôte interne)  → _resolveProxyUrl('/api/lyrics/path')
 *   2. Relative /path/to/file.json → _resolveProxyUrl('/api/lyrics/path/...')
 *   3. Autre domaine / valeur inconnue → retournée inchangée
 */
function lyricsProxyUrl(url) {
  if (!url) return url;
  try {
    // Cas 1 : URL absolue — on vérifie le hostname
    const u = new URL(url);
    if (u.hostname === _SVC[1]) {
      return _resolveProxyUrl('/api/lyrics' + u.pathname + (u.search || ''));
    }
    // URL absolue mais domaine inconnu → ne pas proxifier
    return url;
  } catch {
    // Cas 2 : URL relative (new URL() a lancé TypeError)
    if (url.startsWith('/')) return _resolveProxyUrl('/api/lyrics' + url);
    return _resolveProxyUrl('/api/lyrics/' + url);
  }
}

/**
 * Construit une URL Jellyfin via le proxy /api/jellyfin/*.
 * La clé X-Emby-Token est injectée par Caddy/server.js, jamais exposée.
 * ✅ TAURI FIX : retourne une URL absolue quand _IS_TAURI est vrai.
 */
function jellyfinUrl(path) {
  return _resolveProxyUrl('/api/jellyfin' + (path.startsWith('/') ? path : '/' + path));
}

/**
 * Construit une URL Last.fm via le proxy /api/lastfm/*.
 * La clé api_key et le format sont injectés par Caddy/server.js.
 * ✅ TAURI FIX : retourne une URL absolue quand _IS_TAURI est vrai.
 */
function lastfmUrl(params) {
  return _resolveProxyUrl('/api/lastfm/2.0/?' + params);
}

/**
 * normalizeJellyfinUrl — convertit toute URL Jellyfin absolue en chemin
 * proxy /api/jellyfin/... et supprime l'api_key résiduelle.
 * ✅ TAURI FIX : appelle _resolveProxyUrl() sur le chemin final pour
 * obtenir une URL absolue dans Tauri (les chemins relatifs échoueraient).
 */
function normalizeJellyfinUrl(url) {
  if (!url) return url;
  // Déjà un chemin proxy relatif → résoudre (no-op en navigateur, absolu en Tauri)
  if (url.startsWith('/api/jellyfin/')) return _resolveProxyUrl(url);
  // Déjà une URL absolue vers le serveur proxy (cas Tauri après résolution)
  if (_IS_TAURI && url.startsWith(_TAURI_SERVER_BASE + '/api/jellyfin/')) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('api_key');
    let path = u.pathname + (u.search || '');
    path = path.replace(/^\/api\/jellyfin/, '');
    return _resolveProxyUrl('/api/jellyfin' + (path.startsWith('/') ? path : '/' + path));
  } catch { return url; }
}

/** Normalise streamUrl + imageUrl d'un track in-place. */
function normalizeTrack(track) {
  if (!track) return track;
  if (track.streamUrl) track.streamUrl = normalizeJellyfinUrl(track.streamUrl);
  if (track.imageUrl)  track.imageUrl  = normalizeJellyfinUrl(track.imageUrl);
  return track;
}

// ══════════════════════════════════════════════════════════════════════
//  INTERCEPTEUR GLOBAL — garantit qu'aucun appel réseau ne part
//  directement vers les services internes, quel que soit le
//  module JS qui en est à l'origine (script.js, firebase-sync.js, etc.)
// ══════════════════════════════════════════════════════════════════════

/**
 * Réécriture d'URL : convertit toute URL absolue vers les services
 * internes en chemin relatif passant par le proxy (/api/...).
 * Supprime au passage les éventuels api_key résiduels.
 *
 * ✅ TAURI FIX :
 *   1. Appelle _resolveProxyUrl() sur le chemin proxy généré → URL absolue.
 *   2. Intercepte aussi les chemins /api/* relatifs déjà proxifiés
 *      (ex : imageUrl stockée dans Firestore comme '/api/jellyfin/...')
 *      qui échoueraient dans Tauri car tauri://localhost n'a pas de /api/*.
 */
function _rewriteToProxy(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === _SVC[0]) {
      u.searchParams.delete('api_key');
      return _resolveProxyUrl('/api/jellyfin' + u.pathname + (u.search || ''));
    }
    if (u.hostname === _SVC[1]) {
      return _resolveProxyUrl('/api/lyrics' + u.pathname + (u.search || ''));
    }
  } catch { /* URL relative ou invalide — on ne touche pas */ }

  // ✅ TAURI FIX : chemin relatif /api/* → absolu vers le serveur proxy.
  // Dans un navigateur, les chemins /api/* sont servis par le proxy sur la
  // même origine, donc pas besoin de les réécrire. Dans Tauri, l'origine
  // tauri://localhost n'a aucune route /api/* → on préfixe avec le serveur.
  if (_IS_TAURI && rawUrl.startsWith('/api/')) {
    return _TAURI_SERVER_BASE + rawUrl;
  }

  return rawUrl;
}

/** Patch window.fetch — intercepte TOUS les fetch() de la page. */
(function _patchFetch() {
  const _orig = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const rewritten = _rewriteToProxy(input.url);
      if (rewritten !== input.url) {
        input = new Request(rewritten, input);
      }
    } else {
      const str      = String(input);
      const rewritten = _rewriteToProxy(str);
      if (rewritten !== str) input = rewritten;
    }
    return _orig(input, init);
  };
})();

/**
 * Patch XMLHttpRequest.open — intercepte les XHR qui échapperaient
 * au patch fetch(). Même logique de réécriture via _rewriteToProxy.
 */
(function _patchXHR() {
  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const str       = String(url);
    const rewritten = _rewriteToProxy(str);
    if (rewritten !== str) {
      console.warn('[PROXY] XHR intercepté :', str, '→', rewritten);
      return _origOpen.call(this, method, rewritten, ...rest);
    }
    return _origOpen.call(this, method, url, ...rest);
  };
})();

/**
 * MutationObserver — normalise les attributs src/srcset de toute
 * balise <img> insérée ou modifiée dans le DOM.
 * Couvre les pochettes chargées depuis Firebase ou d'autres modules.
 */
(function _patchImageSrc() {
  function _fixImg(img) {
    const src = img.getAttribute('src');
    if (!src) return;
    const rewritten = _rewriteToProxy(src);
    if (rewritten !== src) img.setAttribute('src', rewritten);
  }

  function _scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'IMG') _fixImg(node);
    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll('img[src]').forEach(_fixImg);
    }
  }

  const _obs = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.target.tagName === 'IMG') {
        _fixImg(m.target);
      } else if (m.type === 'childList') {
        m.addedNodes.forEach(_scanNode);
      }
    }
  });

  function _startObs() {
    if (document.body) {
      _scanNode(document.body);
      _obs.observe(document.body, {
        childList       : true,
        subtree         : true,
        attributes      : true,
        attributeFilter : ['src'],
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startObs, { once: true });
  } else {
    _startObs();
  }
})();

// ── Centralized App State ──────────────────────────────────────────
const AppState = {
  _data: {
    tracks:               [],
    currentIndex:         -1,
    isShuffled:           false,
    repeatMode:           0,
    isLiked:              false,
    isDragging:           false,
    shuffleOrder:         [],
    recentlyPlayed:       [],
    likedTracks:          new Set(),
    favoriteAlbums:       new Set(),
    favoriteArtists:      new Set(),
    currentSidebarFilter: 'playlists',
    genreCarouselsLoaded: false,
    extendedInfoAbort:    null,
  },
  _listeners: {},
  get(key)      { return this._data[key]; },
  set(key, val) {
    const prev = this._data[key];
    this._data[key] = val;
    (this._listeners[key] || []).forEach(fn => fn(val, prev));
    (this._listeners['*']  || []).forEach(fn => fn(key, val, prev));
  },
  on(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
  },
};

// Legacy aliases so all existing code works without renaming every variable
let tracks               = AppState._data.tracks;
let currentIndex         = AppState._data.currentIndex;
let isShuffled           = AppState._data.isShuffled;
let repeatMode           = AppState._data.repeatMode;
let isLiked              = AppState._data.isLiked;
let isDragging           = AppState._data.isDragging;
let shuffleOrder         = AppState._data.shuffleOrder;
let recentlyPlayed       = AppState._data.recentlyPlayed;
let likedTracks          = AppState._data.likedTracks;
let favoriteAlbums       = AppState._data.favoriteAlbums;
let favoriteArtists      = AppState._data.favoriteArtists;
let currentSidebarFilter = AppState._data.currentSidebarFilter;

// ── Exposition sur window pour Firebase Sync ──────────────────────
window.likedTracks     = likedTracks;
window.favoriteAlbums  = favoriteAlbums;
window.favoriteArtists = favoriteArtists;
window.recentlyPlayed  = recentlyPlayed;
window.customPlaylists = {}; // sera rempli depuis Firestore au chargement
// ── Contexte de lecture actif ──────────────────────────────────────────────────
// Tableau d'indices dans le tableau global tracks. Quand non null, goNext/goPrev
// naviguent UNIQUEMENT dans ce sous-ensemble (album, playlist, titres likés…).
window._playContext = null;
let genreCarouselsLoaded = AppState._data.genreCarouselsLoaded;
let extendedInfoAbort    = AppState._data.extendedInfoAbort;

// ── Toast notification system ──────────────────────────────────────
(function initToastSystem() {
  const c = document.createElement('div');
  c.id = 'toast-container';
  c.style.cssText = [
    'position:fixed', 'bottom:108px', 'left:50%', 'transform:translateX(-50%)',
    'display:flex', 'flex-direction:column', 'align-items:center', 'gap:8px',
    'z-index:9999', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(c);
})();

window.showToast = function(message, type = 'default', duration = 2800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { success:'var(--green)', error:'#e91429', info:'#3d91f4', warning:'#f59b23', default:'rgba(255,255,255,0.18)' };
  const icons  = { success:'✓', error:'✕', info:'ℹ', warning:'⚠', default:'' };
  const col = colors[type] || colors.default;

  const toast = document.createElement('div');
  toast.style.cssText = [
    'display:flex', 'align-items:center', 'gap:10px',
    'background:rgba(28,28,28,0.97)',
    `border:1px solid ${col}`, `border-left:3px solid ${col}`,
    'color:#fff', 'padding:10px 18px', 'border-radius:8px',
    "font-family:'DM Sans',sans-serif", 'font-size:0.88rem', 'font-weight:500',
    'box-shadow:0 4px 24px rgba(0,0,0,0.55)',
    'opacity:0', 'transform:translateY(14px) scale(0.95)',
    'transition:opacity 0.22s ease,transform 0.22s ease',
    'pointer-events:auto', 'white-space:nowrap', 'max-width:340px',
  ].join(';');

  if (icons[type]) {
    const ic = document.createElement('span');
    ic.textContent = icons[type];
    ic.style.cssText = `color:${col};font-size:1rem;flex-shrink:0`;
    toast.appendChild(ic);
  }
  const txt = document.createElement('span');
  txt.textContent = message;
  toast.appendChild(txt);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(-8px) scale(0.96)';
    setTimeout(() => toast.remove(), 260);
  }, duration);
};

// ── Keyboard shortcuts modal ───────────────────────────────────────
(function initShortcutsModal() {
  const overlay = document.createElement('div');
  overlay.id = 'shortcutsOverlay';
  overlay.style.cssText = [
    'display:none', 'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.72)',
    'z-index:8000', 'align-items:center', 'justify-content:center',
    'backdrop-filter:blur(6px)',
  ].join(';');

  const SHORTCUTS = [
    ['Espace', 'Lecture / Pause'],
    ['← →',    'Reculer / Avancer 5 s'],
    ['↑ ↓',    'Volume +/−'],
    ['M',       'Muet'],
    ['S',       'Aléatoire'],
    ['R',       'Répéter'],
    ['?',       'Ce panneau'],
  ];
  const rows = SHORTCUTS.map(([k, v]) => `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:7px 10px;border-radius:6px;background:rgba(255,255,255,0.04)">
      <kbd style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);
        border-radius:4px;padding:2px 9px;font-size:0.77rem;font-family:monospace;
        color:#fff;white-space:nowrap">${k}</kbd>
      <span style="font-size:0.82rem;color:#b3b3b3;margin-left:12px">${v}</span>
    </div>`).join('');

  overlay.innerHTML = `
    <div style="background:#181818;border:1px solid rgba(255,255,255,0.1);
      border-radius:14px;padding:32px;min-width:340px;max-width:460px;
      box-shadow:0 20px 60px rgba(0,0,0,0.8);
      animation:beartifyFadeIn 0.22s ease">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px">
        <h2 style="font-size:1.05rem;font-weight:700;color:#fff;letter-spacing:-0.02em">Raccourcis clavier</h2>
        <button id="shortcutsClose" style="background:none;border:none;color:rgba(255,255,255,0.45);
          cursor:pointer;font-size:1.2rem;padding:4px;line-height:1">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px">${rows}</div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('shortcutsClose')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
  window._openShortcuts = () => { overlay.style.display = 'flex'; };
})();

// Lyrics state
let lyricsData       = null;
let currentLyricLine = -1;
let currentLyricWord = -1;

// ── SpicyLyrics State ─────────────────────────────────────────────
const spicy = {
  lyricsObject: { Lines: [] },
  isPlaying: false,
  currentPosition: 0,
};
let spicyLastFrameTime   = performance.now();
let spicyLastAnimateTime = 0;
const SPICY_FPS          = 1000 / 60;
let spicyBlurLastLine    = null;
let spicyLastActiveLine  = -1;
let spicyScrollTimeout   = null;

// ── SpicyLyrics Engine Config ─────────────────────────────────────
const SpicyConfig = {
  SimpleLyricsMode: false,
  SimpleLyricsMode_RenderingType: 'animate', // 'animate' | 'calculate'
};
const BLUR_MULTIPLIER        = 1.25;
const SUNG_LETTER_GLOW       = 0.2;
const LETTER_GLOW_MULTIPLIER = 185;
const LETTER_MAX_LENGTH      = 60;   // all words get letter treatment
const LETTER_MIN_DURATION    = 0;    // no minimum duration

// ── GPU promotion + setStyleIfChanged (spicy-lyrics 5.21.5) ──────
// WeakSet: each element gets will-change applied only once
const _gpuPromotedSet = new WeakSet();
function _promoteGPU(el) {
  if (_gpuPromotedSet.has(el)) return;
  el.style.willChange = 'transform, opacity, scale, filter, background-image';
  _gpuPromotedSet.add(el);
}

// Per-element style cache → skip redundant DOM writes
const _styleCache = new WeakMap();
function _setStyleIfChanged(el, prop, val, epsilon = 0) {
  let cache = _styleCache.get(el);
  if (!cache) { cache = Object.create(null); _styleCache.set(el, cache); }
  const prev = cache[prop];
  if (prev !== undefined) {
    if (epsilon > 0) {
      const a = parseFloat(prev), b = parseFloat(val);
      if (!isNaN(a) && !isNaN(b) && Math.abs(a - b) <= epsilon) return;
    } else if (prev === val) return;
  }
  cache[prop] = val;
  if (prop.startsWith('--')) el.style.setProperty(prop, val);
  else el.style[prop] = val;
}

// ══════════════════════════════════════════════════════════════════
//  SpicyLyrics — Full Engine Port (CubicSpline + Spring + Letter
//  animation, bg-vocals, SimpleLyricsMode, interlude dots)
// ══════════════════════════════════════════════════════════════════

class CubicSpline {
  constructor(xs, ys) {
    this.xs = xs; this.ys = ys;
    this.ks = this.getNaturalKs(new Float64Array(xs.length));
  }
  getNaturalKs(ks) {
    const n = this.xs.length - 1;
    const A = Array.from({length:n+1}, () => new Float64Array(n+2));
    for (let i = 1; i < n; i++) {
      A[i][i-1] = 1/(this.xs[i]-this.xs[i-1]);
      A[i][i]   = 2*(1/(this.xs[i]-this.xs[i-1]) + 1/(this.xs[i+1]-this.xs[i]));
      A[i][i+1] = 1/(this.xs[i+1]-this.xs[i]);
      A[i][n+1] = 3*((this.ys[i]-this.ys[i-1])/((this.xs[i]-this.xs[i-1])**2)
                    +(this.ys[i+1]-this.ys[i])/((this.xs[i+1]-this.xs[i])**2));
    }
    A[0][0]   = 2/(this.xs[1]-this.xs[0]);
    A[0][1]   = 1/(this.xs[1]-this.xs[0]);
    A[0][n+1] = 3*(this.ys[1]-this.ys[0])/(this.xs[1]-this.xs[0])**2;
    A[n][n-1] = 1/(this.xs[n]-this.xs[n-1]);
    A[n][n]   = 2/(this.xs[n]-this.xs[n-1]);
    A[n][n+1] = 3*(this.ys[n]-this.ys[n-1])/(this.xs[n]-this.xs[n-1])**2;
    return this._solve(A, ks);
  }
  _solve(A, ks) {
    const m = A.length;
    for (let k = 0; k < m; k++) {
      let imax = 0, vali = Number.NEGATIVE_INFINITY;
      for (let i = k; i < m; i++) if (A[i][k] > vali) { imax = i; vali = A[i][k]; }
      [A[k], A[imax]] = [A[imax], A[k]];
      for (let i = k+1; i < m; i++) {
        for (let j = k+1; j < m+1; j++) A[i][j] -= A[k][j]*(A[i][k]/A[k][k]);
        A[i][k] = 0;
      }
    }
    for (let i = m-1; i >= 0; i--) {
      ks[i] = A[i][m]/A[i][i];
      for (let j = i-1; j >= 0; j--) { A[j][m] -= A[j][i]*ks[i]; A[j][i] = 0; }
    }
    return ks;
  }
  at(x) {
    let i = 1;
    while (i < this.xs.length && this.xs[i] < x) i++;
    if (i >= this.xs.length) i = this.xs.length - 1;
    if (i === 0) i = 1;
    const t = (x-this.xs[i-1])/(this.xs[i]-this.xs[i-1]);
    const a = this.ks[i-1]*(this.xs[i]-this.xs[i-1])-(this.ys[i]-this.ys[i-1]);
    const b = -this.ks[i]*(this.xs[i]-this.xs[i-1])+(this.ys[i]-this.ys[i-1]);
    return (1-t)*this.ys[i-1]+t*this.ys[i]+t*(1-t)*(a*(1-t)+b*t);
  }
}

class Spring {
  constructor(init, freq=1, damp=0.5) {
    this.value=init; this.velocity=0; this.target=init;
    this.frequency=freq; this.damping=damp;
  }
  SetGoal(t, immediate=false) {
    this.target = t;
    if (immediate) { this.value = t; this.velocity = 0; }
  }
  Step(dt) {
    // Oscillateur harmonique amorti — port fidèle de @spikerko/web-modules/Spring.
    //
    // Les paramètres de LyricsAnimator.ts sont :
    //   frequency = fréquence naturelle en Hz  (ex: 0.7, 1.0, 1.25)
    //   damping   = ratio d'amortissement ζ    (0 = sans amorti, 1 = critique)
    //
    // L'ancienne formule traitait `frequency` comme une raideur brute k et
    // `damping` comme un coefficient linéaire c, ce qui produisait des forces
    // ~27× trop faibles (invisible à 60fps sur une fenêtre d'1 seconde).
    //
    // Formule correcte :
    //   ω = 2π × f          (fréquence angulaire en rad/s)
    //   F = ω² × (cible − valeur)  −  2 × ζ × ω × vitesse
    //       ↑ force de rappel             ↑ force d'amortissement
    const omega = 2 * Math.PI * this.frequency;
    const force = omega * omega * (this.target - this.value)
                - 2 * this.damping * omega * this.velocity;
    this.velocity += force * dt;
    this.value    += this.velocity * dt;
    return this.value;
  }
}

// ── Animation Curves ───────────────────────────────────────────────
function _mkSpline(r) { return new CubicSpline(r.map(v=>v.Time), r.map(v=>v.Value)); }

// ── Exact values from LyricsAnimator.ts source ────────────────────
// Scale: 0.95 idle → 1.025 overshoot at 70% → lands at 1.0
const ScaleSpline      = _mkSpline([{Time:0,Value:0.95},{Time:0.7,Value:1.025},{Time:1,Value:1}]);
// YOffset: 0.01 start (slight drop), peak up at 90%, return to 0
let   YOffSpline       = _mkSpline([{Time:0,Value:0.01},{Time:0.9,Value:-(1/60)},{Time:1,Value:0}]);
const YOffSplineSimple = _mkSpline([{Time:0,Value:0.01},{Time:1,Value:-0.04}]);
const LetterYOffSpline = _mkSpline([{Time:0,Value:0.01},{Time:0.9,Value:-(1/60)},{Time:1,Value:0}]);
// Glow: fast rise to 1 by 15%, held until 60%, decays to 0 — NO residual glow
const GlowSpline       = _mkSpline([{Time:0,Value:0},{Time:0.15,Value:1},{Time:0.6,Value:1},{Time:1,Value:0}]);
// Dot splines — sequential 1/3-window bounce from DotAnimations in LyricsAnimator.ts
const DotScaleSpline   = _mkSpline([{Time:0,Value:0.75},{Time:0.7,Value:1.05},{Time:1,Value:1}]);
// Peak Y porté à -0.28 (× DefaultLyricsSize ≈ 10 px) pour que la montée/descente
// soit clairement visible — LyricsAnimator.ts utilise -0.12 mais sur des
// containers cqw-based beaucoup plus grands; on compense ici.
const DotYSpline       = _mkSpline([{Time:0,Value:0},{Time:0.9,Value:-0.28},{Time:1,Value:0}]);
const DotGlowSpline    = _mkSpline([{Time:0,Value:0},{Time:0.6,Value:1},{Time:1,Value:1}]);
const DotOpacSpline    = _mkSpline([{Time:0,Value:0.35},{Time:0.6,Value:1},{Time:1,Value:1}]);

// ── Spring Factories ───────────────────────────────────────────────
// Exact params from LyricsAnimator.ts:
//   Scale:   freq=0.7 / damp=0.6
//   YOffset: freq=1.25 / damp=0.4
//   Glow:    freq=1.0  / damp=0.5
function _wordSprings() {
  if (SpicyConfig.SimpleLyricsMode) {
    return {
      Scale:   { Step: () => ScaleSpline.at(0), SetGoal: () => {}, value: ScaleSpline.at(0) },
      YOffset: new Spring(YOffSpline.at(0), 1.25, 0.4),
      Glow:    { Step: () => 0, SetGoal: () => {}, value: 0 },
    };
  }
  return {
    Scale:   new Spring(ScaleSpline.at(0), 0.7,  0.6),
    YOffset: new Spring(YOffSpline.at(0),  1.25, 0.4),
    Glow:    new Spring(GlowSpline.at(0),  1.0,  0.5),
  };
}
function _letterSprings() {
  return {
    Scale:   new Spring(ScaleSpline.at(0),      0.7,  0.6),
    YOffset: new Spring(LetterYOffSpline.at(0), 1.25, 0.4),
    Glow:    new Spring(GlowSpline.at(0),       1.0,  0.5),
  };
}
function _dotSprings() {
  if (SpicyConfig.SimpleLyricsMode) {
    return {
      Scale:   { Step: () => DotScaleSpline.at(0), SetGoal: () => {}, value: DotScaleSpline.at(0) },
      YOffset: { Step: () => 0, SetGoal: () => {}, value: 0 },
      Glow:    { Step: () => 0, SetGoal: () => {}, value: 0 },
      Opacity: new Spring(DotOpacSpline.at(0), 1.0, 0.5),
    };
  }
  // Dot params from LyricsAnimator.ts DotAnimations:
  // Scale: freq=0.7, damp=0.6 | YOffset: freq=1.25, damp=0.4 | Glow/Opacity: freq=1.0, damp=0.5
  return {
    Scale:   new Spring(DotScaleSpline.at(0), 0.7,  0.6),
    YOffset: new Spring(DotYSpline.at(0),     1.25, 0.4),
    Glow:    new Spring(DotGlowSpline.at(0),  1.0,  0.5),
    Opacity: new Spring(DotOpacSpline.at(0),  1.0,  0.5),
  };
}

// ── Ensure a dot word has its AnimatorStore initialised (idempotent) ─
function _ensureDotStore(word) {
  if (word.AnimatorStore) return;
  word.AnimatorStore = _dotSprings();
  word.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(0),  true);
  word.AnimatorStore.YOffset.SetGoal(DotYSpline.at(0),    true);
  word.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(0),    true);
  word.AnimatorStore.Opacity.SetGoal(DotOpacSpline.at(0), true);
  // Force-write initial DOM values AND prime the style cache.
  // Without this, if the CSS initial value matches the spring's initial
  // value, _setStyleIfChanged sees no change on the first rAF tick and
  // skips the write — making the dot appear stuck.
  const initScale   = DotScaleSpline.at(0).toFixed(5);
  const initOpacity = DotOpacSpline.at(0).toFixed(5);
  const initGlow    = DotGlowSpline.at(0);
  const initY       = (DotYSpline.at(0) || 0).toFixed(5);
  const initTransform = `translate3d(0,${initY}em,0)`;
  word.HTMLElement.style.scale     = initScale;
  word.HTMLElement.style.opacity   = initOpacity;
  word.HTMLElement.style.transform = initTransform;
  word.HTMLElement.style.setProperty('--text-shadow-blur-radius', `${(4 + 6 * initGlow).toFixed(2)}px`);
  word.HTMLElement.style.setProperty('--text-shadow-opacity',     `${(initGlow * 90).toFixed(2)}%`);
  let cache = _styleCache.get(word.HTMLElement);
  if (!cache) { cache = Object.create(null); _styleCache.set(word.HTMLElement, cache); }
  cache['scale']                     = initScale;
  cache['opacity']                   = initOpacity;
  cache['transform']                 = initTransform;
  cache['--text-shadow-blur-radius'] = `${(4 + 6 * initGlow).toFixed(2)}px`;
  cache['--text-shadow-opacity']     = `${(initGlow * 90).toFixed(2)}%`;
}

// ── Utilities ──────────────────────────────────────────────────────
function _state(now, s, e) {
  if (now < s) return 'NotSung';
  if (now > e) return 'Sung';
  return 'Active';
}
function _pct(now, s, e) {
  if (now <= s) return 0;
  if (now >= e) return 1;
  return (now - s) / (e - s);
}
function _easeSinOut(t) { return Math.sin((t * Math.PI) / 2); }
function _isLetterCapable(len, dur) {
  return len <= LETTER_MAX_LENGTH && dur >= (SpicyConfig.SimpleLyricsMode ? 800 : LETTER_MIN_DURATION);
}
function _slmAnimation(dur) { return `SLM_Animation ${dur}ms linear forwards`; }
function _preSLMAnimation(dur) { return `Pre_SLM_GradientAnimation ${dur}ms linear forwards`; }

// ── Apply progressive blur around active line ──────────────────────
function _applyBlur(arr, activeIdx) {
  // Flou symétrique : même intensité en avant (NotSung) et en arrière (Sung)
  // Les lignes passées sont grisées (via CSS opacity) avec un léger flou identique aux futures.
  const BLUR_PER_LEVEL = BLUR_MULTIPLIER * 0.7; // flou doux par niveau de distance
  const max = BLUR_PER_LEVEL * 3;               // plafond à 3 niveaux
  for (let i = 0; i < arr.length; i++) {
    // Dot lines are hidden/shown via CSS classes — never blur them
    if (arr[i].DotLine) {
      _setStyleIfChanged(arr[i].HTMLElement, '--BlurAmount', '0px', 0.25);
      continue;
    }
    if (i === activeIdx || _state(spicy.currentPosition, arr[i].StartTime, arr[i].EndTime) === 'Active') {
      // Ligne active : aucun flou
      _setStyleIfChanged(arr[i].HTMLElement, '--BlurAmount', '0px', 0.25);
    } else {
      // Distance symétrique : même flou avant ET après la ligne active
      const dist = Math.abs(i - activeIdx);
      const blur = Math.min(BLUR_PER_LEVEL * dist, max);
      _setStyleIfChanged(arr[i].HTMLElement, '--BlurAmount', `${blur.toFixed(2)}px`, 0.25);
    }
  }
}

function _scrollToActiveLine() {
  if (spicyScrollTimeout) return;
  spicyScrollTimeout = setTimeout(() => {
    const container = document.getElementById('lyricsDisplay');
    let active = container?.querySelector('.line.Active:not(.musical-line)');
    // Si la ligne est déjà passée à Sung avant la fin du délai (ligne courte < 80ms),
    // on scroll vers la dernière ligne Sung — c'est exactement celle qu'on voulait centrer.
    if (!active && container) {
      const sungLines = container.querySelectorAll('.line.Sung:not(.musical-line)');
      if (sungLines.length) active = sungLines[sungLines.length - 1];
    }
    if (active && container) {
      const ch = container.clientHeight;
      const ct = container.scrollTop;
      const lt = active.offsetTop;
      const lh = active.clientHeight;
      const target = lt - ch / 2 + lh / 2;
      // Clamp pour ne pas scroller au-delà du contenu → évite le vide sous la dernière ligne
      const maxScroll = container.scrollHeight - container.clientHeight;
      const clampedTarget = Math.max(0, Math.min(target, maxScroll));
      if (Math.abs((ct + ch/2) - (lt + lh/2)) > ch * 0.25) {
        container.scrollTo({ top: clampedTarget, behavior: 'smooth' });
      }
    }
    spicyScrollTimeout = null;
  }, 80);
}

// ── Scroll instantané vers la position actuelle à l'ouverture du panneau ──
// Trouve la dernière ligne dont le StartTime est ≤ position courante.
// Si aucune ligne n'est encore atteinte (intro dots), remonte au sommet.
function _forceLyricsSync() {
  const container = document.getElementById('lyricsDisplay');
  if (!container) return;
  const posMs = spicy.currentPosition;
  const arr   = spicy.lyricsObject?.Lines;
  if (!arr || !arr.length) return;

  // Trouver la dernière ligne réelle dont on a atteint le début
  let targetEl  = null;
  let targetIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].DotLine) continue;          // ignorer les dots musicaux
    if (arr[i].StartTime <= posMs) { targetEl = arr[i].HTMLElement; targetIdx = i; }
  }

  if (!targetEl) {
    // Intro : aucune ligne n'a commencé → remonter tout en haut
    container.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  // Réinitialiser le tracker pour que la prochaine transition déclenche bien un scroll
  spicyLastActiveLine = -1;
  spicyBlurLastLine   = -1;

  // Centrer la ligne cible sans animation (ouverture = instantané)
  if (container.clientHeight > 0) {
    const target = targetEl.offsetTop - container.clientHeight / 2 + targetEl.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
  }
}

// ── Sync mini-lyrics panel ─────────────────────────────────────────
function _syncMiniLyrics(lineIdx) {
  const miniLines = lyricsMiniContent.querySelectorAll('.lyrics-mini-line');
  miniLines.forEach((el, i) => {
    el.classList.remove('active', 'past');
    if (i < lineIdx) el.classList.add('past');
    else if (i === lineIdx) el.classList.add('active');
  });
  lyricsMiniContent.querySelector('.lyrics-mini-line.active')
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ══════════════════════════════════════════════════════════════════
//  MAIN ANIMATION LOOP  (driven by requestAnimationFrame)
// ══════════════════════════════════════════════════════════════════

function spicyAnimateLyrics(posMs) {
  const now = performance.now();
  // Always advance the frame-time clock so dt is correct even when the
  // FPS throttle fires (i.e. spicyLastFrameTime must tick every rAF, not
  // only every processed frame).
  const rawDt = now - spicyLastFrameTime;
  spicyLastFrameTime = now;

  if (now - spicyLastAnimateTime < SPICY_FPS) return;
  const dt = Math.min(rawDt / 1000, 0.05);
  spicyLastAnimateTime = now;

  const SLM = SpicyConfig.SimpleLyricsMode;
  const arr = spicy.lyricsObject.Lines;

  // ── Seek detection ─────────────────────────────────────────────────
  // If the playback position jumped by more than 1 s compared with what
  // we processed last frame, treat it as a seek: reset cached line indices
  // so blur / scroll refresh immediately for the new position.
  if (spicyAnimateLyrics._lastPosMs !== undefined &&
      Math.abs(posMs - spicyAnimateLyrics._lastPosMs) > 1000) {
    spicyBlurLastLine   = -1;
    spicyLastActiveLine = -1;
  }
  spicyAnimateLyrics._lastPosMs = posMs;

  for (let idx = 0; idx < arr.length; idx++) {
    const line = arr[idx];
    const ls = _state(posMs, line.StartTime, line.EndTime);

    // ── ACTIVE ──────────────────────────────────────────────────
    if (ls === 'Active') {
      if (spicyBlurLastLine !== idx) { _applyBlur(arr, idx); spicyBlurLastLine = idx; }
      if (spicyLastActiveLine !== idx) {
        _scrollToActiveLine();
        _syncMiniLyrics(idx);
        spicyLastActiveLine = idx;
      }
      line.HTMLElement.classList.remove('NotSung', 'Sung');
      line.HTMLElement.classList.add('Active');

      const words = line.Syllables?.Lead;
      if (!words) continue;

      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi];
        const ws = _state(posMs, word.StartTime, word.EndTime);
        const wp = _pct(posMs, word.StartTime, word.EndTime);

        // ── DOT ─────────────────────────────────────────────────
        if (word.Dot) {
          _ensureDotStore(word);
          _promoteGPU(word.HTMLElement);
          let ts, tg, to;
          // Y is computed DIRECTLY via Math.sin — NOT via a spring.
          // Root cause: the YOffset spring has freq=1.25 Hz (period 800ms) and
          // each dot window is totalTime/3 ≈ 800-1400ms. The spring barely reaches
          // its peak before the target returns to 0, producing near-invisible motion.
          // sin(wp × π) gives a full rise-and-fall in exactly one dot window,
          // regardless of duration. Amplitude -0.4em ≈ 20 px at typical font sizes.
          let cy = 0;
          if (ws === 'Active') {
            ts = DotScaleSpline.at(wp);
            tg = DotGlowSpline.at(wp);  to = DotOpacSpline.at(wp);
            cy = Math.sin(wp * Math.PI) * -0.4; // em — direct sine bounce
          } else if (ws === 'NotSung') {
            ts = DotScaleSpline.at(0);
            tg = DotGlowSpline.at(0);  to = DotOpacSpline.at(0);
            cy = 0;
          } else { // Sung — remain fully lit
            ts = DotScaleSpline.at(1);
            tg = DotGlowSpline.at(1);  to = DotOpacSpline.at(1);
            cy = 0;
          }
          word.AnimatorStore.Scale.SetGoal(ts);
          // Keep YOffset spring in sync so NotSung decay is smooth after a seek
          word.AnimatorStore.YOffset.SetGoal(cy, ws !== 'Active' /* immediate when not bouncing */);
          word.AnimatorStore.Glow.SetGoal(tg);
          word.AnimatorStore.Opacity.SetGoal(to);
          const cs = word.AnimatorStore.Scale.Step(dt);
          word.AnimatorStore.YOffset.Step(dt); // advance spring (used for smooth decay on seek)
          const cg = word.AnimatorStore.Glow.Step(dt);
          const co = word.AnimatorStore.Opacity.Step(dt);
          _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,${cy.toFixed(5)}em,0)`);
          _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`);
          _setStyleIfChanged(word.HTMLElement, 'opacity', `${co.toFixed(5)}`);
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 6*cg).toFixed(2)}px`, 0.25);
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${(cg * 90).toFixed(2)}%`, 1);
          continue;
        }

        // ── LETTER GROUP ────────────────────────────────────────
        if (word.LetterGroup && word.Letters) {
          // Find which letter is active and its progress
          let activeLetterIdx = -1, activeLetterPct = 0;
          for (let k = 0; k < word.Letters.length; k++) {
            const ltr = word.Letters[k];
            if (_state(posMs, ltr.StartTime, ltr.EndTime) === 'Active') {
              activeLetterIdx = k; activeLetterPct = _pct(posMs, ltr.StartTime, ltr.EndTime);
              break;
            }
          }
          // Détecter si TOUTES les lettres sont Sung (fin d'animation du mot)
          const allLettersSung = word.Letters.every(
            ltr => _state(posMs, ltr.StartTime, ltr.EndTime) === 'Sung'
          );
          for (let k = 0; k < word.Letters.length; k++) {
            const ltr = word.Letters[k];
            const ltrState = _state(posMs, ltr.StartTime, ltr.EndTime);
            if (!ltr.AnimatorStore) {
              ltr.AnimatorStore = _letterSprings();
              ltr.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
              ltr.AnimatorStore.YOffset.SetGoal(LetterYOffSpline.at(0), true);
              ltr.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
            }
            let tScale = ScaleSpline.at(0), tY = LetterYOffSpline.at(0), tGlow = GlowSpline.at(0), tGrad;
            if (allLettersSung) {
              // Toutes les lettres sont Sung : forcer immédiatement la position de repos
              // (scale=1, Y=0, glow=0) sans ressort résiduel. C'est le cas qui causait
              // la dernière lettre « bloquée » en position intermédiaire.
              tScale = ScaleSpline.at(1);     // 1.0
              tY     = LetterYOffSpline.at(1); // 0.0
              tGlow  = GlowSpline.at(1);       // 0.0
              tGrad  = 100;
              ltr.AnimatorStore.Scale.SetGoal(tScale, true);
              ltr.AnimatorStore.YOffset.SetGoal(tY, true);
              ltr.AnimatorStore.Glow.SetGoal(tGlow, true);
            } else if (activeLetterIdx !== -1) {
              const pct = SLM ? _pct(posMs, word.StartTime, word.EndTime) : activeLetterPct;
              // LyricsAnimator.ts uses falloff factor 0.9 (steeper — more focused on active letter)
              const falloff = Math.max(0, 1 / (1 + Math.abs(k - activeLetterIdx) * 0.9));
              tScale = ScaleSpline.at(0) + (ScaleSpline.at(pct) - ScaleSpline.at(0)) * falloff;
              tY     = LetterYOffSpline.at(0) + (LetterYOffSpline.at(pct) - LetterYOffSpline.at(0)) * falloff;
              tGlow  = GlowSpline.at(0) + (GlowSpline.at(pct) - GlowSpline.at(0)) * falloff;
            }
            if (!allLettersSung) {
              if (ltrState === 'Active') {
                const lp = _pct(posMs, ltr.StartTime, ltr.EndTime);
                // LyricsAnimator.ts: only the active letter gets gradient sweep; others stay at -20%
                tGrad = k === activeLetterIdx
                  ? (SLM ? -50 + 120 * _easeSinOut(lp) : -20 + 120 * _easeSinOut(lp))
                  : (SLM ? -50 : -20);
              } else if (ltrState === 'NotSung') {
                tGrad = SLM ? -50 : -20;
                if (!SLM) { tScale = ScaleSpline.at(0); tY = LetterYOffSpline.at(0); tGlow = GlowSpline.at(0); }
              } else { // Sung individuel (mais pas toutes Sung)
                tGrad = 100;
                // GlowSpline ends at 0; no residual glow for sung letters
                if (activeLetterIdx === -1) tGlow = 0;
              }
              ltr.AnimatorStore.Scale.SetGoal(tScale);
              ltr.AnimatorStore.YOffset.SetGoal(tY);
              ltr.AnimatorStore.Glow.SetGoal(tGlow);
            }
            const cs = ltr.AnimatorStore.Scale.Step(dt);
            const cy = ltr.AnimatorStore.YOffset.Step(dt);
            const cg = ltr.AnimatorStore.Glow.Step(dt);
            _promoteGPU(ltr.HTMLElement);
            if (SLM) {
              if (SpicyConfig.SimpleLyricsMode_RenderingType === 'calculate') {
                _setStyleIfChanged(ltr.HTMLElement, '--SLM_GradientPosition', `${tGrad.toFixed(2)}%`);
              } else {
                if (ltrState === 'Active' && !ltr.SLMAnimated) {
                  ltr.HTMLElement.style.removeProperty('--SLM_GradientPosition');
                  ltr.HTMLElement.style.animation = _slmAnimation(ltr.TotalTime);
                  ltr.SLMAnimated = true;
                } else if (ltrState === 'NotSung') {
                  ltr.HTMLElement.style.animation = 'none';
                  _setStyleIfChanged(ltr.HTMLElement, '--SLM_GradientPosition', '-50%');
                  ltr.SLMAnimated = false;
                } else if (ltrState === 'Sung') {
                  ltr.HTMLElement.style.animation = 'none';
                  _setStyleIfChanged(ltr.HTMLElement, '--SLM_GradientPosition', '100%');
                  ltr.SLMAnimated = false;
                }
              }
            } else {
              _setStyleIfChanged(ltr.HTMLElement, '--gradient-position', `${tGrad.toFixed(2)}%`);
            }
            // Quand toutes les lettres sont Sung, epsilon=0 pour forcer la valeur exacte
            // (epsilon=0.001 bloquait la mise à jour quand le spring était à 0.9999 → 1.0000)
            const epsilonFinal = allLettersSung ? 0 : 0.001;
            _setStyleIfChanged(ltr.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${(cy * 2).toFixed(5)}),0)`, epsilonFinal);
            _setStyleIfChanged(ltr.HTMLElement, 'scale', `${cs.toFixed(5)}`, epsilonFinal);
            _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-blur-radius', `${(4 + 12*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-opacity', `${(cg * LETTER_GLOW_MULTIPLIER).toFixed(2)}%`, 1);
          }
          continue;
        }

        // ── PLAIN WORD / LRC LINE ────────────────────────────────
        if (!word.AnimatorStore) {
          word.AnimatorStore = _wordSprings();
          word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
          word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(0), true);
          word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
        }
        _promoteGPU(word.HTMLElement);
        const totalDur = word.EndTime - word.StartTime;

        // ── LRC full-line sweep (spicy-lyrics style) ─────────────
        // For LRC lines there is exactly one "word" = the whole line text.
        // We drive it like SLM animate mode: a CSS keyframe sweep for the
        // gradient, plus scale/glow springs for the bounce & glow.
        if (word.IsLrcLine) {
          if (ws === 'Active') {
            // Scale/glow spring targets — follow the spline curves
            const lrcScale = ScaleSpline.at(wp);
            const lrcY     = YOffSpline.at(wp);
            const lrcGlow  = GlowSpline.at(wp);
            word.AnimatorStore.Scale.SetGoal(lrcScale);
            word.AnimatorStore.YOffset.SetGoal(lrcY);
            word.AnimatorStore.Glow.SetGoal(lrcGlow);
            const cs = word.AnimatorStore.Scale.Step(dt);
            const cy = word.AnimatorStore.YOffset.Step(dt);
            const cg = word.AnimatorStore.Glow.Step(dt);
            _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
            _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 16*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${Math.min(cg * 55, 100).toFixed(2)}%`, 1);
            // Kick off the CSS gradient sweep once per activation
            // Use cubic-bezier(0.45,0,0.55,1) = ease-in-out so the sweep
            // accelerates gently and decelerates — matches spicy-lyrics feel
            if (!word.LrcAnimated) {
              word.HTMLElement.style.removeProperty('--gradient-position');
              word.HTMLElement.style.animation = `LRC_LineAnimation ${totalDur}ms cubic-bezier(0.45,0,0.55,1) forwards`;
              word.LrcAnimated = true;
            }
            // Pre-activate the next LRC line: nudge its opacity slightly
            // so there's a visual "warmup" before it becomes Active
            // (spicy-lyrics does this via the Pre_SLM animation on the next word)
            if (!word.LrcNextPrepped) {
              const nextLrcWord = words[wi + 1]; // usually undefined for LRC (one word per line)
              // For multi-word LRC lines, warn next word; but mostly this handles line-level
              word.LrcNextPrepped = true;
              // Signal the next line's element after ~60% of this line's duration
              const nextLineDelay = Math.max(0, totalDur * 0.6 - 30);
              setTimeout(() => {
                const nextLine = line.HTMLElement.nextElementSibling;
                if (nextLine && nextLine.classList.contains('lrc-line') &&
                    nextLine.classList.contains('NotSung')) {
                  nextLine.style.opacity = '0.68';
                  nextLine.style.transition = 'opacity 0.22s ease';
                }
              }, nextLineDelay);
            }
          } else if (ws === 'NotSung') {
            word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0));
            word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(0));
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0));
            const cs = word.AnimatorStore.Scale.Step(dt);
            const cy = word.AnimatorStore.YOffset.Step(dt);
            const cg = word.AnimatorStore.Glow.Step(dt);
            _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
            _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
            if (word.LrcAnimated) {
              word.HTMLElement.style.animation = 'none';
              _setStyleIfChanged(word.HTMLElement, '--gradient-position', '-20%');
              word.LrcAnimated = false;
            }
            // Cancel any pre-activation tint
            if (word.HTMLElement.style.opacity && word.HTMLElement.style.opacity !== '') {
              word.HTMLElement.style.opacity = '';
              word.HTMLElement.style.transition = '';
            }
            word.LrcNextPrepped = false;
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', '4px');
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', '0%');
          } else { // Sung
            word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(1));
            word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(1));
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(1));
            const cs = word.AnimatorStore.Scale.Step(dt);
            const cy = word.AnimatorStore.YOffset.Step(dt);
            const cg = word.AnimatorStore.Glow.Step(dt);
            _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
            _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
            word.HTMLElement.style.animation = 'none';
            // Cancel pre-activation tint
            if (word.HTMLElement.style.opacity) {
              word.HTMLElement.style.opacity = '';
              word.HTMLElement.style.transition = '';
            }
            _setStyleIfChanged(word.HTMLElement, '--gradient-position', '100%');
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 2*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${Math.min(cg * 22, 100).toFixed(2)}%`, 1);
            word.LrcAnimated   = false;
            word.LrcNextPrepped = false;
          }
          continue;
        }

        let tScale, tY, tGlow, tGrad;
        if (ws === 'Active') {
          tScale = ScaleSpline.at(wp); tY = YOffSpline.at(wp);
          tGlow  = GlowSpline.at(wp);
          // spicy-lyrics gradient sweep: -20% → 100% over the word's duration
          // SLM: -50% → 100% (wider band for the larger SLM gradient offset)
          tGrad  = SLM ? -50 + 150*wp : -20 + 120*wp;
        } else if (ws === 'NotSung') {
          tScale = ScaleSpline.at(0); tY = YOffSpline.at(0);
          tGlow  = GlowSpline.at(0);
          tGrad  = SLM ? -50 : -20;
        } else {
          tScale = ScaleSpline.at(1); tY = YOffSpline.at(1);
          tGlow  = GlowSpline.at(1); tGrad = 100;
        }
        word.AnimatorStore.Scale.SetGoal(tScale);
        word.AnimatorStore.YOffset.SetGoal(tY);
        word.AnimatorStore.Glow.SetGoal(tGlow);
        const cs = word.AnimatorStore.Scale.Step(dt);
        const cy = word.AnimatorStore.YOffset.Step(dt);
        const cg = word.AnimatorStore.Glow.Step(dt);
        _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
        _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
        if (SLM) {
          if (SpicyConfig.SimpleLyricsMode_RenderingType === 'calculate') {
            _setStyleIfChanged(word.HTMLElement, '--SLM_GradientPosition', `${tGrad.toFixed(2)}%`);
          } else {
            if (ws === 'Active' && !word.SLMAnimated) {
              word.HTMLElement.style.removeProperty('--SLM_GradientPosition');
              word.HTMLElement.style.animation = _slmAnimation(totalDur);
              word.SLMAnimated = true; word.PreSLMAnimated = false;
              const nextW = words[wi + 1];
              if (nextW && !nextW.Dot && !nextW.PreSLMAnimated) {
                nextW.PreSLMAnimated = true;
                // spicy-lyrics: pre-animate next word starting at 60% of current word's duration
                // minus 22ms buffer. Duration of pre-animation is 125ms.
                const preDelay = Math.max(0, totalDur * 0.6 - 22);
                setTimeout(() => {
                  if (nextW.HTMLElement) {
                    nextW.HTMLElement.style.removeProperty('--SLM_GradientPosition');
                    nextW.HTMLElement.style.animation = _preSLMAnimation(125);
                  }
                }, preDelay);
              }
            } else if (ws === 'NotSung') {
              if (!word.PreSLMAnimated) {
                word.HTMLElement.style.animation = 'none';
                _setStyleIfChanged(word.HTMLElement, '--SLM_GradientPosition', '-50%');
              }
              word.SLMAnimated = false;
            } else if (ws === 'Sung') {
              word.HTMLElement.style.animation = 'none';
              _setStyleIfChanged(word.HTMLElement, '--SLM_GradientPosition', '100%');
              word.SLMAnimated = false; word.PreSLMAnimated = false;
            }
          }
        } else {
          _setStyleIfChanged(word.HTMLElement, '--gradient-position', `${tGrad.toFixed(2)}%`);
        }
        _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 2*cg).toFixed(2)}px`, 0.25);
        // spicy-lyrics: plain words glow multiplier is lower (35) than letters (185)
        _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${Math.min(cg * 35, 100).toFixed(2)}%`, 1);
      }

    // ── NOT SUNG ────────────────────────────────────────────────
    } else if (ls === 'NotSung') {
      line.HTMLElement.classList.remove('Active', 'Sung');
      line.HTMLElement.classList.add('NotSung');
      if (line.DotLine) {
        for (const d of (line.Syllables?.Lead || [])) {
          if (!d.Dot) continue;
          _ensureDotStore(d);
          _promoteGPU(d.HTMLElement);
          d.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(0));
          d.AnimatorStore.YOffset.SetGoal(0, true); // immediate — no spring lag at rest
          d.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(0));
          d.AnimatorStore.Opacity.SetGoal(DotOpacSpline.at(0));
          const cs = d.AnimatorStore.Scale.Step(dt);
          d.AnimatorStore.YOffset.Step(dt);
          const cg = d.AnimatorStore.Glow.Step(dt);
          const co = d.AnimatorStore.Opacity.Step(dt);
          _setStyleIfChanged(d.HTMLElement, 'transform', 'translate3d(0,0em,0)');
          _setStyleIfChanged(d.HTMLElement, 'scale', `${cs.toFixed(5)}`);
          _setStyleIfChanged(d.HTMLElement, 'opacity', `${co.toFixed(5)}`);
          _setStyleIfChanged(d.HTMLElement, '--text-shadow-blur-radius', `${(4+6*cg).toFixed(2)}px`, 0.25);
          _setStyleIfChanged(d.HTMLElement, '--text-shadow-opacity', `${(cg*90).toFixed(2)}%`, 1);
        }
      } else {
        // ── Decay regular-word springs toward rest (NotSung targets). ────
        // This is critical after seeks backward: if the line was Active and
        // mid-animation, its inline style.scale / style.transform retain the
        // last spring value.  Without stepping them here the words look
        // slightly wrong (off-scale, offset) in the NotSung dimmed state.
        for (const word of (line.Syllables?.Lead || [])) {
          if (!word.AnimatorStore) continue;   // spring not yet created → no-op
          _promoteGPU(word.HTMLElement);
          if (word.LetterGroup && word.Letters) {
            // Step each letter spring toward its NotSung rest position
            for (const ltr of word.Letters) {
              if (!ltr.AnimatorStore) continue;
              ltr.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0));
              ltr.AnimatorStore.YOffset.SetGoal(LetterYOffSpline.at(0));
              ltr.AnimatorStore.Glow.SetGoal(GlowSpline.at(0));
              const cs = ltr.AnimatorStore.Scale.Step(dt);
              const cy = ltr.AnimatorStore.YOffset.Step(dt);
              const cg = ltr.AnimatorStore.Glow.Step(dt);
              _promoteGPU(ltr.HTMLElement);
              _setStyleIfChanged(ltr.HTMLElement, 'scale', `${cs.toFixed(5)}`);
              _setStyleIfChanged(ltr.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${(cy*2).toFixed(5)}),0)`);
              _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-blur-radius', `${(4 + 12*cg).toFixed(2)}px`, 0.25);
              _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-opacity', `${(cg * LETTER_GLOW_MULTIPLIER).toFixed(2)}%`, 1);
            }
          } else {
            // Plain word / LRC line
            word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0));
            word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(0));
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0));
            const cs = word.AnimatorStore.Scale.Step(dt);
            const cy = word.AnimatorStore.YOffset.Step(dt);
            const cg = word.AnimatorStore.Glow.Step(dt);
            _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`);
            _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 2*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${Math.min(cg * 35, 100).toFixed(2)}%`, 1);
          }
        }
      }

    // ── SUNG ────────────────────────────────────────────────────
    } else {
      line.HTMLElement.classList.remove('Active', 'NotSung');
      line.HTMLElement.classList.add('Sung');

      for (const word of (line.Syllables?.Lead || [])) {
        if (word.Dot) {
          _ensureDotStore(word);
          _promoteGPU(word.HTMLElement);
          word.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(1));
          word.AnimatorStore.YOffset.SetGoal(0, true); // Y immediately at rest
          word.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(1));
          word.AnimatorStore.Opacity.SetGoal(DotOpacSpline.at(1));
          const cs = word.AnimatorStore.Scale.Step(dt);
          word.AnimatorStore.YOffset.Step(dt);
          const cg = word.AnimatorStore.Glow.Step(dt);
          const co = word.AnimatorStore.Opacity.Step(dt);
          _setStyleIfChanged(word.HTMLElement, 'transform', 'translate3d(0,0em,0)');
          _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`);
          _setStyleIfChanged(word.HTMLElement, 'opacity', `${co.toFixed(5)}`);
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4+6*cg).toFixed(2)}px`, 0.25);
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${(cg*90).toFixed(2)}%`, 1);
        } else if (word.LetterGroup && word.Letters) {
          // ── LETTRE GROUP dans état SUNG ─────────────────────────────
          // Les mots LetterGroup font un `continue` dans le bloc Active et
          // n'ont donc JAMAIS de word.AnimatorStore → la branche
          // `else if (!word.Dot && word.AnimatorStore)` ci-dessous les ignore.
          // Cette branche dédiée remet chaque lettre à sa position de repos.
          _promoteGPU(word.HTMLElement);
          if (SpicyConfig.SimpleLyricsMode) {
            word.HTMLElement.style.animation = 'none';
            _setStyleIfChanged(word.HTMLElement, '--SLM_GradientPosition', '100%');
          } else {
            _setStyleIfChanged(word.HTMLElement, '--gradient-position', '100%');
          }
          for (const ltr of word.Letters) {
            if (!ltr.AnimatorStore) ltr.AnimatorStore = _letterSprings();
            // Snap immédiat à la position de repos : scale=1, Y=0, glow=0
            ltr.AnimatorStore.Scale.SetGoal(ScaleSpline.at(1), true);
            ltr.AnimatorStore.YOffset.SetGoal(LetterYOffSpline.at(1), true);
            ltr.AnimatorStore.Glow.SetGoal(GlowSpline.at(1), true);
            ltr.AnimatorStore.Scale.Step(dt);
            ltr.AnimatorStore.YOffset.Step(dt);
            ltr.AnimatorStore.Glow.Step(dt);
            _promoteGPU(ltr.HTMLElement);
            if (SpicyConfig.SimpleLyricsMode) {
              ltr.HTMLElement.style.animation = 'none';
              _setStyleIfChanged(ltr.HTMLElement, '--SLM_GradientPosition', '100%');
            } else {
              _setStyleIfChanged(ltr.HTMLElement, '--gradient-position', '100%');
            }
            // Écriture directe (sans cache, sans epsilon) pour garantir la position exacte
            ltr.HTMLElement.style.transform = 'translate3d(0,0,0)';
            ltr.HTMLElement.style.scale = '1';
            ltr.HTMLElement.style.setProperty('--text-shadow-blur-radius', '4px');
            ltr.HTMLElement.style.setProperty('--text-shadow-opacity', '0%');
          }
        } else if (!word.Dot && word.AnimatorStore) {
          word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(1));
          word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(1));
          word.AnimatorStore.Glow.SetGoal(GlowSpline.at(1));
          const cs = word.AnimatorStore.Scale.Step(dt);
          const cy = word.AnimatorStore.YOffset.Step(dt);
          const cg = word.AnimatorStore.Glow.Step(dt);
          _promoteGPU(word.HTMLElement);
          _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
          _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
          if (word.IsLrcLine) {
            // LRC sung state: stop animation, lock gradient at 100%
            word.HTMLElement.style.animation = 'none';
            _setStyleIfChanged(word.HTMLElement, '--gradient-position', '100%');
            word.LrcAnimated = false;
          } else if (SpicyConfig.SimpleLyricsMode) {
            word.HTMLElement.style.animation = 'none';
            _setStyleIfChanged(word.HTMLElement, '--SLM_GradientPosition', '100%');
          } else {
            _setStyleIfChanged(word.HTMLElement, '--gradient-position', '100%');
          }
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 2*cg).toFixed(2)}px`, 0.25);
          _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity', `${Math.min(cg * 35, 100).toFixed(2)}%`, 1);
          if (word.LetterGroup && word.Letters) {
            for (const ltr of word.Letters) {
              if (!ltr.AnimatorStore) ltr.AnimatorStore = _letterSprings();
              // immediate=true : snapper directement à la position finale (scale=1, Y=0, glow=0)
              // pour que les lettres reviennent proprement à leur position de repos sans rebond résiduel.
              ltr.AnimatorStore.Scale.SetGoal(ScaleSpline.at(1), true);
              ltr.AnimatorStore.YOffset.SetGoal(LetterYOffSpline.at(1), true);
              ltr.AnimatorStore.Glow.SetGoal(GlowSpline.at(1), true);
              const lcs = ltr.AnimatorStore.Scale.Step(dt);
              const lcy = ltr.AnimatorStore.YOffset.Step(dt);
              const lcg = ltr.AnimatorStore.Glow.Step(dt);
              _promoteGPU(ltr.HTMLElement);
              if (SpicyConfig.SimpleLyricsMode) {
                ltr.HTMLElement.style.animation = 'none';
                _setStyleIfChanged(ltr.HTMLElement, '--SLM_GradientPosition', '100%');
              } else {
                _setStyleIfChanged(ltr.HTMLElement, '--gradient-position', '100%');
              }
              _setStyleIfChanged(ltr.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${(lcy * 2).toFixed(5)}),0)`, 0);
              _setStyleIfChanged(ltr.HTMLElement, 'scale', `${lcs.toFixed(5)}`, 0);
              _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-blur-radius', `${(4 + 12*lcg).toFixed(2)}px`, 0.25);
              _setStyleIfChanged(ltr.HTMLElement, '--text-shadow-opacity', `${(lcg * LETTER_GLOW_MULTIPLIER).toFixed(2)}%`, 1);
            }
          }
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
//  AUDIO GRAPH INIT + BACKGROUND CSS VARS
//  Initialise le contexte Web Audio partagé (EQ, normalisation, mono)
//  et met à jour les variables CSS de fond depuis la pochette.
// ══════════════════════════════════════════════════════════════════

// ── Initialisation du graphe audio partagé (EQ, normalisation, mono) ──
// Appelée une fois au premier "play" confirmé par l'utilisateur.
// Expose window._sharedAudioCtx / _sharedSourceNode / _sharedAnalyser
// et dispatche l'événement 'audioGraph:ready' pour settings.js.
function _initAudioGraph() {
  const audio = document.getElementById('audioPlayer');
  if (!audio || window._sharedAudioCtx) return;
  // Marque pour éviter une double-initialisation en cas d'appels simultanés.
  window._sharedAudioCtx = '__pending__';

  const _doInit = () => {
    if (window._sharedAudioCtx && window._sharedAudioCtx !== '__pending__') return;
    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source   = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      window._sharedAudioCtx   = ctx;
      window._sharedSourceNode = source;
      window._sharedAnalyser   = analyser;

      // Auto-reprendre l'AudioContext si le navigateur le suspend
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'suspended' && document.visibilityState === 'visible') {
          ctx.resume().catch(() => {});
        }
      });

      document.dispatchEvent(new CustomEvent('audioGraph:ready', {
        detail: { ctx, source, analyser }
      }));
    } catch (e) {
      // Web Audio non disponible ou élément déjà lié — on remet à null pour
      // qu'un retry soit possible lors du prochain play.
      window._sharedAudioCtx = null;
      console.warn("[AudioGraph] Impossible d'initialiser le contexte :", e);
    }
  };

  // Si l'audio joue déjà, init immédiatement ; sinon on attend le premier play.
  if (!audio.paused && audio.readyState >= 2) {
    _doInit();
  } else {
    audio.addEventListener('playing', _doInit, { once: true });
  }
}

// ── Extraction de palette couleur depuis une pochette ─────────────────
// Analyse l'image sur un canvas 48×48 et retourne un objet palette
// avec les rôles : minContrast, highContrast, higherContrast,
// vibrant, darkVibrant, lightVibrant, desaturated.
function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function _extractPalette(imageUrl, cb) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onerror = () => cb(null);
  img.onload = () => {
    try {
      const SIZE = 48;
      const C = document.createElement('canvas');
      C.width = C.height = SIZE;
      const ctx = C.getContext('2d');
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const pixels = [];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        if (a < 128) continue;
        const lum = 0.299*r + 0.587*g + 0.114*b;
        const hsl = _rgbToHsl(r, g, b);
        pixels.push({ r, g, b, lum, ...hsl });
      }
      if (!pixels.length) { cb(null); return; }
      const score = {
        minContrast:    p => (1 - p.l) * (1 - p.s * 0.5),
        highContrast:   p => p.s * (1 - Math.abs(p.l - 0.5) * 1.8),
        higherContrast: p => p.s * p.l,
        vibrant:        p => p.s * (1 - Math.abs(p.l - 0.5) * 2),
        darkVibrant:    p => p.s * Math.max(0, 0.4 - p.l) * 2.5,
        lightVibrant:   p => p.s * Math.max(0, p.l - 0.55) * 2.5,
        desaturated:    p => (1 - p.s) * (1 - Math.abs(p.l - 0.35)),
      };
      const best = fn => pixels.reduce((acc, p) => fn(p) > fn(acc) ? p : acc, pixels[0]);
      const toRgb = p => [p.r, p.g, p.b];
      cb({
        minContrast:    toRgb(best(score.minContrast)),
        highContrast:   toRgb(best(score.highContrast)),
        higherContrast: toRgb(best(score.higherContrast)),
        vibrant:        toRgb(best(score.vibrant)),
        darkVibrant:    toRgb(best(score.darkVibrant)),
        lightVibrant:   toRgb(best(score.lightVibrant)),
        desaturated:    toRgb(best(score.desaturated)),
      });
    } catch { cb(null); }
  };
  img.src = imageUrl;
}

function _fallbackPalette() {
  return {
    minContrast:    [18, 18, 18],
    highContrast:   [45, 30, 80],
    higherContrast: [90, 50, 150],
    vibrant:        [80, 30, 160],
    darkVibrant:    [30, 10, 80],
    lightVibrant:   [140, 80, 200],
    desaturated:    [18, 18, 18],
  };
}


// ══════════════════════════════════════════════════════════════════
//  SPICY BACKGROUND — API publique (port de ApplyDynamicBackground)
//
//  initSpicyBackground() : à appeler une fois au chargement de la page.
//  updateBackground(imageUrl) : à appeler à chaque changement de piste.
//
//  Fond global CSS :
//    - visibilitychange listener → reprend quand l'onglet reprend le focus
//    - transition: 0.5s → même vitesse que DynamicBackgroundConfig
//    - Gère les 3 couches CSS .Back/.Center/.Front du fond global
// ══════════════════════════════════════════════════════════════════

// ── Fond global (#spicyGlobalBg) — met à jour les CSS vars sur <html> ─
// Toutes les couches .Back/.Center/.Front lisent leurs couleurs via
// des variables CSS déclarées sur l'élément racine.
function _applyGlobalBgVars(palette) {
  if (!palette) return;
  const fmt  = (c, a = 1) => `${c[0]}, ${c[1]}, ${c[2]}, ${a}`;
  const root = document.documentElement;
  root.style.setProperty('--MinContrastColor',  fmt(palette.minContrast));
  root.style.setProperty('--HighContrastColor', fmt(palette.highContrast));
  root.style.setProperty('--OverlayColor',      fmt(palette.higherContrast));
  root.style.setProperty('--VibrantColor',      fmt(palette.vibrant));
  root.style.setProperty('--DarkVibrantColor',  fmt(palette.darkVibrant));
  root.style.setProperty('--DesaturatedColor',  fmt(palette.desaturated));
}

// ── Pause/reprise (visibilitychange) ─────────────────────────────────
// Corrige le bug : l'AudioContext se suspend automatiquement quand le
// navigateur cache l'onglet, ce qui interrompt la lecture audio.
// On mémorise l'état de lecture, on reprend l'AudioContext puis l'audio
// dès que la page redevient visible.
document.addEventListener('visibilitychange', () => {
  // 1. CSS background layers
  const layers = document.querySelectorAll('.spicy-bg-layer');
  const state = document.visibilityState === 'visible' ? 'running' : 'paused';
  layers.forEach(l => l.style.animationPlayState = state);

  const ap = document.getElementById('audioPlayer');
  if (document.visibilityState === 'hidden') {
    // Mémoriser si la lecture était active avant le changement de fenêtre
    window._wasPlayingBeforeHide = ap && !ap.paused;
  } else {
    // 2. Reprendre l'AudioContext si le navigateur l'a suspendu
    const ctx = window._sharedAudioCtx;
    if (ctx && ctx !== '__pending__' && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        // 3. Relancer l'audio s'il jouait avant
        if (ap && ap.paused && window._wasPlayingBeforeHide) {
          ap.play().catch(() => {});
        }
      }).catch(() => {});
    } else if (ap && ap.paused && window._wasPlayingBeforeHide) {
      // AudioContext déjà actif (ou absent) — relancer directement
      ap.play().catch(() => {});
    }
    window._wasPlayingBeforeHide = false;
  }
});

// ── initSpicyBackground() ─────────────────────────────────────────
function initSpicyBackground() {
  const root = document.documentElement;
  root.style.setProperty('--MinContrastColor',  '18, 18, 18, 1');
  root.style.setProperty('--HighContrastColor', '18, 18, 18, 1');
  root.style.setProperty('--OverlayColor',      '18, 18, 18, 1');
  root.style.setProperty('--VibrantColor',      '40, 20, 80, 1');
  root.style.setProperty('--DarkVibrantColor',  '18, 8,  40, 1');
  root.style.setProperty('--DesaturatedColor',  '20, 18, 25, 1');

  document.querySelectorAll('.spicy-bg-layer').forEach(l => {
    l.style.animationPlayState = 'running';
  });

  // Préparer le graphe audio (EQ, normalisation, mono) en différant
  // à la première interaction utilisateur (play).
  _initAudioGraph();
}

// ── updateBackground(imageUrl) ────────────────────────────────────
// Extrait la palette de la pochette et met à jour les CSS vars du fond.
let _bgUpdateTimer = null;
function updateBackground(imageUrl) {
  if (_bgUpdateTimer) { clearTimeout(_bgUpdateTimer); _bgUpdateTimer = null; }
  _bgUpdateTimer = setTimeout(() => {
    _bgUpdateTimer = null;
    if (!imageUrl) {
      _applyGlobalBgVars(_fallbackPalette());
      return;
    }
    _extractPalette(imageUrl, (palette) => {
      _applyGlobalBgVars(palette || _fallbackPalette());
    });
  }, 400);
}


function spicyAnimationLoop() {
  // Pull the freshest position on every rAF frame instead of relying on
  // timeupdate (~4 Hz) — fixes the 250 ms position-step that made the
  // gradient sweep and spring targets stutter visibly.
  if (!isDragging && audioPlayer && audioPlayer.readyState >= 2) {
    spicy.currentPosition = audioPlayer.currentTime * 1000;
  }

  // ── Springs run ALWAYS (not just when playing) ─────────────────────
  // This ensures:
  //  • springs decay to rest when the user pauses mid-bounce
  //  • spicyLastFrameTime stays current so dt is never stale on resume
  //  • blur/scroll state refreshes correctly after a seek
  if (lyricsData) {
    spicyAnimateLyrics(spicy.currentPosition);
  } else {
    // Even without lyrics, keep lastFrameTime fresh to avoid a huge dt
    // spike on the first frame after lyrics are loaded.
    spicyLastFrameTime = performance.now();
  }
  requestAnimationFrame(spicyAnimationLoop);
}

// ── Toggle SimpleLyricsMode ────────────────────────────────────────
function toggleSimpleLyricsMode(on) {
  SpicyConfig.SimpleLyricsMode = on ?? !SpicyConfig.SimpleLyricsMode;
  // Simple mode uses a simpler 2-point spline; normal mode uses the full 3-point
  YOffSpline = SpicyConfig.SimpleLyricsMode ? YOffSplineSimple
    : _mkSpline([{Time:0,Value:0.01},{Time:0.9,Value:-(1/60)},{Time:1,Value:0}]);
  lyricsDisplay.classList.toggle('SimpleLyricsMode', SpicyConfig.SimpleLyricsMode);
  if (lyricsData) renderSpicyLyrics(lyricsData.lines, lyricsData.type);
}

// ══════════════════════════════════════════════════════════════════
//  DOM RENDERER — builds .line / .word / .letterGroup / .letter
// ══════════════════════════════════════════════════════════════════

function renderSpicyLyrics(lines, type) {
  // ── Reset all state ────────────────────────────────────────────
  spicy.lyricsObject  = { Lines: [] };
  spicyBlurLastLine   = -1;
  spicyLastActiveLine = -1;
  audioPlayer._lastLineScrolled = false; // réinitialiser le scroll de fin
  lyricsDisplay.innerHTML = '';

  const scrollCont = document.createElement('div');
  scrollCont.className = 'spicy-scroll-container';
  lyricsDisplay.appendChild(scrollCont);

  const GAP_MS = 2500;  // Trigger interlude dots after 2.5s gap (was 3s)

  // ── Normalise input ────────────────────────────────────────────
  // json → per-word syllables with IsPartOfWord from source data.
  // lrc  → one syllable per line (whole-line highlight).
  const content = lines.map(line => {
    const endMs = line.endMs ?? (line.startMs + 4500);
    const isLrc = !(type === 'json' && line.words?.length);
    const syls = !isLrc
      ? line.words
          .map(w => ({
            Text:        (w.text || '').trim(),
            StartTime:   w.startMs,
            EndTime:     w.endMs ?? (w.startMs + 500),
            // Preserve isPartOfWord from PNL format; default false for plain word-sync
            IsPartOfWord: w.isPartOfWord ?? false,
          }))
          .filter(w => w.Text.length > 0)   // drop any blank/whitespace-only tokens
      : [{ Text: (line.text || '').trim(), StartTime: line.startMs, EndTime: endMs, IsPartOfWord: false, IsLrcLine: true }];
    // Normaliser line.background / line.backgrounds vers le format interne attendu :
    //   [{ StartTime, EndTime, Syllables: [{ Text, StartTime, EndTime, IsPartOfWord }] }]
    //
    // Origines possibles selon la version du fichier JSON :
    //   1. undefined/null               → aucun backing vocal
    //   2. backgrounds[] (Array)        → nouveau format lyrics.js v7+ (priorité)
    //      ├─ éléments au format PNL    → { Syllables[], StartTime, EndTime } (issu de _parsePNLContent)
    //      └─ éléments au format words  → { text, startTime, endTime, words[] } (parsé word-sync)
    //   3. background (Array déjà PNL)  → issu de _parsePNLContent (ancien rawLyrics/originalData)
    //   4. background (objet PNL brut)  → cas défensif non enveloppé
    //   5. background (objet words)     → fallback lyrics.lines ancien format
    const rawBg  = line.background;
    const rawBgs = line.backgrounds;   // tableau complet (lyrics.js v7+)

    // Convertit un objet bg au format words → format PNL interne
    function _bgWordsToInternal(bg) {
      return {
        StartTime: bg.startTime,
        EndTime:   bg.endTime,
        Syllables: (bg.words || []).map(w => ({
          Text:         (w.text || '').trim(),
          StartTime:    w.startTime,
          EndTime:      w.endTime ?? (w.startTime + 500),
          IsPartOfWord: false,
        })).filter(w => w.Text.length > 0),
      };
    }

    let normBg;
    if (rawBgs && Array.isArray(rawBgs) && rawBgs.length > 0) {
      // Priorité : backgrounds[] (lyrics.js v7+) — tableau complet de toutes les sections
      normBg = rawBgs.flatMap(bg => {
        if (!bg) return [];
        if (bg.Syllables) return [bg];       // déjà format PNL interne (depuis _parsePNLContent)
        if (bg.words)     return [_bgWordsToInternal(bg)];
        return [];
      }).filter(b => b.Syllables?.length > 0);
    } else if (!rawBg) {
      normBg = [];
    } else if (Array.isArray(rawBg)) {
      normBg = rawBg;   // déjà au bon format (issu de _parsePNLContent)
    } else if (rawBg.Syllables) {
      normBg = [rawBg]; // objet PNL brut non enveloppé (cas défensif)
    } else if (rawBg.words) {
      // Format lyrics.lines : { text, startTime, endTime, words[] } — temps en ms
      normBg = [_bgWordsToInternal(rawBg)];
    } else {
      normBg = [];
    }

    return {
      Lead: { StartTime: line.startMs, EndTime: endMs, Syllables: syls },
      Background: normBg,
      OppositeAligned: line.oppositeAligned || false,
      IsLrcLine: isLrc,
    };
  });

  // ── Intro dots ─────────────────────────────────────────────────
  if (content.length && content[0].Lead.StartTime >= GAP_MS) {
    _createMusicalDots(scrollCont, 0, content[0].Lead.StartTime, false);
  }

  // ── Helper: create initial CSS state for a word/letter element ─
  function _initWordEl(el, SLM) {
    el.style.setProperty(SLM ? '--SLM_GradientPosition' : '--gradient-position', SLM ? '-50%' : '-20%');
    el.style.setProperty('--text-shadow-opacity', '0%');
    el.style.setProperty('--text-shadow-blur-radius', '4px');
    el.style.scale     = `${ScaleSpline.at(0)}`;
    el.style.transform = `translateY(calc(var(--DefaultLyricsSize) * ${YOffSpline.at(0)}))`;
  }

  content.forEach((lineData, i) => {
    // ── Lead vocal line ──────────────────────────────────────────
    const lineEl = document.createElement('div');
    lineEl.className = 'line NotSung';
    if (lineData.OppositeAligned) lineEl.classList.add('OppositeAligned');
    if (lineData.IsLrcLine) lineEl.classList.add('lrc-line');

    const lineObj = {
      HTMLElement: lineEl,
      StartTime: lineData.Lead.StartTime,
      EndTime:   lineData.Lead.EndTime,
      TotalTime: lineData.Lead.EndTime - lineData.Lead.StartTime,
      Syllables: { Lead: [] },
      IsLrcLine: lineData.IsLrcLine || false,
    };
    spicy.lyricsObject.Lines.push(lineObj);
    const lineIdx = spicy.lyricsObject.Lines.length - 1;

    const syls = lineData.Lead.Syllables || [];
    syls.forEach((syl, si) => {
      const dur    = syl.EndTime - syl.StartTime;
      const isLast = si === syls.length - 1;
      const SLM    = SpicyConfig.SimpleLyricsMode;

      if (_isLetterCapable(syl.Text.length, dur)) {
        // ── LRC line: split by words → per-word letter-groups + text-node spaces ─
        // This preserves the per-character animation while rendering visible spaces.
        // (Space characters inside letter spans with display:inline-flex are invisible;
        //  real text-node spaces inserted between letterGroup elements are not.)
        if (syl.IsLrcLine) {
          const wordTokens = syl.Text.split(' ').filter(w => w.length > 0);
          const totalChars = wordTokens.reduce((s, w) => s + w.length, 0);
          let charOffset = 0;
          wordTokens.forEach((wText, wIdx) => {
            const isLastWord = wIdx === wordTokens.length - 1;
            const grpEl = document.createElement('span');
            grpEl.className = 'letterGroup'
              + (isLastWord ? ' LastWordInLine' : '')
              + (syl.IsPartOfWord && wIdx === 0 ? ' PartOfWord' : '');
            const wLetters  = wText.split('');
            const lettersData = [];
            wLetters.forEach((ch, li) => {
              const lEl = document.createElement('span');
              lEl.textContent = ch;
              lEl.className   = 'letter Emphasis';
              _initWordEl(lEl, SLM);
              const fracStart = (charOffset + li)     / Math.max(totalChars, 1);
              const fracEnd   = (charOffset + li + 1) / Math.max(totalChars, 1);
              const ls = syl.StartTime + fracStart * dur;
              const le = syl.StartTime + fracEnd   * dur;
              lettersData.push({ HTMLElement: lEl, StartTime: ls, EndTime: le, TotalTime: le - ls });
              grpEl.appendChild(lEl);
            });
            const grpStart = syl.StartTime + (charOffset / Math.max(totalChars, 1)) * dur;
            const grpEnd   = syl.StartTime + ((charOffset + wLetters.length) / Math.max(totalChars, 1)) * dur;
            spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
              HTMLElement: grpEl,
              StartTime: grpStart, EndTime: grpEnd, TotalTime: grpEnd - grpStart,
              LetterGroup: true, Letters: lettersData,
            });
            lineEl.appendChild(grpEl);
            if (!isLastWord) lineEl.appendChild(document.createTextNode(' '));
            charOffset += wLetters.length;
          });

        } else {
          // ── Non-LRC letter group (JSON syllable) ────────────────
          const grpEl = document.createElement('span');
          grpEl.className = 'letterGroup'
            + (isLast           ? ' LastWordInLine' : '')
            + (syl.IsPartOfWord ? ' PartOfWord'     : '');

          const letters  = syl.Text.split('');
          const letDur   = dur / Math.max(letters.length, 1);
          const lettersData = [];

          letters.forEach((ch, li) => {
            const lEl = document.createElement('span');
            lEl.textContent = ch;
            lEl.className   = 'letter Emphasis';
            _initWordEl(lEl, SLM);
            const ls = syl.StartTime + li * letDur;
            const le = ls + letDur;
            lettersData.push({ HTMLElement: lEl, StartTime: ls, EndTime: le, TotalTime: letDur });
            grpEl.appendChild(lEl);
          });

          spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
            HTMLElement: grpEl,
            StartTime: syl.StartTime, EndTime: syl.EndTime, TotalTime: dur,
            LetterGroup: true, Letters: lettersData,
          });
          lineEl.appendChild(grpEl);
          if (!isLast && !syl.IsPartOfWord) {
            lineEl.appendChild(document.createTextNode(' '));
          }
        }

      } else {
        // ── Plain word span ────────────────────────────────────
        const wordEl = document.createElement('span');
        wordEl.textContent = syl.Text;
        wordEl.className   = 'word'
          + (isLast          ? ' LastWordInLine' : '')
          + (syl.IsPartOfWord ? ' PartOfWord'    : '')
          + (syl.IsLrcLine   ? ' lrc-word'       : '');
        _initWordEl(wordEl, SLM);

        spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
          HTMLElement: wordEl,
          StartTime: syl.StartTime, EndTime: syl.EndTime, TotalTime: dur,
          IsLrcLine: syl.IsLrcLine || false,
        });
        lineEl.appendChild(wordEl);
        // Insert real space after word (except last and glued syllables)
        if (!isLast && !syl.IsPartOfWord) {
          lineEl.appendChild(document.createTextNode(' '));
        }
      }
    });

    // Click to seek
    lineEl.addEventListener('click', () => {
      audioPlayer.currentTime = lineData.Lead.StartTime / 1000;
      if (audioPlayer.paused) audioPlayer.play().catch(console.error);
    });
    scrollCont.appendChild(lineEl);

    // ── Background / harmony vocal line ─────────────────────────
    (lineData.Background || []).forEach(bg => {
      const bgEl = document.createElement('div');
      bgEl.className = 'line bg-line NotSung';
      if (lineData.OppositeAligned) bgEl.classList.add('OppositeAligned');

      spicy.lyricsObject.Lines.push({
        HTMLElement: bgEl,
        StartTime: bg.StartTime, EndTime: bg.EndTime,
        TotalTime: bg.EndTime - bg.StartTime,
        Syllables: { Lead: [] }, BGLine: true,
      });
      const bgIdx = spicy.lyricsObject.Lines.length - 1;

      (bg.Syllables || []).forEach((syl, si) => {
        const isLastBg = si === bg.Syllables.length - 1;
        const wEl = document.createElement('span');
        wEl.textContent = syl.Text;
        const SLM = SpicyConfig.SimpleLyricsMode;
        wEl.className = 'word'
          + (isLastBg ? ' LastWordInLine' : '')
          + (syl.IsPartOfWord ? ' PartOfWord' : '');
        _initWordEl(wEl, SLM);
        spicy.lyricsObject.Lines[bgIdx].Syllables.Lead.push({
          HTMLElement: wEl,
          StartTime: syl.StartTime, EndTime: syl.EndTime,
          TotalTime: syl.EndTime - syl.StartTime, BGWord: true,
        });
        bgEl.appendChild(wEl);
        if (!isLastBg && !syl.IsPartOfWord) {
          bgEl.appendChild(document.createTextNode(' '));
        }
      });
      scrollCont.appendChild(bgEl);
    });

    // ── Interlude dots between lines ─────────────────────────────
    const next = content[i + 1];
    if (next && (next.Lead.StartTime - lineData.Lead.EndTime) >= GAP_MS) {
      _createMusicalDots(scrollCont, lineData.Lead.EndTime, next.Lead.StartTime, lineData.OppositeAligned);
    }
  });

  // ── Mini lyrics strip ──────────────────────────────────────────
  lyricsMiniContent.innerHTML = lines.map((line, li) =>
    `<div class="lyrics-mini-line" data-line="${li}">${escapeHtml(line.text)}</div>`
  ).join('');

  // Scroll to top
  requestAnimationFrame(() => { if (lyricsDisplay) lyricsDisplay.scrollTop = 0; });
}

// ── Create animated interlude dot group ───────────────────────────
// Timing matches Syllable.ts exactly:
//   totalTime = silence duration; dotTime = totalTime / 3
//   dot0: [start,         start + dotTime)
//   dot1: [start+dotTime, start + dotTime*2)
//   dot2: [start+dotTime*2, end - 400ms)  (last dot ends slightly before next line)
function _createMusicalDots(container, startTime, endTime, oppositeAligned) {
  const musLine = document.createElement('div');
  musLine.className = 'line musical-line NotSung';
  if (oppositeAligned) musLine.classList.add('OppositeAligned');

  const lineObj = {
    HTMLElement: musLine,
    StartTime: startTime, EndTime: endTime,
    TotalTime: endTime - startTime,
    DotLine: true, Syllables: { Lead: [] },
  };
  spicy.lyricsObject.Lines.push(lineObj);
  const lineIdx = spicy.lyricsObject.Lines.length - 1;

  const dotGroup = document.createElement('div');
  dotGroup.className = 'dotGroup';

  const totalTime = endTime - startTime;
  // Source (Syllable.ts): dotTime = totalTime / 3, sequential non-overlapping windows
  const dotTime = totalTime / 3;

  const dotWindows = [
    { ds: startTime,              de: startTime + dotTime },
    { ds: startTime + dotTime,    de: startTime + dotTime * 2 },
    // Last dot ends 400ms before the next line starts (endInterludeEarlierBy = -400 in source)
    { ds: startTime + dotTime * 2, de: endTime - 400 },
  ];

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.textContent = '•';
    dot.className = 'word dot';
    dot.dataset.dotIndex = i;
    const { ds, de } = dotWindows[i];
    spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
      HTMLElement: dot,
      StartTime: ds, EndTime: Math.max(de, ds + 100),
      TotalTime: Math.max(de - ds, 100),
      Dot: true, DotIndex: i,
    });
    dotGroup.appendChild(dot);
  }

  musLine.appendChild(dotGroup);
  container.appendChild(musLine);
}

// ── DOM refs ───────────────────────────────────────────────────────
const audioPlayer       = document.getElementById('audioPlayer');
const trackListDiv      = document.getElementById('trackList');
const searchInput       = document.getElementById('searchInput');
const topSearchInput    = document.getElementById('topSearchInput');
const currentTitleEl    = document.getElementById('currentTitle');
const currentArtistEl   = document.getElementById('currentArtist');
const currentTitleWrap  = document.getElementById('currentTitleWrap');
const currentArtistWrap = document.getElementById('currentArtistWrap');
const playPauseBtn      = document.getElementById('playPauseBtn');
const playIconImg       = document.getElementById('playIconImg');
const pauseIconImg      = document.getElementById('pauseIconImg');
const prevBtn           = document.getElementById('prevBtn');
const nextBtn           = document.getElementById('nextBtn');
const shuffleBtn        = document.getElementById('shuffleBtn');
const repeatBtn         = document.getElementById('repeatBtn');
const muteBtn           = document.getElementById('muteBtn');
const volumeSlider      = document.getElementById('volumeSlider');
const volumeFill        = document.getElementById('volumeFill');
const volumeThumb       = document.getElementById('volumeThumb');
const progressContainer = document.getElementById('progressContainer');
const progressFill      = document.getElementById('progressFill');
const progressThumb     = document.getElementById('progressThumb');
const currentTimeEl     = document.getElementById('currentTime');
const totalTimeEl       = document.getElementById('totalTime');
const lyricsDisplay     = document.getElementById('lyricsDisplay');
const lyricsBtn         = document.getElementById('lyricsBtn');
const queueBtn          = document.getElementById('queueBtn');
const nowPlayingBtn     = document.getElementById('nowPlayingBtn');
const rightPanel        = document.getElementById('rightPanel');
const panelTitle        = document.getElementById('panelTitle');
const panelArtist       = document.getElementById('panelArtist');
const panelAlbum        = document.getElementById('panelAlbum');
const panelTitleWrap    = document.getElementById('panelTitleWrap');
const panelArtistWrap   = document.getElementById('panelArtistWrap');
const panelAlbumWrap    = document.getElementById('panelAlbumWrap');
const albumArtLarge     = document.getElementById('albumArtLarge');
const playerThumb       = document.getElementById('playerThumb');
const lyricsMiniContent = document.getElementById('lyricsMiniContent');
const likeBtn           = document.getElementById('likeBtn');
const miniLike          = document.getElementById('miniLike');
const closePanelBtn     = document.getElementById('closePanelBtn');
const lyricsPanelBtn    = document.getElementById('lyricsPanelBtn');
const lyricsPanel       = document.getElementById('lyricsPanel');
const queuePanel        = document.getElementById('queuePanel');
const welcomeContent    = document.getElementById('welcomeContent');
const sidebar           = document.getElementById('sidebar');
const libToggleBtn      = document.getElementById('libToggleBtn');
const btnBack           = document.getElementById('btnBack');
const btnForward        = document.getElementById('btnForward');
const btnHome           = document.getElementById('btnHome');
const extendedInfoEl    = document.getElementById('extendedInfo');
const detailView        = document.getElementById('detailView');
const searchResultsPage = document.getElementById('searchResultsPage');

// ── Fetch Tracks ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
//  JELLYFIN TRACK LOADER — optimisé
//  Stratégie :
//  1. Chargement instantané depuis IndexedDB (si cache valide)
//  2. userId + comptage total en parallèle (2 requêtes simultanées)
//  3. Toutes les pages de données en parallèle dès le départ
//  4. Affichage de la première page dès qu'elle arrive
//  5. Écriture du cache en arrière-plan (non-bloquant)
//  6. Page size à 2 000 → 1–2 requêtes pour bibliothèques normales
// ══════════════════════════════════════════════════════════════════

const CACHE_DB_NAME    = 'BeartifyCache';
const CACHE_STORE      = 'tracks';
const CACHE_META_STORE = 'meta';
const CACHE_DB_VERSION = 2;
const PAGE_SIZE        = 2000;
const JELLY_FIELDS     = 'Artists,AlbumArtist,Album,AlbumId,ProductionYear,DateCreated,PremiereDate,RunTimeTicks,ImageTags,AlbumPrimaryImageTag';

// ── IndexedDB helpers ──────────────────────────────────────────────
function _openCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE))      db.createObjectStore(CACHE_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE_META_STORE)) db.createObjectStore(CACHE_META_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}
async function _readCacheTracks(db) {
  return new Promise(resolve => {
    const tx  = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => resolve([]);
  });
}
async function _readCacheMeta(db, key) {
  return new Promise(resolve => {
    const tx  = db.transaction(CACHE_META_STORE, 'readonly');
    const req = tx.objectStore(CACHE_META_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => resolve(null);
  });
}
async function _writeCacheTracks(db, trackList, totalCount) {
  return new Promise(resolve => {
    const tx    = db.transaction([CACHE_STORE, CACHE_META_STORE], 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    store.clear();
    for (const t of trackList) store.put(t);
    tx.objectStore(CACHE_META_STORE).put(totalCount,   'totalCount');
    tx.objectStore(CACHE_META_STORE).put(Date.now(),   'cachedAt');
    tx.objectStore(CACHE_META_STORE).put('beartify-v2', 'server');
    tx.oncomplete = () => resolve();
    tx.onerror    = () => resolve();
  });
}

async function fetchTracks() {
  let db = null;
  try { db = await _openCacheDB(); } catch {}

  // ── 1. Cache IndexedDB → UI instantanée ───────────────────────
  if (db) {
    const [cachedTracks, cachedServer] = await Promise.all([
      _readCacheTracks(db),
      _readCacheMeta(db, 'server'),
    ]);
    if (cachedTracks.length > 0 && cachedServer === 'beartify-v2') {
      tracks       = cachedTracks.map(normalizeTrack);
      shuffleOrder = [...tracks.keys()];
      renderSidebarView('playlists');
      renderHomePage();
      renderQueueList();
      console.log(`[Beartify] ${tracks.length} titres chargés depuis le cache — actualisation en arrière-plan…`);
      // Refresh silencieux différé : on attend 8 s avant de lancer les requêtes
      // vers Jellyfin. Sans ce délai, le rafraîchissement tire toutes les pages
      // de la bibliothèque en parallèle dès le chargement de la page, ce qui
      // sature le proxy Caddy → Jellyfin et empêche les streams audio de démarrer
      // immédiatement (la 2ème piste pouvait être bloquée jusqu'à ~30 secondes).
      setTimeout(() => _refreshTracksFromServer(db).catch(console.warn), 8000);
      return;
    }
  }

  // ── 2. Pas de cache → chargement complet avec affichage progressif
  await _refreshTracksFromServer(db);
}

async function _refreshTracksFromServer(db) {
  try {
    // userId + comptage total en parallèle
    const [usersResp, countResp] = await Promise.all([
      fetch(jellyfinUrl('/Users')),
      fetch(jellyfinUrl('/Items?Recursive=true&IncludeItemTypes=Audio&Fields=Id&Limit=1&StartIndex=0')),
    ]);
    if (!usersResp.ok) throw new Error(`Users HTTP ${usersResp.status}`);
    const [users, countData] = await Promise.all([
      usersResp.json(),
      countResp.ok ? countResp.json() : { TotalRecordCount: 0 },
    ]);
    const userId     = users[0]?.Id;
    if (!userId) throw new Error('Aucun utilisateur trouvé');
    const totalCount = countData.TotalRecordCount || 0;

    // ── 3. Pages en petits lots (max 2 simultanées) ───────────────
    // On évite de lancer TOUTES les pages en parallèle car cela saturerait
    // le pool de connexions Caddy → Jellyfin et bloquerait les streams audio
    // (la 2ème piste pouvait attendre jusqu'à 30 s que tous les fetches se
    // terminent). Avec CONCURRENCY = 2, Jellyfin garde toujours des slots
    // libres pour les requêtes de streaming audio.
    const FETCH_CONCURRENCY = 2;
    const pageCount         = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    let   firstRendered     = false;
    const allTracks         = [];

    async function _fetchOnePage(p) {
      const start = p * PAGE_SIZE;
      const r = await fetch(
        jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&Fields=${JELLY_FIELDS}&SortBy=SortName&SortOrder=Ascending&Limit=${PAGE_SIZE}&StartIndex=${start}`)
      );
      const data = r.ok ? await r.json() : null;
      if (!data?.Items) return [];
      const batch = data.Items.map(normaliseTrack);
      // Afficher la première page dès son arrivée
      if (!firstRendered) {
        firstRendered = true;
        tracks        = batch;
        shuffleOrder  = [...tracks.keys()];
        renderSidebarView('playlists');
        renderHomePage();
      }
      return batch;
    }

    for (let i = 0; i < pageCount; i += FETCH_CONCURRENCY) {
      const sliceSize = Math.min(FETCH_CONCURRENCY, pageCount - i);
      const batchResults = await Promise.all(
        Array.from({ length: sliceSize }, (_, k) => _fetchOnePage(i + k))
      );
      for (const b of batchResults) allTracks.push(...b);
    }

    // ── 4. Consolider et mettre à jour l'UI ───────────────────────

    if (allTracks.length > 0) {
      tracks       = allTracks;
      shuffleOrder = [...tracks.keys()];
      renderSidebarView(currentSidebarFilter || 'playlists');
      renderQueueList();
      renderHomePage();
    }

    // ── 5. Persister le cache en arrière-plan (non-bloquant) ──────
    if (db && allTracks.length > 0) {
      setTimeout(() => _writeCacheTracks(db, allTracks, totalCount), 0);
    }

  } catch (error) {
    console.error('Erreur Jellyfin:', error);
    if (tracks.length === 0) {
      trackListDiv.innerHTML = `<div class="error">Erreur de chargement.<br>${escapeHtml(error.message)}</div>`;
    } else {
      showToast('⚠️ Actualisation impossible – musiques en cache utilisées', 'warning');
    }
  }
}

// ── Normalise a Jellyfin item into a track object ──────────────────
function normaliseTrack(item) {
  const rawArtists = (item.Artists && item.Artists.length > 0)
    ? item.Artists
    : (item.AlbumArtist ? [item.AlbumArtist] : ['Artiste inconnu']);

  let expanded = [];
  rawArtists.forEach(a => {
    // Split on comma, feat./ft./featuring, &, ×, and slash separators
    const parts = a
      .split(/\s*(?:,|feat\.|ft\.|featuring|&|×|\/)\s*/i)
      .map(s => s.trim())
      .filter(Boolean);
    expanded.push(...parts);
  });
  const seen = new Set();
  const uniqueArtists = expanded.filter(a => {
    const lc = a.toLowerCase();
    if (seen.has(lc)) return false;
    seen.add(lc);
    return true;
  });

  return {
    id:        item.Id,
    title:     item.Name,
    artist:    uniqueArtists[0] || 'Artiste inconnu',
    artists:   uniqueArtists,
    album:     item.Album || 'Album inconnu',
    albumId:   item.AlbumId || '',
    year:      item.ProductionYear || '',
    genre:     item.Genres?.[0] || '',
    duration:  item.RunTimeTicks ? item.RunTimeTicks / 10_000_000 : 0,
    dateAdded:    item.DateCreated  || '',
    premiereDate: item.PremiereDate || '',
    streamUrl: jellyfinUrl(`/Audio/${item.Id}/stream?static=true`),
    imageUrl:  item.ImageTags?.Primary
      ? jellyfinUrl(`/Items/${item.Id}/Images/Primary?width=300`)
      : (item.AlbumPrimaryImageTag
          ? jellyfinUrl(`/Items/${item.AlbumId}/Images/Primary?width=300`)
          : null),
  };
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR — filter pills + views
// ══════════════════════════════════════════════════════════════════

function renderSidebarView(filter) {
  currentSidebarFilter = filter;
  if (filter === 'albums')  { renderSidebarAlbums();  return; }
  if (filter === 'artists') { renderSidebarArtists(); return; }
  renderSidebarPlaylists();
}

function renderSidebarPlaylists() {
  if (!trackListDiv) return;

  // ── Titres likés ──────────────────────────────────────────────
  const likedCount = likedTracks.size;
  const likedItem = `

    <div class="sidebar-playlist-hint lib-liked-songs-row">
      <div class="track-icon-wrap" style="border-radius:4px;flex-shrink:0">
        <img src="pictures/icon-heart.png" alt="" loading="lazy" style="width:44px;height:44px;border-radius:4px;object-fit:cover">
      </div>
      <div class="lib-item-meta">
        <div class="lib-item-name">Titres likés</div>
        <div class="lib-item-sub">Playlist • ${likedCount} titre${likedCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;

  // ── Mes favoris ───────────────────────────────────────────────
  const favCount = favoriteAlbums.size + favoriteArtists.size;
  const favoritesItem = `
    <div class="sidebar-playlist-hint lib-favorites-row">
      <div class="track-icon-wrap" style="border-radius:4px;flex-shrink:0">
        <img src="pictures/icon-star.png" alt="" loading="lazy" style="width:44px;height:44px;border-radius:4px;object-fit:cover">
      </div>
      <div class="lib-item-meta">
        <div class="lib-item-name">Mes favoris</div>
        <div class="lib-item-sub">Playlist • ${favCount} élément${favCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;

  // ── Albums favoris ────────────────────────────────────────────
  const favAlbumItems = [...favoriteAlbums].map(albumName => {
    const track = tracks.find(t => t.album === albumName);
    const img = track?.imageUrl;
    return `
      <div class="sidebar-playlist-hint lib-fav-album-row" data-album="${escapeHtml(albumName)}">
        <div class="track-icon-wrap" style="border-radius:4px;flex-shrink:0">
          ${img ? `<img src="${img}" loading="lazy" alt="">` : `<div style="width:44px;height:44px;background:linear-gradient(135deg,#f57b27,#8a3f00);display:flex;align-items:center;justify-content:center;font-size:1.3rem">💿</div>`}
        </div>
        <div class="lib-item-meta">
          <div class="lib-item-name">${escapeHtml(albumName)}</div>
          <div class="lib-item-sub">Album favori</div>
        </div>
      </div>`;
  }).join('');

  // ── Artistes favoris ──────────────────────────────────────────
  const favArtistItems = [...favoriteArtists].map(artistName => {
    const track = tracks.find(t => t.artist === artistName);
    const img = track?.imageUrl;
    return `
      <div class="sidebar-playlist-hint lib-fav-artist-row" data-artist="${escapeHtml(artistName)}">
        <div class="track-icon-wrap" style="border-radius:50%;flex-shrink:0">
          ${img ? `<img src="${img}" loading="lazy" alt="" style="border-radius:50%">` : `<div style="width:44px;height:44px;border-radius:50%;background:${artistGradient(artistName)};display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:800;color:rgba(255,255,255,0.9)">${escapeHtml(artistName.charAt(0).toUpperCase())}</div>`}
        </div>
        <div class="lib-item-meta">
          <div class="lib-item-name">${escapeHtml(artistName)}</div>
          <div class="lib-item-sub">Artiste favori</div>
        </div>
      </div>`;
  }).join('');

  trackListDiv.innerHTML = likedItem + favoritesItem + favAlbumItems + favArtistItems;

  // ── Playlists personnalisées (depuis Firebase) ─────────────────
  const customPlaylists = window.customPlaylists || {};
  const customPlaylistItems = Object.values(customPlaylists)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(pl => {
      const count = (pl.tracks || []).length;
      return `
        <div class="sidebar-playlist-hint lib-custom-playlist-row" data-playlist-id="${escapeHtml(pl.id)}">
          ${_makePlaylistCoverHtml(pl.tracks, 'sm')}
          <div class="lib-item-meta">
            <div class="lib-item-name">${escapeHtml(pl.name)}</div>
            <div class="lib-item-sub">Playlist • ${count} titre${count !== 1 ? 's' : ''}</div>
          </div>
        </div>`;
    }).join('');

  if (customPlaylistItems) {
    trackListDiv.innerHTML += customPlaylistItems;
  }

  // ── Event listeners ───────────────────────────────────────────
  trackListDiv.querySelector('.lib-liked-songs-row')?.addEventListener('click', () => {
    if (window.showPlaylistView) window.showPlaylistView('liked');
  });
  trackListDiv.querySelector('.lib-favorites-row')?.addEventListener('click', () => {
    if (window.showPlaylistView) window.showPlaylistView('favorites');
  });
  trackListDiv.querySelectorAll('.lib-fav-album-row').forEach(el => {
    el.addEventListener('click', () => showDetailView('album', el.dataset.album));
  });
  trackListDiv.querySelectorAll('.lib-fav-artist-row').forEach(el => {
    el.addEventListener('click', () => showDetailView('artist', el.dataset.artist));
  });

  // ── Playlists personnalisées ───────────────────────────────────
  trackListDiv.querySelectorAll('.lib-custom-playlist-row').forEach(el => {
    el.addEventListener('click', e => {
      if (window.showPlaylistView) window.showPlaylistView('custom:' + el.dataset.playlistId);
    });
  });
}

function renderSidebarAlbums() {
  if (!trackListDiv || tracks.length === 0) return;
  const albumMap = new Map();
  tracks.forEach(t => {
    if (!albumMap.has(t.album)) albumMap.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl, count: 0 });
    const a = albumMap.get(t.album); a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
  });
  const albums = [...albumMap.values()].sort((a, b) => {
    const fa = favoriteAlbums.has(a.name) ? -1 : 0;
    const fb = favoriteAlbums.has(b.name) ? -1 : 0;
    return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
  });

  trackListDiv.innerHTML = albums.map((album, i) => `
    <div class="lib-album-item" data-album="${escapeHtml(album.name)}" style="animation-delay:${Math.min(i*0.02, 0.3)}s">
      <div class="track-icon-wrap">
        ${album.imageUrl ? `<img src="${album.imageUrl}" loading="lazy" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.4">`}
      </div>
      <div class="track-meta">
        <div class="track-title ${favoriteAlbums.has(album.name) ? 'fav-active' : ''}">${escapeHtml(album.name)}</div>
        <div class="track-artist">${escapeHtml(album.artist)} · ${album.count} titre${album.count>1?'s':''}</div>
      </div>
      <button class="lib-fav-btn ${favoriteAlbums.has(album.name) ? 'active' : ''}" data-album="${escapeHtml(album.name)}" title="${favoriteAlbums.has(album.name) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
        <img src="pictures/icon-heart.png" alt="♥">
      </button>
    </div>
  `).join('');

  trackListDiv.querySelectorAll('.lib-album-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.lib-fav-btn')) return;
      showDetailView('album', el.dataset.album);
    });
  });
  trackListDiv.querySelectorAll('.lib-fav-btn[data-album]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const name = btn.dataset.album;
      if (favoriteAlbums.has(name)) favoriteAlbums.delete(name);
      else favoriteAlbums.add(name);
      btn.classList.toggle('active', favoriteAlbums.has(name));
      // Refresh title highlight
      const titleEl = btn.closest('.lib-album-item')?.querySelector('.track-title');
      if (titleEl) titleEl.classList.toggle('fav-active', favoriteAlbums.has(name));
      
      // ── Firebase Sync : sauvegarder les albums favoris ──
      if (window.FirebaseSync?.syncToFirestore) {
        window.FirebaseSync.syncToFirestore();
      }
    });
  });
}

function renderSidebarArtists() {
  if (!trackListDiv || tracks.length === 0) return;
  const artistMap = new Map();
  tracks.forEach(t => {
    if (!artistMap.has(t.artist)) artistMap.set(t.artist, { name: t.artist, imageUrl: t.imageUrl, count: 0 });
    const a = artistMap.get(t.artist); a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
  });
  const artists = [...artistMap.values()].sort((a, b) => {
    const fa = favoriteArtists.has(a.name) ? -1 : 0;
    const fb = favoriteArtists.has(b.name) ? -1 : 0;
    return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
  });

  trackListDiv.innerHTML = artists.map((artist, i) => `
    <div class="lib-artist-item" data-artist="${escapeHtml(artist.name)}" style="animation-delay:${Math.min(i*0.02, 0.3)}s">
      <div class="lib-artist-avatar" style="background:${artist.imageUrl ? 'var(--bg-tinted)' : artistGradient(artist.name)}">
        ${artist.imageUrl
          ? `<img src="${artist.imageUrl}" loading="lazy" alt="">`
          : `<span>${escapeHtml(artist.name.charAt(0).toUpperCase())}</span>`}
      </div>
      <div class="track-meta">
        <div class="track-title">${escapeHtml(artist.name)}</div>
        <div class="track-artist">${artist.count} titre${artist.count>1?'s':''}</div>
      </div>
      <button class="lib-fav-btn ${favoriteArtists.has(artist.name) ? 'active' : ''}" data-artist="${escapeHtml(artist.name)}" title="${favoriteArtists.has(artist.name) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
        <img src="pictures/icon-heart.png" alt="♥">
      </button>
    </div>
  `).join('');

  trackListDiv.querySelectorAll('.lib-artist-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.lib-fav-btn')) return;
      showDetailView('artist', el.dataset.artist);
    });
  });
  trackListDiv.querySelectorAll('.lib-fav-btn[data-artist]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const name = btn.dataset.artist;
      if (favoriteArtists.has(name)) favoriteArtists.delete(name);
      else favoriteArtists.add(name);
      btn.classList.toggle('active', favoriteArtists.has(name));
      
      // ── Firebase Sync : sauvegarder les artistes favoris ──
      if (window.FirebaseSync?.syncToFirestore) {
        window.FirebaseSync.syncToFirestore();
      }
    });
  });
}

// ── Render queue ───────────────────────────────────────────────────
function renderQueueList() {
  // Redirige vers le rendu dans le right-panel
  _renderPanelQueue();
  _renderPanelRecent();
}

// ── Marquee ────────────────────────────────────────────────────────
const _marqueeText = new WeakMap();
function applyMarquee(wrapper, inner) {
  if (!wrapper || !inner) return;
  // For elements with nav-link-inline children, use innerHTML as source
  const hasLinks = inner.querySelectorAll('.nav-link-inline').length > 0;
  const plainText = hasLinks ? null : (_marqueeText.get(inner) || inner.textContent);
  if (!hasLinks) _marqueeText.set(inner, plainText);
  inner.classList.remove('marquee-on');
  wrapper.classList.remove('has-marquee');
  inner.style.removeProperty('--marquee-offset');
  inner.style.removeProperty('--marquee-duration');
  if (!hasLinks) inner.textContent = plainText;
  requestAnimationFrame(() => {
    const overflow = inner.scrollWidth - wrapper.clientWidth;
    if (overflow > 6) {
      const gap = 52;
      const totalScroll = inner.scrollWidth + gap;
      if (hasLinks) {
        // Don't duplicate for link content, just enable scroll class
        inner.classList.add('marquee-on');
        wrapper.classList.add('has-marquee');
        const duration = Math.max(8, totalScroll / 16);
        inner.style.setProperty('--marquee-offset', `-${totalScroll}px`);
        inner.style.setProperty('--marquee-duration', `${duration}s`);
      } else {
        const safeText = escapeHtml(plainText);
        inner.innerHTML =
          `<span class="marquee-orig">${safeText}</span>` +
          `<span style="display:inline-block;width:${gap}px;flex-shrink:0"></span>` +
          `<span class="marquee-clone" aria-hidden="true">${safeText}</span>`;
        const duration = Math.max(8, totalScroll / 16);
        inner.style.setProperty('--marquee-offset', `-${totalScroll}px`);
        inner.style.setProperty('--marquee-duration', `${duration}s`);
        inner.classList.add('marquee-on');
        wrapper.classList.add('has-marquee');
      }
    }
  });
}
function refreshAllMarquees() {
  [currentTitleEl, currentArtistEl, panelTitle, panelArtist, panelAlbum].forEach(el => {
    if (el) _marqueeText.delete(el);
  });
  applyMarquee(currentTitleWrap,  currentTitleEl);
  applyMarquee(currentArtistWrap, currentArtistEl);
  applyMarquee(panelTitleWrap,    panelTitle);
  applyMarquee(panelArtistWrap,   panelArtist);
  applyMarquee(panelAlbumWrap,    panelAlbum);
}

// ── Play track ─────────────────────────────────────────────────────
async function playCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return;

  // Normalisation défensive — corrige les URLs stales (Firestore, cache, historique)
  const track = normalizeTrack(tracks[currentIndex]);

  // ── Stopper proprement la piste précédente ────────────────────────────
  // Sans pause() avant src=, certains navigateurs ignorent le changement.
  // On stoppe aussi le crossfade en cours pour éviter que le volume reste à 0.
  if (_crossfadeTimer) { clearInterval(_crossfadeTimer); _crossfadeTimer = null; }
  audioPlayer.pause();
  // Restaurer le volume maître (le crossfade peut l'avoir mis à 0)
  audioPlayer.volume = window._masterVolume ?? 1;

  // ── CORS : URLs relatives = même origine = anonymous OK.
  //          URLs absolues HTTP(S) = idem. Seul file:// ne supporte pas CORS.
  try {
    const proto = new URL(track.streamUrl, location.href).protocol;
    if (proto === 'http:' || proto === 'https:') {
      audioPlayer.crossOrigin = 'anonymous';
    } else {
      audioPlayer.removeAttribute('crossorigin');
    }
  } catch {
    audioPlayer.removeAttribute('crossorigin');
  }

  // ── Audio quality : injecter le bitrate cap dans l'URL ───────────────
  let streamSrc = track.streamUrl;
  const qualityBitrates = { low: 96000, normal: 192000, high: 320000 };
  const bitrate = qualityBitrates[window._settingsAudioQuality || 'high'];
  if (streamSrc && bitrate < 320000) {
    try {
      const u = new URL(streamSrc, location.href);
      u.searchParams.set('MaxStreamingBitrate', bitrate);
      u.searchParams.set('AudioBitRate', bitrate);
      // Conserver le chemin relatif si l'URL d'origine l'était (proxy)
      streamSrc = streamSrc.startsWith('/') ? u.pathname + u.search : u.toString();
    } catch {}
  }
  audioPlayer.src = streamSrc;
  audioPlayer._lastLineScrolled = false; // réinitialise le scroll de fin de chanson
  // Ne pas appeler audioPlayer.load() explicitement : assigner src déclenche déjà
  // le load implicitement (spec HTML5). Un double load() annule la Promise play()
  // en cours avec une AbortError et bloque silencieusement les changements de piste.
  audioPlayer.play().catch(err => {
    if (err.name === 'AbortError') return; // changement de src en rafale, ignoré
    console.warn('Lecture automatique bloquée :', err);
  });

  currentTitleEl.textContent  = track.title;
  // Multi-artist: render all artists as clickable links
  const artistLinks = (track.artists && track.artists.length > 1)
    ? track.artists.map(a => `<span class="nav-link-inline" data-nav="artist" data-name="${escapeHtml(a)}">${escapeHtml(a)}</span>`).join(', ')
    : `<span class="nav-link-inline" data-nav="artist" data-name="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</span>`;
  currentArtistEl.innerHTML = artistLinks;
  panelTitle.textContent  = track.title;
  panelArtist.innerHTML = artistLinks;
  panelAlbum.innerHTML  = `<span class="nav-link-inline" data-nav="album" data-name="${escapeHtml(track.album)}">${escapeHtml(track.album)}</span>${track.year ? ` • <span class="nav-link-inline" data-nav="year" data-name="${track.year}">${track.year}</span>` : ''}`;

  // Mise à jour du nom de contexte dans le strip du panneau droit
  const ctxName = window._currentRpContextName && window._currentRpContextName !== '—'
    ? window._currentRpContextName
    : track.album || '—';
  const ctxEl = document.getElementById('rpContextName');
  if (ctxEl) ctxEl.textContent = ctxName;

  // Right panel album art
  albumArtLarge.innerHTML = track.imageUrl
    ? `<img src="${track.imageUrl}" alt="${escapeHtml(track.title)}">`
    : `<img src="pictures/default-cover.png" alt="" class="default-art">`;
  albumArtLarge.classList.add('playing');

  // Bottom bar thumbnail (proper static cover)
  playerThumb.innerHTML = track.imageUrl
    ? `<img src="${track.imageUrl}" alt="">`
    : `<img src="pictures/default-cover.png" alt="" class="default-thumb">`;

  if(!document.documentElement.classList.contains('is-mobile')) rightPanel.style.display='flex';
  // Do NOT hide main content — preserve whatever view is currently shown
  // (home page, album/artist detail, search results, etc.)

  // ── Mise à jour du fond CSS selon la pochette ──
  // Stocker la cover URL sur l'audioPlayer pour que applySettings() puisse la réutiliser
  const audioEl = document.getElementById('audioPlayer');
  if (audioEl) audioEl.dataset.coverUrl = track.imageUrl || '';
  updateBackground(track.imageUrl || null);

  isLiked = likedTracks.has(track.id);
  updateLikeButtons();
  highlightActiveTrack();
  updateHomeCardPlayIcons();
  addToRecently(track);
  renderQueueList();

  // Reset SpicyLyrics position
  spicy.currentPosition = 0;

  // Exposer le titre actuel pour firebase-sync.js
  window.currentTrack = track;

  // ── Firebase Presence : notifier que ce titre démarre ──
  if (window._settingsBroadcast !== false && window.FirebaseSync?.updatePresence) {
    window.FirebaseSync.updatePresence('playing', track, 0);
  }

  setTimeout(refreshAllMarquees, 80);
  // Update right panel bottom section
  setTimeout(updatePanelBottomSection, 150);
  await fetchLyrics(track.title, track.artist);
  fetchExtendedInfo(track);
}

function highlightActiveTrack() {
  if (currentIndex < 0) return;
  const activeId = tracks[currentIndex]?.id;
  document.querySelectorAll('.track-item').forEach(el => {
    el.classList.toggle('active', String(el.dataset.id) === String(activeId));
  });
  document.querySelectorAll('.detail-track-row').forEach((el, i) => {
    const isActive = parseInt(el.dataset.idx) === currentIndex;
    el.classList.toggle('playing', isActive);
    const numEl = el.querySelector('.dtr-num');
    if (numEl) {
      if (isActive) {
        numEl.innerHTML = '<img src="pictures/equaliser-animated-white.gif" alt="▶" class="dtr-equalizer-gif">';
      } else {
        const rows = Array.from(document.querySelectorAll('.detail-track-row'));
        numEl.innerHTML = '';
        numEl.textContent = rows.indexOf(el) + 1;
      }
    }
    // Sync overlay icon
    const overlay = el.querySelector('.dtr-play-overlay');
    const icon    = overlay?.querySelector('.dtr-overlay-icon');
    if (icon) {
      icon.src = (isActive && !audioPlayer.paused) ? 'pictures/icon-pause.png' : 'pictures/icon-play.png';
    }
  });
}

// ── Lyrics parsers ─────────────────────────────────────────────────
function parseLrcContent(content) {
  const lines = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const startMs = (parseInt(match[1]) * 60 + parseFloat(match[2])) * 1000;
    const text = match[3].trim();
    if (text) lines.push({ text, startMs });
  }
  lines.sort((a, b) => a.startMs - b.startMs);
  // Estimate endMs for each line
  for (let i = 0; i < lines.length; i++) {
    lines[i].endMs = lines[i + 1]?.startMs ?? (lines[i].startMs + 4500);
  }
  return lines;
}

function parseJsonLyricsData(jsonData) {
  // ── PRIORITÉ 1 : rawLyrics.Content (nouveau format lyrics.js v7+) ─
  // rawLyrics est le JSON brut SpicyLyrics avant toute transformation :
  // PascalCase natif, syllabe-level, Background/OppositeAligned complets.
  if (jsonData.rawLyrics?.Content) {
    return _parsePNLContent(jsonData.rawLyrics);
  }

  // ── PRIORITÉ 2 : originalData.Content (ancien wrapper) ────────────
  if (jsonData.originalData?.Content) {
    return _parsePNLContent(jsonData.originalData);
  }

  // ── PRIORITÉ 3 : Content[] à la racine ───────────────────────────
  if (jsonData.Content && Array.isArray(jsonData.Content)) {
    return _parsePNLContent(jsonData);
  }

  // ── PRIORITÉ 4 : lyrics.lines (format word-sync parsé) ────────────
  // Gère à la fois l'ancien format (champs plats) et le nouveau format
  // enrichi (type, oppositeAligned, lead, background présents sur chaque ligne).
  const rawLines = jsonData.lyrics?.lines || [];
  const result = [];
  for (const l of rawLines) {
    const wordArr = l.words;
    if (!wordArr || wordArr.length === 0) continue;

    // Build words — strip any embedded trailing/leading whitespace from word.text
    // (some providers concatenate words without spaces in line.text, but word.text
    // itself is correct). We normalize each word's text here.
    const words = wordArr.map((w, i) => {
      const rawText = (w.text || '').trim();
      // Compute endMs: prefer explicit endTime, else use next word's startTime,
      // else fall back to startTime + 500ms
      const startMs = w.startTime ?? 0;
      const endMs   = w.endTime
        ?? (wordArr[i + 1]?.startTime ?? (startMs + 500));
      return { text: rawText, startMs, endMs };
    }).filter(w => w.text.length > 0);

    if (words.length === 0) continue;

    // Rebuild the display text with proper spaces (the JSON line.text is often
    // concatenated without spaces, e.g. "Àceuxquin'enontpas")
    const text = words.map(w => w.text).join(' ').trim();
    if (!text) continue;

    result.push({
      text,
      startMs: l.startTime ?? words[0].startMs,
      endMs:   l.endTime   ?? words[words.length - 1].endMs,
      words,
      // Préserver les propriétés enrichies du nouveau format (lyrics.js v7+)
      oppositeAligned: l.oppositeAligned || false,
      background:      l.background      || null,
      backgrounds:     l.backgrounds     || null,   // tableau complet des bg (lyrics.js v7+)
    });
  }
  return result;
}

// ── Reconstruction du texte depuis les syllabes (respect IsPartOfWord) ──────
// IsPartOfWord = true  → la syllabe est collée à la SUIVANTE (même mot)
// IsPartOfWord = false → fin du mot courant
// Identique à syllablesToWords() dans lyrics.js — évite "Jet'aime,jetehais"
function _sylsToText(syls) {
  const words = [];
  let cur = '';
  for (let i = 0; i < syls.length; i++) {
    cur += syls[i].text || syls[i].Text || '';
    const isPartOf = syls[i].isPartOfWord ?? syls[i].IsPartOfWord ?? false;
    if (!isPartOf || i === syls.length - 1) {
      const w = cur.trim();
      if (w) words.push(w);
      cur = '';
    }
  }
  return words.join(' ');
}

// Parse PNL (Polar No Language) native SpicyLyrics format
// Gère les deux niveaux de richesse :
//   - Content[].Type : "Vocal" (chanteur principal) | "Background" (backing vocal)
//   - Content[].OppositeAligned : true pour second chanteur / duet (aligné à droite)
//   - Content[].Lead  : section principale { Syllables[], StartTime, EndTime }
//   - Content[].Background : tableau de sections backing vocals (api.spicylyrics.org
//     retourne un ARRAY, pas un objet unique ; on normalise les deux cas)
function _parsePNLContent(data) {
  const result = [];
  for (const seg of (data.Content || [])) {
    // Accepter Vocal ET Background — le type est porté par oppositeAligned + lineType
    if (!seg.Lead?.Syllables) continue;

    const syls = seg.Lead.Syllables.map(s => ({
      text: s.Text, startMs: s.StartTime * 1000, endMs: s.EndTime * 1000,
      isPartOfWord: s.IsPartOfWord || false,
    }));

    // Fix Bug A : reconstruction du texte en respectant IsPartOfWord.
    // L'ancien join(' ') sur les syllabes brutes produisait "J e t ' a i m e"
    // ou "Jet'aime" selon les données — _sylsToText() fusionne les syllabes
    // d'un même mot puis joint les mots avec des espaces.
    const text = _sylsToText(syls);
    if (!text) continue;

    // Background : l'API retourne tantôt un tableau, tantôt un objet unique.
    // On normalise toujours en tableau pour que le renderer puisse itérer.
    const bgRaw   = seg.Background || seg.background;
    const bgArray = Array.isArray(bgRaw) ? bgRaw : (bgRaw ? [bgRaw] : []);
    const bgLines = bgArray
      .filter(b => b?.Syllables?.length)
      .map(b => ({
        StartTime: b.StartTime * 1000,
        EndTime:   b.EndTime   * 1000,
        Syllables: b.Syllables.map(s => ({
          Text:         s.Text,
          StartTime:    s.StartTime * 1000,
          EndTime:      s.EndTime   * 1000,
          IsPartOfWord: s.IsPartOfWord || false,
        })),
      }));

    result.push({
      text,
      startMs: seg.Lead.StartTime * 1000,
      endMs:   seg.Lead.EndTime   * 1000,
      words:   syls,
      background:      bgLines,
      backgrounds:     bgLines,   // alias unifié pour le renderer
      oppositeAligned: seg.OppositeAligned || false,
      // Conserver le type source pour usage futur (classe CSS bg-vocal, etc.)
      lineType: (seg.Type || 'Vocal'),
    });
  }
  return result;
}

// ── Lyrics fetch ───────────────────────────────────────────────────
function _lyricsDetectType(r) {
  const t = (r.type || '').toLowerCase();
  if (t === 'json') return 'json';
  if (t === 'lrc')  return 'lrc';
  const src = (r.filename || r.name || r.content_url || r.url || '').toLowerCase();
  if (src.includes('.json')) return 'json';
  if (src.includes('.lrc'))  return 'lrc';
  return null;
}
function _lyricsScore(r, artist, title) {
  const src = (r.filename || r.name || r.content_url || r.url || '').toLowerCase();
  const a = artist.toLowerCase(), t = title.toLowerCase();
  let score = 0;
  if (src.includes(a)) score += 3;
  if (src.includes(t)) score += 3;
  if (src.includes(`${a} - ${t}`)) score += 5;
  if (_lyricsDetectType(r) === 'json') score += 1;
  return score;
}
async function _grizzlyricsQuery(query, artist, title) {
  const url = `${LYRICS_API}?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.success || !data.results?.length) return null;
  return data.results.map(r => ({ r, score: _lyricsScore(r, artist, title) }))
    .sort((a, b) => b.score - a.score).map(s => s.r);
}
async function _fetchJsonLyrics(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return null;
  const lines = parseJsonLyricsData(await resp.json());
  return lines.length > 0 ? lines : null;
}
async function _fetchLrcLyrics(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return null;
  const lines = parseLrcContent(await resp.text());
  return lines.length > 0 ? lines : null;
}

async function fetchLyrics(trackName, artist) {
  lyricsData = null;
  spicy.lyricsObject  = { Lines: [] };
  spicyBlurLastLine   = -1;
  spicyLastActiveLine = -1;

  lyricsDisplay.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><span>Recherche des paroles…</span></div>';
  lyricsMiniContent.innerHTML = '<p class="placeholder-mini">Chargement…</p>';

  const queries = [`${artist} - ${trackName}`, `${trackName} ${artist}`, trackName];
  for (const q of queries) {
    try {
      const results = await _grizzlyricsQuery(q, artist, trackName);
      if (!results?.length) continue;
      const jsonResult = results.find(r => _lyricsDetectType(r) === 'json');
      const lrcResult  = results.find(r => _lyricsDetectType(r) === 'lrc');
      if (jsonResult) {
        const jsonUrl = lyricsProxyUrl(jsonResult.content_url || jsonResult.url);
        if (jsonUrl) {
          try {
            const lines = await _fetchJsonLyrics(jsonUrl);
            if (lines) { lyricsData = { type: 'json', lines }; renderSpicyLyrics(lines, 'json'); return; }
          } catch (e) { console.warn('[Lyrics] JSON fetch failed:', e); }
        }
      }
      if (lrcResult) {
        const lrcUrl = lyricsProxyUrl(lrcResult.content_url || lrcResult.url);
        if (lrcUrl) {
          try {
            const lines = await _fetchLrcLyrics(lrcUrl);
            if (lines) { lyricsData = { type: 'lrc', lines }; renderSpicyLyrics(lines, 'lrc'); return; }
          } catch (e) { console.warn('[Lyrics] LRC fetch failed:', e); }
        }
      }
      if (jsonResult || lrcResult) break;
    } catch (e) { console.warn(`[Lyrics] Grizzlyrics query "${q}" failed:`, e); }
  }

  // Fallback: lrclib.net
  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artist)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const results = await resp.json();
      if (Array.isArray(results) && results.length > 0) {
        const trackDuration = audioPlayer.duration || 0;
        const scored = results.map(r => {
          let s = 0;
          if (r.syncedLyrics) s += 10;
          if (r.plainLyrics) s += 1;
          if (trackDuration && r.duration && Math.abs(r.duration - trackDuration) < 5) s += 5;
          return { r, s };
        }).sort((a, b) => b.s - a.s);
        const best = scored[0]?.r;
        if (best?.syncedLyrics) {
          const lines = parseLrcContent(best.syncedLyrics);
          if (lines.length > 0) { lyricsData = { type: 'lrc', lines }; renderSpicyLyrics(lines, 'lrc'); return; }
        }
        if (best?.plainLyrics) {
          const plain = best.plainLyrics;
          lyricsDisplay.innerHTML = `<div class="spicy-scroll-container"><div class="lyrics-plain" style="padding:0 32px">${escapeHtml(plain).replace(/\n/g, '<br>')}</div></div>`;
          lyricsMiniContent.innerHTML = `<div class="lyrics-plain-mini">${escapeHtml(plain.slice(0, 400)).replace(/\n/g, '<br>')}${plain.length > 400 ? '…' : ''}</div>`;
          return;
        }
      }
    }
  } catch (e) { console.warn('[Lyrics] lrclib fallback failed:', e); }

  lyricsDisplay.innerHTML = '<p class="placeholder" style="padding:60px 32px;color:var(--text-subdued);text-align:center">Aucune parole trouvée pour ce morceau.</p>';
  lyricsMiniContent.innerHTML = '<p class="placeholder-mini">Paroles non disponibles</p>';
}

// ── Playback controls ──────────────────────────────────────────────
playPauseBtn.addEventListener('click', () => {
  if (currentIndex === -1 && tracks.length > 0) { currentIndex = 0; playCurrentTrack(); return; }
  if (audioPlayer.paused) audioPlayer.play().catch(console.error);
  else audioPlayer.pause();
});

audioPlayer.addEventListener('play', () => {
  playIconImg.style.display  = 'none';
  pauseIconImg.style.display = '';
  albumArtLarge.classList.add('playing');
  playPauseBtn.classList.add('is-playing');
  spicy.isPlaying = true;
  updateHomeCardPlayIcons();
});
audioPlayer.addEventListener('pause', () => {
  playIconImg.style.display  = '';
  pauseIconImg.style.display = 'none';
  albumArtLarge.classList.remove('playing');
  playPauseBtn.classList.remove('is-playing');
  spicy.isPlaying = false;
  updateHomeCardPlayIcons();

  // ── Firebase Presence : notifier la pause ──
  if (window._settingsBroadcast !== false && window.FirebaseSync?.updatePresence && window.currentTrack) {
    const position = Math.floor(audioPlayer.currentTime || 0);
    window.FirebaseSync.updatePresence('paused', window.currentTrack, position);
  }
});

prevBtn.addEventListener('click', () => {
  if (audioPlayer.currentTime > 3) { audioPlayer.currentTime = 0; return; }
  goPrev();
});
nextBtn.addEventListener('click', goNext);

function goPrev() {
  if (!tracks.length) return;
  const ctx = window._playContext;
  if (isShuffled) {
    const pos = shuffleOrder.indexOf(currentIndex);
    currentIndex = shuffleOrder[(pos - 1 + shuffleOrder.length) % shuffleOrder.length];
  } else if (ctx && ctx.length > 0) {
    const pos = ctx.indexOf(currentIndex);
    currentIndex = ctx[pos === -1 ? 0 : (pos - 1 + ctx.length) % ctx.length];
  } else {
    currentIndex = (currentIndex - 1 + tracks.length) % tracks.length;
  }
  playCurrentTrack();
}
function goNext() {
  if (!tracks.length) return;
  if (repeatMode === 2) { audioPlayer.currentTime = 0; audioPlayer.play(); return; }
  const ctx = window._playContext;
  if (isShuffled) {
    const pos      = shuffleOrder.indexOf(currentIndex);
    const nextPos  = pos + 1;
    if (nextPos >= shuffleOrder.length) {
      // Fin de la file mélangée
      if (repeatMode === 1) {
        currentIndex = shuffleOrder[0]; // répéter la liste
      } else {
        // Sortir du contexte → bibliothèque globale
        window._playContext = null;
        currentIndex = (currentIndex + 1) % tracks.length;
      }
    } else {
      currentIndex = shuffleOrder[nextPos];
    }
  } else if (ctx && ctx.length > 0) {
    const pos     = ctx.indexOf(currentIndex);
    const nextPos = pos === -1 ? 0 : pos + 1;
    if (nextPos >= ctx.length) {
      // Dernière piste de la playlist atteinte
      if (repeatMode === 1) {
        currentIndex = ctx[0]; // répéter la liste
      } else {
        // Sortir du contexte → bibliothèque globale
        window._playContext = null;
        currentIndex = (currentIndex + 1) % tracks.length;
      }
    } else {
      currentIndex = ctx[nextPos];
    }
  } else {
    currentIndex = (currentIndex + 1) % tracks.length;
  }
  playCurrentTrack();
}

// ── Crossfade engine ───────────────────────────────────────────────
let _crossfadeTimer = null;
function _startCrossfade() {
  const dur = window._settingsCrossfade || 0;
  if (dur <= 0) return;
  if (_crossfadeTimer) clearInterval(_crossfadeTimer);
  _crossfadeTimer = setInterval(() => {
    if (!audioPlayer.duration) return;
    const remaining = audioPlayer.duration - audioPlayer.currentTime;
    if (remaining <= dur && remaining > 0) {
      // Fade out current
      const vol = Math.max(0, remaining / dur);
      // Fade out uniquement le volume de lecture — _masterVolume reste intact
      // pour que la prochaine piste démarre au bon volume.
      audioPlayer.volume = vol * (window._masterVolume ?? 1);
    }
    if (remaining <= 0) {
      clearInterval(_crossfadeTimer);
      audioPlayer.volume = window._masterVolume ?? 1;
    }
  }, 200);
}

// ── Gapless preload ────────────────────────────────────────────────
let _preloadAudio = null;
function _preloadNextTrack() {
  if (!window._settingsGapless) return;
  const ctx = window._playContext;
  let nextIdx;
  if (isShuffled) {
    const pos = shuffleOrder.indexOf(currentIndex);
    nextIdx = shuffleOrder[(pos + 1) % shuffleOrder.length];
  } else if (ctx && ctx.length > 0) {
    const pos = ctx.indexOf(currentIndex);
    nextIdx = ctx[pos === -1 ? 0 : (pos + 1) % ctx.length];
  } else {
    nextIdx = (currentIndex + 1) % tracks.length;
  }
  const nextTrack = normalizeTrack(tracks[nextIdx]);
  if (!nextTrack?.streamUrl) return;
  _preloadAudio = new Audio();
  _preloadAudio.preload = 'auto';
  _preloadAudio.crossOrigin = 'anonymous';
  _preloadAudio.src = nextTrack.streamUrl;
}

// ── Volume normalization ───────────────────────────────────────────
// Uses Web Audio API to apply a subtle gain normalization
let _audioCtxNorm = null, _gainNode = null, _sourceNode = null;
function _applyNormalization(enabled) {
  try {
    if (enabled) {
      // Utiliser TOUJOURS le contexte partagé — jamais en créer un nouveau
      const ctx    = window._sharedAudioCtx;
      const source = window._sharedSourceNode;
      if (!ctx || !source) {
        // AudioGraph pas encore prêt — on s'abonne à l'event
        document.addEventListener('audioGraph:ready', () => _applyNormalization(true), { once: true });
        return;
      }
      if (!_gainNode) {
        _gainNode = ctx.createGain();
        // Insérer le gain ENTRE la source et l'analyser
        try { source.disconnect(window._sharedAnalyser); } catch(_) {}
        source.connect(_gainNode);
        _gainNode.connect(window._sharedAnalyser || ctx.destination);
      }
      _gainNode.gain.value = 0.85;
    } else if (_gainNode) {
      _gainNode.gain.value = 1.0;
    }
  } catch(e) { console.warn('Volume normalization unavailable:', e); }
}

// Hook into audio events for gapless + crossfade
audioPlayer.addEventListener('playing', () => {
  _startCrossfade();
  setTimeout(_preloadNextTrack, 5000); // preload after 5s
  if (window._settingsNormalize) _applyNormalization(true);
  else if (_gainNode) _gainNode.gain.value = 1.0;
});

audioPlayer.addEventListener('ended', () => {
  // ── Firebase History : enregistrer l'écoute complète ──
  if (window._settingsSaveHistory !== false && window.FirebaseSync?.addToHistory && window.currentTrack) {
    const duration = Math.floor(audioPlayer.duration || 0);
    window.FirebaseSync.addToHistory(window.currentTrack, duration);
  }
  
  // ── Firebase Presence : titre terminé ──
  if (window._settingsBroadcast !== false && window.FirebaseSync?.updatePresence) {
    window.FirebaseSync.updatePresence('stopped');
  }

  // Restore volume after crossfade
  audioPlayer.volume = window._masterVolume ?? 1;

  if (repeatMode === 2) { audioPlayer.currentTime = 0; audioPlayer.play(); }
  else if (window._settingsAutoplay !== false) goNext();
  // If autoplay disabled, just stop
});

// ── Shuffle ────────────────────────────────────────────────────────
shuffleBtn.addEventListener('click', () => {
  isShuffled = !isShuffled;
  shuffleBtn.classList.toggle('active', isShuffled);
  // Respecter le contexte actif : mélanger la playlist en cours, pas toute la bibliothèque
  const pool = (window._playContext && window._playContext.length > 0)
    ? window._playContext
    : [...tracks.keys()];
  if (isShuffled) {
    const poolTracks = pool.map(i => tracks[i]).filter(Boolean);
    const shuffled = window._buildShuffleQueue ? window._buildShuffleQueue(poolTracks, pool.indexOf(currentIndex)) : poolTracks.sort(() => Math.random() - 0.5);
    shuffleOrder = shuffled.map(t => tracks.indexOf(t)).filter(i => i !== -1);
    const ci = shuffleOrder.indexOf(currentIndex);
    if (ci > 0) { shuffleOrder.splice(ci, 1); shuffleOrder.unshift(currentIndex); }
  } else {
    shuffleOrder = [...pool];
    window._resetShuffleHistory?.();
  }
  showToast(isShuffled ? '⇄ Lecture aléatoire activée' : '⇄ Lecture aléatoire désactivée', isShuffled ? 'info' : 'default');
});

// ── Repeat ─────────────────────────────────────────────────────────
repeatBtn.addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3;
  repeatBtn.classList.toggle('active', repeatMode > 0);
  const ri = document.getElementById('repeatIcon');
  if (ri) ri.src = repeatMode === 2 ? 'pictures/icon-repeat-one.png' : 'pictures/icon-repeat.png';
  const labels = ['Répétition désactivée', 'Répéter la liste', 'Répéter le titre'];
  showToast('↻ ' + labels[repeatMode], repeatMode > 0 ? 'info' : 'default');
});

// ── Progress ───────────────────────────────────────────────────────
audioPlayer.addEventListener('timeupdate', () => {
  if (isDragging || !audioPlayer.duration) return;
  const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  updateProgressUI(pct, audioPlayer.currentTime, audioPlayer.duration);
  spicy.currentPosition = audioPlayer.currentTime * 1000;

  // ── Effet ascenseur sur la dernière ligne ──────────────────────────
  // Déclenché 3 s avant la fin de la chanson, une seule fois par lecture.
  // On centre la dernière ligne de paroles dans le container de lyrics.
  // Guard : le panneau doit être visible, sinon offsetTop/clientHeight valent 0.
  const remaining = audioPlayer.duration - audioPlayer.currentTime;
  if (remaining < 3 && remaining > 0 && !audioPlayer._lastLineScrolled) {
    audioPlayer._lastLineScrolled = true;
    const lyrPanel  = document.getElementById('lyricsPanel');
    const container = document.getElementById('lyricsDisplay');
    if (container && lyrPanel && lyrPanel.style.display !== 'none') {
      const lastLine = [...container.querySelectorAll('.line:not(.musical-line)')].pop();
      if (lastLine && container.clientHeight > 0) {
        // Scroll jusqu'en bas du contenu réel → la dernière ligne finit en bas,
        // aucun espace vide centré artificiellement quand il n'y a plus de paroles après.
        const maxScroll = container.scrollHeight - container.clientHeight;
        container.scrollTo({ top: Math.max(0, maxScroll), behavior: 'smooth' });
      }
    }
  }
});
audioPlayer.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audioPlayer.duration);
});
function updateProgressUI(pct, current, total) {
  progressFill.style.width  = pct + '%';
  progressThumb.style.left  = pct + '%';
  currentTimeEl.textContent = formatTime(current);
  totalTimeEl.textContent   = formatTime(total || 0);
}
progressContainer.addEventListener('mousedown', e => { isDragging = true; seekTo(e); });
document.addEventListener('mousemove', e => { if (isDragging) seekTo(e); });
document.addEventListener('mouseup',   e => { if (isDragging) { isDragging = false; seekTo(e); } });
function seekTo(e) {
  const rect = progressContainer.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (audioPlayer.duration) {
    audioPlayer.currentTime = pct * audioPlayer.duration;
    spicy.currentPosition = audioPlayer.currentTime * 1000;
    updateProgressUI(pct * 100, audioPlayer.currentTime, audioPlayer.duration);
  }
}

// ── Volume ─────────────────────────────────────────────────────────
volumeSlider.addEventListener('input', e => {
  const val = e.target.value;
  audioPlayer.volume = val / 100;
  volumeFill.style.width  = val + '%';
  volumeThumb.style.left  = val + '%';
  // Démueter automatiquement si le volume est > 0
  if (val > 0 && audioPlayer.muted) {
    audioPlayer.muted = false;
    muteBtn.classList.remove('active');
  }
  updateVolIcon(val);
});
muteBtn.addEventListener('click', () => {
  audioPlayer.muted = !audioPlayer.muted;
  muteBtn.classList.toggle('active', audioPlayer.muted);
  updateVolIcon(audioPlayer.muted ? 0 : volumeSlider.value);
});
function updateVolIcon(val) {
  const vi = document.getElementById('volIconImg');
  if (!vi) return;
  const v = parseInt(val);
  vi.src = v === 0 ? 'pictures/icon-volume-mute.png' : v < 50 ? 'pictures/icon-volume-low.png' : 'pictures/icon-volume.png';
}

// ── Like ───────────────────────────────────────────────────────────
function updateLikeButtons() {
  likeBtn?.classList.toggle('liked', isLiked);
  miniLike.classList.toggle('liked', isLiked);
  const miniLikeImg = document.getElementById('miniLikeImg');
  if (miniLikeImg) miniLikeImg.src = isLiked ? 'pictures/like.png' : 'pictures/Unlike.png';
}
likeBtn?.addEventListener('click', () => {
  isLiked = !isLiked;
  const track = tracks[currentIndex];
  if (track) { if (isLiked) likedTracks.add(track.id); else likedTracks.delete(track.id); }
  updateLikeButtons();
  showToast(isLiked ? '♥ Ajouté aux titres likés' : '♡ Retiré des titres likés', isLiked ? 'success' : 'default');
  
  // ── Firebase Sync : sauvegarder les titres likés ──
  if (window.FirebaseSync?.syncToFirestore) {
    window.FirebaseSync.syncToFirestore();
  }
});
miniLike.addEventListener('click', () => {
  isLiked = !isLiked;
  const track = tracks[currentIndex];
  if (track) { if (isLiked) likedTracks.add(track.id); else likedTracks.delete(track.id); }
  updateLikeButtons();
  showToast(isLiked ? '♥ Ajouté aux titres likés' : '♡ Retiré des titres likés', isLiked ? 'success' : 'default');
  
  // ── Firebase Sync : sauvegarder les titres likés ──
  if (window.FirebaseSync?.syncToFirestore) {
    window.FirebaseSync.syncToFirestore();
  }
});

// ── Bouton Etc dans la barre player (ajout playlist de la piste en cours) ──
const miniEtcBtn = document.getElementById('miniEtc');
miniEtcBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const track = tracks[currentIndex];
  if (!track) { showToast('Aucune piste en cours', 'info'); return; }
  showAddToPlaylistPopup(e, track);
});

// ── Panel toggles ──────────────────────────────────────────────────
// nowPlayingBtn → pop-up "en cours de développement"
nowPlayingBtn?.addEventListener('click', () => _showWipModal());

closePanelBtn?.addEventListener('click', () => {
  // Fermer uniquement la file d'attente si active → revenir à l'artist info
  if (queueBtn.classList.contains('active')) {
    queueBtn.classList.remove('active');
    panelPlaylistMode = false;
    updatePanelBottomSection();
  }
});
lyricsBtn.addEventListener('click', () => {
  if (currentIndex === -1) return;
  const lyricsVisible = lyricsPanel.style.display !== 'none';
  if (lyricsVisible) {
    lyricsPanel.style.display = 'none';
    lyricsBtn.classList.remove('active');
    _showDefaultContent();
  } else {
    _hideAllMainPanels();
    lyricsPanel.style.display = 'flex';
    lyricsBtn.classList.add('active');
    pushNavState('lyrics');
    // Forcer un scroll instantané vers la ligne en cours dès l'ouverture du panneau.
    // Évite l'affichage "décalé" (paroles au milieu alors que la musique débute,
    // ou dots intro visibles alors qu'on est déjà au refrain).
    requestAnimationFrame(() => _forceLyricsSync());
  }
});
queueBtn.addEventListener('click', () => {
  const isQueueActive = queueBtn.classList.contains('active');

  if (isQueueActive) {
    // Désactiver → revenir à l'artist info
    queueBtn.classList.remove('active');
    panelPlaylistMode = false;
    updatePanelBottomSection();
  } else {
    // Activer → afficher les onglets file d'attente dans le right-panel
    queueBtn.classList.add('active');
    panelPlaylistMode = true;
    panelActiveTab = 'queue';
    updatePanelBottomSection();
    pushNavState('queue');
  }
});
document.getElementById('lyricsPanelBtn')?.addEventListener('click', () => {
  lyricsBtn.click();
});

// ── Right panel bottom section ─────────────────────────────────────
// Shows either queue+recent tabs (when panelPlaylistMode) or artist info
let panelActiveTab    = 'queue'; // 'queue' | 'recent'
let panelPlaylistMode = false;   // true = show playlist/queue in right panel

function updatePanelBottomSection() {
  const queueTabs     = document.getElementById('panelQueueTabs');
  const queueContent  = document.getElementById('panelQueueContent');
  const recentContent = document.getElementById('panelRecentContent');
  const artistSection = document.getElementById('panelArtistInfoSection');
  if (!queueTabs || !artistSection) return;

  if (panelPlaylistMode) {
    // Onglets file d'attente visibles
    queueTabs.style.display     = 'flex';
    artistSection.style.display = 'none';
    if (queueContent)  queueContent.style.display  = panelActiveTab === 'queue'  ? 'flex' : 'none';
    if (recentContent) recentContent.style.display = panelActiveTab === 'recent' ? 'flex' : 'none';
    _renderPanelQueue();
    _renderPanelRecent();
  } else {
    // Infos artiste
    queueTabs.style.display     = 'none';
    if (queueContent)  queueContent.style.display  = 'none';
    if (recentContent) recentContent.style.display = 'none';
    artistSection.style.display = currentIndex >= 0 ? 'block' : 'none';
    if (currentIndex >= 0) _renderPanelArtistInfo(tracks[currentIndex]);
  }
}

// Tab switching
document.addEventListener('click', e => {
  const tab = e.target.closest('.panel-tab[data-tab]');
  if (!tab) return;
  panelActiveTab = tab.dataset.tab;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === panelActiveTab));
  document.getElementById('panelQueueContent').style.display  = panelActiveTab === 'queue'  ? 'flex' : 'none';
  document.getElementById('panelRecentContent').style.display = panelActiveTab === 'recent' ? 'flex' : 'none';
});

function _renderPanelQueue() {
  const el = document.getElementById('panelQueueContent');
  if (!el || tracks.length === 0) return;
  // Respecter le contexte actif (_playContext) pour l'aperçu de la file
  const ctx = window._playContext;
  let upcoming;
  if (ctx && ctx.length > 0) {
    const pos = ctx.indexOf(currentIndex);
    const startPos = pos === -1 ? 0 : pos + 1;
    upcoming = [...Array(Math.min(15, ctx.length)).keys()]
      .map(i => ctx[(startPos + i) % ctx.length]);
  } else if (currentIndex >= 0) {
    upcoming = [...Array(Math.min(15, tracks.length)).keys()]
      .map(i => (currentIndex + 1 + i) % tracks.length);
  } else {
    upcoming = [...tracks.keys()].slice(0, 15);
  }
  el.innerHTML = upcoming.map(idx => {
    const t = tracks[idx];
    return `<div class="panel-queue-item" data-idx="${idx}">
      <div class="panel-queue-art">${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" alt="">` : ''}</div>
      <div class="panel-queue-meta">
        <div class="panel-queue-title">${escapeHtml(t.title)}</div>
        <div class="panel-queue-artist">${escapeHtml(t.artist)}</div>
      </div>
      <div class="panel-queue-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.panel-queue-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      if (!isNaN(idx)) { currentIndex = idx; playCurrentTrack(); }
    });
  });
}

function _renderPanelRecent() {
  const el = document.getElementById('panelRecentContent');
  if (!el) return;
  const rp = window.recentlyPlayed || recentlyPlayed;
  if (rp.length === 0) {
    el.innerHTML = `<div style="padding:16px 8px;color:var(--text-subdued);font-size:0.8rem;text-align:center">Aucun titre écouté récemment</div>`;
    return;
  }
  el.innerHTML = rp.slice(0, 15).map((t, i) => {
    const idx = tracks.indexOf(t);
    return `<div class="panel-queue-item" data-idx="${idx}">
      <div class="panel-queue-art">${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" alt="">` : ''}</div>
      <div class="panel-queue-meta">
        <div class="panel-queue-title">${escapeHtml(t.title)}</div>
        <div class="panel-queue-artist">${escapeHtml(t.artist)}</div>
      </div>
      <div class="panel-queue-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.panel-queue-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      if (!isNaN(idx)) { currentIndex = idx; playCurrentTrack(); }
    });
  });
}

// Fetch artist info from Last.fm and render in right panel bottom
async function _renderPanelArtistInfo(track) {
  const el = document.getElementById('panelArtistInfoSection');
  if (!el || !track) return;
  el.innerHTML = `
    <div class="pai-loading">
      <div class="loading-spinner" style="width:16px;height:16px;border-width:2px"></div>
      <span>Chargement…</span>
    </div>`;

  try {
    // Fetch Last.fm artist + top tracks in parallel
    const [lfmArtist, lfmTopTracks] = await Promise.allSettled([
      fetchLastFmArtist(track.artist, null),
      _fetchLastFmTopTracks(track.artist),
    ]);

    const la  = lfmArtist.value;
    const top = lfmTopTracks.value || [];

    let html = '';

    // ── Artist header ──────────────────────────────────────────────
    const listeners  = la?.stats?.listeners  ? formatBigNumber(parseInt(la.stats.listeners))  : null;
    const playcount  = la?.stats?.playcount   ? formatBigNumber(parseInt(la.stats.playcount))  : null;
    const bio        = la?.bio?.summary?.replace(/<a [^>]+>.*?<\/a>/g,'').replace(/<[^>]+>/g,'').trim() || '';
    const tags       = (la?.tags?.tag || []).slice(0, 5);
    const similar    = (la?.similar?.artist || []).slice(0, 5);

    html += `<div class="pai-artist-name">${escapeHtml(track.artist)}</div>`;

    // Stats row
    if (listeners || playcount) {
      html += `<div class="pai-stats-row">`;
      if (listeners) html += `<div class="pai-stat"><span class="pai-stat-val">${listeners}</span><span class="pai-stat-lbl">auditeurs / mois</span></div>`;
      if (playcount) html += `<div class="pai-stat"><span class="pai-stat-val">${playcount}</span><span class="pai-stat-lbl">écoutes totales</span></div>`;
      html += `</div>`;
    }

    // Tags / genres
    if (tags.length) {
      html += `<div class="pai-tags">${tags.map(t => `<span class="pai-tag">${escapeHtml(t.name)}</span>`).join('')}</div>`;
    }

    // Bio
    if (bio && bio.length > 20) {
      const bioId = 'pbio-' + Date.now();
      const short  = bio.slice(0, 280);
      const isLong = bio.length > 280;
      html += `
        <div class="pai-section-title">À propos</div>
        <div class="pai-bio" id="${bioId}">${escapeHtml(short)}${isLong ? '…' : ''}</div>
        ${isLong ? `<button class="pai-bio-toggle" data-target="${bioId}" data-full="${escapeHtml(bio)}">Lire plus ↓</button>` : ''}`;
    }

    // ── Top Tracks from Last.fm (matched to local library) ────────
    const localTop = top
      .map(t => ({ lfm: t, local: tracks.find(tr => tr.title.toLowerCase() === t.name.toLowerCase() && tr.artist.toLowerCase() === track.artist.toLowerCase()) }))
      .filter(t => t.local)
      .slice(0, 5);

    // If not enough Last.fm matches, fill with local tracks by same artist
    const localArtistTracks = tracks.filter(t => t.artist === track.artist || t.artists?.includes(track.artist));
    const topDisplay = localTop.length >= 3
      ? localTop.map(t => t.local)
      : localArtistTracks.slice(0, 5);

    if (topDisplay.length > 0) {
      html += `<div class="pai-section-title">Titres populaires</div>
        <div class="pai-top-tracks">`;
      topDisplay.forEach((t, i) => {
        const globalIdx = tracks.indexOf(t);
        const isPlaying = globalIdx === currentIndex;
        html += `
          <div class="pai-track-row ${isPlaying ? 'playing' : ''}" data-idx="${globalIdx}">
            <span class="pai-track-num">${isPlaying ? '▶' : i + 1}</span>
            <div class="pai-track-art">
              ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" alt="">` : '<div class="pai-art-placeholder">♪</div>'}
            </div>
            <div class="pai-track-meta">
              <div class="pai-track-title">${escapeHtml(t.title)}</div>
              <div class="pai-track-album">${escapeHtml(t.album)}</div>
            </div>
            <div class="pai-track-dur">${formatTime(t.duration)}</div>
          </div>`;
      });
      html += `</div>`;
    }

    // ── Albums from local library ──────────────────────────────────
    const albumMap = new Map();
    localArtistTracks.forEach(t => {
      if (!albumMap.has(t.album)) albumMap.set(t.album, { name: t.album, year: t.year, imageUrl: t.imageUrl, count: 0 });
      const a = albumMap.get(t.album); a.count++;
      if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
    });
    const albums = [...albumMap.values()].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 6);

    if (albums.length > 0) {
      html += `<div class="pai-section-title">Discographie</div>
        <div class="pai-albums-row">`;
      albums.forEach(al => {
        html += `
          <div class="pai-album-card" data-album="${escapeHtml(al.name)}">
            <div class="pai-album-art">
              ${al.imageUrl ? `<img src="${al.imageUrl}" loading="lazy" alt="">` : '<div class="pai-art-placeholder">💿</div>'}
            </div>
            <div class="pai-album-name">${escapeHtml(al.name)}</div>
            ${al.year ? `<div class="pai-album-year">${al.year}</div>` : ''}
          </div>`;
      });
      html += `</div>`;
    }



    if (!html) html = `<div class="pai-artist-name">${escapeHtml(track.artist)}</div><div style="color:var(--text-subdued);font-size:0.8rem;margin-top:8px">Aucune information disponible</div>`;

    el.innerHTML = html;

    // Bio expand/collapse — utilise previousElementSibling pour éviter
    // les éventuels problèmes de lookup par ID dans des conteneurs re-rendus.
    el.querySelectorAll('.pai-bio-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const target = btn.previousElementSibling;   // div.pai-bio
        if (!target) return;
        const full = btn.dataset.full || '';
        const expanded = target.classList.toggle('expanded');
        target.textContent = expanded ? full : full.slice(0, 280) + '…';
        btn.textContent = expanded ? 'Réduire ↑' : 'Lire plus ↓';
      });
    });

    // Top track click → play
    el.querySelectorAll('.pai-track-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        if (!isNaN(idx) && idx >= 0) { currentIndex = idx; playCurrentTrack(); }
      });
    });

    // Album click → detail view
    el.querySelectorAll('.pai-album-card').forEach(card => {
      card.addEventListener('click', () => showDetailView('album', card.dataset.album));
    });

  } catch (err) {
    el.innerHTML = `<div class="pai-artist-name">${escapeHtml(track.artist)}</div>`;
    console.warn('Panel artist info error:', err);
  }
}

async function _fetchLastFmTopTracks(artist) {
  try {
    const r = await fetch(
      lastfmUrl(`method=artist.getTopTracks&artist=${encodeURIComponent(artist)}&limit=10&autocorrect=1`),
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return data.toptracks?.track || [];
  } catch { return []; }
}

async function _fetchMusicBrainzCredits(title, artist) {
  try {
    // Search for recording
    const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodeURIComponent(title)}+AND+artist:${encodeURIComponent(artist)}&fmt=json&limit=3`;
    const r = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Beartify/1.0 (beartify@example.com)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const recording = data.recordings?.[0];
    if (!recording) return null;

    // Get release for this recording to find relations
    const recId = recording.id;
    const relUrl = `https://musicbrainz.org/ws/2/recording/${recId}?inc=artist-credits+work-rels+artist-rels&fmt=json`;
    const r2 = await fetch(relUrl, {
      headers: { 'User-Agent': 'Beartify/1.0 (beartify@example.com)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r2.ok) return null;
    const rec = await r2.json();

    const credits = [];

    // Artist credits
    (rec['artist-credit'] || []).forEach(ac => {
      if (ac.artist?.name) {
        credits.push({ role: 'Artiste', name: ac.artist.name });
      }
    });

    // Relations (composers, lyricists, producers, etc.)
    (rec.relations || []).forEach(rel => {
      const type = rel.type;
      const name = rel.artist?.name || rel.work?.title;
      if (!name) return;
      const roleMap = {
        'composer': 'Compositeur',
        'lyricist': 'Parolier',
        'producer': 'Producteur',
        'performer': 'Interprète',
        'mix': 'Mix',
        'recording': 'Enregistrement',
        'engineer': 'Ingénieur du son',
        'orchestrator': 'Orchestrateur',
        'instrument': rel.attributes?.[0] || 'Instrument',
      };
      const roleFr = roleMap[type] || type;
      if (roleFr && name && credits.length < 8) credits.push({ role: roleFr, name });
    });

    return credits.length > 0 ? credits : null;
  } catch { return null; }
}
// ══════════════════════════════════════════════════════════════════
//  PLAYLIST COVER HELPER
//  Retourne le HTML de la cover d'une playlist custom :
//    • 0–3 pistes → pictures/playlist-icon.png
//    • 4+ pistes  → mosaïque 2×2 (4 covers distinctes)
//  size : 'sm' (44px sidebar) | 'lg' (détail) | 'xs' (popup)
// ══════════════════════════════════════════════════════════════════
function _makePlaylistCoverHtml(plTracks, size = 'sm') {
  // Collect unique cover URLs (up to 4)
  const covers = [];
  for (const t of (plTracks || [])) {
    if (t.imageUrl && !covers.includes(t.imageUrl)) covers.push(t.imageUrl);
    if (covers.length === 4) break;
  }

  const inner = covers.length >= 4
    ? `<div class="pl-cover-mosaic">${covers.map(u => `<img src="${u}" loading="lazy" alt="">`).join('')}</div>`
    : `<img class="pl-cover-default" src="pictures/playlist-icon.png" alt="Playlist" loading="lazy">`;

  return `<div class="pl-cover-wrap size-${size}">${inner}</div>`;
}


let navStack  = [{ view: 'home' }];
let navCursor = 0;

function pushNavState(view, meta = {}) {
  // Tronquer l'historique forward
  navStack = navStack.slice(0, navCursor + 1);

  // Éviter les doublons consécutifs (ex : plusieurs clics "Accueil" de suite)
  const last = navStack[navStack.length - 1];
  if (last && last.view === view &&
      JSON.stringify(last) === JSON.stringify({ view, ...meta })) {
    return; // état identique — on ne pousse rien
  }

  navStack.push({ view, ...meta });

  // Limiter la taille du stack pour éviter une fuite mémoire sur les longues sessions
  const NAV_MAX = 100;
  if (navStack.length > NAV_MAX) {
    navStack = navStack.slice(navStack.length - NAV_MAX);
  }

  navCursor = navStack.length - 1;
  _updateNavBtns();
}

function _updateNavBtns() {
  btnBack.style.opacity    = navCursor > 0                   ? '1'   : '0.35';
  btnForward.style.opacity = navCursor < navStack.length - 1 ? '1'   : '0.35';
  btnBack.disabled    = navCursor <= 0;
  btnForward.disabled = navCursor >= navStack.length - 1;
}

function _restoreNavState(state) {
  if (!state) return;
  _hideAllMainPanels();
  switch (state.view) {
    case 'home':
      welcomeContent.style.display = 'flex';
      // Re-render complet pour garantir que les carousels et sections
      // sont présents (notamment après une longue navigation ou un premier démarrage).
      if (typeof renderHomePage === 'function') renderHomePage();
      requestAnimationFrame(_syncAllCarouselArrows);
      break;
    case 'lyrics':
      lyricsPanel.style.display = 'flex';
      lyricsBtn.classList.add('active');
      break;
    case 'queue':
      queueBtn.classList.add('active');
      panelPlaylistMode = true;
      panelActiveTab = 'queue';
      updatePanelBottomSection();
      break;
    case 'playlist':
      if (window.showPlaylistView && state.type) {
        window.showPlaylistView(state.type, false);
      }
      break;
    case 'detail':
      showDetailView(state.type, state.name, false);
      break;
    case 'search':
      showSearchResultsPage(state.query, false);
      break;
    case 'settings':
      if (window._openSettings) window._openSettings(false);
      break;
  }
  _updateNavBtns();
}

// Re-sync every carousel wrapper's arrow visibility (call after showing home)
function _syncAllCarouselArrows() {
  document.querySelectorAll('.carousel-wrapper').forEach(w => {
    if (typeof w._syncArrows === 'function') w._syncArrows();
  });
}

function _hideAllMainPanels() {
  welcomeContent.style.display    = 'none';
  lyricsPanel.style.display       = 'none';
  detailView.style.display        = 'none';
  searchResultsPage.style.display = 'none';
  const playlistView = document.getElementById('playlistView');
  if (playlistView) playlistView.style.display = 'none';
  lyricsBtn.classList.remove('active');
  // Fermer la queue dans le right-panel si elle était ouverte via _hideAll
  // (on ne la ferme pas ici pour éviter de casser le right-panel — on laisse queueBtn gérer son état)
  // Destroy floating sort panel if open
  document.getElementById('detailSortPanel')?.remove();
  // Settings panel (injected by settings.js)
  const sp = document.getElementById('settingsPanel');
  if (sp) sp.style.display = 'none';
}

function _showDefaultContent() {
  // After closing a panel, show the most recent non-panel view
  const prev = [...navStack].reverse().find(s => !['lyrics','queue'].includes(s.view));
  if (prev?.view === 'detail')   { showDetailView(prev.type, prev.name, false); return; }
  if (prev?.view === 'playlist') { if (window.showPlaylistView) window.showPlaylistView(prev.type, false); return; }
  if (prev?.view === 'search')   { showSearchResultsPage(prev.query, false); return; }
  welcomeContent.style.display = 'flex';
}

btnHome.addEventListener('click', () => {
  _hideAllMainPanels();
  welcomeContent.style.display = 'flex';
  pushNavState('home');
  requestAnimationFrame(_syncAllCarouselArrows);
});

// ── Friends Activity Button ───────────────────────────────────
const btnFriends = document.getElementById('btnFriends');
if (btnFriends) {
  btnFriends.addEventListener('click', () => {
    window._showFriendsActivity?.();
  });
}

btnBack.addEventListener('click', () => {
  if (navCursor <= 0) return;
  navCursor--;
  _restoreNavState(navStack[navCursor]);
});
btnForward.addEventListener('click', () => {
  if (navCursor >= navStack.length - 1) return;
  navCursor++;
  _restoreNavState(navStack[navCursor]);
});

// ── Sidebar ────────────────────────────────────────────────────────
libToggleBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const img = document.getElementById('expandSidebarBtn')?.querySelector('img');
  if (img) img.src = sidebar.classList.contains('collapsed') ? 'pictures/icon-arrow-right.png' : 'pictures/icon-arrow-left.png';
});
document.getElementById('expandSidebarBtn')?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

// ── Exposer renderSidebarView (appelé par Firebase sync) ──────────
window.renderSidebarView = renderSidebarView;

// ── Bouton "Créer une playlist" ───────────────────────────────────
function showCreatePlaylistModal(initialTrack = null) {
  // Vérifier que l'utilisateur est connecté
  const user = window._firebaseUser || window._authUser;
  if (!user) {
    showToast('Connectez-vous pour créer une playlist.', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'create-playlist-modal';
  modal.innerHTML = `
    <div class="create-playlist-box">
      <div class="cpb-title">Créer une playlist</div>
      <div class="cpb-sub">Personnalisez votre nouvelle playlist</div>
      <div class="cpb-cover-row">
        <div class="cpb-cover" id="cpbCover" title="Changer la couverture">
          ${initialTrack?.imageUrl ? `<img src="${initialTrack.imageUrl}" alt="">` : '🎵'}
        </div>
        <div class="cpb-cover-hint">Cliquez sur l'image pour changer la couverture de la playlist</div>
      </div>
      <div class="cpb-field-label">Nom</div>
      <input class="cpb-input" id="cpbName" type="text" placeholder="Ma playlist" maxlength="60" autocomplete="off">
      <div class="cpb-field-label">Description <span style="opacity:.45;font-weight:400">(optionnel)</span></div>
      <textarea class="cpb-input cpb-textarea" id="cpbDesc" placeholder="Description de la playlist…" maxlength="200"></textarea>
      <div class="cpb-actions">
        <button class="cpb-cancel" id="cpbCancel">Annuler</button>
        <button class="cpb-create" id="cpbCreate">Créer</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector('#cpbName')?.focus(), 50);

  const closeModal = () => modal.remove();
  modal.querySelector('#cpbCancel')?.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  const doCreate = async () => {
    const name = modal.querySelector('#cpbName')?.value?.trim();
    if (!name) { modal.querySelector('#cpbName')?.focus(); return; }
    const createBtn = modal.querySelector('#cpbCreate');
    createBtn.disabled = true;
    createBtn.textContent = 'Création…';

    const playlistId = await window.FirebasePlaylists?.createPlaylist(name);
    if (playlistId) {
      // If we have an initial track, add it
      if (initialTrack && window.FirebasePlaylists?.addTrackToPlaylist) {
        await window.FirebasePlaylists.addTrackToPlaylist(playlistId, initialTrack);
      }
      showToast(`Playlist "${name}" créée !`, 'success');
      closeModal();
      renderSidebarPlaylists();
    } else {
      showToast('Erreur lors de la création. Connectez-vous et réessayez.', 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Créer';
    }
  };

  modal.querySelector('#cpbCreate')?.addEventListener('click', doCreate);
  modal.querySelector('#cpbName')?.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
}

document.getElementById('createPlaylistBtn')?.addEventListener('click', showCreatePlaylistModal);
document.getElementById('createPlaylistBtnCompact')?.addEventListener('click', showCreatePlaylistModal);

// Filter pills — now functional
document.querySelectorAll('.filter-pill[data-filter]').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    renderSidebarView(pill.dataset.filter);
  });
});

// Search input
searchInput.addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  if (!term) { renderSidebarView(currentSidebarFilter); return; }
  // Filter current view
  if (currentSidebarFilter === 'albums') {
    const albumMap = new Map();
    tracks.forEach(t => { if (!albumMap.has(t.album)) albumMap.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl, count: 0 }); albumMap.get(t.album).count++; });
    const filtered = [...albumMap.values()].filter(a => a.name.toLowerCase().includes(term) || a.artist.toLowerCase().includes(term));
    // Re-render with filtered results
    trackListDiv.innerHTML = filtered.map(album => `
      <div class="lib-album-item" data-album="${escapeHtml(album.name)}">
        <div class="track-icon-wrap">
          ${album.imageUrl ? `<img src="${album.imageUrl}" loading="lazy" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.4">`}
        </div>
        <div class="track-meta">
          <div class="track-title">${escapeHtml(album.name)}</div>
          <div class="track-artist">${escapeHtml(album.artist)}</div>
        </div>
      </div>`).join('');
  } else if (currentSidebarFilter === 'artists') {
    const artistMap = new Map();
    tracks.forEach(t => { if (!artistMap.has(t.artist)) artistMap.set(t.artist, { name: t.artist, imageUrl: t.imageUrl, count: 0 }); artistMap.get(t.artist).count++; });
    const filtered = [...artistMap.values()].filter(a => a.name.toLowerCase().includes(term));
    trackListDiv.innerHTML = filtered.map(artist => `
      <div class="lib-artist-item" data-artist="${escapeHtml(artist.name)}">
        <div class="lib-artist-avatar" style="background:${artist.imageUrl ? 'var(--bg-tinted)' : artistGradient(artist.name)}">
          ${artist.imageUrl ? `<img src="${artist.imageUrl}" loading="lazy" alt="">` : `<span>${escapeHtml(artist.name.charAt(0).toUpperCase())}</span>`}
        </div>
        <div class="track-meta">
          <div class="track-title">${escapeHtml(artist.name)}</div>
          <div class="track-artist">${artist.count} titres</div>
        </div>
      </div>`).join('');
  }
});

// Fullscreen
document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(console.error);
    showToast('⛶ Mode plein écran', 'info');
  } else {
    document.exitFullscreen();
  }
});

// ── Search dropdown ────────────────────────────────────────────────
function initSearchDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  if (!dropdown) return;
  let debounce = null;
  topSearchInput.addEventListener('input', e => {
    clearTimeout(debounce);
    const term = e.target.value.trim();
    if (!term) { hideDropdown(); return; }
    debounce = setTimeout(() => showDropdownResults(term), 120);
  });
  topSearchInput.addEventListener('focus', e => {
    if (e.target.value.trim()) showDropdownResults(e.target.value.trim());
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.top-search-container')) hideDropdown();
  });
  topSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDropdown(); topSearchInput.blur(); }
    if (e.key === 'Enter') {
      const term = topSearchInput.value.trim();
      if (term) {
        hideDropdown();
        topSearchInput.blur();
        showSearchResultsPage(term);
        topSearchInput.value = '';
      } else {
        dropdown.querySelector('.search-dropdown-item')?.click();
      }
    }
  });
}
function showDropdownResults(term) {
  const dropdown = document.getElementById('searchDropdown');
  if (!dropdown) return;
  const lc = term.toLowerCase();
  const filtered = tracks.filter(t =>
    t.title.toLowerCase().includes(lc) || t.artist.toLowerCase().includes(lc) || t.album.toLowerCase().includes(lc)
  ).slice(0, 12);
  dropdown.innerHTML = filtered.length === 0
    ? `<div class="search-dropdown-empty">Aucun résultat pour « ${escapeHtml(term)} »</div>`
    : `<div class="search-dropdown-header">Résultats (${filtered.length}${filtered.length===12?'+':''})</div>
       ${filtered.map((track, i) => `
         <div class="search-dropdown-item" data-id="${track.id}" style="animation-delay:${i*0.03}s">
           <div class="sdrop-art">${track.imageUrl ? `<img src="${track.imageUrl}" loading="lazy" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.3">`}</div>
           <div class="sdrop-meta">
             <div class="sdrop-title">${highlightMatch(track.title, lc)}</div>
             <div class="sdrop-sub">${highlightMatch(track.artist, lc)} • ${escapeHtml(track.album)}</div>
           </div>
           <div class="sdrop-dur">${formatTime(track.duration)}</div>
         </div>`).join('')}
       <div class="search-dropdown-seeall" data-query="${escapeHtml(term)}">Voir tous les résultats →</div>`;
  dropdown.querySelectorAll('.search-dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
      if (idx !== -1) { currentIndex = idx; playCurrentTrack(); }
      hideDropdown(); topSearchInput.value = '';
    });
  });
  dropdown.querySelector('.search-dropdown-seeall')?.addEventListener('click', el => {
    const q = el.currentTarget.dataset.query;
    hideDropdown(); topSearchInput.value = '';
    showSearchResultsPage(q);
  });
  dropdown.classList.add('visible');
}
function hideDropdown() {
  document.getElementById('searchDropdown')?.classList.remove('visible');
}
function highlightMatch(text, term) {
  if (!term) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    `<mark>${escapeHtml(text.slice(idx, idx + term.length))}</mark>` +
    escapeHtml(text.slice(idx + term.length));
}

// ══════════════════════════════════════════════════════════════════
//  HOME PAGE — carousels (no greeting, no full track list)
// ══════════════════════════════════════════════════════════════════

// Artist gradient helper
const ARTIST_GRADIENTS = [
  ['#1ed760','#0d8c3a'], ['#e91429','#7b000d'], ['#3d91f5','#1a3f80'],
  ['#f57b27','#8a3f00'], ['#b249f8','#5b1a9e'], ['#f5c518','#7a5c00'],
  ['#00c2c7','#005c5f'], ['#ff6b6b','#8b0000'], ['#4ecdc4','#1a6b65'],
  ['#45b7d1','#1a4f6e'], ['#96ceb4','#2d6b50'], ['#dda0dd','#6b3a6b'],
];
function artistGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const [a, b] = ARTIST_GRADIENTS[Math.abs(hash) % ARTIST_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function renderHomePage() {
  renderQuickTiles();
  renderArtistSection();
  // Defer recommended and carousels to not block initial render
  setTimeout(renderRecommendedSection, 50);
  setTimeout(renderDynamicCarousels, 400);
}

function renderQuickTiles() {
  const grid = document.getElementById('homeQuickGrid');
  if (!grid || tracks.length === 0) return;
  const step = Math.max(1, Math.floor(tracks.length / 6));
  const picks = [];
  for (let i = 0; i < 6 && picks.length < 6; i++) {
    const idx = (i * step + Math.floor(Math.random() * step)) % tracks.length;
    picks.push(tracks[idx]);
  }
  grid.innerHTML = picks.map(track => `
    <div class="quick-tile" data-id="${track.id}">
      <div class="quick-tile-art">
        ${track.imageUrl ? `<img src="${track.imageUrl}" alt="" loading="lazy">` : `<div class="quick-tile-art-placeholder">🎵</div>`}
      </div>
      <span class="quick-tile-name">${escapeHtml(track.title)}</span>
    </div>
  `).join('');
  grid.querySelectorAll('.quick-tile').forEach(el => {
    el.addEventListener('click', () => {
      const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
      if (idx !== -1) { currentIndex = idx; playCurrentTrack(); }
    });
  });
}

function renderRecommendedSection() {
  const section = document.getElementById('suggestSection');
  const grid    = document.getElementById('suggestGrid');
  if (!section || !grid || tracks.length === 0) return;

  const shuffled = [...tracks].sort(() => Math.random() - 0.5).slice(0, 20);
  grid.innerHTML = shuffled.map((t,i) => makeHomeCard(t,i)).join('');
  section.style.display = 'block';
  attachHomeCardListeners(grid);

  document.getElementById('refreshSuggest')?.addEventListener('click', () => {
    grid.innerHTML = '';
    section.style.display = 'none';
    setTimeout(renderRecommendedSection, 50);
  }, { once: true });
}

function renderArtistSection() {
  const section = document.getElementById('artistSection');
  const grid    = document.getElementById('artistGrid');
  if (!section || !grid || tracks.length === 0) return;

  const artistMap = new Map();
  tracks.forEach(t => {
    if (!artistMap.has(t.artist)) artistMap.set(t.artist, { name: t.artist, count: 0, imageUrl: t.imageUrl });
    const a = artistMap.get(t.artist); a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
  });
  const artists = [...artistMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  grid.innerHTML = artists.map(a => `
    <div class="artist-card" data-artist="${escapeHtml(a.name)}">
      <div class="artist-avatar" style="background:${a.imageUrl ? 'var(--bg-tinted)' : artistGradient(a.name)}">
        ${a.imageUrl ? `<img src="${a.imageUrl}" alt="" loading="lazy">` : `<span class="artist-avatar-letter">${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
      </div>
      <div class="artist-name">${escapeHtml(a.name)}</div>
      <div class="artist-sub">${a.count} titre${a.count>1?'s':''}</div>
    </div>
  `).join('');
  section.style.display = 'block';

  // Event delegation for clicks
  grid.addEventListener('click', e => {
    const card = e.target.closest('.artist-card');
    if (card) showDetailView('artist', card.dataset.artist);
  });

  // Wire carousel arrows — grid IS the scrollable row
  const prevArrow = section.querySelector('.artist-carousel-prev');
  const nextArrow = section.querySelector('.artist-carousel-next');
  const artistWrapper = section.querySelector('.carousel-wrapper');

  function syncArrows() {
    if (!artistWrapper) return;
    // Skip if the container is not rendered (hidden parent → dimensions are 0)
    if (!grid.clientWidth && !grid.scrollWidth) return;
    const atStart = grid.scrollLeft <= 4;
    const atEnd   = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
    artistWrapper.classList.toggle('at-start', atStart);
    artistWrapper.classList.toggle('at-end',   atEnd);
    if (prevArrow) prevArrow.style.pointerEvents = atStart ? 'none' : '';
    if (nextArrow) nextArrow.style.pointerEvents = atEnd   ? 'none' : '';
  }
  // Store updater so we can re-trigger when home becomes visible
  if (artistWrapper) artistWrapper._syncArrows = syncArrows;

  prevArrow?.addEventListener('click', () => { grid.scrollBy({ left: -(164 * 3), behavior: 'smooth' }); });
  nextArrow?.addEventListener('click', () => { grid.scrollBy({ left:  (164 * 3), behavior: 'smooth' }); });

  grid.addEventListener('scroll', syncArrows, { passive: true });
  // Initial state after layout
  requestAnimationFrame(() => requestAnimationFrame(syncArrows));
}

function renderDynamicCarousels() {
  const container = document.getElementById('genreCarouselsContainer');
  if (!container || tracks.length === 0) return;
  container.innerHTML = '';

  // 1 — Carousel by top artists (top 3)
  const artistMap = new Map();
  tracks.forEach(t => artistMap.set(t.artist, (artistMap.get(t.artist) || 0) + 1));
  const topArtists = [...artistMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  topArtists.forEach(artist => {
    const artistTracks = tracks.filter(t => t.artist === artist).slice(0, 20);
    if (artistTracks.length < 2) return;
    _appendCarousel(container, escapeHtml(artist), artistTracks);
  });

  // 2 — Carousel by decade (if year data available)
  const byDecade = new Map();
  tracks.forEach(t => {
    if (!t.year) return;
    const decade = Math.floor(t.year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade).push(t);
  });
  [...byDecade.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .forEach(([decade, list]) => {
      if (list.length < 3) return;
      _appendCarousel(container, `Années ${decade}`, list.slice(0, 20));
    });

  // 3 — Genre-based (from Jellyfin genre field if available)
  const byGenre = new Map();
  tracks.forEach(t => {
    if (!t.genre) return;
    if (!byGenre.has(t.genre)) byGenre.set(t.genre, []);
    byGenre.get(t.genre).push(t);
  });
  [...byGenre.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .forEach(([genre, list]) => {
      if (list.length < 3) return;
      _appendCarousel(container, escapeHtml(genre), list.slice(0, 20));
    });

  // 4 — If no genres from Jellyfin, try Last.fm async
  if (byGenre.size === 0) {
    loadGenreCarouselsFromLastFm(container);
  }

  // 5 — "Populaires dans votre bibliothèque" (random sample displayed as popular)
  const popular = [...tracks].sort(() => Math.random() - 0.5).slice(0, 20);
  _appendCarousel(container, 'Populaires dans votre bibliothèque', popular);
}

function _appendCarousel(container, title, trackList) {
  const section = document.createElement('div');
  section.className = 'home-section';
  const carouselId = 'carousel-' + Math.random().toString(36).slice(2, 8);

  const chevronL = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M15 18l-6-6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const chevronR = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  section.innerHTML = `
    <div class="home-section-header">
      <h2>${title}</h2>
    </div>
    <div class="carousel-wrapper">
      <button class="carousel-arrow arrow-prev" aria-label="Précédent">${chevronL}</button>
      <div class="home-row-scroll" id="${carouselId}">
        ${trackList.map((t,i) => makeHomeCard(t,i)).join('')}
      </div>
      <button class="carousel-arrow arrow-next" aria-label="Suivant">${chevronR}</button>
    </div>
  `;
  container.appendChild(section);
  attachHomeCardListeners(section.querySelector('.home-row-scroll'));

  const row = section.querySelector('.home-row-scroll');
  const prevArrow = section.querySelector('.arrow-prev');
  const nextArrow = section.querySelector('.arrow-next');

  prevArrow?.addEventListener('click', (e) => {
    e.stopPropagation();
    row?.scrollBy({ left: -(148 + 16) * 3, behavior: 'smooth' });
  });
  nextArrow?.addEventListener('click', (e) => {
    e.stopPropagation();
    row?.scrollBy({ left: (148 + 16) * 3, behavior: 'smooth' });
  });

  const wrapper = section.querySelector('.carousel-wrapper');
  function updateArrows() {
    if (!row || !wrapper) return;
    // Skip if the container is not rendered (hidden parent → dimensions are 0)
    if (!row.clientWidth && !row.scrollWidth) return;
    const atStart = row.scrollLeft <= 4;
    const atEnd   = row.scrollLeft >= row.scrollWidth - row.clientWidth - 4;
    wrapper.classList.toggle('at-start', atStart);
    wrapper.classList.toggle('at-end',   atEnd);
    if (prevArrow) prevArrow.style.pointerEvents = atStart ? 'none' : '';
    if (nextArrow) nextArrow.style.pointerEvents = atEnd   ? 'none' : '';
  }
  // Store updater on wrapper so we can re-trigger from outside
  if (wrapper) wrapper._syncArrows = updateArrows;
  row?.addEventListener('scroll', updateArrows, { passive: true });
  // Wait for full layout before first check
  requestAnimationFrame(() => requestAnimationFrame(updateArrows));
}

async function loadGenreCarouselsFromLastFm(container) {
  if (!container) return;

  const artistMap = new Map();
  tracks.forEach(t => artistMap.set(t.artist, (artistMap.get(t.artist) || 0) + 1));
  const topArtists = [...artistMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);

  const genreMap = new Map(); // genre → Set of tracks

  for (const artist of topArtists) {
    try {
      const url = lastfmUrl(`method=artist.getTopTags&artist=${encodeURIComponent(artist)}&autocorrect=1`);
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const data = await r.json();
      const tags = (data.toptags?.tag || []).slice(0, 2);
      for (const tag of tags) {
        const genre = tag.name.toLowerCase();
        const KNOWN = ['rock','pop','hip-hop','rap','jazz','metal','electronic','classical','indie','r&b','soul','folk','country','punk','blues','reggae','latin','dance','alternative'];
        if (!KNOWN.includes(genre)) continue;
        if (!genreMap.has(genre)) genreMap.set(genre, new Set());
        tracks.filter(t => t.artist === artist).forEach(t => genreMap.get(genre).add(t));
      }
    } catch(e) { continue; }
  }

  for (const [genre, trackSet] of genreMap) {
    if (trackSet.size < 3) continue;
    const label = genre.charAt(0).toUpperCase() + genre.slice(1);
    _appendCarousel(container, label, [...trackSet].slice(0, 20));
  }
}

// ── Recently played ────────────────────────────────────────────────
function addToRecently(track) {
  // ⚠️ IMPORTANT : utiliser window.recentlyPlayed comme base (synchronisé depuis Firebase)
  // et NON pas la variable locale recentlyPlayed (qui ne reflète que la session courante).
  // Sans cela, chaque sync écrase les 20 titres Firebase avec seulement les N titres joués
  // depuis l'ouverture de l'onglet — d'où la limite perçue à 3 titres.
  const base = (window.recentlyPlayed && window.recentlyPlayed.length > 0)
    ? window.recentlyPlayed
    : recentlyPlayed;
  recentlyPlayed = base.filter(t => t.id !== track.id);
  // Normaliser les URLs avant stockage — Firebase peut contenir des URLs absolues
  // avec api_key résiduels. normalizeTrack les convertit en chemins relatifs /api/*.
  recentlyPlayed.unshift(normalizeTrack({ ...track }));
  if (recentlyPlayed.length > 20) recentlyPlayed.length = 20;
  window.recentlyPlayed = recentlyPlayed; // garder la référence window à jour

  // Sauvegarder dans Firebase (saveHistory = anciennement saveRecentlyPlayed)
  if (window.FirebaseSync?.saveHistory) {
    window.FirebaseSync.saveHistory();
  } else if (window.FirebaseSync?.saveRecentlyPlayed) {
    window.FirebaseSync.saveRecentlyPlayed();
  }

  renderRecentlyPlayed();

  // Refresh "Recommandés" to reflect recent listening
  renderRecommendedFromListening();
}

function renderRecentlyPlayed() {
  const section = document.getElementById('recentlySection');
  const grid    = document.getElementById('recentlyGrid');
  // Utiliser window.recentlyPlayed (mis à jour par Firebase sync) ou la variable locale
  const rp = window.recentlyPlayed || recentlyPlayed;
  if (!section || !grid || rp.length === 0) return;
  // Normaliser défensivement chaque piste : window.recentlyPlayed vient de Firebase
  // et peut contenir des URLs absolues stales (api_key exposé, domaine direct).
  grid.innerHTML = rp.map((t,i) => makeHomeCard(normalizeTrack({ ...t }), i)).join('');
  section.style.display = 'block';
  attachHomeCardListeners(grid);

  // Wire carousel arrows
  const wrapper  = section.querySelector('.carousel-wrapper');
  const prevArrow = section.querySelector('.recently-carousel-prev');
  const nextArrow = section.querySelector('.recently-carousel-next');
  prevArrow?.addEventListener('click', () => grid.scrollBy({ left: -(148+16)*3, behavior:'smooth' }));
  nextArrow?.addEventListener('click', () => grid.scrollBy({ left:  (148+16)*3, behavior:'smooth' }));
  function syncArrows() {
    if (!grid.clientWidth && !grid.scrollWidth) return;
    const atStart = grid.scrollLeft <= 4;
    const atEnd   = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
    if (wrapper) { wrapper.classList.toggle('at-start', atStart); wrapper.classList.toggle('at-end', atEnd); }
    if (prevArrow) prevArrow.style.pointerEvents = atStart ? 'none' : '';
    if (nextArrow) nextArrow.style.pointerEvents = atEnd   ? 'none' : '';
  }
  if (wrapper) wrapper._syncArrows = syncArrows;
  grid.addEventListener('scroll', syncArrows, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(syncArrows));
}
// Exposer pour que Firebase sync puisse l'appeler après chargement des données
window.renderRecentlyPlayed = renderRecentlyPlayed;

// ══════════════════════════════════════════════════════════════════
//  PLAY TRACK — Lance la lecture depuis un contexte de playlist
//  Paramètres :
//    track        : objet piste à lancer en premier
//    contextTracks: tableau de pistes formant la « playlist » active
//                   (albums, artistes, titres likés, playlists…)
//  Met à jour window._playContext pour que goNext/goPrev restent
//  dans ce sous-ensemble au lieu de dériver sur la bibliothèque globale.
// ══════════════════════════════════════════════════════════════════
window.playTrack = function(track, contextTracks, contextName) {
  // Trouver l'index global de la piste cible
  const globalIdx = tracks.findIndex(t => t.id === track.id);
  if (globalIdx === -1) {
    console.warn('[playTrack] Piste introuvable dans la bibliothèque:', track.title);
    return;
  }

  // Construire le contexte (indices dans le tableau global tracks)
  let ctxIndices = null;
  if (contextTracks && contextTracks.length > 1) {
    ctxIndices = contextTracks
      .map(t => tracks.findIndex(gt => gt.id === t.id))
      .filter(i => i !== -1);
    window._playContext = ctxIndices.length > 1 ? ctxIndices : null;
  } else {
    window._playContext = null;
  }

  // Mémoriser le nom de contexte (playlist / album / artiste)
  window._currentRpContextName = contextName || null;

  // Désactiver le shuffle pour une lecture ordonnée
  isShuffled = false;
  shuffleBtn.classList.remove('active');
  const pool = window._playContext || [...tracks.keys()];
  shuffleOrder = [...pool];

  currentIndex = globalIdx;
  playCurrentTrack();
};

function renderRecommendedFromListening() {
  const section = document.getElementById('suggestSection');
  const grid    = document.getElementById('suggestGrid');
  const rp = window.recentlyPlayed || recentlyPlayed;
  if (!section || !grid || rp.length === 0) return;

  const recentArtists = [...new Set(rp.map(t => t.artist))];
  let recommended = tracks.filter(t =>
    recentArtists.includes(t.artist) && !rp.find(r => r.id === t.id)
  );

  if (recommended.length < 4) {
    recommended = [...tracks].sort(() => Math.random() - 0.5).slice(0, 20);
  } else {
    recommended = recommended.sort(() => Math.random() - 0.5).slice(0, 20);
  }

  grid.innerHTML = recommended.map((t,i) => makeHomeCard(t,i)).join('');
  section.style.display = 'block';
  attachHomeCardListeners(grid);

  // Wire carousel arrows
  const wrapper   = section.querySelector('.carousel-wrapper');
  const prevArrow = section.querySelector('.suggest-carousel-prev');
  const nextArrow = section.querySelector('.suggest-carousel-next');
  prevArrow?.addEventListener('click', () => grid.scrollBy({ left: -(148+16)*3, behavior:'smooth' }));
  nextArrow?.addEventListener('click', () => grid.scrollBy({ left:  (148+16)*3, behavior:'smooth' }));
  function syncArrows() {
    if (!grid.clientWidth && !grid.scrollWidth) return;
    const atStart = grid.scrollLeft <= 4;
    const atEnd   = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
    if (wrapper) { wrapper.classList.toggle('at-start', atStart); wrapper.classList.toggle('at-end', atEnd); }
    if (prevArrow) prevArrow.style.pointerEvents = atStart ? 'none' : '';
    if (nextArrow) nextArrow.style.pointerEvents = atEnd   ? 'none' : '';
  }
  if (wrapper) wrapper._syncArrows = syncArrows;
  grid.addEventListener('scroll', syncArrows, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(syncArrows));
}

// ── Home card helpers ──────────────────────────────────────────────
function makeHomeCard(track, index = 0) {
  const allArtists = track.artists && track.artists.length > 1
    ? track.artists.join(', ')
    : track.artist;
  return `
    <div class="home-card" data-id="${track.id}" data-album="${escapeHtml(track.album || '')}" style="animation-delay:${Math.min(index * 0.04, 0.4)}s">
      <div class="home-card-art">
        ${track.imageUrl ? `<img src="${track.imageUrl}" alt="" loading="lazy">` : `<div class="home-card-art-placeholder">🎵</div>`}
        <button class="card-play-btn" data-id="${track.id}" title="Lire" aria-label="Lire">
          <img src="pictures/icon-play.png"  alt="▶" class="card-play-icon card-play-icon-play">
          <img src="pictures/icon-pause.png" alt="⏸" class="card-play-icon card-play-icon-pause" style="display:none">
        </button>
      </div>
      <div class="home-card-title">${escapeHtml(track.title)}</div>
      <div class="home-card-sub">${escapeHtml(allArtists)}</div>
    </div>`;
}
function attachHomeCardListeners(container) {
  container?.querySelectorAll('.home-card').forEach(el => {
    // Clic sur la card (hors bouton play) → navigate to album
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-btn')) return;
      const album = el.dataset.album;
      if (album) {
        showDetailView('album', album);
      } else {
        // Fallback si pas d'album : lire le titre hors contexte playlist
        const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
        if (idx !== -1) { window._playContext = null; currentIndex = idx; playCurrentTrack(); }
      }
    });

    // Clic sur le bouton play/pause → toggle lecture
    const playBtn = el.querySelector('.card-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
        if (idx === -1) return;
        if (currentIndex === idx && !audioPlayer.paused) {
          // Même piste déjà en cours → pause
          audioPlayer.pause();
        } else {
          // Lancer cette piste EN DEHORS de tout contexte playlist
          // (même si elle est présente dans _playContext, on joue libre depuis l'accueil)
          window._playContext = null;
          currentIndex = idx;
          playCurrentTrack();
        }
      });
    }
  });
}

// ── Met à jour les icônes play/pause de toutes les home-cards ──────
function updateHomeCardPlayIcons() {
  const activeId = (currentIndex >= 0 && !audioPlayer.paused)
    ? tracks[currentIndex]?.id : null;
  document.querySelectorAll('.home-card').forEach(card => {
    const isPlaying = card.dataset.id === activeId;
    card.classList.toggle('is-playing', isPlaying);
    const iconPlay  = card.querySelector('.card-play-icon-play');
    const iconPause = card.querySelector('.card-play-icon-pause');
    if (iconPlay)  iconPlay.style.display  = isPlaying ? 'none' : 'block';
    if (iconPause) iconPause.style.display = isPlaying ? 'block' : 'none';
  });
}
window.updateHomeCardPlayIcons = updateHomeCardPlayIcons;
// Patch makeHomeCard calls to pass index for stagger animation
function makeHomeCards(trackList) {
  return trackList.map((t, i) => makeHomeCard(t, i)).join('');
}

// ══════════════════════════════════════════════════════════════════
//  DETAIL VIEW — album / artist / playlist
// ══════════════════════════════════════════════════════════════════

// ── Detail view sort state ──────────────────────────────────────
let detailSortKey = null; // 'title'|'album'|'dateAdded'|'duration'
let detailSortDir = 1;    // 1=asc, -1=desc
let detailContextTracks = [];
let detailType = null;

// ══════════════════════════════════════════════════════════════════
//  PLAYLIST EDIT MODAL
// ══════════════════════════════════════════════════════════════════
function _openPlaylistEditModal(playlistId, pl, plTracks) {
  const existing = document.getElementById('playlistEditModal');
  if (existing) existing.remove();

  // Current cover image
  let newCoverFile = null;
  let currentCoverSrc = '';
  // Try to get a cover from the first track
  if (plTracks?.length) {
    currentCoverSrc = plTracks.find(t => t.imageUrl)?.imageUrl || '';
  }

  const modal = document.createElement('div');
  modal.id = 'playlistEditModal';
  modal.className = 'pl-edit-overlay';
  modal.innerHTML = `
    <div class="pl-edit-modal">
      <div class="pl-edit-header">
        <h2 class="pl-edit-title">Modifier les informations</h2>
        <button class="pl-edit-close" id="plEditClose" title="Fermer">
          <img src="pictures/False.png" alt="✕" class="btn-icon" onerror="this.replaceWith(document.createTextNode('✕'))">
        </button>
      </div>
      <div class="pl-edit-body">
        <div class="pl-edit-cover-wrap" id="plEditCoverWrap" title="Modifier la photo">
          ${currentCoverSrc
            ? `<img src="${currentCoverSrc}" alt="" class="pl-edit-cover-img" id="plEditCoverImg">`
            : `<div class="pl-edit-cover-placeholder" id="plEditCoverImg">🎵</div>`
          }
          <div class="pl-edit-cover-overlay">
            <img src="pictures/Edit.png" alt="" class="pl-edit-cover-edit-icon" onerror="this.outerHTML='<span style=font-size:1.8rem>✎</span>'">
            <span>Modifier la photo</span>
          </div>
          <input type="file" id="plEditFileInput" accept="image/*" style="display:none">
        </div>
        <div class="pl-edit-fields">
          <input type="text" id="plEditName" class="pl-edit-input" placeholder="Nom de la playlist" value="${escapeHtml(pl.name || '')}">
          <textarea id="plEditDesc" class="pl-edit-textarea" placeholder="Ajoutez une description facultative">${escapeHtml(pl.description || '')}</textarea>
          <button class="pl-edit-privacy-btn" id="plEditPrivacyBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span id="plEditPrivacyLabel">${pl.private ? 'Privée' : 'Rendre privée'}</span>
          </button>
        </div>
      </div>
      <div class="pl-edit-footer">
        <p class="pl-edit-legal">En continuant, vous accordez à Beartify les droits de l'image que vous décidez d'importer. Vérifiez bien que vous avez le droit d'importer cette image.</p>
        <button class="pl-edit-save-btn" id="plEditSave">Sauvegarder</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Privacy toggle
  let isPrivate = !!pl.private;
  const privacyBtn   = modal.querySelector('#plEditPrivacyBtn');
  const privacyLabel = modal.querySelector('#plEditPrivacyLabel');
  privacyBtn.addEventListener('click', () => {
    isPrivate = !isPrivate;
    privacyLabel.textContent = isPrivate ? 'Privée' : 'Rendre privée';
    privacyBtn.classList.toggle('active', isPrivate);
  });
  if (isPrivate) privacyBtn.classList.add('active');

  // Cover file picker
  const coverWrap = modal.querySelector('#plEditCoverWrap');
  const fileInput = modal.querySelector('#plEditFileInput');
  coverWrap.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    newCoverFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imgEl = modal.querySelector('#plEditCoverImg');
      if (imgEl.tagName === 'IMG') {
        imgEl.src = ev.target.result;
      } else {
        const img = document.createElement('img');
        img.src = ev.target.result;
        img.className = 'pl-edit-cover-img';
        img.id = 'plEditCoverImg';
        imgEl.replaceWith(img);
      }
    };
    reader.readAsDataURL(file);
  });

  // Close
  const closeModal = () => modal.remove();
  modal.querySelector('#plEditClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Save
  modal.querySelector('#plEditSave').addEventListener('click', async () => {
    const newName = modal.querySelector('#plEditName').value.trim();
    const newDesc = modal.querySelector('#plEditDesc').value.trim();
    if (!newName) { showToast('Le nom ne peut pas être vide.', 'error'); return; }

    const updates = { name: newName, description: newDesc, private: isPrivate };
    const ok = await window.FirebasePlaylists?.updatePlaylist?.(playlistId, updates);
    if (ok !== false) {
      pl.name = newName;
      pl.description = newDesc;
      pl.private = isPrivate;
      const titleEl = document.getElementById('customPlaylistTitle');
      if (titleEl) titleEl.textContent = newName;
      const descEl = document.getElementById('customPlaylistDesc');
      if (descEl) descEl.textContent = newDesc || 'Playlist personnelle';
      showToast('Playlist mise à jour.', 'success');
      renderSidebarPlaylists?.();
    } else {
      showToast('Erreur lors de la sauvegarde.', 'error');
    }
    closeModal();
  });
}

// ══════════════════════════════════════════════════════════════════
//  SHOW PLAYLIST VIEW — Titres likés & Mes favoris
//  Utilise showDetailView avec filtrage selon le type de playlist
// ══════════════════════════════════════════════════════════════════
window.showPlaylistView = function(type, pushHistory = true) {
  if (type === 'liked') {
    // Construire la liste des titres likés à partir des IDs
    const likedList = tracks.filter(t => likedTracks.has(t.id));
    _hideAllMainPanels();
    detailView.style.display = 'flex';
    detailType = 'liked';
    detailSortKey = null;
    detailSortDir = 1;
    detailContextTracks = [...likedList];

    const totalDuration = likedList.reduce((s, t) => s + (t.duration || 0), 0);
    const totalMin = Math.floor(totalDuration / 60);
    const totalH   = Math.floor(totalMin / 60);
    const durationStr = totalH > 0 ? `${totalH} h ${totalMin % 60} min` : `${totalMin} min`;

    detailView.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover">
          <img src="pictures/icon-heart.jpg" alt="" class="detail-cover-img" style="border-radius:8px;">
        </div>
        <div class="detail-meta">
          <div class="detail-type">Playlist</div>
          <h1 class="detail-title">Titres likés</h1>
          <div class="detail-subtitle">Ta collection personnelle</div>
          <div class="detail-stats">${likedList.length} titre${likedList.length !== 1 ? 's' : ''} · ${durationStr}</div>
        </div>
      </div>
      <div class="detail-controls-bar">
        <div class="detail-controls-left">
          <button class="detail-play-btn" id="detailPlayBtn">
            <span class="detail-play-icon"></span> Lecture
          </button>
          <button class="detail-shuffle-btn" id="detailShuffleBtn" title="Lecture aléatoire">
            <img src="pictures/icon-shuffle.png" alt="" class="btn-icon">
          </button>
        </div>
        <div class="detail-controls-right">
          <div class="detail-search-wrap" id="detailSearchWrap">
            <button class="detail-search-toggle" id="detailSearchToggle" title="Rechercher">
              <img src="pictures/icon-search.png" alt="" class="btn-icon" style="width:18px;height:18px;">
            </button>
            <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
          </div>
          <button class="detail-list-sort-btn" id="detailListSortBtn" title="Trier et afficher">
            <img src="pictures/icon-list.png" alt="" class="btn-icon" style="width:18px;height:18px;">
          </button>
        </div>
      </div>
      <div class="detail-tracks-header" id="detailTracksHeader">
        <span class="dth-num">#</span>
        <span class="dth-title dth-sortable" data-sort="title">Titre<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-album dth-sortable" data-sort="album">Album<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dateadded dth-sortable" data-sort="year">Date<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dur dth-sortable" data-sort="duration" style="cursor:pointer;user-select:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="dth-sort-arrow">↕</span>
        </span>
      </div>
      <div class="detail-tracks-list" id="detailTrackList"></div>
    `;

    _renderDetailTracks(likedList, 'liked');

    // Boutons play/shuffle — Titres likés
    document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
      if (!likedList.length) return;
      const ctxIndices = likedList.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      window._playContext = ctxIndices.length ? ctxIndices : null;
      isShuffled = false;
      shuffleBtn.classList.remove('active');
      shuffleOrder = ctxIndices;
      window._currentRpContextName = 'Titres likés';
      const _ctxEl = document.getElementById('rpContextName');
      if (_ctxEl) _ctxEl.textContent = 'Titres likés';
      if (ctxIndices.length) { currentIndex = ctxIndices[0]; playCurrentTrack(); }
    });
    document.getElementById('detailShuffleBtn')?.addEventListener('click', () => {
      if (!likedList.length) return;
      const ctxIndices = likedList.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      window._playContext = ctxIndices.length ? ctxIndices : null;
      isShuffled = true;
      shuffleBtn.classList.add('active');
      if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      } else {
        shuffleOrder = [...ctxIndices].sort(() => Math.random() - 0.5);
      }
      if (shuffleOrder.length) { window._currentRpContextName = 'Titres likés'; const _ctxEl2 = document.getElementById('rpContextName'); if (_ctxEl2) _ctxEl2.textContent = 'Titres likés'; currentIndex = shuffleOrder[0]; playCurrentTrack(); }
    });

    // Recherche inline
    document.getElementById('detailSearchInput')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? likedList.filter(t =>
        t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q) || t.album?.toLowerCase().includes(q)
      ) : likedList;
      _renderDetailTracks(filtered, 'liked');
    });

    if (pushHistory) history.pushState({ view: 'playlist', type: 'liked' }, '');
    return;
  }

  if (type === 'favorites') {
    // Afficher albums et artistes favoris — on utilise showDetailView pour chaque,
    // mais d'abord on montre une vue de sélection dans la vue détail
    const favAlbumsList = [...favoriteAlbums].map(name => {
      const t = tracks.find(tr => tr.album === name);
      return { name, imageUrl: t?.imageUrl || null, artist: t?.artist || '', count: tracks.filter(tr => tr.album === name).length };
    });
    const favArtistsList = [...favoriteArtists].map(name => {
      const t = tracks.find(tr => tr.artist === name);
      return { name, imageUrl: t?.imageUrl || null, count: tracks.filter(tr => tr.artist === name).length };
    });

    _hideAllMainPanels();
    detailView.style.display = 'flex';
    detailType = 'favorites';
    detailContextTracks = [];

    const albumCards = favAlbumsList.map(a => `
      <div class="lib-album-item" data-album="${escapeHtml(a.name)}" style="cursor:pointer;">
        <div class="track-icon-wrap">
          ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" alt="">` : `<div style="width:44px;height:44px;background:linear-gradient(135deg,#f57b27,#8a3f00);display:flex;align-items:center;justify-content:center;font-size:1.3rem">💿</div>`}
        </div>
        <div class="track-meta">
          <div class="track-title">${escapeHtml(a.name)}</div>
          <div class="track-artist">${escapeHtml(a.artist)} · ${a.count} titre${a.count > 1 ? 's' : ''}</div>
        </div>
      </div>`).join('');

    const artistCards = favArtistsList.map(a => `
      <div class="lib-artist-item" data-artist="${escapeHtml(a.name)}" style="cursor:pointer;">
        <div class="lib-artist-avatar" style="background:${a.imageUrl ? 'var(--bg-tinted)' : artistGradient(a.name)}">
          ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" alt="">` : `<span>${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
        </div>
        <div class="track-meta">
          <div class="track-title">${escapeHtml(a.name)}</div>
          <div class="track-artist">${a.count} titre${a.count > 1 ? 's' : ''}</div>
        </div>
      </div>`).join('');

    // Toutes les pistes des albums favoris (pour le bouton lecture)
    const favAlbumTracks = [...favoriteAlbums].flatMap(name =>
      tracks.filter(t => t.album === name)
    );

    const total = favAlbumsList.length + favArtistsList.length;
    detailView.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover">
          <img src="pictures/icon-star.png"  alt="" class="detail-cover-img" style="border-radius:8px;">
        </div>
        <div class="detail-meta">
          <div class="detail-type">Playlist</div>
          <h1 class="detail-title">Mes favoris</h1>
          <div class="detail-subtitle">Albums et artistes favoris</div>
          <div class="detail-stats">${total} élément${total !== 1 ? 's' : ''} · ${favAlbumTracks.length} titre${favAlbumTracks.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      ${favAlbumTracks.length > 0 ? `
      <div class="detail-controls-bar">
        <div class="detail-controls-left">
          <button class="detail-play-btn" id="favPlayBtn">
            <span class="detail-play-icon"></span> Lecture
          </button>
          <button class="detail-shuffle-btn" id="favShuffleBtn" title="Lecture aléatoire">
            <img src="pictures/icon-shuffle.png" alt="" class="btn-icon">
          </button>
        </div>
      </div>` : ''}
      <div style="padding: 0 24px 24px;">
        ${favAlbumsList.length ? `<div style="font-size:0.78rem;font-weight:700;letter-spacing:0.08em;color:rgba(255,255,255,0.5);margin-bottom:10px;text-transform:uppercase;">Albums</div>
          <div class="track-list" id="favAlbumsContainer">${albumCards}</div>` : ''}
        ${favArtistsList.length ? `<div style="font-size:0.78rem;font-weight:700;letter-spacing:0.08em;color:rgba(255,255,255,0.5);margin:18px 0 10px;text-transform:uppercase;">Artistes</div>
          <div class="track-list" id="favArtistsContainer">${artistCards}</div>` : ''}
        ${total === 0 ? `<div style="text-align:center;padding:60px 0;color:rgba(255,255,255,0.4);">
          <div style="font-size:2.5rem;margin-bottom:12px;">⭐</div>
          <div>Aucun favori pour le moment</div>
        </div>` : ''}
      </div>
    `;

    detailView.querySelectorAll('.lib-album-item[data-album]').forEach(el =>
      el.addEventListener('click', () => showDetailView('album', el.dataset.album)));
    detailView.querySelectorAll('.lib-artist-item[data-artist]').forEach(el =>
      el.addEventListener('click', () => showDetailView('artist', el.dataset.artist)));

    // ── Boutons Lecture / Aléatoire — Mes favoris ───────────────────
    document.getElementById('favPlayBtn')?.addEventListener('click', () => {
      if (!favAlbumTracks.length) return;
      const ctxIndices = favAlbumTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      window._playContext = ctxIndices.length ? ctxIndices : null;
      isShuffled = false;
      shuffleBtn.classList.remove('active');
      shuffleOrder = ctxIndices;
      if (ctxIndices.length) { currentIndex = ctxIndices[0]; playCurrentTrack(); }
    });
    document.getElementById('favShuffleBtn')?.addEventListener('click', () => {
      if (!favAlbumTracks.length) return;
      const ctxIndices = favAlbumTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      window._playContext = ctxIndices.length ? ctxIndices : null;
      isShuffled = true;
      shuffleBtn.classList.add('active');
      if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      } else {
        shuffleOrder = [...ctxIndices].sort(() => Math.random() - 0.5);
      }
      if (shuffleOrder.length) { currentIndex = shuffleOrder[0]; playCurrentTrack(); }
    });

    if (pushHistory) history.pushState({ view: 'playlist', type: 'favorites' }, '');
    return;
  }

  // ── Playlist personnalisée ──────────────────────────────────────────
  if (type && type.startsWith('custom:')) {
    const playlistId = type.slice(7);
    const pl = window.customPlaylists?.[playlistId];
    if (!pl) {
      showToast('Playlist introuvable.', 'error');
      return;
    }

    const plTracks = (pl.tracks || []).map(pt => {
      // Essayer de retrouver la piste complète depuis la bibliothèque Jellyfin
      const full = tracks.find(t => t.id === pt.id);
      return full || pt; // fallback: utiliser les données stockées dans Firebase
    });

    _hideAllMainPanels();
    detailView.style.display = 'flex';
    detailType = 'custom_playlist';
    detailSortKey = null;
    detailSortDir = 1;
    detailContextTracks = [...plTracks];

    const totalDuration = plTracks.reduce((s, t) => s + (t.duration || 0), 0);
    const totalMin = Math.floor(totalDuration / 60);
    const totalH   = Math.floor(totalMin / 60);
    const durationStr = totalH > 0 ? `${totalH} h ${totalMin % 60} min` : `${totalMin} min`;

    detailView.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover playlist-cover-editable" id="playlistCoverWrap">
          ${_makePlaylistCoverHtml(plTracks, 'lg')}
          <div class="playlist-cover-overlay">
            <img src="pictures/Edit.png" alt="" class="playlist-cover-edit-icon">
            <span class="playlist-cover-edit-label">Modifier les informations</span>
          </div>
        </div>
        <div class="detail-meta">
          <div class="detail-type">Playlist</div>
          <h1 class="detail-title" id="customPlaylistTitle">${escapeHtml(pl.name)}</h1>
          <div class="detail-subtitle" id="customPlaylistDesc">${escapeHtml(pl.description || 'Playlist personnelle')}</div>
          <div class="detail-stats">${plTracks.length} titre${plTracks.length !== 1 ? 's' : ''} · ${durationStr}</div>
        </div>
      </div>
      <div class="detail-controls-bar playlist-controls-bar">
        <div class="detail-controls-left">
          <button class="playlist-play-circle" id="detailPlayBtn" title="Lecture">
            <img src="pictures/icon-play.png" alt="▶" class="playlist-play-icon-img" id="playlistPlayIcon">
            <img src="pictures/icon-pause.png" alt="⏸" class="playlist-play-icon-img" id="playlistPauseIcon" style="display:none">
          </button>
          <button class="playlist-ctrl-btn" id="detailShuffleBtn" title="Lecture aléatoire">
            <img src="pictures/icon-shuffle.png" alt="" class="btn-icon">
          </button>
          <button class="playlist-ctrl-btn" id="detailDownloadBtn" title="Télécharger">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
          </button>
          <button class="playlist-ctrl-btn" id="detailAddProfileBtn" title="Ajouter au profil">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          </button>
          <button class="playlist-ctrl-btn playlist-etc-btn" id="detailPlaylistEtcBtn" title="Plus d'options">
            <img src="pictures/Etc.png" alt="⋯" class="btn-icon">
          </button>
        </div>
        <div class="detail-controls-right">
          <div class="detail-search-wrap" id="detailSearchWrap">
            <button class="detail-search-toggle" id="detailSearchToggle" title="Rechercher">
              <img src="pictures/icon-search.png" alt="" class="btn-icon" style="width:18px;height:18px;">
            </button>
            <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
          </div>
          <button class="detail-list-sort-btn" id="detailListSortBtn" title="Trier et afficher">
            <img src="pictures/icon-list.png" alt="" class="btn-icon" style="width:18px;height:18px;">
          </button>
        </div>
      </div>
      <div class="detail-tracks-header" id="detailTracksHeader">
        <span class="dth-num">#</span>
        <span class="dth-title dth-sortable" data-sort="title">Titre<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-album dth-sortable" data-sort="album">Album<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dateadded dth-sortable" data-sort="year">Date<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dur dth-sortable" data-sort="duration" style="cursor:pointer;user-select:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="dth-sort-arrow">↕</span>
        </span>
      </div>
      <div class="detail-tracks-list" id="detailTrackList"></div>
    `;

    _renderDetailTracks(plTracks, 'custom_playlist');

    document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
      if (!plTracks.length) return;
      const ctxIdx = plTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      // Vérifie si _playContext correspond EXACTEMENT à cette playlist
      // (et pas juste si un titre en commun joue par hasard ailleurs)
      const ctxSet = new Set(ctxIdx);
      const thisPlaylistIsActive = Array.isArray(window._playContext) &&
        window._playContext.length === ctxIdx.length &&
        window._playContext.every(i => ctxSet.has(i));
      if (thisPlaylistIsActive && !audioPlayer.paused) {
        // Cette playlist joue → pause
        audioPlayer.pause();
      } else if (thisPlaylistIsActive && audioPlayer.paused) {
        // Cette playlist est en pause → reprendre
        audioPlayer.play().catch(console.error);
      } else {
        // Start from beginning
        window._playContext = ctxIdx.length ? ctxIdx : null;
        isShuffled = false;
        shuffleBtn.classList.remove('active');
        shuffleOrder = ctxIdx;
        window._currentRpContextName = pl.name;
        const _ctxElPl = document.getElementById('rpContextName');
        if (_ctxElPl) _ctxElPl.textContent = pl.name;
        if (ctxIdx.length) { currentIndex = ctxIdx[0]; playCurrentTrack(); }
      }
    });
    document.getElementById('detailShuffleBtn')?.addEventListener('click', () => {
      if (!plTracks.length) return;
      const ctxIdx = plTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      const isThisCtxActive = ctxIdx.includes(currentIndex) &&
        (window._playContext ? ctxIdx.some(i => window._playContext.includes(i)) : true);

      isShuffled = !isShuffled;
      shuffleBtn.classList.toggle('active', isShuffled);
      document.getElementById('detailShuffleBtn')?.classList.toggle('shuffle-active', isShuffled);

      if (isShuffled) {
        // Rebuild shuffle queue
        window._playContext = ctxIdx.length ? ctxIdx : null;
        if (window._buildShuffleQueue) {
          const _ct = ctxIdx.map(i => tracks[i]).filter(Boolean);
          const _sh = window._buildShuffleQueue(_ct, ctxIdx.indexOf(currentIndex));
          shuffleOrder = _sh.map(t => tracks.indexOf(t)).filter(i => i !== -1);
        } else {
          shuffleOrder = [...ctxIdx].sort(() => Math.random() - 0.5);
        }
        // Place current track first in queue if already playing from this context
        if (isThisCtxActive) {
          const ci = shuffleOrder.indexOf(currentIndex);
          if (ci > 0) { shuffleOrder.splice(ci, 1); shuffleOrder.unshift(currentIndex); }
        } else {
          // Not playing from this playlist yet → start playback
          window._currentRpContextName = pl.name;
          const _ctxElSh = document.getElementById('rpContextName');
          if (_ctxElSh) _ctxElSh.textContent = pl.name;
          if (shuffleOrder.length) { currentIndex = shuffleOrder[0]; playCurrentTrack(); }
        }
      } else {
        // Shuffle off — restore linear order for this context
        window._playContext = ctxIdx.length ? ctxIdx : null;
        shuffleOrder = [...ctxIdx];
      }
      showToast(isShuffled ? '⇄ Lecture aléatoire activée' : '⇄ Lecture aléatoire désactivée', isShuffled ? 'info' : 'default');
    });
    // ── Sync play/pause icon on the big circle button ─────────────────
    function _syncPlaylistPlayIcon() {
      const isCtxPlaying = !audioPlayer.paused && window._playContext?.includes(currentIndex);
      const playIcon  = document.getElementById('playlistPlayIcon');
      const pauseIcon = document.getElementById('playlistPauseIcon');
      if (playIcon)  playIcon.style.display  = isCtxPlaying ? 'none' : '';
      if (pauseIcon) pauseIcon.style.display = isCtxPlaying ? '' : 'none';
    }
    audioPlayer.addEventListener('play',  _syncPlaylistPlayIcon);
    audioPlayer.addEventListener('pause', _syncPlaylistPlayIcon);
    _syncPlaylistPlayIcon();

    // ── Cover overlay → open edit modal ───────────────────────────────
    document.getElementById('playlistCoverWrap')?.addEventListener('click', () => {
      _openPlaylistEditModal(playlistId, pl, plTracks);
    });

    // ── Etc context menu ──────────────────────────────────────────────
    document.getElementById('detailPlaylistEtcBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.getElementById('playlistEtcMenu');
      if (existing) { existing.remove(); return; }
      const menu = document.createElement('div');
      menu.id = 'playlistEtcMenu';
      menu.className = 'playlist-ctx-menu';
      const btn = document.getElementById('detailPlaylistEtcBtn');
      const r = btn.getBoundingClientRect();
      menu.style.top  = (r.bottom + 6) + 'px';
      menu.style.left = r.left + 'px';
      menu.innerHTML = `
        <div class="pctx-item" id="pctxQueue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> Ajouter à la file d'attente</div>
        <div class="pctx-item" id="pctxAddProfile"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Ajouter au profil</div>
        <div class="pctx-item" id="pctxEdit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier les informations</div>
        <div class="pctx-item pctx-danger" id="pctxDelete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Supprimer</div>
        <div class="pctx-item" id="pctxPrivate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${pl.private ? 'Rendre publique' : 'Rendre privée'}</div>
        <div class="pctx-item" id="pctxCollaborators"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Inviter des collaborateurs</div>
        <div class="pctx-item" id="pctxExclude"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Exclure de votre profil de goût</div>
        <div class="pctx-item pctx-has-sub" id="pctxFolder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Déplacer vers le dossier <svg class="pctx-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
        <div class="pctx-item" id="pctxShare"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Partager</div>
      `;
      document.body.appendChild(menu);

      menu.querySelector('#pctxQueue')?.addEventListener('click', () => {
        if (plTracks.length) { showToast('Ajouté à la file d\'attente.', 'success'); }
        menu.remove();
      });
      menu.querySelector('#pctxEdit')?.addEventListener('click', () => {
        menu.remove();
        _openPlaylistEditModal(playlistId, pl, plTracks);
      });
      menu.querySelector('#pctxDelete')?.addEventListener('click', async () => {
        menu.remove();
        if (!confirm(`Supprimer la playlist "${pl.name}" ?`)) return;
        const ok = await window.FirebasePlaylists?.deletePlaylist(playlistId);
        if (ok) {
          showToast('Playlist supprimée.', 'info');
          renderSidebarPlaylists();
          _hideAllMainPanels();
          welcomeContent.style.display = 'flex';
          pushNavState('home');
        } else {
          showToast('Erreur lors de la suppression.', 'error');
        }
      });
      menu.querySelector('#pctxPrivate')?.addEventListener('click', async () => {
        menu.remove();
        const newPrivate = !pl.private;
        const ok = await window.FirebasePlaylists?.updatePlaylist?.(playlistId, { private: newPrivate });
        if (ok !== false) {
          pl.private = newPrivate;
          showToast(newPrivate ? 'Playlist rendue privée.' : 'Playlist rendue publique.', 'success');
        }
      });
      menu.querySelector('#pctxShare')?.addEventListener('click', () => {
        menu.remove();
        navigator.clipboard?.writeText(window.location.href).then(() => showToast('Lien copié !', 'success'));
      });

      const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });
    // ── Column header sorting ──────────────────────────────────────────
    document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (detailSortKey === key) {
          detailSortDir = -detailSortDir;
        } else {
          detailSortKey = key;
          detailSortDir = 1;
        }
        document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
          const a = h.querySelector('.dth-sort-arrow');
          if (a) a.textContent = '↕';
        });
        th.classList.add(detailSortDir === 1 ? 'sort-asc' : 'sort-desc');
        const arrow = th.querySelector('.dth-sort-arrow');
        if (arrow) arrow.textContent = detailSortDir === 1 ? '↑' : '↓';
        _sortAndRenderDetailTracks('custom_playlist');
      });
    });

    // ── Search toggle ──────────────────────────────────────────────────
    const searchToggle = document.getElementById('detailSearchToggle');
    const searchInput  = document.getElementById('detailSearchInput');
    searchToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = document.getElementById('detailSearchWrap');
      const isOpen = wrap?.classList.toggle('search-open');
      if (isOpen) { searchInput?.focus(); }
      else { if (searchInput) { searchInput.value = ''; _renderDetailTracks(plTracks, 'custom_playlist'); } }
    });
    searchInput?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? plTracks.filter(t =>
        t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q) || t.album?.toLowerCase().includes(q)
      ) : plTracks;
      _renderDetailTracks(filtered, 'custom_playlist');
    });

    // ── List / sort button (icon-list.png) ─────────────────────────────
    const listSortBtn = document.getElementById('detailListSortBtn');
    if (listSortBtn) {
      listSortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.getElementById('detailSortPanel');
        if (existing) { existing.remove(); listSortBtn.classList.remove('active'); return; }
        // Build sort panel (same as showDetailView)
        const rect = listSortBtn.getBoundingClientRect();
        const sortOpts = [
          { key: '',          label: 'Tri personnalisé' },
          { key: 'title',     label: 'Titre' },
          { key: 'artist',    label: 'Artiste' },
          { key: 'album',     label: 'Album' },
          { key: 'year',      label: 'Ajouté récemment' },
          { key: 'duration',  label: 'Durée' },
        ];
        const viewOpts = [
          { key: 'compact', label: 'Compact', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/></svg>` },
          { key: 'list',    label: 'Liste',    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>` },
        ];
        const panel = document.createElement('div');
        panel.id = 'detailSortPanel';
        panel.style.cssText = [
          `position:fixed`,`top:${rect.bottom + 6}px`,
          `right:${window.innerWidth - rect.right}px`,`z-index:99999`,
          `min-width:220px`,`background:#1c1c1c`,
          `border:1px solid rgba(255,255,255,0.13)`,`border-radius:10px`,
          `padding:6px 0`,`box-shadow:0 20px 60px rgba(0,0,0,0.85),0 4px 16px rgba(0,0,0,0.6)`,
          `animation:dspSlideDown 0.18s cubic-bezier(0.4,0,0.2,1) both`,`overflow:hidden`,
        ].join(';');
        const mkHeader = (txt) => { const h = document.createElement('div'); h.style.cssText='padding:8px 16px 4px;font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4)'; h.textContent=txt; return h; };
        panel.appendChild(mkHeader('Trier par'));
        sortOpts.forEach(opt => {
          const isActive = detailSortKey === (opt.key || null) || (!detailSortKey && opt.key === '');
          const row = document.createElement('button');
          row.style.cssText='display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 16px;background:none;border:none;color:'+(isActive?'#fff':'rgba(255,255,255,0.75)')+';font-family:inherit;font-size:0.88rem;font-weight:'+(isActive?'600':'400')+';cursor:pointer;text-align:left;transition:background 0.1s ease';
          row.innerHTML=`<span>${opt.label}</span><span style="color:rgba(255,255,255,0.55);font-size:0.8rem">${isActive&&detailSortDir===-1?'↓':isActive&&opt.key?'↑':''}</span>`;
          row.onmouseenter=()=>{row.style.background='rgba(255,255,255,0.08)'};row.onmouseleave=()=>{row.style.background='none'};
          row.addEventListener('click',()=>{
            if(detailSortKey===(opt.key||null)&&opt.key){detailSortDir=-detailSortDir;}else{detailSortKey=opt.key||null;detailSortDir=1;}
            _sortAndRenderDetailTracks('custom_playlist'); panel.remove(); listSortBtn.classList.remove('active');
            document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(h=>{const m=h.dataset.sort===detailSortKey;h.classList.toggle('sort-asc',m&&detailSortDir===1);h.classList.toggle('sort-desc',m&&detailSortDir===-1);const a=h.querySelector('.dth-sort-arrow');if(a)a.textContent=m?(detailSortDir===1?'↑':'↓'):'↕';});
          });
          panel.appendChild(row);
        });
        const div=document.createElement('div');div.style.cssText='height:1px;background:rgba(255,255,255,0.08);margin:4px 0';panel.appendChild(div);
        panel.appendChild(mkHeader("Mode d'affichage"));
        let curViewMode='list';
        viewOpts.forEach(opt=>{
          const isAct=curViewMode===opt.key;
          const row=document.createElement('button');
          row.style.cssText='display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 16px;background:none;border:none;color:'+(isAct?'#fff':'rgba(255,255,255,0.75)')+';font-family:inherit;font-size:0.88rem;cursor:pointer;transition:background 0.1s ease';
          row.innerHTML=`<span style="display:flex;align-items:center;gap:10px">${opt.icon}<span>${opt.label}</span></span><span style="color:rgba(255,255,255,0.55)">${isAct?'✓':''}</span>`;
          row.onmouseenter=()=>{row.style.background='rgba(255,255,255,0.08)'};row.onmouseleave=()=>{row.style.background='none'};
          row.addEventListener('click',()=>{curViewMode=opt.key;document.getElementById('detailTrackList')?.classList.toggle('detail-compact-mode',curViewMode==='compact');panel.remove();listSortBtn.classList.remove('active');});
          panel.appendChild(row);
        });
        document.body.appendChild(panel);
        listSortBtn.classList.add('active');
        setTimeout(()=>{document.addEventListener('click',function _cl(e){if(!e.target.closest('#detailSortPanel')&&!e.target.closest('#detailListSortBtn')){panel.remove();listSortBtn.classList.remove('active');document.removeEventListener('click',_cl);}});},0);
      });
    }

    if (pushHistory) history.pushState({ view: 'playlist', type }, '');
    return;
  }
};

function showDetailView(type, name, pushHistory = true) {
  _hideAllMainPanels();
  detailView.style.display = 'flex';
  detailType = type;
  detailSortKey = null;
  detailSortDir = 1;

  let contextTracks = [];
  let coverUrl = null;
  let subtitle = '';

  if (type === 'album') {
    // Match by album name OR albumId for accuracy
    contextTracks = tracks.filter(t => t.album === name);
    // Sort by disc/track number if available, else original order
    contextTracks.sort((a, b) => (a.indexNumber || 0) - (b.indexNumber || 0) || a.title.localeCompare(b.title));
    coverUrl = contextTracks.find(t => t.imageUrl)?.imageUrl || null;
    subtitle = `Album · ${contextTracks[0]?.artist || ''}${contextTracks[0]?.year ? ' · ' + contextTracks[0].year : ''}`;
  } else if (type === 'artist') {
    contextTracks = tracks.filter(t => t.artists?.includes(name) || t.artist === name);
    coverUrl = contextTracks.find(t => t.imageUrl)?.imageUrl || null;
    subtitle = `Artiste · ${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''}`;
    // Bio will be loaded async after render
  } else if (type === 'year') {
    contextTracks = tracks.filter(t => String(t.year) === String(name));
    contextTracks.sort((a, b) => a.title.localeCompare(b.title));
    coverUrl = contextTracks.find(t => t.imageUrl)?.imageUrl || null;
    subtitle = `Année · ${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''}`;
  } else {
    contextTracks = tracks;
    subtitle = `${contextTracks.length} titres`;
  }

  detailContextTracks = [...contextTracks];
  const totalDuration = contextTracks.reduce((s, t) => s + t.duration, 0);
  const totalMin = Math.floor(totalDuration / 60);
  const totalH = Math.floor(totalMin / 60);
  const remainMin = totalMin % 60;
  const durationStr = totalH > 0 ? `${totalH} h ${remainMin} min` : `${totalMin} min`;

  const coverHtml = coverUrl
    ? `<img src="${coverUrl}" alt="${escapeHtml(name)}" class="detail-cover-img">`
    : `<div class="detail-cover-placeholder">${type === 'artist' ? escapeHtml(name.charAt(0).toUpperCase()) : type === 'year' ? `<span class="year-cover-label">${escapeHtml(name)}</span>` : '🎵'}</div>`;

  // Build header — matches the screenshot layout
  detailView.innerHTML = `
    <div class="detail-header"${type === 'artist' ? ' style="align-items:stretch"' : ''}>
      <div class="detail-cover ${type === 'artist' ? 'detail-cover-round' : ''}">${coverHtml}</div>
      <div class="detail-meta"${type === 'artist' ? ' style="display:flex;flex-direction:column;justify-content:flex-start"' : ''}>
        <div class="detail-type">${type === 'album' ? 'Album' : type === 'artist' ? 'Artiste' : type === 'year' ? 'Année' : 'Playlist publique'}</div>
        <h1 class="detail-title">${escapeHtml(name)}</h1>
        ${type !== 'artist' ? `<div class="detail-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="detail-stats">${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''} · ${durationStr}</div>
        ${type === 'artist' ? `<div class="detail-artist-bio" id="detailArtistBio" style="margin-top:10px;font-size:0.82rem;color:var(--text-subdued);line-height:1.6;display:none;flex:1;overflow:hidden"></div>` : ''}
      </div>
    </div>

    <div class="detail-controls-bar playlist-controls-bar">
      <div class="detail-controls-left">
        <button class="playlist-play-circle" id="detailPlayBtn" title="Lecture">
          <img src="pictures/icon-play.png" alt="▶" class="playlist-play-icon-img" id="detailPlayIcon">
          <img src="pictures/icon-pause.png" alt="⏸" class="playlist-play-icon-img" id="detailPauseIcon" style="display:none">
        </button>
        <button class="playlist-ctrl-btn" id="detailShuffleBtn" title="Lecture aléatoire">
          <img src="pictures/icon-shuffle.png" alt="" class="btn-icon">
        </button>
        <button class="detail-icon-btn ${type === 'album' || type === 'artist' ? (favoriteAlbums.has(name) || favoriteArtists.has(name) ? 'active liked' : '') : ''}" id="detailLikeBtn" title="Ajouter aux favoris">
          <img src="pictures/icon-heart.png" alt="" class="btn-icon" style="width:20px;height:20px">
        </button>
        <button class="detail-icon-btn" id="detailMoreBtn" title="Plus d'options">
          <span style="font-size:1.2rem;letter-spacing:1px;color:var(--text-subdued)">···</span>
        </button>
      </div>
      <div class="detail-controls-right">
        <div class="detail-search-wrap" id="detailSearchWrap">
          <button class="detail-search-toggle" id="detailSearchToggle" title="Rechercher">
            <img src="pictures/icon-search.png" alt="" class="btn-icon" style="width:18px;height:18px;">
          </button>
          <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
        </div>
        <button class="detail-list-sort-btn" id="detailListSortBtn" title="Trier et afficher">
          <img src="pictures/icon-list.png" alt="" class="btn-icon" style="width:18px;height:18px;">
        </button>
      </div>
          <button class="detail-icon-btn detail-sort-btn" id="detailSortBtn" title="Filtrer et afficher">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;flex-shrink:0">
              <line x1="4" y1="6"  x2="20" y2="6"/>
              <line x1="8" y1="12" x2="20" y2="12"/>
              <line x1="12" y1="18" x2="20" y2="18"/>
            </svg>
            <span class="detail-sort-label" id="detailSortLabel">Personnalisé</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="opacity:0.45;flex-shrink:0;transition:transform 0.2s ease" id="detailSortChevron">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="detail-tracks-header" id="detailTracksHeader">
      <span class="dth-num">#</span>
      <span class="dth-title dth-sortable" data-sort="title">Titre<span class="dth-sort-arrow">↕</span></span>
      ${type !== 'album' ? `<span class="dth-album dth-sortable" data-sort="album">Album<span class="dth-sort-arrow">↕</span></span>` : ''}
      <span class="dth-dateadded dth-sortable" data-sort="year">Date de parution<span class="dth-sort-arrow">↕</span></span>
      <span class="dth-dur dth-sortable" data-sort="duration" style="cursor:pointer;user-select:none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="dth-sort-arrow">↕</span>
      </span>
    </div>

    <div class="detail-tracks-list" id="detailTrackList"></div>
  `;

  // Render initial track list
  _renderDetailTracks(detailContextTracks, type);

  // ── Artist view: append grouped discography below track list ──────
  if (type === 'artist') {
    _renderArtistDiscography(detailView, name, contextTracks);


  }

  // ── Column header click-sort ──────────────────────────────────────
  document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (detailSortKey === key) {
        detailSortDir = -detailSortDir; // toggle direction
      } else {
        detailSortKey = key;
        detailSortDir = 1;
      }
      // Update arrow indicators
      document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        const arrow = h.querySelector('.dth-sort-arrow');
        if (arrow) arrow.textContent = '↕';
      });
      th.classList.add(detailSortDir === 1 ? 'sort-asc' : 'sort-desc');
      const arrow = th.querySelector('.dth-sort-arrow');
      if (arrow) arrow.textContent = detailSortDir === 1 ? '↑' : '↓';
      // Update dropdown label
      if (sortLabel) sortLabel.textContent = th.querySelector('.dth-sort-arrow')
        ? (th.textContent.replace(/[↕↑↓]/g,'').trim()) : th.textContent.trim();
      _sortAndRenderDetailTracks(type);
    });
  });

  // ── Search toggle ──────────────────────────────────────────────────
  const searchToggleEl = document.getElementById('detailSearchToggle');
  const searchInputEl  = document.getElementById('detailSearchInput');
  searchToggleEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = document.getElementById('detailSearchWrap');
    const isOpen = wrap?.classList.toggle('search-open');
    if (isOpen) { searchInputEl?.focus(); }
    else {
      if (searchInputEl) { searchInputEl.value = ''; _renderDetailTracks(detailContextTracks, type); }
    }
  });
  searchInputEl?.addEventListener('input', () => {
    const term = searchInputEl.value.trim().toLowerCase();
    if (!term) { _renderDetailTracks(detailContextTracks, type); return; }
    const filtered = detailContextTracks.filter(t =>
      t.title.toLowerCase().includes(term) ||
      (t.artists || [t.artist]).some(a => a.toLowerCase().includes(term)) ||
      t.album.toLowerCase().includes(term)
    );
    _renderDetailTracks(filtered, type);
  });

  // ── Sort / view-mode dropdown via icon-list.png button ─────────────
  const listSortBtnDV = document.getElementById('detailListSortBtn');
  const sortLabel     = null; // kept for compat
  let detailViewMode  = 'list';

  function _destroySortPanel() {
    document.getElementById('detailSortPanel')?.remove();
    listSortBtnDV?.classList.remove('active');
  }

  function _buildSortPanel() {
    _destroySortPanel();
    const rect = listSortBtnDV.getBoundingClientRect();

    const sortOpts = [
      { key: '',          label: 'Tri personnalisé' },
      { key: 'title',     label: 'Titre' },
      { key: 'artist',    label: 'Artiste' },
      ...(type !== 'album' ? [{ key: 'album', label: 'Album' }] : []),
      { key: 'year',      label: 'Date de parution' },
      { key: 'dateAdded', label: 'Ajouté récemment' },
      { key: 'duration',  label: 'Durée' },
    ];
    const viewOpts = [
      { key: 'compact', label: 'Compact',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/></svg>` },
      { key: 'list',    label: 'Liste',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>` },
    ];

    const panel = document.createElement('div');
    panel.id = 'detailSortPanel';
    panel.style.cssText = [
      `position:fixed`,
      `top:${rect.bottom + 6}px`,
      `right:${window.innerWidth - rect.right}px`,
      `z-index:99999`,
      `min-width:220px`,
      `background:#1c1c1c`,
      `border:1px solid rgba(255,255,255,0.13)`,
      `border-radius:10px`,
      `padding:6px 0`,
      `box-shadow:0 20px 60px rgba(0,0,0,0.85),0 4px 16px rgba(0,0,0,0.6)`,
      `transform-origin:top center`,
      `animation:dspSlideDown 0.18s cubic-bezier(0.4,0,0.2,1) both`,
      `overflow:hidden`,
    ].join(';');

    // ── Section: Trier par ──
    const hSort = document.createElement('div');
    hSort.style.cssText = 'padding:8px 16px 4px;font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4)';
    hSort.textContent = 'Trier par';
    panel.appendChild(hSort);

    sortOpts.forEach(opt => {
      const row = document.createElement('button');
      const isActive = detailSortKey === (opt.key || null) || (!detailSortKey && opt.key === '');
      const showArrow = isActive && opt.key !== '';
      row.style.cssText = [
        'display:flex','align-items:center','justify-content:space-between',
        'width:100%','padding:10px 16px','background:none','border:none',
        'color:' + (isActive ? '#fff' : 'rgba(255,255,255,0.75)'),
        'font-family:inherit','font-size:0.88rem','font-weight:' + (isActive ? '600' : '400'),
        'cursor:pointer','text-align:left','gap:8px',
        'transition:background 0.1s ease',
      ].join(';');
      row.innerHTML = `<span>${opt.label}</span><span style="color:rgba(255,255,255,0.55);font-size:0.8rem">${isActive && detailSortDir === -1 ? '↓' : isActive && opt.key ? '↑' : ''}</span>`;
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.08)'; };
      row.onmouseleave = () => { row.style.background = 'none'; };
      row.addEventListener('click', () => {
        if (detailSortKey === (opt.key || null) && opt.key) {
          detailSortDir = -detailSortDir;
        } else {
          detailSortKey = opt.key || null;
          detailSortDir = 1;
        }
        if (sortLabel) sortLabel.textContent = opt.label;
        _sortAndRenderDetailTracks(type);
        _destroySortPanel();
        // Sync column header arrows
        document.querySelectorAll('#detailTracksHeader .dth-sortable').forEach(h => {
          const matches = h.dataset.sort === detailSortKey;
          h.classList.toggle('sort-asc',  matches && detailSortDir === 1);
          h.classList.toggle('sort-desc', matches && detailSortDir === -1);
          const arrow = h.querySelector('.dth-sort-arrow');
          if (arrow) arrow.textContent = matches ? (detailSortDir === 1 ? '↑' : '↓') : '↕';
        });
      });
      panel.appendChild(row);
    });

    // ── Divider ──
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
    panel.appendChild(div);

    // ── Section: Mode d'affichage ──
    const hView = document.createElement('div');
    hView.style.cssText = 'padding:8px 16px 4px;font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4)';
    hView.textContent = "Mode d'affichage";
    panel.appendChild(hView);

    viewOpts.forEach(opt => {
      const isActive = detailViewMode === opt.key;
      const row = document.createElement('button');
      row.style.cssText = [
        'display:flex','align-items:center','justify-content:space-between',
        'width:100%','padding:10px 16px','background:none','border:none',
        'color:' + (isActive ? '#fff' : 'rgba(255,255,255,0.75)'),
        'font-family:inherit','font-size:0.88rem','font-weight:' + (isActive ? '600' : '400'),
        'cursor:pointer','text-align:left','gap:8px',
        'transition:background 0.1s ease',
      ].join(';');
      row.innerHTML = `<span style="display:flex;align-items:center;gap:10px">${opt.icon}<span>${opt.label}</span></span><span style="color:rgba(255,255,255,0.55)">${isActive ? '✓' : ''}</span>`;
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.08)'; };
      row.onmouseleave = () => { row.style.background = 'none'; };
      row.addEventListener('click', () => {
        detailViewMode = opt.key;
        const list = document.getElementById('detailTrackList');
        if (list) list.classList.toggle('detail-compact-mode', detailViewMode === 'compact');
        _destroySortPanel();
        _buildSortPanel(); // rebuild to refresh checkmarks
      });
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    listSortBtnDV?.classList.add('active');

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function _close(e) {
        if (!e.target.closest('#detailSortPanel') && !e.target.closest('#detailListSortBtn')) {
          _destroySortPanel();
          document.removeEventListener('click', _close);
        }
      });
    }, 0);
  }

  listSortBtnDV?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.getElementById('detailSortPanel')) {
      _destroySortPanel();
    } else {
      _buildSortPanel();
    }
  });

  // ── Play button : toggle play/pause avec sync icônes ─────────────
  function _syncDetailPlayIcon() {
    const ctxIndices = detailContextTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
    const ctxSet = new Set(ctxIndices);
    const thisIsActive = Array.isArray(window._playContext)
      && window._playContext.length === ctxIndices.length
      && window._playContext.every(i => ctxSet.has(i))
      && ctxSet.has(currentIndex);
    const isPlaying = thisIsActive && !audioPlayer.paused;
    const pi = document.getElementById('detailPlayIcon');
    const pa = document.getElementById('detailPauseIcon');
    if (pi) pi.style.display  = isPlaying ? 'none' : '';
    if (pa) pa.style.display = isPlaying ? '' : 'none';
  }
  if (audioPlayer._syncDetailPlayIcon) {
    audioPlayer.removeEventListener('play',  audioPlayer._syncDetailPlayIcon);
    audioPlayer.removeEventListener('pause', audioPlayer._syncDetailPlayIcon);
  }
  audioPlayer._syncDetailPlayIcon = _syncDetailPlayIcon;
  audioPlayer.addEventListener('play',  _syncDetailPlayIcon);
  audioPlayer.addEventListener('pause', _syncDetailPlayIcon);
  _syncDetailPlayIcon();

  document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
    if (!detailContextTracks.length) return;
    const ctxIndices = detailContextTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
    const ctxSet = new Set(ctxIndices);
    const thisIsActive = Array.isArray(window._playContext)
      && window._playContext.length === ctxIndices.length
      && window._playContext.every(i => ctxSet.has(i))
      && ctxSet.has(currentIndex);
    if (thisIsActive && !audioPlayer.paused) {
      audioPlayer.pause();
    } else if (thisIsActive && audioPlayer.paused) {
      audioPlayer.play().catch(console.error);
    } else {
      // Démarrer depuis le début (séquentiel)
      isShuffled = false;
      shuffleBtn.classList.remove('active');
      window._playContext = ctxIndices.length ? ctxIndices : null;
      shuffleOrder = [...ctxIndices];
      window._currentRpContextName = name;
      const _ctxElDV = document.getElementById('rpContextName');
      if (_ctxElDV) _ctxElDV.textContent = name;
      if (ctxIndices.length) { currentIndex = ctxIndices[0]; playCurrentTrack(); }
    }
  });

  // Shuffle button — mélange uniquement dans le contexte de la vue
  document.getElementById('detailShuffleBtn')?.addEventListener('click', () => {
    isShuffled = true;
    shuffleBtn.classList.add('active');
    const ctxIndices = detailContextTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
    window._playContext = ctxIndices.length ? ctxIndices : null;
    window._currentRpContextName = name;
    const _ctxElDVS = document.getElementById('rpContextName');
    if (_ctxElDVS) _ctxElDVS.textContent = name;
    if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      } else {
        shuffleOrder = [...ctxIndices].sort(() => Math.random() - 0.5);
      }
    if (shuffleOrder.length) { currentIndex = shuffleOrder[0]; playCurrentTrack(); }
  });

  // Like / favourite button
  const likeBtn2 = document.getElementById('detailLikeBtn');
  likeBtn2?.addEventListener('click', () => {
    if (type === 'album') {
      const adding = !favoriteAlbums.has(name);
      if (favoriteAlbums.has(name)) favoriteAlbums.delete(name);
      else favoriteAlbums.add(name);
      likeBtn2.classList.toggle('liked', favoriteAlbums.has(name));
      showToast(adding ? `♥ Album ajouté aux favoris` : `♡ Album retiré des favoris`, adding ? 'success' : 'default');
    } else if (type === 'artist') {
      const adding = !favoriteArtists.has(name);
      if (favoriteArtists.has(name)) favoriteArtists.delete(name);
      else favoriteArtists.add(name);
      likeBtn2.classList.toggle('liked', favoriteArtists.has(name));
      showToast(adding ? `♥ Artiste ajouté aux favoris` : `♡ Artiste retiré des favoris`, adding ? 'success' : 'default');
    }
    
    // ── Firebase Sync : sauvegarder les favoris ──
    if (window.FirebaseSync?.syncToFirestore) {
      window.FirebaseSync.syncToFirestore();
    }
  });

  // More options button — show a simple context menu
  document.getElementById('detailMoreBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Remove existing menu if open
    document.getElementById('detailContextMenu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'detailContextMenu';
    menu.style.cssText = `position:fixed;background:var(--bg-elevated);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 0;z-index:9999;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,0.6)`;
    const menuItems = [
      { label: 'Lire depuis le début', action: () => { const fi = tracks.indexOf(detailContextTracks[0]); if (fi !== -1) { currentIndex = fi; playCurrentTrack(); } } },
      { label: 'Ajouter à la file d\'attente', action: () => { /* queue functionality */ } },
      { label: 'Copier le lien', action: () => navigator.clipboard?.writeText(window.location.href).catch(()=>{}) },
    ];
    menuItems.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:var(--text-base);font-family:inherit;font-size:0.88rem;cursor:pointer;';
      btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.08)';
      btn.onmouseleave = () => btn.style.background = 'none';
      btn.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(btn);
    });
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  });

  // ── Bio artiste dans le header (async Last.fm) ───────────────────
  if (type === 'artist') {
    const bioEl = document.getElementById('detailArtistBio');
    if (bioEl) {
      fetchLastFmArtist(name, null).then(la => {
        const bio = la?.bio?.summary
          ?.replace(/<a [^>]+>.*?<\/a>/g, '')
          .replace(/<[^>]+>/g, '')
          .trim();
        if (!bio || bio.length < 20) return;
        bioEl.textContent = bio;
        bioEl.style.display = '';
      }).catch(() => {});
    }
  }

  detailView.scrollTop = 0;
  if (pushHistory) pushNavState('detail', { type, name });
}

function _sortAndRenderDetailTracks(type) {
  let sorted = [...detailContextTracks];
  if (detailSortKey) {
    sorted.sort((a, b) => {
      let va, vb;
      switch (detailSortKey) {
        case 'title':     va = a.title?.toLowerCase()  || ''; vb = b.title?.toLowerCase()  || ''; break;
        case 'artist':    va = a.artist?.toLowerCase() || ''; vb = b.artist?.toLowerCase() || ''; break;
        case 'album':     va = a.album?.toLowerCase()  || ''; vb = b.album?.toLowerCase()  || ''; break;
        case 'year':      va = a.year || 0;                   vb = b.year || 0;                   break;
        case 'dateAdded': va = a.dateAdded || '';             vb = b.dateAdded || '';             break;
        case 'duration':  va = a.duration || 0;              vb = b.duration || 0;               break;
        default:          return 0;
      }
      if (va < vb) return -detailSortDir;
      if (va > vb) return  detailSortDir;
      return 0;
    });
  }
  _renderDetailTracks(sorted, type);
}

function _renderDetailTracks(list, type) {
  const container = document.getElementById('detailTrackList');
  if (!container) return;
  const activeId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;

  // Adjust the header grid to match column count
  const header = document.getElementById('detailTracksHeader');
  const hasAlbum = type !== 'album';
  const colDef = hasAlbum
    ? '36px 46px 1fr 200px 110px 60px 72px'
    : '36px 46px 1fr 110px 60px 72px';
  if (header) header.style.gridTemplateColumns = colDef;

  container.innerHTML = list.map((t, i) => {
    const globalIdx = tracks.indexOf(t);
    const isPlaying = t.id === activeId;
    let dateStr = '—';
    if (t.premiereDate) {
      try {
        const d = new Date(t.premiereDate);
        if (!isNaN(d)) dateStr = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch {}
    } else if (t.year) {
      dateStr = String(t.year);
    }
    return `
      <div class="detail-track-row ${isPlaying ? 'playing' : ''}"
           data-id="${t.id}" data-idx="${globalIdx}"
           style="grid-template-columns:${colDef}">
        <span class="dtr-num">${isPlaying ? '<img src="pictures/equaliser-animated-white.gif" alt="▶" class="dtr-equalizer-gif">' : i + 1}</span>
        <div class="dtr-art">
          ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" alt="">` : `<div class="dtr-art-placeholder">🎵</div>`}
          <div class="dtr-play-overlay" data-track-id="${t.id}">
            <img src="${isPlaying ? 'pictures/icon-pause.png' : 'pictures/icon-play.png'}" alt="" class="dtr-overlay-icon">
          </div>
        </div>
        <div class="dtr-meta">
          <div class="dtr-title">${escapeHtml(t.title)}</div>
          <div class="dtr-artist">
            ${(t.artists && t.artists.length > 1
              ? t.artists.map(a => `<span class="nav-link" data-nav="artist" data-name="${escapeHtml(a)}">${escapeHtml(a)}</span>`).join(', ')
              : `<span class="nav-link" data-nav="artist" data-name="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span>`
            )}
          </div>
        </div>
        ${hasAlbum ? `<div class="dtr-album"><span class="nav-link" data-nav="album" data-name="${escapeHtml(t.album)}">${escapeHtml(t.album)}</span></div>` : ''}
        <div class="dtr-dateadded">${dateStr}</div>
        <div class="dtr-dur">${formatTime(t.duration)}</div>
        <div class="dtr-actions">
          <button class="dtr-btn dtr-etc" title="Plus d'options" data-id="${t.id}">
            <img src="pictures/Etc.png" alt="…">
          </button>
          <button class="dtr-btn dtr-plus" title="Ajouter à une playlist" data-id="${t.id}">
            <img src="pictures/plus.png" alt="+">
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.detail-track-row').forEach(el => {
    el.addEventListener('click', (e) => {
      // If clicking a nav-link (artist or album), navigate instead of playing
      const link = e.target.closest('.nav-link');
      if (link) {
        e.stopPropagation();
        showDetailView(link.dataset.nav, link.dataset.name);
        return;
      }
      if (e.target.closest('.dtr-btn')) return;
      if (e.target.closest('.dtr-play-overlay')) return; // handled separately
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) {
        // Toujours remplacer le contexte de lecture par celui de la vue courante
        // (artiste, album…) — ne jamais hériter d'une playlist précédente.
        const ctxI = detailContextTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
        window._playContext = ctxI.length > 1 ? ctxI : null;
        window._currentRpContextName = name;
        const _ctxEl = document.getElementById('rpContextName');
        if (_ctxEl) _ctxEl.textContent = name;
        currentIndex = idx;
        playCurrentTrack();
      }
    });
  });

  // dtr-play-overlay: pause if playing, play if not
  container.querySelectorAll('.dtr-play-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = overlay.closest('.detail-track-row');
      const idx = parseInt(row?.dataset.idx);
      if (isNaN(idx)) return;
      // Toujours remplacer le contexte par celui de la vue courante
      const ctxI = detailContextTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      window._playContext = ctxI.length > 1 ? ctxI : null;
      window._currentRpContextName = name;
      const _ctxEl = document.getElementById('rpContextName');
      if (_ctxEl) _ctxEl.textContent = name;
      if (currentIndex === idx && !audioPlayer.paused) {
        audioPlayer.pause();
      } else {
        currentIndex = idx;
        playCurrentTrack();
      }
    });
  });

  // Sync overlay icon on audio state changes
  function _syncDtrOverlays() {
    container.querySelectorAll('.detail-track-row').forEach(row => {
      const isActive = parseInt(row.dataset.idx) === currentIndex;
      const overlay = row.querySelector('.dtr-play-overlay');
      const icon    = overlay?.querySelector('.dtr-overlay-icon');
      if (!overlay || !icon) return;
      if (isActive) {
        icon.src = audioPlayer.paused ? 'pictures/icon-play.png' : 'pictures/icon-pause.png';
      } else {
        icon.src = 'pictures/icon-play.png';
      }
    });
  }
  audioPlayer.addEventListener('play',  _syncDtrOverlays);
  audioPlayer.addEventListener('pause', _syncDtrOverlays);

  // Etc button in track rows
  container.querySelectorAll('.dtr-etc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const track = tracks.find(t => t.id === btn.dataset.id);
      if (track) showTrackContextMenu(e, track);
    });
  });

  // Plus button in track rows
  container.querySelectorAll('.dtr-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const track = tracks.find(t => t.id === btn.dataset.id);
      if (track) showAddToPlaylistPopup(e, track);
    });
  });

  highlightActiveTrack();
}

function hideDetailView() {
  detailView.style.display = 'none';
  welcomeContent.style.display = 'flex';
}

// ── Artist discography: grouped albums grid ────────────────────────
function _renderArtistDiscography(container, artistName, artistTracks) {
  // Build album map from artist's tracks
  const albumMap = new Map();
  artistTracks.forEach(t => {
    if (!albumMap.has(t.album)) {
      albumMap.set(t.album, {
        name:     t.album,
        year:     t.year || '',
        imageUrl: t.imageUrl,
        count:    0,
      });
    }
    const a = albumMap.get(t.album);
    a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
  });

  const albums = [...albumMap.values()].sort((a, b) => {
    if (a.year && b.year) return (b.year || 0) - (a.year || 0);
    return a.name.localeCompare(b.name);
  });

  if (!albums.length) return;

  const chevronL = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const chevronR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  const section = document.createElement('div');
  section.className = 'artist-albums-section';
  section.innerHTML = `
    <h2 class="artist-albums-title">Discographie</h2>
    <div class="carousel-wrapper at-start" id="discogCarouselWrapper">
      <button class="carousel-arrow arrow-prev artist-carousel-prev" aria-label="Précédent">${chevronL}</button>
      <div class="home-row-scroll" id="discogCarouselRow">
        ${albums.map(al => `
          <div class="home-card" data-album="${escapeHtml(al.name)}">
            <div class="home-card-art">
              ${al.imageUrl
                ? `<img src="${al.imageUrl}" loading="lazy" alt="">`
                : `<div class="home-card-art-placeholder">💿</div>`}
              <button class="home-card-play-btn" data-album="${escapeHtml(al.name)}"></button>
            </div>
            <div class="home-card-title">${escapeHtml(al.name)}</div>
            <div class="home-card-sub">${al.year ? al.year + ' · ' : ''}${al.count} titre${al.count > 1 ? 's' : ''}</div>
          </div>
        `).join('')}
      </div>
      <button class="carousel-arrow arrow-next artist-carousel-next" aria-label="Suivant">${chevronR}</button>
    </div>
  `;

  // Album card click → navigate to album
  section.querySelectorAll('.home-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.home-card-play-btn')) return;
      showDetailView('album', card.dataset.album);
    });
  });

  // Play button on album card
  section.querySelectorAll('.home-card-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumTracks = tracks.filter(t => t.album === btn.dataset.album);
      if (!albumTracks.length) return;
      const firstIdx = tracks.indexOf(albumTracks[0]);
      if (firstIdx !== -1) { currentIndex = firstIdx; playCurrentTrack(); }
    });
  });

  container.appendChild(section);

  // Sync arrow visibility once the row is in the DOM
  requestAnimationFrame(() => {
    const row     = section.querySelector('.home-row-scroll');
    const wrapper = section.querySelector('.carousel-wrapper');
    if (!row || !wrapper) return;
    const syncArrows = () => {
      wrapper.classList.toggle('at-start', row.scrollLeft <= 4);
      wrapper.classList.toggle('at-end',   row.scrollLeft >= row.scrollWidth - row.clientWidth - 4);
    };
    row.addEventListener('scroll', syncArrows, { passive: true });
    syncArrows();
  });
}

// ══════════════════════════════════════════════════════════════════
//  SEARCH RESULTS PAGE
// ══════════════════════════════════════════════════════════════════

function showSearchResultsPage(query, pushHistory = true) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  const lc = q.toLowerCase();

  _hideAllMainPanels();
  searchResultsPage.style.display = 'flex';

  const matched = tracks.filter(t =>
    t.title.toLowerCase().includes(lc) ||
    t.artist.toLowerCase().includes(lc) ||
    t.album.toLowerCase().includes(lc)
  );

  // Group results
  const artistMap = new Map();
  const albumMap  = new Map();
  const trackResults = matched.slice(0, 50);

  matched.forEach(t => {
    if (t.artist.toLowerCase().includes(lc) && !artistMap.has(t.artist))
      artistMap.set(t.artist, { name: t.artist, imageUrl: t.imageUrl, count: tracks.filter(x => x.artist === t.artist).length });
    if (t.album.toLowerCase().includes(lc) && !albumMap.has(t.album))
      albumMap.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl });
  });

  const artists = [...artistMap.values()].slice(0, 6);
  const albums  = [...albumMap.values()].slice(0, 6);

  searchResultsPage.innerHTML = `
    <div class="srp-header">
      <h1 class="srp-title">Résultats pour <span class="srp-query">« ${escapeHtml(q)} »</span></h1>
      <div class="srp-count">${matched.length} résultat${matched.length !== 1 ? 's' : ''}</div>
    </div>

    ${artists.length ? `
    <div class="srp-section">
      <h2 class="srp-section-title">Artistes</h2>
      <div class="srp-artists-grid">
        ${artists.map(a => `
          <div class="srp-artist-card" data-artist="${escapeHtml(a.name)}">
            <div class="srp-artist-avatar" style="background:${a.imageUrl ? 'var(--bg-tinted)' : artistGradient(a.name)}">
              ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" alt="">` : `<span class="srp-artist-letter">${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
            </div>
            <div class="srp-artist-name">${highlightMatch(a.name, lc)}</div>
            <div class="srp-artist-sub">${a.count} titre${a.count > 1 ? 's' : ''}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${albums.length ? `
    <div class="srp-section">
      <h2 class="srp-section-title">Albums</h2>
      <div class="srp-albums-grid">
        ${albums.map(al => `
          <div class="srp-album-card" data-album="${escapeHtml(al.name)}">
            <div class="srp-album-art">
              ${al.imageUrl ? `<img src="${al.imageUrl}" loading="lazy" alt="">` : `<div class="srp-art-placeholder">💿</div>`}
              <div class="srp-card-play-btn"></div>
            </div>
            <div class="srp-album-title">${highlightMatch(al.name, lc)}</div>
            <div class="srp-album-sub">${escapeHtml(al.artist)}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="srp-section">
      <h2 class="srp-section-title">Titres <span class="srp-badge">${trackResults.length}${matched.length > 50 ? '+' : ''}</span></h2>
      <div class="srp-tracks-header">
        <span class="srp-th-num">#</span>
        <span class="srp-th-title">Titre</span>
        <span class="srp-th-album">Album</span>
        <span class="srp-th-dur">
          <img src="pictures/icon-queue.png" alt="" style="width:13px;height:13px;opacity:0.5">
        </span>
      </div>
      <div class="srp-tracks-list">
        ${trackResults.map((t, i) => `
          <div class="srp-track-row" data-id="${t.id}" data-idx="${tracks.indexOf(t)}">
            <span class="srp-tr-num">${i + 1}</span>
            <div class="srp-tr-art">
              ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" alt="">` : `<div class="srp-art-mini">🎵</div>`}
              <div class="srp-tr-play-overlay"></div>
            </div>
            <div class="srp-tr-meta">
              <div class="srp-tr-title">${highlightMatch(t.title, lc)}</div>
              <div class="srp-tr-artist"><span class="nav-link" data-nav="artist" data-name="${escapeHtml(t.artist)}">${(t.artists && t.artists.length > 1 ? t.artists.map(a => highlightMatch(a, lc)).join(', ') : highlightMatch(t.artist, lc))}</span></div>
            </div>
            <div class="srp-tr-album"><span class="nav-link" data-nav="album" data-name="${escapeHtml(t.album)}">${highlightMatch(t.album, lc)}</span></div>
            <div class="srp-tr-dur">${formatTime(t.duration)}</div>
          </div>`).join('')}
      </div>
    </div>
  `;

  // Artist cards
  searchResultsPage.querySelectorAll('.srp-artist-card').forEach(el => {
    el.addEventListener('click', () => showDetailView('artist', el.dataset.artist));
  });
  // Album cards
  searchResultsPage.querySelectorAll('.srp-album-card').forEach(el => {
    el.addEventListener('click', () => showDetailView('album', el.dataset.album));
  });
  // Track rows
  searchResultsPage.querySelectorAll('.srp-track-row').forEach(el => {
    el.addEventListener('click', (e) => {
      const link = e.target.closest('.nav-link');
      if (link) { e.stopPropagation(); showDetailView(link.dataset.nav, link.dataset.name); return; }
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) { currentIndex = idx; playCurrentTrack(); }
    });
  });

  searchResultsPage.scrollTop = 0;
  if (pushHistory) pushNavState('search', { query: q });
}
async function fetchExtendedInfo(track) {
  if (!extendedInfoEl) return;
  if (extendedInfoAbort) extendedInfoAbort.abort();
  extendedInfoAbort = new AbortController();
  const signal = extendedInfoAbort.signal;

  extendedInfoEl.innerHTML = `<div class="track-info-section"><div class="info-loading"><div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div><span>Chargement…</span></div></div>`;

  try {
    const [lfmTrack, lfmArtist] = await Promise.allSettled([
      fetchLastFmTrack(track.title, track.artist, signal),
      fetchLastFmArtist(track.artist, signal),
    ]);
    if (signal.aborted) return;

    let html = '';
    const lt = lfmTrack.value;
    if (lt) {
      const plays     = lt.playcount ? formatBigNumber(parseInt(lt.playcount)) : null;
      const listeners = lt.listeners ? formatBigNumber(parseInt(lt.listeners)) : null;
      const tags      = lt.toptags?.tag?.slice(0, 6) || [];
      const summary   = lt.wiki?.summary?.replace(/<a [^>]+>.*?<\/a>/g,'').replace(/<[^>]+>/g,'').trim();
      if (plays || listeners || tags.length) {
        html += `<div class="track-info-section"><div class="info-section-title">📊 Statistiques</div>`;
        if (plays || listeners) {
          html += `<div class="info-stat-row">
            ${plays ? `<div class="info-stat"><div class="info-stat-value">${plays}</div><div class="info-stat-label">Écoutes</div></div>` : ''}
            ${listeners ? `<div class="info-stat"><div class="info-stat-value">${listeners}</div><div class="info-stat-label">Auditeurs</div></div>` : ''}
          </div>`;
          if (plays) {
            const pct = Math.min(100, Math.round(parseInt(lt.playcount) / 5_000_000 * 100));
            html += `<div class="info-playcount-bar"><div class="info-playcount-fill" id="pcFill" style="width:0%"></div></div>`;
            setTimeout(() => { const el = extendedInfoEl?.querySelector('#pcFill'); if (el) el.style.width = pct + '%'; }, 100);
          }
        }
        if (tags.length) html += `<div class="info-tags" style="margin-top:10px">${tags.map((t,i)=>`<span class="info-tag" style="animation-delay:${i*0.05}s">${escapeHtml(t.name)}</span>`).join('')}</div>`;
        html += `</div>`;
      }
      if (summary && summary.length > 30) {
        const id = 'bio-' + Date.now();
        html += `<div class="track-info-section"><div class="info-section-title">📖 À propos</div>
          <div class="info-bio" id="${id}">${escapeHtml(summary.slice(0, 350))}${summary.length > 350 ? '…' : ''}</div>
          ${summary.length > 350 ? `<span class="info-bio-toggle" data-target="${id}" data-full="${escapeHtml(summary)}">Lire plus ↓</span>` : ''}</div>`;
      }
    }
    const la = lfmArtist.value;
    if (la) {
      const similar = la.similar?.artist?.slice(0, 4) || [];
      const bio = la.bio?.summary?.replace(/<a [^>]+>.*?<\/a>/g,'').replace(/<[^>]+>/g,'').trim();
      const artListeners = la.stats?.listeners ? formatBigNumber(parseInt(la.stats.listeners)) : null;
      if (artListeners || bio || similar.length) {
        html += `<div class="track-info-section"><div class="info-section-title">🎤 Artiste${artListeners ? ` · ${artListeners} auditeurs` : ''}</div>`;
        if (bio && bio.length > 30) {
          const id2 = 'abio-' + Date.now();
          html += `<div class="info-bio" id="${id2}">${escapeHtml(bio.slice(0, 280))}…</div>
            <span class="info-bio-toggle" data-target="${id2}" data-full="${escapeHtml(bio)}">Lire plus ↓</span>`;
        }
        if (similar.length) {
          html += `<div style="margin-top:10px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-subdued);margin-bottom:6px">Artistes similaires</div>
            <div class="info-tags">${similar.map((a,i)=>`<span class="info-tag" style="animation-delay:${i*0.06}s">${escapeHtml(a.name)}</span>`).join('')}</div>`;
        }
        html += `</div>`;
        const simTracks = await fetchLastFmSimilar(track.title, track.artist, signal);
        if (!signal.aborted && simTracks?.length) {
          html += `<div class="track-info-section"><div class="info-section-title">🎵 Titres similaires</div>
            <div class="info-similar-tracks">
              ${simTracks.slice(0,4).map((st,i) => {
                const localMatch = tracks.find(t => t.title.toLowerCase().includes(st.name.toLowerCase().slice(0,8)) && t.artist.toLowerCase().includes(st.artist?.name?.toLowerCase()?.slice(0,5)||''));
                return `<div class="info-similar-item" style="animation-delay:${i*0.07}s" data-id="${localMatch?localMatch.id:''}" data-play="${localMatch?'1':'0'}">
                  <div class="info-similar-art">${localMatch?.imageUrl ? `<img src="${localMatch.imageUrl}" alt="" loading="lazy">` : '🎵'}</div>
                  <div class="info-similar-meta">
                    <div class="info-similar-title">${escapeHtml(st.name)}</div>
                    <div class="info-similar-artist">${escapeHtml(st.artist?.name||'')}</div>
                  </div>
                  ${localMatch ? `<span style="font-size:0.68rem;color:var(--green);font-weight:700">▶</span>` : ''}
                </div>`;
              }).join('')}
            </div></div>`;
        }
      }
    }
    if (!html) html = `<div class="track-info-section"><div class="info-loading"><span>Aucune information disponible</span></div></div>`;
    if (!signal.aborted) {
      extendedInfoEl.innerHTML = html;
      extendedInfoEl.querySelectorAll('.info-bio-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = document.getElementById(btn.dataset.target);
          const full = btn.dataset.full;
          if (!target) return;
          if (target.classList.contains('expanded')) { target.classList.remove('expanded'); target.textContent = escapeHtml(full.slice(0, 280)) + '…'; btn.textContent = 'Lire plus ↓'; }
          else { target.classList.add('expanded'); target.textContent = full; btn.textContent = 'Réduire ↑'; }
        });
      });
      extendedInfoEl.querySelectorAll('.info-similar-item[data-play="1"]').forEach(el => {
        el.addEventListener('click', () => {
          const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
          if (idx !== -1) { currentIndex = idx; playCurrentTrack(); }
        });
      });
    }
  } catch (err) {
    if (!signal?.aborted) { extendedInfoEl.innerHTML = ''; console.warn('Extended info error:', err); }
  }
}

async function fetchLastFmTrack(title, artist, signal) {
  try {
    const r = await fetch(lastfmUrl(`method=track.getInfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&autocorrect=1`), { signal });
    if (!r.ok) return null;
    return (await r.json()).track || null;
  } catch { return null; }
}
async function fetchLastFmArtist(artist, signal) {
  try {
    const r = await fetch(lastfmUrl(`method=artist.getInfo&artist=${encodeURIComponent(artist)}&autocorrect=1`), { signal });
    if (!r.ok) return null;
    return (await r.json()).artist || null;
  } catch { return null; }
}
async function fetchLastFmSimilar(title, artist, signal) {
  try {
    const r = await fetch(lastfmUrl(`method=track.getSimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&limit=6&autocorrect=1`), { signal });
    if (!r.ok) return null;
    return (await r.json()).similartracks?.track || null;
  } catch { return null; }
}
function formatBigNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

// ── Nav-link-inline click delegation (player bar + right panel) ─────
document.addEventListener('click', e => {
  const link = e.target.closest('.nav-link-inline');
  if (!link) return;
  e.stopPropagation();
  showDetailView(link.dataset.nav, link.dataset.name);
});

// ── Keyboard shortcuts ─────────────────────────────────────────────
// Utilise e.code (touche physique) pour être agnostique vis-à-vis
// de la disposition clavier (AZERTY, QWERTY, QWERTZ, etc.)

// ── Détection automatique AZERTY ─────────────────────────────────
const _IS_AZERTY = /^fr\b/.test(navigator.language || navigator.languages?.[0] || '');

// Table de correspondance code physique → label affiché selon disposition
const _CODE_LABEL = {
  'KeyQ': _IS_AZERTY ? 'A' : 'Q',
  'KeyA': _IS_AZERTY ? 'Q' : 'A',
  'KeyW': _IS_AZERTY ? 'Z' : 'W',
  'KeyZ': _IS_AZERTY ? 'W' : 'Z',
};
function _keyLabel(code) {
  if (_CODE_LABEL[code]) return _CODE_LABEL[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}

const _SHORTCUTS = [
  // Lecture
  { section: 'Lecture',  label: 'Lecture / Pause',         code: 'Space',      display: [['Espace']] },
  { section: 'Lecture',  label: 'Piste suivante',           code: 'KeyN',       display: [[_keyLabel('KeyN')]] },
  { section: 'Lecture',  label: 'Piste précédente',         code: 'KeyB',       display: [[_keyLabel('KeyB')]] },
  { section: 'Lecture',  label: 'Avancer de 5 secondes',    code: 'ArrowRight', display: [['→']] },
  { section: 'Lecture',  label: 'Reculer de 5 secondes',    code: 'ArrowLeft',  display: [['←']] },
  { section: 'Lecture',  label: 'Aléatoire',                code: 'KeyS',       display: [[_keyLabel('KeyS')]] },
  { section: 'Lecture',  label: 'Répétition',               code: 'KeyR',       display: [[_keyLabel('KeyR')]] },
  // Volume
  { section: 'Volume',   label: 'Volume +5%',               code: 'ArrowUp',    display: [['↑']] },
  { section: 'Volume',   label: 'Volume -5%',               code: 'ArrowDown',  display: [['↓']] },
  { section: 'Volume',   label: 'Muet / Son',               code: 'KeyM',       display: [[_keyLabel('KeyM')]] },
  // Interface
  { section: 'Interface',label: 'Paroles',                  code: 'KeyL',       display: [[_keyLabel('KeyL')]] },
  { section: 'Interface',label: 'File d\'attente',          code: 'KeyQ',       display: [[_keyLabel('KeyQ')]] },
  { section: 'Interface',label: 'Plein écran / Immersif',   code: 'KeyF',       display: [[_keyLabel('KeyF')]] },
  { section: 'Interface',label: 'Accueil',                  code: 'KeyH',       display: [[_keyLabel('KeyH')]] },
  { section: 'Interface',label: 'Paramètres',               code: 'KeyP',       display: [[_keyLabel('KeyP')]] },
  { section: 'Interface',label: 'Recherche',                code: 'Slash',      display: [['/', 'Ctrl'], ['/', '⌘']] },
  // Power User — nouveaux raccourcis
  { section: 'Power User', label: 'Palette de commandes',   code: 'KeyK',       display: [['Ctrl', _keyLabel('KeyK')], ['⌘', _keyLabel('KeyK')]] },
  { section: 'Power User', label: 'Centrer sur la piste en cours', code: 'KeyC', display: [[_keyLabel('KeyC')]] },
  { section: 'Power User', label: 'Liker le morceau',       code: 'ShiftL',     display: [['Maj', _keyLabel('KeyL')]] },
  { section: 'Power User', label: 'Ajouter à une playlist', code: 'ShiftP',     display: [['Maj', _keyLabel('KeyP')]] },
  { section: 'Power User', label: 'Mini-player / Mode compact', code: 'KeyI',   display: [[_keyLabel('KeyI')]] },
  { section: 'Power User', label: 'Naviguer dans la file (bas)', code: 'KeyJ',  display: [[_keyLabel('KeyJ')]] },
  { section: 'Power User', label: 'Naviguer dans la file (haut)', code: 'KeyK2', display: [[_keyLabel('KeyK')]] },
  { section: 'Power User', label: 'Focus Sidebar',          code: 'Digit1',     display: [['1']] },
  { section: 'Power User', label: 'Focus Contenu principal', code: 'Digit2',    display: [['2']] },
  { section: 'Power User', label: 'Focus Player',           code: 'Digit3',     display: [['3']] },
  { section: 'Power User', label: 'Focus File d\'attente',  code: 'Digit4',     display: [['4']] },
  { section: 'Power User', label: 'Focus Paroles',          code: 'Digit5',     display: [['5']] },
  // Paroles
  { section: 'Paroles',  label: 'Avancer les paroles',      code: 'AltRight',   display: [['Alt', '→']] },
  { section: 'Paroles',  label: 'Reculer les paroles',      code: 'AltLeft',    display: [['Alt', '←']] },
  { section: 'Paroles',  label: 'Visualizer / Immersif',    code: 'KeyV',       display: [[_keyLabel('KeyV')]] },
];

document.addEventListener('keydown', e => {
  // Ne pas déclencher depuis les champs texte
  if (e.target.matches('input, textarea, [contenteditable]')) return;

  const code = e.code;

  // ── Ctrl/⌘+K : Command Palette ────────────────────────────────
  if ((e.ctrlKey || e.metaKey) && code === 'KeyK') {
    e.preventDefault();
    window._openCommandPalette?.();
    return;
  }

  // ── Touches directionnelles & Espace (universelles) ──────────
  if (code === 'Space') {
    e.preventDefault();
    document.getElementById('playPauseBtn')?.click();
    return;
  }
  if (code === 'ArrowRight' && !e.shiftKey && !e.altKey) {
    const ap = document.getElementById('audioPlayer');
    if (ap) ap.currentTime = Math.min(ap.currentTime + 5, ap.duration || 0);
    return;
  }
  if (code === 'ArrowLeft' && !e.shiftKey && !e.altKey) {
    const ap = document.getElementById('audioPlayer');
    if (ap) ap.currentTime = Math.max(ap.currentTime - 5, 0);
    return;
  }
  if (code === 'ArrowRight' && e.altKey) {
    e.preventDefault();
    window._lyricsTimeOffset = (window._lyricsTimeOffset || 0) + 0.25;
    if (typeof showToast === 'function') showToast(`⏩ Paroles +${window._lyricsTimeOffset.toFixed(2)}s`, 'info', 1200);
    return;
  }
  if (code === 'ArrowLeft' && e.altKey) {
    e.preventDefault();
    window._lyricsTimeOffset = (window._lyricsTimeOffset || 0) - 0.25;
    if (typeof showToast === 'function') showToast(`⏪ Paroles ${window._lyricsTimeOffset.toFixed(2)}s`, 'info', 1200);
    return;
  }
  if (code === 'ArrowUp') {
    e.preventDefault();
    const vs = document.getElementById('volumeSlider');
    if (vs) { vs.value = Math.min(+vs.value + 5, 100); vs.dispatchEvent(new Event('input')); }
    return;
  }
  if (code === 'ArrowDown') {
    e.preventDefault();
    const vs = document.getElementById('volumeSlider');
    if (vs) { vs.value = Math.max(+vs.value - 5, 0); vs.dispatchEvent(new Event('input')); }
    return;
  }

  // ── Raccourcis avec modificateurs ────────────────────────────
  if (e.ctrlKey || e.metaKey) {
    if (code === 'Slash') { e.preventDefault(); document.getElementById('topSearchInput')?.focus(); }
    return;
  }

  // ── Shift+raccourcis ─────────────────────────────────────────
  if (e.shiftKey) {
    switch (code) {
      case 'KeyL': { // Shift+L : Liker le morceau courant
        e.preventDefault();
        document.getElementById('miniLike')?.click();
        return;
      }
      case 'KeyP': { // Shift+P : Ajouter à une playlist
        e.preventDefault();
        if (typeof currentIndex !== 'undefined' && currentIndex >= 0 && typeof tracks !== 'undefined') {
          const track = tracks[currentIndex];
          if (track && typeof showAddToPlaylistPopup === 'function') {
            const btn = document.getElementById('miniLike') || document.getElementById('playPauseBtn');
            const fakeEvt = { clientX: btn ? btn.getBoundingClientRect().right : window.innerWidth / 2,
                              clientY: btn ? btn.getBoundingClientRect().top   : window.innerHeight / 2 };
            showAddToPlaylistPopup(fakeEvt, track);
          }
        }
        return;
      }
      case 'Slash':
      case 'Digit7': { // Shift+? : Raccourcis clavier (? = Shift+/ sur QWERTY, Shift+: sur AZERTY → Shift+?)
        e.preventDefault();
        window._openShortcuts?.();
        return;
      }
    }
    return; // Ne pas traiter les autres Shift+touches comme raccourcis simples
  }

  // ── Focus zones : 1-5 ───────────────────────────────────────
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (code === 'Digit1') { e.preventDefault(); document.querySelector('.lib-search-box input, .sidebar')?.focus(); return; }
    if (code === 'Digit2') { e.preventDefault(); document.getElementById('topSearchInput')?.focus(); return; }
    if (code === 'Digit3') { e.preventDefault(); document.getElementById('playPauseBtn')?.focus(); return; }
    if (code === 'Digit4') { e.preventDefault(); document.getElementById('queueBtn')?.focus(); return; }
    if (code === 'Digit5') { e.preventDefault(); document.getElementById('lyricsBtn')?.focus(); return; }
  }

  // ── Raccourcis lettre — basés sur e.code (touche physique) ───
  switch (code) {
    case 'KeyN': e.preventDefault(); if (typeof goNext === 'function') goNext(); break;
    case 'KeyB': e.preventDefault(); if (typeof goPrev === 'function') goPrev(); break;
    case 'KeyS': e.preventDefault(); document.getElementById('shuffleBtn')?.click(); break;
    case 'KeyR': e.preventDefault(); document.getElementById('repeatBtn')?.click(); break;
    case 'KeyM': document.getElementById('muteBtn')?.click(); break;
    case 'KeyL': e.preventDefault(); document.getElementById('lyricsBtn')?.click(); break;
    case 'KeyQ': e.preventDefault(); document.getElementById('queueBtn')?.click(); break;
    case 'KeyF': e.preventDefault(); window._openImmersive?.(); break;
    case 'KeyH': e.preventDefault(); document.getElementById('btnHome')?.click(); break;
    case 'KeyP': e.preventDefault(); window._openSettings?.(); break;
    // Nouveaux raccourcis power user
    case 'KeyC': { // Centrer sur la piste en cours
      e.preventDefault();
      const active = document.querySelector('.track-item.active, .queue-item.active, [data-active="true"]');
      if (active) { active.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (typeof currentIndex !== 'undefined' && currentIndex >= 0) {
        const el = document.querySelector(`[data-idx="${currentIndex}"], [data-id="${typeof tracks !== 'undefined' && tracks[currentIndex]?.id}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      break;
    }
    case 'KeyI': { // Mini-player / compact mode toggle
      e.preventDefault();
      document.getElementById('nowPlayingBtn')?.click();
      break;
    }
    case 'KeyV': { // Visualizer / Immersif
      e.preventDefault();
      window._openImmersive?.();
      break;
    }
    case 'KeyJ': { // Naviguer file d'attente vers le bas (style Vim)
      e.preventDefault();
      const queueEl = document.getElementById('panelQueueContent');
      if (queueEl && queueEl.style.display !== 'none') {
        const items = queueEl.querySelectorAll('.panel-queue-item');
        const focused = queueEl.querySelector('.panel-queue-item:focus, .panel-queue-item.kb-focus');
        let nextIdx = 0;
        if (focused) {
          const idx = [...items].indexOf(focused);
          focused.classList.remove('kb-focus');
          nextIdx = Math.min(idx + 1, items.length - 1);
        }
        items[nextIdx]?.classList.add('kb-focus');
        items[nextIdx]?.focus();
        items[nextIdx]?.scrollIntoView({ block: 'nearest' });
      }
      break;
    }
    case 'KeyK': { // Naviguer file d'attente vers le haut (style Vim)
      e.preventDefault();
      const queueEl2 = document.getElementById('panelQueueContent');
      if (queueEl2 && queueEl2.style.display !== 'none') {
        const items2 = queueEl2.querySelectorAll('.panel-queue-item');
        const focused2 = queueEl2.querySelector('.panel-queue-item:focus, .panel-queue-item.kb-focus');
        if (focused2) {
          const idx2 = [...items2].indexOf(focused2);
          focused2.classList.remove('kb-focus');
          const prevIdx = Math.max(idx2 - 1, 0);
          items2[prevIdx]?.classList.add('kb-focus');
          items2[prevIdx]?.focus();
          items2[prevIdx]?.scrollIntoView({ block: 'nearest' });
        }
      }
      break;
    }
  }
});

// ── Shortcuts modal ────────────────────────────────────────────────
window._openShortcuts = function() {
  // Close if already open
  document.getElementById('shortcutsOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'shortcuts-overlay';
  overlay.id = 'shortcutsOverlay';

  // Group by section
  const sections = {};
  _SHORTCUTS.forEach(sc => {
    if (!sections[sc.section]) sections[sc.section] = [];
    sections[sc.section].push(sc);
  });

  const sectionsHtml = Object.entries(sections).map(([title, items]) => `
    <div class="sc-section">
      <div class="sc-section-title">${title}</div>
      ${items.map(sc => `
        <div class="sc-row">
          <div class="sc-label">${sc.label}</div>
          <div class="sc-keys">
            ${sc.display.map((combo, ki) => `
              ${ki > 0 ? '<span class="sc-sep">ou</span>' : ''}
              ${combo.map(k => `<kbd class="sc-key">${k}</kbd>`).join('<span class="sc-sep">+</span>')}
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');

  const layoutNote = _IS_AZERTY
    ? '<div style="font-size:.75rem;color:rgba(255,255,255,0.4);margin-bottom:12px">Disposition détectée : <strong>AZERTY</strong></div>'
    : '<div style="font-size:.75rem;color:rgba(255,255,255,0.4);margin-bottom:12px">Disposition détectée : <strong>QWERTY</strong></div>';

  overlay.innerHTML = `
    <div class="shortcuts-modal" role="dialog" aria-label="Raccourcis clavier" aria-modal="true">
      <div class="sc-header">
        <div class="sc-title">⌨️ Raccourcis clavier</div>
        <button class="sc-close" id="scClose" aria-label="Fermer">✕</button>
      </div>
      <div class="sc-body">${layoutNote}${sectionsHtml}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#scClose')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // Trap focus
  overlay.querySelector('#scClose')?.focus();
};

// ══════════════════════════════════════════════════════════════════
//  COMMAND PALETTE — Ctrl+K / ⌘+K
//  Recherche rapide : pistes, artistes, playlists, actions
// ══════════════════════════════════════════════════════════════════
window._openCommandPalette = function() {
  // Fermer si déjà ouvert
  document.getElementById('cmdPaletteOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cmdPaletteOverlay';
  overlay.className = 'cmd-palette-overlay';

  // Actions intégrées disponibles
  const ACTIONS = [
    { type: 'action', icon: '▶',  label: 'Lecture / Pause',         fn: () => document.getElementById('playPauseBtn')?.click() },
    { type: 'action', icon: '⏭',  label: 'Piste suivante',           fn: () => typeof goNext === 'function' && goNext() },
    { type: 'action', icon: '⏮',  label: 'Piste précédente',         fn: () => typeof goPrev === 'function' && goPrev() },
    { type: 'action', icon: '⇄',  label: 'Activer / désactiver aléatoire', fn: () => document.getElementById('shuffleBtn')?.click() },
    { type: 'action', icon: '↻',  label: 'Changer mode répétition',  fn: () => document.getElementById('repeatBtn')?.click() },
    { type: 'action', icon: '♥',  label: 'Liker le morceau',         fn: () => document.getElementById('miniLike')?.click() },
    { type: 'action', icon: '☰',  label: 'Ouvrir la file d\'attente',fn: () => document.getElementById('queueBtn')?.click() },
    { type: 'action', icon: '♫',  label: 'Afficher les paroles',     fn: () => document.getElementById('lyricsBtn')?.click() },
    { type: 'action', icon: '⛶',  label: 'Mode immersif / Plein écran', fn: () => window._openImmersive?.() },
    { type: 'action', icon: '⚙',  label: 'Paramètres',              fn: () => window._openSettings?.() },
    { type: 'action', icon: '🏠', label: 'Accueil',                  fn: () => document.getElementById('btnHome')?.click() },
    { type: 'action', icon: '⌨',  label: 'Raccourcis clavier',       fn: () => window._openShortcuts?.() },
    { type: 'action', icon: '🔇', label: 'Muet / Son',               fn: () => document.getElementById('muteBtn')?.click() },
  ];

  let selectedIdx = 0;
  let currentResults = [];

  function getResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS.slice(0, 8);

    const results = [];
    // Actions
    ACTIONS.forEach(a => {
      if (a.label.toLowerCase().includes(q)) results.push(a);
    });
    // Pistes
    if (typeof tracks !== 'undefined') {
      tracks.filter(t => t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q)).slice(0, 6).forEach(t => {
        results.push({ type: 'track', icon: '🎵', label: t.title, sub: t.artist, track: t });
      });
    }
    // Playlists (sidebar)
    document.querySelectorAll('.lib-item[data-playlist], .track-item[data-playlist]').forEach(el => {
      const name = el.querySelector('.lib-item-name, .track-title')?.textContent || '';
      if (name.toLowerCase().includes(q)) results.push({ type: 'playlist', icon: '📋', label: name, el });
    });
    return results.slice(0, 12);
  }

  function renderResults(query) {
    currentResults = getResults(query);
    selectedIdx = 0;
    const list = overlay.querySelector('#cmdPaletteList');
    if (!list) return;
    if (!currentResults.length) {
      list.innerHTML = `<div class="cp-empty">Aucun résultat pour « ${escapeHtml(query)} »</div>`;
      return;
    }
    list.innerHTML = currentResults.map((r, i) => `
      <div class="cp-item ${i === 0 ? 'selected' : ''}" data-idx="${i}" tabindex="-1">
        <span class="cp-item-icon">${r.icon}</span>
        <span class="cp-item-text">
          <span class="cp-item-label">${escapeHtml(r.label)}</span>
          ${r.sub ? `<span class="cp-item-sub">${escapeHtml(r.sub)}</span>` : ''}
        </span>
        <span class="cp-item-type">${r.type === 'action' ? 'Action' : r.type === 'track' ? 'Piste' : 'Playlist'}</span>
      </div>
    `).join('');
    list.querySelectorAll('.cp-item').forEach((el, i) => {
      el.addEventListener('mouseenter', () => { setSelected(i); });
      el.addEventListener('click', () => { execResult(i); });
    });
  }

  function setSelected(idx) {
    const list = overlay.querySelector('#cmdPaletteList');
    list?.querySelectorAll('.cp-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
    selectedIdx = idx;
    list?.querySelector('.cp-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function execResult(idx) {
    const r = currentResults[idx];
    if (!r) return;
    close();
    if (r.type === 'action') { r.fn?.(); }
    else if (r.type === 'track') {
      const ti = typeof tracks !== 'undefined' ? tracks.indexOf(r.track) : -1;
      if (ti >= 0) { window.currentIndex = ti; if (typeof playCurrentTrack === 'function') playCurrentTrack(); }
    } else if (r.type === 'playlist') { r.el?.click(); }
  }

  overlay.innerHTML = `
    <div class="cmd-palette" role="dialog" aria-label="Palette de commandes" aria-modal="true">
      <div class="cp-input-row">
        <span class="cp-search-icon">⌘</span>
        <input type="text" class="cp-input" id="cmdPaletteInput"
          placeholder="Rechercher une piste, un artiste, une action…" autocomplete="off" spellcheck="false">
        <kbd class="cp-esc-hint">Esc</kbd>
      </div>
      <div class="cp-list" id="cmdPaletteList"></div>
      <div class="cp-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
        <span><kbd>Entrée</kbd> exécuter</span>
        <span><kbd>Esc</kbd> fermer</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('#cmdPaletteInput');

  renderResults('');
  input?.focus();

  input?.addEventListener('input', e => renderResults(e.target.value));

  function close() { overlay.remove(); }

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.addEventListener('keydown', e => {
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(); break;
      case 'ArrowDown': e.preventDefault(); setSelected(Math.min(selectedIdx + 1, currentResults.length - 1)); break;
      case 'ArrowUp':   e.preventDefault(); setSelected(Math.max(selectedIdx - 1, 0)); break;
      case 'Enter':     e.preventDefault(); execResult(selectedIdx); break;
    }
  });
};

// ── Helpers ────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ── Init ───────────────────────────────────────────────────────────
audioPlayer.volume = 0.7;
sidebar.classList.add('collapsed');
const _expandImg = document.getElementById('expandSidebarBtn')?.querySelector('img');
if (_expandImg) _expandImg.src = 'pictures/icon-arrow-right.png';

fetchTracks();
initSearchDropdown();
spicyAnimationLoop(); // Start SpicyLyrics animation loop
initSpicyBackground(); // Initialise le fond global SpicyLyrics

window.addEventListener('resize', () => {
  if (currentIndex >= 0) setTimeout(refreshAllMarquees, 60);
});
// ══════════════════════════════════════════════════════════════════
//  AUTHENTIFICATION — portée depuis Grizzly Stream (main.js v5.1)
// ══════════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID = '1475132757188280471';
// Note : l'auth Google est désormais gérée par Firebase Auth (firebase-config.js).
// Plus besoin de GOOGLE_CLIENT_ID ni du SDK GSI externe.

// ── Sauvegarde locale (session Discord ou fallback) ──
function saveUserLocally(user) {
  try { localStorage.setItem('beartify_user', JSON.stringify(user)); } catch {}
}

// ── Appliquer l'utilisateur connecté à l'UI ──
function applyUserToUI(user) {
  window._authUser = user;

  // Bouton de profil (top-bar)
  const nameEl   = document.getElementById('topProfileName');
  const avatarEl = document.getElementById('topProfileAvatar');
  const btnProf  = document.getElementById('btnProfile');
  if (nameEl) nameEl.textContent = user.name || 'Profil';
  if (avatarEl) {
    avatarEl.classList.add('connected');       // ← active le style CSS de l'état connecté
    avatarEl.innerHTML = user.picture
      ? `<img src="${user.picture}" alt="">`
      : `<span>${(user.name || '?').charAt(0).toUpperCase()}</span>`;
  }
  if (btnProf) btnProf.classList.add('connected');

  // Dropdown de profil
  const pdAvatar   = document.getElementById('pdAvatar');
  const pdName     = document.getElementById('pdName');
  const pdEmail    = document.getElementById('pdEmail');
  const pdProvider = document.getElementById('pdProvider');
  if (pdAvatar) pdAvatar.innerHTML = user.picture
    ? `<img src="${user.picture}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
    : `<span style="font-size:18px;font-weight:700;color:#fff;">${(user.name || '?').charAt(0).toUpperCase()}</span>`;
  if (pdName)     pdName.textContent     = user.name || 'Utilisateur';
  if (pdEmail)    pdEmail.textContent    = user.provider === 'discord'
    ? (user.discordUsername ? `@${user.discordUsername}` : (user.email || ''))
    : (user.email || '');
  if (pdProvider) pdProvider.textContent = `Via ${{ google: 'Google', discord: 'Discord' }[user.provider] || 'Connexion'}`;

  saveUserLocally(user);
  window._authCloseModal?.();
}
// Exposé sur window pour que firebase-config.js puisse l'appeler depuis onAuthStateChanged
window.applyUserToUI = applyUserToUI;

// ── Réinitialiser l'UI (état déconnecté) ──
function resetAuthUI() {
  window._authUser = null;
  const nameEl   = document.getElementById('topProfileName');
  const avatarEl = document.getElementById('topProfileAvatar');
  const btnProf  = document.getElementById('btnProfile');
  if (nameEl) nameEl.textContent = 'Connexion';
  if (avatarEl) {
    avatarEl.classList.remove('connected');
    avatarEl.innerHTML = `<img src="pictures/icon-chevron-down.png" alt="" class="btn-icon small" id="topProfileChevron">`;
  }
  if (btnProf) btnProf.classList.remove('connected');
  const pdAvatar   = document.getElementById('pdAvatar');
  const pdName     = document.getElementById('pdName');
  const pdEmail    = document.getElementById('pdEmail');
  const pdProvider = document.getElementById('pdProvider');
  if (pdAvatar)    pdAvatar.innerHTML     = '';
  if (pdName)      pdName.textContent     = '—';
  if (pdEmail)     pdEmail.textContent    = '—';
  if (pdProvider)  pdProvider.textContent = '—';
}

// ── Google Sign-In ──
// ── Google Sign-In via Firebase Auth ─────────────────────────────
// Le popup est géré nativement par Firebase Auth (firebase-config.js → firebaseSignInWithGoogle).
// onAuthStateChanged appelle window.applyUserToUI automatiquement après connexion réussie.
async function triggerGoogleLogin() {
  const user = await window.firebaseSignInWithGoogle?.();
  if (!user) {
    // Popup fermé ou erreur — retirer le spinner du bouton
    document.getElementById('authGoogleBtn')?.classList.remove('loading');
  }
  // Si user != null, onAuthStateChanged dans firebase-config.js met l'UI à jour
}

// ── Discord OAuth2 ──
/**
 * Construit l'URL d'autorisation Discord OAuth2.
 *
 * ✅ TAURI FIX :
 *  • Navigateur : redirect_uri = window.location.origin  (comportement original)
 *  • Tauri      : redirect_uri = "beartify://discord-callback"
 *                 Discord redirige vers ce scheme URI géré nativement par l'app
 *                 via le plugin tauri-plugin-deep-link.
 *
 *  ⚠️  Pré-requis Tauri :
 *    1. Installer tauri-plugin-deep-link (voir tauri-additions.json).
 *    2. Enregistrer le scheme "beartify" dans tauri.conf.json → plugins.deep-link.
 *    3. Ajouter "beartify://discord-callback" dans Discord Developer Portal
 *       → OAuth2 → Redirects.
 */
function buildDiscordURL() {
  let redirect;
  if (_IS_TAURI) {
    // Deep link scheme enregistré via le plugin Tauri deep-link
    redirect = 'beartify://discord-callback';
  } else {
    redirect = window.location.origin
      + window.location.pathname.split('#')[0].split('?')[0];
  }
  return `https://discord.com/api/oauth2/authorize`
    + `?client_id=${DISCORD_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(redirect)}`
    + `&response_type=token`
    + `&scope=identify`;
}

async function fetchDiscordUser(token) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Discord API error ' + res.status);
  return res.json();
}

async function handleDiscordLogin(discordToken) {
  try {
    // 1. Appeler votre backend pour convertir le token Discord
    const response = await fetch('https://votre-api.com/auth/discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordToken })
    });

    const { firebaseToken, user } = await response.json();

    // 2. Se connecter à Firebase avec le Custom Token
    const firebaseAuth = window.FirebaseConfig.getAuth();
    await firebaseAuth.signInWithCustomToken(firebaseToken);

    console.log('✅ Discord → Firebase conversion réussie');
    
    // 3. window._firebaseUser sera maintenant défini automatiquement
    // par le listener onAuthStateChanged dans firebase-config.js
    
  } catch (error) {
    console.error('❌ Erreur connexion Discord:', error);
  }
}

async function handleDiscordToken(token) {
  try {
    const u = await fetchDiscordUser(token);
    const avatar = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator || '0') % 5}.png`;
    const discordUsername = u.global_name || u.username || '';
    const discordTag      = u.discriminator && u.discriminator !== '0'
      ? `${u.username}#${u.discriminator}` : u.username;
    const user = {
      name:            discordUsername || discordTag,
      email:           discordTag,
      discordUsername: discordUsername || u.username,
      discordTag,
      picture:         avatar,
      provider:        'discord',
      discordId:       u.id,
    };

    // Discord n'est pas géré par Firebase Auth — on sauvegarde la session localement
    applyUserToUI(user);

    // ── Firebase Sync Discord : attendre que Firebase soit prêt puis sync ──
    const _startDiscordSync = async () => {
      const db = window.FirebaseConfig?.getDB();
      if (!db || !window.FirebaseSync?.syncToFirestore) {
        setTimeout(_startDiscordSync, 300);
        return;
      }
      // D'abord tenter de charger les données existantes
      await window.FirebaseSync.syncFromFirestore();
      // Si toujours pas de document (première connexion), créer le profil
      await window.FirebaseSync.syncToFirestore(false);
      window.FirebaseSync.enableAutoSync();
      window.FirebaseSync.enablePresenceSync();
    };
    _startDiscordSync();

    history.replaceState(null, '', window.location.pathname + window.location.search);
    showToast(`Bienvenue, ${user.name} !`, 'success');
  } catch (err) {
    console.error('[Auth] Discord login error:', err);
    showToast('Erreur lors de la connexion Discord.', 'error');
  }
}

function checkDiscordCallback() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;
  const params = new URLSearchParams(hash.substring(1));
  const token  = params.get('access_token');
  if (!token) return false;
  handleDiscordToken(token);
  return true;
}

// ── Déconnexion ──
async function logout() {
  window._authCloseDropdown?.();
  // Déconnexion Firebase (Google) + nettoyage session locale (Discord)
  await window.firebaseSignOut?.();
  try { localStorage.removeItem('beartify_user'); } catch {}
  resetAuthUI();
  showToast('Déconnecté.', 'info');
}

// ── Restauration de session au chargement ──
// Pour Google : Firebase Auth restaure la session automatiquement via onAuthStateChanged.
// Pour Discord : pas de session Firebase → on restaure depuis localStorage.
function restoreSessionFromCache() {
  try {
    const saved = localStorage.getItem('beartify_user');
    if (saved) {
      const user = JSON.parse(saved);
      // Ne restaurer que les sessions Discord (Google est géré par Firebase onAuthStateChanged)
      if (user?.name && user?.provider === 'discord') {
        applyUserToUI(user);
        // ── Déclencher le sync Firestore une fois Firebase prêt ──
        const _tryDiscordSync = () => {
          if (window.FirebaseConfig?.getDB() && window.FirebaseSync?.syncFromFirestore) {
            window.FirebaseSync.syncFromFirestore();
            window.FirebaseSync.enableAutoSync();
            window.FirebaseSync.enablePresenceSync();
          } else {
            setTimeout(_tryDiscordSync, 300);
          }
        };
        setTimeout(_tryDiscordSync, 300);
      }
    }
  } catch {}
}

// ── Initialisation ──
(function initAuth() {
  // ── 1. Callback Discord ──────────────────────────────────────────────
  // En navigateur : Discord redirige vers l'origine avec #access_token=...
  //                 → on lit le hash immédiatement via checkDiscordCallback().
  // En Tauri      : Discord redirige vers le deep link beartify://discord-callback
  //                 → le plugin tauri-plugin-deep-link intercepte et émet un
  //                   événement que l'on écoute ici.
  let wasDiscordCallback = false;

  if (_IS_TAURI && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
    // ✅ TAURI FIX — Écouter l'événement deep-link Discord.
    // Le plugin tauri-plugin-deep-link émet soit :
    //   • window.__TAURI__.deepLink.onOpenUrl(urls => ...)   (API plugin haut-niveau)
    //   • window.__TAURI__.event.listen('deep-link://new-url', ...) (fallback)
    (async () => {
      try {
        const tauriNS = window.__TAURI__ || window.__TAURI_INTERNALS__;

        // Essai 1 : API haut-niveau du plugin deep-link (Tauri V2 recommandé)
        const deepLinkPlugin = tauriNS?.deepLink ?? tauriNS?.plugins?.['deep-link'];
        if (deepLinkPlugin?.onOpenUrl) {
          await deepLinkPlugin.onOpenUrl((urls) => {
            const url = Array.isArray(urls) ? urls[0] : urls;
            if (!url || !url.startsWith('beartify://discord-callback')) return;
            const fragment = url.includes('#') ? url.split('#')[1] : (url.split('?')[1] || '');
            const token = new URLSearchParams(fragment).get('access_token');
            if (token) { console.log('[Auth] ✅ Token Discord (deep-link plugin)'); handleDiscordToken(token); }
          });
          console.log('[Auth] 🔗 Deep-link Discord enregistré (plugin API)');
        } else {
          // Essai 2 : event listener bas-niveau Tauri
          const eventNS = tauriNS?.event ?? tauriNS?.plugins?.event;
          if (eventNS?.listen) {
            await eventNS.listen('deep-link://new-url', ({ payload }) => {
              const url = Array.isArray(payload) ? payload[0] : payload;
              if (!url || !url.startsWith('beartify://discord-callback')) return;
              const fragment = url.includes('#') ? url.split('#')[1] : (url.split('?')[1] || '');
              const token = new URLSearchParams(fragment).get('access_token');
              if (token) { console.log('[Auth] ✅ Token Discord (event Tauri)'); handleDiscordToken(token); }
            });
            console.log('[Auth] 🔗 Deep-link Discord enregistré (event listener)');
          } else {
            console.warn('[Auth] ⚠️ Plugin deep-link Tauri non disponible.',
              'Installez tauri-plugin-deep-link et déclarez-le dans main.rs.');
          }
        }
      } catch (e) {
        console.warn('[Auth] Deep-link Tauri erreur :', e.message);
      }
    })();
    // En Tauri on ne lit pas le hash (inutile — le deep link est géré ci-dessus)
    wasDiscordCallback = false;
  } else {
    // Navigateur classique : lire le hash immédiatement
    wasDiscordCallback = checkDiscordCallback();
  }

  // ── 2. Restaurer la session Discord depuis localStorage ──────────────
  // Pour Google : Firebase Auth restaure la session via onAuthStateChanged.
  if (!wasDiscordCallback) restoreSessionFromCache();

  // ── 3. Exposer les handlers pour le bootstrap inline de index.html ───
  window._authGoogle = async () => {
    const btn = document.getElementById('authGoogleBtn');
    if (btn) btn.classList.add('loading');
    await triggerGoogleLogin();
    // triggerGoogleLogin retire lui-même le spinner si annulation/redirect Android
  };

  window._authDiscord = () => {
    const btn = document.getElementById('authDiscordBtn');
    if (btn) btn.classList.add('loading');

    if (_IS_TAURI) {
      // ✅ TAURI FIX : ouvrir Discord OAuth dans le navigateur système.
      // Le résultat revient via deep-link beartify://discord-callback (voir ci-dessus).
      const tauriNS = window.__TAURI__ || window.__TAURI_INTERNALS__;
      const shellNS = tauriNS?.shell ?? tauriNS?.plugins?.shell;
      if (shellNS?.open) {
        shellNS.open(buildDiscordURL())
          .catch(e => {
            console.error('[Auth] Impossible d\'ouvrir le navigateur système :', e);
            showToast('Impossible d\'ouvrir le navigateur pour Discord.', 'error');
            if (btn) btn.classList.remove('loading');
          });
      } else {
        console.warn('[Auth] Plugin shell Tauri non disponible. Installez tauri-plugin-shell.');
        showToast('Plugin shell non disponible. Vérifiez la config Tauri.', 'error');
        if (btn) btn.classList.remove('loading');
      }
    } else {
      // Navigateur : redirection classique
      setTimeout(() => { window.location.href = buildDiscordURL(); }, 120);
    }
  };

  // ── 4. Bouton de déconnexion ─────────────────────────────────────────
  document.getElementById('pdSignOut')?.addEventListener('click', logout);
})();
// ══════════════════════════════════════════════════════════════════
//  FRIENDS ACTIVITY — Affichage de l'activité des amis en temps réel
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  FRIENDS ACTIVITY — Ticker temps réel (interpolation locale)
// ══════════════════════════════════════════════════════════════════
//  ACTIVITÉ DES AMIS — Fonctionnalité en cours de développement
//  Toute la logique précédente (ticker, Firebase presence, recherche
//  d'utilisateurs) a été retirée pour repartir sur des bases propres.
// ══════════════════════════════════════════════════════════════════
window._showFriendsActivity = function() {
  _showWipModal();
};
// ══════════════════════════════════════════════════════════════════
//  TRACK CONTEXT MENU — popup "Etc" (options d'une musique)
// ══════════════════════════════════════════════════════════════════
function closeAllPopups() {
  document.querySelectorAll('.track-context-menu, .add-to-playlist-popup, .etc-popup').forEach(el => el.remove());
}

function showTrackContextMenu(e, track) {
  e.stopPropagation();
  closeAllPopups();

  const menu = document.createElement('div');
  menu.className = 'track-context-menu';

  const isLikedTrack = likedTracks.has(track.id);

  menu.innerHTML = `
    <div class="ctx-menu-item" id="ctxPlayNow">
      <img src="pictures/icon-play.png" alt="">
      Lire maintenant
    </div>
    <div class="ctx-menu-item" id="ctxAddLike">
      <img src="pictures/${isLikedTrack ? 'like.png' : 'Unlike.png'}" alt="">
      ${isLikedTrack ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
    </div>
    <div class="ctx-menu-item" id="ctxAddPlaylist">
      <img src="pictures/plus.png" alt="">
      Ajouter à une playlist
      <span class="ctx-menu-submenu-arrow">›</span>
    </div>
    <div class="ctx-menu-divider"></div>
    <div class="ctx-menu-item" id="ctxGoArtist">
      <img src="pictures/icon-friends.png" alt="">
      Accéder à l'artiste
    </div>
    <div class="ctx-menu-item" id="ctxGoAlbum">
      <img src="pictures/icon-store.png" alt="">
      Accéder à l'album
    </div>
    <div class="ctx-menu-divider"></div>
    <div class="ctx-menu-item" id="ctxAddQueue">
      <img src="pictures/icon-queue.png" alt="">
      Ajouter à la file d'attente
    </div>
  `;

  // Position
  const x = Math.min(e.clientX, window.innerWidth - 240);
  const y = Math.min(e.clientY, window.innerHeight - 280);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  document.body.appendChild(menu);

  menu.querySelector('#ctxPlayNow')?.addEventListener('click', () => {
    const idx = tracks.findIndex(t => t.id === track.id);
    if (idx !== -1) { currentIndex = idx; playCurrentTrack(); }
    closeAllPopups();
  });

  menu.querySelector('#ctxAddLike')?.addEventListener('click', () => {
    const isNowLiked = likedTracks.has(track.id);
    if (isNowLiked) { likedTracks.delete(track.id); }
    else { likedTracks.add(track.id); }
    if (track.id === tracks[currentIndex]?.id) {
      isLiked = !isNowLiked;
      updateLikeButtons();
    }
    if (window.FirebaseSync?.syncToFirestore) window.FirebaseSync.syncToFirestore();
    showToast(isNowLiked ? '♡ Retiré des titres likés' : '♥ Ajouté aux titres likés', isNowLiked ? 'default' : 'success');
    closeAllPopups();
  });

  menu.querySelector('#ctxAddPlaylist')?.addEventListener('click', (ev) => {
    closeAllPopups();
    showAddToPlaylistPopup(ev, track);
  });

  menu.querySelector('#ctxGoArtist')?.addEventListener('click', () => {
    showDetailView('artist', track.artist);
    closeAllPopups();
  });

  menu.querySelector('#ctxGoAlbum')?.addEventListener('click', () => {
    showDetailView('album', track.album);
    closeAllPopups();
  });

  menu.querySelector('#ctxAddQueue')?.addEventListener('click', () => {
    // Ajouter après la piste en cours dans le contexte
    showToast(`📌 "${escapeHtml(track.title)}" ajouté à la file`, 'success');
    closeAllPopups();
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeCtx(e) {
      if (!menu.contains(e.target)) { closeAllPopups(); document.removeEventListener('click', closeCtx); }
    });
  }, 30);
}

// ══════════════════════════════════════════════════════════════════
//  ADD TO PLAYLIST POPUP — choisir où ajouter la musique
// ══════════════════════════════════════════════════════════════════
function showAddToPlaylistPopup(e, track) {
  e.stopPropagation?.();
  closeAllPopups();

  const popup = document.createElement('div');
  popup.className = 'add-to-playlist-popup';

  const x = Math.min(e.clientX || e.pageX, window.innerWidth - 320);
  const y = Math.min(e.clientY || e.pageY, window.innerHeight - 420);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';

  // Build playlists list: Liked + custom
  const customPlaylists = window.customPlaylists || {};
  const isLikedAlready = likedTracks.has(track.id);

  let playlistItems = `
    <div class="atp-item ${isLikedAlready ? 'checked' : ''}" data-id="liked">
      <div class="atp-item-icon">💜</div>
      <div class="atp-item-name">Titres likés</div>
      <div class="atp-item-check">${isLikedAlready ? '✓' : ''}</div>
    </div>
  `;

  Object.values(customPlaylists).forEach(pl => {
    const inPl = (pl.tracks || []).some(t => t.id === track.id);
    playlistItems += `
      <div class="atp-item ${inPl ? 'checked' : ''}" data-id="${escapeHtml(pl.id || pl.name)}">
        <div class="atp-item-icon">
          ${_makePlaylistCoverHtml(pl.tracks, 'xs')}
        </div>
        <div class="atp-item-name">${escapeHtml(pl.name)}</div>
        <div class="atp-item-check">${inPl ? '✓' : ''}</div>
      </div>
    `;
  });

  popup.innerHTML = `
    <div class="atp-header">
      <div class="atp-title">Ajouter à la playlist</div>
      <div class="atp-search">
        <img src="pictures/icon-search.png" style="width:14px;height:14px;opacity:0.45;flex-shrink:0" alt="">
        <input type="text" placeholder="Rechercher une playlist" id="atpSearchInput">
      </div>
    </div>
    <div class="atp-list" id="atpList">
      ${playlistItems}
    </div>
    <div class="atp-footer">
      <button class="atp-new-btn" id="atpNewBtn">
        <span style="font-size:1.1rem;line-height:1">+</span>
        Nouvelle playlist
      </button>
    </div>
  `;

  document.body.appendChild(popup);

  // Search filter
  popup.querySelector('#atpSearchInput')?.addEventListener('input', (ev) => {
    const q = ev.target.value.toLowerCase();
    popup.querySelectorAll('.atp-item').forEach(item => {
      const name = item.querySelector('.atp-item-name')?.textContent.toLowerCase() || '';
      item.style.display = name.includes(q) ? '' : 'none';
    });
  });

  // Click on playlist item
  popup.querySelectorAll('.atp-item').forEach(item => {
    item.addEventListener('click', async () => {
      const plId = item.dataset.id;
      if (plId === 'liked') {
        const was = likedTracks.has(track.id);
        if (was) { likedTracks.delete(track.id); }
        else { likedTracks.add(track.id); }
        item.classList.toggle('checked', !was);
        const chk = item.querySelector('.atp-item-check');
        if (chk) { chk.textContent = was ? '' : '✓'; }
        if (track.id === tracks[currentIndex]?.id) { isLiked = !was; updateLikeButtons(); }
        if (window.FirebaseSync?.syncToFirestore) window.FirebaseSync.syncToFirestore();
        showToast(was ? '♡ Retiré des titres likés' : '♥ Ajouté aux titres likés', was ? 'default' : 'success');
      } else {
        // Custom playlist
        const cpls = window.customPlaylists || {};
        const pl = Object.values(cpls).find(p => (p.id || p.name) === plId);
        if (!pl) return;

        const wasIn = (pl.tracks || []).some(t => t.id === track.id);

        if (window.FirebasePlaylists?.addTrackToPlaylist) {
          if (wasIn) {
            await window.FirebasePlaylists.removeTrackFromPlaylist(plId, track.id);
            pl.tracks = (pl.tracks || []).filter(t => t.id !== track.id);
            item.classList.remove('checked');
            const chk = item.querySelector('.atp-item-check'); if (chk) chk.textContent = '';
            showToast(`Retiré de "${escapeHtml(pl.name)}"`, 'default');
          } else {
            await window.FirebasePlaylists.addTrackToPlaylist(plId, track);
            if (!pl.tracks) pl.tracks = [];
            pl.tracks.push(track);
            item.classList.add('checked');
            const chk = item.querySelector('.atp-item-check'); if (chk) chk.textContent = '✓';
            showToast(`Ajouté à "${escapeHtml(pl.name)}"`, 'success');
          }
        } else {
          // Fallback local si Firebase non disponible
          if (wasIn) {
            pl.tracks = (pl.tracks || []).filter(t => t.id !== track.id);
            item.classList.remove('checked');
            const chk = item.querySelector('.atp-item-check'); if (chk) chk.textContent = '';
            showToast(`Retiré de "${escapeHtml(pl.name)}"`, 'default');
          } else {
            if (!pl.tracks) pl.tracks = [];
            pl.tracks.push(track);
            item.classList.add('checked');
            const chk = item.querySelector('.atp-item-check'); if (chk) chk.textContent = '✓';
            showToast(`Ajouté à "${escapeHtml(pl.name)}"`, 'success');
          }
        }
      }
    });
  });

  // New playlist
  popup.querySelector('#atpNewBtn')?.addEventListener('click', () => {
    closeAllPopups();
    showCreatePlaylistModal(track);
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeAtp(ev) {
      if (!popup.contains(ev.target)) { closeAllPopups(); document.removeEventListener('click', closeAtp); }
    });
  }, 30);
}

// ══════════════════════════════════════════════════════════════════
//  LECTURE LOCALE — Chargement de fichiers audio avec métadonnées
//  Supporte : MP3 (ID3v2), FLAC, M4A/AAC, OGG, WAV, OPUS…
//  Extrait : titre, artiste, album, année, pochette, durée.
// ══════════════════════════════════════════════════════════════════

/** Lit les n premiers octets d'un File comme Uint8Array. */
function _readFileBytes(file, maxBytes) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(new Uint8Array(e.target.result));
    reader.onerror = () => res(new Uint8Array(0));
    reader.readAsArrayBuffer(file.slice(0, maxBytes));
  });
}

/** Décode un entier "syncsafe" (ID3v2). */
function _id3Syncsafe(a, b, c, d) {
  return (a << 21) | (b << 14) | (c << 7) | d;
}

/** Décode du texte ID3 selon l'octet d'encodage. */
function _id3DecodeText(data) {
  if (!data || !data.length) return '';
  const enc = data[0];
  const raw = data.subarray(1);
  try {
    if (enc === 0) {
      // ISO-8859-1
      return Array.from(raw).map(b => String.fromCharCode(b)).join('').replace(/\0.*$/, '').trim();
    } else if (enc === 1 || enc === 2) {
      // UTF-16 (avec ou sans BOM)
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      return new TextDecoder('utf-16le').decode(buf).replace(/\0.*$/, '').trim();
    } else {
      // UTF-8 (enc === 3 ou fallback)
      return new TextDecoder('utf-8').decode(raw).replace(/\0.*$/, '').trim();
    }
  } catch { return ''; }
}

/** Extrait l'image APIC d'un frame ID3v2 et retourne une ObjectURL. */
function _id3DecodeAPIC(data) {
  try {
    const enc = data[0];
    let i = 1;
    // MIME type (ISO-8859-1, null-terminated)
    while (i < data.length && data[i] !== 0) i++;
    const mime = Array.from(data.subarray(1, i)).map(b => String.fromCharCode(b)).join('') || 'image/jpeg';
    i++; // saute le null
    i++; // saute le picture type
    // Description (null-terminated, encodage-dépendant)
    if (enc === 1 || enc === 2) {
      while (i < data.length - 1 && !(data[i] === 0 && data[i+1] === 0)) i += 2;
      i += 2;
    } else {
      while (i < data.length && data[i] !== 0) i++;
      i++;
    }
    if (i >= data.length) return null;
    const blob = new Blob([data.subarray(i)], { type: mime });
    return URL.createObjectURL(blob);
  } catch { return null; }
}

/** Parse les tags ID3v2 d'un fichier et retourne { title, artist, album, year, cover }. */
async function _parseID3v2(file) {
  const result = { title: '', artist: '', album: '', year: '', cover: null };
  const bytes = await _readFileBytes(file, 640 * 1024); // 640 Ko max pour les tags + cover
  if (bytes.length < 10) return result;

  // Vérification signature 'ID3'
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return result;

  const ver   = bytes[3]; // 2, 3 ou 4
  const flags = bytes[5];
  const tagSize = _id3Syncsafe(bytes[6], bytes[7], bytes[8], bytes[9]);

  let offset = 10;
  // Extended header (ID3v2.3+)
  if (ver >= 3 && (flags & 0x40)) {
    const extSize = (bytes[10] << 24) | (bytes[11] << 16) | (bytes[12] << 8) | bytes[13];
    offset += extSize + 4;
  }

  const end = Math.min(10 + tagSize, bytes.length);

  while (offset + 10 < end) {
    // ID3v2.2 utilise des frames de 3 caractères
    let frameId, frameSize;
    if (ver === 2) {
      frameId = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2]);
      frameSize = (bytes[offset+3] << 16) | (bytes[offset+4] << 8) | bytes[offset+5];
      offset += 6;
    } else {
      frameId = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
      frameSize = ver >= 4
        ? _id3Syncsafe(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7])
        : (bytes[offset+4] << 24) | (bytes[offset+5] << 16) | (bytes[offset+6] << 8) | bytes[offset+7];
      offset += 10;
    }

    if (frameSize <= 0 || offset + frameSize > end) break;
    const frameData = bytes.subarray(offset, offset + frameSize);
    offset += frameSize;

    if (!frameId || frameId[0] === '\0') break;

    if (frameId === 'TIT2' || frameId === 'TT2') result.title  = _id3DecodeText(frameData);
    else if (frameId === 'TPE1' || frameId === 'TP1') result.artist = _id3DecodeText(frameData);
    else if (frameId === 'TALB' || frameId === 'TAL') result.album  = _id3DecodeText(frameData);
    else if (frameId === 'TDRC' || frameId === 'TYER' || frameId === 'TYE') result.year = _id3DecodeText(frameData);
    else if ((frameId === 'APIC' || frameId === 'PIC') && !result.cover) {
      result.cover = _id3DecodeAPIC(frameData);
    }
  }
  return result;
}

/** Lit les métadonnées Vorbis Comment d'un fichier OGG/FLAC. */
async function _parseVorbisComment(file) {
  const result = { title: '', artist: '', album: '', year: '', cover: null };
  const bytes = await _readFileBytes(file, 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  const get = key => {
    const re = new RegExp(key + '=([^\n\r]+)', 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  result.title  = get('TITLE');
  result.artist = get('ARTIST');
  result.album  = get('ALBUM');
  result.year   = get('DATE') || get('YEAR');
  // La pochette Vorbis (METADATA_BLOCK_PICTURE) nécessite un décodage base64 complexe — on l'ignore ici.
  return result;
}

/** Dispatch vers le bon parser selon l'extension du fichier. */
async function _extractAudioMeta(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let meta = { title: '', artist: '', album: '', year: '', cover: null };

  try {
    if (['mp3'].includes(ext)) {
      meta = await _parseID3v2(file);
    } else if (['ogg', 'opus', 'flac'].includes(ext)) {
      meta = await _parseVorbisComment(file);
      // FLAC peut aussi avoir des tags ID3v2 en tête
      if (!meta.title) meta = await _parseID3v2(file);
    } else if (['m4a', 'aac', 'mp4'].includes(ext)) {
      // Tenter quand même ID3v2 (certains M4A en ont)
      meta = await _parseID3v2(file);
    }
  } catch { /* fallback: nom de fichier */ }

  // Fallback : extraire titre/artiste du nom de fichier
  const basename = file.name.replace(/\.[^/.]+$/, '');
  if (!meta.title) {
    // Format "Artiste - Titre" ou juste "Titre"
    const sep = basename.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (sep) { meta.artist = meta.artist || sep[1].trim(); meta.title = sep[2].trim(); }
    else     { meta.title = basename; }
  }

  return meta;
}

/** Lit la durée d'un fichier via un élément <audio> temporaire. */
function _getAudioDuration(objectUrl) {
  return new Promise(resolve => {
    const a = new Audio();
    const done = () => { a.src = ''; resolve(isFinite(a.duration) ? a.duration : 0); };
    a.addEventListener('loadedmetadata', done, { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.preload = 'metadata';
    a.src = objectUrl;
  });
}

// ── UI de chargement des fichiers locaux ──────────────────────────────
async function _loadLocalFiles(files) {
  const total = files.length;
  if (!total) return;

  // ── Overlay de progression ────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'localLoadOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9900',
    'background:rgba(0,0,0,0.72)', 'backdrop-filter:blur(8px)',
    'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');
  overlay.innerHTML = `
    <div style="background:#181818;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px 40px;min-width:340px;max-width:480px;text-align:center">
      <div style="font-size:1.05rem;font-weight:600;color:#fff;margin-bottom:6px">Chargement des fichiers audio</div>
      <div id="localLoadSub" style="font-size:.8rem;color:#b3b3b3;margin-bottom:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Préparation…</div>
      <div style="background:#333;border-radius:99px;height:6px;overflow:hidden;margin-bottom:10px">
        <div id="localLoadBar" style="height:100%;background:var(--green,#1ed760);border-radius:99px;width:0%;transition:width .2s ease"></div>
      </div>
      <div id="localLoadCount" style="font-size:.75rem;color:#b3b3b3">0 / ${total}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const barEl   = overlay.querySelector('#localLoadBar');
  const subEl   = overlay.querySelector('#localLoadSub');
  const countEl = overlay.querySelector('#localLoadCount');

  const setProgress = (i, name) => {
    const pct = Math.round((i / total) * 100);
    barEl.style.width   = pct + '%';
    subEl.textContent   = name;
    countEl.textContent = `${i} / ${total}`;
  };

  // ── Traitement de chaque fichier ──────────────────────────────────
  const newTracks = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setProgress(i, file.name);

    const objectUrl = URL.createObjectURL(file);
    const [meta, duration] = await Promise.all([
      _extractAudioMeta(file),
      _getAudioDuration(objectUrl),
    ]);

    newTracks.push({
      id:        'local_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2),
      title:     meta.title  || file.name.replace(/\.[^/.]+$/, ''),
      artist:    meta.artist || 'Artiste inconnu',
      album:     meta.album  || 'Album inconnu',
      year:      meta.year   || '',
      imageUrl:  meta.cover  || null,
      streamUrl: objectUrl,
      duration:  Math.round(duration),
      local:     true,
    });
  }

  setProgress(total, `${total} fichier${total > 1 ? 's' : ''} prêt${total > 1 ? 's' : ''}`);
  await new Promise(r => setTimeout(r, 300)); // petit flash de confirmation

  overlay.remove();

  if (!newTracks.length) return;

  // Insérer en tête de liste + jouer le premier
  const insertIdx = 0;
  tracks.splice(insertIdx, 0, ...newTracks);
  // Décaler currentIndex si nécessaire
  if (currentIndex >= insertIdx) currentIndex += newTracks.length;
  currentIndex = insertIdx;
  playCurrentTrack();

  showToast(
    `${newTracks.length} fichier${newTracks.length > 1 ? 's' : ''} chargé${newTracks.length > 1 ? 's' : ''}`,
    'success'
  );
}

// ══════════════════════════════════════════════════════════════════
//  ETC POPUP — top bar button (raccourcis, sites liés)
// ══════════════════════════════════════════════════════════════════
(function initEtcBtn() {
  const btn = document.getElementById('btnEtc');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.getElementById('etcPopup');
    if (existing) { existing.remove(); return; }

    closeAllPopups();
    const popup = document.createElement('div');
    popup.id = 'etcPopup';
    popup.className = 'etc-popup';

    const rect = btn.getBoundingClientRect();
    popup.style.top  = (rect.bottom + 8) + 'px';
    popup.style.left = rect.left + 'px';

    popup.innerHTML = `
      <div class="etc-popup-section">
        <div class="etc-popup-section-title">Lecture locale</div>
        <div class="etc-popup-item" id="etcLocalFiles">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          Charger des fichiers audio
        </div>
        <div class="etc-popup-item" id="etcLocalFolder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Charger un dossier
        </div>
      </div>
      <div class="etc-popup-section">
        <div class="etc-popup-item" id="etcShortcuts">
          <img src="pictures/icon-search.png" alt="">
          Voir les raccourcis
        </div>
        <div class="etc-popup-item" id="etcSettings">
          <img src="pictures/icon-settings.png" alt="">
          Paramètres
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    const _triggerLocalLoad = (folder) => {
      popup.remove();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.flac,.mp3,.wav,.ogg,.aac,.m4a,.opus,.wma';
      input.multiple = true;
      if (folder) { input.webkitdirectory = true; input.directory = true; }
      input.addEventListener('change', async (ev) => {
        const files = Array.from(ev.target.files || []).filter(f =>
          /\.(mp3|flac|wav|ogg|aac|m4a|opus|wma|ape|mpc|wv|aif|aiff)$/i.test(f.name)
        );
        if (!files.length) return;
        await _loadLocalFiles(files);
      });
      input.click();
    };

    popup.querySelector('#etcLocalFiles')?.addEventListener('click', () => { popup.remove(); _showWipModal(); });
    popup.querySelector('#etcLocalFolder')?.addEventListener('click', () => { popup.remove(); _showWipModal(); });

    popup.querySelector('#etcShortcuts')?.addEventListener('click', () => {
      window._openShortcuts?.();
      popup.remove();
    });

    popup.querySelector('#etcSettings')?.addEventListener('click', () => {
      window._openSettings?.();
      popup.remove();
    });

    setTimeout(() => {
      document.addEventListener('click', function closeEtc(ev) {
        if (!popup.contains(ev.target) && ev.target !== btn) {
          popup.remove();
          document.removeEventListener('click', closeEtc);
        }
      });
    }, 30);
  });
})();

// ── Popup "en cours de développement" ─────────────────────────────
function _showWipModal() {
  if (document.getElementById('wipModal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'wipModal';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9000;background:rgba(0,0,0,0.55);animation:beartifyFadeIn .15s ease';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:28px 32px;text-align:center;max-width:320px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.6)';
  box.innerHTML = `
    <div style="font-size:2rem;margin-bottom:10px">🚧</div>
    <div style="font-size:1rem;font-weight:700;color:#fff;margin-bottom:8px">Fonctionnalité en cours de développement</div>
    <div style="font-size:.82rem;color:rgba(255,255,255,0.5);margin-bottom:12px">Cette fonctionnalité sera disponible dans une prochaine mise à jour.</div>
    <div style="font-size:.82rem;color:rgba(255,255,255,0.7);margin-bottom:20px;line-height:1.55">
      ☕ Les dons me motivent à continuer à développer l'application —
      si tu veux soutenir le projet, c'est par ici :<br>
      <a href="https://buymeacoffee.com/papaourspolaire" target="_blank" rel="noopener"
         style="color:var(--green,#1db954);font-weight:600;word-break:break-all;text-decoration:none">
        buymeacoffee.com/papaourspolaire
      </a>
    </div>
    <button id="wipModalClose" style="background:var(--green,#1db954);border:none;border-radius:20px;color:#000;font-size:.85rem;font-weight:700;padding:8px 24px;cursor:pointer">OK</button>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => { overlay.style.opacity='0'; overlay.style.transition='opacity .2s'; setTimeout(()=>overlay.remove(),200); };
  overlay.querySelector('#wipModalClose').addEventListener('click', close);
  overlay.addEventListener('click', e => { if(e.target===overlay) close(); });
}

// ── Marketplace → WIP ────────────────────────────────────────────
document.getElementById('btnMarketstore')?.addEventListener('click', () => _showWipModal());

// ── Right panel — toggle rétractable ─────────────────────────────
(function _initRightPanelToggle() {
  const panel = document.getElementById('rightPanel');
  if (!panel) return;

  // Flèche SVG carrousel (moderne, épurée) — pointe à GAUCHE pour indiquer que le panneau s'ouvre
  const arrowSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Inject toggle strip inside panel (visible uniquement quand rétracté)
  const strip = document.createElement('div');
  strip.className = 'rp-toggle-strip';
  strip.id = 'rpToggleStrip';
  strip.innerHTML = `<div class="rp-toggle-arrow">${arrowSvg}</div>`;
  strip.title = 'Agrandir';
  panel.prepend(strip);

  function togglePanel() {
    panel.classList.toggle('rp-collapsed');
    const isCollapsed = panel.classList.contains('rp-collapsed');
    strip.title = isCollapsed ? 'Agrandir' : 'Réduire';
  }

  strip.addEventListener('click', togglePanel);

  // Nouveau bouton dans le strip contexte (remplace le toggle quand panneau ouvert)
  const ctxStrip = document.getElementById('rpContextStrip');
  if (ctxStrip) ctxStrip.addEventListener('click', togglePanel);
})();

// ── Mise à jour du nom de contexte dans le strip du panneau droit ──
window._setRpContextName = function(name) {
  const el = document.getElementById('rpContextName');
  if (el) el.textContent = name || '—';
  window._currentRpContextName = name || '—';
};
window._currentRpContextName = '—';

// ══════════════════════════════════════════════════════════════════
//  CAROUSEL FIX — délégation globale pour toutes les flèches
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function patchCarouselArrows() {
  function handleCarouselClick(e) {
    const arrow = e.target.closest('.carousel-arrow');
    if (!arrow) return;
    e.stopImmediatePropagation();
    const wrapper = arrow.closest('.carousel-wrapper');
    const row = wrapper?.querySelector('.home-row-scroll');
    if (!row) return;
    const isNext = arrow.classList.contains('arrow-next') ||
                   arrow.classList.contains('suggest-carousel-next') ||
                   arrow.classList.contains('recently-carousel-next') ||
                   arrow.classList.contains('artist-carousel-next');
    row.scrollBy({ left: isNext ? (148 + 16) * 3 : -(148 + 16) * 3, behavior: 'smooth' });
    setTimeout(() => {
      if (!row.clientWidth && !row.scrollWidth) return;
      const atStart = row.scrollLeft <= 4;
      const atEnd   = row.scrollLeft >= row.scrollWidth - row.clientWidth - 4;
      wrapper.classList.toggle('at-start', atStart);
      wrapper.classList.toggle('at-end',   atEnd);
      arrow.style.pointerEvents = '';
    }, 380);
  }
  // Capture phase sur le document entier couvre tous les carousels
  document.addEventListener('click', handleCarouselClick, true);
});
// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY SETTINGS BRIDGE v3
//  Règles d'or :
//  1. Ne JAMAIS créer un AudioContext ou MediaElementSource au chargement.
//     → Tout est différé à 'audioGraph:ready' (premier play)
//  2. jellyfinUrl / lastfmUrl gèrent proxy prod vs accès local.
//  3. Réagit à 'beartify:settingChanged' pour les mises à jour en temps réel.
// ══════════════════════════════════════════════════════════════════════

// ── Helpers proxy (ré-exportés pour les modules chargés après) ────────
window.jellyfinUrl = window.jellyfinUrl || jellyfinUrl;
window.lastfmUrl   = window.lastfmUrl   || lastfmUrl;

// ══════════════════════════════════════════════════════════════════════
//  AUDIO GRAPH — EQ + Normalization + Mono
//  Tout le routing Web Audio passe par un seul graphe initialisé
//  au premier événement 'audioGraph:ready'.
// ══════════════════════════════════════════════════════════════════════

let _audioGraphReady = false;

/**
 * Réinitialise et reconstruit toute la chaîne audio :
 *   source → [normGain?] → [eqFilters?] → [monoMerger?] → analyser → destination
 * Appelé une fois (audioGraph:ready) puis à chaque changement de config audio.
 */
function _rebuildAudioChain() {
  const ctx      = window._sharedAudioCtx;
  const source   = window._sharedSourceNode;
  const analyser = window._sharedAnalyser;
  if (!ctx || !source) return;
  if (ctx.state === 'suspended') ctx.resume();

  const s = window._getSettings ? window._getSettings() : {};
  const eqEnabled   = !!s.eqEnabled;
  const normEnabled = !!s.normalizeVolume;
  const monoEnabled = !!s.monoAudio;

  try {
    // ── Déconnecter tous les nœuds existants ─────────────────────────
    try { source.disconnect(); } catch(_) {}
    if (window._normGainNode)   { try { window._normGainNode.disconnect();  } catch(_) {} }
    if (window._eqFilters?.length) {
      window._eqFilters.forEach(f => { try { f.disconnect(); } catch(_) {} });
    }
    if (window._monoMerger)     { try { window._monoMerger.disconnect();    } catch(_) {} }

    // ── Construire la chaîne de nœuds actifs ──────────────────────────
    let current = source; // dernier nœud de la chaîne

    // 1. Normalisation du volume
    if (normEnabled) {
      if (!window._normGainNode) window._normGainNode = ctx.createGain();
      window._normGainNode.gain.value = 0.85;
      current.connect(window._normGainNode);
      current = window._normGainNode;
    }

    // 2. Égaliseur 6 bandes
    if (eqEnabled) {
      if (!window._eqFilters || window._eqFilters.length === 0) {
        // Créer les filtres si pas encore fait
        const _EQ_BANDS_LOCAL = [
          { freq:60,    type:'lowshelf'  },
          { freq:150,   type:'peaking'   },
          { freq:400,   type:'peaking'   },
          { freq:1000,  type:'peaking'   },
          { freq:2400,  type:'peaking'   },
          { freq:15000, type:'highshelf' },
        ];
        window._eqFilters = _EQ_BANDS_LOCAL.map(b => {
          const f = ctx.createBiquadFilter();
          f.type = b.type; f.frequency.value = b.freq; f.gain.value = 0; f.Q.value = 1.4;
          return f;
        });
        for (let i = 0; i < window._eqFilters.length - 1; i++)
          window._eqFilters[i].connect(window._eqFilters[i + 1]);
      }
      // Appliquer les gains sauvegardés
      const gains = s.eqGains || window._eqGains || [0,0,0,0,0,0];
      window._eqFilters.forEach((f, i) => { f.gain.value = gains[i] ?? 0; });
      current.connect(window._eqFilters[0]);
      current = window._eqFilters[window._eqFilters.length - 1];
      window._eqInserted = true;
    }

    // 3. Mono audio
    if (monoEnabled) {
      if (!window._monoMerger) {
        window._monoMerger = ctx.createChannelMerger(2);
        window._monoSplitter = ctx.createChannelSplitter(2);
      }
      current.connect(window._monoSplitter);
      window._monoSplitter.connect(window._monoMerger, 0, 0);
      window._monoSplitter.connect(window._monoMerger, 0, 1);
      current = window._monoMerger;
    }

    // 4. Terminer : → analyser → destination
    if (analyser) {
      current.connect(analyser);
      analyser.connect(ctx.destination);
    } else {
      current.connect(ctx.destination);
    }

    _audioGraphReady = true;
    console.log(`[AudioGraph] Chaîne reconstruite — EQ:${eqEnabled} Norm:${normEnabled} Mono:${monoEnabled}`);
  } catch(e) {
    console.warn('[AudioGraph] Erreur rebuild:', e);
  }
}

// Écouter l'événement 'audioGraph:ready' au premier play
document.addEventListener('audioGraph:ready', () => {
  _rebuildAudioChain();
  // Exposer pour settings.js
  window._initEQChain    = () => { if (!_audioGraphReady) _rebuildAudioChain(); return _audioGraphReady; };
  window._applyEQGains   = (gains) => {
    window._eqGains = [...gains];
    if (window._eqFilters?.length) window._eqFilters.forEach((f,i) => { f.gain.value = gains[i] ?? 0; });
    const s = window._getSettings?.() || {};
    if (s.eqEnabled !== undefined) { s.eqGains = gains; }
  };
}, { once: true });

// ══════════════════════════════════════════════════════════════════════
//  FONCTIONS PARAMÈTRES — toutes sans AudioContext direct
// ══════════════════════════════════════════════════════════════════════

window._applyVolumeLevel = function(level) {
  const factor = { quiet: 0.5, normal: 0.85, high: 1.0 }[level] ?? 1.0;
  window._volumeLevelFactor = factor;
  const ap = document.getElementById('audioPlayer');
  const sl = document.getElementById('volumeSlider');
  if (ap && sl) ap.volume = Math.min(1, (sl.value / 100) * factor);
};

window._applyMonoAudio = function(enabled) {
  // Pas d'AudioContext direct — on passe par _rebuildAudioChain
  if (_audioGraphReady) _rebuildAudioChain();
  else if (enabled) document.addEventListener('audioGraph:ready', _rebuildAudioChain, { once: true });
};

window._applyNormalization = function(enabled) {
  if (_audioGraphReady) _rebuildAudioChain();
  else if (enabled) document.addEventListener('audioGraph:ready', _rebuildAudioChain, { once: true });
};

window._applyPrivateSession = function(enabled) {
  document.body.classList.toggle('private-session', enabled);
  if (enabled) window.FirebaseSync?.updatePresence?.('stopped');
  let badge = document.getElementById('privateSessionBadge');
  if (enabled && !badge) {
    badge = Object.assign(document.createElement('div'), {
      id: 'privateSessionBadge',
      textContent: '🔒 Session privée',
    });
    badge.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);border:1px solid var(--green);color:var(--green);font-size:.72rem;font-weight:600;padding:4px 12px;border-radius:20px;z-index:8100;pointer-events:none';
    document.body.appendChild(badge);
  } else if (!enabled && badge) badge.remove();
};

window._applyExplicitFilter = function(allowed) {
  window._explicitAllowed = allowed;
  document.body.classList.toggle('explicit-hidden', !allowed);
};

window._applyCompactLibrary  = e => document.getElementById('sidebar')?.classList.toggle('library-compact', e);
window._applyShowLocalFiles  = e => { document.body.classList.toggle('local-files-visible', e); document.querySelectorAll('[data-local="true"]').forEach(el => { el.style.display = e ? '' : 'none'; }); };
window._applyFriendsActivity = e => { const b = document.getElementById('btnFriends'); if (b) b.style.display = e ? '' : 'none'; };
window._applyDownloadQuality = q => { window._streamBitrate    = { low:96000, normal:192000, high:320000, veryhigh:0 }[q] ?? 0; };
window._applyAudioQuality    = q => { window._streamMaxBitrate = { low:96000, normal:192000, high:320000 }[q] ?? 0; };

// ── Auto Mix (fade-in sur chaque piste) ───────────────────────────────
document.getElementById('audioPlayer')?.addEventListener('playing', function() {
  if (!window._settingsAutoMix) return;
  const ap = this, target = ap.volume || 1;
  ap.volume = 0; let step = 0;
  const t = setInterval(() => { step++; ap.volume = Math.min(target, step / 20 * target); if (step >= 20) clearInterval(t); }, 50);
});

// ── Media Overlay ─────────────────────────────────────────────────────
let _mediaOvT = null;
window._applyMediaOverlay = function(enabled) {
  window._settingsMediaOverlay = enabled;
  if (!enabled) { document.getElementById('mediaKeyOverlay')?.remove(); return; }
  if (!('mediaSession' in navigator)) return;
  const icons = { play:'▶', pause:'⏸', previoustrack:'⏮', nexttrack:'⏭' };
  const show = a => {
    if (!window._settingsMediaOverlay) return;
    let ov = document.getElementById('mediaKeyOverlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'mediaKeyOverlay'; ov.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:8200;pointer-events:none;transition:opacity .3s'; document.body.appendChild(ov); }
    ov.style.opacity = '1';
    ov.innerHTML = `<div style="background:rgba(0,0,0,0.82);border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:18px 34px;text-align:center;animation:beartifyFadeIn .15s ease"><div style="font-size:2.4rem">${icons[a]||'⏯'}</div></div>`;
    clearTimeout(_mediaOvT);
    _mediaOvT = setTimeout(() => { ov.style.opacity = '0'; setTimeout(() => { if(ov) ov.innerHTML=''; }, 320); }, 900);
  };
  ['play','pause','previoustrack','nexttrack'].forEach(a => {
    try { navigator.mediaSession.setActionHandler(a, () => { show(a); if(a==='play'||a==='pause') document.getElementById('playPauseBtn')?.click(); else if(a==='nexttrack') typeof goNext==='function'&&goNext(); else if(a==='previoustrack') typeof goPrev==='function'&&goPrev(); }); } catch(_) {}
  });
};

// ── CSS injections ────────────────────────────────────────────────────
(function() {
  if (document.getElementById('beartify-bridge-css')) return;
  const st = document.createElement('style'); st.id='beartify-bridge-css';
  st.textContent = `
    .library-compact .track-item{padding:4px 8px!important;min-height:40px!important}
    .library-compact .track-icon{width:32px!important;height:32px!important;flex-shrink:0}
    .library-compact .lib-static-item,.library-compact .sidebar-playlist-hint{padding:5px 8px!important}
    .explicit-hidden [data-explicit="true"]{opacity:.3;pointer-events:none}
    body.private-session #btnFriends{opacity:.4!important;pointer-events:none}
    body:not(.local-files-visible) [data-local="true"]{display:none!important}
    .sp-section{background:transparent!important}
    #mediaKeyOverlay{transition:opacity .3s}
    @keyframes beartifyFadeIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
  `;
  document.head.appendChild(st);
})();

// ══════════════════════════════════════════════════════════════════════
//  INIT — applique les paramètres sauvegardés (sans AudioContext)
// ══════════════════════════════════════════════════════════════════════
function _applyAllSettingsBridge() {
  const s = window._getSettings?.() || {};
  if (!Object.keys(s).length) return;
  window._applyVolumeLevel(s.volumeLevel || 'high');
  window._applyPrivateSession(!!s.privateSession);
  window._applyExplicitFilter(s.explicitContent !== false);
  window._applyCompactLibrary(!!s.compactLibrary);
  window._applyShowLocalFiles(!!s.showLocalFiles);
  window._applyFriendsActivity(s.showFriendsActivity !== false);
  window._applyDownloadQuality(s.downloadQuality || 'high');
  window._applyAudioQuality(s.audioQuality || 'high');
  window._settingsAutoMix          = !!s.autoMix;
  window._settingsNowPlayingPanel  = s.showNowPlayingPanel !== false;
  const _rp = document.getElementById('rightPanel');
  if (_rp) _rp.classList.toggle('rp-setting-hidden', !window._settingsNowPlayingPanel);
  window._settingsCrossfade        = s.crossfadeDuration ?? 0;
  window._settingsNormalize        = s.normalizeVolume ?? false;
  window._settingsGapless          = s.gaplessPlayback  ?? false;
  window._settingsAutoplay         = s.autoplay          ?? true;
  window._settingsBroadcast        = s.broadcastListening ?? true;
  window._settingsSaveHistory      = s.saveHistory ?? true;
  window._eqEnabled                = s.eqEnabled ?? false;
  window._eqGains                  = s.eqGains ? [...s.eqGains] : [0,0,0,0,0,0];
  window._eqActivePreset           = s.eqPreset || 'Aucune correction';
  window._applyMediaOverlay(s.showMediaOverlay !== false);
  window._applyLanguage?.(s.language || 'fr');
  // Audio (EQ/Norm/Mono) sera appliqué à audioGraph:ready — pas maintenant
}

// ── Réagir aux changements individuels ────────────────────────────────
document.addEventListener('beartify:settingChanged', ({ detail: { key, value } = {} }) => {
  if (!key) return;
  ({
    monoAudio:           () => window._applyMonoAudio(value),
    volumeLevel:         () => window._applyVolumeLevel(value),
    autoMix:             () => { window._settingsAutoMix = value; },
    privateSession:      () => window._applyPrivateSession(value),
    explicitContent:     () => window._applyExplicitFilter(value),
    compactLibrary:      () => window._applyCompactLibrary(value),
    showLocalFiles:      () => window._applyShowLocalFiles(value),
    showNowPlayingPanel: () => {
      window._settingsNowPlayingPanel = value;
      const rp = document.getElementById('rightPanel');
      if (rp) rp.classList.toggle('rp-setting-hidden', !value);
    },
    showMediaOverlay:    () => window._applyMediaOverlay(value),
    showFriendsActivity: () => window._applyFriendsActivity(value),
    downloadQuality:     () => window._applyDownloadQuality(value),
    audioQuality:        () => window._applyAudioQuality(value),
    crossfadeDuration:   () => { window._settingsCrossfade = value; },
    normalizeVolume:     () => { window._settingsNormalize = value; window._applyNormalization(value); },
    gaplessPlayback:     () => { window._settingsGapless = value; },
    autoplay:            () => { window._settingsAutoplay = value; },
    broadcastListening:  () => { window._settingsBroadcast = value; },
    saveHistory:         () => { window._settingsSaveHistory = value; },
    language:            () => window._applyLanguage?.(value),
    lyricsSimpleMode:    () => typeof toggleSimpleLyricsMode === 'function' && toggleSimpleLyricsMode(value),
    playlistsVisible:    () => window.FirebaseSync?.updateProfileVisibility?.('playlistsVisible', value),
    showFollowers:       () => window.FirebaseSync?.updateProfileVisibility?.('showFollowers', value),
    showRecentArtists:   () => window.FirebaseSync?.updateProfileVisibility?.('showRecentArtists', value),
    eqEnabled: () => {
      window._eqEnabled = value;
      if (_audioGraphReady) _rebuildAudioChain();
      else if (value) document.addEventListener('audioGraph:ready', _rebuildAudioChain, { once: true });
    },
    eqGains: () => {
      window._eqGains = [...value];
      if (window._eqEnabled && window._eqFilters?.length)
        window._eqFilters.forEach((f, i) => { f.gain.value = value[i] ?? 0; });
    },
    shuffleStyle: () => {
      if (typeof isShuffled !== 'undefined' && isShuffled) {
        window._resetShuffleHistory?.();
        const pool = window._playContext?.length ? window._playContext : [...tracks.keys()];
        const pt   = pool.map(i => tracks[i]).filter(Boolean);
        const sh   = window._buildShuffleQueue?.(pt, pool.indexOf(currentIndex)) || pt.sort(() => Math.random() - 0.5);
        shuffleOrder = sh.map(t => tracks.indexOf(t)).filter(i => i !== -1);
        showToast(`⇄ ${value === 'diversified' ? 'Diversifié' : 'Standard'}`, 'info');
      }
    },
  })[key]?.();
});

// ── Volume slider → facteur niveau ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(_applyAllSettingsBridge, 150);
  document.getElementById('volumeSlider')?.addEventListener('input', e => {
    const ap = document.getElementById('audioPlayer');
    if (ap) ap.volume = Math.min(1, (e.target.value / 100) * (window._volumeLevelFactor ?? 1));
  });
});
if (document.readyState !== 'loading') setTimeout(_applyAllSettingsBridge, 150);

window._applyAllSettings = _applyAllSettingsBridge;