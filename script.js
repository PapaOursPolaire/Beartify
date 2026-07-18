// ══════════════════════════════════════════════════════════════════
//  Beartify – script.js  (v2 - SpicyLyrics + carousels + favorites)
//  ✅ Compatible Tauri V2 : desktop (.exe / .AppImage) + Android (.apk)
// ══════════════════════════════════════════════════════════════════

// ── Détection Tauri V2 ────────────────────────────────────────────
/**
 * _IS_TAURI  : true quand le code tourne dans un WebView Tauri (desktop ou mobile).
 *   window.__TAURI__           → Tauri v1 (legacy)
 *   window.__TAURI_INTERNALS__ → Tauri v2
 *
 * _IS_ANDROID : true sur Android (.apk) - les popups OAuth ne fonctionnent
 *   pas dans le WebView Android → firebase-config.js utilise signInWithRedirect.
 *
 * Ces deux valeurs sont exposées sur window pour que firebase-config.js
 * (chargé après) puisse les lire directement.
 */
const _IS_TAURI   = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
const _IS_ANDROID = _IS_TAURI && /Android/i.test(navigator.userAgent);
window._IS_TAURI   = _IS_TAURI;
window._IS_ANDROID = _IS_ANDROID;

// ── Détection Android élargie (site web mobile OU .apk Tauri) ──────
// _IS_ANDROID ci-dessus ne vaut true QUE dans le contexte Tauri (utilisé
// pour la bascule popup/redirect OAuth — ne pas changer sa sémantique).
// Pour cacher des éléments d'UI qui ne fonctionnent pas sur Android (ex:
// bouton Marketplace), il faut détecter Android peu importe si on est dans
// le site web mobile classique ou dans l'app Tauri — d'où ce 2e flag,
// indépendant de _IS_TAURI, posé en classe CSS sur <html> pour un ciblage
// simple et fiable même si la largeur d'écran dépasse le seuil "mobile"
// (tablette Android en paysage, etc.).
const _IS_ANDROID_UA = /Android/i.test(navigator.userAgent);
window._IS_ANDROID_UA = _IS_ANDROID_UA;
if (_IS_ANDROID_UA) document.documentElement.classList.add('is-android');

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
  ? (localStorage.getItem('beartify_server_url') || 'https://beartify.duckdns.org/')
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
  if (path.startsWith('/')) return _TAURI_SERVER_BASE.replace(/\/+$/, '') + path;
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

// Références internes uniquement - construites à l'exécution pour ne pas
// apparaître comme chaînes literals dans la source distribuée.
// [0] = hôte streaming  [1] = hôte lyrics
const _SVC = [
  ['grizzly-stream', 'duckdns', 'org'].join('.'),
  ['grizzlyrics',    'duckdns', 'org'].join('.'),
];

const _JELLY_KEY       = '';   // clé injectée par le proxy - jamais côté client
const _LASTFM_KEY      = '';   // clé injectée par le proxy - jamais côté client
const _USE_PROXY       = true; // toujours actif

// ✅ TAURI : LYRICS_API utilise _resolveProxyUrl() → URL absolue en Tauri
const LYRICS_API       = _resolveProxyUrl('/api/lyrics/api/search.php');
const JELLYFIN_URL     = '';   // legacy - utiliser jellyfinUrl()
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
    // Cas 1 : URL absolue - on vérifie le hostname
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
 * ── Optimisation covers (perf) ───────────────────────────────────────
 * Construit une URL de cover Jellyfin dimensionnée pour son contexte
 * d'affichage, avec le tag d'image (ImageTags.Primary) inclus dans
 * l'URL. Le tag rend l'URL unique par version de l'image : si la cover
 * change sur le serveur, l'URL change aussi, donc on peut demander au
 * navigateur (et à Caddy) de la cacher de façon "immutable" très
 * longtemps sans jamais risquer de servir une image périmée.
 *
 * ⚠️ Pour que le cache navigateur soit vraiment long, ajoutez côté
 * Caddy sur la route "/api/jellyfin/.../Images/..." :
 *   header Cache-Control "public, max-age=31536000, immutable"
 *
 * @param {string} itemId - Id Jellyfin de l'item (morceau ou album)
 * @param {number} width  - largeur cible en px (64 = vignette liste,
 *                           300 = card/cover standard, 1200 = zoom HD)
 * @param {string} [tag]  - ImageTags.Primary / AlbumPrimaryImageTag
 */
function jellyImg(itemId, width, tag) {
  if (!itemId) return null;
  const t = tag ? `&tag=${encodeURIComponent(tag)}` : '';
  return jellyfinUrl(`/Items/${itemId}/Images/Primary?width=${width}&quality=82${t}`);
}

// Tailles standard utilisées dans toute l'app — un seul endroit à
// modifier si on veut ajuster le compromis netteté / poids réseau.
const IMG_SIZE_THUMB = 64;   // lignes de liste, queue, mosaïques, avatars
const IMG_SIZE_CARD  = 300;  // cards home, cover album/lecteur
const IMG_SIZE_ZOOM  = 1200; // zoom cover plein écran
// ══════════════════════════════════════════════════════════════════
//  HLS DRM — Lecture chiffrée AES-128 + Honeypot Rick Roll (v6)
//
//  Flux :
//   1. /api/hls/session/:id   → drm.js génère clé AES-128 + token session
//                               + honeypotTag aléatoire + lance ffmpeg FLAC fMP4
//   2. /api/hls/playlist/:id  → M3U8 avec vrais segments + honeypots (tag aléatoire)
//   3. HLS.js (loader custom) filtre les honeypots via le tag de session
//   4. /api/hls/key/:id       → clé AES-128 (IP-lockée, renouvelée auto)
//   5. /api/hls/segment/:id/* → segments .m4s chiffrés AES-128-CBC (IV par séquence)
//
//  Protections v6 :
//   - Tag honeypot aléatoire par session → non filtrable
//   - IV différent par segment (numéro de séquence HLS)
//   - Kill ffmpeg à la destruction de session
//   - Renouvellement automatique TTL session
//   - Lecture segments async (non-bloquant)
//   - FLAC lossless passthrough (sans -ar ni -ac)
// ══════════════════════════════════════════════════════════════════

let _hlsPlayer = null;
let _hlsLoadGen = 0; // incremented on every new playCurrentTrack call; stale load calls abort themselves
function _loadHlsJs() {
  if (typeof Hls !== 'undefined') return Promise.resolve(window.Hls);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';
    s.onload  = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('HLS.js CDN indisponible'));
    document.head.appendChild(s);
  });
}

function _stripHoneypotSegments(m3u8, honeypotTag) {
  // Filtre sur le tag aléatoire de la session (ex: EXT-X-A3F2B1)
  // Format dans le M3U8 : #EXT-X-A3F2B1 (sans le # initial dans honeypotTag)
  const tagLine = honeypotTag ? ('#' + honeypotTag) : '#EXT-X-BEARTIFY-HONEYPOT';
  const lines   = m3u8.split('\n');
  const result  = [];
  let skip = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // Sauter le tag + #EXT-X-KEY suivant + #EXTINF + URL (4 lignes)
    if (t === tagLine) { skip = 4; continue; }
    if (skip > 0) { skip--; continue; } // ← supprimé : && t !== ''
    result.push(lines[i]);
  }
  return result.join('\n');
}

function _createHoneypotLoader(DefaultLoader, honeypotTag) {
  return class HoneypotLoader extends DefaultLoader {
    load(context, config, callbacks) {
      if (context.type === 'manifest' || context.type === 'level') {
        const onSuccess = callbacks.onSuccess;
        callbacks.onSuccess = (response, stats, ctx, net) => {
          if (typeof response.data === 'string') {
            response.data = _stripHoneypotSegments(response.data, honeypotTag);
          }
          onSuccess(response, stats, ctx, net);
        };
      }
      super.load(context, config, callbacks);
    }
  };
}

async function loadHLSPlayer(itemId, audioEl, bitrate) {
  const Hls = await _loadHlsJs();

  if (!Hls.isSupported()) {
    // Safari : HLS natif (AES-128 supporté nativement)
    const sessR = await fetch(_resolveProxyUrl('/api/hls/session/' + itemId));
    if (!sessR.ok) throw new Error('session ' + sessR.status);
    const { sessionToken } = await sessR.json();
    let url = _resolveProxyUrl('/api/hls/playlist/' + itemId) + '?s=' + encodeURIComponent(sessionToken);
    if (bitrate) url += '&bitrate=' + bitrate;
    audioEl.src = url;
    return null;
  }

  if (_hlsPlayer) { _hlsPlayer.destroy(); _hlsPlayer = null; }

  // Créer la session DRM (clé AES + ffmpeg + honeypotTag aléatoire)
  let sessUrl = _resolveProxyUrl('/api/hls/session/' + itemId);
  if (bitrate) sessUrl += '?bitrate=' + bitrate;
  const sessResp = await fetch(sessUrl);
  if (!sessResp.ok) throw new Error('HLS session HTTP ' + sessResp.status);
  const { sessionToken, honeypotTag } = await sessResp.json();

  const playlistUrl = _resolveProxyUrl('/api/hls/playlist/' + itemId)
                    + '?s=' + encodeURIComponent(sessionToken);

  const hls = new Hls({
    loader:           _createHoneypotLoader(Hls.DefaultConfig.loader, honeypotTag),
    enableWorker:     true,
    lowLatencyMode:   false,
    maxBufferLength:  30,
    backBufferLength: 15,
    // Fix démarrage : forcer position 0 (pas de live edge)
    startPosition:    0,
    liveBackBufferLength:  Infinity,
    liveSyncDurationCount: 3,
    manifestLoadingTimeOut:  30000,
    levelLoadingTimeOut:     30000,
    fragLoadingTimeOut:      60000,
  });

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) {
      console.error('[HLS] Erreur fatale :', data.type, data.details);
      hls.destroy();
      _hlsPlayer = null;
    }
  });

  hls.loadSource(playlistUrl);
  hls.attachMedia(audioEl);
  _hlsPlayer = hls;
  return hls;
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
 * normalizeJellyfinUrl - convertit toute URL Jellyfin absolue en chemin
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

/** Normalise streamUrl + imageUrl (+ variantes thumb/hi-res) d'un track in-place. */
function normalizeTrack(track) {
  if (!track) return track;
  if (track.streamUrl)     track.streamUrl     = normalizeJellyfinUrl(track.streamUrl);
  if (track.imageUrl)      track.imageUrl       = normalizeJellyfinUrl(track.imageUrl);
  if (track.imageUrlThumb) track.imageUrlThumb  = normalizeJellyfinUrl(track.imageUrlThumb);
  return track;
}

// ══════════════════════════════════════════════════════════════════════
//  INTERCEPTEUR GLOBAL - garantit qu'aucun appel réseau ne part
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
  } catch { /* URL relative ou invalide - on ne touche pas */ }

  // ✅ TAURI FIX : chemin relatif /api/* → absolu vers le serveur proxy.
  // Dans un navigateur, les chemins /api/* sont servis par le proxy sur la
  // même origine, donc pas besoin de les réécrire. Dans Tauri, l'origine
  // tauri://localhost n'a aucune route /api/* → on préfixe avec le serveur.
  if (_IS_TAURI && rawUrl.startsWith('/api/')) {
    return _TAURI_SERVER_BASE + rawUrl;
  }

  return rawUrl;
}

/** Patch window.fetch - intercepte TOUS les fetch() de la page. */
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
 * Patch XMLHttpRequest.open - intercepte les XHR qui échapperaient
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
 * MutationObserver - normalise les attributs src/srcset de toute
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
// Playlists favorites + ordre personnalisé
let favoritePlaylists = new Set(JSON.parse(localStorage.getItem('favoritePlaylists') || '[]'));
let playlistOrder     = JSON.parse(localStorage.getItem('playlistOrder') || '[]'); // [id, id, …]
// Tri de la sidebar Albums / Artistes
let libSortKey = 'alpha';   // 'alpha'|'recent'|'artist'|'count'|'favFirst'
let libSortDir = 1;

// ── SVG bookmarks (module-level, réutilisables partout) ──────────
const _BKMK_FILLED = `<span class="detail-bookmark-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd"/></svg></span>`;
const _BKMK_EMPTY  = `<span class="detail-bookmark-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"/></svg></span>`;

// ── Caches albumMap / artistMap (invalidés si tracks change) ────
let _libAlbumCache = null;
let _libArtistCache = null;
function _getLibAlbumMap() {
  if (_libAlbumCache) return _libAlbumCache;
  const m = new Map();
  tracks.forEach(t => {
    if (!m.has(t.album)) m.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl, imageUrlThumb: t.imageUrlThumb, count: 0 });
    const a = m.get(t.album); a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
    if (!a.imageUrlThumb && t.imageUrlThumb) a.imageUrlThumb = t.imageUrlThumb;
  });
  _libAlbumCache = m;
  return m;
}
function _getLibArtistMap() {
  if (_libArtistCache) return _libArtistCache;
  const m = new Map();
  tracks.forEach(t => {
    if (!m.has(t.artist)) m.set(t.artist, { name: t.artist, imageUrl: t.imageUrl, imageUrlThumb: t.imageUrlThumb, count: 0 });
    const a = m.get(t.artist); a.count++;
    if (!a.imageUrl && t.imageUrl) a.imageUrl = t.imageUrl;
    if (!a.imageUrlThumb && t.imageUrlThumb) a.imageUrlThumb = t.imageUrlThumb;
  });
  _libArtistCache = m;
  return m;
}
function _invalidateLibCache() { _libAlbumCache = null; _libArtistCache = null; }

// ── Exposition sur window pour Firebase Sync ──────────────────────
window.likedTracks     = likedTracks;
window.favoriteAlbums  = favoriteAlbums;
window.favoriteArtists = favoriteArtists;
window.recentlyPlayed  = recentlyPlayed;
// Exposé pour onboarding.js (liste d'artistes réels pour l'étape de sélection des goûts)
window.tracks           = tracks;
window.customPlaylists = {}; // sera rempli depuis Firestore au chargement
// ── Contexte de lecture actif ──────────────────────────────────────────────────
// _playContextIds : source de vérité stable — tableau d'IDs Jellyfin.
// _playContext    : tableau d'indices dérivé, recalculé dynamiquement via _resolveCtx().
window._playContextIds = null;
_setPlayContext(null);

// Définir le contexte depuis un tableau d'IDs stables.
function _setPlayContext(ids) {
  if (!ids || ids.length === 0) {
    window._playContextIds = null;
    window._playContext    = null;
    return;
  }
  window._playContextIds = ids;
  window._playContext    = ids.map(id => tracks.findIndex(t => t.id === id)).filter(i => i !== -1);
}

// Recalculer _playContext (indices) depuis _playContextIds avec tracks courant.
// Appeler au début de goNext/goPrev.
function _resolveCtx() {
  if (!window._playContextIds) { _setPlayContext(null); return; }
  window._playContext = window._playContextIds.map(id => tracks.findIndex(t => t.id === id)).filter(i => i !== -1);
  if (window._playContext.length === 0) { _setPlayContext(null); }
}

// Recaler currentIndex depuis l'ID de la piste en cours après rechargement de tracks.
function _resolveCurrentIndex() {
  if (!window._currentTrackId) return;
  const fresh = tracks.findIndex(t => t.id === window._currentTrackId);
  if (fresh !== -1) currentIndex = fresh;
}

// ── Injection à la volée d'une piste pas encore chargée ─────────────
// Pendant la synchro complète en arrière-plan (voir aperçu rapide),
// `tracks` ne contient qu'un sous-ensemble de la bibliothèque. Si on
// clique une piste absente (carrousel "Récemment joués", playlist...),
// on la récupère depuis la liste déjà affichée et on l'ajoute ici.
// Centralisé (au lieu de dupliquer la logique à chaque endroit) pour
// éviter les doublons et garder `shuffleOrder` cohérent : sans ça, une
// 2e/3e piste ajoutée après coup avait un index absent de shuffleOrder,
// ce qui cassait goNext() dès qu'on tombait sur l'une d'entre elles.
function _ensureTrackInLibrary(track) {
  if (!track?.id) return -1;
  let idx = tracks.findIndex(t => t.id === track.id);
  if (idx !== -1) return idx; // déjà présente, rien à faire (pas de doublon)
  tracks.push(track);
  idx = tracks.length - 1;
  if (Array.isArray(shuffleOrder)) shuffleOrder.push(idx);
  return idx;
}

// Variante "upsert" pour le delta sync : contrairement à _ensureTrackInLibrary
// (qui ignore si déjà présente), ici on REMPLACE l'entrée existante — le but
// du delta sync est justement de refléter des métadonnées modifiées, pas
// seulement d'ajouter des titres inconnus.
function _upsertTrackInLibrary(track) {
  if (!track?.id) return -1;
  const idx = tracks.findIndex(t => t.id === track.id);
  if (idx !== -1) { tracks[idx] = track; return idx; }
  tracks.push(track);
  const newIdx = tracks.length - 1;
  if (Array.isArray(shuffleOrder)) shuffleOrder.push(newIdx);
  return newIdx;
}

// ── Chargement à la demande d'un album (façon Spotify) ───────────────
// Tant que la synchro complète de la bibliothèque n'est pas terminée en
// arrière-plan, `tracks` peut ne contenir qu'une partie des titres d'un
// album (ex: 3 titres sur 12). Plutôt que d'attendre la sync complète,
// on interroge directement Jellyfin pour CET album précis via son
// AlbumId — une requête ciblée et légère, indépendante de la taille de
// la bibliothèque globale.
// ── Chargement à la demande d'un artiste / discographie ──────────────
// Même principe que pour les albums : on résout d'abord l'ArtistId
// (recherche légère par nom), puis on récupère tous ses titres via
// ArtistIds, indépendamment de l'état de la synchro complète.
// ── Recherche à la demande (façon Spotify) ────────────────────────────
// Même principe que les albums/artistes : tant que la synchro complète
// n'est pas terminée, `tracks` ne contient qu'un sous-ensemble de la
// bibliothèque, donc chercher un titre absent de ce sous-ensemble ne
// remontait rien — obligeant à attendre la fin du chargement complet
// pour que la recherche fonctionne. On interroge directement Jellyfin
// via SearchTerm, indépendamment de l'état de la synchro.
async function _searchTracksServer(term) {
  if (!term?.trim()) return null;
  try {
    const userId = await _waitForUserId(3000);
    if (!userId) return null;
    const r = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&SearchTerm=${encodeURIComponent(term)}&Limit=50&Fields=${JELLY_FIELDS}`),
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data.Items || []).map(normaliseTrack);
  } catch (e) {
    console.warn('[Beartify] _searchTracksServer échoué :', e);
    return null;
  }
}

// ── Chargement à la demande par liste d'IDs ──────────────────────────
// Utilisé pour les vues où l'on connaît déjà les IDs exacts recherchés
// (ex: titres likés) — bien plus léger qu'une recherche texte, puisqu'on
// demande directement les items précis par leur identifiant Jellyfin.
async function _fetchTracksByIds(ids) {
  if (!ids?.length) return null;
  try {
    const userId = await _waitForUserId(3000);
    if (!userId) return null;
    const r = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&Ids=${ids.join(',')}&Fields=${JELLY_FIELDS}`),
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data.Items || []).map(normaliseTrack);
  } catch (e) {
    console.warn('[Beartify] _fetchTracksByIds échoué :', e);
    return null;
  }
}

async function _fetchArtistTracksByName(name) {
  if (!name) return null;
  try {
    // _waitForUserId a son propre timeout (5s par défaut) ; on borne aussi
    // chacune des deux requêtes séquentielles (résolution ArtistId puis
    // récupération des titres) pour éviter qu'un Jellyfin lent ne bloque
    // l'ouverture de la discographie pendant 10+ secondes au total.
    const userId = await _waitForUserId(4000);
    if (!userId) return null;
    const searchResp = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&IncludeItemTypes=MusicArtist&Recursive=true&SearchTerm=${encodeURIComponent(name)}&Limit=5`),
      { signal: AbortSignal.timeout(4000) }
    );
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json();
    const artistItem = (searchData.Items || []).find(a => a.Name === name) || (searchData.Items || [])[0];
    if (!artistItem) return null;

    const r = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&ArtistIds=${artistItem.Id}&Fields=${JELLY_FIELDS}`),
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data.Items || []).map(normaliseTrack);
  } catch (e) {
    console.warn('[Beartify] _fetchArtistTracksByName échoué :', e);
    return null;
  }
}

// Attend que window._jellyfinUserId soit prêt (résolu très tôt dans
// _refreshTracksFromServer, mais un clic peut arriver avant, dans la
// toute première seconde). Évite les échecs silencieux des fetchs à la
// demande (album/artiste) quand ils sont déclenchés trop vite.
async function _waitForUserId(timeoutMs = 5000) {
  const start = Date.now();
  while (!window._jellyfinUserId) {
    if (Date.now() - start > timeoutMs) return null;
    await new Promise(r => setTimeout(r, 150));
  }
  return window._jellyfinUserId;
}

async function _fetchAlbumTracksById(albumId) {
  if (!albumId) return null;
  try {
    const userId = await _waitForUserId();
    if (!userId) return null;
    const r = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&AlbumIds=${albumId}&Fields=${JELLY_FIELDS}`)
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data.Items || []).map(normaliseTrack);
  } catch (e) {
    console.warn('[Beartify] _fetchAlbumTracksById échoué :', e);
    return null;
  }
}

async function _fetchYearTracks(year) {
  if (!year) return null;
  try {
    const userId = await _waitForUserId();
    if (!userId) return null;
    const r = await fetch(
      jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&Years=${encodeURIComponent(year)}&Fields=${JELLY_FIELDS}`)
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data.Items || []).map(normaliseTrack);
  } catch (e) {
    console.warn('[Beartify] _fetchYearTracks échoué :', e);
    return null;
  }
}
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
const BLUR_MULTIPLIER        = 0.4; // ⚠️ Était 1.25 — réduit fortement : le flou des
// lignes voisines de la ligne active pouvait déborder visuellement dans son
// espace (filter:blur() n'est pas garanti d'être parfaitement contenu par
// overflow:hidden sur le MÊME élément selon les navigateurs), créant un
// effet de texte dédoublé/fantôme au début de chaque ligne. Avec cette
// valeur, même une éventuelle imperfection de confinement CSS ne produit
// plus assez de flou visible pour créer cet effet.
const SUNG_LETTER_GLOW       = 0.2;
const LETTER_GLOW_MULTIPLIER = 185;
const LETTER_MAX_LENGTH      = 60;   // all words get letter treatment
const LETTER_MIN_DURATION    = 0;    // no minimum duration

// ── GPU promotion + setStyleIfChanged (spicy-lyrics 5.21.5) ──────
// WeakSet: each element gets will-change applied only once
const _gpuPromotedSet = new WeakSet();
function _promoteGPU(el) {
  if (_gpuPromotedSet.has(el)) return;
  // ⚠️ FIX : la référence Mixed.css originale (portée par ce projet) déclare
  // `will-change: transform, opacity, text-shadow, scale, background-image`
  // pour mots/lettres. Le port utilisait `filter` à la place de
  // `text-shadow` — or filter ne s'applique jamais aux mots/lettres (ça ne
  // concerne que .line, pour le flou de profondeur de champ), alors que
  // text-shadow est justement ce qui anime réellement à chaque frame via
  // --text-shadow-blur-radius/--text-shadow-opacity. Le navigateur recevait
  // le mauvais indice d'optimisation.
  el.style.willChange = 'transform, opacity, text-shadow, scale, background-image';
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
//  SpicyLyrics - Full Engine Port (CubicSpline + Spring + Letter
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
    // Oscillateur harmonique amorti - port fidèle de @spikerko/web-modules/Spring.
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
// Glow: fast rise to 1 by 15%, held until 60%, decays to 0 - NO residual glow
const GlowSpline       = _mkSpline([{Time:0,Value:0},{Time:0.15,Value:1},{Time:0.6,Value:1},{Time:1,Value:0}]);
// Dot splines - sequential 1/3-window bounce from DotAnimations in LyricsAnimator.ts
const DotScaleSpline   = _mkSpline([{Time:0,Value:0.75},{Time:0.7,Value:1.05},{Time:1,Value:1}]);
// Peak Y porté à -0.28 (× DefaultLyricsSize ≈ 10 px) pour que la montée/descente
// soit clairement visible - LyricsAnimator.ts utilise -0.12 mais sur des
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
  // skips the write - making the dot appear stuck.
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
    // Dot lines are hidden/shown via CSS classes - never blur them
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
    // on scroll vers la dernière ligne Sung - c'est exactement celle qu'on voulait centrer.
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
        _manualSmoothScrollTo(container, clampedTarget, 500);
      }
    }
    spicyScrollTimeout = null;
  }, 80);
}

let _manualScrollRAF = null;
function _manualSmoothScrollTo(container, targetTop, durationMs) {
  if (_manualScrollRAF) cancelAnimationFrame(_manualScrollRAF);
  const startTop = container.scrollTop;
  const delta = targetTop - startTop;
  const startTime = performance.now();
  if (Math.abs(delta) < 1) return;
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    container.scrollTop = startTop + delta * eased;
    if (t < 1) { _manualScrollRAF = requestAnimationFrame(step); }
    else { _manualScrollRAF = null; }
  }
  _manualScrollRAF = requestAnimationFrame(step);
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
          // Y is computed DIRECTLY via Math.sin - NOT via a spring.
          // Root cause: the YOffset spring has freq=1.25 Hz (period 800ms) and
          // each dot window is totalTime/3 ≈ 800-1400ms. The spring barely reaches
          // its peak before the target returns to 0, producing near-invisible motion.
          // sin(wp × π) gives a full rise-and-fall in exactly one dot window,
          // regardless of duration. Amplitude -0.4em ≈ 20 px at typical font sizes.
          let cy = 0;
          if (ws === 'Active') {
            ts = DotScaleSpline.at(wp);
            tg = DotGlowSpline.at(wp);  to = DotOpacSpline.at(wp);
            cy = Math.sin(wp * Math.PI) * -0.4; // em - direct sine bounce
          } else if (ws === 'NotSung') {
            ts = DotScaleSpline.at(0);
            tg = DotGlowSpline.at(0);  to = DotOpacSpline.at(0);
            cy = 0;
          } else { // Sung - remain fully lit
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
              // LyricsAnimator.ts uses falloff factor 0.9 (steeper - more focused on active letter)
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
                tGlow = Math.min(tGlow, SUNG_LETTER_GLOW);
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

        // ── LRC / -line.json : balayage vertical haut → bas ─────────
        // Pas de zoom (scale fixé à 1). Le glow reste piloté par le spring
        // pour la douceur. La progression du balayage est calculée directement
        // depuis wp (0→1) avec une ease-in-out sinusoïdale.
        if (word.IsLrcLine) {
          // word.HTMLElement = span.lrc-line-inner (flex-item neutre).
          // word.LrcWordEls  = array des span.lrc-word enfants.
          // On met à jour --lrc-fill-progress sur chaque lrc-word directement
          // (pas d'héritage CSS à traverser) et le glow/shadow sur innerEl.
          const lrcEls = word.LrcWordEls || [];
          const _setLrcProgress = (val) => {
            for (const el of lrcEls) el.style.setProperty('--lrc-fill-progress', val);
          };
          if (ws === 'Active') {
            _setLrcProgress(wp.toFixed(4));

            // Glow : spring pour la douceur
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(wp));
            const cg = word.AnimatorStore.Glow.Step(dt);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 16*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity',     `${Math.min(cg * 55, 100).toFixed(2)}%`, 1);

            if (word.HTMLElement.style.animation) word.HTMLElement.style.animation = 'none';
            word.LrcAnimated = true;

            // Pré-activer légèrement la ligne suivante à 60% de progression
            if (!word.LrcNextPrepped && wp >= 0.6) {
              word.LrcNextPrepped = true;
              const nextLine = line.HTMLElement.nextElementSibling;
              if (nextLine && nextLine.classList.contains('lrc-line') &&
                  nextLine.classList.contains('NotSung')) {
                nextLine.style.opacity   = '0.68';
                nextLine.style.transition = 'opacity 0.22s ease';
              }
            }

          } else if (ws === 'NotSung') {
            _setLrcProgress('0');
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0));
            word.AnimatorStore.Glow.Step(dt);
            if (word.LrcAnimated) {
              word.HTMLElement.style.animation = 'none';
              word.LrcAnimated = false;
            }
            if (word.HTMLElement.style.opacity) {
              word.HTMLElement.style.opacity   = '';
              word.HTMLElement.style.transition = '';
            }
            word.LrcNextPrepped = false;
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', '4px');
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity',     '0%');

          } else { // Sung : balayage complet à 1, glow résiduel doux
            _setLrcProgress('1');
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(1));
            const cg = word.AnimatorStore.Glow.Step(dt);
            if (word.HTMLElement.style.animation) word.HTMLElement.style.animation = 'none';
            if (word.HTMLElement.style.opacity) {
              word.HTMLElement.style.opacity   = '';
              word.HTMLElement.style.transition = '';
            }
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-blur-radius', `${(4 + 2*cg).toFixed(2)}px`, 0.25);
            _setStyleIfChanged(word.HTMLElement, '--text-shadow-opacity',     `${Math.min(cg * 22, 100).toFixed(2)}%`, 1);
            word.LrcAnimated    = false;
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
        // ⚠️ TEST DE DIAGNOSTIC TEMPORAIRE : transform/scale figés (pas de
        // décalage Y ni de zoom par mot) pour isoler si le système
        // d'animation par mot est la cause de la "fusion" visuelle en
        // début de ligne active. À retirer une fois le diagnostic confirmé.
        _setStyleIfChanged(word.HTMLElement, 'scale', '1', 0.001);
        _setStyleIfChanged(word.HTMLElement, 'transform', 'none', 0.001);
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
          d.AnimatorStore.YOffset.SetGoal(0, true); // immediate - no spring lag at rest
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
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0));
            const cg = word.AnimatorStore.Glow.Step(dt);
            if (!word.IsLrcLine) {
              word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0));
              word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(0));
              const cs = word.AnimatorStore.Scale.Step(dt);
              const cy = word.AnimatorStore.YOffset.Step(dt);
              _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`);
              _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`);
            }
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
          word.AnimatorStore.Glow.SetGoal(GlowSpline.at(1));
          const cg = word.AnimatorStore.Glow.Step(dt);
          _promoteGPU(word.HTMLElement);
          if (word.IsLrcLine) {
            // LRC sung : progress à 1, pas de scale/transform
            _setStyleIfChanged(word.HTMLElement, '--lrc-fill-progress', '1');
            word.LrcAnimated = false;
          } else {
            word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(1));
            word.AnimatorStore.YOffset.SetGoal(YOffSpline.at(1));
            const cs = word.AnimatorStore.Scale.Step(dt);
            const cy = word.AnimatorStore.YOffset.Step(dt);
            _setStyleIfChanged(word.HTMLElement, 'scale', `${cs.toFixed(5)}`, 0.001);
            _setStyleIfChanged(word.HTMLElement, 'transform', `translate3d(0,calc(var(--DefaultLyricsSize) * ${cy.toFixed(5)}),0)`, 0.001);
          }
          if (word.IsLrcLine) {
            // already handled above
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
      // Web Audio non disponible ou élément déjà lié - on remet à null pour
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
//  SPICY BACKGROUND - API publique (port de ApplyDynamicBackground)
//
//  initSpicyBackground() : à appeler une fois au chargement de la page.
//  updateBackground(imageUrl) : à appeler à chaque changement de piste.
//
//  Fond global CSS :
//    - visibilitychange listener → reprend quand l'onglet reprend le focus
//    - transition: 0.5s → même vitesse que DynamicBackgroundConfig
//    - Gère les 3 couches CSS .Back/.Center/.Front du fond global
// ══════════════════════════════════════════════════════════════════

// ── Fond global (#spicyGlobalBg) - met à jour les CSS vars sur <html> ─
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
      // AudioContext déjà actif (ou absent) - relancer directement
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
  // timeupdate (~4 Hz) - fixes the 250 ms position-step that made the
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
//  DOM RENDERER - builds .line / .word / .letterGroup / .letter
// ══════════════════════════════════════════════════════════════════

function renderSpicyLyrics(lines, type) {
  // ── Reset all state ────────────────────────────────────────────
  spicy.lyricsObject  = { Lines: [] };
  spicyBlurLastLine   = -1;
  spicyLastActiveLine = -1;
  audioPlayer._lastLineScrolled = false; // réinitialiser le scroll de fin
  audioPlayer._hlsEndedFired    = false; // réinitialiser le guard de fin HLS
  lyricsDisplay.innerHTML = '';

  const scrollCont = document.createElement('div');
  scrollCont.className = 'spicy-scroll-container';
  lyricsDisplay.appendChild(scrollCont);

  const innerCont = document.createElement('div');
  innerCont.className = 'lyrics-inner';
  scrollCont.appendChild(innerCont);

  const GAP_MS = 2500;  // Trigger interlude dots after 2.5s gap (was 3s)

  // ── Normalise input ────────────────────────────────────────────
  // json → per-word syllables with IsPartOfWord from source data.
  // lrc  → one syllable per line (whole-line highlight).
  const content = lines.map((line, i) => {
    let endMs = line.endMs ?? lines[i + 1]?.startMs ?? (line.startMs + 4500);
    // ⚠️ Garde-fou : parseJsonLyricsData gère plusieurs formats JSON avec des
    // conventions d'unités différentes (certains traitent startTime/endTime
    // comme des ms directement, _parsePNLContent les traite comme des
    // secondes et fait ×1000). Si une piste passe par la mauvaise branche
    // de détection, endMs peut se retrouver avec une valeur aberrante (ex:
    // secondes utilisées telles quelles → valeur ~1000x trop petite), ce
    // qui crée un "faux grand écart" détecté après CHAQUE ligne (points
    // d'interlude partout). Une ligne ne peut pas se terminer avant d'avoir
    // commencé : si endMs < startMs, la valeur est forcément corrompue —
    // on retombe sur le fallback sûr (début de la ligne suivante) plutôt
    // que de propager une donnée invalide dans le calcul d'écart.
    if (endMs < line.startMs) {
      endMs = lines[i + 1]?.startMs ?? (line.startMs + 4500);
    }
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
      // Priorité : backgrounds[] (lyrics.js v7+) - tableau complet de toutes les sections
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
      // Format lyrics.lines : { text, startTime, endTime, words[] } - temps en ms
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
    _createMusicalDots(innerCont,  0, content[0].Lead.StartTime, false);
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

      if (!syl.IsLrcLine && _isLetterCapable(syl.Text.length, dur)) {
        // ── Per-letter animation (word-sync JSON with real per-syllable timing) ──
        // LRC and -line.json lines are explicitly excluded: they only have line-level
        // timestamps, so distributing animation letter-by-letter is pure simulation
        // and looks broken.  Those lines always fall through to the plain word-span
        // path below which uses the proper whole-phrase IsLrcLine sweep animation.
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
        // ⚠️ FIX : espace géré en CSS pur (::after, voir style.css), comme
        // dans la référence Mixed.css, plutôt qu'un vrai nœud texte inséré
        // dans le DOM entre des éléments animés à chaque frame.

      } else if (syl.IsLrcLine) {
        // ── LRC line : un span.lrc-word par mot, directement sur lineEl ──
        // Pas de wrapper — appendés directement sur lineEl pour que
        // text-align:center et OppositeAligned de style.css s'appliquent
        // sans interférence. display:inline-block est déjà dans style.css.
        // --lrc-fill-progress est mis à jour par le moteur sur chaque span.
        const tokens = syl.Text.split(/\s+/).filter(t => t.length > 0);
        const lrcWordEls = [];
        tokens.forEach((tok, ti) => {
          const wEl = document.createElement('span');
          wEl.textContent = tok;
          wEl.className = 'lrc-word' + (ti === tokens.length - 1 ? ' LastWordInLine' : '');
          wEl.style.setProperty('--lrc-fill-progress', '0');
          lrcWordEls.push(wEl);
          lineEl.appendChild(wEl);
          if (ti < tokens.length - 1) lineEl.appendChild(document.createTextNode('\u00a0'));
        });
        spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
          HTMLElement: lineEl,
          StartTime: syl.StartTime, EndTime: syl.EndTime, TotalTime: dur,
          IsLrcLine: true, LrcWordEls: lrcWordEls,
        });

      } else {
        // ── Plain word span ────────────────────────────────────
        const wordEl = document.createElement('span');
        wordEl.textContent = syl.Text;
        wordEl.className   = 'word'
          + (isLast          ? ' LastWordInLine' : '')
          + (syl.IsPartOfWord ? ' PartOfWord'    : '');
        _initWordEl(wordEl, SLM);

        spicy.lyricsObject.Lines[lineIdx].Syllables.Lead.push({
          HTMLElement: wordEl,
          StartTime: syl.StartTime, EndTime: syl.EndTime, TotalTime: dur,
          IsLrcLine: false,
        });
        lineEl.appendChild(wordEl);
        // ⚠️ FIX : espace géré en CSS pur (::after, voir style.css), comme
        // dans la référence Mixed.css, plutôt qu'un vrai nœud texte inséré
        // dans le DOM entre des éléments animés à chaque frame.
      }
    });

    // Click to seek
    lineEl.addEventListener('click', () => {
      audioPlayer.currentTime = lineData.Lead.StartTime / 1000;
      if (audioPlayer.paused) audioPlayer.play().catch(console.error);
    });
    innerCont.appendChild(lineEl);

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
        // ⚠️ FIX : espace géré en CSS pur (::after), voir style.css.
      });
      innerCont.appendChild(bgEl);
    });

    // ── Interlude dots between lines ─────────────────────────────
    const next = content[i + 1];
    if (next && (next.Lead.StartTime - lineData.Lead.EndTime) >= GAP_MS) {
      _createMusicalDots(innerCont, lineData.Lead.EndTime, next.Lead.StartTime, lineData.OppositeAligned);
    }
  });

  // ── Mini lyrics strip ──────────────────────────────────────────
  lyricsMiniContent.innerHTML = lines.map((line, li) =>
    `<div class="lyrics-mini-line" data-line="${li}">${escapeHtml(line.text)}</div>`
  ).join('');

  // Scroll to top
  requestAnimationFrame(() => { if (lyricsDisplay) lyricsDisplay.scrollTop = 0; });

  // Ré-applique la traduction si le réglage est actif (nouveau morceau,
  // bascule simple/complet...) — voir _autoTranslateIfEnabled plus bas.
  _autoTranslateIfEnabled();
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
const miniEtc           = document.getElementById('miniEtc');
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
const userProfileView   = document.getElementById('userProfileView');
const _playerBarEl  = document.querySelector('.player-bar');
const _rightPanelEl = document.getElementById('rightPanel');

// ── Helpers visibilité ─────────────────────────────────────────────
function _showPlayerUI() {
  if (!_playerBarEl) return;
  _playerBarEl.classList.remove('player-hidden');
  // Repasser overflow:visible après l'animation pour que les hovers/popups ne soient pas coupés
  clearTimeout(_playerBarEl._overflowTimer);
  _playerBarEl._overflowTimer = setTimeout(() => {
    if (!_playerBarEl.classList.contains('player-hidden'))
      _playerBarEl.style.overflow = 'visible';
  }, 480);
  if (_rightPanelEl) {
    _rightPanelEl.classList.remove('panel-no-track');
    _rightPanelEl.style.overflow = '';
  }
}

function _hidePlayerUI() {
  if (!_playerBarEl) return;
  // Forcer overflow:hidden avant l'animation pour que max-height:0 fonctionne
  _playerBarEl.style.overflow = 'hidden';
  _playerBarEl.classList.add('player-hidden');
  if (_rightPanelEl) {
    _rightPanelEl.style.overflow = 'hidden';
    _rightPanelEl.classList.add('panel-no-track');
  }
}

// ── État initial : caché si aucune piste ──────────────────────────
(function _initPlayerVisibility() {
  if (currentIndex >= 0) {
    _showPlayerUI();
  } else {
    // Désactiver la transition pour l'état initial (pas d'animation au chargement)
    if (_playerBarEl) {
      _playerBarEl.style.transition = 'none';
      _playerBarEl.style.overflow   = 'hidden';
      _playerBarEl.classList.add('player-hidden');
      requestAnimationFrame(() => {
        _playerBarEl.style.transition = '';
      });
    }
    if (_rightPanelEl) {
      _rightPanelEl.style.transition = 'none';
      _rightPanelEl.style.overflow   = 'hidden';
      _rightPanelEl.classList.add('panel-no-track');
      requestAnimationFrame(() => {
        _rightPanelEl.style.transition = '';
      });
    }
  }
})();

// ── Fetch Tracks ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
//  JELLYFIN TRACK LOADER - optimisé
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
    const [cachedTracks, cachedServer, cachedAt] = await Promise.all([
      _readCacheTracks(db),
      _readCacheMeta(db, 'server'),
      _readCacheMeta(db, 'cachedAt'),
    ]);
    if (cachedTracks.length > 0 && cachedServer === 'beartify-v2') {
      tracks       = cachedTracks.map(normalizeTrack);
      shuffleOrder = [...tracks.keys()];
      _invalidateLibCache();
      renderSidebarView('playlists');
      renderHomePage();
      renderQueueList();
      console.log(`[Beartify] ${tracks.length} titres chargés depuis le cache - actualisation en arrière-plan…`);
      // Refresh silencieux différé : on attend 8 s avant de lancer les requêtes
      // vers Jellyfin. Sans ce délai, le rafraîchissement tire toutes les pages
      // de la bibliothèque en parallèle dès le chargement de la page, ce qui
      // sature le proxy Caddy → Jellyfin et empêche les streams audio de démarrer
      // immédiatement (la 2ème piste pouvait être bloquée jusqu'à ~30 secondes).
      setTimeout(() => _refreshTracksFromServer(db, /* isBackgroundRefresh */ true, cachedAt).catch(console.warn), 8000);
      return;
    }
  }

  // ── 2. Pas de cache → chargement complet avec affichage progressif
  await _refreshTracksFromServer(db, /* isBackgroundRefresh */ false, null);
}

async function _refreshTracksFromServer(db, isBackgroundRefresh = false, cachedAt = null) {
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
    window._jellyfinUserId = userId; // réutilisé par les fetchs à la demande (pages album/artiste)
    const totalCount = countData.TotalRecordCount || 0;

    // ── 2a. Delta sync ─────────────────────────────────────────────
    // Si on a déjà une bibliothèque complète en cache (refresh de fond, pas
    // un premier chargement) et qu'elle n'est pas trop vieille, on ne
    // redemande QUE ce qui a changé depuis la dernière visite
    // (MinDateLastSaved), au lieu de retélécharger 22 000+ titres à chaque
    // session. Sécurité : au-delà de 24h on force un sync complet — le
    // delta ne détecte pas les suppressions côté Jellyfin, donc on se
    // recale périodiquement pour ne pas dériver indéfiniment.
    const DELTA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    if (isBackgroundRefresh && cachedAt && (Date.now() - cachedAt) < DELTA_MAX_AGE_MS) {
      try {
        const sinceIso = new Date(cachedAt).toISOString();
        const deltaResp = await fetch(
          jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&MinDateLastSaved=${encodeURIComponent(sinceIso)}&Fields=${JELLY_FIELDS}&Limit=2000`)
        );
        if (deltaResp.ok) {
          const deltaData = await deltaResp.json();
          const changed = (deltaData.Items || []).map(normaliseTrack);
          if (changed.length > 0) {
            changed.forEach(t => _upsertTrackInLibrary(t));
            _invalidateLibCache();
            renderSidebarView(currentSidebarFilter || 'playlists');
            renderQueueList();
            renderHomePage();
          }
          console.log(`[Beartify] Delta sync : ${changed.length} titre(s) mis à jour depuis ${sinceIso}`);
          window._librarySyncComplete = true;
          if (db) setTimeout(() => _writeCacheTracks(db, tracks, tracks.length), 0);
          return; // ✅ terminé — pas besoin de la pagination complète ci-dessous
        }
        console.warn('[Beartify] Delta sync : réponse HTTP non-OK, fallback en sync complète');
      } catch (e) {
        console.warn('[Beartify] Delta sync échoué, fallback en sync complète :', e);
        // On continue vers la pagination complète classique ci-dessous.
      }
    }

    // ── 2bis. Aperçu rapide (façon "premier écran Spotify") ────────
    // ⚠️ UNIQUEMENT sur un vrai chargement à froid (pas de cache). Si un
    // cache valide a déjà affiché la bibliothèque complète instantanément
    // (isBackgroundRefresh === true), on ne doit JAMAIS écraser `tracks`
    // avec ce sous-ensemble de 100 titres : ça downgradait silencieusement
    // un état déjà complet, cassait `currentIndex`/la lecture en cours si
    // la piste jouée n'était pas dans les 100 titres, et donnait
    // l'impression d'un "refresh" intempestif au bout de 8s.
    //
    // Sur une grosse bibliothèque, une seule page de 2000 titres met déjà
    // ~20s à répondre côté Jellyfin (mesuré : coût par item incompressible,
    // indépendant des champs demandés). Plutôt que de laisser l'accueil
    // vide pendant tout ce temps SUR UN CHARGEMENT À FROID, on demande
    // d'abord un petit lot (100 titres, triés par date d'ajout) qui répond
    // en ~1-2s et suffit à peindre l'accueil. Le chargement complet
    // (pagination ci-dessous) continue ensuite normalement en arrière-plan
    // et remplace `tracks` une fois terminé.
    let firstRendered = false;
    if (!isBackgroundRefresh) {
      try {
        const previewResp = await fetch(
          jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&Fields=${JELLY_FIELDS}&SortBy=DateCreated&SortOrder=Descending&Limit=100&StartIndex=0`)
        );
        if (previewResp.ok) {
          const previewData = await previewResp.json();
          if (previewData?.Items?.length) {
            tracks = previewData.Items.map(normaliseTrack);
            if (!window._playContext) shuffleOrder = [...tracks.keys()];
            _resolveCtx();
            _resolveCurrentIndex();
            _invalidateLibCache();
            renderSidebarView('playlists');
            renderHomePage();
            firstRendered = true; // évite un second rendu redondant sur la page 0 ci-dessous
            console.log(`[Beartify] Aperçu rapide (${tracks.length} titres) affiché — chargement complet en cours…`);
          }
        }
      } catch (e) { console.warn('[Beartify] Aperçu rapide échoué (non bloquant) :', e); }
    }

    // ── 3. Pages en petits lots (max 2 simultanées) ───────────────
    // On évite de lancer TOUTES les pages en parallèle car cela saturerait
    // le pool de connexions Caddy → Jellyfin et bloquerait les streams audio
    // (la 2ème piste pouvait attendre jusqu'à 30 s que tous les fetches se
    // terminent). Avec CONCURRENCY = 2, Jellyfin garde toujours des slots
    // libres pour les requêtes de streaming audio.
    const FETCH_CONCURRENCY = 2;
    const pageCount         = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const allTracks         = [];
    // Sur un refresh de fond (cache déjà complet et affiché), on ne veut
    // JAMAIS que la 1ère page de la pagination écrase `tracks` avec un
    // sous-ensemble — `firstRendered` reste donc déjà "vrai" pour désarmer
    // ce court-circuit d'affichage anticipé, inutile ici de toute façon.
    if (isBackgroundRefresh) firstRendered = true;

    async function _fetchOnePage(p) {
      const start = p * PAGE_SIZE;
      // ⚠️ Pas de SortBy/SortOrder ici : sur une grosse bibliothèque (20 000+
      // titres), demander un tri à Jellyfin force un tri COMPLET de la
      // collection à CHAQUE requête de page (la pagination est stateless,
      // Jellyfin ne garde pas le tri en mémoire entre deux requêtes). Avec
      // ~10 pages, ça revient à trier 20 000 titres ~10 fois côté serveur —
      // c'est la cause la plus probable des chargements à froid de plusieurs
      // minutes. On récupère les pages non triées (scan indexé, rapide) et
      // on trie une seule fois côté client une fois tout reçu (quelques ms).
      const r = await fetch(
        jellyfinUrl(`/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&Fields=${JELLY_FIELDS}&Limit=${PAGE_SIZE}&StartIndex=${start}`)
      );
      const data = r.ok ? await r.json() : null;
      if (!data?.Items) return [];
      const batch = data.Items.map(normaliseTrack);
      // Afficher la première page dès son arrivée
      if (!firstRendered) {
        firstRendered = true;
        tracks        = batch;
        if (!window._playContext) shuffleOrder = [...tracks.keys()];
        _resolveCtx();
        _resolveCurrentIndex();
        _invalidateLibCache();
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

    // ── 4. Trier UNE SEULE FOIS côté client, puis consolider l'UI ─
    // Remplace le SortBy=SortName serveur (retiré ci-dessus) : trier ici
    // ~20 000 objets JS coûte quelques millisecondes, contre potentiellement
    // des dizaines de secondes de tri SQL répété côté Jellyfin.
    allTracks.sort((a, b) =>
      (a.sortName || a.title).localeCompare(b.sortName || b.title, undefined, { numeric: true, sensitivity: 'base' })
    );

    if (allTracks.length > 0) {
      tracks       = allTracks;
      if (!window._playContext) shuffleOrder = [...tracks.keys()];
      _resolveCtx();
      _resolveCurrentIndex();
      _invalidateLibCache();
      renderSidebarView(currentSidebarFilter || 'playlists');
      renderQueueList();
      renderHomePage();
    }

    // ── 5. Persister le cache en arrière-plan (non-bloquant) ──────
    if (db && allTracks.length > 0) {
      setTimeout(() => _writeCacheTracks(db, allTracks, totalCount), 0);
    }
    // Bibliothèque complète en mémoire : les vues album/artiste peuvent
    // arrêter de vérifier auprès du serveur à chaque ouverture.
    window._librarySyncComplete = true;
    // Filet de sécurité : si une page album/artiste était ouverte pendant
    // que la synchro tournait (et que sa vérification à la demande a
    // échoué ou n'a pas eu le temps de finir), on la rafraîchit une
    // dernière fois maintenant que `tracks` est garanti complet.
    if ((detailType === 'album' || detailType === 'artist') &&
        window._currentDetailName && detailView?.style.display === 'flex') {
      showDetailView(detailType, window._currentDetailName, false);
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
    // Utilisé pour le tri client (voir _refreshTracksFromServer) : gère
    // les articles ("The", "Le"...) comme le faisait le SortBy=SortName
    // serveur qu'on a retiré pour ne plus trier toute la lib à chaque page.
    sortName:  item.SortName || item.Name,
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
    // Cover "standard" (cards home, cover album/lecteur) — 300px, tag de
    // cache inclus → immutable côté navigateur/Caddy.
    imageUrl: item.ImageTags?.Primary
      ? jellyImg(item.Id, IMG_SIZE_CARD, item.ImageTags.Primary)
      : (item.AlbumPrimaryImageTag
          ? jellyImg(item.AlbumId, IMG_SIZE_CARD, item.AlbumPrimaryImageTag)
          : null),
    // Vignette légère (queue, mosaïques de playlists, avatars, résultats
    // de recherche) — évite de télécharger/décoder une image 300px pour
    // un rond de 24-44px affiché à l'écran.
    imageUrlThumb: item.ImageTags?.Primary
      ? jellyImg(item.Id, IMG_SIZE_THUMB, item.ImageTags.Primary)
      : (item.AlbumPrimaryImageTag
          ? jellyImg(item.AlbumId, IMG_SIZE_THUMB, item.AlbumPrimaryImageTag)
          : null),
  };
}

// ══════════════════════════════════════════════════════════════════
//  SIDEBAR - filter pills + views
// ══════════════════════════════════════════════════════════════════

function renderSidebarView(filter) {
  currentSidebarFilter = filter;
  _initLibDelegation(); // délégation posée une seule fois
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
        <img src="pictures/icon-heart.png" alt="" loading="lazy" decoding="async" style="width:44px;height:44px;border-radius:4px;object-fit:cover">
      </div>
      <div class="lib-item-meta">
        <div class="lib-item-name">Titres likés</div>
        <div class="lib-item-sub">${likedCount} titre${likedCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;

  // ── Mes favoris ───────────────────────────────────────────────
  const favCount = favoriteAlbums.size + favoriteArtists.size;
  const favoritesItem = `
    <div class="sidebar-playlist-hint lib-favorites-row">
      <div class="track-icon-wrap" style="border-radius:4px;flex-shrink:0">
        <img src="pictures/icon-star.png" alt="" loading="lazy" decoding="async" style="width:44px;height:44px;border-radius:4px;object-fit:cover">
      </div>
      <div class="lib-item-meta">
        <div class="lib-item-name">Mes favoris</div>
        <div class="lib-item-sub">${favCount} élément${favCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;

  trackListDiv.innerHTML = likedItem + favoritesItem;

  // ── Playlists personnalisées avec drag-to-reorder ──────────────
  const customPlaylists = window.customPlaylists || {};
  // Exclure les playlists d'amis qui auraient pu être ajoutées par erreur
  let plList = Object.values(customPlaylists).filter(p => !p._isFriendPlaylist);

  // Trier selon l'ordre sauvegardé, puis les nouvelles en fin
  const knownIds = new Set(playlistOrder);
  const ordered  = playlistOrder
    .map(id => plList.find(p => p.id === id))
    .filter(Boolean);
  const unordered = plList.filter(p => !knownIds.has(p.id))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  plList = [...ordered, ...unordered];

  plList.forEach(pl => {
    const count   = (pl.tracks || []).length;
    const isFav   = favoritePlaylists.has(pl.id) || favoritePlaylists.has(pl.name);
    const creator = pl.createdBy
      || window._authUser?.displayName
      || window._authUser?.username
      || window._firebaseUser?.displayName
      || 'Vous';
    const row = document.createElement('div');
    row.className = 'sidebar-playlist-hint lib-custom-playlist-row';
    row.dataset.playlistId = pl.id;
    row.draggable = true;
    row.innerHTML = `
      ${_makePlaylistCoverHtml(pl.tracks, 'sm', pl.coverUrl || null)}
      <div class="lib-item-meta">
        <div class="lib-item-name${isFav ? ' fav-active' : ''}">${escapeHtml(pl.name)}</div>
        <div class="lib-item-sub">${escapeHtml(creator)}</div>
      </div>`;
    trackListDiv.appendChild(row);
  });

  // ── Drag-and-drop pour réarranger les playlists ───────────────
  _initPlaylistDrag();
}

// ── Drag-to-reorder playlists ──────────────────────────────────────
let _dragSrc = null;
function _initPlaylistDrag() {
  const rows = trackListDiv.querySelectorAll('.lib-custom-playlist-row[draggable]');
  rows.forEach(row => {
    row.addEventListener('dragstart', e => {
      _dragSrc = row;
      row.classList.add('lib-drag-active');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.playlistId);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('lib-drag-active');
      trackListDiv.querySelectorAll('.lib-drag-over').forEach(el => el.classList.remove('lib-drag-over'));
      _dragSrc = null;
      // Persister le nouvel ordre
      const newOrder = [...trackListDiv.querySelectorAll('.lib-custom-playlist-row[data-playlist-id]')]
        .map(el => el.dataset.playlistId);
      playlistOrder = newOrder;
      localStorage.setItem('playlistOrder', JSON.stringify(newOrder));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_dragSrc && _dragSrc !== row) row.classList.add('lib-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('lib-drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('lib-drag-over');
      if (!_dragSrc || _dragSrc === row) return;
      // Insérer _dragSrc avant ou après row selon la position
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) row.after(_dragSrc);
      else row.before(_dragSrc);
    });
  });
}

function renderSidebarAlbums(list) {
  if (!trackListDiv || tracks.length === 0) return;
  const albumMap = _getLibAlbumMap();
  const source   = list || [...albumMap.values()];

  source.sort((a, b) => {
    // Favoris TOUJOURS en premier
    const fa = favoriteAlbums.has(a.name) ? 0 : 1;
    const fb = favoriteAlbums.has(b.name) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    // Tri secondaire
    let va, vb;
    switch (libSortKey) {
      case 'artist':  va = a.artist?.toLowerCase() || ''; vb = b.artist?.toLowerCase() || ''; break;
      case 'count':   return (b.count - a.count) * libSortDir;
      case 'recent':
        va = tracks.findIndex(t => t.album === a.name);
        vb = tracks.findIndex(t => t.album === b.name);
        return (va - vb) * libSortDir;
      case 'favFirst': return 0; // déjà trié
      default:        va = a.name?.toLowerCase() || ''; vb = b.name?.toLowerCase() || '';
    }
    return (va < vb ? -1 : va > vb ? 1 : 0) * libSortDir;
  });

  trackListDiv.innerHTML = source.map((album, i) => `
    <div class="lib-album-item" data-album="${escapeHtml(album.name)}" style="animation-delay:${Math.min(i*0.02,0.3)}s">
      <div class="track-icon-wrap">
        ${album.imageUrl ? `<img src="${album.imageUrl}" loading="lazy" decoding="async" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.4">`}
      </div>
      <div class="track-meta">
        <div class="track-title ${favoriteAlbums.has(album.name) ? 'fav-active' : ''}">${escapeHtml(album.name)}</div>
        <div class="track-artist">${escapeHtml(album.artist)} · ${album.count} titre${album.count>1?'s':''}</div>
      </div>
      <button class="lib-fav-btn ${favoriteAlbums.has(album.name) ? 'active' : ''}" data-album="${escapeHtml(album.name)}"
        data-tooltip="${favoriteAlbums.has(album.name) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
        ${favoriteAlbums.has(album.name) ? _BKMK_FILLED : _BKMK_EMPTY}
      </button>
    </div>`).join('');
  // Listeners via délégation sur trackListDiv — voir _initLibDelegation()
}

function renderSidebarArtists(list) {
  if (!trackListDiv || tracks.length === 0) return;
  const artistMap = _getLibArtistMap();
  const source    = list || [...artistMap.values()];

  source.sort((a, b) => {
    // Favoris TOUJOURS en premier
    const fa = favoriteArtists.has(a.name) ? 0 : 1;
    const fb = favoriteArtists.has(b.name) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    let va, vb;
    switch (libSortKey) {
      case 'count':   return (b.count - a.count) * libSortDir;
      case 'recent':
        va = tracks.findIndex(t => t.artist === a.name);
        vb = tracks.findIndex(t => t.artist === b.name);
        return (va - vb) * libSortDir;
      case 'favFirst': return 0;
      default:        va = a.name?.toLowerCase() || ''; vb = b.name?.toLowerCase() || '';
    }
    return (va < vb ? -1 : va > vb ? 1 : 0) * libSortDir;
  });

  trackListDiv.innerHTML = source.map((artist, i) => `
    <div class="lib-artist-item" data-artist="${escapeHtml(artist.name)}" style="animation-delay:${Math.min(i*0.02,0.3)}s">
      <div class="lib-artist-avatar" style="background:${artist.imageUrl ? 'var(--bg-tinted)' : artistGradient(artist.name)}">
        ${artist.imageUrl ? `<img src="${artist.imageUrl}" loading="lazy" decoding="async" alt="">` : `<span>${escapeHtml(artist.name.charAt(0).toUpperCase())}</span>`}
      </div>
      <div class="track-meta">
        <div class="track-title">${escapeHtml(artist.name)}</div>
        <div class="track-artist">${artist.count} titre${artist.count>1?'s':''}</div>
      </div>
      <button class="lib-fav-btn ${favoriteArtists.has(artist.name) ? 'active' : ''}" data-artist="${escapeHtml(artist.name)}"
        data-tooltip="${favoriteArtists.has(artist.name) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
        ${favoriteArtists.has(artist.name) ? _BKMK_FILLED : _BKMK_EMPTY}
      </button>
    </div>`).join('');
  // Listeners via délégation sur trackListDiv — voir _initLibDelegation()
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
  // Forcer overflow:hidden AVANT la mesure — sinon scrollWidth d'un frère peut déborder
  wrapper.style.overflow = 'hidden';
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
  // Réinitialiser le cache texte pour forcer une re-mesure propre
  [currentTitleEl, currentArtistEl, panelTitle, panelArtist, panelAlbum].forEach(el => {
    if (el) _marqueeText.delete(el);
  });
  // Staggerer les RAF pour que chaque mesure soit indépendante
  // (toutes dans le même RAF = scrollWidth d'un élément peut affecter les autres)
  applyMarquee(currentTitleWrap,  currentTitleEl);
  applyMarquee(currentArtistWrap, currentArtistEl);
  // Décaler d'un frame les éléments du right panel pour isolation complète
  requestAnimationFrame(() => {
    applyMarquee(panelTitleWrap,  panelTitle);
    applyMarquee(panelArtistWrap, panelArtist);
    applyMarquee(panelAlbumWrap,  panelAlbum);
  });
}

// ── Play track ─────────────────────────────────────────────────────
async function playCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return;

  // Normalisation défensive - corrige les URLs stales (Firestore, cache, historique)
  const track = normalizeTrack(tracks[currentIndex]);
  // Mémoriser l'ID stable de la piste en cours pour _resolveCurrentIndex()
  window._currentTrackId = track.id;

  // ── Guard contre les appels concurrent à playCurrentTrack ───────────
  // Chaque appel incrémente _hlsLoadGen. Les segments async (loadHLSPlayer)
  // vérifient leur token (myGen) contre _hlsLoadGen : si différent, un appel
  // plus récent a démarré → abandon silencieux.
  const myGen = ++_hlsLoadGen;

  // ── Stopper proprement la piste précédente ────────────────────────────
  // Sans pause() avant src=, certains navigateurs ignorent le changement.
  // On stoppe aussi le crossfade en cours pour éviter que le volume reste à 0.
  if (_crossfadeTimer) { clearInterval(_crossfadeTimer); _crossfadeTimer = null; }
  audioPlayer.pause();
  // Restaurer le volume maître (le crossfade peut l'avoir mis à 0)
  audioPlayer.volume = window._masterVolume ?? 1;

  // ── Reset immédiat UI timer/progress ──────────────────────────────
  // On stocke l'ID de la piste qui vient d'être demandée.
  // Le handler timeupdate ne mettra à jour l'UI que lorsque
  // window.currentTrack?.id correspond à cet ID ET currentTime >= 0.5 s.
  // Cela élimine le flash HLS (segments de l'ancienne piste avec currentTime > 0)
  // et la désynchronisation des 2 premières secondes.
  window._playerExpectedTrackId = track.id;
  audioPlayer._expectedDuration  = track.duration || 0;
  window._playerTimerLocked     = true;
  if (typeof progressFill  !== 'undefined' && progressFill)  progressFill.style.width  = '0%';
  if (typeof progressThumb !== 'undefined' && progressThumb) progressThumb.style.left  = '0%';
  if (typeof currentTimeEl !== 'undefined' && currentTimeEl) currentTimeEl.textContent = '0:00';
  // totalTimeEl figé ici sur la durée Jellyfin — jamais réécrit ailleurs.
  if (typeof totalTimeEl   !== 'undefined' && totalTimeEl)   totalTimeEl.textContent   = formatTime(track.duration || 0);

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

  // ── HLS FLAC + AES-128 + Honeypot Rick Roll (v6) ─────────────────────
  // loadHLSPlayer() :
  //  1. Session drm.js → ffmpeg FLAC fMP4 + clé AES-128 + honeypotTag aléatoire
  //  2. Lecture dès init.mp4 + 2 segments (~4-8s)
  //  3. Loader HLS.js filtre les honeypots via tag de session (non devinable)
  //  4. IV différent par segment, session renouvelée automatiquement
  // Fallback silencieux vers URL directe si drm.js indisponible.
  const qualityBitrates = { low: 96000, normal: 192000, high: 320000 };
  const bitrate = qualityBitrates[window._settingsAudioQuality || 'high'];
  const _hlsItemIdMatch = (track.streamUrl || '').match(/\/Audio\/([a-f0-9]{32})\/stream/i);
  const _hlsItemId = _hlsItemIdMatch ? _hlsItemIdMatch[1] : null;

  if (_hlsItemId) {
    try {
      await loadHLSPlayer(_hlsItemId, audioPlayer, bitrate < 320000 ? bitrate : null);
    } catch (err) {
      console.warn('[HLS] Fallback URL directe :', err.message);
      let streamSrc = track.streamUrl;
      try {
        if (bitrate < 320000) {
          const u = new URL(streamSrc, location.href);
          u.searchParams.set('MaxStreamingBitrate', bitrate);
          u.searchParams.set('AudioBitRate', bitrate);
          streamSrc = streamSrc.startsWith('/') ? u.pathname + u.search : u.toString();
        }
      } catch {}
      audioPlayer.src = streamSrc;
    }
    // FIX: if a newer playCurrentTrack() was called while we were awaiting, abort silently.
    if (myGen !== _hlsLoadGen) return;
  } else {
    audioPlayer.src = track.streamUrl;
  }
  audioPlayer._lastLineScrolled = false; // réinitialise le scroll de fin de chanson
  audioPlayer._hlsEndedFired    = false; // réinitialise le guard de fin HLS
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
  const ctxName = window._currentRpContextName && window._currentRpContextName !== '-'
    ? window._currentRpContextName
    : track.album || '-';
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
  // Do NOT hide main content - preserve whatever view is currently shown
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

  // ── Événement global "piste changée" ──────────────────────────────
  // Écouté par le reset de traduction des paroles (ligne ~3267) et par
  // le pont Discord Rich Presence (discord-rpc.js) — aucun des deux ne
  // se déclenchait avant cet ajout, l'event n'étant jamais émis.
  window.dispatchEvent(new CustomEvent('beartify:trackChanged', { detail: track }));

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
    // ── FIX : comparer par data-id (stable) et non data-idx (index global stale
    //         après rechargement de la bibliothèque en arrière-plan).
    const isActive = activeId != null && el.dataset.id === String(activeId);
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
      if (isActive && !audioPlayer.paused) {
        icon.innerHTML = `<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>`;
      } else {
        icon.innerHTML = `<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path>`;
      }
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

  // ── PRIORITÉ 3bis : lyrics.lines format Musixmatch/Spotify LINE_SYNCED ──
  // Format distinct de la PRIORITÉ 4 ci-dessous : ici `words` est une
  // CHAÎNE (le texte complet de la ligne, pas un tableau de mots), les
  // temps sont dans `startTimeMs`/`endTimeMs` (avec un "s", en string),
  // et `endTimeMs` vaut quasi toujours "0" (inexploitable — on calcule
  // la fin de chaque ligne à partir du début de la suivante). Sans cette
  // détection dédiée, ces fichiers produisaient un tableau de lignes vide
  // (silencieusement) car ni le format word-sync (tableau attendu) ni le
  // fallback ligne de la PRIORITÉ 4 (l.text/l.startTime attendus) ne
  // reconnaissent ces noms de champs.
  const isLineSyncedMs = Array.isArray(jsonData.lyrics?.lines) &&
    (jsonData.lyrics.syncType === 'LINE_SYNCED' ||
     (typeof jsonData.lyrics.lines[0]?.words === 'string' && jsonData.lyrics.lines[0]?.startTimeMs != null));
  if (isLineSyncedMs) {
    const msLines = jsonData.lyrics.lines
      .map(l => ({
        text:    typeof l.words === 'string' ? l.words.trim() : '',
        startMs: parseInt(l.startTimeMs, 10) || 0,
      }))
      .filter(l => l.text.length > 0);
    if (msLines.length > 0) {
      return msLines.map((l, i) => ({
        text: l.text,
        startMs: l.startMs,
        // endTimeMs du provider est inexploitable (souvent "0") : on utilise
        // le début de la ligne suivante, comme pour le word-sync plus bas.
        // ⚠️ Plafonné à 6s : si on mettait bêtement le startMs de la ligne
        // suivante ici, l'écart calculé par le détecteur de "points
        // d'interlude" (voir GAP_MS dans renderSpicyLyrics) serait TOUJOURS
        // nul par construction, et les points n'apparaîtraient jamais pour
        // ce format — même sur un vrai silence de 15s. En plafonnant la
        // durée supposée d'une ligne à 6s (largement suffisant pour une
        // ligne chantée normale), tout écart réel au-delà redevient un vrai
        // "gap" détectable.
        endMs: msLines[i + 1] ? Math.min(msLines[i + 1].startMs, l.startMs + 6000) : l.startMs + 4000,
        words: [],
        oppositeAligned: false,
        background: null,
        backgrounds: null,
      }));
    }
  }

  // ── PRIORITÉ 4 : lyrics.lines (format word-sync parsé) ────────────
  // Gère à la fois l'ancien format (champs plats) et le nouveau format
  // enrichi (type, oppositeAligned, lead, background présents sur chaque ligne).
  const rawLines = jsonData.lyrics?.lines || [];
  const result = [];
  for (const l of rawLines) {
    const wordArr = l.words;
    if (!Array.isArray(wordArr) || wordArr.length === 0) {
      // Format LINE : pas de words, juste text + startTime + endTime
      if (!l.text || l.startTime == null) continue;
      result.push({
        text: l.text.trim(),
        startMs: l.startTime,
        endMs:   l.endTime ?? l.startTime + 2500,
        words: [],
        oppositeAligned: l.oppositeAligned || false,
        background:  null,
        backgrounds: null,
      });
      continue;
    }

    // Build words - strip any embedded trailing/leading whitespace from word.text
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
// Identique à syllablesToWords() dans lyrics.js - évite "Jet'aime,jetehais"
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
    // Accepter Vocal ET Background - le type est porté par oppositeAligned + lineType
    if (!seg.Lead?.Syllables) continue;

    const syls = seg.Lead.Syllables.map(s => ({
      text: s.Text, startMs: s.StartTime * 1000, endMs: s.EndTime * 1000,
      isPartOfWord: s.IsPartOfWord || false,
    }));

    // Fix Bug A : reconstruction du texte en respectant IsPartOfWord.
    // L'ancien join(' ') sur les syllabes brutes produisait "J e t ' a i m e"
    // ou "Jet'aime" selon les données - _sylsToText() fusionne les syllabes
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
  // ✅ Priorité word-sync : pénaliser les fichiers -line.json (sync par ligne)
  if (src.includes('-line.json')) score -= 2;
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

// Fetch + parse lrclib.net (pas de rendu DOM ici, pure donnée) — permet de
// démarrer cet appel en parallèle de GrizzLyrics au lieu d'attendre que
// GrizzLyrics ait fini ses 3 tentatives avant de commencer. GrizzLyrics étant
// auto-hébergé (rapide), et lrclib étant un service tiers plus lent (~5-6s
// mesurés), les lancer en parallèle masque une bonne partie de la latence de
// lrclib : si GrizzLyrics trouve quelque chose, ce fetch est simplement
// abandonné (négligeable) ; sinon, il a déjà une longueur d'avance.
async function _fetchLrclibRaw(trackName, artist) {
  // Circuit breaker : si lrclib a timeout/échoué récemment, pas la peine de
  // retenter un service visiblement en difficulté.
  if (window._lrclibDownUntil && Date.now() < window._lrclibDownUntil) return null;
  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artist)}`;
    // ⚠️ Timeout à 12s (pas 6s) : mesuré en conditions réelles, lrclib peut
    // légitimement mettre 5-6s à répondre à une recherche normale (pas de
    // blocage réseau, juste un service tiers lent) — 6s ne laissait presque
    // aucune marge et déclenchait des faux timeouts en usage normal.
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    window._lrclibDownUntil = 0; // ça remarche, on réarme le disjoncteur
    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) return null;
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
      if (lines.length > 0) return { type: 'lrc', lines };
    }
    if (best?.plainLyrics) return { type: 'plain', text: best.plainLyrics };
    return null;
  } catch (e) {
    console.warn('[Lyrics] lrclib fallback failed:', e);
    // Échec (timeout/réseau) → on désactive lrclib brièvement plutôt que de
    // retenter (et perdre du temps) sur le morceau suivant immédiatement.
    // Cooldown court (45s, pas 5min) : confirmé que lrclib répond bien
    // depuis le navigateur (testé en direct), donc un échec isolé est
    // probablement une lenteur ponctuelle sous charge réseau, pas une
    // vraie panne — pas la peine de pénaliser toute une session d'écoute.
    window._lrclibDownUntil = Date.now() + 45 * 1000;
    return null;
  }
}

// Jeton de génération : incrémenté à chaque appel de fetchLyrics(). Toute
// écriture DOM (renderSpicyLyrics, état "aucune parole", etc.) vérifie
// qu'elle correspond toujours à l'appel le plus récent avant d'agir — sans
// ça, un appel resté en vol (ex: lrclib qui prend 10s) pouvait écraser
// l'affichage d'un morceau suivant déjà démarré entre-temps.
let _lyricsFetchToken = 0;

async function fetchLyrics(trackName, artist) {
  const _token = ++_lyricsFetchToken;
  const _stillCurrent = () => _token === _lyricsFetchToken;

  lyricsData = null;
  spicy.lyricsObject  = { Lines: [] };
  spicyBlurLastLine   = -1;
  spicyLastActiveLine = -1;

  lyricsDisplay.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><span>Recherche des paroles…</span></div>';
  lyricsMiniContent.innerHTML = '<p class="placeholder-mini">Chargement…</p>';

  // Démarré tout de suite, en parallèle des tentatives GrizzLyrics ci-dessous
  // (voir commentaire de _fetchLrclibRaw). Pas de await ici — juste amorcé.
  const lrclibPromise = _fetchLrclibRaw(trackName, artist);

  const queries = [`${artist} - ${trackName}`, `${trackName} ${artist}`, trackName];
  for (const q of queries) {
    try {
      const results = await _grizzlyricsQuery(q, artist, trackName);
      if (!_stillCurrent()) return; // un autre morceau a démarré entre-temps
      if (!results?.length) continue;
      const jsonResult = results.find(r => _lyricsDetectType(r) === 'json');
      const lrcResult  = results.find(r => _lyricsDetectType(r) === 'lrc');
      if (jsonResult) {
        const jsonUrl = lyricsProxyUrl(jsonResult.content_url || jsonResult.url);
        if (jsonUrl) {
          try {
            const lines = await _fetchJsonLyrics(jsonUrl);
            if (!_stillCurrent()) return;
            if (lines) { lyricsData = { type: 'json', lines }; renderSpicyLyrics(lines, 'json'); return; }
          } catch (e) { console.warn('[Lyrics] JSON fetch failed:', e); }
        }
      }
      if (lrcResult) {
        const lrcUrl = lyricsProxyUrl(lrcResult.content_url || lrcResult.url);
        if (lrcUrl) {
          try {
            const lines = await _fetchLrcLyrics(lrcUrl);
            if (!_stillCurrent()) return;
            if (lines) { lyricsData = { type: 'lrc', lines }; renderSpicyLyrics(lines, 'lrc'); return; }
          } catch (e) { console.warn('[Lyrics] LRC fetch failed:', e); }
        }
      }
      if (jsonResult || lrcResult) break;
    } catch (e) { console.warn(`[Lyrics] Grizzlyrics query "${q}" failed:`, e); }
  }

  // Fallback: lrclib.net — déjà en vol depuis le début de la fonction,
  // on attend juste qu'il finisse (souvent déjà bien avancé à ce stade).
  const lrclibResult = await lrclibPromise;
  if (!_stillCurrent()) return; // un autre morceau a démarré entre-temps
  if (lrclibResult?.type === 'lrc') {
    lyricsData = { type: 'lrc', lines: lrclibResult.lines };
    renderSpicyLyrics(lrclibResult.lines, 'lrc');
    return;
  }
  if (lrclibResult?.type === 'plain') {
    const plain = lrclibResult.text;
    lyricsDisplay.innerHTML = `<div class="spicy-scroll-container"><div class="lyrics-plain" style="padding:0 32px">${escapeHtml(plain).replace(/\n/g, '<br>')}</div></div>`;
    lyricsMiniContent.innerHTML = `<div class="lyrics-plain-mini">${escapeHtml(plain.slice(0, 400)).replace(/\n/g, '<br>')}${plain.length > 400 ? '…' : ''}</div>`;
    _autoTranslateIfEnabled();
    return;
  }

  lyricsDisplay.innerHTML = '<p class="placeholder" style="padding:60px 32px;color:var(--text-subdued);text-align:center">Aucune parole trouvée pour ce morceau.</p>';
  lyricsMiniContent.innerHTML = '<p class="placeholder-mini">Paroles non disponibles</p>';
}

// ── Traduction des paroles ──────────────────────────────────────────
let _lyricsOriginalLines = null; // (conservé pour compat, plus utilisé pour JSON/LRC)
let _lyricsTranslating   = false;
let _isTranslatedRender  = false; // évite la boucle traduire → re-rendre → hook → retraduire

// LibreTranslate — auto-hébergé, moteur Argos local (aucun scraping externe)
// Un seul point d'accès : notre instance locale via le proxy Caddy.
// Contrairement à Lingva, il n'existe plus de mirroir public gratuit fiable
// pour LibreTranslate (la plupart exigent désormais une clé API payante),
// donc pas de repli possible ici si l'instance locale est indisponible —
// d'où l'importance du script d'installation avec ses tests intégrés.
const _LIBRETRANSLATE_ENDPOINT = '/api/translate/translate';

// Accepte soit une chaîne unique, soit un tableau de chaînes : LibreTranslate
// gère nativement la traduction par lot (renvoie un tableau dans le même
// ordre), donc plus besoin du hack "séparateur maison" utilisé avec Lingva.
async function _translateText(input, targetLang = 'fr') {
  const isBatch = Array.isArray(input);
  const list = isBatch ? input : [input];
  if (!list.some(t => t?.trim())) return input;

  try {
    const resp = await fetch(_LIBRETRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: isBatch ? list : list[0],
        source: 'auto',
        target: targetLang,
        format: 'text'
      }),
      // Inférence neuronale locale : nettement plus lent qu'un simple
      // scraping Lingva, d'où un délai plus généreux.
      // Timeout généreux : un seul appel porte maintenant TOUTE la chanson
      // (plus de découpage par lots), donc ça peut prendre plus longtemps
      // qu'avant selon la longueur du texte.
      signal: AbortSignal.timeout(45000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data?.translatedText !== undefined) return data.translatedText;
    throw new Error('réponse sans translatedText');
  } catch (e) {
    console.warn('[Translation] LibreTranslate a échoué:', e);
    return input;
  }
}

// Traduit un tableau de "lignes brutes" (avant renderSpicyLyrics) en
// remplaçant leur texte de ligne et en supprimant les données mot-par-mot
// (words: null) — la ligne se rend alors comme un bloc unique traduit, via
// le même renderSpicyLyrics que d'habitude. L'animation (scroll, fondu,
// mise en avant de la ligne active) reste donc native, contrairement à un
// patch du DOM après coup qui doit lutter contre une boucle d'animation
// qui continue de tourner sur des éléments qu'on vient de modifier/cacher.
async function _translateRawLines(lines, targetLang) {
  const texts = lines.map(l => l.text || '');
  // Tout le fichier en un seul appel (tableau complet) plutôt que par lots
  // de 5 — plus simple, mais un seul gros appel ne se répartit pas sur les
  // 4 workers Gunicorn comme le faisaient les lots en parallèle.
  const res = await _translateText(texts, targetLang);
  const translated = Array.isArray(res) ? res : [res];
  return lines.map((l, i) => {
    const tText = translated[i] ?? l.text ?? '';
    const endMs = l.endMs ?? (l.startMs + 4500);
    return { ...l, text: tText, words: _redistributeWordTiming(tText, l.startMs, endMs) };
  });
}

// Le nombre de mots ne correspond (presque) jamais entre langue source et
// cible, donc impossible de garder le timing mot-à-mot original tel quel.
// On répartit le texte traduit en mots uniformément sur la durée d'origine
// de la ligne — l'alignement n'est pas sémantiquement exact, mais ça
// recrée un vrai remplissage mot par mot plutôt qu'un bloc figé.
function _redistributeWordTiming(text, lineStartMs, lineEndMs) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // Garde-fou : si le timing d'origine est invalide (pas un nombre), on ne
  // tente pas de redistribuer — ça produirait des NaN qui pourraient
  // corrompre l'affichage ailleurs. Repli sûr : bloc unique (comme avant).
  if (typeof lineStartMs !== 'number' || Number.isNaN(lineStartMs)) return null;
  const safeEndMs = (typeof lineEndMs === 'number' && !Number.isNaN(lineEndMs)) ? lineEndMs : lineStartMs + 2000;
  const total = Math.max(safeEndMs - lineStartMs, words.length * 150);
  const per = total / words.length;
  return words.map((w, i) => ({
    text: w,
    startMs: Math.round(lineStartMs + i * per),
    endMs:   Math.round(lineStartMs + (i + 1) * per),
    isPartOfWord: false,
  }));
}

async function _translateLyricsDisplay(targetLang) {
  if (_lyricsTranslating) return;
  _lyricsTranslating = true;

  const btn = document.getElementById('lyricsTranslateBtn');
  if (btn) { btn.textContent = '⟳ Traduction…'; btn.disabled = true; }

  try {
    if (!lyricsData) {
      // Paroles plain text : pas de karaoké ici, patch direct du DOM sans risque
      const plainEl = lyricsDisplay.querySelector('.lyrics-plain');
      if (plainEl) {
        const original = plainEl.dataset.original || plainEl.innerText;
        plainEl.dataset.original = original;
        if (plainEl.dataset.translatedCache && plainEl.dataset.translatedLang === targetLang) {
          // Déjà traduit pour cette langue — pas besoin de redemander au serveur
          plainEl.innerHTML = escapeHtml(plainEl.dataset.translatedCache).replace(/\n/g, '<br>');
        } else {
          const translated = await _translateText(original, targetLang);
          plainEl.dataset.translatedCache = translated;
          plainEl.dataset.translatedLang = targetLang;
          plainEl.innerHTML = escapeHtml(translated).replace(/\n/g, '<br>');
        }
      }
    } else if (lyricsData._translatedCache?.lang === targetLang) {
      // Déjà traduit pour cette langue pendant cette écoute (ex: bouton
      // "↩ Original" puis re-clic sur "Traduire") — instantané, pas de
      // nouvel appel réseau.
      _isTranslatedRender = true;
      renderSpicyLyrics(lyricsData._translatedCache.lines, lyricsData.type);
      _isTranslatedRender = false;
    } else {
      // Paroles LRC/JSON — tout le fichier traduit en un seul appel (voir
      // _translateRawLines), puis un seul rendu une fois la réponse reçue.
      const translatedLines = await _translateRawLines(lyricsData.lines, targetLang);
      lyricsData._translatedCache = { lang: targetLang, lines: translatedLines };
      _isTranslatedRender = true;
      renderSpicyLyrics(translatedLines, lyricsData.type);
      _isTranslatedRender = false;
    }

    if (btn) { btn.textContent = '↩ Original'; btn.dataset.mode = 'translated'; btn.disabled = false; }
  } catch (e) {
    console.error('[Translation] Erreur:', e);
    if (btn) { btn.textContent = 'Traduire'; btn.dataset.mode = ''; btn.disabled = false; }
  } finally {
    _lyricsTranslating = false;
  }
}

function _restoreOriginalLyrics() {
  if (lyricsData) {
    // Ré-affiche les données ORIGINALES (jamais modifiées) via le rendu natif
    _isTranslatedRender = true; // pas la peine que le hook auto se redéclenche
    renderSpicyLyrics(lyricsData.lines, lyricsData.type);
    _isTranslatedRender = false;
  } else {
    const plainEl = lyricsDisplay.querySelector('.lyrics-plain');
    if (plainEl?.dataset.original) {
      plainEl.innerHTML = escapeHtml(plainEl.dataset.original).replace(/\n/g, '<br>');
    }
  }
  const btn = document.getElementById('lyricsTranslateBtn');
  if (btn) { btn.textContent = 'Traduire'; btn.dataset.mode = ''; }
}

// Relance la traduction automatiquement quand de nouvelles paroles viennent
// d'être affichées (nouveau morceau, bascule simple/complet...), à condition
// que le réglage "Traduire les paroles" soit actif. _isTranslatedRender évite
// de re-déclencher sur le rendu qu'on vient nous-mêmes de produire avec du
// texte déjà traduit (sinon boucle : traduire → re-rendre → hook → retraduire
// le texte déjà traduit → ...).
function _autoTranslateIfEnabled() {
  if (!window._lyricsTranslation || _isTranslatedRender) return;
  _translateLyricsDisplay(window._lyricsTranslationLang || 'fr');
}

// Réinitialiser la traduction à chaque changement de piste
window.addEventListener('beartify:trackChanged', () => {
  _lyricsOriginalLines = null;
  _lyricsTranslating   = false;
});

// Réagir au changement de paramètre traduction depuis les settings
window.addEventListener('beartify:lyricsTranslationChanged', e => {
  window._lyricsTranslation     = e.detail.enabled;
  window._lyricsTranslationLang = e.detail.lang || 'fr';
  const btn = document.getElementById('lyricsTranslateBtn');
  if (btn) btn.style.display = e.detail.enabled ? '' : 'none';
  // Si activé automatiquement et paroles disponibles → traduire
  if (e.detail.enabled && (lyricsData || lyricsDisplay.querySelector('.lyrics-plain'))) {
    _translateLyricsDisplay(e.detail.lang || 'fr');
  } else if (!e.detail.enabled) {
    _restoreOriginalLyrics();
  }
});

document.getElementById('lyricsTranslateBtn')?.addEventListener('click', function() {
  if (this.dataset.mode === 'translated') {
    _restoreOriginalLyrics();
  } else {
    _translateLyricsDisplay(window._lyricsTranslationLang || 'fr');
  }
});

// ══════════════════════════════════════════════════════════════════
// TÉLÉCHARGEMENT VIP — via proxy Caddy /api/jellyfin/Items/{id}/Download
// Playlist → ZIP groupé via JSZip (chargé dynamiquement depuis cdnjs)
// ══════════════════════════════════════════════════════════════════

function _isVipUser() {
  return !!(window._vipActive === true || window._authUser?.vip === true || window.currentUser?.vip === true);
}

function _showVipGate() {
  if (document.getElementById('vipGateOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'vipGateOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:99999;background:rgba(0,0,0,0.82);backdrop-filter:blur(16px);animation:beartifyFadeIn 0.18s ease both';
  overlay.innerHTML = `
    <div style="background:#0a0a0a;border:1px solid rgba(255,200,0,0.18);border-radius:20px;padding:32px 28px;width:380px;max-width:95vw;box-shadow:0 40px 100px rgba(0,0,0,0.95);position:relative">
      <button id="vipGateClose" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.06);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:rgba(255,255,255,0.5);font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>

      <!-- Icon + titre -->
      <div style="text-align:center;margin-bottom:20px">
        <svg width="44" height="44" viewBox="0 0 246.989 246.989" fill="rgba(255,190,50,0.95)" style="margin-bottom:12px;display:block;margin-left:auto;margin-right:auto"><path d="M246.038,83.955l-39.424-70.664c-1.325-2.374-3.831-3.846-6.55-3.846H46.93c-2.719,0-5.225,1.471-6.55,3.846L0.951,83.955c-1.497,2.683-1.206,6.008,0.734,8.391l116.002,142.432a8.08,8.08,0,0,0,10.636,0L245.304,92.346C247.244,89.963,247.535,86.638,246.038,83.955z"/></svg>
        <div style="font-size:1.15rem;font-weight:800;color:#fff;letter-spacing:-0.02em">Fonctionnalité VIP</div>
        <div style="font-size:0.8rem;color:rgba(255,255,255,0.45);margin-top:6px;line-height:1.5">Le téléchargement est réservé aux membres VIP.<br>Les codes VIP sont distribués par les administrateurs<br>de Beartify via Discord ou les événements communautaires.</div>
      </div>

      <!-- Avantages -->
      <div style="background:linear-gradient(135deg,rgba(255,200,0,0.06),rgba(255,150,0,0.04));border:1px solid rgba(255,200,0,0.15);border-radius:10px;padding:12px 14px;margin-bottom:18px">
        <div style="font-size:0.72rem;font-weight:700;color:rgba(255,200,0,0.8);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">✦ Avantages VIP</div>
        <ul style="font-size:0.77rem;color:rgba(255,255,255,0.55);line-height:1.8;list-style:none;padding:0;margin:0">
          <li>⬡ Téléchargement en MP3 ou FLAC haute qualité</li>
          <li>⬡ Badge VIP exclusif sur votre profil</li>
          <li>⬡ Accès anticipé aux nouvelles fonctionnalités</li>
          <li>⬡ Support prioritaire</li>
        </ul>
      </div>

      <!-- Saisie du code -->
      <label style="font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.5);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em">Code d'activation VIP</label>
      <input id="vipGateCodeInput" type="text" maxlength="16" placeholder="XXXXXXXXXXXXXXXX" autocomplete="off" spellcheck="false"
        style="width:100%;box-sizing:border-box;padding:11px 14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:#fff;font-size:0.95rem;letter-spacing:0.12em;text-align:center;outline:none;font-family:monospace;margin-bottom:8px;transition:border-color 0.15s">
      <p id="vipGateError" style="font-size:0.73rem;color:#e74c3c;margin:0 0 10px;display:none;text-align:center"></p>

      <button id="vipGateActivateBtn"
        style="width:100%;padding:12px;background:linear-gradient(135deg,#f5a623,#e08a00);border:none;border-radius:500px;color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;margin-bottom:10px;transition:opacity 0.15s">
        Activer le statut VIP
      </button>
      <div style="text-align:center;font-size:0.74rem;color:rgba(255,255,255,0.3)">
        Pas de code ? Rejoins notre <a href="https://discord.gg/" target="_blank" rel="noopener" style="color:rgba(255,180,0,0.7);text-decoration:none">Discord</a> pour en obtenir un.
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#vipGateClose');
  const input    = overlay.querySelector('#vipGateCodeInput');
  const errEl    = overlay.querySelector('#vipGateError');
  const actBtn   = overlay.querySelector('#vipGateActivateBtn');

  const closeGate = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    setTimeout(() => overlay.remove(), 200);
  };

  closeBtn.addEventListener('click', closeGate);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeGate(); });

  // Focus sur l'input
  requestAnimationFrame(() => input.focus());

  // Activation du code
  const doActivate = async () => {
    const code = input.value.trim().replace(/[-\s]/g, '').toUpperCase();
    if (code.length !== 16) {
      errEl.textContent = 'Le code doit contenir exactement 16 caractères.';
      errEl.style.display = 'block';
      return;
    }
    actBtn.disabled = true;
    actBtn.textContent = 'Vérification…';
    errEl.style.display = 'none';

    if (window.FirebaseSync?.activateVip) {
      const ok = await window.FirebaseSync.activateVip(code);
      if (ok) {
        closeGate();
        showToast('✦ Statut VIP activé avec succès ! Bienvenue 🎉', 'success');
        window._vipActive = true;
        if (window._authUser) window._authUser.vip = true;
        document.body.classList.add('is-vip');
        _refreshVipUI();
      } else {
        errEl.textContent = 'Code invalide, déjà utilisé ou expiré.';
        errEl.style.display = 'block';
        actBtn.disabled = false;
        actBtn.textContent = 'Activer le statut VIP';
      }
    } else {
      errEl.textContent = 'Service indisponible. Réessayez après connexion.';
      errEl.style.display = 'block';
      actBtn.disabled = false;
      actBtn.textContent = 'Activer le statut VIP';
    }
  };

  actBtn.addEventListener('click', doActivate);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doActivate(); });
  // Mise en forme automatique : majuscules
  input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
}

function _safeFilename(s) {
  return (s || '').replace(/[/\\:*?"<>|]/g, '_').trim() || 'piste';
}

// Construit l'URL Jellyfin correcte selon la qualité choisie
// NOTE : /Items/{id}/Download retourne 404 si l'item est dans une bibliothèque
// dont l'accès par token-header seul n'est pas autorisé.
// /Audio/{id}/stream fonctionne dans tous les cas (header auth + fallback).
function _buildDownloadUrl(trackId) {
  const p = window._downloadQualityProfile || { format: 'flac', audioBitRate: 0 };
  const id = encodeURIComponent(trackId);
  if (p.format === 'mp3' && p.audioBitRate > 0) {
    // Transcoding MP3 réel via /Audio/{id}/stream — AudioBitRate seul est
    // le bon paramètre pour fixer un débit constant exact. MaxStreamingBitrate
    // (retiré) est interprété par Jellyfin comme une limite de débit TOTAL de
    // flux (héritage de l'API vidéo) et appliquait une marge de sécurité qui
    // redescendait le 320 kbps demandé à ~256 kbps réels.
    return [
      `/api/jellyfin/Audio/${id}/stream`,
      `?Container=mp3`,
      `&AudioCodec=mp3`,
      `&AudioBitRate=${p.audioBitRate}`,
      `&AudioSampleRate=44100`,
      `&MaxAudioChannels=2`,
      `&Static=false`,
      `&context=Static`,
    ].join('');
  }
  // FLAC : /Audio/{id}/stream avec Static=true → fichier original sans transcoding
  return `/api/jellyfin/Audio/${id}/stream?Static=true&Container=flac`;
}

async function _loadJSZip() {
  if (window.JSZip) return window.JSZip;
  return new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload  = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('JSZip load failed'));
    document.head.appendChild(s);
  });
}

// ══════════════════════════════════════════════════════════════════
// FLAC VORBIS COMMENT WRITER — injecte COMMENT et ENCODED-BY dans un
// blob FLAC sans toucher au reste du fichier (STREAMINFO, données
// audio, picture éventuelle). Nécessaire car le fichier FLAC original
// servi par Jellyfin ne contient pas forcément ces deux champs, et
// certains lecteurs stricts dépendent de blocs métadonnées reconnus
// pour calculer/afficher correctement les informations du fichier.
//
// Structure FLAC : "fLaC" (4 octets) + une suite de
// METADATA_BLOCK { header(4 octets) + data(N octets) }*
// Le header de bloc encode : 1 bit "is_last" + 7 bits "block_type"
// puis 24 bits "longueur du data" (big-endian).
// Type 4 = VORBIS_COMMENT, Type 0 = STREAMINFO (toujours premier, jamais "last").
// ══════════════════════════════════════════════════════════════════

function _readUint24BE(bytes, offset) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}
function _writeUint24BE(value) {
  return new Uint8Array([(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]);
}
function _writeUint32LE(value) {
  return new Uint8Array([value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF]);
}

// Construit un bloc VORBIS_COMMENT complet (sans le header METADATA_BLOCK)
// à partir d'une liste de paires clé=valeur, en préservant celles déjà
// présentes (sauf si la même clé est fournie en remplacement).
function _buildVorbisCommentBlock(existingComments, vendor, newPairs) {
  // Fusionner : on garde tous les commentaires existants dont la clé
  // (insensible à la casse) n'est pas redéfinie dans newPairs.
  const newKeys = new Set(newPairs.map(p => p.split('=')[0].toUpperCase()));
  const kept = existingComments.filter(c => !newKeys.has(c.split('=')[0].toUpperCase()));
  const allComments = [...kept, ...newPairs];

  const vendorBytes = _utf8Bytes(vendor);
  const parts = [_writeUint32LE(vendorBytes.length), vendorBytes, _writeUint32LE(allComments.length)];
  allComments.forEach(c => {
    const cBytes = _utf8Bytes(c);
    parts.push(_writeUint32LE(cBytes.length), cBytes);
  });
  return _concatBytes(parts);
}

// Parse les commentaires Vorbis existants depuis un bloc VORBIS_COMMENT brut
function _parseVorbisComments(blockData) {
  try {
    let off = 0;
    const vendorLen = blockData[off] | (blockData[off+1]<<8) | (blockData[off+2]<<16) | (blockData[off+3]<<24);
    off += 4 + vendorLen;
    const count = blockData[off] | (blockData[off+1]<<8) | (blockData[off+2]<<16) | (blockData[off+3]<<24);
    off += 4;
    const comments = [];
    for (let i = 0; i < count; i++) {
      const len = blockData[off] | (blockData[off+1]<<8) | (blockData[off+2]<<16) | (blockData[off+3]<<24);
      off += 4;
      comments.push(new TextDecoder('utf-8').decode(blockData.slice(off, off + len)));
      off += len;
    }
    return comments;
  } catch (e) {
    console.warn('[FLAC] Erreur parsing Vorbis Comment existant:', e);
    return [];
  }
}

async function _tagFlacBlob(flacBlob, track) {
  const bytes = new Uint8Array(await flacBlob.arrayBuffer());

  // Vérifier la signature FLAC
  if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== 'fLaC') {
    console.warn('[FLAC] Signature fLaC introuvable — fichier non modifié');
    return flacBlob;
  }

  // Parcourir les blocs métadonnées jusqu'à trouver VORBIS_COMMENT ou la fin
  let offset = 4;
  let vorbisBlockStart = -1, vorbisBlockDataLen = 0, vorbisBlockIsLast = false;
  let lastBlockEnd = 4; // position juste après le dernier bloc lu (pour insertion si absent)
  let sawLastFlag = false;

  while (offset < bytes.length) {
    const headerByte = bytes[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7F;
    const dataLen = _readUint24BE(bytes, offset + 1);
    const blockTotalLen = 4 + dataLen;

    if (blockType === 4) {
      vorbisBlockStart = offset;
      vorbisBlockDataLen = dataLen;
      vorbisBlockIsLast = isLast;
    }

    offset += blockTotalLen;
    lastBlockEnd = offset;
    if (isLast) { sawLastFlag = true; break; }
  }

  const newPairs = [
    `COMMENT=https://beartify.duckdns.org/`,
    `ENCODED-BY=Papa Ours Polaire`,
  ];
  // FLAC est un codec à débit variable par nature — il n'expose aucun
  // "bitrate" fixe comme un MP3, ce qui fait que certains lecteurs
  // affichent 0 Kbps faute de valeur native à lire. On calcule et
  // injecte un débit moyen approximatif (octets × 8 / durée) pour
  // les lecteurs qui savent lire ce champ informatif non-standard.
  if (track.duration > 0) {
    const approxBitrateKbps = Math.round((bytes.length * 8) / track.duration / 1000);
    if (approxBitrateKbps > 0) newPairs.push(`BITRATE=${approxBitrateKbps}`);
  }
  const vendor = 'reference libFLAC 1.4.2 20230623 (Beartify tag)';

  let existingComments = [];
  if (vorbisBlockStart !== -1) {
    const blockData = bytes.slice(vorbisBlockStart + 4, vorbisBlockStart + 4 + vorbisBlockDataLen);
    existingComments = _parseVorbisComments(blockData);
  }

  const newCommentData = _buildVorbisCommentBlock(existingComments, vendor, newPairs);

  // Construire le nouveau header de bloc (type 4, longueur sur 24 bits)
  function _buildBlockHeader(isLastFlag, length) {
    const lenBytes = _writeUint24BE(length);
    return new Uint8Array([(isLastFlag ? 0x80 : 0x00) | 4, lenBytes[0], lenBytes[1], lenBytes[2]]);
  }

  let result;
  if (vorbisBlockStart !== -1) {
    // Remplacer le bloc existant en place (en conservant son flag is_last)
    const before = bytes.slice(0, vorbisBlockStart);
    const after  = bytes.slice(vorbisBlockStart + 4 + vorbisBlockDataLen);
    const newHeader = _buildBlockHeader(vorbisBlockIsLast, newCommentData.length);
    result = _concatBytes([before, newHeader, newCommentData, after]);
  } else if (sawLastFlag) {
    // Aucun VORBIS_COMMENT existant : on insère un nouveau bloc juste avant
    // les données audio, et on retire le flag "is_last" du bloc précédent
    // (puisque notre nouveau bloc devient le dernier bloc métadonnées).
    const before = bytes.slice(0, lastBlockEnd);
    // Retirer le bit is_last (0x80) du dernier bloc précédemment marqué comme tel.
    // On doit retrouver son offset de header pour le corriger.
    let scanOff = 4, prevHeaderOffset = 4;
    while (scanOff < lastBlockEnd) {
      const hb = bytes[scanOff];
      const dl = _readUint24BE(bytes, scanOff + 1);
      prevHeaderOffset = scanOff;
      scanOff += 4 + dl;
    }
    const fixedBefore = new Uint8Array(before);
    fixedBefore[prevHeaderOffset] = fixedBefore[prevHeaderOffset] & 0x7F; // retire is_last
    const newHeader = _buildBlockHeader(true, newCommentData.length); // notre bloc devient le dernier
    const after = bytes.slice(lastBlockEnd);
    result = _concatBytes([fixedBefore, newHeader, newCommentData, after]);
  } else {
    // Structure FLAC inattendue (pas de flag is_last trouvé) — ne pas modifier
    console.warn('[FLAC] Structure de blocs métadonnées inattendue — fichier non modifié');
    return flacBlob;
  }

  console.log(`[FLAC] ✅ Tags Vorbis Comment écrits (COMMENT + ENCODED-BY), ${existingComments.length} champ(s) existant(s) préservé(s)`);
  return new Blob([result], { type: 'audio/flac' });
}

// ══════════════════════════════════════════════════════════════════
// ID3v2.3 TAG WRITER — injecte les métadonnées (titre, artiste, album,
// année, genre, cover art, commentaire, encodeur) dans un blob MP3.
//
// POURQUOI : le flux transcodé par Jellyfin (/Audio/{id}/stream) perd
// la cover art et certains tags lors du passage par ffmpeg en mode
// streaming — ce pipeline n'est pas conçu pour produire un fichier
// taggé, contrairement à /Items/{id}/Download (FLAC, fichier original
// intact). On réinjecte donc les tags manuellement côté client.
// ══════════════════════════════════════════════════════════════════

function _utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

// Taille de frame ID3v2.3 — entier big-endian classique sur 4 octets.
// IMPORTANT : contrairement à ID3v2.4, la taille des FRAMES en v2.3
// n'est PAS synchsafe — seule la taille du TAG GLOBAL (header) l'est.
// Utiliser synchsafe ici cassait silencieusement toute frame dont la
// taille dépassait quelques dizaines d'octets (COMM, APIC) tandis que
// les petites frames texte (TENC, TIT2 courts) semblaient fonctionner
// par coïncidence de valeurs proches.
function _frameSize(size) {
  return new Uint8Array([
    (size >> 24) & 0xFF,
    (size >> 16) & 0xFF,
    (size >> 8)  & 0xFF,
    size & 0xFF,
  ]);
}

// Synchsafe integer (7 bits utiles par octet) — UNIQUEMENT pour la taille
// du tag ID3v2 global dans le header de 10 octets, jamais pour les frames.
function _synchsafeTagSize(size) {
  return new Uint8Array([
    (size >> 21) & 0x7F,
    (size >> 14) & 0x7F,
    (size >> 7)  & 0x7F,
    size & 0x7F,
  ]);
}

// Encode une chaîne en UTF-16LE avec BOM — seul encodage Unicode valide
// en ID3v2.3 (0x03/UTF-8 n'existe qu'en ID3v2.4 et est rejeté par de
// nombreux parsers stricts quand le tag est déclaré en version 2.3).
function _utf16leBytes(str) {
  const bom = [0xFF, 0xFE];
  const out = [...bom];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out.push(code & 0xFF, (code >> 8) & 0xFF);
  }
  return new Uint8Array(out);
}

// Construit une frame de texte ID3v2.3 en UTF-16LE avec BOM —
// seul encodage Unicode valide dans cette version du tag (0x03/UTF-8
// n'existe qu'en ID3v2.4 et est rejeté par de nombreux lecteurs stricts).
function _id3TextFrame(id, text) {
  const textBytes = _utf16leBytes(text);
  const body = new Uint8Array(1 + textBytes.length);
  body[0] = 0x01; // encodage UTF-16LE avec BOM
  body.set(textBytes, 1);
  return _id3Frame(id, body);
}

// Frame de commentaire COMM (nécessite langue + description + texte)
function _id3CommentFrame(text, lang = 'fra') {
  const langBytes = _utf8Bytes(lang).slice(0, 3); // la langue est toujours ISO-8859-1/ASCII, 3 lettres
  const textBytes = _utf16leBytes(text);
  // null terminator UTF-16 = 2 octets (0x00 0x00)
  const body = new Uint8Array(1 + 3 + 2 + textBytes.length);
  let off = 0;
  body[off++] = 0x01; // encodage UTF-16LE avec BOM — valide en ID3v2.3
  body.set(langBytes, off); off += 3;
  body[off++] = 0x00; body[off++] = 0x00; // description vide + null terminator UTF-16 (2 octets)
  body.set(textBytes, off);
  return _id3Frame('COMM', body);
}

// Frame APIC (cover art) — type MIME + type d'image (3 = cover front) + description + data binaire
function _id3PictureFrame(imageBytes, mimeType = 'image/jpeg') {
  const mimeBytes = _utf8Bytes(mimeType);
  const body = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length);
  let off = 0;
  body[off++] = 0x00;             // encodage texte (ISO-8859-1 pour le MIME)
  body.set(mimeBytes, off); off += mimeBytes.length;
  body[off++] = 0x00;             // null terminator MIME
  body[off++] = 0x03;             // type d'image : 3 = Cover (front)
  body[off++] = 0x00;             // description vide + null terminator
  body.set(imageBytes, off);
  return _id3Frame('APIC', body);
}

// Construit une frame ID3v2 complète : ID (4) + taille big-endian classique (4) + flags (2) + body
function _id3Frame(frameId, body) {
  const idBytes    = _utf8Bytes(frameId);
  const sizeBytes  = _frameSize(body.length);
  const frame = new Uint8Array(4 + 4 + 2 + body.length);
  let off = 0;
  frame.set(idBytes, off); off += 4;
  frame.set(sizeBytes, off); off += 4;
  frame[off++] = 0x00; frame[off++] = 0x00; // flags
  frame.set(body, off);
  return frame;
}

// Concatène plusieurs Uint8Array
function _concatBytes(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  arrays.forEach(a => { out.set(a, off); off += a.length; });
  return out;
}

// Construit l'URL de la cover en PLEINE RÉSOLUTION pour le tagging ID3 —
// volontairement séparée de track.imageUrl (qui utilise ?width=300 pour
// les miniatures légères de l'UI). Aucun paramètre de taille ici : Jellyfin
// sert l'image dans sa résolution native stockée (1500×1500 ou plus).
// Même logique de fallback que track.imageUrl : cover du morceau d'abord,
// puis cover de l'album si le morceau n'en a pas.
function _buildHighResCoverUrl(track) {
  if (!track) return null;
  // On ne peut reconstruire l'URL haute résolution que si on a l'ID Jellyfin
  // du morceau ou de son album — ces champs existent sur les tracks de la
  // bibliothèque locale (mapJellyfinItem), mais pas forcément sur les objets
  // minimalistes venant de Firebase (playlists d'amis, cache distant).
  if (track.id) {
    return jellyfinUrl(`/Items/${track.id}/Images/Primary`);
  }
  if (track.albumId) {
    return jellyfinUrl(`/Items/${track.albumId}/Images/Primary`);
  }
  // Fallback : pas d'ID exploitable, on retombe sur la miniature existante
  // plutôt que de ne mettre aucune cover.
  return track.imageUrl || null;
}

// Récupère la cover art en bytes (JPEG/PNG natif, jamais re-encodé)
async function _fetchCoverBytes(imageUrl) {
  if (!imageUrl) { console.warn('[ID3] Aucune imageUrl fournie pour la cover'); return null; }
  try {
    // Résoudre en URL absolue par rapport à l'origine actuelle —
    // évite tout souci de chemin relatif mal interprété par fetch()
    const absoluteUrl = new URL(imageUrl, window.location.origin).href;
    const resp = await fetch(absoluteUrl);
    if (!resp.ok) {
      console.warn(`[ID3] Cover HTTP ${resp.status} pour ${absoluteUrl}`);
      return null;
    }
    const blob = await resp.blob();
    if (!blob || blob.size === 0) {
      console.warn('[ID3] Cover récupérée mais vide (0 octet)');
      return null;
    }
    const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const buf  = await blob.arrayBuffer();
    console.log(`[ID3] Cover récupérée : ${(buf.byteLength/1024).toFixed(1)} Ko, ${mime}`);
    return { bytes: new Uint8Array(buf), mime };
  } catch (e) {
    console.warn('[ID3] Impossible de récupérer la cover:', e);
    return null;
  }
}

// ── Construit le bloc ID3v2.3 complet et le préfixe au blob MP3 ────
async function _tagMp3Blob(mp3Blob, track) {
  const frames = [];

  if (track.title)  frames.push(_id3TextFrame('TIT2', track.title));
  if (track.artist) frames.push(_id3TextFrame('TPE1', track.artist));
  if (track.album)  frames.push(_id3TextFrame('TALB', track.album));
  if (track.year)   frames.push(_id3TextFrame('TYER', String(track.year)));
  if (track.genre)  frames.push(_id3TextFrame('TCON', track.genre));
  else if (Array.isArray(track.genres) && track.genres.length) {
    frames.push(_id3TextFrame('TCON', track.genres.join(', ')));
  }
  if (typeof track.indexNumber === 'number') {
    frames.push(_id3TextFrame('TRCK', String(track.indexNumber)));
  }
  // TLEN — durée exacte en millisecondes. Indispensable pour que les
  // lecteurs (et l'Explorateur Windows) calculent un bitrate moyen
  // correct (taille_fichier_octets × 8 / durée_secondes) au lieu
  // d'afficher 0 Kbps quand ils ne peuvent pas scanner tout le flux
  // MP3 transcodé en streaming progressif.
  if (track.duration > 0) {
    frames.push(_id3TextFrame('TLEN', String(Math.round(track.duration * 1000))));
  }

  // Commentaire + encodeur (demandés explicitement)
  frames.push(_id3CommentFrame('https://beartify.duckdns.org/'));
  frames.push(_id3TextFrame('TENC', 'Papa Ours Polaire'));

  // Cover art (le bug principal à corriger)
  const cover = await _fetchCoverBytes(_buildHighResCoverUrl(track));
  if (cover) {
    frames.push(_id3PictureFrame(cover.bytes, cover.mime));
    console.log(`[ID3] ✅ Cover ajoutée au tag (${cover.mime}, ${(cover.bytes.length/1024).toFixed(1)} Ko)`);
  } else {
    console.warn('[ID3] ⚠️ Pas de cover ajoutée — track.imageUrl:', track.imageUrl);
  }

  const framesBlock = _concatBytes(frames);
  const tagSize      = _synchsafeTagSize(framesBlock.length);

  // Header ID3v2.3 : "ID3" + version(2) + flags(1) + taille synchsafe(4)
  const header = new Uint8Array(10);
  header.set(_utf8Bytes('ID3'), 0);
  header[3] = 0x03; // version majeure 3 (ID3v2.3 — compatibilité maximale)
  header[4] = 0x00; // version mineure
  header[5] = 0x00; // flags
  header.set(tagSize, 6);

  const id3Block = _concatBytes([header, framesBlock]);
  const mp3Bytes = new Uint8Array(await mp3Blob.arrayBuffer());

  return new Blob([id3Block, mp3Bytes], { type: 'audio/mpeg' });
}

async function _downloadTrack(track) {
  if (!_isVipUser()) { _showVipGate(); return; }
  if (!track?.id) { showToast('Piste introuvable', 'error'); return; }
  const p = window._downloadQualityProfile || { ext: 'flac', label: 'FLAC CD' };
  showToast(`⬇️ Téléchargement "${escapeHtml(track.title)}" en ${p.label}…`, 'info');
  try {
    const resp = await fetch(_buildDownloadUrl(track.id));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let blob = await resp.blob();

    // MP3 transcodé : le flux ffmpeg streaming perd la cover et certains
    // tags — on réinjecte tout manuellement (ID3v2.3 complet).
    // FLAC : la cover et les tags principaux sont déjà présents dans le
    // fichier d'origine, mais COMMENT et ENCODED-BY n'y figurent pas —
    // on les ajoute via le bloc VORBIS_COMMENT sans toucher au reste.
    if (p.format === 'mp3') {
      try { blob = await _tagMp3Blob(blob, track); }
      catch (e) { console.warn('[ID3] Tagging échoué, fichier non-taggé conservé:', e); }
    } else {
      try { blob = await _tagFlacBlob(blob, track); }
      catch (e) { console.warn('[FLAC] Tagging échoué, fichier non-taggé conservé:', e); }
    }

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${_safeFilename(track.artist)} - ${_safeFilename(track.title)}.${p.ext || 'flac'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('✅ Téléchargement démarré', 'success');
  } catch (e) {
    console.error('[Download]', e);
    showToast('Erreur lors du téléchargement', 'error');
  }
}

let _downloadInProgress = false;

// ── Téléchargement progress popup avec cover + vraie progression ────
let _dlPopupCoverUrl = null;

function _showDownloadProgress(opts = {}) {
  // opts: { name, coverUrl, done, total, currentTrack, bytesLoaded, bytesTotal,
  //         secRemaining, zipPct, phase }
  // phase: 'init' | 'downloading' | 'zipping' | 'done'
  let el = document.getElementById('dlProgressPopup');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dlProgressPopup';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('dlp-open'));
  }

  const { name='', coverUrl=null, done=0, total=0,
          currentTrack='', bytesLoaded=0, bytesTotal=0,
          secRemaining=null, zipPct=null, phase='downloading' } = opts;

  // Stocker la cover pour la réutiliser
  if (coverUrl) _dlPopupCoverUrl = coverUrl;

  const isZip = phase === 'zipping';
  const trackPct = total > 0 ? (done / total) * 100 : 0;
  const bytesPct = bytesTotal > 0 ? (bytesLoaded / bytesTotal) * 100 : trackPct;
  const displayPct = isZip ? (zipPct || 0) : Math.min(bytesPct, 100);

  const formatBytes = b => b < 1024*1024 ? `${(b/1024).toFixed(0)} Ko` : `${(b/1024/1024).toFixed(1)} Mo`;
  const etaStr = (() => {
    if (isZip) return '';
    if (secRemaining === null || secRemaining <= 0) return '';
    const m = Math.floor(secRemaining / 60), s = secRemaining % 60;
    return m > 0 ? `~${m}m${s}s` : `~${s}s`;
  })();

  el.innerHTML = `
    <div class="dlp-cover-row">
      <div class="dlp-cover-art">${_dlPopupCoverUrl
        ? `<img src="${_dlPopupCoverUrl}" alt="">`
        : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`}
      </div>
      <div class="dlp-cover-info">
        <div class="dlp-title">${isZip ? '📦 Compression ZIP…' : '⬇️ Téléchargement'}</div>
        <div class="dlp-playlist-name">${escapeHtml(name)}</div>
        <div class="dlp-quality">${window._downloadQualityProfile?.label || 'FLAC CD'}</div>
      </div>
    </div>

    <div class="dlp-current-track">${isZip ? `Compression : ${Math.round(zipPct||0)}%` : escapeHtml(currentTrack)}</div>

    <div class="dlp-bar-wrap">
      <div class="dlp-bar-fill" style="width:${displayPct.toFixed(1)}%"></div>
    </div>

    <div class="dlp-footer">
      <span class="dlp-count">
        ${isZip
          ? `${Math.round(zipPct||0)}%`
          : `${done}/${total} titre${total>1?'s':''}`
        }${bytesLoaded > 0 ? ` · ${formatBytes(bytesLoaded)}` : ''}
      </span>
      <span class="dlp-eta">${etaStr}</span>
    </div>
  `;
}

function _closeDownloadProgress() {
  _dlPopupCoverUrl = null;
  const el = document.getElementById('dlProgressPopup');
  if (!el) return;
  el.classList.remove('dlp-open');
  el.classList.add('dlp-closing');
  setTimeout(() => el.remove(), 400);
}

async function _downloadPlaylist(plTracks, playlistName) {
  if (!_isVipUser()) { _showVipGate(); return; }
  if (!plTracks?.length) { showToast('Aucun titre à télécharger', 'error'); return; }
  if (_downloadInProgress) {
    showToast('Un téléchargement est déjà en cours — veuillez patienter.', 'warning');
    return;
  }
  _downloadInProgress = true;

  const p          = window._downloadQualityProfile || { ext: 'flac', label: 'FLAC CD' };
  const total      = plTracks.length;
  const coverUrl   = plTracks.find(t => t.imageUrl)?.imageUrl || null;

  _showDownloadProgress({ name: playlistName, coverUrl, done: 0, total, currentTrack: 'Chargement de JSZip…', phase: 'init' });

  let JSZip;
  try { JSZip = await _loadJSZip(); }
  catch (e) {
    _downloadInProgress = false; _closeDownloadProgress();
    showToast('Impossible de charger JSZip — vérifiez votre connexion', 'error');
    return;
  }

  const zip       = new JSZip();
  const folder    = zip.folder(_safeFilename(playlistName));
  let   success   = 0;
  let   failed    = 0;
  let   totalBytes = 0;
  let   loadedBytes = 0;
  const startTime  = Date.now();
  // Pré-estimer taille totale (FLAC ~30 Mo/titre, MP3 ~5 Mo)
  const estimatedPerTrack = p.format === 'mp3' ? 5 * 1024 * 1024 : 30 * 1024 * 1024;

  for (let i = 0; i < total; i++) {
    const t = plTracks[i];
    if (!t?.id) { failed++; continue; }

    // ETA basé sur bytes téléchargés et temps écoulé
    const elapsed   = (Date.now() - startTime) / 1000;
    const bytesRate = elapsed > 0 ? loadedBytes / elapsed : 0; // bytes/s
    const remaining = estimatedPerTrack * (total - i);
    const secEta    = bytesRate > 0 ? Math.round(remaining / bytesRate) : null;

    _showDownloadProgress({
      name: playlistName, coverUrl: t.imageUrl || coverUrl,
      done: i, total,
      currentTrack: `${t.title}${t.artist ? ' — ' + t.artist : ''}`,
      bytesLoaded: loadedBytes,
      bytesTotal:  estimatedPerTrack * total,
      secRemaining: secEta,
      phase: 'downloading',
    });

    try {
      const resp = await fetch(_buildDownloadUrl(t.id));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      let blob = await resp.blob();
      loadedBytes += blob.size;
      totalBytes  += blob.size;

      // Réinjecter cover + métadonnées pour les MP3 transcodés (le flux
      // ffmpeg streaming de Jellyfin ne les conserve pas), et COMMENT +
      // ENCODED-BY pour les FLAC (absents du fichier d'origine Jellyfin).
      if (p.format === 'mp3') {
        try { blob = await _tagMp3Blob(blob, t); }
        catch (e) { console.warn('[ID3] Tagging échoué pour', t.title, e); }
      } else {
        try { blob = await _tagFlacBlob(blob, t); }
        catch (e) { console.warn('[FLAC] Tagging échoué pour', t.title, e); }
      }

      folder.file(
        `${_safeFilename(t.artist)} - ${_safeFilename(t.title)}.${p.ext || 'flac'}`,
        blob
      );
      success++;
    } catch (e) {
      console.warn('[Download ZIP]', t.title, e);
      failed++;
    }
  }

  if (success === 0) {
    _downloadInProgress = false; _closeDownloadProgress();
    showToast('Aucun fichier récupéré — vérifiez votre connexion', 'error');
    return;
  }

  // Phase compression
  _showDownloadProgress({ name: playlistName, coverUrl, done: total, total, phase: 'zipping', zipPct: 0 });

  try {
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
      meta => _showDownloadProgress({
        name: playlistName, coverUrl, done: total, total,
        phase: 'zipping', zipPct: Math.round(meta.percent),
        currentTrack: `Compression : ${Math.round(meta.percent)}%`,
      })
    );

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `${_safeFilename(playlistName)} [${p.label}].zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    const failMsg = failed > 0 ? ` (${failed} erreur${failed>1?'s':''})` : '';
    showToast(`✅ ZIP prêt — ${success} titre${success>1?'s':''}${failMsg}`, 'success');
  } catch (e) {
    console.error('[Download ZIP] Erreur génération', e);
    showToast('Erreur lors de la création du ZIP', 'error');
  } finally {
    _downloadInProgress = false;
    _closeDownloadProgress();
  }
}

// Exposer globalement
window._downloadTrack    = _downloadTrack;
window._downloadPlaylist = _downloadPlaylist;
window._checkIsVip       = _isVipUser;  // fonction de vérification, jamais écrasée
// NOTE: window._vipActive (boolean) est géré par firebase-sync.js

// ── Playback controls ──────────────────────────────────────────────
playPauseBtn.addEventListener('click', () => {
  if (currentIndex === -1 && tracks.length > 0) { currentIndex = 0; playCurrentTrack(); return; }
  if (audioPlayer.paused) audioPlayer.play().catch(console.error);
  else audioPlayer.pause();
});

// ══════════════════════════════════════════════════════════════════
// MEDIA SESSION API — notification multimédia avec timeline interactive
// (écran de verrouillage Android, barre média Windows/Linux)
// ══════════════════════════════════════════════════════════════════
//
// updateMediaSession() est la fonction de synchronisation complète :
// metadata (titre/artiste/album/cover), playbackState, et position.
// Elle notifie aussi le backend Rust via update_media_session pour
// la notification persistante Android (tauri_plugin_notification).
//
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;

  const track = (typeof currentIndex !== 'undefined' && currentIndex >= 0 && tracks[currentIndex])
    ? tracks[currentIndex]
    : null;

  // ── Repli si aucune piste n'est chargée ──────────────────────────
  const title  = track?.title  || 'Beartify';
  const artist = track?.artist || 'Lecteur audio';
  const album  = track?.album  || '';
  const artUrl = track?.imageUrl || null;

  // ── Métadonnées ───────────────────────────────────────────────────
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: artUrl
        ? [
            { src: artUrl, sizes: '96x96',   type: 'image/jpeg' },
            { src: artUrl, sizes: '128x128', type: 'image/jpeg' },
            { src: artUrl, sizes: '192x192', type: 'image/jpeg' },
            { src: artUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: artUrl, sizes: '384x384', type: 'image/jpeg' },
            { src: artUrl, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  } catch (e) {
    console.warn('[MediaSession] Erreur metadata:', e);
  }

  // ── État de lecture ───────────────────────────────────────────────
  try {
    navigator.mediaSession.playbackState = audioPlayer.paused ? 'paused' : 'playing';
  } catch (e) {
    console.warn('[MediaSession] Erreur playbackState:', e);
  }

  // ── Position / durée / vitesse pour la timeline interactive ──────
  // Source de vérité pour la durée : audioPlayer._expectedDuration
  // (fournie par Jellyfin) si disponible, sinon audioPlayer.duration.
  try {
    const duration = audioPlayer._expectedDuration || audioPlayer.duration || 0;
    const position = audioPlayer.currentTime || 0;
    if (isFinite(duration) && duration > 0 && isFinite(position)) {
      navigator.mediaSession.setPositionState({
        duration:     duration,
        playbackRate: audioPlayer.playbackRate || 1,
        position:     Math.min(position, duration),
      });
    }
  } catch (e) {
    // setPositionState peut lever si duration/position sont incohérents
    // pendant un changement de piste — ignoré silencieusement.
  }

  // ── Backend Rust (Tauri) — notification persistante Android ──────
  if (window.__TAURI_INTERNALS__) {
    try {
      window.__TAURI_INTERNALS__.invoke('update_media_session', {
        title:    title,
        artist:   artist,
        album:    album,
        artUrl:   artUrl,
        isPlaying: !audioPlayer.paused,
      });
    } catch (e) {
      console.warn('[MediaSession] Erreur invoke Tauri:', e);
    }
  }
}
window._updateMediaSession = updateMediaSession;

// ── Action handlers — interactivité depuis la notification ─────────
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => {
      audioPlayer.play();
    });
  } catch (e) { /* navigateur sans support 'play' */ }

  try {
    navigator.mediaSession.setActionHandler('pause', () => {
      audioPlayer.pause();
    });
  } catch (e) { /* navigateur sans support 'pause' */ }

  try {
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      // Simule un clic réel sur le bouton existant pour préserver
      // toute la logique interne de la file d'attente / shuffle / repeat.
      prevBtn?.click();
    });
  } catch (e) { /* navigateur sans support 'previoustrack' */ }

  try {
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      nextBtn?.click();
    });
  } catch (e) { /* navigateur sans support 'nexttrack' */ }

  try {
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in audioPlayer) {
        audioPlayer.fastSeek(details.seekTime);
      } else {
        audioPlayer.currentTime = details.seekTime;
      }
      updateMediaSession();
    });
  } catch (e) { /* navigateur sans support 'seekto' */ }

  // Avance/retour rapide de 10s — bonus cohérent avec seekto
  try {
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      audioPlayer.currentTime = Math.min(
        audioPlayer.currentTime + skip,
        audioPlayer._expectedDuration || audioPlayer.duration || Infinity
      );
      updateMediaSession();
    });
  } catch (e) { /* non supporté */ }

  try {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      audioPlayer.currentTime = Math.max(audioPlayer.currentTime - skip, 0);
      updateMediaSession();
    });
  } catch (e) { /* non supporté */ }
}

audioPlayer.addEventListener('play', () => {
  playIconImg.style.display  = 'none';
  pauseIconImg.style.display = '';
  albumArtLarge.classList.add('playing');
  playPauseBtn.classList.add('is-playing');
  spicy.isPlaying = true;
  updateHomeCardPlayIcons();
  // Révéler barre player et panneau droit à la première lecture
  _showPlayerUI();
  // MediaSession : notification média + backend Rust (Tauri)
  updateMediaSession();
});

audioPlayer.addEventListener('pause', () => {
  playIconImg.style.display  = '';
  pauseIconImg.style.display = 'none';
  albumArtLarge.classList.remove('playing');
  playPauseBtn.classList.remove('is-playing');
  spicy.isPlaying = false;
  updateHomeCardPlayIcons();

  // MediaSession : notification média + backend Rust (Tauri)
  updateMediaSession();

  // ── Firebase Presence : notifier la pause ──
  if (window._settingsBroadcast !== false && window.FirebaseSync?.updatePresence && window.currentTrack) {
    const position = Math.floor(audioPlayer.currentTime || 0);
    window.FirebaseSync.updatePresence('paused', window.currentTrack, position);
  }
});

// MediaSession : metadata complètes dès que la durée/piste est connue
audioPlayer.addEventListener('loadedmetadata', () => {
  updateMediaSession();
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

// Helper : convertit un objet track en indice dans tracks[].
// _buildShuffleQueue peut retourner des copies (référence différente) → indexOf échoue.
// On tombe alors sur une recherche par .id, fiable dans tous les cas.
function _trackToIdx(t) {
  let idx = tracks.indexOf(t);
  if (idx === -1 && t?.id) idx = tracks.findIndex(tr => tr.id === t.id);
  return idx;
}


// S'assurer que shuffleOrder contient exactement toutes les pistes du contexte.
// _buildShuffleQueue peut en filtrer certaines (doublons, règles de diversification).
function _completeShuffleOrder(ctx) {
  if (!ctx || !ctx.length) return;
  const missing = ctx.filter(i => !shuffleOrder.includes(i));
  if (missing.length) {
    // Insérer les manquantes à des positions aléatoires (Fisher-Yates partiel)
    for (const i of missing) {
      const pos = Math.floor(Math.random() * (shuffleOrder.length + 1));
      shuffleOrder.splice(pos, 0, i);
    }
  }
}

// Fisher-Yates — vrai shuffle uniforme, sans biais de tri.
// Remplace partout [...arr].sort(() => Math.random() - 0.5) pour shuffleOrder.
function _fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Joue la piste à l'indice global idx.
// shuffleOrder n'est pas modifié : goNext continue simplement depuis
// la position de idx dans shuffleOrder.
function playTrackAt(idx) {
  if (isShuffled) {
    const ctx = window._playContext;
    // Reconstruire shuffleOrder seulement si idx n'est pas déjà en tête
    // (évite de casser la file quand on clique la piste déjà sélectionnée ou
    // que le contexte vient d'être posé avec idx en premier)
    if (shuffleOrder[0] !== idx) {
      if (ctx && ctx.length > 0) {
        const rest = _fisherYates(ctx.filter(i => i !== idx));
        shuffleOrder = [idx, ...rest];
      } else if (!shuffleOrder.includes(idx)) {
        shuffleOrder.unshift(idx);
      } else {
        // idx déjà dans shuffleOrder → le déplacer en tête
        shuffleOrder = [idx, ...shuffleOrder.filter(i => i !== idx)];
      }
    }
  }
  currentIndex = idx;
  playCurrentTrack();
}

function goNext() {
  if (!tracks.length) return;
  if (repeatMode === 2) { audioPlayer.currentTime = 0; audioPlayer.play(); return; }
  // Enregistrer le play même sur skip (ended ne se déclenche pas sur skip)
  if (window.currentTrack && audioPlayer.currentTime > 5) {
    window.FirebaseSync?.addToHistory?.(window.currentTrack, Math.floor(audioPlayer.currentTime));
  }

  // Recaler currentIndex et _playContext avec les indices frais de tracks[]
  _resolveCurrentIndex();
  _resolveCtx();

  // Recaler shuffleOrder : remplacer les indices stales par des indices frais via les IDs
  if (isShuffled && window._playContextIds && shuffleOrder.length > 0) {
    shuffleOrder = shuffleOrder.map(i => {
      const id = tracks[i]?.id;
      if (!id) return -1;
      return tracks.findIndex(t => t.id === id);
    }).filter(i => i !== -1);
  }

  const ctx = window._playContext;
  if (isShuffled) {
    const _rawPos = shuffleOrder.indexOf(currentIndex);
    const pos     = _rawPos === -1 ? shuffleOrder.length - 1 : _rawPos;
    const nextPos = pos + 1;
    if (nextPos < shuffleOrder.length) {
      // Piste suivante dans la file mélangée
      currentIndex = shuffleOrder[nextPos];
    } else {
      // File épuisée
      if (repeatMode === 1 && ctx && ctx.length > 0) {
        // Répéter : nouveau shuffle aléatoire, garanti différent de la dernière piste
        const lastIdx = currentIndex;
        shuffleOrder  = _fisherYates(ctx);
        // Si le premier élément est la piste qui vient de se terminer, la déplacer en fin
        if (shuffleOrder.length > 1 && shuffleOrder[0] === lastIdx) {
          shuffleOrder.push(shuffleOrder.shift());
        }
        currentIndex = shuffleOrder[0];
      } else if (ctx && ctx.length > 0) {
        // Fin de la playlist en shuffle sans répétition :
        // vérifier s'il reste des pistes non encore jouées
        const played  = new Set(shuffleOrder.slice(0, nextPos));
        const unplayed = ctx.filter(i => !played.has(i));
        if (unplayed.length > 0) {
          shuffleOrder = [...shuffleOrder, ..._fisherYates(unplayed)];
          currentIndex = shuffleOrder[nextPos];
        } else {
          // Toutes les pistes jouées → sortir du contexte
          _setPlayContext(null);
          currentIndex = (currentIndex + 1) % tracks.length;
        }
      } else {
        // Pas de contexte playlist → bibliothèque globale
        _setPlayContext(null);
        currentIndex = (currentIndex + 1) % tracks.length;
      }
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
        _setPlayContext(null);
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
// ⚠️ Choix architectural délibéré : PAS de second <audio>/HLS.js en
// parallèle pour un vrai chevauchement audio. Un second élément <audio>
// déclencherait une seconde session DRM (clé éphémère IP-lockée) et un
// second processus ffmpeg côté serveur pour la durée du fade — coût
// serveur doublé pour chaque transition. Voir _preloadNextTrack()
// ci-dessous, qui documente déjà ce choix pour le gapless.
// Ce qu'on fait à la place : fade-out précis en fin de piste (déjà en
// place) + fade-in symétrique au démarrage du titre suivant, pour que
// la coupure soit ressentie comme une transition plutôt qu'un silence
// suivi d'un démarrage brutal à plein volume.
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
      // Fade out uniquement le volume de lecture - _masterVolume reste intact
      // pour que la prochaine piste démarre au bon volume.
      audioPlayer.volume = vol * (window._masterVolume ?? 1);
    }
    if (remaining <= 0) {
      clearInterval(_crossfadeTimer);
      audioPlayer.volume = window._masterVolume ?? 1;
    }
  }, 200);
}

let _fadeInTimer = null;
function _startFadeIn() {
  const dur = window._settingsCrossfade || 0;
  const target = window._masterVolume ?? 1;
  if (_fadeInTimer) { clearInterval(_fadeInTimer); _fadeInTimer = null; }
  if (dur <= 0) { audioPlayer.volume = target; return; }
  audioPlayer.volume = 0;
  const start = Date.now();
  _fadeInTimer = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= dur) {
      audioPlayer.volume = target;
      clearInterval(_fadeInTimer);
      _fadeInTimer = null;
      return;
    }
    audioPlayer.volume = target * (elapsed / dur);
  }, 100);
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
  // HLS.js bufferise 30s d'avance nativement via l'instance active.
  // Un second <audio> en preload créerait une double session drm.js
  // et un double processus ffmpeg. On le désactive.
  if (_preloadAudio) { try { _preloadAudio.src = ''; } catch (_) {} }
  _preloadAudio = null;
}

// ── Volume normalization ───────────────────────────────────────────
// Uses Web Audio API to apply a subtle gain normalization
let _audioCtxNorm = null, _gainNode = null, _sourceNode = null;
function _applyNormalization(enabled) {
  try {
    if (enabled) {
      // Utiliser TOUJOURS le contexte partagé - jamais en créer un nouveau
      const ctx    = window._sharedAudioCtx;
      const source = window._sharedSourceNode;
      if (!ctx || !source) {
        // AudioGraph pas encore prêt - on s'abonne à l'event
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
  _startFadeIn();
  setTimeout(_preloadNextTrack, 5000);
  if (window._settingsNormalize) _applyNormalization(true);
  else if (_gainNode) _gainNode.gain.value = 1.0;
});

audioPlayer.addEventListener('ended', () => {
  // ── Firebase History : enregistrer l'écoute complète ──
  if (window._settingsSaveHistory !== false && window.FirebaseSync?.addToHistory && window.currentTrack) {
    const trackDur = audioPlayer._expectedDuration || window.currentTrack?.duration || 0;
    const duration = Math.floor(trackDur > 10 ? trackDur : (audioPlayer.duration || trackDur));
    window.FirebaseSync.addToHistory(window.currentTrack, duration);
  }

  // ── Play tracking pour les stats admin ──
  if (window.currentTrack) {
    window.FirebaseReports?.trackPlay?.(window.currentTrack);
  }

  // ── Firebase Presence : titre terminé ──
  if (window._settingsBroadcast !== false && window.FirebaseSync?.updatePresence) {
    window.FirebaseSync.updatePresence('stopped');
  }

  // Restore volume after crossfade
  audioPlayer.volume = window._masterVolume ?? 1;

  if (repeatMode === 2) {
    audioPlayer.currentTime = 0; audioPlayer.play();
  } else if (window._radioMode) {
    // Le Mode Radio gère sa propre suite (titre similaire via Last.fm,
    // puis repli même artiste, puis aléatoire) — voir _radioPlayNext()
    // dans settings.js, déclenché sur ce même événement 'ended' avec un
    // léger délai. Ne RIEN faire ici : sinon goNext() avance la file
    // normale en même temps que _radioPlayNext() choisit un autre titre,
    // et les deux se chevauchent (double changement de piste audible).
  } else if (window._settingsAutoplay !== false) {
    goNext();
  } else {
    // Autoplay désactivé et pas de suite : masquer l'UI player
    _hidePlayerUI();
  }
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
    const _ptCurIdx  = poolTracks.findIndex(t => t.id === tracks[currentIndex]?.id);
    const shuffled = window._buildShuffleQueue ? window._buildShuffleQueue(poolTracks, _ptCurIdx >= 0 ? _ptCurIdx : 0) : _fisherYates(poolTracks);
    // Utiliser _trackToIdx : fallback par .id si _buildShuffleQueue retourne des copies
    shuffleOrder = shuffled.map(_trackToIdx).filter(i => i !== -1);
    _completeShuffleOrder(pool);
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
  if (ri) {
    if (repeatMode === 2) {
      // Repeat one
      ri.innerHTML = `<path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h.75v1.5h-.75A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75zm11.28 7.457a.75.75 0 0 1-1.06-1.06l1.018-1.018H9.25a3.75 3.75 0 0 1-3.75-3.75v-5A3.75 3.75 0 0 1 9.25 1h2.5A3.75 3.75 0 0 1 15.5 4.75v5a3.75 3.75 0 0 1-2.253 3.44L10.44 10.5h2.31a.75.75 0 0 1 0 1.5H9.81l2.829 2.828-.001-.001.001.001zM7 4.75v5A2.25 2.25 0 0 0 9.25 12h2.5A2.25 2.25 0 0 0 14 9.75v-5A2.25 2.25 0 0 0 11.75 2.5h-2.5A2.25 2.25 0 0 0 7 4.75z"></path><path d="M10.467 7.088a.75.75 0 0 1 .666-.838l.75-.065a.75.75 0 0 1 .117 1.494l-.07.006V11a.75.75 0 0 1-1.5 0V8.684a.75.75 0 0 1 .037-1.596z"></path>`;
    } else {
      ri.innerHTML = `<path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75z"></path>`;
    }
  }
  const labels = ['Répétition désactivée', 'Répéter la liste', 'Répéter le titre'];
  showToast('↻ ' + labels[repeatMode], repeatMode > 0 ? 'info' : 'default');
});

// ── Progress ───────────────────────────────────────────────────────
audioPlayer.addEventListener('timeupdate', () => {
  if (isDragging) return;

  // Guard : bloquer tant que currentTime < 0.5 s (segments HLS initiaux instables)
  if (window._playerTimerLocked) {
    if (audioPlayer.currentTime >= 0.5) {
      window._playerTimerLocked = false;
    } else {
      return;
    }
  }

  // Durée de référence = UNIQUEMENT Jellyfin. audioPlayer.duration n'est jamais utilisé
  // pour l'affichage : il fluctue pendant le chargement HLS.js et provoque des flashs.
  const _dur = audioPlayer._expectedDuration || 0;
  const pct  = _dur > 0 ? Math.min((audioPlayer.currentTime / _dur) * 100, 100) : 0;
  updateProgressUI(pct, audioPlayer.currentTime);
  spicy.currentPosition = audioPlayer.currentTime * 1000;

  // MediaSession : mise à jour légère de la position uniquement (timeline
  // fluide sur l'écran de verrouillage Android/PC), sans recharger les
  // metadata complètes (titre/artiste/cover) à chaque tick.
  if ('mediaSession' in navigator) {
    try {
      const _msDur = audioPlayer._expectedDuration || audioPlayer.duration || 0;
      if (isFinite(_msDur) && _msDur > 0 && isFinite(audioPlayer.currentTime)) {
        navigator.mediaSession.setPositionState({
          duration:     _msDur,
          playbackRate: audioPlayer.playbackRate || 1,
          position:     Math.min(audioPlayer.currentTime, _msDur),
        });
      }
    } catch (e) { /* incohérence transitoire pendant un changement de piste — ignorée */ }
  }

  // Après la mise à jour de spicy.currentPosition
  if (window._pipWin && !window._pipWin.closed) {
    localStorage.setItem('beartify_lyrics_pos', spicy.currentPosition);
    localStorage.setItem('beartify_lyrics_time', Date.now());
  }

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

  // ── Détection fin de piste pour HLS.js (fallback si 'ended' ne se déclenche pas) ──
  // HLS.js ne déclenche pas toujours l'événement 'ended' sur un stream fMP4.
  // On détecte la fin quand currentTime dépasse (durée_track - 0.3 s) ET que
  // le player n'est pas en pause. Un guard _hlsEndedFired évite le double-goNext.
  if (!audioPlayer._hlsEndedFired && !audioPlayer.paused) {
    const trackDur = audioPlayer._expectedDuration || window.currentTrack?.duration || 0;
    // On utilise la durée Jellyfin si disponible, sinon audioPlayer.duration
    const refDur = (trackDur > 10) ? trackDur : (isFinite(audioPlayer.duration) ? audioPlayer.duration : 0);
    if (refDur > 0 && audioPlayer.currentTime >= refDur - 0.3) {
      audioPlayer._hlsEndedFired = true;
      // Simuler l'événement 'ended' en le déclenchant manuellement
      audioPlayer.dispatchEvent(new Event('ended'));
    }
  }
});
// Durée totale : figée sur track.duration (Jellyfin) dans playCurrentTrack.
// audioPlayer.duration / loadedmetadata ne touchent plus jamais totalTimeEl.
function updateProgressUI(pct, current) {
  progressFill.style.width  = pct + '%';
  progressThumb.style.left  = pct + '%';
  currentTimeEl.textContent = formatTime(current);
  // totalTimeEl est figé sur track.duration (Jellyfin) dès playCurrentTrack —
  // il n'est jamais réécrit ici ni ailleurs.
}

progressContainer.addEventListener('mousedown', e => { isDragging = true; seekTo(e); });
document.addEventListener('mousemove', e => { if (isDragging) seekTo(e); });
document.addEventListener('mouseup',   e => { if (isDragging) { isDragging = false; seekTo(e); } });
function seekTo(e) {
  const rect = progressContainer.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const dur  = audioPlayer._expectedDuration || 0;
  if (dur > 0) {
    audioPlayer.currentTime   = pct * dur;
    spicy.currentPosition     = audioPlayer.currentTime * 1000;
    progressFill.style.width  = (pct * 100) + '%';
    progressThumb.style.left  = (pct * 100) + '%';
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
    // totalTimeEl : pas touché
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
  if (v === 0) {
    vi.innerHTML = `<path d="M13.86 5.47a.75.75 0 0 0-1.061 0l-1.47 1.47-1.47-1.47A.75.75 0 0 0 8.8 6.53L10.269 8l-1.47 1.47a.75.75 0 1 0 1.06 1.06l1.47-1.47 1.47 1.47a.75.75 0 0 0 1.06-1.06L12.39 8l1.47-1.47a.75.75 0 0 0 0-1.06"></path><path d="M10.116 1.5A.75.75 0 0 0 8.991.85l-6.925 4a3.64 3.64 0 0 0-1.33 4.967 3.64 3.64 0 0 0 1.33 1.332l6.925 4a.75.75 0 0 0 1.125-.649v-1.906a4.7 4.7 0 0 1-1.5-.694v1.3L2.817 9.852a2.14 2.14 0 0 1-.781-2.92c.187-.324.456-.594.78-.782l5.8-3.35v1.3c.45-.313.956-.55 1.5-.694z"></path>`;
    vi.setAttribute('aria-label', 'Volume désactivé');
  } else if (v < 30) {
    vi.innerHTML = `<path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.64 3.64 0 0 1-1.33-4.967 3.64 3.64 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.14 2.14 0 0 0 0 3.7l5.8 3.35V2.8zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88"></path>`;
    vi.setAttribute('aria-label', 'Volume faible');
  } else if (v < 70) {
    vi.innerHTML = `<path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.64 3.64 0 0 1-1.33-4.967 3.64 3.64 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.14 2.14 0 0 0 0 3.7l5.8 3.35V2.8zm8.683 6.087a4.502 4.502 0 0 0 0-8.474v1.65a3 3 0 0 1 0 5.175z"></path>`;
    vi.setAttribute('aria-label', 'Volume moyen');
  } else {
    vi.innerHTML = `<path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.64 3.64 0 0 1-1.33-4.967 3.64 3.64 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.14 2.14 0 0 0 0 3.7l5.8 3.35V2.8zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88"></path><path d="M11.5 13.614a5.752 5.752 0 0 0 0-11.228v1.55a4.252 4.252 0 0 1 0 8.127z"></path>`;
    vi.setAttribute('aria-label', 'Volume élevé');
  }
}

// ── Like ───────────────────────────────────────────────────────────
function updateLikeButtons() {
  likeBtn?.classList.toggle('liked', isLiked);
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
document.getElementById('miniEtc')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const track = tracks[currentIndex];
  if (!track) { showToast('Aucune piste en cours', 'info'); return; }
  showAddToPlaylistPopup(e, track);
});

// ── Panel toggles ──────────────────────────────────────────────────
// nowPlayingBtn → géré par mini-player.js (Document Picture-in-Picture)


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
  _lastQueueUpcoming = upcoming; // mémorisé pour amorcer un contexte de réorganisation (voir plus bas)
  el.innerHTML = upcoming.map(idx => {
    const t = tracks[idx];
    return `<div class="panel-queue-item" data-idx="${idx}" data-id="${escapeHtml(t.id || '')}" draggable="true">
      <span class="panel-queue-drag" data-tooltip="Glisser pour réorganiser">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="2" r="1.4"/><circle cx="9" cy="2" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="14" r="1.4"/><circle cx="9" cy="14" r="1.4"/></svg>
      </span>
      <div class="panel-queue-art">${(t.imageUrlThumb || t.imageUrl) ? `<img src="${t.imageUrlThumb || t.imageUrl}" loading="lazy" decoding="async" alt="">` : ''}</div>
      <div class="panel-queue-meta">
        <div class="panel-queue-title">${escapeHtml(t.title)}</div>
        <div class="panel-queue-artist">${escapeHtml(t.artist)}</div>
      </div>
      <button class="panel-queue-etc" data-idx="${idx}" data-tooltip="Plus d'options">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
    </div>`;
  }).join('');
  el.querySelectorAll('.panel-queue-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.panel-queue-etc') || e.target.closest('.panel-queue-drag')) return;
      const idx = parseInt(item.dataset.idx);
      if (!isNaN(idx)) { playTrackAt(idx); }
    });
  });
  el.querySelectorAll('.panel-queue-etc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const t = tracks[idx];
      if (t) showTrackContextMenu(e, t);
    });
  });
  _wireQueueDragAndDrop(el);
}

// ── Réorganisation de la file d'attente par glisser-déposer ─────────
// Modifie directement _playContextIds (la source de vérité utilisée par
// goNext/goPrev — voir plus haut) et non un simple ordre d'affichage :
// l'ordre de lecture réel change vraiment, pas seulement son aperçu.
let _queueDragFromId = null;
let _lastQueueUpcoming = [];
function _wireQueueDragAndDrop(container) {
  const items = [...container.querySelectorAll('.panel-queue-item')];
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      _queueDragFromId = item.dataset.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Certains navigateurs (Firefox notamment) exigent au moins un
      // setData() pour initier correctement le drag — sans ça, le
      // drag pouvait rester bloqué / geler l'interaction.
      e.dataTransfer.setData('text/plain', item.dataset.id || '');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.panel-queue-item.drag-over').forEach(el2 => el2.classList.remove('drag-over'));
      _queueDragFromId = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (item.dataset.id === _queueDragFromId) return;
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const toId = item.dataset.id;
      if (!_queueDragFromId || !toId || _queueDragFromId === toId) return;
      _reorderQueueByTrackId(_queueDragFromId, toId);
      _queueDragFromId = null;
    });
  });
}

function _reorderQueueByTrackId(fromId, toId) {
  // Sans contexte de lecture explicite (ex: lecture depuis l'accueil),
  // on en amorce un — mais UNIQUEMENT à partir de la petite fenêtre de
  // titres à venir déjà affichée (~15), jamais de toute la bibliothèque.
  // Le fait de partir de tracks entier (jusqu'à ~20 000 titres) faisait
  // que _resolveCtx() (un .findIndex() par ID, donc O(n) par élément)
  // tournait sur un tableau géant à CHAQUE glisser-déposer et gelait
  // l'interface — c'était la cause du freeze.
  if (!window._playContextIds) {
    const base = _lastQueueUpcoming.length ? _lastQueueUpcoming.map(idx => tracks[idx]) : tracks.slice(0, 15);
    _setPlayContext(base.filter(Boolean).map(t => t.id));
  }
  const ids = window._playContextIds;
  if (!ids) return;
  const fromPos = ids.indexOf(fromId);
  const toPos   = ids.indexOf(toId);
  if (fromPos === -1 || toPos === -1) return;
  ids.splice(fromPos, 1);
  ids.splice(ids.indexOf(toId), 0, fromId);
  _resolveCtx();
  _renderPanelQueue();
}

function _renderPanelRecent() {
  const el = document.getElementById('panelRecentContent');
  if (!el) return;
  const rp = (window.recentlyPlayed?.length ? window.recentlyPlayed : recentlyPlayed) || [];
  if (!rp.length) {
    el.innerHTML = `<div style="padding:16px 8px;color:var(--text-subdued);font-size:0.8rem;text-align:center">Aucun titre écouté récemment</div>`;
    return;
  }
  el.innerHTML = rp.slice(0, 15).map((t, i) => {
    const idx = tracks.findIndex(tr => tr.id === t.id);
    return `<div class="panel-queue-item" data-idx="${idx}" data-id="${escapeHtml(t.id || '')}">
      <div class="panel-queue-art">${(t.imageUrlThumb || t.imageUrl) ? `<img src="${t.imageUrlThumb || t.imageUrl}" loading="lazy" decoding="async" alt="">` : ''}</div>
      <div class="panel-queue-meta">
        <div class="panel-queue-title">${escapeHtml(t.title)}</div>
        <div class="panel-queue-artist">${escapeHtml(t.artist)}</div>
      </div>
      <div class="panel-queue-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.panel-queue-item').forEach(item => {
    item.addEventListener('click', () => {
      const id  = item.dataset.id;
      const idx = id ? tracks.findIndex(t => t.id === id) : parseInt(item.dataset.idx);
      if (idx !== -1 && !isNaN(idx)) playTrackAt(idx);
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
      html += `<div class="pai-tags">${tags.map(t => `<button class="pai-tag" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join('')}</div>`;
    }

    // Bio
    if (bio && bio.length > 20) {
      html += `
        <div class="pai-section-title">À propos</div>
        <div class="pai-bio pai-bio-full">${escapeHtml(bio)}</div>`;
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
              ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" decoding="async" alt="">` : '<div class="pai-art-placeholder">♪</div>'}
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





    if (!html) html = `<div class="pai-artist-name">${escapeHtml(track.artist)}</div><div style="color:var(--text-subdued);font-size:0.8rem;margin-top:8px">Aucune information disponible</div>`;

    el.innerHTML = html;

    // Tags cliquables → toujours afficher la page de résultats de recherche
    el.querySelectorAll('.pai-tag[data-tag]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tagName = btn.dataset.tag;
        if (tagName) showSearchResultsPage(tagName);
      });
    });

    // Top track click → play
    el.querySelectorAll('.pai-track-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        if (!isNaN(idx) && idx >= 0) { playTrackAt(idx); }
      });
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
function _makePlaylistCoverHtml(plTracks, size = 'sm', customCoverUrl = null) {
  // Priorité absolue : cover personnalisée définie par l'utilisateur
  if (customCoverUrl) {
    return `<div class="pl-cover-wrap size-${size}">
      <img class="pl-cover-default pl-cover-custom" src="${customCoverUrl}" loading="lazy" decoding="async" alt="Playlist">
    </div>`;
  }

  // Collect unique cover URLs (up to 4) — vignette légère : chaque tuile
  // de la mosaïque ne fait que quelques dizaines de px.
  const covers = [];
  for (const t of (plTracks || [])) {
    const u = t.imageUrlThumb || t.imageUrl;
    if (u && !covers.includes(u)) covers.push(u);
    if (covers.length === 4) break;
  }

  const inner = covers.length >= 4
    ? `<div class="pl-cover-mosaic">${covers.map(u => `<img src="${u}" loading="lazy" decoding="async" alt="">`).join('')}</div>`
    : `<img class="pl-cover-default" src="pictures/playlist-icon.png" alt="Playlist" loading="lazy" decoding="async">`;

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
    return; // état identique - on ne pousse rien
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
    case 'notifications':
      _renderNotificationsPage();
      break;
    case 'friends':
      window._showFriendsActivity?.();
      break;
    case 'settings':
      if (window._openSettings) window._openSettings(false);
      break;
    case 'profile':
      if (state.docId && typeof showUserProfile === 'function') showUserProfile(state.docId, {}, false);
      break;
    case 'friend_playlist':
      if (state.tempId && typeof _showFriendPlaylistView === 'function') _showFriendPlaylistView(state.tempId, false);
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
  // Invalide toute complétion à la demande encore en vol (album/artiste/année,
  // voir showDetailView) : si l'utilisateur a quitté la vue détail entre-temps
  // (retour à l'accueil, recherche, etc.) sans repasser par showDetailView,
  // le jeton n'était sinon jamais invalidé et la réponse tardive du serveur
  // forçait la réaffichage de la discographie même après navigation ailleurs.
  // showDetailView incrémente à nouveau ce jeton juste après cet appel quand
  // c'est lui qui est à l'origine de la navigation, donc ce cas reste sain.
  window._detailViewToken = (window._detailViewToken || 0) + 1;
  welcomeContent.style.display    = 'none';
  lyricsPanel.style.display       = 'none';
  detailView.style.display        = 'none';
  searchResultsPage.style.display = 'none';
  if (userProfileView) userProfileView.style.display = 'none';
  const playlistView = document.getElementById('playlistView');
  if (playlistView) playlistView.style.display = 'none';
  const notifPage = document.getElementById('notificationsPage');
  if (notifPage) notifPage.style.display = 'none';
  lyricsBtn.classList.remove('active');
  document.getElementById('detailSortPanel')?.remove();
  const sp = document.getElementById('settingsPanel');
  if (sp) sp.style.display = 'none';
}

function _showDefaultContent() {
  const prev = [...navStack].reverse().find(s => !['lyrics','queue'].includes(s.view));
  if (prev?.view === 'detail')        { showDetailView(prev.type, prev.name, false); return; }
  if (prev?.view === 'playlist')      { if (window.showPlaylistView) window.showPlaylistView(prev.type, false); return; }
  if (prev?.view === 'search')        { showSearchResultsPage(prev.query, false); return; }
  if (prev?.view === 'notifications') { _renderNotificationsPage(); return; }
  if (prev?.view === 'friends')       { window._showFriendsActivity?.(); return; }
  if (prev?.view === 'profile')       { showUserProfile(prev.docId, {}, false); return; }
  welcomeContent.style.display = 'flex';
}

btnHome.addEventListener('click', () => {
  _hideAllMainPanels();
  welcomeContent.style.display = 'flex';
  pushNavState('home');
  requestAnimationFrame(_syncAllCarouselArrows);
});

// ── Notifications Button ──────────────────────────────────────
const btnNotifications = document.getElementById('btnNotifications');
if (btnNotifications) {
  btnNotifications.addEventListener('click', () => {
    _hideAllMainPanels();
    const notifPage = document.getElementById('notificationsPage');
    if (notifPage) notifPage.style.display = 'block';
    pushNavState('notifications');
    _renderNotificationsPage();
  });
}

// ── Friends Activity Button ───────────────────────────────────
const btnFriends = document.getElementById('btnFriends');
if (btnFriends) {
  btnFriends.addEventListener('click', () => {
    pushNavState('friends');
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

// ── Helpers toggle favori (immédiats, sans re-render complet) ──────
function _toggleAlbumFav(btn, name) {
  if (favoriteAlbums.has(name)) favoriteAlbums.delete(name);
  else favoriteAlbums.add(name);
  const isFav = favoriteAlbums.has(name);
  if (btn) {
    btn.classList.toggle('active', isFav);
    btn.innerHTML = isFav ? _BKMK_FILLED : _BKMK_EMPTY;
    btn.title = isFav ? 'Retirer des favoris' : 'Ajouter aux favoris';
    const titleEl = btn.closest('.lib-album-item')?.querySelector('.track-title');
    if (titleEl) titleEl.classList.toggle('fav-active', isFav);
    // Déplacer l'item en tête si ajouté aux favoris (sans re-render)
    const item = btn.closest('.lib-album-item');
    if (item && isFav) trackListDiv.prepend(item);
  }
  // Mise à jour immédiate de l'onglet Playlists si visible
  if (currentSidebarFilter === 'playlists') renderSidebarPlaylists();
  // Firebase asynchrone (ne bloque pas l'UI)
  window.FirebaseSync?.syncToFirestore?.();
}

function _toggleArtistFav(btn, name) {
  if (favoriteArtists.has(name)) favoriteArtists.delete(name);
  else favoriteArtists.add(name);
  const isFav = favoriteArtists.has(name);
  if (btn) {
    btn.classList.toggle('active', isFav);
    btn.innerHTML = isFav ? _BKMK_FILLED : _BKMK_EMPTY;
    btn.title = isFav ? 'Retirer des favoris' : 'Ajouter aux favoris';
    const item = btn.closest('.lib-artist-item');
    if (item && isFav) trackListDiv.prepend(item);
  }
  if (currentSidebarFilter === 'playlists') renderSidebarPlaylists();
  window.FirebaseSync?.syncToFirestore?.();
}

// ── Délégation unique sur trackListDiv (posé UNE SEULE FOIS) ───────
function _initLibDelegation() {
  if (!trackListDiv || trackListDiv._libDelegated) return;
  trackListDiv._libDelegated = true;

  trackListDiv.addEventListener('click', e => {
    // 1. Bouton favori
    const favBtn = e.target.closest('.lib-fav-btn');
    if (favBtn) {
      e.stopPropagation();
      if (favBtn.dataset.album)  _toggleAlbumFav(favBtn, favBtn.dataset.album);
      else if (favBtn.dataset.artist) _toggleArtistFav(favBtn, favBtn.dataset.artist);
      return;
    }
    // 2. Album item
    const albumItem = e.target.closest('.lib-album-item');
    if (albumItem) { showDetailView('album', albumItem.dataset.album); return; }
    // 3. Artiste item
    const artistItem = e.target.closest('.lib-artist-item');
    if (artistItem) { showDetailView('artist', artistItem.dataset.artist); return; }
    // 4. Playlists fixes
    if (e.target.closest('.lib-liked-songs-row'))  { window.showPlaylistView?.('liked'); return; }
    if (e.target.closest('.lib-favorites-row'))    { window.showPlaylistView?.('favorites'); return; }
    // 5. Albums/artistes favoris (Playlists tab)
    const favAlbRow = e.target.closest('.lib-fav-album-row');
    if (favAlbRow) { showDetailView('album', favAlbRow.dataset.album); return; }
    const favArtRow = e.target.closest('.lib-fav-artist-row');
    if (favArtRow) { showDetailView('artist', favArtRow.dataset.artist); return; }
    // 6. Playlists personnalisées
    const customRow = e.target.closest('.lib-custom-playlist-row');
    if (customRow) { window.showPlaylistView?.('custom:' + customRow.dataset.playlistId); return; }
  });
}

// ── Sidebar ────────────────────────────────────────────────────────
libToggleBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// ── Exposer renderSidebarView (appelé par Firebase sync) ──────────
window.renderSidebarView = renderSidebarView;

// ── Bouton "Créer une playlist" ───────────────────────────────────
function showCreatePlaylistModal(initialTrack = null) {
  const user = window._firebaseUser || window._authUser;
  if (!user) {
    showToast('Connectez-vous pour créer une playlist.', 'warning');
    return;
  }

  let _coverDataUrl = null;
  let _isPrivate = false;

  const modal = document.createElement('div');
  modal.className = 'create-playlist-modal';
  modal.innerHTML = `
    <div class="create-playlist-box">
      <button class="cpb-close" id="cpbClose" aria-label="Fermer">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="cpb-title">Créer une playlist</div>

      <!-- Cover image — optionnelle -->
      <div class="cpb-cover-section">
        <label class="cpb-cover-wrap" for="cpbCoverInput" data-tooltip="Changer la couverture (optionnel)">
          <div class="cpb-cover" id="cpbCover">
            ${initialTrack?.imageUrl
              ? `<img src="${initialTrack.imageUrl}" alt="" id="cpbCoverImg">`
              : `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`}
          </div>
          <div class="cpb-cover-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            <span>Choisir</span>
          </div>
        </label>
        <input type="file" id="cpbCoverInput" accept="image/*" style="display:none">
        <p class="cpb-cover-warning">En continuant, vous accordez à Beartify les droits de l'image que vous décidez d'importer. Vérifiez bien que vous avez le droit d'importer cette image.</p>
      </div>

      <div class="cpb-field-label">Nom <span class="cpb-required">*</span></div>
      <input class="cpb-input" id="cpbName" type="text" placeholder="Ma playlist" maxlength="60" autocomplete="off">

      <div class="cpb-field-label">Description <span class="cpb-optional">(optionnel)</span></div>
      <textarea class="cpb-input cpb-textarea" id="cpbDesc" placeholder="Description de la playlist…" maxlength="200"></textarea>

      <!-- Rendre privée -->
      <button class="cpb-private-toggle" id="cpbPrivateToggle" type="button">
        <svg id="cpbPrivateIcon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span id="cpbPrivateLabel">Rendre privée</span>
        <div class="cpb-toggle-track" id="cpbToggleTrack"><div class="cpb-toggle-thumb"></div></div>
      </button>

      <div class="cpb-actions">
        <button class="cpb-cancel" id="cpbCancel">Annuler</button>
        <button class="cpb-create" id="cpbCreate">Créer</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('cpb-open'));
  setTimeout(() => modal.querySelector('#cpbName')?.focus(), 80);

  // ── Cover image picker ──────────────────────────────────────────────
  modal.querySelector('#cpbCoverInput')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      _coverDataUrl = ev.target.result;
      const cover = modal.querySelector('#cpbCover');
      cover.innerHTML = `<img src="${_coverDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
    };
    reader.readAsDataURL(file);
  });

  // ── Rendre privée toggle ────────────────────────────────────────────
  modal.querySelector('#cpbPrivateToggle')?.addEventListener('click', () => {
    _isPrivate = !_isPrivate;
    modal.querySelector('#cpbToggleTrack')?.classList.toggle('active', _isPrivate);
    modal.querySelector('#cpbPrivateLabel').textContent = _isPrivate ? 'Playlist privée' : 'Rendre privée';
  });

  const closeModal = () => {
    modal.classList.remove('cpb-open');
    setTimeout(() => modal.remove(), 200);
  };
  modal.querySelector('#cpbClose')?.addEventListener('click', closeModal);
  modal.querySelector('#cpbCancel')?.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  const doCreate = async () => {
    const name = modal.querySelector('#cpbName')?.value?.trim();
    if (!name) {
      const inp = modal.querySelector('#cpbName');
      inp?.focus();
      inp?.classList.add('cpb-input-error');
      setTimeout(() => inp?.classList.remove('cpb-input-error'), 800);
      return;
    }
    const desc = modal.querySelector('#cpbDesc')?.value?.trim() || '';
    const createBtn = modal.querySelector('#cpbCreate');
    createBtn.disabled = true;
    createBtn.textContent = 'Création…';

    const playlistId = await window.FirebasePlaylists?.createPlaylist(name);
    if (playlistId) {
      const updates = {};
      if (desc)          updates.description = desc;
      if (_coverDataUrl) updates.coverUrl    = _coverDataUrl;
      if (_isPrivate)    updates.private     = true;
      if (Object.keys(updates).length) await window.FirebasePlaylists?.updatePlaylist?.(playlistId, updates);

      if (initialTrack && window.FirebasePlaylists?.addToPlaylist) {
        await window.FirebasePlaylists.addToPlaylist(playlistId, initialTrack);
      }
      showToast(`Playlist "${escapeHtml(name)}" créée !`, 'success');
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

// ── Bouton tri de la sidebar (lib-sort-btn) ─────────────────────
const libSortBtn = document.querySelector('.lib-sort-btn');
if (libSortBtn) {
  const _libSortOpts = [
    { key: 'alpha',    label: 'Alphabétique',       albumOnly: false },
    { key: 'artist',   label: 'Artiste',             albumOnly: true  },
    { key: 'count',    label: 'Nombre de titres',    albumOnly: false },
    { key: 'recent',   label: 'Récents',             albumOnly: false },
    { key: 'favFirst', label: 'Favoris en premier',  albumOnly: false },
  ];

  const _libSortLabels = {
    alpha: 'A → Z', artist: 'Artiste', count: 'Titres', recent: 'Récents', favFirst: 'Favoris'
  };

  function _updateLibSortLabel() {
    const span = libSortBtn.querySelector('span');
    if (span) span.textContent = _libSortLabels[libSortKey] || 'Récents';
  }

  let _libSortPanel = null;
  function _destroyLibSortPanel() {
    _libSortPanel?.remove();
    _libSortPanel = null;
    libSortBtn.classList.remove('active');
  }

  libSortBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (_libSortPanel) { _destroyLibSortPanel(); return; }

    const rect = libSortBtn.getBoundingClientRect();
    const isAlbums = currentSidebarFilter === 'albums';

    _libSortPanel = document.createElement('div');
    _libSortPanel.id = 'libSortPanel';
    _libSortPanel.style.cssText = [
      'position:fixed',
      `top:${rect.bottom + 6}px`,
      `right:${window.innerWidth - rect.right}px`,
      'z-index:99999',
      'min-width:200px',
      'background:#1c1c1c',
      'border:1px solid rgba(255,255,255,0.13)',
      'border-radius:10px',
      'padding:6px 0',
      'box-shadow:0 20px 60px rgba(0,0,0,0.85),0 4px 16px rgba(0,0,0,0.6)',
      'animation:dspSlideDown 0.18s cubic-bezier(0.4,0,0.2,1) both',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 16px 4px;font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4)';
    header.textContent = 'Trier par';
    _libSortPanel.appendChild(header);

    // Direction toggle only for alpha/count
    const dirOpts = libSortKey === 'alpha' || libSortKey === 'count' || libSortKey === 'recent'
      ? [{ dir: 1, label: libSortKey === 'count' ? 'Plus de titres d\'abord' : libSortKey === 'recent' ? 'Plus récents d\'abord' : 'A → Z' },
         { dir: -1, label: libSortKey === 'count' ? 'Moins de titres d\'abord' : libSortKey === 'recent' ? 'Plus anciens d\'abord' : 'Z → A' }]
      : null;

    _libSortOpts.filter(o => !o.albumOnly || isAlbums).forEach(opt => {
      const row = document.createElement('button');
      const isActive = libSortKey === opt.key;
      row.style.cssText = [
        'display:flex','align-items:center','justify-content:space-between',
        'width:100%','padding:10px 16px','background:none','border:none',
        `color:${isActive ? '#fff' : 'rgba(255,255,255,0.75)'}`,
        'font-family:inherit','font-size:0.88rem',`font-weight:${isActive ? '600' : '400'}`,
        'cursor:pointer','text-align:left','gap:8px','transition:background 0.1s',
      ].join(';');
      const dirArrow = isActive ? (libSortDir === 1 ? ' ↑' : ' ↓') : '';
      row.innerHTML = `<span>${opt.label}</span><span style="color:rgba(255,255,255,0.45);font-size:0.8rem">${dirArrow}</span>`;
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.08)'; };
      row.onmouseleave = () => { row.style.background = 'none'; };
      row.addEventListener('click', () => {
        if (libSortKey === opt.key) {
          libSortDir = -libSortDir;
        } else {
          libSortKey = opt.key;
          libSortDir = 1;
        }
        _updateLibSortLabel();
        renderSidebarView(currentSidebarFilter);
        _destroyLibSortPanel();
      });
      _libSortPanel.appendChild(row);
    });

    document.body.appendChild(_libSortPanel);
    libSortBtn.classList.add('active');

    setTimeout(() => {
      document.addEventListener('click', function _cls(ev) {
        if (!ev.target.closest('#libSortPanel') && !ev.target.closest('.lib-sort-btn')) {
          _destroyLibSortPanel();
          document.removeEventListener('click', _cls);
        }
      });
    }, 0);
  });

  _updateLibSortLabel();
}

// Search input
searchInput.addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  if (!term) { renderSidebarView(currentSidebarFilter); return; }

  if (currentSidebarFilter === 'albums') {
    const filtered = [..._getLibAlbumMap().values()].filter(a =>
      a.name.toLowerCase().includes(term) || a.artist.toLowerCase().includes(term));
    renderSidebarAlbums(filtered);
  } else if (currentSidebarFilter === 'artists') {
    const filtered = [..._getLibArtistMap().values()].filter(a =>
      a.name.toLowerCase().includes(term));
    renderSidebarArtists(filtered);
  } else {
    // Playlists : filtrer par nom de playlist personnalisée
    renderSidebarPlaylists();
  }
});

// Fullscreen
document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
  // ── Ouvre le mode immersif (background.js) au lieu du plein écran natif.
  // Le plein écran natif reste accessible via le bouton dédié dans le
  // :hover de la cover (immBtnNativeFs) ou via le raccourci clavier F11.
  window._openImmersive?.();
});

// ── Search dropdown ────────────────────────────────────────────────
function initSearchDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  const clearBtn = document.getElementById('searchClearBtn');
  if (!dropdown) return;

  let debounce = null;
  let _selectedIdx = -1;
  const _RECENTS_KEY = 'beartify_search_recents';

  function _getRecents() {
    try { return JSON.parse(localStorage.getItem(_RECENTS_KEY) || '[]'); } catch { return []; }
  }
  function _addRecent(term) {
    if (!term.trim()) return;
    let r = _getRecents().filter(x => x !== term).slice(0, 7);
    r.unshift(term);
    localStorage.setItem(_RECENTS_KEY, JSON.stringify(r));
  }
  function _clearRecent(term) {
    const r = _getRecents().filter(x => x !== term);
    localStorage.setItem(_RECENTS_KEY, JSON.stringify(r));
  }

  function _showRecents() {
    const recents = _getRecents();
    if (!recents.length) { hideDropdown(); return; }
    dropdown.innerHTML = `
      <div class="search-dropdown-header" style="display:flex;justify-content:space-between;align-items:center">
        <span>Recherches récentes</span>
        <button class="sdrop-clear-all" id="sdropClearAll">Tout effacer</button>
      </div>
      ${recents.map(r => `
        <div class="search-dropdown-item sdrop-recent-item" data-query="${escapeHtml(r)}">
          <div class="sdrop-art sdrop-art-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>
          </div>
          <div class="sdrop-meta"><div class="sdrop-title">${escapeHtml(r)}</div></div>
          <button class="sdrop-recent-remove" data-query="${escapeHtml(r)}" data-tooltip="Supprimer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`).join('')}`;
    dropdown.querySelector('#sdropClearAll')?.addEventListener('click', e => {
      e.stopPropagation();
      localStorage.removeItem(_RECENTS_KEY);
      hideDropdown();
    });
    dropdown.querySelectorAll('.sdrop-recent-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _clearRecent(btn.dataset.query);
        _showRecents();
      });
    });
    dropdown.querySelectorAll('.sdrop-recent-item').forEach(el => {
      el.addEventListener('click', () => {
        hideDropdown();
        topSearchInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        showSearchResultsPage(el.dataset.query);
      });
    });
    dropdown.classList.add('visible');
  }

  function _updateClear() {
    if (clearBtn) clearBtn.style.display = topSearchInput.value ? 'flex' : 'none';
  }

  topSearchInput.addEventListener('input', e => {
    clearTimeout(debounce);
    _selectedIdx = -1;
    const term = e.target.value.trim();
    _updateClear();
    if (!term) { _showRecents(); return; }
    debounce = setTimeout(() => showDropdownResults(term), 100);
  });

  topSearchInput.addEventListener('focus', e => {
    const term = e.target.value.trim();
    if (term) showDropdownResults(term);
    else _showRecents();
  });

  clearBtn?.addEventListener('click', () => {
    topSearchInput.value = '';
    clearBtn.style.display = 'none';
    topSearchInput.focus();
    _showRecents();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.top-search-container')) hideDropdown();
  });

  // Keyboard navigation
  topSearchInput.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.search-dropdown-item')];
    if (e.key === 'Escape') { hideDropdown(); topSearchInput.blur(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selectedIdx = Math.min(_selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('sdrop-focused', i === _selectedIdx));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selectedIdx = Math.max(_selectedIdx - 1, -1);
      items.forEach((el, i) => el.classList.toggle('sdrop-focused', i === _selectedIdx));
      return;
    }
    if (e.key === 'Enter') {
      if (_selectedIdx >= 0 && items[_selectedIdx]) {
        items[_selectedIdx].click(); return;
      }
      const term = topSearchInput.value.trim();
      if (term) {
        _addRecent(term);
        hideDropdown(); topSearchInput.blur();
        showSearchResultsPage(term);
        topSearchInput.value = '';
        _updateClear();
      }
    }
  });
}
function showDropdownResults(term) {
  const dropdown = document.getElementById('searchDropdown');
  if (!dropdown) return;
  const lc = term.toLowerCase();

  // ── Complétion à la demande ────────────────────────────────────
  // Si la synchro complète n'est pas terminée, on vérifie aussi côté
  // Jellyfin (léger : juste ce terme, pas toute la bibliothèque) et on
  // fusionne + re-rend seulement si ça révèle des titres absents du
  // sous-ensemble local actuellement chargé.
  if (!window._librarySyncComplete) {
    _searchTracksServer(term).then(serverTracks => {
      // Le champ de recherche a-t-il changé entre-temps ? Si oui, on
      // laisse le prochain `input` s'en charger, pas la peine de re-rendre
      // pour un terme qui n'est plus affiché.
      if (topSearchInput?.value.trim() !== term) return;
      if (!serverTracks?.length) {
        // Rien trouvé côté serveur non plus : si on affichait "recherche en
        // cours", basculer maintenant vers le vrai "aucun résultat".
        if (dropdown.querySelector('.search-dropdown-empty')) {
          dropdown.innerHTML = `<div class="search-dropdown-empty">Aucun résultat pour « ${escapeHtml(term)} »</div>`;
        }
        return;
      }
      const before = tracks.length;
      serverTracks.forEach(t => _ensureTrackInLibrary(t));
      if (tracks.length > before) showDropdownResults(term); // re-rend avec le set enrichi
    });
  }

  // Tracks
  const filteredTracks = tracks.filter(t =>
    t.title.toLowerCase().includes(lc) || t.artist.toLowerCase().includes(lc) || t.album.toLowerCase().includes(lc)
  ).slice(0, 6);

  // Artists
  const artistMap = new Map();
  tracks.forEach(t => {
    const artistList = (t.artists && t.artists.length > 1) ? t.artists : [t.artist];
    artistList.forEach(a => {
      if (a.toLowerCase().includes(lc) && !artistMap.has(a))
        artistMap.set(a, { name: a, imageUrl: t.imageUrl, imageUrlThumb: t.imageUrlThumb, count: 0 });
      if (artistMap.has(a)) artistMap.get(a).count++;
    });
  });
  const artistResults = [...artistMap.values()].slice(0, 3);

  // Albums
  const albumMap = new Map();
  tracks.forEach(t => {
    if (t.album.toLowerCase().includes(lc) && !albumMap.has(t.album))
      albumMap.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl, imageUrlThumb: t.imageUrlThumb });
  });
  const albumResults = [...albumMap.values()].slice(0, 3);

  const hasResults = filteredTracks.length || artistResults.length || albumResults.length;

  const artistsHtml = artistResults.length ? `
    <div class="sdrop-section-label">Artistes</div>
    ${artistResults.map(a => `
      <div class="search-dropdown-item sdrop-artist-item" data-artist="${escapeHtml(a.name)}">
        <div class="sdrop-art sdrop-art-round" style="background:${a.imageUrl ? 'transparent' : artistGradient(a.name)}">
          ${a.imageUrl ? `<img src="${a.imageUrlThumb || a.imageUrl}" loading="lazy" decoding="async" alt="" style="border-radius:50%">` : `<span class="sdrop-artist-letter">${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
        </div>
        <div class="sdrop-meta">
          <div class="sdrop-title">${highlightMatch(a.name, lc)}</div>
          <div class="sdrop-sub">Artiste · ${a.count} titre${a.count > 1 ? 's' : ''}</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><path d="M9 18l6-6-6-6"/></svg>
      </div>`).join('')}
    <div class="sdrop-divider"></div>` : '';

  const albumsHtml = albumResults.length ? `
    <div class="sdrop-section-label">Albums</div>
    ${albumResults.map(a => `
      <div class="search-dropdown-item sdrop-album-item" data-album="${escapeHtml(a.name)}">
        <div class="sdrop-art">
          ${a.imageUrl ? `<img src="${a.imageUrlThumb || a.imageUrl}" loading="lazy" decoding="async" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.3">`}
        </div>
        <div class="sdrop-meta">
          <div class="sdrop-title">${highlightMatch(a.name, lc)}</div>
          <div class="sdrop-sub">Album · ${escapeHtml(a.artist)}</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><path d="M9 18l6-6-6-6"/></svg>
      </div>`).join('')}
    <div class="sdrop-divider"></div>` : '';

  const tracksHtml = filteredTracks.length ? `
    ${(artistResults.length || albumResults.length) ? '<div class="sdrop-section-label">Titres</div>' : ''}
    ${filteredTracks.map((track, i) => `
      <div class="search-dropdown-item" data-id="${track.id}" style="animation-delay:${i*0.03}s">
        <div class="sdrop-art">${track.imageUrl ? `<img src="${track.imageUrlThumb || track.imageUrl}" loading="lazy" decoding="async" alt="">` : `<img src="pictures/default-cover.png" alt="" style="opacity:0.3">`}</div>
        <div class="sdrop-meta">
          <div class="sdrop-title">${highlightMatch(track.title, lc)}</div>
          <div class="sdrop-sub">${highlightMatch(track.artist, lc)} • ${escapeHtml(track.album)}</div>
        </div>
        <div class="sdrop-dur">${formatTime(track.duration)}</div>
      </div>`).join('')}` : '';

  const stillChecking = !hasResults && !window._librarySyncComplete;

  dropdown.innerHTML = !hasResults
    ? (stillChecking
        ? `<div class="search-dropdown-empty"><div class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px"></div>Recherche en cours…</div>`
        : `<div class="search-dropdown-empty">Aucun résultat pour « ${escapeHtml(term)} »</div>`)
    : `<div class="search-dropdown-header">Résultats pour « ${escapeHtml(term)} »</div>
       ${artistsHtml}${albumsHtml}${tracksHtml}
       <div class="search-dropdown-seeall" data-query="${escapeHtml(term)}">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>
         Voir tous les résultats pour « ${escapeHtml(term)} »
       </div>`;

  // Track click
  dropdown.querySelectorAll('.search-dropdown-item:not(.sdrop-artist-item):not(.sdrop-album-item)').forEach(el => {
    el.addEventListener('click', () => {
      const idx = tracks.findIndex(t => String(t.id) === el.dataset.id);
      if (idx !== -1) { playTrackAt(idx); }
      hideDropdown(); topSearchInput.value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
    });
  });
  // Artist click
  dropdown.querySelectorAll('.sdrop-artist-item').forEach(el => {
    el.addEventListener('click', () => {
      hideDropdown(); topSearchInput.value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
      showDetailView('artist', el.dataset.artist);
    });
  });
  // Album click
  dropdown.querySelectorAll('.sdrop-album-item').forEach(el => {
    el.addEventListener('click', () => {
      hideDropdown(); topSearchInput.value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
      showDetailView('album', el.dataset.album);
    });
  });
  // See all click
  dropdown.querySelector('.search-dropdown-seeall')?.addEventListener('click', el => {
    const q = el.currentTarget.dataset.query;
    hideDropdown(); topSearchInput.value = '';
    document.getElementById('searchClearBtn').style.display = 'none';
    // Sauvegarder dans les recherches récentes
    try {
      let r = JSON.parse(localStorage.getItem('beartify_search_recents') || '[]');
      r = [q, ...r.filter(x => x !== q)].slice(0, 8);
      localStorage.setItem('beartify_search_recents', JSON.stringify(r));
    } catch {}
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
//  HOME PAGE - carousels (no greeting, no full track list)
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

// ══════════════════════════════════════════════════════════════════
//  SQUELETTE DE CHARGEMENT (accueil) — façon Spotify : le contenu
//  central affiche immédiatement des cartes/rangées "fantômes" avec un
//  effet shimmer, plutôt qu'un accueil vide en attendant les données.
//  Utilise les VRAIES classes de rendu final (home-card, quick-tile,
//  home-section, home-row-scroll...) donc les dimensions/marges collent
//  exactement à celles déjà définies dans style.css — pas de valeurs
//  devinées. Chaque section réelle remplace son conteneur via innerHTML
//  dès que les données arrivent, le squelette disparaît tout seul.
// ══════════════════════════════════════════════════════════════════
function _injectSkeletonStyles() {
  if (document.getElementById('beartify-skeleton-styles')) return;
  const style = document.createElement('style');
  style.id = 'beartify-skeleton-styles';
  style.textContent = `
    .is-skel, .is-skel * { pointer-events: none; }
    .is-skel .skel-block {
      position: relative;
      overflow: hidden;
      background: var(--bg-tinted, #2a2a2a);
      border-radius: 4px;
      color: transparent !important;
    }
    .is-skel .skel-block::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
      transform: translateX(-100%);
      animation: skel-shimmer-sweep 1.6s ease-in-out infinite;
    }
    @keyframes skel-shimmer-sweep { 100% { transform: translateX(100%); } }
    .is-skel .home-card-art,
    .is-skel .quick-tile-art { background: var(--bg-tinted, #2a2a2a); }
    .is-skel .home-card-title,
    .is-skel .home-card-sub,
    .is-skel .quick-tile-name { height: 12px; margin-top: 4px; }
    .is-skel .home-section-header h2.skel-block { display: inline-block; width: 160px; height: 20px; }
  `;
  document.head.appendChild(style);
}

// Génère N vraies `.home-card` (mêmes classes que le rendu final) en mode
// squelette : mêmes dimensions, juste le contenu masqué + shimmer.
function _skeletonHomeCards(count) {
  return Array.from({ length: count }, (_, i) => `
    <div class="home-card is-skel" style="animation-delay:${Math.min(i * 0.04, 0.4)}s">
      <div class="home-card-art skel-block"></div>
      <div class="home-card-title skel-block">&nbsp;</div>
      <div class="home-card-sub skel-block">&nbsp;</div>
    </div>`).join('');
}

function renderHomeSkeleton() {
  _injectSkeletonStyles();

  // 6 tuiles du haut — vraies `.quick-tile`, contenu masqué
  const quickGrid = document.getElementById('homeQuickGrid');
  if (quickGrid && !quickGrid.children.length) {
    quickGrid.innerHTML = Array.from({ length: 6 }, () => `
      <div class="quick-tile is-skel">
        <div class="quick-tile-art skel-block"></div>
        <span class="quick-tile-name skel-block">&nbsp;</span>
      </div>`).join('');
  }

  // Section "Suggestions pour vous" — vraies `.home-card` dans `#suggestGrid`
  const suggestSection = document.getElementById('suggestSection');
  const suggestGrid    = document.getElementById('suggestGrid');
  if (suggestSection && suggestGrid) {
    suggestGrid.innerHTML = _skeletonHomeCards(20);
    suggestSection.style.display = 'block';
  }

  // Carrousels dynamiques — même structure DOM que _appendCarousel()
  // (home-section / home-section-header / home-row-scroll) pour que le
  // titre placeholder tombe exactement à la même place que le vrai titre.
  const carouselsContainer = document.getElementById('genreCarouselsContainer');
  if (carouselsContainer) {
    carouselsContainer.innerHTML = Array.from({ length: 2 }, () => `
      <div class="home-section is-skel">
        <div class="home-section-header"><h2 class="skel-block">&nbsp;</h2></div>
        <div class="carousel-wrapper">
          <div class="home-row-scroll">${_skeletonHomeCards(20)}</div>
        </div>
      </div>`).join('');
  }
}

function renderHomePage() {
  renderQuickTiles();
  // Defer recommended and carousels to not block initial render
  setTimeout(renderRecommendedSection, 50);
  setTimeout(renderDynamicCarousels, 400);
}

function renderQuickTiles() {
  const grid = document.getElementById('homeQuickGrid');
  if (!grid) return;

  const rp = (window.recentlyPlayed || recentlyPlayed || []).filter(t => t?.id);

  if (!rp.length && tracks.length === 0) return;

  // Build deduplicated list: albums first, then individual tracks as fallback
  const seen = new Set();
  const picks = [];

  // 1. Albums from recently played
  rp.forEach(t => {
    if (picks.length >= 6) return;
    const key = 'album:' + t.album;
    if (t.album && !seen.has(key)) { seen.add(key); picks.push({ ...t, _isAlbum: true }); }
  });

  // 2. Playlists récentes custom
  const cpls = Object.values(window.customPlaylists || {})
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  cpls.forEach(pl => {
    if (picks.length >= 6) return;
    const key = 'pl:' + pl.id;
    if (!seen.has(key)) {
      seen.add(key);
      const firstTrack = (pl.tracks || [])[0];
      picks.push({ id: pl.id, title: pl.name, imageUrl: pl.coverUrl || firstTrack?.imageUrl || '', _isPlaylist: true, _pl: pl });
    }
  });

  // 3. Fallback: individual recent tracks
  rp.forEach(t => {
    if (picks.length >= 6) return;
    const key = 'track:' + t.id;
    if (!seen.has(key)) { seen.add(key); picks.push(t); }
  });

  // 4. If still empty, random tracks
  if (!picks.length && tracks.length > 0) {
    const step = Math.max(1, Math.floor(tracks.length / 6));
    for (let i = 0; picks.length < 6; i++) {
      const idx = (i * step) % tracks.length;
      picks.push(tracks[idx]);
    }
  }

  grid.innerHTML = picks.slice(0, 6).map(item => `
    <div class="quick-tile" data-id="${escapeHtml(String(item.id))}" data-type="${item._isPlaylist ? 'playlist' : item._isAlbum ? 'album' : 'track'}">
      <div class="quick-tile-art">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" decoding="async">` : `<div class="quick-tile-art-placeholder">${item._isPlaylist ? '🎵' : '🎵'}</div>`}
      </div>
      <span class="quick-tile-name">${escapeHtml(item.title)}</span>
    </div>
  `).join('');

  grid.querySelectorAll('.quick-tile').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.dataset.type;
      const id   = el.dataset.id;
      if (type === 'album') {
        const t = picks.find(p => String(p.id) === id);
        if (t?.album) { showDetailView('album', t.album); return; }
      }
      if (type === 'playlist') {
        const t = picks.find(p => String(p.id) === id);
        if (t?._pl) {
          window._currentPlaylistId = t._pl.id;
          if (window.showPlaylistView) window.showPlaylistView('custom', true);
          return;
        }
      }
      const idx = (() => {
        let i = tracks.findIndex(t => String(t.id) === id);
        if (i === -1) {
          const fb = picks.find(p => String(p.id) === id);
          if (fb) i = _ensureTrackInLibrary(fb);
        }
        return i;
      })();
      if (idx !== -1) playTrackAt(idx);
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// ALGORITHME DE RECOMMANDATION — "Recommandations du jour"
// ══════════════════════════════════════════════════════════════════
// Principe : scorer chaque piste de la bibliothèque selon plusieurs
// signaux pondérés, puis échantillonner en privilégiant les scores
// élevés tout en gardant une part d'exploration (découverte).
//
// Signaux utilisés :
//   1. Affinité artiste   — l'utilisateur a-t-il déjà écouté/aimé/favorisé cet artiste ?
//   2. Affinité genre     — le genre de la piste correspond-il aux genres les + écoutés ?
//   3. Récence d'écoute   — pénalise les titres écoutés très récemment (éviter répétition)
//   4. Fraîcheur          — bonus léger pour les titres jamais écoutés (découverte)
//   5. Popularité locale  — bonus pour les titres déjà beaucoup écoutés (renforcement)
//
// Le score final mélange ces signaux ; un bruit aléatoire contrôlé
// (epsilon-greedy ~15%) garantit que les recommandations changent
// d'un jour à l'autre sans être 100% déterministes.
// ══════════════════════════════════════════════════════════════════

function _buildTasteProfile() {
  const history = window.recentlyPlayed || recentlyPlayed || [];

  // ── Score par artiste (écoute + like + favori) ──────────────────
  const artistScore = new Map();
  history.forEach((t, i) => {
    if (!t?.artist) return;
    // Les écoutes les + récentes comptent plus (poids décroissant)
    const recencyWeight = Math.max(0.3, 1 - i / Math.max(history.length, 1));
    artistScore.set(t.artist, (artistScore.get(t.artist) || 0) + recencyWeight);
  });
  likedTracks.forEach(id => {
    const t = tracks.find(tr => tr.id === id);
    if (t?.artist) artistScore.set(t.artist, (artistScore.get(t.artist) || 0) + 2);
  });
  favoriteArtists.forEach(name => {
    artistScore.set(name, (artistScore.get(name) || 0) + 4);
  });

  // ── Score par genre (déduit des pistes écoutées/aimées) ─────────
  const genreScore = new Map();
  const addGenreSignal = (t, weight) => {
    const genres = t?.genres || (t?.genre ? [t.genre] : []);
    genres.forEach(g => genreScore.set(g, (genreScore.get(g) || 0) + weight));
  };
  history.forEach((t, i) => addGenreSignal(t, Math.max(0.2, 1 - i / Math.max(history.length, 1))));
  likedTracks.forEach(id => addGenreSignal(tracks.find(tr => tr.id === id), 1.5));

  // ── Map id → dernier timestamp d'écoute (pour pénaliser la répétition) ──
  const lastPlayedAt = new Map();
  history.forEach((t, i) => {
    if (t?.id && !lastPlayedAt.has(t.id)) lastPlayedAt.set(t.id, i); // i=0 = le + récent
  });

  // ── Compteur d'écoutes par id (popularité personnelle) ──────────
  const playCount = new Map();
  history.forEach(t => { if (t?.id) playCount.set(t.id, (playCount.get(t.id) || 0) + 1); });

  return { artistScore, genreScore, lastPlayedAt, playCount };
}

function _scoreTrack(t, profile) {
  let score = 0;

  // 1. Affinité artiste (signal le plus fort)
  score += (profile.artistScore.get(t.artist) || 0) * 3;

  // 2. Affinité genre
  const genres = t.genres || (t.genre ? [t.genre] : []);
  genres.forEach(g => { score += (profile.genreScore.get(g) || 0) * 1.5; });

  // 3. Pénalité de récence — éviter de proposer ce qu'on vient d'écouter
  const recentIdx = profile.lastPlayedAt.get(t.id);
  if (recentIdx !== undefined) {
    // Plus l'écoute est récente (idx petit), plus la pénalité est forte
    score -= Math.max(0, 5 - recentIdx * 0.3);
  }

  // 4. Bonus légèrement aléatoire pour la découverte (jamais écouté)
  if (!profile.playCount.has(t.id)) score += 0.8;

  // 5. Renforcement : titres déjà appréciés (mais avec rendements décroissants)
  const plays = profile.playCount.get(t.id) || 0;
  score += Math.min(plays, 5) * 0.4;

  // 6. Like direct = signal fort
  if (likedTracks.has(t.id)) score += 2.5;

  return score;
}

// Seed déterministe par jour — les recommandations changent chaque jour
// mais restent stables si on recharge la page le même jour.
function _dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function _seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function _generateRecommendations(count = 20) {
  if (!tracks.length) return [];

  const profile = _buildTasteProfile();
  const hasSignal = profile.artistScore.size > 0 || profile.genreScore.size > 0;

  // Pas assez de données (nouvel utilisateur) → fallback aléatoire pondéré popularité bibliothèque
  if (!hasSignal) return _fisherYates(tracks).slice(0, count);

  const scored = tracks.map(t => ({ track: t, score: _scoreTrack(t, profile) }));
  scored.sort((a, b) => b.score - a.score);

  // ── Plafond par artiste ──────────────────────────────────────────
  // Sans ça, l'affinité artiste (signal le plus fort dans _scoreTrack)
  // fait que TOUS les titres d'un artiste récemment beaucoup écouté
  // arrivent en tête du classement — la liste finale n'était donc
  // composée que de ce seul artiste, sans aucune variété. On limite
  // maintenant explicitement le nombre de titres d'un même artiste
  // dans le résultat, quel que soit son score.
  const MAX_PER_ARTIST = Math.max(1, Math.round(count * 0.2)); // ex: 4 sur 20

  const rand        = _seededRandom(_dailySeed());
  const exploitCount = Math.ceil(count * 0.85);
  const exploreCount = count - exploitCount;

  function pickDiverse(sortedPool, targetCount, maxPerArtist) {
    const perArtistCount = new Map();
    const picked = [];
    const skipped = [];
    for (const entry of sortedPool) {
      if (picked.length >= targetCount) break;
      const artist = entry.track.artist || '';
      const n = perArtistCount.get(artist) || 0;
      if (n >= maxPerArtist) { skipped.push(entry); continue; }
      perArtistCount.set(artist, n + 1);
      picked.push(entry);
    }
    // S'il manque des titres (catalogue avec peu d'artistes variés),
    // on complète avec les meilleurs titres mis de côté, cap dépassé
    // ou pas, plutôt que de rendre une liste incomplète.
    if (picked.length < targetCount) {
      picked.push(...skipped.slice(0, targetCount - picked.length));
    }
    return picked;
  }

  // Prendre un pool plus large que nécessaire (5x) pour laisser assez
  // de marge à la diversification par artiste avant de mélanger.
  const topPool = scored.slice(0, Math.min(exploitCount * 5, scored.length));
  const diversePicks = pickDiverse(topPool, exploitCount, MAX_PER_ARTIST);

  // Léger mélange (seed du jour) pour varier l'ordre d'affichage sans
  // changer la sélection elle-même.
  const shuffledTop = [...diversePicks];
  for (let i = shuffledTop.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledTop[i], shuffledTop[j]] = [shuffledTop[j], shuffledTop[i]];
  }
  const picks = shuffledTop.map(s => s.track);

  // Exploration : titres au hasard PARMI ceux non déjà sélectionnés,
  // avec le même plafond par artiste pour ne pas réintroduire le
  // problème par la bande.
  const pickedIds = new Set(picks.map(t => t.id));
  const perArtistFinal = new Map();
  picks.forEach(t => perArtistFinal.set(t.artist, (perArtistFinal.get(t.artist) || 0) + 1));

  const explorationPool = tracks.filter(t => !pickedIds.has(t.id));
  for (let i = explorationPool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [explorationPool[i], explorationPool[j]] = [explorationPool[j], explorationPool[i]];
  }
  for (const t of explorationPool) {
    if (picks.length >= count) break;
    const n = perArtistFinal.get(t.artist) || 0;
    if (n >= MAX_PER_ARTIST) continue;
    perArtistFinal.set(t.artist, n + 1);
    picks.push(t);
  }
  // Si le plafond a empêché d'atteindre `count` (petite bibliothèque),
  // complète sans contrainte plutôt que de rendre une liste trop courte.
  if (picks.length < count) {
    for (const t of explorationPool) {
      if (picks.length >= count) break;
      if (!pickedIds.has(t.id) && !picks.includes(t)) picks.push(t);
    }
  }

  return picks.slice(0, count);
}

function renderRecommendedSection() {
  const section = document.getElementById('suggestSection');
  const grid    = document.getElementById('suggestGrid');
  if (!section || !grid || tracks.length === 0) return;

  const recommended = _generateRecommendations(20);
  grid.innerHTML = recommended.map((t,i) => makeHomeCard(t,i)).join('');
  section.style.display = 'block';
  attachHomeCardListeners(grid);

  // Mettre à jour le sous-titre pour indiquer la base des recommandations
  const subtitleEl = section.querySelector('.home-section-subtitle');
  if (subtitleEl) {
    const profile = _buildTasteProfile();
    subtitleEl.textContent = profile.artistScore.size > 0
      ? 'Basé sur vos écoutes et vos favoris'
      : 'Découvrez votre bibliothèque';
  }

  document.getElementById('refreshSuggest')?.addEventListener('click', () => {
    grid.innerHTML = '';
    section.style.display = 'none';
    // Le clic manuel force un nouveau tirage (pas le seed du jour)
    const freshPicks = _fisherYates(_generateRecommendations(40)).slice(0, 20);
    setTimeout(() => {
      grid.innerHTML = freshPicks.map((t,i) => makeHomeCard(t,i)).join('');
      section.style.display = 'block';
      attachHomeCardListeners(grid);
    }, 50);
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
        ${a.imageUrl ? `<img src="${a.imageUrl}" alt="" loading="lazy" decoding="async">` : `<span class="artist-avatar-letter">${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
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

  // Wire carousel arrows - grid IS the scrollable row
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

  // ── Normalisation des genres ────────────────────────────────────
  // Regroupe les variantes du même genre (ex: "Alternative Rock", "alt-rock", "Alt Rock" → "Rock")
  const _normalizeGenre = g => {
    if (!g) return null;
    const s = g.trim().toLowerCase()
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ');
    // Grandes familles
    if (/\brock\b|metal|punk|grunge|indie rock|hard rock|alt(ernative)?\s*rock/.test(s)) return 'Rock';
    if (/\bpop\b|synth.?pop|dream.?pop|bubblegum|j.pop|k.pop/.test(s)) return 'Pop';
    if (/hip.?hop|rap|trap|drill|grime/.test(s)) return 'Hip-Hop / Rap';
    if (/r&b|rnb|soul|funk|neo soul|motown/.test(s)) return 'R&B / Soul';
    if (/electro|electronic|edm|house|techno|trance|dubstep|drum.?n.?bass|dnb|ambient|synth/.test(s)) return 'Électronique';
    if (/jazz|swing|blues|bossa|bebop/.test(s)) return 'Jazz & Blues';
    if (/classical|orchestra|symphony|baroque|opera|chamber/.test(s)) return 'Classique';
    if (/country|bluegrass|folk|americana|roots/.test(s)) return 'Folk / Country';
    if (/reggae|ska|dub/.test(s)) return 'Reggae';
    if (/latin|salsa|cumbia|bachata|reggaeton|bossa/.test(s)) return 'Latino';
    if (/metal|heavy|death|black metal|doom/.test(s)) return 'Metal';
    if (/punk|post.?punk|new wave/.test(s)) return 'Punk';
    if (/indie|alternative/.test(s)) return 'Indie / Alternatif';
    // Retour du genre original capitalisé si pas de correspondance
    return g.trim().replace(/\b\w/g, c => c.toUpperCase());
  };

  // 1 — Récemment ajoutés
  const recentlyAdded = [...tracks]
    .filter(t => t.dateCreated)
    .sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated))
    .slice(0, 20);
  if (recentlyAdded.length >= 2) _appendCarousel(container, 'Récemment ajoutés', recentlyAdded);

  // 2 — Coups de cœur supprimé (inutile)

  // 3 — Genres désactivés temporairement (normalisation en cours)
  // Les carrousels genre seront réactivés une fois les métadonnées Jellyfin vérifiées
  const byGenre = new Map(); // vide volontairement
  const genreLists = [];     // vide volontairement

  // 5 — Par décennie
  const byDecade = new Map();
  tracks.forEach(t => {
    if (!t.year) return;
    const decade = Math.floor(t.year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade).push(t);
  });
  [...byDecade.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .forEach(([decade, list]) => {
      if (list.length < 3) return;
      _appendCarousel(container, `Années ${decade}`, list.slice(0, 20));
    });

  // 6 — Artistes favoris
  if (window.favoriteArtists?.size > 0) {
    const favTracks = _fisherYates(
      tracks.filter(t => [...window.favoriteArtists].some(a => a.toLowerCase() === t.artist?.toLowerCase()))
    ).slice(0, 20);
    if (favTracks.length >= 2) _appendCarousel(container, 'Vos artistes favoris ⭐', favTracks);
  }

  // 7 — À découvrir (genres rares)
  const rareGenres = genreLists.slice(10).filter(([, l]) => l.length >= 2);
  if (rareGenres.length >= 2) {
    const discovery = _fisherYates(rareGenres.flatMap(([, l]) => l)).slice(0, 20);
    if (discovery.length >= 3) _appendCarousel(container, 'À découvrir dans votre bibliothèque', discovery);
  }

  // 8 — Populaires
  const popular = _fisherYates(tracks).slice(0, 20);
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
  // depuis l'ouverture de l'onglet - d'où la limite perçue à 3 titres.
  const base = (window.recentlyPlayed && window.recentlyPlayed.length > 0)
    ? window.recentlyPlayed
    : recentlyPlayed;
  recentlyPlayed = base.filter(t => t.id !== track.id);
  // Normaliser les URLs avant stockage - Firebase peut contenir des URLs absolues
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
  attachHomeCardListeners(grid, rp);

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
//  PLAY TRACK - Lance la lecture depuis un contexte de playlist
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
    _setPlayContext(ctxIndices.length > 1 ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
  } else {
    _setPlayContext(null);
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
    recommended = _fisherYates(tracks).slice(0, 20);
  } else {
    recommended = _fisherYates(recommended).slice(0, 20);
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
  const artistLinks = (track.artists && track.artists.length > 1)
    ? track.artists.map(a => `<span class="home-card-artist-link" data-artist="${escapeHtml(a)}">${escapeHtml(a)}</span>`).join(', ')
    : `<span class="home-card-artist-link" data-artist="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</span>`;
  return `
    <div class="home-card" data-id="${track.id}" data-album="${escapeHtml(track.album || '')}" style="animation-delay:${Math.min(index * 0.04, 0.4)}s">
      <div class="home-card-art">
        ${track.imageUrl ? `<img src="${track.imageUrl}" alt="" loading="lazy" decoding="async">` : `<div class="home-card-art-placeholder">🎵</div>`}
        <button class="card-play-btn" data-id="${track.id}" data-tooltip="Lire" aria-label="Lire">
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="card-play-icon card-play-icon-play"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path></svg>
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="card-play-icon card-play-icon-pause" style="display:none"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path></svg>
        </button>
      </div>
      <div class="home-card-title">${escapeHtml(track.title)}</div>
      <div class="home-card-sub">${artistLinks}</div>
    </div>`;
}
function attachHomeCardListeners(container, fallbackList = null) {
  // Cherche l'index global d'un id, et si absent (sync complète pas encore
  // terminée en arrière-plan), tente de récupérer la piste dans la liste
  // qui a servi à rendre ces cartes (fallbackList) et l'ajoute à `tracks`
  // à la volée pour que la lecture fonctionne quand même.
  function _resolveIdx(id) {
    let idx = tracks.findIndex(t => String(t.id) === id);
    if (idx === -1 && fallbackList) {
      const fb = fallbackList.find(t => String(t.id) === id);
      if (fb) idx = _ensureTrackInLibrary(fb);
    }
    return idx;
  }
  container?.querySelectorAll('.home-card').forEach(el => {
    // Clic sur la card (hors bouton play) → navigate to album
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-btn')) return;
      const artistLink = e.target.closest('.home-card-artist-link');
      if (artistLink) {
        e.stopPropagation();
        showDetailView('artist', artistLink.dataset.artist);
        return;
      }
      const album = el.dataset.album;
      if (album) {
        showDetailView('album', album);
      } else {
        // Fallback si pas d'album : lire le titre hors contexte playlist
        const idx = _resolveIdx(el.dataset.id);
        if (idx !== -1) { _setPlayContext(null); currentIndex = idx; playCurrentTrack(); }
      }
    });

    // Clic sur le bouton play/pause → toggle lecture
    const playBtn = el.querySelector('.card-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = _resolveIdx(el.dataset.id);
        if (idx === -1) return;
        if (currentIndex === idx && !audioPlayer.paused) {
          // Même piste déjà en cours → pause
          audioPlayer.pause();
        } else {
          // Lancer cette piste EN DEHORS de tout contexte playlist
          // (même si elle est présente dans _playContext, on joue libre depuis l'accueil)
          _setPlayContext(null);
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
//  DETAIL VIEW - album / artist / playlist
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

  // Current cover image — priorité à la cover personnalisée de la playlist
  let newCoverFile = null;
  let currentCoverSrc = pl.coverUrl
    || plTracks?.find(t => t.imageUrl)?.imageUrl
    || '';

  const modal = document.createElement('div');
  modal.id = 'playlistEditModal';
  modal.className = 'pl-edit-overlay';
  modal.innerHTML = `
    <div class="pl-edit-modal">
      <div class="pl-edit-header">
        <h2 class="pl-edit-title">Modifier les informations</h2>
        <button class="pl-edit-close" id="plEditClose" data-tooltip="Fermer">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="pl-edit-body">
        <label class="pl-edit-cover-wrap" id="plEditCoverWrap" title="Modifier la photo" style="cursor:pointer;display:block">
          <div id="plEditCoverPreview" class="pl-edit-cover-preview">
            ${_makePlaylistCoverHtml(plTracks, 'lg', pl.coverUrl || null)}
          </div>
          <div class="pl-edit-cover-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pl-edit-cover-edit-icon"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            <span>Modifier la photo</span>
          </div>
        </label>
        <input type="file" id="plEditFileInput" accept="image/*" style="display:none">
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

  // Cover file picker — le clic sur le label déclenche l'input
  const coverWrap = modal.querySelector('#plEditCoverWrap');
  const fileInput = modal.querySelector('#plEditFileInput');

  coverWrap.addEventListener('click', () => fileInput.click());

  // Helper : compresser l'image via canvas (max 500×500, qualité 0.82)
  function _compressImage(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const MAX = 500;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            const ratio = Math.min(MAX / w, MAX / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => resolve(ev.target.result); // fallback raw
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    newCoverFile = file;
    const dataUrl = await _compressImage(file);
    // Remplacer tout le contenu du preview par la nouvelle image
    const preview = modal.querySelector('#plEditCoverPreview');
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" alt="" class="pl-cover-default pl-cover-custom" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit">`;
    }
    // Précharger le dataUrl pour le save
    newCoverFile = { _dataUrl: dataUrl };
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
    if (newCoverFile) {
      // Utiliser le dataUrl précompressé (déjà calculé dans le handler change)
      const coverDataUrl = newCoverFile._dataUrl
        || await new Promise(res => {
          const r = new FileReader();
          r.onload = ev => res(ev.target.result);
          r.readAsDataURL(newCoverFile);
        });
      updates.coverUrl = coverDataUrl;
    }
    const ok = await window.FirebasePlaylists?.updatePlaylist?.(playlistId, updates);
    if (ok !== false) {
      pl.name        = newName;
      pl.description = newDesc;
      pl.private     = isPrivate;
      if (updates.coverUrl) pl.coverUrl = updates.coverUrl;

      // Mettre à jour les éléments visibles dans la vue courante
      const titleEl = document.getElementById('customPlaylistTitle');
      if (titleEl) titleEl.textContent = newName;
      const descEl = document.getElementById('customPlaylistDesc');
      if (descEl) descEl.textContent = newDesc || 'Playlist personnelle';
      if (updates.coverUrl) {
        // Mettre à jour la cover dans le header de la vue détail (remplace le HTML complet)
        const coverWrapEl = document.getElementById('playlistCoverWrap');
        if (coverWrapEl) {
          const overlayHtml = coverWrapEl.querySelector('.playlist-cover-overlay')?.outerHTML || '';
          coverWrapEl.innerHTML = _makePlaylistCoverHtml([], 'lg', updates.coverUrl) + overlayHtml;
        }
        // Mettre à jour dans le sidebar
        const sidebarRow = trackListDiv?.querySelector(`.lib-custom-playlist-row[data-playlist-id="${CSS.escape(playlistId)}"]`);
        if (sidebarRow) {
          const oldCover = sidebarRow.querySelector('.pl-cover-wrap');
          if (oldCover) oldCover.outerHTML = _makePlaylistCoverHtml([], 'sm', updates.coverUrl);
        }
      }
      showToast('Playlist mise à jour.', 'success');
      renderSidebarPlaylists?.();
    } else {
      showToast('Erreur lors de la sauvegarde.', 'error');
    }
    closeModal();
  });
}

// ══════════════════════════════════════════════════════════════════
//  SHOW PLAYLIST VIEW - Titres likés & Mes favoris
//  Utilise showDetailView avec filtrage selon le type de playlist
// ══════════════════════════════════════════════════════════════════
// ── Vue playlist ami (namespace isolé, ne pollue pas customPlaylists) ──
function _showFriendPlaylistView(tempId, pushHistory = true) {
  const pl = window._friendPlaylistCache?.[tempId];
  if (!pl) { showToast('Playlist introuvable.', 'error'); return; }

  if (pushHistory) pushNavState('friend_playlist', { tempId });

  const plTracks = (pl.tracks || [])
    .map(pt => {
      const full = tracks.find(t => t.id === pt.id);
      if (full) return { ...full, addedAt: pt.addedAt || full.addedAt };
      if (pt.id && pt.duration > 0) return pt;
      return null;
    })
    .filter(Boolean);

  _hideAllMainPanels();
  detailView.style.display = 'flex';
  detailType = 'custom_playlist';
  detailSortKey = null;
  detailSortDir = 1;
  detailContextTracks = [...plTracks];

  const totalSec = plTracks.reduce((s, t) => s + (t.duration || 0), 0);
  const totalMin = Math.floor(totalSec / 60);
  const totalH   = Math.floor(totalMin / 60);
  const durationStr = totalH > 0 ? `${totalH} h ${totalMin % 60} min` : `${totalMin} min`;

  _cleanDetailView();
  detailView.innerHTML = `
    <div class="detail-header">
      <div class="detail-cover" id="detailCoverWrap">${pl.coverUrl
        ? `<img src="${escapeHtml(pl.coverUrl)}" alt="" class="detail-cover-img">`
        : _makePlaylistCoverHtml(plTracks, 'lg', null)}</div>
      <div class="detail-meta">
        <div class="detail-type">Playlist</div>
        <h1 class="detail-title">${escapeHtml(pl.name)}</h1>
        <div class="detail-subtitle">${escapeHtml(pl.createdBy || pl._ownerName || '')}</div>
        <div class="detail-stats">${plTracks.length} titre${plTracks.length !== 1 ? 's' : ''} · ${durationStr}</div>
      </div>
    </div>
    <div class="detail-controls-bar playlist-controls-bar">
      <div class="detail-controls-left">
        <button class="playlist-play-circle" id="detailPlayBtn" data-tooltip="Lecture">
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="detailPlayIcon"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path></svg>
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="detailPauseIcon" style="display:none"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path></svg>
        </button>
        <button class="playlist-ctrl-btn" id="detailShuffleBtn" data-tooltip="Lecture aléatoire">
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="btn-icon"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path><path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path></svg>
        </button>
        <button class="playlist-ctrl-btn detail-download-btn" id="detailDownloadBtn" data-tooltip="Télécharger (VIP)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
    </div>
    <div class="detail-tracks-header" id="detailTracksHeader">
      <span class="dth-num">#</span>
      <span class="dth-title">Titre</span>
      <span class="dth-album">Album</span>
      <span class="dth-dateadded">Date d'ajout</span>
      <span class="dth-dur"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
    </div>
    <div class="detail-tracks-list" id="detailTrackList"></div>
  `;

  _renderDetailTracks(plTracks, 'custom_playlist');

  // Lecture
  document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
    if (!plTracks.length) return;
    const ctxIdx = plTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
    if (!ctxIdx.length) return;
    _setPlayContext(ctxIdx, pl.name);
    currentIndex = ctxIdx[0];
    playCurrentTrack();
  });

  // Shuffle
  document.getElementById('detailShuffleBtn')?.addEventListener('click', () => {
    if (!plTracks.length) return;
    const ctxIdx = plTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
    if (!ctxIdx.length) return;
    isShuffled = true;
    shuffleBtn?.classList.add('active');
    shuffleOrder = _fisherYates([...ctxIdx]);    _setPlayContext(ctxIdx, pl.name);
    currentIndex = shuffleOrder[0];
    playCurrentTrack();
  });

  // Télécharger (VIP)
  document.getElementById('detailDownloadBtn')?.addEventListener('click', () => {
    _downloadPlaylist(plTracks, pl.name);
  });
}

window.showPlaylistView = function(type, pushHistory = true) {
  if (type === 'liked') {
    // Construire la liste des titres likés à partir des IDs
    const likedList = tracks.filter(t => likedTracks.has(t.id));

    // ── Complétion à la demande ────────────────────────────────────
    // Si certains IDs likés ne sont pas encore dans `tracks` (synchro
    // complète pas terminée), on les récupère directement par ID — pas
    // besoin d'attendre la fin du chargement de toute la bibliothèque
    // pour voir sa liste de titres likés complète.
    if (!window._librarySyncComplete && likedList.length < likedTracks.size) {
      const missingIds = [...likedTracks].filter(id => !tracks.some(t => t.id === id));
      _fetchTracksByIds(missingIds).then(serverTracks => {
        if (!serverTracks?.length) return;
        if (detailType !== 'liked' || detailView.style.display !== 'flex') return;
        serverTracks.forEach(t => _ensureTrackInLibrary(t));
        window.showPlaylistView('liked', false);
      });
    }

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

    _cleanDetailView();
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
          <button class="detail-shuffle-btn" id="detailShuffleBtn" data-tooltip="Lecture aléatoire">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="btn-icon"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path><path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path></svg>
          </button>
          <button class="detail-shuffle-btn detail-download-btn" id="detailDownloadBtn" data-tooltip="Télécharger (VIP)">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <div class="detail-search-wrap" id="detailSearchWrap">
            <button class="detail-search-toggle" id="detailSearchToggle" data-tooltip="Rechercher">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            </button>
            <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
          </div>
          <button class="detail-list-sort-btn" id="detailListSortBtn" data-tooltip="Trier">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>
          </button>
        </div>
      </div>
      <div class="detail-tracks-header" id="detailTracksHeader">
        <span class="dth-num">#</span>
        <span class="dth-title dth-sortable" data-sort="title">Titre<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-album dth-sortable" data-sort="album">Album<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dateadded dth-sortable" data-sort="year">Date d'ajout<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dur dth-sortable" data-sort="duration" style="cursor:pointer;user-select:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="dth-sort-arrow">↕</span>
        </span>
      </div>
      <div class="detail-tracks-list" id="detailTrackList"></div>
    `;

    _renderDetailTracks(likedList, 'liked');

    // Boutons play/shuffle - Titres likés
    document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
      if (!likedList.length) return;
      const ctxIndices = likedList.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
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
      const ctxIndices = likedList.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
      isShuffled = true;
      shuffleBtn.classList.add('active');
      if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(_trackToIdx).filter(i => i !== -1);
        _completeShuffleOrder(window._playContext);
      } else {
        shuffleOrder = _fisherYates(ctxIndices);
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

    // Télécharger (VIP)
    document.getElementById('detailDownloadBtn')?.addEventListener('click', () => {
      _downloadPlaylist(likedList, 'Titres likés');
    });

    if (pushHistory) history.pushState({ view: 'playlist', type: 'liked' }, '');
    return;
  }

  if (type === 'favorites') {
    // Afficher albums et artistes favoris - on utilise showDetailView pour chaque,
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
          ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div style="width:44px;height:44px;background:linear-gradient(135deg,#f57b27,#8a3f00);display:flex;align-items:center;justify-content:center;font-size:1.3rem">💿</div>`}
        </div>
        <div class="track-meta">
          <div class="track-title">${escapeHtml(a.name)}</div>
          <div class="track-artist">${escapeHtml(a.artist)} · ${a.count} titre${a.count > 1 ? 's' : ''}</div>
        </div>
      </div>`).join('');

    const artistCards = favArtistsList.map(a => `
      <div class="lib-artist-item" data-artist="${escapeHtml(a.name)}" style="cursor:pointer;">
        <div class="lib-artist-avatar" style="background:${a.imageUrl ? 'var(--bg-tinted)' : artistGradient(a.name)}">
          ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" decoding="async" alt="">` : `<span>${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
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
    _cleanDetailView();
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
          <button class="detail-shuffle-btn" id="favShuffleBtn" data-tooltip="Lecture aléatoire">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="btn-icon"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path><path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path></svg>
          </button>
        </div>
      </div>` : ''}
      ${total === 0 ? `
      <div style="padding: 0 24px 24px;">
        <div style="text-align:center;padding:60px 0;color:rgba(255,255,255,0.4);">
          <div style="font-size:2.5rem;margin-bottom:12px;">⭐</div>
          <div>Aucun favori pour le moment</div>
        </div>
      </div>` : `
      <div class="panel-tabs fav-tabs" id="favTabs" style="margin:0 24px 14px">
        <button class="panel-tab ${favAlbumsList.length ? 'active' : ''}" data-tab="fav-albums" ${favAlbumsList.length ? '' : 'disabled'}>Albums${favAlbumsList.length ? ` (${favAlbumsList.length})` : ''}</button>
        <button class="panel-tab ${!favAlbumsList.length && favArtistsList.length ? 'active' : ''}" data-tab="fav-artists" ${favArtistsList.length ? '' : 'disabled'}>Artistes${favArtistsList.length ? ` (${favArtistsList.length})` : ''}</button>
      </div>
      <div style="padding: 0 24px 24px;">
        <div class="track-list fav-tab-content" id="favAlbumsContainer" style="display:${favAlbumsList.length ? 'block' : 'none'}">
          ${favAlbumsList.length ? albumCards : `<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.4)">Aucun album favori.</div>`}
        </div>
        <div class="track-list fav-tab-content" id="favArtistsContainer" style="display:${!favAlbumsList.length && favArtistsList.length ? 'block' : 'none'}">
          ${favArtistsList.length ? artistCards : `<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.4)">Aucun artiste favori.</div>`}
        </div>
      </div>`}
    `;

    // ── Bascule des onglets Albums / Artistes ────────────────────────
    detailView.querySelectorAll('#favTabs .panel-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        detailView.querySelectorAll('#favTabs .panel-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.tab;
        const albumsEl  = document.getElementById('favAlbumsContainer');
        const artistsEl = document.getElementById('favArtistsContainer');
        if (albumsEl)  albumsEl.style.display  = target === 'fav-albums'  ? 'block' : 'none';
        if (artistsEl) artistsEl.style.display = target === 'fav-artists' ? 'block' : 'none';
      });
    });

    detailView.querySelectorAll('.lib-album-item[data-album]').forEach(el =>
      el.addEventListener('click', () => showDetailView('album', el.dataset.album)));
    detailView.querySelectorAll('.lib-artist-item[data-artist]').forEach(el =>
      el.addEventListener('click', () => showDetailView('artist', el.dataset.artist)));

    // ── Boutons Lecture / Aléatoire - Mes favoris ───────────────────
    document.getElementById('favPlayBtn')?.addEventListener('click', () => {
      if (!favAlbumTracks.length) return;
      const ctxIndices = favAlbumTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
      isShuffled = false;
      shuffleBtn.classList.remove('active');
      shuffleOrder = ctxIndices;
      if (ctxIndices.length) { currentIndex = ctxIndices[0]; playCurrentTrack(); }
    });
    document.getElementById('favShuffleBtn')?.addEventListener('click', () => {
      if (!favAlbumTracks.length) return;
      const ctxIndices = favAlbumTracks.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
      isShuffled = true;
      shuffleBtn.classList.add('active');
      if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(_trackToIdx).filter(i => i !== -1);
        _completeShuffleOrder(window._playContext);
      } else {
        shuffleOrder = _fisherYates(ctxIndices);
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

    const plTracks = (pl.tracks || [])
      .map(pt => {
        // Chercher le titre complet dans la bibliothèque Jellyfin par ID
        const full = tracks.find(t => t.id === pt.id);
        if (full) {
          // Enrichir avec addedAt venant de Firebase si présent
          return { ...full, addedAt: pt.addedAt || full.addedAt };
        }
        // Fallback Firebase — ne garder que si le titre a un id ET une durée > 0
        if (pt.id && pt.duration > 0) return pt;
        return null; // filtrer les fantômes
      })
      .filter(Boolean);

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

    _cleanDetailView();
    detailView.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover playlist-cover-editable" id="playlistCoverWrap">
          ${_makePlaylistCoverHtml(plTracks, 'lg', pl.coverUrl || null)}
          <div class="playlist-cover-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="playlist-cover-edit-icon"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            <span class="playlist-cover-edit-label">Modifier les informations</span>
          </div>
        </div>
        <div class="detail-meta">
          <div class="detail-type">Playlist</div>
          <h1 class="detail-title" id="customPlaylistTitle">${escapeHtml(pl.name)}</h1>
          <div class="detail-subtitle" id="customPlaylistDesc">${escapeHtml(pl.createdBy || window._authUser?.displayName || window._authUser?.username || 'Vous')}</div>
          <div class="detail-stats">${plTracks.length} titre${plTracks.length !== 1 ? 's' : ''} · ${durationStr}</div>
        </div>
      </div>
      <div class="detail-controls-bar playlist-controls-bar">
        <div class="detail-controls-left">
          <button class="playlist-play-circle" id="detailPlayBtn" data-tooltip="Lecture">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="playlistPlayIcon"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path></svg>
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="playlistPauseIcon" style="display:none"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path></svg>
          </button>
          <button class="playlist-ctrl-btn" id="detailShuffleBtn" data-tooltip="Lecture aléatoire">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="btn-icon"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path><path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path></svg>
          </button>
          <button class="playlist-ctrl-btn" id="detailDownloadBtn" data-tooltip="Télécharger">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
          </button>
          <button class="playlist-ctrl-btn" id="detailAddProfileBtn" data-tooltip="Ajouter au profil">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          </button>
          <button class="playlist-ctrl-btn playlist-etc-btn" id="detailPlaylistEtcBtn" data-tooltip="Plus d'options">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="btn-icon"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
        <div class="detail-controls-right">
          <div class="detail-search-wrap" id="detailSearchWrap">
            <button class="detail-search-toggle" id="detailSearchToggle" data-tooltip="Rechercher">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            </button>
            <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
          </div>
          <button class="detail-list-sort-btn" id="detailListSortBtn" data-tooltip="Trier">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>
          </button>
        </div>
      </div>
      <div class="detail-tracks-header" id="detailTracksHeader">
        <span class="dth-num">#</span>
        <span class="dth-title dth-sortable" data-sort="title">Titre<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-album dth-sortable" data-sort="album">Album<span class="dth-sort-arrow">↕</span></span>
        <span class="dth-dateadded dth-sortable" data-sort="year">Date d'ajout<span class="dth-sort-arrow">↕</span></span>
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
      const ctxIdx = plTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      // ── FIX : comparer par _playContextIds (IDs stables) et non _playContext (indices stales)
      const plIds = plTracks.map(t => t.id).filter(Boolean);
      const ctxIds = window._playContextIds || [];
      const thisPlaylistIsActive = plIds.length > 0 &&
        plIds.length === ctxIds.length &&
        plIds.every(id => ctxIds.includes(id));
      if (thisPlaylistIsActive && !audioPlayer.paused) {
        // Cette playlist joue → pause
        audioPlayer.pause();
      } else if (thisPlaylistIsActive && audioPlayer.paused) {
        // Cette playlist est en pause → reprendre
        audioPlayer.play().catch(console.error);
      } else {
        // Start from beginning
        _setPlayContext(ctxIdx.length ? ctxIdx.map(i => tracks[i]?.id).filter(Boolean) : null);
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
      const ctxIdx = plTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      const isThisCtxActive = ctxIdx.includes(currentIndex) &&
        (window._playContext ? ctxIdx.some(i => window._playContext.includes(i)) : true);

      isShuffled = !isShuffled;
      shuffleBtn.classList.toggle('active', isShuffled);
      document.getElementById('detailShuffleBtn')?.classList.toggle('shuffle-active', isShuffled);

      if (isShuffled) {
        // Rebuild shuffle queue
        _setPlayContext(ctxIdx.length ? ctxIdx.map(i => tracks[i]?.id).filter(Boolean) : null);
        if (window._buildShuffleQueue) {
          const _ct   = ctxIdx.map(i => tracks[i]).filter(Boolean);
          // Le 2e argument de _buildShuffleQueue est l'indice de la piste courante
          // dans _ct (tableau de tracks), pas dans ctxIdx (tableau d'indices globaux).
          // On cherche par ID pour éviter un -1 si currentIndex est hors contexte.
          const _ctCurIdx = _ct.findIndex(t => t.id === tracks[currentIndex]?.id);
          const _sh   = window._buildShuffleQueue(_ct, _ctCurIdx >= 0 ? _ctCurIdx : 0);
          shuffleOrder = _sh.map(_trackToIdx).filter(i => i !== -1);
          _completeShuffleOrder(window._playContext);
        } else {
          shuffleOrder = _fisherYates(ctxIdx);
        }
        // Place current track first in queue if already playing from this context
        if (isThisCtxActive) {
          // S'assurer que currentIndex est dans shuffleOrder (peut manquer si _buildShuffleQueue filtre)
          if (!shuffleOrder.includes(currentIndex) && ctxIdx.includes(currentIndex)) {
            shuffleOrder.unshift(currentIndex);
          }
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
        // Shuffle off - restore linear order for this context
        _setPlayContext(ctxIdx.length ? ctxIdx.map(i => tracks[i]?.id).filter(Boolean) : null);
        shuffleOrder = [...ctxIdx];
      }
      showToast(isShuffled ? '⇄ Lecture aléatoire activée' : '⇄ Lecture aléatoire désactivée', isShuffled ? 'info' : 'default');
    });
    // ── Sync play/pause icon on the big circle button ─────────────────
    function _syncPlaylistPlayIcon() {
      // FIX: compare via stable IDs (_playContextIds) instead of stale index array (_playContext)
      const plIds      = plTracks.map(t => t.id).filter(Boolean);
      const activeIds  = window._playContextIds || [];
      const ctxMatches = plIds.length > 0 &&
        plIds.length === activeIds.length &&
        plIds.every(id => activeIds.includes(id));
      const isCtxPlaying = !audioPlayer.paused && ctxMatches;
      const playIcon  = document.getElementById('playlistPlayIcon');
      const pauseIcon = document.getElementById('playlistPauseIcon');
      if (playIcon)  playIcon.style.display  = isCtxPlaying ? 'none' : '';
      if (pauseIcon) pauseIcon.style.display = isCtxPlaying ? '' : 'none';
    }
    // ── FIX : retirer l'ancien listener avant d'en ajouter un nouveau (ré-écoute playlist)
    // Also remove _syncDetailPlayIcon if navigating from an album/artist detail view
    if (audioPlayer._syncPlaylistPlayIcon) {
      audioPlayer.removeEventListener('play',  audioPlayer._syncPlaylistPlayIcon);
      audioPlayer.removeEventListener('pause', audioPlayer._syncPlaylistPlayIcon);
    }
    if (audioPlayer._syncDetailPlayIcon) {
      audioPlayer.removeEventListener('play',  audioPlayer._syncDetailPlayIcon);
      audioPlayer.removeEventListener('pause', audioPlayer._syncDetailPlayIcon);
      audioPlayer._syncDetailPlayIcon = null;
    }
    audioPlayer._syncPlaylistPlayIcon = _syncPlaylistPlayIcon;
    audioPlayer.addEventListener('play',  _syncPlaylistPlayIcon);
    audioPlayer.addEventListener('pause', _syncPlaylistPlayIcon);
    _syncPlaylistPlayIcon();

    // ── Cover overlay → open edit modal ───────────────────────────────
    document.getElementById('playlistCoverWrap')?.addEventListener('click', () => {
      _openPlaylistEditModal(playlistId, pl, plTracks);
    });

    // Télécharger (VIP)
    document.getElementById('detailDownloadBtn')?.addEventListener('click', () => {
      _downloadPlaylist(plTracks, pl.name);
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
        <div class="pctx-item" id="pctxAddOtherPlaylist"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M15.25 8a.75.75 0 0 1-.75.75H8.75v5.75a.75.75 0 0 1-1.5 0V8.75H1.5a.75.75 0 0 1 0-1.5h5.75V1.5a.75.75 0 0 1 1.5 0v5.75h5.75a.75.75 0 0 1 .75.75z"/></svg> Ajouter à une autre playlist</div>
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
      menu.querySelector('#pctxAddOtherPlaylist')?.addEventListener('click', (ev) => {
        menu.remove();
        // Ouvrir le popup ATP avec la première piste de la playlist comme représentante
        const firstTrack = plTracks[0];
        if (firstTrack) showAddToPlaylistPopup(ev, firstTrack);
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
  window._currentDetailName = name;
  // Jeton de requête : incrémenté à CHAQUE appel, y compris pour le même
  // type (album/artiste). Les complétions à la demande capturent ce jeton
  // et ne s'appliquent que s'il est toujours le plus récent au moment où
  // elles résolvent — sans ça, ouvrir l'album A puis très vite l'album B
  // pouvait faire réapparaître A par-dessus B si la vérification de A
  // répondait après coup (elle ne vérifiait que le TYPE, pas le nom).
  const _requestToken = (window._detailViewToken = (window._detailViewToken || 0) + 1);
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

    // ── Complétion à la demande ────────────────────────────────────
    // Si la synchro complète n'est pas terminée, ce qu'on a localement
    // peut être un sous-ensemble de l'album. On vérifie côté serveur en
    // arrière-plan (léger : un seul album, pas toute la bibliothèque) et
    // on re-rend seulement si on découvre des titres manquants ET que
    // c'est toujours la vue la plus récemment demandée (jeton).
    const _albumId = contextTracks.find(t => t.albumId)?.albumId;
    if (_albumId && !window._librarySyncComplete) {
      _fetchAlbumTracksById(_albumId).then(serverTracks => {
        if (window._detailViewToken !== _requestToken) return; // une autre vue a été ouverte entre-temps
        if (!serverTracks || serverTracks.length <= contextTracks.length) return;
        serverTracks.forEach(t => _ensureTrackInLibrary(t));
        showDetailView('album', name, false);
      });
    }
  } else if (type === 'artist') {
    contextTracks = tracks.filter(t => t.artists?.includes(name) || t.artist === name);
    coverUrl = contextTracks.find(t => t.imageUrl)?.imageUrl || null;
    subtitle = `Artiste · ${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''}`;
    // Bio will be loaded async after render

    // ── Complétion à la demande (discographie) ─────────────────────
    if (!window._librarySyncComplete) {
      _fetchArtistTracksByName(name).then(serverTracks => {
        if (window._detailViewToken !== _requestToken) return; // une autre vue a été ouverte entre-temps
        if (!serverTracks || serverTracks.length <= contextTracks.length) return;
        serverTracks.forEach(t => _ensureTrackInLibrary(t));
        showDetailView('artist', name, false);
      });
    }
  } else if (type === 'year') {
    contextTracks = tracks.filter(t => String(t.year) === String(name));
    contextTracks.sort((a, b) => a.title.localeCompare(b.title));
    coverUrl = contextTracks.find(t => t.imageUrl)?.imageUrl || null;
    subtitle = `Année · ${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''}`;

    // ── Complétion à la demande ────────────────────────────────────
    if (!window._librarySyncComplete) {
      _fetchYearTracks(name).then(serverTracks => {
        if (window._detailViewToken !== _requestToken) return; // une autre vue a été ouverte entre-temps
        if (!serverTracks || serverTracks.length <= contextTracks.length) return;
        serverTracks.forEach(t => _ensureTrackInLibrary(t));
        showDetailView('year', name, false);
      });
    }
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

  // ── Subtitle HTML avec liens cliquables ──────────────────────────
  let subtitleHtml = '';
  if (type === 'album') {
    const artistName = contextTracks[0]?.artist || '';
    const year       = contextTracks[0]?.year   || null;
    const artistLink = artistName
      ? `<span class="nav-link-inline detail-subtitle-link" data-nav="artist" data-name="${escapeHtml(artistName)}">${escapeHtml(artistName)}</span>`
      : '';
    const yearLink = year
      ? `<span class="nav-link-inline detail-subtitle-link" data-nav="year" data-name="${escapeHtml(String(year))}">${escapeHtml(String(year))}</span>`
      : '';
    // "Artiste · 2023" — chaque partie est un lien distinct
    const parts = [artistLink, yearLink].filter(Boolean);
    subtitleHtml = parts.join(' · ');
  } else if (type === 'year') {
    subtitleHtml = `<span class="nav-link-inline detail-subtitle-link" data-nav="year" data-name="${escapeHtml(String(name))}">${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''}</span>`;
  } else {
    subtitleHtml = `<span>${escapeHtml(subtitle)}</span>`;
  }

  _cleanDetailView();

  detailView.innerHTML = `
    <div class="detail-header"${type === 'artist' ? ' style="align-items:stretch"' : ''}>
      <div class="detail-cover ${type === 'artist' ? 'detail-cover-round' : ''}" id="detailCoverWrap">${coverHtml}</div>
      <div class="detail-meta"${type === 'artist' ? ' style="display:flex;flex-direction:column;justify-content:flex-start"' : ''}>
        <div class="detail-type">${type === 'artist' ? 'Artiste' : type === 'year' ? 'Année' : type === 'album' ? 'Album' : 'Playlist publique'}</div>
        <h1 class="detail-title">${escapeHtml(name)}</h1>
        ${type !== 'artist' ? `<div class="detail-subtitle">${subtitleHtml}</div>` : ''}
        <div class="detail-stats">${contextTracks.length} titre${contextTracks.length > 1 ? 's' : ''} · ${durationStr}</div>
        ${type === 'artist' ? `<div class="detail-artist-bio" id="detailArtistBio" style="margin-top:10px;font-size:0.82rem;color:var(--text-subdued);line-height:1.6;display:none;flex:1;overflow:hidden"></div>` : ''}
      </div>
    </div>

    <div class="detail-controls-bar playlist-controls-bar">
      <div class="detail-controls-left">
        <button class="playlist-play-circle" id="detailPlayBtn" data-tooltip="Lecture">
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="detailPlayIcon"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path></svg>
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="playlist-play-icon-img" id="detailPauseIcon" style="display:none"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path></svg>
        </button>
        <button class="playlist-ctrl-btn" id="detailShuffleBtn" data-tooltip="Lecture aléatoire">
          <svg data-encore-id="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="btn-icon"><path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path><path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path></svg>
        </button>
        <button class="playlist-ctrl-btn" id="detailDownloadBtn" data-tooltip="Télécharger (VIP)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="detail-icon-btn ${type === 'album' || type === 'artist' ? (favoriteAlbums.has(name) || favoriteArtists.has(name) ? 'active liked' : '') : ''}" id="detailLikeBtn" data-tooltip="Ajouter aux favoris">
          <span class="detail-bookmark-icon">${type === 'album' || type === 'artist' ? (favoriteAlbums.has(name) || favoriteArtists.has(name) ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd" /></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>`) : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>`}</span>
        </button>
        <button class="detail-icon-btn" id="detailMoreBtn" data-tooltip="Plus d'options">
          <span style="font-size:1.2rem;letter-spacing:1px;color:var(--text-subdued)">···</span>
        </button>
      </div>
      <div class="detail-controls-right">
        <div class="detail-search-wrap" id="detailSearchWrap">
          <button class="detail-search-toggle" id="detailSearchToggle" data-tooltip="Rechercher">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
          </button>
          <input id="detailSearchInput" type="text" class="detail-search-input" placeholder="Rechercher…">
        </div>
        <button class="detail-list-sort-btn" id="detailListSortBtn" data-tooltip="Trier">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>
        </button>
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
  if (type === 'artist') {
    detailSortKey = 'year';
    detailSortDir = -1;
    _renderArtistTracksByAlbum(detailContextTracks, name);
  } else {
    _renderDetailTracks(detailContextTracks, type, name);
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

  // ── Download (VIP) ────────────────────────────────────────────────
  document.getElementById('detailDownloadBtn')?.addEventListener('click', () => {
    _downloadPlaylist(detailContextTracks, name);
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
      if (searchInputEl) { searchInputEl.value = ''; _renderDetailTracks(detailContextTracks, type, name); }
    }
  });
  searchInputEl?.addEventListener('input', () => {
    const term = searchInputEl.value.trim().toLowerCase();
    if (!term) { _renderDetailTracks(detailContextTracks, type, name); return; }
    const filtered = detailContextTracks.filter(t =>
      t.title.toLowerCase().includes(term) ||
      (t.artists || [t.artist]).some(a => a.toLowerCase().includes(term)) ||
      t.album.toLowerCase().includes(term)
    );
    _renderDetailTracks(filtered, type, name);
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

    // Pour les albums : masquer "Tri personnalisé", "Artiste", "Ajouté récemment"
    const isAlbumType = type === 'album';
    const sortOpts = [
      { key: 'title',     label: 'Titre' },
      ...(!isAlbumType ? [{ key: 'artist',    label: 'Artiste' }] : []),
      ...(!isAlbumType ? [{ key: '',          label: 'Tri personnalisé' }] : []),
      ...(!isAlbumType ? [{ key: 'album', label: 'Album' }] : []),
      { key: 'year',      label: 'Date de parution' },
      ...(!isAlbumType ? [{ key: 'dateAdded', label: 'Ajouté récemment' }] : []),
      { key: 'duration',  label: 'Durée' },
    ];

    const panel = document.createElement('div');
    panel.id = 'detailSortPanel';
    panel.style.cssText = [
      `position:fixed`,
      `top:${rect.bottom + 6}px`,
      `right:${window.innerWidth - rect.right}px`,
      `z-index:99999`,
      `min-width:200px`,
      `background:#111`,
      `border:1px solid rgba(255,255,255,0.1)`,
      `border-radius:12px`,
      `padding:6px 0`,
      `box-shadow:0 20px 60px rgba(0,0,0,0.9),0 4px 16px rgba(0,0,0,0.6)`,
      `transform-origin:top right`,
      `animation:dspSlideDown 0.18s cubic-bezier(0.16,1,0.3,1) both`,
      `overflow:hidden`,
    ].join(';');

    // Section header
    const hSort = document.createElement('div');
    hSort.style.cssText = 'padding:8px 14px 4px;font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:rgba(255,255,255,0.35)';
    hSort.textContent = 'Trier par';
    panel.appendChild(hSort);

    sortOpts.forEach(opt => {
      const row = document.createElement('button');
      const isActive = detailSortKey === (opt.key || null) || (!detailSortKey && opt.key === '');
      row.style.cssText = [
        'display:flex','align-items:center','justify-content:space-between',
        'width:100%','padding:10px 14px','background:none','border:none',
        'color:' + (isActive ? '#fff' : 'rgba(255,255,255,0.72)'),
        'font-family:inherit','font-size:0.87rem','font-weight:' + (isActive ? '600' : '400'),
        'cursor:pointer','text-align:left','gap:8px',
        'transition:background 0.1s ease',
        'border-radius:6px','margin:0 4px','width:calc(100% - 8px)',
      ].join(';');
      const arrowIcon = isActive && opt.key
        ? `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="opacity:.7;flex-shrink:0"><path d="${detailSortDir === 1 ? 'M8 3l4 5H4z' : 'M8 13L4 8h8z'}"/></svg>`
        : '';
      row.innerHTML = `<span>${opt.label}</span>${arrowIcon}`;
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.07)'; };
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

    document.body.appendChild(panel);
    listSortBtnDV?.classList.add('active');

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
    const ctxIds = detailContextTracks.map(t => t.id).filter(Boolean);
    const activeCtxIds = window._playContextIds || [];
    const thisIsActive = ctxIds.length > 0 &&
      ctxIds.length === activeCtxIds.length &&
      ctxIds.every(id => activeCtxIds.includes(id));
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
  // FIX: also remove _syncPlaylistPlayIcon left by a prior custom playlist view
  if (audioPlayer._syncPlaylistPlayIcon) {
    audioPlayer.removeEventListener('play',  audioPlayer._syncPlaylistPlayIcon);
    audioPlayer.removeEventListener('pause', audioPlayer._syncPlaylistPlayIcon);
    audioPlayer._syncPlaylistPlayIcon = null;
  }
  audioPlayer._syncDetailPlayIcon = _syncDetailPlayIcon;
  audioPlayer.addEventListener('play',  _syncDetailPlayIcon);
  audioPlayer.addEventListener('pause', _syncDetailPlayIcon);
  _syncDetailPlayIcon();

  document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
    if (!detailContextTracks.length) return;
    const ctxIndices = detailContextTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
    // ── FIX : thisIsActive = cette vue est le contexte actif, indépendamment de
    // la piste en cours (currentIndex peut avoir avancé via goNext).
    // On compare uniquement les IDs des deux côtés, sans exiger que currentIndex
    // soit dans ctxIds (ce qui cassait le toggle pause après goNext).
    const ctxIds = detailContextTracks.map(t => t.id).filter(Boolean);
    const activeCtxIds = window._playContextIds || [];
    const thisIsActive = ctxIds.length > 0 &&
      ctxIds.length === activeCtxIds.length &&
      ctxIds.every(id => activeCtxIds.includes(id));
    if (thisIsActive && !audioPlayer.paused) {
      audioPlayer.pause();
    } else if (thisIsActive && audioPlayer.paused) {
      audioPlayer.play().catch(console.error);
    } else {
      // Démarrer depuis le début (séquentiel)
      isShuffled = false;
      shuffleBtn.classList.remove('active');
      document.getElementById('detailShuffleBtn')?.classList.remove('active');
      _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
      shuffleOrder = [...ctxIndices];
      window._currentRpContextName = name;
      const _ctxElDV = document.getElementById('rpContextName');
      if (_ctxElDV) _ctxElDV.textContent = name;
      if (ctxIndices.length) { currentIndex = ctxIndices[0]; playCurrentTrack(); }
    }
  });

  // Shuffle button - mélange uniquement dans le contexte de la vue
  const detailShuffleBtnEl = document.getElementById('detailShuffleBtn');
  detailShuffleBtnEl?.addEventListener('click', () => {
    isShuffled = true;
    shuffleBtn.classList.add('active');
    detailShuffleBtnEl.classList.add('active');
    const ctxIndices = detailContextTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
    _setPlayContext(ctxIndices.length ? ctxIndices.map(i => tracks[i]?.id).filter(Boolean) : null);
    window._currentRpContextName = name;
    const _ctxElDVS = document.getElementById('rpContextName');
    if (_ctxElDVS) _ctxElDVS.textContent = name;
    if (window._buildShuffleQueue) {
        const _ct = ctxIndices.map(i => tracks[i]).filter(Boolean);
        const _sh = window._buildShuffleQueue(_ct, 0);
        shuffleOrder = _sh.map(_trackToIdx).filter(i => i !== -1);
        _completeShuffleOrder(window._playContext);
      } else {
        shuffleOrder = _fisherYates(ctxIndices);
      }
    if (shuffleOrder.length) { currentIndex = shuffleOrder[0]; playCurrentTrack(); }
  });

  // Like / favourite button
  const BOOKMARK_FILLED = `<span class="detail-bookmark-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd" /></svg></span>`;
  const BOOKMARK_EMPTY  = `<span class="detail-bookmark-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg></span>`;
  const likeBtn2 = document.getElementById('detailLikeBtn');
  likeBtn2?.addEventListener('click', () => {
    if (type === 'album') {
      const adding = !favoriteAlbums.has(name);
      if (adding) favoriteAlbums.add(name); else favoriteAlbums.delete(name);
      likeBtn2.classList.toggle('liked', favoriteAlbums.has(name));
      likeBtn2.querySelector('.detail-bookmark-icon').outerHTML = (favoriteAlbums.has(name) ? BOOKMARK_FILLED : BOOKMARK_EMPTY);
      showToast(adding ? '♥ Album ajouté aux favoris' : '♡ Album retiré des favoris', adding ? 'success' : 'default');
      // Mettre à jour le bouton dans le sidebar sans re-render complet
      const sidebarBtn = trackListDiv?.querySelector(`.lib-fav-btn[data-album="${CSS.escape(name)}"]`);
      if (sidebarBtn) { sidebarBtn.classList.toggle('active', adding); sidebarBtn.innerHTML = adding ? _BKMK_FILLED : _BKMK_EMPTY; }
    } else if (type === 'artist') {
      const adding = !favoriteArtists.has(name);
      if (adding) favoriteArtists.add(name); else favoriteArtists.delete(name);
      likeBtn2.classList.toggle('liked', favoriteArtists.has(name));
      likeBtn2.querySelector('.detail-bookmark-icon').outerHTML = (favoriteArtists.has(name) ? BOOKMARK_FILLED : BOOKMARK_EMPTY);
      showToast(adding ? '♥ Artiste ajouté aux favoris' : '♡ Artiste retiré des favoris', adding ? 'success' : 'default');
      const sidebarBtn = trackListDiv?.querySelector(`.lib-fav-btn[data-artist="${CSS.escape(name)}"]`);
      if (sidebarBtn) { sidebarBtn.classList.toggle('active', adding); sidebarBtn.innerHTML = adding ? _BKMK_FILLED : _BKMK_EMPTY; }
    } else if (type === 'custom_playlist') {
      const adding = !favoritePlaylists.has(name);
      if (adding) favoritePlaylists.add(name); else favoritePlaylists.delete(name);
      localStorage.setItem('favoritePlaylists', JSON.stringify([...favoritePlaylists]));
      likeBtn2.classList.toggle('liked', favoritePlaylists.has(name));
      const iconSpan = likeBtn2.querySelector('.detail-bookmark-icon');
      if (iconSpan) iconSpan.outerHTML = (favoritePlaylists.has(name) ? BOOKMARK_FILLED : BOOKMARK_EMPTY);
      showToast(adding ? '♥ Playlist ajoutée aux favoris' : '♡ Playlist retirée des favoris', adding ? 'success' : 'default');
      if (currentSidebarFilter === 'playlists') renderSidebarPlaylists();
    }
    if (window.FirebaseSync?.syncToFirestore) window.FirebaseSync.syncToFirestore();
  });

  // More options button - show a simple context menu
  document.getElementById('detailMoreBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Remove existing menu if open
    document.getElementById('detailContextMenu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'detailContextMenu';
    menu.style.cssText = `position:fixed;background:var(--bg-elevated);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 0;z-index:9999;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,0.6)`;
    const menuItems = [
      { label: 'Lire depuis le début', action: () => { const fi = tracks.findIndex(t => t.id === detailContextTracks[0]?.id); if (fi !== -1) { currentIndex = fi; playCurrentTrack(); } } },
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

/* ══════════════════════════════════════════════════════════════════
   PAGE DE PROFIL UTILISATEUR
   ══════════════════════════════════════════════════════════════════ */

// ── Upload avatar → Nextcloud WebDAV via proxy Caddy /api/nextcloud/ ──
// Remplace l'ancien upload Firebase Storage.
// 1. Redimensionne à max 800×800 px via Canvas (JPEG 0.88)
// 2. Délègue l'envoi WebDAV + mise à jour Firestore à
//    FirebaseSync.uploadProfilePicture() (firebase-sync.js).
//
// @param  {File}   file   Fichier image sélectionné par l'utilisateur
// @param  {string} _docId Non utilisé (conservé pour compatibilité des appelants)
// @returns {Promise<string>} URL proxy /api/nextcloud/... de l'avatar uploadé
async function _uploadAvatarToStorage(file, _docId) {
  if (!file) throw new Error('Aucun fichier fourni');

  // Redimensionnement Canvas → max 800×800, JPEG qualité 0.88
  const resizedBlob = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX   = 800;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const w     = Math.round(img.width  * scale);
        const h     = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', 0.88);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Déléguer à firebase-sync.js (WebDAV MKCOL + PUT + mise à jour Firestore)
  if (typeof window.FirebaseSync?.uploadProfilePicture !== 'function') {
    throw new Error('FirebaseSync.uploadProfilePicture non disponible');
  }
  const jpegFile = new File([resizedBlob], 'avatar.jpg', { type: 'image/jpeg' });
  return window.FirebaseSync.uploadProfilePicture(jpegFile);
}

async function showUserProfile(docId, initialData = {}, pushHistory = true) {
  if (!userProfileView) return;
  const db   = window.FirebaseConfig?.getDB?.();
  const myId = window.FirebaseSocial?.getMyDocId?.() || window.currentUser?.uid;
  const uid  = docId || myId;
  if (!uid) return;
  const isOwn = uid === myId;

  _hideAllMainPanels();
  userProfileView.style.display = 'flex';
  userProfileView.scrollTop = 0;
  if (pushHistory) pushNavState('profile', { docId: uid });

  const seedHue = [...(initialData.name||uid||'?')].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
  userProfileView.innerHTML = `
    <div class="upv-skeleton" style="background:linear-gradient(160deg,hsl(${seedHue},40%,12%) 0%,hsl(${(seedHue+80)%360},35%,8%) 100%)">
      <div class="upv-sk-banner"></div><div class="upv-sk-avatar"></div>
      <div class="upv-sk-lines">
        <div class="upv-sk-line" style="width:40%"></div>
        <div class="upv-sk-line" style="width:26%;opacity:.5;margin-top:8px"></div>
      </div>
    </div>`;

  // ── Chargement Firestore ──────────────────────────────────────────
  let data = {};
  try { const s=await db?.collection('users').doc(uid).get(); if(s?.exists)data=s.data(); } catch(e){}

  // ── Résolution nom + photo (ordre de priorité corrigé) ────────────
  // Les données sont dans publicProfile.name / publicProfile.picture
  // ou profile.name / profile.picture selon le provider
  const name = data.publicProfile?.name
    || data.profile?.name
    || data.displayName
    || data.name
    || (isOwn ? (window._authUser?.name || window._firebaseUser?.displayName || window._firebaseUser?.email?.split('@')[0]) : null)
    || initialData.name
    || '?';
  const picture = data.publicProfile?.picture
    || data.profile?.picture
    || data.photoURL
    || (isOwn ? (window._authUser?.picture || window._firebaseUser?.photoURL) : null)
    || initialData.picture
    || '';
  const bannerUrl = data.publicProfile?.bannerUrl || '';
  const hue       = [...name].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
  const gradient  = `linear-gradient(135deg,hsl(${hue},55%,32%),hsl(${(hue+70)%360},50%,20%))`;
  const history   = data.history || [];

  // ── Calcul top artistes ───────────────────────────────────────────
  const aScore={},aImg={};
  history.forEach(t=>{if(!t.artist)return;aScore[t.artist]=(aScore[t.artist]||0)+1;if(!aImg[t.artist]&&t.imageUrl)aImg[t.artist]=t.imageUrl;});
  (data.favoriteArtists||[]).forEach(a=>{aScore[a]=(aScore[a]||0)+10;if(!aImg[a]){const lt=tracks.find(t=>t.artist?.toLowerCase()===a.toLowerCase());if(lt?.imageUrl)aImg[a]=lt.imageUrl;}});
  const topArtists=Object.entries(aScore).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([n])=>({name:n,imageUrl:aImg[n]||''}));

  // ── Top titres ────────────────────────────────────────────────────
  const tFreq={},tData={};
  history.forEach(t=>{const k=t.id||t.title;if(!k)return;tFreq[k]=(tFreq[k]||0)+1;if(!tData[k])tData[k]=t;});
  const topTracks=Object.entries(tFreq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>tData[k]).filter(Boolean);

  // ── Artistes récents ──────────────────────────────────────────────
  const raSeen=new Set(),recentArtists=[];
  for(const t of history){if(t.artist&&!raSeen.has(t.artist)){raSeen.add(t.artist);recentArtists.push({name:t.artist,imageUrl:t.imageUrl||''});if(recentArtists.length>=20)break;}}

  // ── Playlists publiques ───────────────────────────────────────────
  // Déduplique par ID pour éviter les doublons si Firestore renvoie des clés identiques
  const _plSeen=new Set();
  const pubPls=Object.entries(data.playlists||{})
    .map(([id,pl])=>({id,...pl}))
    .filter(pl=>{
      if(pl.private||!pl.name)return false;
      if(_plSeen.has(pl.id))return false;
      _plSeen.add(pl.id);return true;
    });

  // ── Abonnés / suivis — fetch profils réels depuis Firestore ───────
  const rawFollowers = data.followers || [];
  const rawFollowing = data.following || [];

  async function _fetchProfiles(docIds) {
    if (!docIds.length || !db) return docIds.map(id=>({docId:id,name:id,picture:''}));
    const snaps = await Promise.allSettled(docIds.map(id=>db.collection('users').doc(id).get()));
    return snaps.map((res,i)=>{
      const id = docIds[i];
      if (res.status!=='fulfilled'||!res.value.exists) return {docId:id,name:id,picture:''};
      const d=res.value.data();
      return {
        docId:   id,
        name:    d.publicProfile?.name    || d.profile?.name    || d.displayName || d.name || id,
        picture: d.publicProfile?.picture || d.profile?.picture || d.photoURL    || ''
      };
    });
  }

  // Fetch en parallèle (non bloquant pour le rendu initial — sera mis à jour après)
  const [followerProfiles, followingProfiles] = await Promise.all([
    _fetchProfiles(rawFollowers.filter(x=>typeof x==='string'||x?.docId).map(x=>typeof x==='string'?x:x.docId)),
    _fetchProfiles(rawFollowing.filter(x=>typeof x==='string'||x?.docId).map(x=>typeof x==='string'?x:x.docId))
  ]);

  // Si déjà des objets avec name/picture, les utiliser
  const followers = rawFollowers.map((f,i)=>{
    if (typeof f==='object'&&f?.name) return f;
    return followerProfiles[i] || {docId: typeof f==='string'?f:f?.docId||'', name:'?', picture:''};
  });
  const following = rawFollowing.map((f,i)=>{
    if (typeof f==='object'&&f?.name) return f;
    return followingProfiles[i] || {docId: typeof f==='string'?f:f?.docId||'', name:'?', picture:''};
  });

  let isFollowing=false;
  if(!isOwn&&window.FirebaseSocial?.isFollowing){try{isFollowing=await window.FirebaseSocial.isFollowing(uid);}catch(_){}}

  // ── Helpers HTML ──────────────────────────────────────────────────
  const cL=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>`;
  const cR=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>`;
  function _h(n){return[...(n||'?')].reduce((a,c)=>a+c.charCodeAt(0),0)%360;}
  function _g(n){const h=_h(n);return`linear-gradient(135deg,hsl(${h},55%,35%),hsl(${(h+60)%360},55%,25%))`;}
  function _e(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function _plCover(tracks, coverUrl){
    // Priorité 1 : coverUrl custom de la playlist
    if(coverUrl)return`<img src="${_e(coverUrl)}" class="upv-pl-single" loading="lazy" decoding="async" alt="">`;
    // Priorité 2 : mosaïque des pochettes des titres
    const i=[];for(const x of(tracks||[])){if(x.imageUrl&&!i.includes(x.imageUrl))i.push(x.imageUrl);if(i.length===4)break;}
    if(i.length>=4)return`<div class="upv-pl-mosaic">${i.map(u=>`<img src="${_e(u)}" loading="lazy" decoding="async" alt="">`).join('')}</div>`;
    if(i.length>=1)return`<img src="${_e(i[0])}" class="upv-pl-single" loading="lazy" decoding="async" alt="">`;return`<div class="upv-pl-ph">🎵</div>`;}
  function _ac(list){return list.map(a=>`<div class="home-card upv-artist-card" data-artist="${_e(a.name)}">
    <div class="home-card-art" style="border-radius:50%">${a.imageUrl?`<img src="${_e(a.imageUrl)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.style.background='${_g(a.name)}';this.remove()">`:`<div class="upv-initial" style="background:${_g(a.name)}">${_e(a.name.charAt(0).toUpperCase())}</div>`}
    <div class="home-card-hover-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg></div></div>
    <div class="home-card-name">${_e(a.name)}</div><div class="home-card-sub">Artiste</div></div>`).join('');}
  function _uc(u){const n=u.name||u.displayName||u.docId||'?',p=u.picture||u.photoURL||'',id=u.docId||u.uid||'';
    return`<div class="home-card upv-user-card" data-docid="${_e(id)}">
    <div class="home-card-art" style="border-radius:50%">${p?`<img src="${_e(p)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.style.background='${_g(n)}';this.remove()">`:`<div class="upv-initial" style="background:${_g(n)}">${_e(n.charAt(0).toUpperCase())}</div>`}
    <div class="home-card-hover-btn" style="background:var(--green,#1ed760)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div></div>
    <div class="home-card-name">${_e(n)}</div><div class="home-card-sub">Utilisateur</div></div>`;}
  function _pc(pl){const cn=(pl.name||'').replace(/\s*\(par [^)]+\)\s*$/,'').trim();
    return`<div class="home-card upv-pl-card" data-plid="${_e(pl.id)}">
    <div class="home-card-art">${_plCover(pl.tracks,pl.coverUrl)}<div class="home-card-hover-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg></div></div>
    <div class="home-card-name">${_e(cn)}</div><div class="home-card-sub">${pl.tracks?.length||0} titre${(pl.tracks?.length||0)!==1?'s':''}</div></div>`;}
  function _cr(id,title,cards,empty=''){
    if(!cards.trim())return empty?`<div class="home-section upv-section"><div class="home-section-header"><h2 class="home-section-title">${title}</h2></div><p class="upv-empty-section">${empty}</p></div>`:'';
    return`<div class="home-section upv-section"><div class="home-section-header"><h2 class="home-section-title">${title}</h2></div><div class="carousel-wrapper"><button class="carousel-arrow arrow-prev">${cL}</button><div class="home-row-scroll" id="${id}">${cards}</div><button class="carousel-arrow arrow-next">${cR}</button></div></div>`;}
  function _tt(list){if(!list.length)return'';
    return`<div class="home-section upv-section"><div class="home-section-header"><h2 class="home-section-title">Top titres du mois</h2></div><div class="upv-track-list">${list.map((t,i)=>{
      const r=tracks.find(lt=>String(lt.id)===String(t.id))||tracks.find(lt=>lt.title?.toLowerCase()===t.title?.toLowerCase()&&lt.artist?.toLowerCase()===t.artist?.toLowerCase());
      return`<div class="upv-track-row" data-trackid="${_e(t.id||'')}" data-title="${_e(t.title||'')}" data-artist="${_e(t.artist||'')}">
        <span class="upv-tr-num">${i+1}</span>${t.imageUrl?`<img src="${_e(t.imageUrl)}" class="upv-tr-cover" loading="lazy" decoding="async" alt="">`:`<div class="upv-tr-cover-ph">♪</div>`}
        <div class="upv-tr-meta"><div class="upv-tr-title">${_e(t.title||'?')}</div><div class="upv-tr-artist">${_e(t.artist||'')}</div></div>
        <div class="upv-tr-dur">${r?formatTime(r.duration||0):'—'}</div>
        <button class="upv-tr-play"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M8 5v14l11-7z"/></svg></button></div>`;}).join('')}</div></div>`;}

  // ── Bannière ──────────────────────────────────────────────────────
  let bannerContent='';
  if(bannerUrl){bannerContent=`<img src="${_e(bannerUrl)}" class="upv-banner-img" alt="">`;}
  else{const hi=[...new Set(history.map(t=>t.imageUrl).filter(Boolean))].slice(0,4);
    if(hi.length>=4)bannerContent=`<div class="upv-banner-mosaic">${hi.map(u=>`<img src="${_e(u)}" alt="">`).join('')}</div>`;
    else if(hi[0])bannerContent=`<img src="${_e(hi[0])}" class="upv-banner-img upv-banner-blur" alt="">`;}

  // ── HTML complet ──────────────────────────────────────────────────
  userProfileView.innerHTML = `
    <div class="upv-header">
      <div class="upv-banner"><div class="upv-banner-bg" style="background:${gradient}">${bannerContent}</div><div class="upv-banner-fade"></div></div>
      <div class="upv-header-inner">
        <div class="upv-avatar-wrap${isOwn?' upv-avatar-editable':''}" id="upvAvatarWrap">
          <div class="upv-avatar" style="background:${gradient}">
            ${picture?`<img src="${_e(picture)}" alt="" class="upv-avatar-img" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">`:''}
            <span class="upv-avatar-letter" style="${picture?'display:none':''}">${_e(name.charAt(0).toUpperCase())}</span>
          </div>
          ${isOwn?`<label class="upv-avatar-overlay" for="upvAvatarInput"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Sélectionnez une photo</span><input type="file" id="upvAvatarInput" accept="image/*" style="display:none"></label>`:''}
        </div>
        <div class="upv-meta">
          <div class="upv-type-label">PROFIL</div>
          <h1 class="upv-name">${_e(name)}</h1>
          <div class="upv-stats">
            <span>${pubPls.length} playlist${pubPls.length!==1?'s':''} publique${pubPls.length!==1?'s':''}</span>
            <span class="upv-stats-sep">·</span><span>${rawFollowers.length} abonné${rawFollowers.length!==1?'s':''}</span>
            <span class="upv-stats-sep">·</span><span>${rawFollowing.length} abonnement${rawFollowing.length!==1?'s':''}</span>
          </div>
          <div class="upv-actions">
            ${isOwn?`<button class="upv-btn upv-btn-outline" id="upvEditProfile">Modifier le profil</button>
              <button class="upv-btn upv-btn-outline" id="upvShareProfile">Partager le profil</button>
              <button class="upv-btn upv-btn-icon" id="upvSettings" data-tooltip="Paramètres"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>`
            :`<button class="upv-btn ${isFollowing?'upv-btn-following':'upv-btn-primary'}" id="upvFollowBtn" data-docid="${_e(uid)}">${isFollowing?'✓ Suivi':'+ Suivre'}</button>`}
          </div>
        </div>
      </div>
    </div>
    <div class="upv-body" id="upvBody">
      ${_cr('upvPublicPls','Playlists publiques',pubPls.map(_pc).join(''),pubPls.length?'':'Aucune playlist publique')}
      ${_cr('upvTopArtists','Top artistes du mois',_ac(topArtists),'Aucun artiste à afficher')}
      ${_tt(topTracks)}
      ${_cr('upvRecentArtists','Artistes écoutés récemment',_ac(recentArtists),'')}
      ${_cr('upvFollowers','Abonnés',followers.map(_uc).join(''),followers.length?'':'Aucun abonné')}
      ${_cr('upvFollowing','Abonnements',following.map(_uc).join(''),following.length?'':'Aucun abonnement')}
    </div>`;

  // ── Carousels ─────────────────────────────────────────────────────
  ['upvPublicPls','upvTopArtists','upvRecentArtists','upvFollowers','upvFollowing'].forEach(cid=>{
    const row=document.getElementById(cid);if(!row)return;
    const wrap=row.closest('.carousel-wrapper'),prev=wrap?.querySelector('.arrow-prev'),next=wrap?.querySelector('.arrow-next');
    const sync=()=>{if(!wrap)return;const s=row.scrollLeft,w=row.scrollWidth-row.clientWidth;
      if(prev)prev.style.opacity=s<=4?'0':'1';if(next)next.style.opacity=s>=w-4?'0':'1';};
    if(wrap)wrap._syncArrows=sync;
    prev?.addEventListener('click',()=>row.scrollBy({left:-480,behavior:'smooth'}));
    next?.addEventListener('click',()=>row.scrollBy({left:480,behavior:'smooth'}));
    row.addEventListener('scroll',sync,{passive:true});requestAnimationFrame(()=>requestAnimationFrame(sync));
  });

  // ── Clics artistes → détail ───────────────────────────────────────
  userProfileView.querySelectorAll('.upv-artist-card').forEach(c=>c.addEventListener('click',()=>showDetailView('artist',c.dataset.artist)));

  // ── Clics playlists → vue playlist de l'ami ──────────────────────
  // IMPORTANT : on ne touche PAS à window.customPlaylists (playlists de l'utilisateur)
  // On stocke la playlist d'ami dans un namespace séparé window._friendPlaylistCache
  userProfileView.querySelectorAll('.upv-pl-card').forEach(c => c.addEventListener('click', () => {
    const pl = pubPls.find(p => p.id === c.dataset.plid);
    if (!pl) return;
    const cn = (pl.name || '').replace(/\s*\(par [^)]+\)\s*$/, '').trim();
    const tempId = `friend_${uid}_${pl.id}`;

    // Stocker dans le cache ami séparé — jamais dans customPlaylists
    if (!window._friendPlaylistCache) window._friendPlaylistCache = {};
    // Nettoyer TOUS les caches ami (pas seulement ce uid) pour éviter l'accumulation
    window._friendPlaylistCache = {};
    window._friendPlaylistCache[tempId] = {
      id:          tempId,
      name:        cn,
      description: `Playlist de ${name}`,
      tracks:      pl.tracks  || [],
      coverUrl:    pl.coverUrl || null,
      createdBy:   name,
      _isFriendPlaylist: true,
      _ownerName:  name,
    };

    // Afficher directement via la fonction de vue playlist
    // sans modifier customPlaylists ni la sidebar
    _showFriendPlaylistView(tempId);
  }));

  // ── Clics top titres → play ────────────────────────────────────────
  userProfileView.querySelectorAll('.upv-track-row').forEach(r=>{
    r.addEventListener('click',()=>{
      const t=tracks.find(lt=>String(lt.id)===String(r.dataset.trackid))||tracks.find(lt=>lt.title?.toLowerCase()===r.dataset.title?.toLowerCase()&&lt.artist?.toLowerCase()===r.dataset.artist?.toLowerCase());
      if(t)window.playTrack(t,null,name);
    });
    r.querySelector('.upv-tr-play')?.addEventListener('click',e=>e.stopPropagation());
  });

  // ── Clics utilisateurs → leur profil ──────────────────────────────
  userProfileView.querySelectorAll('.upv-user-card').forEach(c=>c.addEventListener('click',()=>{if(c.dataset.docid)showUserProfile(c.dataset.docid);}));

  // ── Follow ─────────────────────────────────────────────────────────
  const followBtn=document.getElementById('upvFollowBtn');
  if(followBtn&&window.FirebaseSocial){followBtn.addEventListener('click',async()=>{
    followBtn.disabled=true;const was=followBtn.classList.contains('upv-btn-following');
    const ok=was?await window.FirebaseSocial.unfollowUser(uid):await window.FirebaseSocial.followUser(uid);
    if(ok){const now=!was;followBtn.classList.toggle('upv-btn-following',now);followBtn.classList.toggle('upv-btn-primary',!now);followBtn.textContent=now?'✓ Suivi':'+ Suivre';}
    followBtn.disabled=false;
  });}

  // ── Modifier le profil ─────────────────────────────────────────────
  document.getElementById('upvEditProfile')?.addEventListener('click',()=>_openProfileEditModal(uid,{name,picture,bannerUrl,bio:data.publicProfile?.bio||''}));

  // ── Partager le profil ─────────────────────────────────────────────
  document.getElementById('upvShareProfile')?.addEventListener('click',()=>{
    const _toast = (msg,type)=>{ typeof showToast==='function'?showToast(msg,type):alert(msg); };
    try {
      const shareData = `${window.location.origin}?profile=${encodeURIComponent(uid)}`;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareData).then(()=>_toast('Lien copié !')).catch(()=>{
          const inp=document.createElement('input');inp.value=shareData;document.body.appendChild(inp);inp.select();document.execCommand('copy');inp.remove();_toast('Lien copié !');
        });
      } else {
        const inp=document.createElement('input');inp.value=shareData;document.body.appendChild(inp);inp.select();document.execCommand('copy');inp.remove();_toast('Lien copié !');
      }
    } catch { _toast('Copie non disponible','error'); }
  });

  // ── Paramètres ─────────────────────────────────────────────────────
  document.getElementById('upvSettings')?.addEventListener('click',()=>document.getElementById('pdSettings')?.click());

  // ── Upload avatar ──────────────────────────────────────────────────
  document.getElementById('upvAvatarInput')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    const myDocId = window.FirebaseSocial?.getMyDocId?.()
                 || window._authUser?.email
                 || window._authUser?.discordId
                 || uid;
    if(!myDocId){ typeof showToast==='function'&&showToast('Non connecté','error'); return; }
    typeof showToast==='function' && showToast('Upload en cours…');
    try {
      // Upload Nextcloud WebDAV via proxy Caddy → URL proxy /api/nextcloud/...
      const url = await _uploadAvatarToStorage(file, myDocId);

      // Mettre à jour l'avatar dans la page profil immédiatement
      const imgEl = document.querySelector('#upvAvatarWrap .upv-avatar img');
      const letEl = document.querySelector('#upvAvatarWrap .upv-avatar-letter');
      if(imgEl){ imgEl.src=url; imgEl.style.display='block'; }
      else { const av=document.querySelector('#upvAvatarWrap .upv-avatar'); if(av){const img=document.createElement('img');img.src=url;img.className='upv-avatar-img';av.prepend(img);} }
      if(letEl) letEl.style.display='none';

      // Mettre à jour publicProfile.picture avec l'URL Nextcloud
      const db2 = window.FirebaseConfig?.getDB?.();
      if(db2){ await db2.collection('users').doc(myDocId).update({ 'publicProfile.picture': url }); }

      // Propager dans _authUser + toute l'UI
      if(window._authUser) window._authUser.picture = url;
      if(typeof window.applyUserToUI === 'function') window.applyUserToUI(window._authUser);
      typeof showToast==='function' && showToast('Photo mise à jour ✓');
    } catch(err) {
      console.error('[Avatar] Erreur upload:', err);
      typeof showToast==='function' && showToast('Erreur : ' + err.message, 'error');
    }
  });
}

function _openProfileEditModal(docId, profileData={}) {
  document.getElementById('profileEditModal')?.remove();
  const {name='',picture='',bio=''}=profileData;
  const modal=document.createElement('div');modal.id='profileEditModal';modal.className='pl-edit-overlay';
  const h=[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
  modal.innerHTML=`<div class="pl-edit-modal">
    <div class="pl-edit-header"><h2 class="pl-edit-title">Modifier les informations</h2><button class="pl-edit-close" id="profEditClose">✕</button></div>
    <div class="pl-edit-body">
      <div class="pl-edit-cover-section"><label class="pl-edit-cover-wrap" for="profEditAvatarInput" style="cursor:pointer">
        <div class="pl-edit-cover" id="profEditCoverPreview" style="border-radius:50%;overflow:hidden">
          ${picture?`<img src="${escapeHtml(picture)}" alt="" style="width:100%;height:100%;object-fit:cover">`:`<div style="width:100%;height:100%;background:linear-gradient(135deg,hsl(${h},55%,35%),hsl(${(h+60)%360},55%,25%));display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:900;color:rgba(255,255,255,.85)">${escapeHtml(name.charAt(0).toUpperCase())}</div>`}
        </div>
        <div class="pl-edit-cover-overlay"><span>Modifier la photo</span></div>
        <input type="file" id="profEditAvatarInput" accept="image/*" style="display:none">
      </label></div>
      <div class="pl-edit-fields">
        <label class="pl-edit-field-label">Nom affiché</label>
        <input type="text" id="profEditName" class="pl-edit-input" maxlength="40" value="${escapeHtml(name)}" placeholder="Ton pseudonyme">
        <label class="pl-edit-field-label" style="margin-top:10px">Bio</label>
        <textarea id="profEditBio" class="pl-edit-textarea" rows="3" maxlength="200" placeholder="Quelques mots sur toi…">${escapeHtml(bio)}</textarea>
      </div>
    </div>
    <div class="pl-edit-footer"><button class="pl-edit-cancel-btn" id="profEditCancel">Annuler</button><button class="pl-edit-save-btn" id="profEditSave">Sauvegarder</button></div>
  </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  document.getElementById('profEditClose')?.addEventListener('click',close);
  document.getElementById('profEditCancel')?.addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close();});
  document.getElementById('profEditAvatarInput')?.addEventListener('change',e=>{
    const f=e.target.files?.[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{const p=document.getElementById('profEditCoverPreview');if(p)p.innerHTML=`<img src="${r.result}" style="width:100%;height:100%;object-fit:cover">`;};r.readAsDataURL(f);
  });
  document.getElementById('profEditSave')?.addEventListener('click',async()=>{
    const btn=document.getElementById('profEditSave');btn.disabled=true;btn.textContent='Sauvegarde…';
    const newName=document.getElementById('profEditName')?.value.trim()||name;
    const newBio=document.getElementById('profEditBio')?.value.trim()||'';
    const f=document.getElementById('profEditAvatarInput')?.files?.[0];
    try{
      const db2   = window.FirebaseConfig?.getDB?.();
      const mid   = window.FirebaseSocial?.getMyDocId?.() || window._authUser?.email || window._authUser?.discordId;
      if(db2 && mid){
        // IMPORTANT : on n'écrit QUE dans publicProfile.* pour respecter les règles
        // Firestore (allow update: affectedKeys hasOnly ['publicProfile', ...]).
        // displayName et photoURL sont des champs racine → permission refusée.
        const upd = {
          'publicProfile.name': newName,
          'publicProfile.bio':  newBio,
        };
        let newPicUrl = null;
        if(f){
          // Upload Nextcloud WebDAV via proxy Caddy → URL proxy /api/nextcloud/...
          newPicUrl = await _uploadAvatarToStorage(f, mid);
          upd['publicProfile.picture'] = newPicUrl;
        }
        // ── Sauvegarder dans Firestore ──
        await db2.collection('users').doc(mid).update(upd);

        // ── Propager dans _authUser + toute l'UI ──
        if(window._authUser){
          window._authUser.name = newName;
          if(newPicUrl) window._authUser.picture = newPicUrl;
        }
        // applyUserToUI met à jour dropdown, topbar, avatar partout
        if(typeof window.applyUserToUI === 'function') window.applyUserToUI(window._authUser);
        // Mettre à jour le nom dans la vue profil ouverte
        const ne = userProfileView?.querySelector('.upv-name');
        if(ne) ne.textContent = newName;
        // Mettre à jour l'avatar dans la vue profil ouverte si photo changée
        if(newPicUrl){
          const avImg = document.querySelector('#upvAvatarWrap .upv-avatar img');
          if(avImg) avImg.src = newPicUrl;
        }
        // ── Mettre à jour la présence Firebase (pour friends-panel) ──
        if(window.FirebaseSocial?.updatePresenceWithProfile){
          const audio  = document.getElementById('audioPlayer');
          const status = audio?.paused ? 'paused' : 'playing';
          window.FirebaseSocial.updatePresenceWithProfile(status, window.currentTrack||null, Math.floor(audio?.currentTime||0));
        }
        typeof showToast==='function' ? showToast('Profil mis à jour ✓') : alert('Profil mis à jour ✓');
        close();
      }
    } catch(err){
      console.error('[Profile] save error:', err);
      typeof showToast==='function' ? showToast('Erreur de sauvegarde : '+err.message,'error') : alert('Erreur');
    }
    btn.disabled=false;btn.textContent='Sauvegarder';
  });
}

window.showUserProfile = showUserProfile;

function _sortAndRenderDetailTracks(type) {
  let sorted = [...detailContextTracks];
  const currentName = document.querySelector('.detail-title')?.textContent || '';
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
  // ── FIX : respecter le filtre de recherche actif pour ne pas l'écraser lors d'un tri
  const searchInput = document.getElementById('detailSearchInput');
  const searchTerm  = searchInput?.value?.trim().toLowerCase() || '';
  if (searchTerm) {
    sorted = sorted.filter(t =>
      t.title?.toLowerCase().includes(searchTerm) ||
      (t.artists || [t.artist]).some(a => a.toLowerCase().includes(searchTerm)) ||
      t.album?.toLowerCase().includes(searchTerm)
    );
  }
  if (type === 'artist') {
    _renderArtistTracksByAlbum(sorted, currentName || (detailType === 'artist' ? (document.querySelector('.detail-title')?.textContent || '') : ''));
  } else {
    _renderDetailTracks(sorted, type, currentName);
  }
}


// ── Artist view : titres groupés par album avec en-têtes ──────────
function _renderArtistTracksByAlbum(contextTracks, name) {
  const container = document.getElementById('detailTrackList');
  if (!container) return;

  // Grouper par album, triés par année desc (les plus récents en premier)
  const albumMap = new Map();
  contextTracks.forEach(t => {
    if (!albumMap.has(t.album)) {
      albumMap.set(t.album, { name: t.album, year: t.year || 0, imageUrl: t.imageUrl, tracks: [] });
    }
    albumMap.get(t.album).tracks.push(t);
  });
  const albums = [...albumMap.values()].sort((a, b) => (b.year || 0) - (a.year || 0));
  albums.forEach(al => al.tracks.sort((a, b) => (a.indexNumber || 0) - (b.indexNumber || 0) || a.title.localeCompare(b.title)));

  const activeId = tracks[currentIndex]?.id;
  let html = '';

  albums.forEach(al => {
    const albumType = al.tracks.length === 1 ? 'Single' : 'Album';
    const trackCount = al.tracks.length;
    const yearStr = al.year ? String(al.year) : '';
    const metaParts = [albumType, yearStr, trackCount + ' titre' + (trackCount > 1 ? 's' : '')].filter(Boolean);
    html += `<div class="artist-album-group">
      <div class="artist-album-group-header" data-album="${escapeHtml(al.name)}">
        <div class="aagh-cover">
          ${al.imageUrl ? `<img src="${al.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div class="aagh-cover-ph">💿</div>`}
        </div>
        <div class="aagh-info">
          <span class="aagh-name">${escapeHtml(al.name)}</span>
          <span class="aagh-meta">${metaParts.join(' · ')}</span>
        </div>
        <svg class="aagh-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
      </div>`;

    al.tracks.forEach((t, i) => {
      const globalIdx = tracks.findIndex(tr => tr.id === t.id);
      const isPlaying = t.id === activeId;
      const dateStr = t.year ? String(t.year) : '-';
      html += `<div class="detail-track-row ${isPlaying ? 'playing' : ''}"
           data-id="${t.id}" data-idx="${globalIdx}"
           style="grid-template-columns:36px 46px 1fr 110px 60px 72px">
        <span class="dtr-num">${isPlaying ? '<img src="pictures/equaliser-animated-white.gif" alt="▶" class="dtr-equalizer-gif">' : i + 1}</span>
        <div class="dtr-art">
          ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div class="dtr-art-placeholder">🎵</div>`}
          <div class="dtr-play-overlay" data-track-id="${t.id}">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="dtr-overlay-icon">${isPlaying ? '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>' : '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path>'}</svg>
          </div>
        </div>
        <div class="dtr-meta">
          <div class="dtr-title">${escapeHtml(t.title)}</div>
          <div class="dtr-artist">${
            (t.artists && t.artists.length > 1
              ? t.artists.map(a => `<span class="nav-link" data-nav="artist" data-name="${escapeHtml(a)}">${escapeHtml(a)}</span>`).join(', ')
              : `<span class="nav-link" data-nav="artist" data-name="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span>`)
          }</div>
        </div>
        <div class="dtr-dateadded">${dateStr}</div>
        <div class="dtr-dur">${formatTime(t.duration)}</div>
        <div class="dtr-actions">
          <button class="dtr-btn dtr-etc" data-tooltip="Plus d'options" data-id="${t.id}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
          <button class="dtr-btn dtr-plus" data-tooltip="Ajouter à une playlist" data-id="${t.id}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;

  // En-tête album → naviguer vers l'album
  container.querySelectorAll('.artist-album-group-header').forEach(hdr => {
    hdr.addEventListener('click', () => showDetailView('album', hdr.dataset.album));
  });

  // ── FIX : délégation unique (même logique que _renderDetailTracks) ──────
  if (container._dtrClickHandler) {
    container.removeEventListener('click', container._dtrClickHandler);
  }
  container._dtrClickHandler = function _dtrClick(e) {
    const link = e.target.closest('.nav-link');
    if (link) { e.stopPropagation(); showDetailView(link.dataset.nav, link.dataset.name); return; }
    if (e.target.closest('.dtr-btn')) return;
    if (e.target.closest('.artist-album-group-header')) return; // géré séparément

    const overlay = e.target.closest('.dtr-play-overlay');
    const row     = e.target.closest('.detail-track-row');
    if (!row) return;

    const trackId = row.dataset.id;
    let   idx      = trackId ? tracks.findIndex(t => t.id === trackId) : -1;
    // Piste pas encore dans `tracks` (sync complète pas terminée en arrière-plan,
    // voir aperçu rapide) : on la récupère dans la liste déjà affichée (elle a
    // forcément servi à rendre cette ligne) et on l'ajoute via le helper centralisé
    // (dédoublonné + shuffleOrder tenu à jour).
    if (idx === -1 && trackId) {
      const fallbackTrack = contextTracks.find(t => t.id === trackId);
      if (fallbackTrack) idx = _ensureTrackInLibrary(fallbackTrack);
    }
    if (idx === -1) return;

    // Ne changer le contexte que si la vue artiste n'est pas déjà active
    const ctxIds  = window._playContextIds || [];
    const listIds = contextTracks.map(t => t.id).filter(Boolean);
    const sameCtx = listIds.length > 0 &&
                    listIds.length === ctxIds.length &&
                    listIds.every(id => ctxIds.includes(id));
    if (!sameCtx) {
      const ctxI = contextTracks.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      _setPlayContext(ctxI.length > 1 ? ctxI.map(i => tracks[i]?.id).filter(Boolean) : null);
      window._currentRpContextName = name;
      const _ctxEl = document.getElementById('rpContextName');
      if (_ctxEl) _ctxEl.textContent = name;
    }

    if (overlay) {
      if (currentIndex === idx && !audioPlayer.paused) audioPlayer.pause();
      else playTrackAt(idx);
    } else {
      playTrackAt(idx);
    }
  };
  container.addEventListener('click', container._dtrClickHandler);

  // Boutons Etc / Plus
  container.querySelectorAll('.dtr-etc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const track = tracks.find(t => t.id === btn.dataset.id);
      if (track) showTrackContextMenu(e, track);
    });
  });
  container.querySelectorAll('.dtr-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const track = tracks.find(t => t.id === btn.dataset.id);
      if (track) showAddToPlaylistPopup(e, track);
    });
  });

  highlightActiveTrack();
}

function _renderDetailTracks(list, type, name = '') {
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
    const globalIdx = tracks.findIndex(tr => tr.id === t.id);
    const isPlaying = t.id === activeId;
    let dateStr = '-';
    if (type === 'custom_playlist' || type === 'liked') {
      // Uniquement la date d'ajout Firebase — jamais les métadonnées Jellyfin
      if (t.addedAt && typeof t.addedAt === 'number' && t.addedAt > 1_000_000_000_000) {
        try {
          const d = new Date(t.addedAt);
          if (!isNaN(d)) dateStr = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch {}
      }
      // Pas de fallback vers premiereDate/year ici — afficher '-' si pas de date Firebase
    } else if (t.premiereDate) {
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
          ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div class="dtr-art-placeholder">🎵</div>`}
          <div class="dtr-play-overlay" data-track-id="${t.id}">
            <svg data-encore-id="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="dtr-overlay-icon">${isPlaying ? '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>' : '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path>'}</svg>
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
          <button class="dtr-btn dtr-etc" data-tooltip="Plus d'options" data-id="${t.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
          <button class="dtr-btn dtr-plus" data-tooltip="Ajouter à une playlist" data-id="${t.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // ── FIX bugs 1 & 2 : délégation unique sur le container ──────────────
  // Remplace les listeners per-row qui s'accumulent à chaque _renderDetailTracks
  // et causaient : (a) clics bloqués par les dizaines de _syncDtrOverlays fantômes
  // qui reconstruisaient le DOM, (b) mauvaise piste lue car _setPlayContext
  // réinitialisait shuffleOrder juste avant playTrackAt.
  //
  // Stratégie : un seul listener 'click' posé sur le container (remplacé à chaque
  // render via _dtrClickHandler). Le contexte est mis à jour UNIQUEMENT si la
  // playlist rendue n'est pas déjà le contexte actif, ce qui préserve shuffleOrder.
  if (container._dtrClickHandler) {
    container.removeEventListener('click', container._dtrClickHandler);
  }
  container._dtrClickHandler = function _dtrClick(e) {
    // 1. Navigation artist/album
    const link = e.target.closest('.nav-link');
    if (link) { e.stopPropagation(); showDetailView(link.dataset.nav, link.dataset.name); return; }
    // 2. Boutons actions (etc, plus) → traités par leurs propres listeners
    if (e.target.closest('.dtr-btn')) return;

    // 3. Overlay play/pause
    const overlay = e.target.closest('.dtr-play-overlay');
    const row     = e.target.closest('.detail-track-row');
    if (!row) return;

    const trackId = row.dataset.id;
    let   idx      = trackId ? tracks.findIndex(t => t.id === trackId) : -1;
    // Même fallback que la vue album/artiste : la piste peut ne pas être
    // encore dans `tracks` pendant la sync complète en arrière-plan.
    if (idx === -1 && trackId) {
      const fallbackTrack = list.find(t => t.id === trackId);
      if (fallbackTrack) idx = _ensureTrackInLibrary(fallbackTrack);
    }
    if (idx === -1) return;

    // ── FIX bug 2 : ne changer le contexte que si ce n'est pas déjà la bonne playlist ──
    // Calculer les IDs du contexte rendu et comparer avec _playContextIds (stable).
    const listIds  = list.map(t => t.id).filter(Boolean);
    const ctxIds   = window._playContextIds || [];
    const sameCtx  = listIds.length > 0 &&
                     listIds.length === ctxIds.length &&
                     listIds.every(id => ctxIds.includes(id));
    if (!sameCtx) {
      // Contexte différent → mettre à jour
      const ctxI    = list.map(t => tracks.findIndex(tr => tr.id === t.id)).filter(i => i !== -1);
      const ctxName = document.querySelector('.detail-title')?.textContent || window._currentRpContextName || '';
      _setPlayContext(ctxI.length > 1 ? ctxI.map(i => tracks[i]?.id).filter(Boolean) : null);
      window._currentRpContextName = ctxName;
      const _ctxEl = document.getElementById('rpContextName');
      if (_ctxEl) _ctxEl.textContent = ctxName;
    }

    if (overlay) {
      // Overlay : toggle pause si piste déjà active, sinon lancer
      if (currentIndex === idx && !audioPlayer.paused) {
        audioPlayer.pause();
      } else {
        playTrackAt(idx);
      }
    } else {
      // Clic row entière
      playTrackAt(idx);
    }
  };
  container.addEventListener('click', container._dtrClickHandler);

  // Sync overlay icon on audio state changes
  // ── FIX bug 1 : _syncDtrOverlays n'écrit plus dans le DOM structurel,
  //               il met uniquement à jour l'attribut src des icônes existantes.
  //               Un seul listener reste actif à la fois grâce au remplacement ci-dessous.
  function _syncDtrOverlays() {
    const activeId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;
    container.querySelectorAll('.detail-track-row').forEach(row => {
      const isActive = row.dataset.id === activeId;
      const overlay  = row.querySelector('.dtr-play-overlay');
      const icon     = overlay?.querySelector('.dtr-overlay-icon');
      if (!overlay || !icon) return;
      if (isActive && !audioPlayer.paused) {
        icon.innerHTML = `<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>`;
      } else {
        icon.innerHTML = `<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path>`;
      }
    });
  }
  // Retirer l'ancien listener de l'instance précédente (ré-écoute même playlist)
  if (audioPlayer._syncDtrOverlays) {
    audioPlayer.removeEventListener('play',  audioPlayer._syncDtrOverlays);
    audioPlayer.removeEventListener('pause', audioPlayer._syncDtrOverlays);
  }
  audioPlayer._syncDtrOverlays = _syncDtrOverlays;
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

// Nettoyer les listeners audioPlayer liés à la vue détail avant toute réécriture de innerHTML.
// Sans cela, _syncDtrOverlays reste actif sur un container détaché du DOM.
function _cleanDetailView() {
  if (audioPlayer._syncDtrOverlays) {
    audioPlayer.removeEventListener('play',  audioPlayer._syncDtrOverlays);
    audioPlayer.removeEventListener('pause', audioPlayer._syncDtrOverlays);
    audioPlayer._syncDtrOverlays = null;
  }
}

function hideDetailView() {
  _cleanDetailView();
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
                ? `<img src="${al.imageUrl}" loading="lazy" decoding="async" alt="">`
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

async function showSearchResultsPage(query, pushHistory = true) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  const lc = q.toLowerCase();

  _hideAllMainPanels();
  searchResultsPage.style.display = 'flex';

  // ── Complétion à la demande ────────────────────────────────────
  // Même principe que le dropdown : si la synchro complète n'est pas
  // terminée, on interroge Jellyfin pour ce terme précis et on fusionne
  // avant de filtrer, pour ne pas dépendre d'avoir toute la bibliothèque
  // déjà en mémoire.
  if (!window._librarySyncComplete) {
    const serverTracks = await _searchTracksServer(q);
    if (serverTracks?.length) serverTracks.forEach(t => _ensureTrackInLibrary(t));
  }

  const finalMatched = tracks.filter(t =>
    t.title.toLowerCase().includes(lc) ||
    t.artist.toLowerCase().includes(lc) ||
    t.album.toLowerCase().includes(lc) ||
    (t.genre && t.genre.toLowerCase().includes(lc)) ||
    (Array.isArray(t.genres) && t.genres.some(g => g.toLowerCase().includes(lc)))
  );

  // Group results
  const artistMap = new Map();
  const albumMap  = new Map();
  const trackResults = finalMatched.slice(0, 50);

  finalMatched.forEach(t => {
    if (!artistMap.has(t.artist))
      artistMap.set(t.artist, { name: t.artist, imageUrl: t.imageUrl, count: tracks.filter(x => x.artist === t.artist).length });
    if (!albumMap.has(t.album))
      albumMap.set(t.album, { name: t.album, artist: t.artist, imageUrl: t.imageUrl });
  });

  const artists = [...artistMap.values()].slice(0, 6);
  const albums  = [...albumMap.values()].slice(0, 6);

  // ── Recherche Firestore async (utilisateurs + playlists publiques) ──
  let usersResults    = [];
  let publicPlaylists = [];
  try {
    if (window.FirebaseSocial?.searchUser) {
      usersResults = (await window.FirebaseSocial.searchUser(q)) || [];
    }
    // Charger les playlists publiques de chaque utilisateur trouvé
    const db = window.FirebaseConfig?.getDB();
    if (db && usersResults.length) {
      const userDocs = await Promise.allSettled(
        usersResults.map(u => db.collection('users').doc(u.docId).get())
      );
      userDocs.forEach((res, i) => {
        if (res.status !== 'fulfilled' || !res.value.exists) return;
        const data = res.value.data();
        Object.entries(data?.playlists || {}).forEach(([id, pl]) => {
          if (!pl.name) return;
          const nameClean = pl.name.replace(/\s*\(par [^)]+\)\s*$/, '').trim();
          if (nameClean.toLowerCase().includes(lc) || usersResults[i]?.name?.toLowerCase().includes(lc)) {
            publicPlaylists.push({
              id,
              name: nameClean,
              trackCount: pl.tracks?.length || 0,
              coverUrl: pl.tracks?.find?.(t => t.imageUrl)?.imageUrl || null,
              ownerName: usersResults[i]?.name || '',
              ownerDocId: usersResults[i]?.docId || '',
              ownerPicture: usersResults[i]?.picture || '',
              tracks: pl.tracks || []
            });
          }
        });
      });
    }
    // Chercher aussi parmi les playlists partagées (collection sharedPlaylists)
    if (db) {
      try {
        const shared = await db.collection('sharedPlaylists')
          .orderBy('name').limit(20).get();
        shared.forEach(doc => {
          const d = doc.data();
          const nameClean = (d.name||'').replace(/\s*\(par [^)]+\)\s*$/, '').trim();
          if (nameClean.toLowerCase().includes(lc) || d.sharedByName?.toLowerCase().includes(lc)) {
            if (!publicPlaylists.find(p => p.id === doc.id)) {
              publicPlaylists.push({
                id: doc.id,
                name: nameClean,
                trackCount: d.tracks?.length || 0,
                coverUrl: d.tracks?.find?.(t => t.imageUrl)?.imageUrl || null,
                ownerName: d.sharedByName || '',
                ownerDocId: d.sharedByDocId || '',
                ownerPicture: '',
                tracks: d.tracks || [],
                isShared: true
              });
            }
          }
        });
      } catch(_) {}
    }
  } catch(e) { console.warn('[Search] Firebase error:', e); }

  // ── HTML des sections utilisateurs ──
  function _userAvatarGrad(name) {
    const h = [...(name||'?')].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
    return `linear-gradient(135deg,hsl(${h},55%,35%),hsl(${(h+60)%360},55%,25%))`;
  }
  const usersHtml = usersResults.length ? `
    <div class="srp-section">
      <h2 class="srp-section-title">Utilisateurs <span class="srp-badge">${usersResults.length}</span></h2>
      <div class="srp-users-grid">
        ${usersResults.map(u => `
          <div class="srp-user-card" data-docid="${escapeHtml(u.docId)}">
            <div class="srp-user-avatar" style="background:${u.picture?'var(--bg-tinted)':_userAvatarGrad(u.name)}">
              ${u.picture ? `<img src="${escapeHtml(u.picture)}" loading="lazy" decoding="async" alt="">` : `<span class="srp-user-letter">${escapeHtml((u.name||'?')[0].toUpperCase())}</span>`}
            </div>
            <div class="srp-user-name">${highlightMatch(u.name||'', lc)}</div>
            <div class="srp-user-sub">Utilisateur Beartify</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── HTML des sections playlists publiques ──
  // Reprend la même structure home-card que les playlists du profil utilisateur
  function _srpPlCover(pl){
    if(pl.coverUrl)return`<img src="${escapeHtml(pl.coverUrl)}" loading="lazy" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
    const imgs=(pl.tracks||[]).map(t=>t.imageUrl).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,4);
    if(imgs.length>=4)return`<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%">${imgs.map(u=>`<img src="${escapeHtml(u)}" loading="lazy" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`).join('')}</div>`;
    if(imgs.length>=1)return`<img src="${escapeHtml(imgs[0])}" loading="lazy" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
    return`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;background:rgba(255,255,255,.06)">🎵</div>`;
  }
  const publicPlHtml = publicPlaylists.length ? `
    <div class="srp-section">
      <h2 class="srp-section-title">Playlists <span class="srp-badge">${publicPlaylists.length}</span></h2>
      <div class="home-row" style="display:flex;flex-wrap:wrap;gap:12px;padding:4px 0">
        ${publicPlaylists.slice(0,12).map(pl => `
          <div class="home-card srp-playlist-card" data-plid="${escapeHtml(pl.id)}" data-owner="${escapeHtml(pl.ownerDocId)}" style="cursor:pointer">
            <div class="home-card-art">
              ${_srpPlCover(pl)}
              <div class="home-card-hover-btn">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
            <div class="home-card-name" title="${escapeHtml(pl.name)}">${highlightMatch(pl.name, lc)}</div>
            <div class="home-card-sub">${pl.trackCount} titre${pl.trackCount>1?'s':''} · ${escapeHtml(pl.ownerName)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  searchResultsPage.innerHTML = `
    <div class="srp-header">
      <h1 class="srp-title">Résultats pour <span class="srp-query">« ${escapeHtml(q)} »</span></h1>
      <div class="srp-count">
        ${finalMatched.length} titre${finalMatched.length !== 1 ? 's' : ''}
        · ${artists.length} artiste${artists.length !== 1 ? 's' : ''}
        · ${albums.length} album${albums.length !== 1 ? 's' : ''}
        ${usersResults.length ? `· ${usersResults.length} utilisateur${usersResults.length!==1?'s':''}` : ''}
        ${publicPlaylists.length ? `· ${publicPlaylists.length} playlist${publicPlaylists.length!==1?'s':''}` : ''}
      </div>
    </div>

    ${usersHtml}

    ${artists.length ? `
    <div class="srp-section">
      <h2 class="srp-section-title">Artistes</h2>
      <div class="srp-artists-grid">
        ${artists.map(a => `
          <div class="srp-artist-card" data-artist="${escapeHtml(a.name)}">
            <div class="srp-artist-avatar" style="background:${a.imageUrl ? 'var(--bg-tinted)' : artistGradient(a.name)}">
              ${a.imageUrl ? `<img src="${a.imageUrl}" loading="lazy" decoding="async" alt="">` : `<span class="srp-artist-letter">${escapeHtml(a.name.charAt(0).toUpperCase())}</span>`}
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
              ${al.imageUrl ? `<img src="${al.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div class="srp-art-placeholder">💿</div>`}
              <div class="srp-card-play-btn"></div>
            </div>
            <div class="srp-album-title">${highlightMatch(al.name, lc)}</div>
            <div class="srp-album-sub">${escapeHtml(al.artist)}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${publicPlHtml}

    <div class="srp-section">
      <h2 class="srp-section-title">Titres <span class="srp-badge">${trackResults.length}${finalMatched.length > 50 ? '+' : ''}</span></h2>
      <div class="srp-tracks-header">
        <span class="srp-th-num">#</span>
        <span class="srp-th-title">Titre</span>
        <span class="srp-th-album">Album</span>
        <span class="srp-th-dur">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" style="opacity:0.5;flex-shrink:0"><path d="M15 15H1v-1.5h14zm0-4.5H1V9h14zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5m2.5-1a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2z"/></svg>
        </span>
      </div>
      <div class="srp-tracks-list">
        ${trackResults.map((t, i) => `
          <div class="srp-track-row" data-id="${t.id}" data-idx="${tracks.indexOf(t)}">
            <span class="srp-tr-num">${i + 1}</span>
            <div class="srp-tr-art">
              ${t.imageUrl ? `<img src="${t.imageUrl}" loading="lazy" decoding="async" alt="">` : `<div class="srp-art-mini">🎵</div>`}
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

  // ── Listeners ───────────────────────────────────────────────────
  // Utilisateurs → ouvrir profil dans le friends panel
  searchResultsPage.querySelectorAll('.srp-user-card').forEach(el => {
    el.addEventListener('click', () => {
      const docId  = el.dataset.docid;
      const name   = el.querySelector('.srp-user-name')?.textContent || '';
      const picture = el.querySelector('img')?.src || '';
      const friendObj = { docId, name, picture, presence: null };
      if (window._showFriendsActivity) {
        // Ouvrir le panel si pas déjà ouvert
        const fp = document.getElementById('friendsPanel');
        if (fp && !fp.classList.contains('open')) window._showFriendsActivity();
        // Attendre que le panel soit monté puis ouvrir le profil
        setTimeout(() => window._openFriendProfile?.(friendObj), 100);
      }
    });
  });

  // Playlists publiques → jouer les titres matchés en local sans toucher à la bibliothèque
  searchResultsPage.querySelectorAll('.srp-playlist-card').forEach(el => {
    el.addEventListener('click', () => {
      const plId  = el.dataset.plid;
      const pl    = publicPlaylists.find(p => p.id === plId);
      if (!pl) return;
      // Matcher les titres de la playlist avec la bibliothèque locale PAR ID ou titre+artiste
      const matched = (pl.tracks || [])
        .map(pt => tracks.find(t => t.id === (pt.id || pt))
          || tracks.find(t => t.title?.toLowerCase() === pt.title?.toLowerCase()
                           && t.artist?.toLowerCase() === pt.artist?.toLowerCase()))
        .filter(Boolean);
      if (!matched.length) {
        // Afficher profil du propriétaire
        if (pl.ownerDocId && window._showFriendsActivity) {
          const fp = document.getElementById('friendsPanel');
          if (fp && !fp.classList.contains('open')) window._showFriendsActivity();
          setTimeout(() => window._openFriendProfile?.({ docId: pl.ownerDocId, name: pl.ownerName, picture: pl.ownerPicture, presence: null }), 100);
        }
        showToast('Aucun titre de cette playlist dans votre bibliothèque.', 'info');
        return;
      }
      // Construire un contexte de lecture temporaire (indices dans tracks[])
      const ctxIndices = matched.map(t => tracks.indexOf(t)).filter(i => i !== -1);
      if (!ctxIndices.length) return;
      _setPlayContext(ctxIndices, pl.name);
      currentIndex = ctxIndices[0];
      playCurrentTrack();
      showToast(`▶ ${pl.name} (${matched.length} titre${matched.length > 1 ? 's' : ''})`, 'info');
    });
  });

  // Artist cards
  searchResultsPage.querySelectorAll('.srp-artist-card').forEach(el => {
    el.addEventListener('click', () => showDetailView('artist', el.dataset.artist));
  });
  // Album cards
  searchResultsPage.querySelectorAll('.srp-album-card').forEach(el => {
    el.addEventListener('click', () => showDetailView('album', el.dataset.album));
  });
  // Track rows — FIX: resolve fresh index from stable data-id at click time (data-idx is stale)
  searchResultsPage.querySelectorAll('.srp-track-row').forEach(el => {
    el.addEventListener('click', (e) => {
      const link = e.target.closest('.nav-link');
      if (link) { e.stopPropagation(); showDetailView(link.dataset.nav, link.dataset.name); return; }
      const trackId = el.dataset.id;
      const idx = trackId ? tracks.findIndex(t => t.id === trackId) : -1;
      if (idx !== -1) { playTrackAt(idx); }
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
                  <div class="info-similar-art">${localMatch?.imageUrl ? `<img src="${localMatch.imageUrl}" alt="" loading="lazy" decoding="async">` : '🎵'}</div>
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
          if (idx !== -1) { playTrackAt(idx); }
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

// ── Purger les playlists d'amis qui auraient pollué customPlaylists ──
(function _purgeFriendPlaylists() {
  if (!window.customPlaylists) return;
  Object.keys(window.customPlaylists).forEach(k => {
    const pl = window.customPlaylists[k];
    if (pl?._isFriendPlaylist || k.startsWith('friend_')) {
      delete window.customPlaylists[k];
    }
  });
})();

// ── Tooltip engine (fixed-position, escapes overflow:hidden) ────────
(function _initTooltips() {
  let _tip = null;
  let _hideTimer = null;

  function _show(el) {
    const text = el.dataset.tooltip;
    if (!text) return;
    clearTimeout(_hideTimer);
    if (!_tip) {
      _tip = document.createElement('div');
      _tip.id = 'beartifyTooltip';
      document.body.appendChild(_tip);
    }
    _tip.textContent = text;
    _tip.style.animation = 'none';
    // Forcer reflow pour re-déclencher l'animation
    void _tip.offsetHeight;
    _tip.style.animation = '';

    const rect = el.getBoundingClientRect();
    const tipW = _tip.offsetWidth || 120;
    const tipH = _tip.offsetHeight || 28;
    let x = rect.left + rect.width / 2;
    // Toujours AU-DESSUS du bouton avec un gap de 10px
    let y = rect.top - tipH - 10;
    // Si pas assez de place en haut → en dessous
    if (y < 6) y = rect.bottom + 10;
    // Garder dans le viewport horizontalement
    x = Math.max(tipW / 2 + 8, Math.min(x, window.innerWidth - tipW / 2 - 8));
    _tip.style.left = x + 'px';
    _tip.style.top  = y + 'px';
    _tip.style.display = 'block';
  }

  function _hide() {
    _hideTimer = setTimeout(() => {
      if (_tip) _tip.style.display = 'none';
    }, 60);
  }

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tooltip]');
    if (el) _show(el);
  }, { passive: true });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest('[data-tooltip]');
    if (el) _hide();
  }, { passive: true });

  // Hide on scroll or click
  document.addEventListener('click',  _hide, { passive: true });
  document.addEventListener('scroll', _hide, { passive: true, capture: true });
})();

// ── Nav-link-inline click delegation (player bar + right panel) ─────
document.addEventListener('click', e => {
  const link = e.target.closest('.nav-link-inline');
  if (!link) return;
  e.stopPropagation();
  showDetailView(link.dataset.nav, link.dataset.name);
});

// ── Cover zoom au clic — uniquement sur les covers dédiées, PAS les cards navigables ─
document.addEventListener('click', e => {
  // Exclure les home-cards (navigation) et les items sidebar/SRP (navigation)
  if (e.target.closest('.home-card, .srp-playlist-card, .srp-album-card, .lib-custom-playlist-row, .sidebar-playlist-hint, .quick-tile')) return;

  const zoomable = e.target.closest('#detailCoverWrap, #albumArtLarge, #playerThumb, .player-album-thumb');
  if (!zoomable) return;
  const img = zoomable.querySelector('img') || (zoomable.tagName === 'IMG' ? zoomable : null);
  if (!img || !img.src || img.src.includes('default-cover')) return;
  // ⚠️ Ne JAMAIS réutiliser img.src tel quel : c'est la vignette déjà
  // affichée (souvent 300px, parfois moins), donc floue une fois agrandie.
  // On reconstruit une URL haute résolution à partir de la même base,
  // peu importe la taille de la vignette qui a déclenché le zoom.
  const hiResSrc = /[?&]width=\d+/.test(img.src)
    ? img.src.replace(/([?&])width=\d+/, `$1width=${IMG_SIZE_ZOOM}`)
    : img.src;
  _openCoverZoom(hiResSrc, img.alt || '');
});

function _openCoverZoom(src, alt) {
  const existing = document.getElementById('coverZoomOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'coverZoomOverlay';
  overlay.innerHTML = `
    <div class="cover-zoom-backdrop"></div>
    <div class="cover-zoom-content">
      <img src="${src}" alt="${escapeHtml(alt)}" class="cover-zoom-img" decoding="async">
      <button class="cover-zoom-close" data-tooltip="Fermer">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Fermer
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('cover-zoom-open'));

  function closeZoom() {
    overlay.classList.remove('cover-zoom-open');
    setTimeout(() => overlay.remove(), 220);
  }
  overlay.querySelector('.cover-zoom-backdrop').addEventListener('click', closeZoom);
  overlay.querySelector('.cover-zoom-close').addEventListener('click', closeZoom);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { closeZoom(); document.removeEventListener('keydown', escClose); }
  });
}

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
  // Power User - nouveaux raccourcis
  { section: 'Power User', label: 'Palette de commandes',   code: 'KeyK',       display: [['Ctrl', _keyLabel('KeyK')], ['⌘', _keyLabel('KeyK')]] },
  { section: 'Power User', label: 'Centrer sur la piste en cours', code: 'KeyC', display: [[_keyLabel('KeyC')]] },
  { section: 'Power User', label: 'Ajouter à une playlist',  code: 'ShiftL',     display: [['Maj', _keyLabel('KeyL')]] },
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
window._SHORTCUTS = _SHORTCUTS; // exposé pour onboarding.js (liste complète et toujours synchronisée)

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
      case 'KeyL': { // Shift+L : Ajouter à une playlist
        e.preventDefault();
        document.getElementById('miniEtc')?.click();
        return;
      }
      case 'KeyP': { // Shift+P : Ajouter à une playlist (via popup)
        e.preventDefault();
        if (typeof currentIndex !== 'undefined' && currentIndex >= 0 && typeof tracks !== 'undefined') {
          const track = tracks[currentIndex];
          if (track && typeof showAddToPlaylistPopup === 'function') {
            const btn = document.getElementById('miniEtc') || document.getElementById('playPauseBtn');
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

  // ── Raccourcis lettre - basés sur e.code (touche physique) ───
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
//  COMMAND PALETTE - Ctrl+K / ⌘+K
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
    { type: 'action', icon: '➕', label: 'Ajouter à une playlist',    fn: () => document.getElementById('miniEtc')?.click() },
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

    const q = query.trim();
    const stillChecking = q && !window._librarySyncComplete;

    if (!currentResults.length) {
      list.innerHTML = stillChecking
        ? `<div class="cp-empty"><div class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px"></div>Recherche en cours…</div>`
        : `<div class="cp-empty">Aucun résultat pour « ${escapeHtml(query)} »</div>`;
      if (!stillChecking) return;
      // On continue quand même vers la vérification serveur ci-dessous
      // (currentResults vide ne doit pas empêcher de chercher côté Jellyfin)
    } else {
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

    // ── Complétion à la demande (même principe que la recherche) ────
    if (stillChecking) {
      _searchTracksServer(q).then(serverTracks => {
        const input = overlay.querySelector('#cmdPaletteInput');
        if (input?.value.trim() !== q) return; // la requête a changé entre-temps
        if (!serverTracks?.length) {
          // Rien trouvé côté serveur non plus : afficher le vrai "aucun résultat"
          // maintenant qu'on est sûr, au lieu de laisser le spinner tourner.
          if (!currentResults.length) {
            list.innerHTML = `<div class="cp-empty">Aucun résultat pour « ${escapeHtml(query)} »</div>`;
          }
          return;
        }
        const before = tracks.length;
        serverTracks.forEach(t => _ensureTrackInLibrary(t));
        if (tracks.length > before) renderResults(q); // re-rend avec le set enrichi
      });
    }
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

renderHomeSkeleton();
fetchTracks();
initSearchDropdown();
spicyAnimationLoop(); // Start SpicyLyrics animation loop
initSpicyBackground(); // Initialise le fond global SpicyLyrics

window.addEventListener('resize', () => {
  if (currentIndex >= 0) setTimeout(refreshAllMarquees, 60);
});
// ══════════════════════════════════════════════════════════════════
//  AUTHENTIFICATION - portée depuis Grizzly Stream (main.js v5.1)
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
  _refreshVipUI();
}

// ── Met à jour tous les éléments UI liés au statut VIP ──────────────
// (bouton du dropdown profil + couronne à côté du pseudo)
function _refreshVipUI() {
  const isVip   = _isVipUser();
  const vipBtn  = document.getElementById('pdVipBtn');
  const pdName  = document.getElementById('pdName');

  if (vipBtn) {
    if (isVip) {
      vipBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:rgba(255,200,60,0.95)"><path d="M20 6 9 17l-5-5"/></svg>
        Vous êtes VIP
      `;
      vipBtn.classList.add('pd-vip-active');
      vipBtn.disabled = true;
      vipBtn.style.cursor = 'default';
    } else {
      vipBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 246.989 246.989" fill="currentColor" style="flex-shrink:0;opacity:.7"><path d="M246.038,83.955l-39.424-70.664c-1.325-2.374-3.831-3.846-6.55-3.846H46.93c-2.719,0-5.225,1.471-6.55,3.846L0.951,83.955c-1.497,2.683-1.206,6.008,0.734,8.391l116.002,142.432c0.037,0.046,0.08,0.085,0.118,0.13c0.12,0.141,0.244,0.278,0.375,0.41c0.015,0.015,0.028,0.033,0.043,0.048c0.034,0.033,0.069,0.064,0.104,0.096c0.012,0.012,0.025,0.021,0.037,0.033c0.133,0.125,0.27,0.245,0.412,0.361c0.065,0.053,0.131,0.106,0.198,0.157c0.145,0.11,0.295,0.213,0.448,0.313c0.072,0.047,0.143,0.094,0.216,0.139c0.129,0.077,0.263,0.148,0.397,0.219c0.055,0.028,0.108,0.059,0.164,0.086c0.051,0.025,0.101,0.05,0.152,0.074c0.149,0.069,0.303,0.128,0.459,0.188c0.097,0.038,0.192,0.079,0.291,0.113c0.019,0.006,0.035,0.015,0.054,0.021c0.007,0.002,0.014,0.003,0.021,0.005c0.066,0.022,0.137,0.034,0.205,0.054c0.253,0.075,0.51,0.136,0.77,0.184c0.108,0.02,0.215,0.04,0.324,0.055c0.309,0.043,0.622,0.07,0.938,0.074c0.029,0,0.058,0.007,0.088,0.007h0.001h0.001c0.03,0,0.059-0.007,0.088-0.007c0.317-0.004,0.63-0.031,0.939-0.074c0.108-0.015,0.214-0.035,0.321-0.054c0.263-0.048,0.522-0.11,0.776-0.186c0.065-0.019,0.133-0.031,0.198-0.052c0.008-0.003,0.016-0.003,0.023-0.006c0.02-0.006,0.036-0.015,0.055-0.022c0.098-0.033,0.191-0.074,0.287-0.11c0.156-0.06,0.312-0.12,0.462-0.189c0.052-0.024,0.104-0.05,0.155-0.075c0.053-0.026,0.104-0.056,0.155-0.082c0.136-0.071,0.271-0.143,0.401-0.221c0.074-0.045,0.146-0.093,0.22-0.141c0.152-0.099,0.302-0.202,0.444-0.311c0.068-0.051,0.134-0.104,0.199-0.158c0.144-0.116,0.281-0.237,0.414-0.362c0.013-0.013,0.027-0.023,0.04-0.035c0.03-0.029,0.062-0.056,0.092-0.086c0.017-0.017,0.032-0.036,0.049-0.053c0.134-0.135,0.261-0.276,0.383-0.42c0.036-0.042,0.076-0.079,0.111-0.122L245.304,92.346C247.244,89.963,247.535,86.638,246.038,83.955z M138.3,24.446l21.242,55.664H87.457l21.249-55.664H138.3z M160.065,95.11l-36.563,110.967L86.935,95.11H160.065z M71.142,95.11l32.524,98.699L23.282,95.11H71.142z M175.858,95.11h47.851l-80.37,98.696L175.858,95.11z M226.715,80.11h-51.118l-21.242-55.664h41.306L226.715,80.11z M51.333,24.446h41.317L71.402,80.11H20.274L51.333,24.446z"/></svg>
        Devenir VIP
      `;
      vipBtn.classList.remove('pd-vip-active');
      vipBtn.disabled = false;
      vipBtn.style.cursor = 'pointer';
    }
  }

  // Couronne à côté du pseudo sur la page profil / dropdown
  if (pdName) {
    let crown = pdName.querySelector('.pd-vip-crown');
    if (isVip && !crown) {
      crown = document.createElement('svg');
      crown.setAttribute('class', 'pd-vip-crown');
      crown.setAttribute('width', '14');
      crown.setAttribute('height', '14');
      crown.setAttribute('viewBox', '0 0 24 24');
      crown.setAttribute('fill', 'rgba(255,200,60,0.95)');
      crown.innerHTML = '<path d="M5 19h14v2H5zM5 8l3.5 4L12 5l3.5 7L19 8l1 9H4l1-9z"/>';
      pdName.appendChild(crown);
    } else if (!isVip && crown) {
      crown.remove();
    }
  }

  // Couronne sur la page de profil utilisateur (userProfileView) si présente
  const upvName = document.getElementById('upvDisplayName');
  if (upvName) {
    let crown2 = upvName.querySelector('.pd-vip-crown');
    if (isVip && !crown2) {
      crown2 = document.createElement('svg');
      crown2.setAttribute('class', 'pd-vip-crown');
      crown2.setAttribute('width', '15');
      crown2.setAttribute('height', '15');
      crown2.setAttribute('viewBox', '0 0 24 24');
      crown2.setAttribute('fill', 'rgba(255,200,60,0.95)');
      crown2.innerHTML = '<path d="M5 19h14v2H5zM5 8l3.5 4L12 5l3.5 7L19 8l1 9H4l1-9z"/>';
      upvName.appendChild(crown2);
    } else if (!isVip && crown2) {
      crown2.remove();
    }
  }
}
window._refreshVipUI = _refreshVipUI;
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
    avatarEl.innerHTML = `<svg id="topProfileChevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`;
  }
  if (btnProf) btnProf.classList.remove('connected');
  const pdAvatar   = document.getElementById('pdAvatar');
  const pdName     = document.getElementById('pdName');
  const pdEmail    = document.getElementById('pdEmail');
  const pdProvider = document.getElementById('pdProvider');
  if (pdAvatar)    pdAvatar.innerHTML     = '';
  if (pdName)      pdName.textContent     = '-';
  if (pdEmail)     pdEmail.textContent    = '-';
  if (pdProvider)  pdProvider.textContent = '-';
}

// ── Google Sign-In ──
// ── Google Sign-In via Firebase Auth ─────────────────────────────
// Le popup est géré nativement par Firebase Auth (firebase-config.js → firebaseSignInWithGoogle).
// onAuthStateChanged appelle window.applyUserToUI automatiquement après connexion réussie.
async function triggerGoogleLogin() {
  const user = await window.firebaseSignInWithGoogle?.();
  if (!user) {
    // Popup fermé ou erreur - retirer le spinner du bouton
    document.getElementById('authGoogleBtn')?.classList.remove('loading');
  }
  // Si user != null, onAuthStateChanged dans firebase-config.js met l'UI à jour
}

// ── Discord OAuth2 ──
/**
 * Construit l'URL d'autorisation Discord OAuth2 pour le NAVIGATEUR WEB uniquement.
 *
 * En navigateur, window.location.origin est l'origine HTTPS de la page,
 * donc Discord peut rediriger directement vers la WebView.
 *
 * En Tauri, cette fonction N'est PAS utilisée pour le redirect.
 * → voir window._authDiscord : on passe par
 *   DISCORD_TAURI_REDIRECT (page HTTPS intermédiaire sur beartify.duckdns.org)
 *   qui renvoie ensuite un deep link beartify://auth?access_token=...
 *   intercepté par Tauri via tauri_plugin_deep_link.
 */
function buildDiscordURL() {
  const redirect = window.location.origin
    + window.location.pathname.split('#')[0].split('?')[0];
  return `https://discord.com/api/oauth2/authorize`
    + `?client_id=${DISCORD_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(redirect)}`
    + `&response_type=token`
    + `&scope=identify`;
}

// ── URL de callback Discord pour Tauri ────────────────────────────────────────
/**
 * Page HTML intermédiaire hébergée sur votre serveur HTTPS.
 * Discord l'accepte comme redirect_uri car c'est une URL HTTPS publique
 * (contrairement à tauri:// ou https://tauri.localhost qui sont refusées).
 *
 * Cette page lit le #access_token dans le fragment (impossible côté serveur)
 * et fire le deep link  beartify://auth?access_token=...
 * que Tauri intercepte via onOpenUrl() dans initAuth().
 *
 * ⚠️ Assurez-vous d'avoir déployé discord-callback.html à cette URL
 *    et d'avoir ajouté cette URL dans Discord Developer Portal → OAuth2 → Redirects.
 */
const DISCORD_TAURI_REDIRECT = 'https://beartify.duckdns.org/discord-callback.html';

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

    // Discord n'est pas géré par Firebase Auth - on sauvegarde la session localement
    applyUserToUI(user);

    // ── Pont vers PocketBase (silencieux si indisponible — le mode secours
    //    Firebase Native continue de fonctionner sans cette session PB) ──
    try {
      await window.PocketBaseAuthBridge?.loginWithDiscord(token);
    } catch (e) {
      console.warn('[Auth] ⚠️ Session PocketBase non ouverte pour Discord (mode secours actif) :', e.message || e);
    }

    // ── Firebase Sync Discord : attendre que Firebase soit prêt puis sync ──
    const _startDiscordSync = async () => {
      const db = window.FirebaseConfig?.getDB();
      if (!db || !window.FirebaseSync?.syncToFirestore) {
        setTimeout(_startDiscordSync, 300);
        return;
      }
      // D'abord tenter de charger les données existantes
      await window.FirebaseSync.syncFromFirestore();
      // Vérifier le bannissement
      await _checkBanStatus();
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
            window.FirebaseSync.syncFromFirestore().then(() => _checkBanStatus?.());
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

  // ── 1. Callback Discord (navigateur uniquement) ──────────────────────────────
  // En navigateur, Discord redirige vers window.location.origin avec #access_token=...
  // → checkDiscordCallback() lit le token depuis le hash.
  //
  // En Tauri, le token n'arrive PAS via le hash de la WebView :
  // il transite par discord-callback.html → deep link beartify://auth?access_token=...
  // → onOpenUrl() ci-dessous → handleDiscordToken().
  // checkDiscordCallback() est donc ignoré en Tauri.
  const wasDiscordCallback = !window._IS_TAURI && checkDiscordCallback();

  // ── 2. Restaurer la session depuis localStorage ──────────────────────────────
  // Google/Firebase : onAuthStateChanged restaure automatiquement.
  // Discord         : restauré depuis localStorage (session locale).
  if (!wasDiscordCallback) restoreSessionFromCache();

  // ── 3. Listener deep link Discord (Tauri uniquement) ─────────────────────────
  //
  // Flux complet :
  //   window._authDiscord()
  //     → shell:open(Discord OAuth avec redirect=DISCORD_TAURI_REDIRECT)
  //   Navigateur système → Discord authentifie → discord-callback.html#access_token=TOKEN
  //   discord-callback.html
  //     → lit le fragment #access_token (fragment non transmis au serveur)
  //     → window.location.href = 'beartify://auth?access_token=TOKEN'
  //   Tauri deep-link plugin
  //     → onOpenUrl(['beartify://auth?access_token=TOKEN'])
  //   _handleBeartifyDeepLink(url)
  //     → handleDiscordToken(TOKEN) → applyUserToUI()  ✓
  //
  if (window._IS_TAURI) {
    // ⚠️ Pas de bundler (frontendDist: "../src") → import() avec des noms de packages npm
    //    ne fonctionne pas. On utilise window.__TAURI__ directement (disponible grâce à
    //    withGlobalTauri: true dans tauri.conf.json).
    //
    //    Équivalents sans bundler :
    //      onOpenUrl(cb)  →  __TAURI__.event.listen('deep-link://new-url', e => cb(e.payload))
    //      getCurrent()   →  __TAURI__.core.invoke('plugin:deep-link|get_current')

    // Listener : deep links reçus pendant que l'app tourne (warm start)
    window.__TAURI__.event.listen('deep-link://new-url', (event) => {
      const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
      for (const url of urls) _handleBeartifyDeepLink(url);
    }).catch((e) => {
      console.warn('[DeepLink] listen échoué :', e);
    });

    // Cold start : l'app a été lancée directement via le deep link
    window.__TAURI__.core.invoke('plugin:deep-link|get_current')
      .then((urls) => {
        if (!urls) return;
        const list = Array.isArray(urls) ? urls : [urls];
        for (const url of list) _handleBeartifyDeepLink(url);
      })
      .catch(() => { /* démarrage normal, pas via deep link */ });
  }

  // ── 4. Handlers exposés pour index.html ──────────────────────────────────────

  window._authGoogle = async () => {
    const btn = document.getElementById('authGoogleBtn');
    if (btn) btn.classList.add('loading');
    await triggerGoogleLogin();
    // Tauri : signInWithRedirect() a navigué hors de l'app → pas de retrait du spinner ici.
    // Navigateur : le popup se ferme seul, onAuthStateChanged retire le spinner.
  };

  window._authDiscord = () => {
    const btn = document.getElementById('authDiscordBtn');
    if (btn) btn.classList.add('loading');

    if (window._IS_TAURI) {
      // ── Tauri Desktop : ouvrir Discord dans le navigateur SYSTÈME ──────────
      //
      // Pourquoi le navigateur système et pas la WebView ?
      //   • Discord refuse tauri:// et https://tauri.localhost comme redirect_uri.
      //   • On redirige vers DISCORD_TAURI_REDIRECT (HTTPS public, accepté par Discord).
      //   • Cette page lit le #access_token et fire beartify://auth?access_token=...
      //   • Tauri intercepte via onOpenUrl() (listener ci-dessus).
      //
      // Prérequis dans discord.com/developers → OAuth2 → Redirects :
      //   https://beartify.duckdns.org/discord-callback.html
      //
      // Prérequis dans tauri.conf.json → plugins → deep-link → desktop → schemes :
      //   ["beartify"]
      const redirectUri = encodeURIComponent(DISCORD_TAURI_REDIRECT);
      const discordUrl  = `https://discord.com/api/oauth2/authorize`
        + `?client_id=${DISCORD_CLIENT_ID}`
        + `&redirect_uri=${redirectUri}`
        + `&response_type=token`
        + `&scope=identify`;

      // ⚠️ Pas de bundler → on ne peut pas faire import('@tauri-apps/plugin-shell').
      //    Équivalent direct : window.__TAURI__.core.invoke('plugin:shell|open', ...)
      window.__TAURI__.core.invoke('plugin:shell|open', { path: discordUrl, openWith: null })
        .catch((e) => {
          console.error('[Auth] shell:open Discord failed :', e);
          if (btn) btn.classList.remove('loading');
          showToast("Impossible d'ouvrir le navigateur.", 'error');
        });

      // Timeout de sécurité : retirer le spinner si l'utilisateur abandonne
      // (le deep link n'arrive jamais → pas d'appel à handleDiscordToken)
      setTimeout(() => { if (btn) btn.classList.remove('loading'); }, 120_000);

    } else {
      // ── Navigateur web : comportement original inchangé ──────────────────
      // Discord redirige vers window.location.origin avec #access_token=...
      // checkDiscordCallback() lit le token depuis le hash au rechargement.
      setTimeout(() => { window.location.href = buildDiscordURL(); }, 120);
    }
  };

  // ── 5. Bouton de déconnexion ──────────────────────────────────────────────
  document.getElementById('pdSignOut')?.addEventListener('click', logout);

  document.getElementById('pdProfile')?.addEventListener('click', () => {
    const myId = window.FirebaseSocial?.getMyDocId?.() || window.currentUser?.uid;
    if (!myId) return;
    document.getElementById('profileDropdown')?.classList.remove('open');
    showUserProfile(myId);
  });

  // ── 6. Correction nonces CSP WebView2 (Tauri uniquement) ─────────────────
  // WebView2 injecte des nonces dans le CSP → 'unsafe-inline' est neutralisé
  // → les onclick="..." des boutons dans index.html sont bloqués silencieusement.
  //
  // Pourquoi getElementById ne suffit pas :
  //   Les boutons d'auth sont souvent dans un modal créé dynamiquement (innerHTML,
  //   template, etc.) et n'existent pas encore quand initAuth() s'exécute.
  //   getElementById retourne null → ?.addEventListener() ne fait rien.
  //
  // Solution : délégation d'événements sur document.
  //   Le listener est posé UNE FOIS sur document (toujours présent) et filtre
  //   les clics par ID/classe, peu importe quand l'élément est ajouté au DOM.
  //   Les addEventListener JS échappent à la restriction CSP nonces.
  if (window._IS_TAURI) {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[id]') || e.target;
      const id = target.id || target.closest('[id]')?.id;
      if (id === 'authGoogleBtn')  { e.stopImmediatePropagation(); window._authGoogle?.();  }
      if (id === 'authDiscordBtn') { e.stopImmediatePropagation(); window._authDiscord?.(); }
    }, true); // capture: true → intercepte avant que le handler inline bloqué ne tente de s'exécuter
  }

  // ── Boutons Signaler / Demande d'ajout (profile dropdown) ───────
  document.getElementById('pdReportBtn')?.addEventListener('click', () => {
    document.getElementById('profileDropdown')?.classList.remove('open');
    _openReportModal();
  });
  document.getElementById('pdRequestBtn')?.addEventListener('click', () => {
    document.getElementById('profileDropdown')?.classList.remove('open');
    _openRequestModal();
  });
})();

// ════════════════════════════════════════════════════════════════════
//  MODAL — SIGNALER UN PROBLÈME
// ════════════════════════════════════════════════════════════════════
function _openReportModal() {
  document.getElementById('reportModal')?.remove();
  const m = document.createElement('div');
  m.id = 'reportModal';
  m.className = 'pl-edit-overlay';
  m.innerHTML = `
    <div class="pl-edit-modal" style="max-width:480px">
      <div class="pl-edit-header">
        <h2 class="pl-edit-title">Signaler un problème</h2>
        <button class="pl-edit-close" id="reportModalClose">✕</button>
      </div>
      <div class="pl-edit-body" style="flex-direction:column;gap:12px">
        <div class="report-type-grid">
          ${[
            { v:'bug',         l:'🐛 Bug / Crash'           },
            { v:'ui',          l:'🎨 Problème d\'affichage' },
            { v:'performance', l:'⚡ Lenteur / Performance'  },
            { v:'audio',       l:'🔊 Problème audio'         },
            { v:'sync',        l:'☁️ Synchronisation'        },
            { v:'autre',       l:'💬 Autre'                  },
          ].map(o => `<label class="report-type-chip"><input type="radio" name="rtype" value="${o.v}"><span>${o.l}</span></label>`).join('')}
        </div>
        <textarea id="reportDesc" class="pl-edit-textarea" placeholder="Décrivez le problème en détail…" rows="5" style="resize:vertical;min-height:100px"></textarea>
        <p style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin:0">Des informations techniques (navigateur, version, plateforme) seront jointes automatiquement.</p>
      </div>
      <div class="pl-edit-footer">
        <button class="pl-edit-save-btn" id="reportSubmit">Envoyer le rapport</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#reportModalClose').addEventListener('click', () => m.remove());
  m.querySelector('#reportSubmit').addEventListener('click', async () => {
    const type = m.querySelector('input[name="rtype"]:checked')?.value;
    const desc = m.querySelector('#reportDesc').value.trim();
    if (!type) { showToast('Sélectionnez un type de problème.', 'error'); return; }
    if (desc.length < 10) { showToast('Description trop courte (min. 10 caractères).', 'error'); return; }
    const btn = m.querySelector('#reportSubmit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    const ok = await window.FirebaseReports?.submitReport({ type, category: type, description: desc });
    if (ok) { showToast('Rapport envoyé, merci ! 🙏', 'success'); m.remove(); }
    else    { showToast('Erreur lors de l\'envoi.', 'error'); btn.disabled = false; btn.textContent = 'Envoyer le rapport'; }
  });
}

// ════════════════════════════════════════════════════════════════════
//  MODAL — DEMANDE D'AJOUT
// ════════════════════════════════════════════════════════════════════
function _openRequestModal() {
  document.getElementById('requestModal')?.remove();
  const m = document.createElement('div');
  m.id = 'requestModal';
  m.className = 'pl-edit-overlay';
  m.innerHTML = `
    <div class="pl-edit-modal" style="max-width:520px">
      <div class="pl-edit-header">
        <h2 class="pl-edit-title">Demande d'ajout</h2>
        <button class="pl-edit-close" id="requestModalClose">✕</button>
      </div>
      <div class="pl-edit-body" style="flex-direction:column;gap:12px">
        <div class="report-type-grid">
          ${[
            { v:'album',   l:'💿 Album'   },
            { v:'artiste', l:'🎤 Artiste' },
            { v:'titre',   l:'🎵 Titre'   },
          ].map(o => `<label class="report-type-chip"><input type="radio" name="reqtype" value="${o.v}"><span>${o.l}</span></label>`).join('')}
        </div>

        <!-- Recherche iTunes pour s'aiguiller -->
        <div class="req-search-wrap">
          <div style="display:flex;gap:8px">
            <input type="text" id="reqSearch" class="pl-edit-input" placeholder="🔍  Rechercher sur iTunes pour s'aiguiller…" style="flex:1">
            <button class="pl-edit-save-btn" id="reqSearchBtn" style="flex-shrink:0;padding:0 14px;font-size:0.8rem">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>
            </button>
          </div>
          <div id="reqSearchResults" style="display:none"></div>
        </div>

        <input type="text" id="reqName"   class="pl-edit-input" placeholder="Nom de l'album / artiste / titre *">
        <input type="text" id="reqArtist" class="pl-edit-input" placeholder="Artiste (si album ou titre)">
        <textarea id="reqInfo" class="pl-edit-textarea" placeholder="Informations supplémentaires, liens…" rows="3" style="resize:vertical"></textarea>
      </div>
      <div class="pl-edit-footer">
        <button class="pl-edit-save-btn" id="requestSubmit">Envoyer la demande</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#requestModalClose').addEventListener('click', () => m.remove());

  // ── iTunes Search API ──────────────────────────────────────────
  const reqSearch = m.querySelector('#reqSearch');
  const reqSearchBtn = m.querySelector('#reqSearchBtn');
  const reqSearchResults = m.querySelector('#reqSearchResults');
  const reqName   = m.querySelector('#reqName');
  const reqArtist = m.querySelector('#reqArtist');

  async function _doItunesSearch() {
    const q = reqSearch.value.trim();
    if (!q) return;
    reqSearchBtn.disabled = true;
    reqSearchBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite;vertical-align:middle"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.23-4.17"/></svg>';
    reqSearchResults.style.display = 'block';
    reqSearchResults.innerHTML = '<div style="padding:12px;text-align:center;color:rgba(255,255,255,.4);font-size:.8rem">Recherche…</div>';
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=8&country=fr`;
      const res = await fetch(url);
      const data = await res.json();
      const items = data.results || [];
      if (!items.length) {
        reqSearchResults.innerHTML = '<div style="padding:12px;text-align:center;color:rgba(255,255,255,.4);font-size:.8rem">Aucun résultat</div>';
      } else {
        reqSearchResults.innerHTML = items.map((it, i) => `
          <div class="req-itunes-item" data-idx="${i}"
               data-name="${escapeHtml(it.wrapperType==='artist' ? it.artistName : it.collectionName||it.trackName||'')}"
               data-artist="${escapeHtml(it.artistName||'')}"
               data-type="${it.wrapperType==='artist' ? 'artiste' : it.wrapperType==='collection' ? 'album' : 'titre'}">
            <img src="${it.artworkUrl60||'pictures/default-cover.png'}" alt="" loading="lazy" decoding="async">
            <div class="req-itunes-meta">
              <div class="req-itunes-name">${escapeHtml(it.wrapperType==='artist' ? it.artistName : it.collectionName||it.trackName||'?')}</div>
              <div class="req-itunes-sub">${escapeHtml(it.artistName||'')}${it.primaryGenreName ? ` · ${escapeHtml(it.primaryGenreName)}` : ''}${it.releaseDate ? ` · ${it.releaseDate.slice(0,4)}` : ''}</div>
            </div>
            <span class="req-itunes-type">${it.wrapperType==='artist' ? '🎤' : it.wrapperType==='collection' ? '💿' : '🎵'}</span>
          </div>`).join('');
        // Click on result → auto-fill form
        reqSearchResults.querySelectorAll('.req-itunes-item').forEach(el => {
          el.addEventListener('click', () => {
            reqName.value   = el.dataset.name;
            reqArtist.value = el.dataset.artist;
            // Select the matching type radio
            const typeVal = el.dataset.type;
            const radio = m.querySelector(`input[name="reqtype"][value="${typeVal}"]`);
            if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
            // Visual feedback
            reqSearchResults.querySelectorAll('.req-itunes-item').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
          });
        });
      }
    } catch(e) {
      reqSearchResults.innerHTML = '<div style="padding:12px;text-align:center;color:rgba(255,255,255,.4);font-size:.8rem">Erreur de connexion iTunes</div>';
    }
    reqSearchBtn.disabled = false;
    reqSearchBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>';
  }

  reqSearchBtn.addEventListener('click', _doItunesSearch);
  reqSearch.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _doItunesSearch(); } });

  // ── Submit ─────────────────────────────────────────────────────
  m.querySelector('#requestSubmit').addEventListener('click', async () => {
    const type   = m.querySelector('input[name="reqtype"]:checked')?.value;
    const name   = reqName.value.trim();
    const artist = reqArtist.value.trim();
    const info   = m.querySelector('#reqInfo').value.trim();
    if (!type)           { showToast('Sélectionnez un type.', 'error'); return; }
    if (name.length < 2) { showToast('Nom requis.', 'error'); return; }
    const btn = m.querySelector('#requestSubmit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    const result = await window.FirebaseReports?.submitRequest({ type, name, artist, info });
    if (result === 'created')            { showToast('Demande envoyée ! 🎶', 'success'); m.remove(); }
    else if (result === 'voted')         { showToast('Vote ajouté à la demande existante ✓', 'success'); m.remove(); }
    else if (result === 'already_voted') { showToast('Vous avez déjà voté pour cette demande.', 'default'); m.remove(); }
    else { showToast('Erreur lors de l\'envoi.', 'error'); btn.disabled = false; btn.textContent = 'Envoyer la demande'; }
  });
}

// ── CSS des type-chips (injecté une seule fois) ─────────────────────
(function () {
  if (document.getElementById('reportChipStyle')) return;
  const s = document.createElement('style');
  s.id = 'reportChipStyle';
  s.textContent = `
.report-type-grid { display:flex;flex-wrap:wrap;gap:7px; }
.report-type-chip { cursor:pointer; }
.report-type-chip input { display:none; }
.report-type-chip span {
  display:inline-flex;align-items:center;gap:4px;
  padding:6px 12px;border-radius:20px;font-size:0.78rem;font-weight:500;
  background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.65);
  border:1px solid rgba(255,255,255,0.1);
  transition:background 0.15s,color 0.15s,border-color 0.15s;cursor:pointer;
}
.report-type-chip input:checked + span {
  background:rgba(29,185,84,0.2);color:#1db954;border-color:#1db954;
}`;
  document.head.appendChild(s);
})();

// ════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS PAGE
// ════════════════════════════════════════════════════════════════════
const _NOTIF_READ_KEY = 'beartify_notif_read_ts';

async function _renderNotificationsPage() {
  const page = document.getElementById('notificationsPage');
  if (!page) return;
  page.style.display = 'block';

  page.innerHTML = `
    <div style="max-width:720px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px">
        <h1 style="font-size:1.6rem;font-weight:800">Notifications</h1>
        <button id="notifMarkAllRead" style="background:none;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.78rem;font-family:inherit;transition:all .15s">
          Tout marquer comme lu
        </button>
      </div>
      <div id="notifContent"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.35)"><div style="font-size:2rem;margin-bottom:12px">🔔</div>Chargement…</div></div>
    </div>`;

  document.getElementById('notifMarkAllRead')?.addEventListener('click', () => {
    localStorage.setItem(_NOTIF_READ_KEY, Date.now().toString());
    document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    document.getElementById('notifBadge').style.display = 'none';
  });

  const lastRead = parseInt(localStorage.getItem(_NOTIF_READ_KEY) || '0');
  const content = document.getElementById('notifContent');
  if (!content) return;

  try {
    const notifs = [];

    // Demandes approuvées — vivent désormais dans PocketBase en priorité
    // (Firestore ne reçoit plus les nouvelles depuis la migration).
    try {
      const pb = window.PocketBaseConfig?.getClient();
      if (pb) {
        const approved = await pb.collection('requests').getFullList({ filter: 'status="approved"' });
        approved.forEach(d => {
          const ts = d.updated ? new Date(d.updated).getTime() : (d.created ? new Date(d.created).getTime() : 0);
          notifs.push({
            ts,
            icon:  d.type === 'album' ? '💿' : d.type === 'artiste' ? '🎤' : '🎵',
            title: `Demande approuvée — ${d.name}`,
            sub:   `La demande d'ajout ${d.type === 'album' ? 'de l\'album' : d.type === 'artiste' ? 'de l\'artiste' : 'du titre'} <strong>${_escHtml(d.name)}</strong>${d.artist ? ` par ${_escHtml(d.artist)}` : ''} a été approuvée.`,
            tag:   'approved',
          });
        });
      }
    } catch (e) { console.warn('[Notifs] demandes approuvées:', e.message); }

    // Nouveaux abonnés — "X a commencé à vous suivre"
    try {
      const followers = await window.FirebaseSocial?.getFollowers?.();
      (followers || []).forEach(f => {
        notifs.push({
          ts:    f.followedAt || 0,
          icon:  '👤',
          title: 'Nouvel abonné',
          sub:   `<strong>${_escHtml(f.name)}</strong> a commencé à vous suivre.`,
          tag:   'follow',
        });
      });
    } catch (e) { console.warn('[Notifs] nouveaux abonnés:', e.message); }

    // Trier par date décroissante
    notifs.sort((a, b) => b.ts - a.ts);

    // Notifications système statiques (nouvelles fonctionnalités, récap
    // mensuel, etc. — voir onboarding.js). `tag` et `action` sont
    // optionnels et permettent à l'émetteur de personnaliser l'affichage
    // et le comportement au clic (ex: ouvrir le récap du mois).
    const sysNotifs = (window._APP_CHANGELOG || []).map(entry => ({
      ts:     entry.ts || 0,
      icon:   entry.icon || '✨',
      title:  entry.title || 'Nouvelle fonctionnalité',
      sub:    entry.body  || '',
      tag:    entry.tag || 'feature',
      action: typeof entry.action === 'function' ? entry.action : null,
    }));

    const all = [...notifs, ...sysNotifs].sort((a,b) => b.ts - a.ts);
    let unreadCount = 0;

    if (!all.length) {
      content.innerHTML = `<div style="text-align:center;padding:60px;color:rgba(255,255,255,0.35)">
        <div style="font-size:2.5rem;margin-bottom:16px">🔔</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:6px">Aucune notification</div>
        <div style="font-size:0.82rem">Vous êtes à jour !</div>
      </div>`;
      return;
    }

    const tagLabels = { approved:'Approuvé', resolved:'Résolu', feature:'Nouveauté', info:'Info', follow:'Abonné', wrap:'Récap' };
    const tagColors = {
      approved:'rgba(29,185,84,.15);color:#1db954',
      resolved:'rgba(52,152,219,.15);color:#3498db',
      feature: 'rgba(155,89,182,.15);color:#9b59b6',
      info:    'rgba(255,255,255,.08);color:rgba(255,255,255,.5)',
      follow:  'rgba(255,193,7,.15);color:#ffc107',
      wrap:    'rgba(29,185,84,.15);color:#1db954',
    };

    // Construit des noeuds DOM (plutôt qu'une chaîne innerHTML) pour
    // pouvoir attacher un vrai listener de clic aux entrées qui ont une
    // `action` (ex: ouvrir le récap mensuel) sans dépendre d'attributs
    // inline fragiles.
    content.innerHTML = '';
    all.forEach(n => {
      const isUnread = n.ts > lastRead;
      if (isUnread) unreadCount++;
      const tagStyle = tagColors[n.tag] || tagColors.info;
      const dateStr  = n.ts ? new Date(n.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}) : '';
      const el = document.createElement('div');
      el.className = `notif-item${isUnread ? ' unread' : ''}`;
      if (n.action) el.style.cursor = 'pointer';
      el.innerHTML = `
        <div class="notif-icon">${n.icon}</div>
        <div class="notif-body">
          <div class="notif-title">${_escHtml(n.title)}</div>
          <div class="notif-sub">${n.sub}</div>
          ${dateStr ? `<div class="notif-date">${dateStr}</div>` : ''}
        </div>
        <span class="notif-tag" style="background:${tagStyle.split(';')[0].replace('background:','')};${tagStyle.includes(';') ? tagStyle.split(';')[1] : ''}">${tagLabels[n.tag] || n.tag}</span>
      `;
      if (n.action) {
        el.addEventListener('click', () => {
          localStorage.setItem(_NOTIF_READ_KEY, Date.now().toString());
          n.action();
        });
      }
      content.appendChild(el);
    });

    // Badge
    const badge = document.getElementById('notifBadge');
    if (badge) {
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

  } catch (e) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:rgba(255,255,255,.35)">Impossible de charger les notifications.<br><small>${e.message}</small></div>`;
  }
}

function _getNotifUserId() {
  const u = window._authUser, f = window._firebaseUser;
  if (u?.provider === 'discord' && u?.discordId) return u.discordId;
  if (f?.email) return f.email;
  return null;
}
function _escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Charger le badge de notifications au démarrage
async function _loadNotifBadge() {
  const lastRead = parseInt(localStorage.getItem(_NOTIF_READ_KEY) || '0');
  let count = 0;

  try {
    const pb = window.PocketBaseConfig?.getClient();
    if (pb) {
      const approved = await pb.collection('requests').getFullList({ filter: 'status="approved"' });
      count += approved.filter(d => {
        const ts = d.updated ? new Date(d.updated).getTime() : (d.created ? new Date(d.created).getTime() : 0);
        return ts > lastRead;
      }).length;
    }
  } catch {}

  try {
    const followers = await window.FirebaseSocial?.getFollowers?.();
    count += (followers || []).filter(f => (f.followedAt || 0) > lastRead).length;
  } catch {}

  const badge = document.getElementById('notifBadge');
  if (badge && count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  }
}
setTimeout(_loadNotifBadge, 4000);

// ════════════════════════════════════════════════════════════════════
//  SYSTÈME DE BANNISSEMENT
// ════════════════════════════════════════════════════════════════════
async function _checkBanStatus() {
  const db    = window.FirebaseConfig?.getDB?.();
  const docId = window._authUser?.discordId || window._firebaseUser?.email;
  if (!db || !docId) return;
  try {
    const banDoc = await db.collection('banned').doc(docId).get();
    if (!banDoc.exists) {
      // Vérifier aussi le champ banned dans le user document
      const userDoc = await db.collection('users').doc(docId).get();
      if (!userDoc.exists || !userDoc.data()?.banned) return;
    }
    const data   = banDoc.exists ? banDoc.data() : {};
    const reason = data.reason || '';
    _showBanScreen(reason);
  } catch(e) {
    console.warn('[Ban] Erreur vérification:', e);
  }
}

function _showBanScreen(reason) {
  // Masquer toute l'interface
  document.querySelector('.app-body')?.style.setProperty('display','none');
  document.querySelector('.top-bar')?.style.setProperty('display','none');
  document.querySelector('.player-bar')?.style.setProperty('display','none');

  const overlay = document.createElement('div');
  overlay.id = 'banScreen';
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:99999',
    'background:rgba(13,13,15,0.98)',
    'display:flex','align-items:center','justify-content:center',
    'flex-direction:column','gap:0',
    'font-family:inherit',
  ].join(';');

  overlay.innerHTML = `
    <div style="text-align:center;max-width:420px;padding:40px 32px">
      <div style="font-size:3.5rem;margin-bottom:20px">🚫</div>
      <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:10px;color:#e74c3c">Vous avez été banni</h1>
      <p style="color:rgba(255,255,255,.55);font-size:.88rem;line-height:1.6;margin-bottom:${reason ? '12px' : '28px'}">
        Votre accès à Beartify a été suspendu par un administrateur.
      </p>
      ${reason ? `
        <div style="background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.2);border-radius:10px;padding:12px 16px;margin-bottom:28px;text-align:left">
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(231,76,60,.7);margin-bottom:5px">Motif</div>
          <div style="font-size:.85rem;color:rgba(255,255,255,.75)">${escapeHtml(reason)}</div>
        </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px">
        <button id="banContestBtn" style="
          padding:12px 0;border-radius:10px;border:1.5px solid rgba(255,255,255,.2);
          background:none;color:#fff;font-weight:600;font-size:.9rem;cursor:pointer;
          transition:all .15s;font-family:inherit;
        ">
          ✉️ Contester le bannissement
        </button>
        <button id="banQuitBtn" style="
          padding:12px 0;border-radius:10px;border:none;
          background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);
          font-size:.88rem;cursor:pointer;font-family:inherit;
        ">
          Quitter
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Quitter : fermer la fenêtre Tauri ou rediriger
  document.getElementById('banQuitBtn').addEventListener('click', () => {
    if (window.__TAURI__?.window) {
      window.__TAURI__.window.getCurrent().close();
    } else {
      window.location.href = 'about:blank';
    }
  });

  // Contester : ouvrir un formulaire de contestation
  document.getElementById('banContestBtn').addEventListener('click', () => {
    document.getElementById('banContestForm')?.remove();
    const form = document.createElement('div');
    form.id = 'banContestForm';
    form.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center';
    form.innerHTML = `
      <div style="background:#18181c;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:28px;width:420px;max-width:90vw">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:14px">✉️ Contester le bannissement</h3>
        <p style="color:rgba(255,255,255,.45);font-size:.78rem;margin-bottom:14px">Expliquez pourquoi vous pensez que ce bannissement est injuste.</p>
        <textarea id="contestMsg" placeholder="Votre message…" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:10px;font-family:inherit;font-size:.82rem;resize:vertical;min-height:100px;outline:none;margin-bottom:14px"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('banContestForm').remove()" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:none;color:rgba(255,255,255,.5);cursor:pointer;font-family:inherit">Annuler</button>
          <button id="contestSendBtn" style="padding:8px 16px;border-radius:8px;border:none;background:#1db954;color:#000;font-weight:700;cursor:pointer;font-family:inherit">Envoyer</button>
        </div>
      </div>`;
    document.body.appendChild(form);
    form.addEventListener('click', e => { if(e.target===form) form.remove(); });
    document.getElementById('contestSendBtn').addEventListener('click', async () => {
      const msg  = document.getElementById('contestMsg')?.value.trim();
      if (!msg || msg.length < 10) { alert('Message trop court.'); return; }
      const btn = document.getElementById('contestSendBtn');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        const db    = window.FirebaseConfig?.getDB?.();
        const docId = window._authUser?.discordId || window._firebaseUser?.email || 'unknown';
        if (db) {
          await db.collection('banContests').doc(`${docId}_${Date.now()}`).set({
            userId:    docId,
            userName:  window._authUser?.displayName || window._authUser?.username || docId,
            message:   msg,
            createdAt: Date.now(),
            status:    'pending',
          });
        }
        form.innerHTML = `<div style="background:#18181c;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:40px;text-align:center">
          <div style="font-size:2rem;margin-bottom:12px">📬</div>
          <div style="font-weight:700;margin-bottom:6px">Contestation envoyée</div>
          <div style="color:rgba(255,255,255,.45);font-size:.82rem;margin-bottom:18px">Un administrateur examinera votre demande.</div>
          <button onclick="document.getElementById('banContestForm').remove()" style="padding:8px 18px;border-radius:8px;border:none;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-family:inherit">Fermer</button>
        </div>`;
      } catch(e) {
        alert('Erreur lors de l\'envoi : ' + e.message);
        btn.disabled = false; btn.textContent = 'Envoyer';
      }
    });
  });
}

// Lancer la vérification ban dès que Firebase est prêt (Google auth)
window._checkBanStatus = _checkBanStatus;
setTimeout(async () => {
  if (window._authUser || window._firebaseUser) await _checkBanStatus();
}, 3500);

// ── Suppression du bruit Tauri au démarrage ──────────────────────
// "No Listener: tabs:outgoing.message.ready" est une race condition connue
// du runtime Tauri (vendor.js) : un plugin IPC envoie un message avant que
// le listener natif ne soit enregistré. Ce n'est pas une erreur applicative.
window.addEventListener('unhandledrejection', event => {
  const msg = event.reason?.message || event.reason || '';
  if (typeof msg === 'string' && (
    msg.includes('No Listener') ||
    msg.includes('tabs:outgoing') ||
    msg.includes('message.ready')
  )) {
    event.preventDefault();
  }
});
window.addEventListener('error', event => {
  const msg = event.message || '';
  if (msg.includes('No Listener') || msg.includes('tabs:outgoing')) {
    event.preventDefault();
  }
});
/**
 * Parse un deep link beartify:// et exécute l'action correspondante.
 *
 * Schémas supportés :
 *   beartify://auth?access_token=TOKEN&...
 *     → connexion Discord (callback depuis discord-callback.html)
 *   beartify://google-auth?code=CODE&...
 *     → connexion Google  (Authorization Code + PKCE, redirect direct depuis Google)
 *
 * @param {string} url  URL complète du deep link
 */
function _handleBeartifyDeepLink(url) {
  if (!url || typeof url !== 'string') return;
  try {
    const u = new URL(url);

    // ── beartify://auth → callback Discord ───────────────────────────────
    if (u.protocol === 'beartify:' && u.host === 'auth') {
      const token = u.searchParams.get('access_token');
      if (token) {
        handleDiscordToken(token);
        document.getElementById('authDiscordBtn')?.classList.remove('loading');
      } else {
        console.warn('[DeepLink] beartify://auth reçu sans access_token');
        showToast('Erreur : token Discord manquant.', 'error');
        document.getElementById('authDiscordBtn')?.classList.remove('loading');
      }
      return;
    }

    // ── beartify://google-auth → callback Google (PKCE) ──────────────────
    // Google redirige ici directement avec ?code=CODE (pas de page intermédiaire).
    // firebase-config.js → firebaseHandleGoogleCode(code)
    //   → POST https://oauth2.googleapis.com/token (code + PKCE verifier)
    //   → signInWithCredential(GoogleAuthProvider.credential(idToken, accessToken))
    //   → onAuthStateChanged → applyUserToUI()
    if (u.protocol === 'beartify:' && u.host === 'google-auth') {
      const code  = u.searchParams.get('code');
      const error = u.searchParams.get('error');

      if (error) {
        console.warn('[DeepLink] Google OAuth annulé :', error);
        showToast('Connexion Google annulée.', 'info');
        document.getElementById('authGoogleBtn')?.classList.remove('loading');
        return;
      }

      if (code) {
        window.firebaseHandleGoogleCode(code)
          .then(() => {
            document.getElementById('authGoogleBtn')?.classList.remove('loading');
          })
          .catch((e) => {
            console.error('[DeepLink] Google PKCE exchange échoué :', e);
            showToast('Erreur de connexion Google.', 'error');
            document.getElementById('authGoogleBtn')?.classList.remove('loading');
          });
      } else {
        console.warn('[DeepLink] beartify://google-auth reçu sans code');
        showToast('Erreur : code Google manquant.', 'error');
        document.getElementById('authGoogleBtn')?.classList.remove('loading');
      }
      return;
    }

    // ── Autres routes (à implémenter ici si besoin) ───────────────────────
    // if (u.protocol === 'beartify:' && u.host === 'share') { ... }

    console.warn('[DeepLink] Route inconnue :', url);
  } catch (e) {
    console.error('[DeepLink] URL invalide :', url, e);
  }
}
// Exposé sur window pour faciliter les tests manuels depuis la console
window._handleBeartifyDeepLink = _handleBeartifyDeepLink;

// ══════════════════════════════════════════════════════════════════
//  FRIENDS ACTIVITY - Affichage de l'activité des amis en temps réel
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  FRIENDS ACTIVITY - Ticker temps réel (interpolation locale)
// ══════════════════════════════════════════════════════════════════
//  ACTIVITÉ DES AMIS - Fonctionnalité en cours de développement
//  Toute la logique précédente (ticker, Firebase presence, recherche
//  d'utilisateurs) a été retirée pour repartir sur des bases propres.
// ══════════════════════════════════════════════════════════════════
// ── Friends panel : révéler/masquer le rightPanel même sans musique ──────
// friends-panel.js appelle window._showFriendsActivity — on patche openPanel/closePanel
// en surchargeant _showFriendsActivity APRÈS que friends-panel.js l'ait défini
// via un MutationObserver sur window qui détecte quand _showFriendsActivity est (re)défini.
(function _patchFriendsPanel() {
  function _wrap() {
    const orig = window._showFriendsActivity;
    if (!orig || orig._patched) return;
    window._showFriendsActivity = function() {
      const rp = document.getElementById('rightPanel');
      const isCurrentlyOpen = document.getElementById('friendsPanel')?.classList.contains('open');
      if (!isCurrentlyOpen) {
        // Ouvrir : forcer le rightPanel visible même sans musique
        if (rp) {
          rp.style.transition = 'none';
          rp.classList.remove('panel-no-track');
          rp.style.width = '';
          rp.style.overflow = '';
          rp.style.opacity = '1';
          rp.querySelectorAll(':scope > *').forEach(c => c.style.visibility = '');
          // Réactiver la transition après un frame
          requestAnimationFrame(() => { if (rp) rp.style.transition = ''; });
        }
      } else {
        // Fermer : si pas de musique en cours, re-masquer le rightPanel
        if (rp && _playerBarEl?.classList.contains('player-hidden')) {
          _rightPanelEl?.classList.add('panel-no-track');
        }
      }
      orig.call(this);
    };
    window._showFriendsActivity._patched = true;
  }

  // Tenter immédiatement (si friends-panel.js déjà chargé)
  _wrap();
  // Sinon réessayer après le chargement de tous les scripts
  window.addEventListener('load', _wrap, { once: true });
  // Réessayer aussi 500ms après (au cas où l'ordre de chargement varie)
  setTimeout(_wrap, 500);
})();

// window._showFriendsActivity est défini par friends-panel.js — ne pas écraser ici
// ══════════════════════════════════════════════════════════════════
//  TRACK CONTEXT MENU - popup "Etc" (options d'une musique)
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
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"/></svg>
      Lire maintenant
    </div>
    <div class="ctx-menu-item" id="ctxAddLike">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="${isLikedTrack ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      ${isLikedTrack ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
    </div>
    <div class="ctx-menu-item" id="ctxAddPlaylist">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Ajouter à une playlist
      <span class="ctx-menu-submenu-arrow">›</span>
    </div>
    <div class="ctx-menu-divider"></div>
    <div class="ctx-menu-item" id="ctxGoArtist">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Accéder à l'artiste
    </div>
    <div class="ctx-menu-item" id="ctxGoAlbum">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      Accéder à l'album
    </div>
    <div class="ctx-menu-divider"></div>
    <div class="ctx-menu-item" id="ctxAddQueue">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M15 15H1v-1.5h14zm0-4.5H1V9h14zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5m2.5-1a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2z"/></svg>
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
    if (idx !== -1) { playTrackAt(idx); }
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
//  ADD TO PLAYLIST POPUP - choisir où ajouter la musique
// ══════════════════════════════════════════════════════════════════
function showAddToPlaylistPopup(e, track) {
  e.stopPropagation?.();
  closeAllPopups();

  const popup = document.createElement('div');
  popup.className = 'add-to-playlist-popup';
  popup.id = 'atpPopup';

  // ── Positionnement intelligent ──────────────────────────────────
  const triggerEl = e.currentTarget || e.target;
  const rect = triggerEl?.getBoundingClientRect?.();
  const popW = 280, popH = 380;
  let x, y;
  if (rect) {
    // Apparaît au-dessus du bouton déclencheur, aligné à gauche
    x = rect.left;
    y = rect.top - popH - 8;
    if (y < 8) y = rect.bottom + 8; // si pas assez de place en haut → en dessous
    if (x + popW > window.innerWidth - 8) x = window.innerWidth - popW - 8;
    if (x < 8) x = 8;
  } else {
    // Fallback coordonnées souris
    x = Math.min((e.clientX || e.pageX || 100) - 10, window.innerWidth - popW - 8);
    y = Math.min((e.clientY || e.pageY || 100) - 10, window.innerHeight - popH - 8);
    if (x < 8) x = 8;
    if (y < 8) y = 8;
  }
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';

  // ── Données ─────────────────────────────────────────────────────
  const customPlaylists = window.customPlaylists || {};
  const isLikedAlready  = likedTracks.has(track.id);
  const plEntries       = Object.values(customPlaylists);

  // ── Éléments de liste ────────────────────────────────────────────
  function buildItems(filter = '') {
    const q = filter.trim().toLowerCase();

    // Titres likés
    let html = '';
    if (!q || 'titres likés'.includes(q)) {
      html += `
        <div class="atp-item ${isLikedAlready ? 'atp-checked' : ''}" data-id="liked" role="option" aria-selected="${isLikedAlready}">
          <div class="atp-item-art atp-item-art--heart">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="${isLikedAlready ? 'var(--green,#1db954)' : 'currentColor'}" stroke="${isLikedAlready ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </div>
          <span class="atp-item-name">Titres likés</span>
          <div class="atp-item-tick ${isLikedAlready ? 'atp-item-tick--on' : ''}">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06l2.72 2.72 6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
          </div>
        </div>`;
    }

    plEntries.forEach(pl => {
      if (q && !pl.name.toLowerCase().includes(q)) return;
      const inPl = (pl.tracks || []).some(t => t.id === track.id);
      const artHtml = _makePlaylistCoverHtml(pl.tracks, 'xs', pl.coverUrl || null);
      html += `
        <div class="atp-item ${inPl ? 'atp-checked' : ''}" data-id="${escapeHtml(pl.id || pl.name)}" role="option" aria-selected="${inPl}">
          <div class="atp-item-art">${artHtml}</div>
          <span class="atp-item-name">${escapeHtml(pl.name)}</span>
          <div class="atp-item-tick ${inPl ? 'atp-item-tick--on' : ''}">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06l2.72 2.72 6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
          </div>
        </div>`;
    });

    if (!html) html = `<div class="atp-empty">Aucun résultat</div>`;
    return html;
  }

  popup.innerHTML = `
    <div class="atp-header">
      <span class="atp-title">Enregistrer dans une playlist</span>
    </div>
    <div class="atp-search-wrap">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="atp-search-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
      <input type="text" class="atp-search-input" placeholder="Rechercher…" id="atpSearch" autocomplete="off" spellcheck="false">
    </div>
    <div class="atp-list" id="atpList" role="listbox">${buildItems()}</div>
    <div class="atp-divider"></div>
    <div class="atp-footer">
      <button class="atp-new-btn" id="atpNewBtn">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M15.25 8a.75.75 0 0 1-.75.75H8.75v5.75a.75.75 0 0 1-1.5 0V8.75H1.5a.75.75 0 0 1 0-1.5h5.75V1.5a.75.75 0 0 1 1.5 0v5.75h5.75a.75.75 0 0 1 .75.75z"/></svg>
        Créer une playlist
      </button>
    </div>
  `;

  document.body.appendChild(popup);
  // Focus search
  requestAnimationFrame(() => popup.querySelector('#atpSearch')?.focus());

  // ── Recherche ────────────────────────────────────────────────────
  popup.querySelector('#atpSearch').addEventListener('input', ev => {
    popup.querySelector('#atpList').innerHTML = buildItems(ev.target.value);
    bindItemClicks();
  });

  // ── Clic sur item ─────────────────────────────────────────────────
  function bindItemClicks() {
    popup.querySelectorAll('.atp-item').forEach(item => {
      item.addEventListener('click', async () => {
        const plId = item.dataset.id;

        if (plId === 'liked') {
          const was = likedTracks.has(track.id);
          if (was) likedTracks.delete(track.id); else likedTracks.add(track.id);
          item.classList.toggle('atp-checked', !was);
          item.querySelector('.atp-item-tick')?.classList.toggle('atp-item-tick--on', !was);
          const heartSvg = item.querySelector('.atp-item-art--heart svg');
          if (heartSvg) {
            heartSvg.setAttribute('fill', !was ? 'var(--green,#1db954)' : 'currentColor');
            heartSvg.setAttribute('stroke', !was ? 'none' : 'currentColor');
          }
          if (track.id === tracks[currentIndex]?.id) { isLiked = !was; updateLikeButtons(); }
          if (window.FirebaseSync?.syncToFirestore) window.FirebaseSync.syncToFirestore();
          showToast(was ? '♡ Retiré des titres likés' : '♥ Ajouté aux titres likés', was ? 'default' : 'success');

        } else {
          const cpls  = window.customPlaylists || {};
          const pl    = Object.values(cpls).find(p => (p.id || p.name) === plId);
          if (!pl) return;
          const wasIn = (pl.tracks || []).some(t => t.id === track.id);

          if (wasIn) {
            if (window.FirebasePlaylists?.removeFromPlaylist)
              await window.FirebasePlaylists.removeFromPlaylist(plId, track.id);
            // Le cache local est mis à jour par removeFromPlaylist — pas besoin de toucher pl.tracks ici
            item.classList.remove('atp-checked');
            item.querySelector('.atp-item-tick')?.classList.remove('atp-item-tick--on');
            showToast(`Retiré de « ${escapeHtml(pl.name)} »`, 'default');
          } else {
            if (window.FirebasePlaylists?.addToPlaylist)
              await window.FirebasePlaylists.addToPlaylist(plId, track);
            // Le cache local est mis à jour par addToPlaylist — pas besoin de push ici
            item.classList.add('atp-checked');
            item.querySelector('.atp-item-tick')?.classList.add('atp-item-tick--on');
            showToast(`Ajouté à « ${escapeHtml(pl.name)} »`, 'success');
          }
        }
      });
    });
  }
  bindItemClicks();

  // ── Nouvelle playlist ────────────────────────────────────────────
  popup.querySelector('#atpNewBtn').addEventListener('click', () => {
    closeAllPopups();
    showCreatePlaylistModal(track);
  });

  // ── Fermeture sur clic extérieur / Échap ──────────────────────────
  setTimeout(() => {
    function closeAtp(ev) {
      if (!popup.contains(ev.target)) { closeAllPopups(); cleanup(); }
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { closeAllPopups(); cleanup(); }
    }
    function cleanup() {
      document.removeEventListener('click', closeAtp);
      document.removeEventListener('keydown', onKey);
    }
    document.addEventListener('click', closeAtp);
    document.addEventListener('keydown', onKey);
  }, 30);
}


// ══════════════════════════════════════════════════════════════════
//  ETC POPUP - top bar button (raccourcis, sites liés)
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
        <div class="etc-popup-item" id="etcShortcuts">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
          Voir les raccourcis
        </div>
        <div class="etc-popup-item" id="etcSettings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Paramètres
        </div>
      </div>
    `;

    document.body.appendChild(popup);

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


// ── Right panel - toggle rétractable ─────────────────────────────
(function _initRightPanelToggle() {
  const panel = document.getElementById('rightPanel');
  if (!panel) return;

  // Flèche SVG carrousel (moderne, épurée) - pointe à GAUCHE pour indiquer que le panneau s'ouvre
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
  if (el) el.textContent = name || '-';
  window._currentRpContextName = name || '-';
};
window._currentRpContextName = '-';

// ══════════════════════════════════════════════════════════════════
//  CAROUSEL FIX - délégation globale pour toutes les flèches
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
//  AUDIO GRAPH - EQ + Normalization + Mono
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
    console.log(`[AudioGraph] Chaîne reconstruite - EQ:${eqEnabled} Norm:${normEnabled} Mono:${monoEnabled}`);
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
//  FONCTIONS PARAMÈTRES - toutes sans AudioContext direct
// ══════════════════════════════════════════════════════════════════════

window._applyVolumeLevel = function(level) {
  const factor = { quiet: 0.5, normal: 0.85, high: 1.0 }[level] ?? 1.0;
  window._volumeLevelFactor = factor;
  const ap = document.getElementById('audioPlayer');
  const sl = document.getElementById('volumeSlider');
  if (ap && sl) ap.volume = Math.min(1, (sl.value / 100) * factor);
};

window._applyMonoAudio = function(enabled) {
  // Pas d'AudioContext direct - on passe par _rebuildAudioChain
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
window._applyFriendsActivity = e => { const b = document.getElementById('btnFriends'); if (b) b.style.display = e ? '' : 'none'; };
window._applyDownloadQuality = q => {
  // Paramètres envoyés à l'API Jellyfin /Items/{id}/Download
  // Jellyfin gère lui-même la conversion via ffmpeg embarqué
  const profiles = {
    low:      { format: 'mp3',  audioBitRate: 128000, label: 'MP3 128 kbps',  ext: 'mp3'  },
    normal:   { format: 'mp3',  audioBitRate: 320000, label: 'MP3 320 kbps',  ext: 'mp3'  },
    high:     { format: 'flac', audioBitRate: 0,      label: 'FLAC CD',       ext: 'flac' },
    veryhigh: { format: 'flac', audioBitRate: 0,      label: 'FLAC Hi-Res',   ext: 'flac' }, // fallback CD si pas de Hi-Res
  };
  window._downloadQualityProfile = profiles[q] || profiles.high;
};
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
    .sp-section{background:transparent!important}
    #mediaKeyOverlay{transition:opacity .3s}
    @keyframes beartifyFadeIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}

    /* ── LRC / -line.json : balayage vertical haut → bas, mot par mot ──────
     * display:inline-block et alignement gérés par style.css (.line .lrc-word).
     * Le gradient haut→bas est piloté par --lrc-fill-progress que le moteur
     * rAF pose directement sur chaque span.lrc-word.
     * !important pour primer sur .line.Active .word et .line.Sung .lrc-word
     * de style.css qui posent un background-image concurrent.
     */
    .line .lrc-word {
      background-image: linear-gradient(
        to bottom,
        var(--lyrics-highlight-color, #fff) calc(var(--lrc-fill-progress, 0) * 100%),
        currentColor                        calc(var(--lrc-fill-progress, 0) * 100%)
      ) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      color: transparent !important;
    }
  `;
  document.head.appendChild(st);
})();

// ══════════════════════════════════════════════════════════════════════
//  INIT - applique les paramètres sauvegardés (sans AudioContext)
// ══════════════════════════════════════════════════════════════════════
function _applyAllSettingsBridge() {
  const s = window._getSettings?.() || {};
  if (!Object.keys(s).length) return;
  window._applyVolumeLevel(s.volumeLevel || 'high');
  window._applyPrivateSession(!!s.privateSession);
  window._applyExplicitFilter(s.explicitContent !== false);
  window._applyCompactLibrary(!!s.compactLibrary);
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
  // Audio (EQ/Norm/Mono) sera appliqué à audioGraph:ready - pas maintenant
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
        const pool    = window._playContext?.length ? window._playContext : [...tracks.keys()];
        const pt      = pool.map(i => tracks[i]).filter(Boolean);
        const _ptCur  = pt.findIndex(t => t.id === tracks[currentIndex]?.id);
        const sh      = window._buildShuffleQueue?.(pt, _ptCur >= 0 ? _ptCur : 0) || _fisherYates(pt);
        shuffleOrder = sh.map(_trackToIdx).filter(i => i !== -1);
        _completeShuffleOrder(window._playContext);
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
// ── Exposition pour mini-player.js (PiP) ─────────────────────────
window._mpGetQueue = function () {
  if (!tracks || tracks.length === 0) return [];
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
  return upcoming.map(idx => ({ idx, track: tracks[idx] })).filter(x => x.track);
};
window._mpPlayIdx = function (idx) {
  if (isNaN(idx)) return;
  currentIndex = idx;
  playCurrentTrack();
};

// ── Traduction des paroles — exposée pour mini-player.js ──────────
// Le mini-player PiP peut appeler ces fonctions pour proposer un
// toggle traduction compact, sans dupliquer la logique de traduction.
// Étude de faisabilité (voir réponse) : la fenêtre PiP standard offre
// très peu de marge horizontale pour un bouton supplémentaire — il
// faudrait soit le combiner avec un menu "..." existant, soit ne
// l'afficher qu'au survol/agrandissement de la fenêtre PiP.
window._mpIsTranslationEnabled = () => !!window._lyricsTranslation;
window._mpToggleTranslation = function () {
  const enabled = !window._lyricsTranslation;
  window._lyricsTranslation = enabled;
  window.dispatchEvent(new CustomEvent('beartify:lyricsTranslationChanged', {
    detail: { enabled, lang: window._lyricsTranslationLang || 'fr' }
  }));
  return enabled;
};