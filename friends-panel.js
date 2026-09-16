/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          Beartify — Friends Activity Panel                  ║
 * ║   Activité temps réel · Follow/Unfollow · Partage           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Remplace window._showFriendsActivity par un vrai panneau.
 * Se monte sur le DOM après le chargement de la page.
 *
 * Dépendances (mêmes noms globaux, désormais adossés à PocketBase) :
 *   pocketbase-config.js → window.FirebaseConfig / window.PocketBaseConfig
 *   pocketbase-sync.js   → window.FirebaseSync
 *   pocketbase-social.js → window.FirebaseSocial
 */

// _t() ne peut jamais lever d'exception : si BeartifyI18n n'est pas
// encore prêt, il retombe silencieusement sur le texte français fourni.
function _t(key, fallback, params) {
  try {
    if (window.BeartifyI18n) return window.BeartifyI18n.t(key, fallback, params);
  } catch (e) { /* ne jamais laisser un souci de traduction casser l'app */ }
  return fallback;
}

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // PATCH WINDOW.PLAYTRACK
  // Si un titre de la liste d'un ami n'est pas dans tracks[] (closure
  // interne à script.js), window.playTrack échoue silencieusement.
  // Ce patch détecte l'échec et bascule sur une lecture directe via
  // l'élément <audio id="audioPlayer"> avec le streamUrl Firestore.
  // ═══════════════════════════════════════════════════════════════
  (function _patchPlayTrack() {
    // Attendre que window.playTrack soit défini (script.js peut charger après)
    function _tryPatch() {
      if (!window.playTrack || window.playTrack.__fpPatched) return;
      const _orig = window.playTrack;
      window.playTrack = function(track, ctx, ctxName) {
        const beforeId = String(window.currentTrack?.id ?? '');
        _orig.call(this, track, ctx, ctxName);
        // Si le track cible est déjà actif, ou si l'original a réussi → rien à faire
        if (String(window.currentTrack?.id ?? '') === String(track?.id ?? '')) return;
        // L'original a échoué (track absent de la bibliothèque interne)
        // Lecture directe si on a un streamUrl
        const url = track?.streamUrl || track?.url;
        if (!url) return;
        const audio = document.getElementById('audioPlayer');
        if (!audio) return;
        audio.src = url;
        audio.play().catch(() => {});
        window.currentTrack = track;
        // Mettre à jour l'UI du lecteur
        const titleEl  = document.getElementById('currentTitle');
        const artistEl = document.getElementById('currentArtist');
        const thumbEl  = document.getElementById('playerThumb');
        if (titleEl)  titleEl.textContent  = track.title  || '';
        if (artistEl) artistEl.textContent = track.artist || '';
        if (thumbEl && track.imageUrl) {
          thumbEl.innerHTML = `<img src="${track.imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
        }
      };
      window.playTrack.__fpPatched = true;
    }
    // Essayer immédiatement et aussi dans 1s (au cas où script.js charge tard)
    _tryPatch();
    setTimeout(_tryPatch, 1000);
  })();

  // ── État interne ─────────────────────────────────────────────
  let isOpen            = false;
  let activeTab         = 'activity';   // 'activity' | 'following' | 'followers'
  let presenceListeners = [];           // Fonctions unsubscribe Firestore
  let friendsData       = {};           // { docId: { name, picture, presence } }
  let searchDebounce    = null;

  // ── Progression locale (incrémentation côté client, 1 s) ────
  // Map<docId, { pos, lastUpdate, status, duration, trackId }>
  // Firestore onSnapshot met à jour pos+lastUpdate ; le ticker ne fait
  // que calculer currentPos = pos + (now - lastUpdate) sans re-render.
  const localProgress   = new Map();
  let   progressTicker  = null;         // setInterval 1 s

  // ── Écoute synchronisée (Listen Together) ───────────────────────
  let syncListenTarget  = null;         // docId de l'ami avec qui on synchronise, ou null
  let _syncLastTrackId  = null;         // dernier id de piste déjà répliqué (évite les doublons)
let _openModalDocId   = null;         // docId de l'ami dont le popup est actuellement ouvert (pour le rafraîchir en direct)
const _syncedToMeBy   = new Set();    // docId des amis qui synchronisent ACTUELLEMENT leur écoute sur la mienne
let _friendsListReady = false;        // true une fois le tout premier chargement de la liste terminé (même si vide)
let _followingIds     = new Set();    // docId des personnes qu'on SUIT (affichées dans "En écoute")

// ⚠️ TEMPORAIRE — à retirer une fois le bug de présence fantôme résolu.
// Expose l'état interne pour inspection en console DevTools :
//   window._debugFriendsPanel().friendsData['docId-de-l-ami']
window._debugFriendsPanel = function () {
  return { friendsData, localProgress, _followingIds };
};

// ── DOM ──────────────────────────────────────────────────────
let panel, backdrop, contentEl;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function esc(str) {
  if (!str) return '';
  return String(str)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;');
}

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
  ? (parts[0][0] + parts[1][0]).toUpperCase()
  : name[0].toUpperCase();
}

function avatarHTML(picture, name, size = 36) {
  if (picture) {
    return `<img src="${esc(picture)}" alt="" loading="lazy"
    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <span class="fp-avatar-initials" style="display:none">${esc(initials(name))}</span>`;
  }
  return `<span class="fp-avatar-initials">${esc(initials(name))}</span>`;
}

function gradientForName(name) {
  const hue = [...(name || '?')].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue},55%,35%), hsl(${(hue+60)%360},55%,25%))`;
}

// Supprime "(par X)" de TOUTES les playlists en mémoire + backend actif
// ── CORRIGÉ : écrivait directement dans Firestore via `db.collection(...)`,
//    en ignorant complètement PocketBase — même quand PocketBase est le
//    backend actif et en bonne santé. Passe maintenant par
//    window.FirebasePlaylists.updatePlaylist, qui route correctement vers
//    PocketBase en priorité (et Firebase seulement si PocketBase est
//    injoignable), au lieu de toujours écrire dans Firestore. ────────────
async function _stripParSuffix() {
  const cpl = window.customPlaylists;
  if (!cpl || !Object.keys(cpl).length) return;
  if (!window.FirebasePlaylists?.updatePlaylist) return;

  const dirty = [];
  for (const [id, pl] of Object.entries(cpl)) {
    if (!pl?.name) continue;
    const clean = pl.name.replace(/\s*\(par [^)]+\)\s*$/, '').trim();
    if (clean !== pl.name) { pl.name = clean; dirty.push([id, clean]); }
  }
  if (!dirty.length) return;

  // Pas de batch multi-documents disponible côté PocketBase (contrairement
  // au batch Firestore qu'utilisait l'ancien code) — un appel par playlist,
  // en parallèle. Le nombre de playlists concernées reste toujours faible
  // en pratique (seulement celles important un nom avec suffixe "(par X)").
  await Promise.allSettled(
    dirty.map(([id, name]) => window.FirebasePlaylists.updatePlaylist(id, { name }))
  );
  window.renderSidebarView?.('playlists');
}
// Nettoyer les imports existants au chargement de la page
setTimeout(_stripParSuffix, 2500);

function showToast(msg, type = 'success') {
  let t = document.getElementById('fpToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fpToast';
    t.className = 'fp-toast';
    document.body.appendChild(t);
  }
  t.textContent  = msg;
  t.className    = `fp-toast ${type}`;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ═══════════════════════════════════════════════════════════════
// BUILD PANEL HTML
// ═══════════════════════════════════════════════════════════════
function buildPanel() {
  if (document.getElementById('friendsPanel')) return;
  // injectFriendPanelThemeStyles() retirée : elle injectait un <style>
  // avec !important qui écrasait à tort la règle du thème Starry Night
  // (background transparent + z-index différent de celui du CSS externe,
  // déjà corrigé) — c'était la cause du fond transparent. Le fichier
  // friends-panel.css externe suffit désormais, tous ses sélecteurs
  // étant déjà couverts correctement là-bas.


  // ── Panel — monté dans #rightPanel pour le remplacer visuellement.
  // position:absolute inset:0 → couvre exactement le contenu du right panel.
  // Aucun backdrop, aucune détection de clic extérieur : le panel reste ouvert
  // jusqu'à ce que l'utilisateur clique sur le bouton × ou re-clique sur btnFriends.
  panel = document.createElement('div');
  panel.id = 'friendsPanel';
  panel.setAttribute('aria-label', _t('tt-friends-activity', "Activité des amis"));
  panel.innerHTML = `
  <div class="fp-header">
  <span class="fp-header-title">${_t('tt-friends-activity', "Activité des amis")}</span>
  <button class="fp-close-btn" id="fpCloseBtn" aria-label="Fermer">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
  stroke-linecap="round">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
  </button>
  </div>

  <div class="fp-tabs">
  <button class="fp-tab active" data-tab="activity">${_t('fp-lbl-listening', "En écoute")}</button>
  <button class="fp-tab" data-tab="following">${_t('fp-lbl-following', "Je suis")}</button>
  <button class="fp-tab" data-tab="followers">Abonnés</button>
  </div>

  <div class="fp-content" id="fpContent"></div>
  `;

  // Insérer dans #rightPanel (position:relative) pour overlay interne
  const rightPanel = document.getElementById('rightPanel');
  if (rightPanel) rightPanel.appendChild(panel);
  else           document.body.appendChild(panel);

  contentEl = document.getElementById('fpContent');

  // Tab clicks
  panel.querySelectorAll('.fp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      panel.querySelectorAll('.fp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderContent();
    });
  });

  document.getElementById('fpCloseBtn').addEventListener('click', closePanel);
}

// ═══════════════════════════════════════════════════════════════
// OPEN / CLOSE
// ═══════════════════════════════════════════════════════════════
// Le panel remplace le contenu du right panel (position:absolute inset:0).
// Il reste visible jusqu'à fermeture explicite (bouton × ou re-clic btnFriends).
// Aucun backdrop, aucune détection de clic extérieur.
// Mémorise le display d'origine de chaque enfant de #rightPanel masqué,
// pour le restaurer exactement à la fermeture (pas juste "block"/"flex"
// au hasard, au cas où l'un d'eux utilisait autre chose).
const _hiddenSiblingsDisplay = new Map();

function _hideRightPanelSiblings() {
  const rp = document.getElementById('rightPanel');
  if (!rp) return;
  rp.querySelectorAll(':scope > *').forEach(child => {
    if (child === panel) return;
    if (!_hiddenSiblingsDisplay.has(child)) {
      _hiddenSiblingsDisplay.set(child, child.style.display || '');
    }
    child.style.display = 'none';
  });
}

function _restoreRightPanelSiblings() {
  _hiddenSiblingsDisplay.forEach((originalDisplay, child) => {
    child.style.display = originalDisplay;
  });
  _hiddenSiblingsDisplay.clear();
}

// ⚠️ CORRECTIF : _hideRightPanelSiblings() ne masquait que les enfants de
// #rightPanel PRÉSENTS au moment de l'ouverture du panel. Un changement de
// piste peut recréer/réinsérer un élément dans #rightPanel après coup
// (notamment le canvas de fond dynamique — voir style.css, section
// "dynbg-patch" — recréé à chaque nouvelle pochette), qui n'était alors
// jamais masqué : il redevenait visible derrière le panel amis, donnant
// l'impression que son fond "redevient transparent" à chaque piste. On
// rejoue donc le masquage à chaque 'beartify:trackChanged' tant que le
// panel amis est ouvert.
window.addEventListener('beartify:trackChanged', () => {
  if (isOpen) _hideRightPanelSiblings();
});

function openPanel() {
  if (!panel) buildPanel();
  isOpen = true;
  panel.classList.add('open');
  // ⚠️ Le panel amis est lui-même injecté DANS #rightPanel (voir
  // buildPanel : rightPanel.appendChild(panel)) — si une fermeture
  // précédente sans musique en cours a mis #rightPanel en display:none
  // (voir closePanel), il faut le réafficher ici, sinon le panel amis
  // resterait invisible malgré isOpen=true.
  const rp = document.getElementById('rightPanel');
  if (rp) rp.style.display = '';
  // ⚠️ Sans ceci, le contenu d'origine du right panel restait affiché
  // "derrière" — visible en superposition avec le panel amis au lieu
  // d'être réellement remplacé.
  _hideRightPanelSiblings();
  document.getElementById('btnFriends')?.classList.add('active');
  renderContent();
  startFriendListeners();
  patchAudioPresence();
}

function closePanel() {
  isOpen = false;
  panel?.classList.remove('open');
  const rp = document.getElementById('rightPanel');
  // ⚠️ CORRIGÉ : l'ancien correctif ne masquait que le sous-élément
  // .now-playing-panel, ce qui laissait d'autres sous-sections du
  // conteneur de droite dans un état vide/cassé visible (tirets,
  // image par défaut) quand aucune musique n'est en cours. On masque
  // maintenant #rightPanel dans son ENTIER dans ce cas — plus fiable
  // et correspond à la demande explicite : "si pas de musique, cache
  // le conteneur de droite".
  if (!window.currentTrack) {
    if (rp) rp.style.display = 'none';
    // Rien à restaurer : on garde tout masqué plutôt que de rétablir
    // puis re-cacher un sous-élément — le prochain openPanel()
    // recapturera de toute façon l'état courant des enfants.
    _hiddenSiblingsDisplay.clear();
  } else {
    if (rp) rp.style.display = '';
    _restoreRightPanelSiblings();
  }
  document.getElementById('btnFriends')?.classList.remove('active');
  stopFriendListeners();
}

// ═══════════════════════════════════════════════════════════════
// RENDER DISPATCHER
// ═══════════════════════════════════════════════════════════════
function renderContent() {
  if (!contentEl) return;
  const db = window.FirebaseConfig?.getDB?.();
  const myId = window.FirebaseSocial?.getMyDocId?.();

  if (!myId) {
    contentEl.innerHTML = `
    <div class="fp-empty">
    <span class="fp-empty-icon">🔒</span>
    <strong>${_t('fp-msg-login-required', "Connexion requise")}</strong><br>
    Connecte-toi pour voir l'activité de tes amis.
    </div>`;
    return;
  }

  switch (activeTab) {
    case 'activity':  renderActivity();  break;
    case 'following': renderFollowing(); break;
    case 'followers': renderFollowers(); break;
  }
}

// ═══════════════════════════════════════════════════════════════
// TAB: ACTIVITY (En écoute en temps réel)
// ═══════════════════════════════════════════════════════════════
let _wipDismissed = false;  // Banner WIP dismissed for this session

function renderActivity() {
  const friends = Object.values(friendsData).filter(f => _followingIds.has(f.docId));
  // ── Bannière WIP ──────────────────────────────────────────
  const wipHtml = _wipDismissed ? '' : `
  <div class="fp-wip-banner" id="fpWipBanner">
  <span class="fp-wip-icon">🚧</span>
  <span class="fp-wip-text">
  <strong>${_t('toast-feature-in-development', "Fonctionnalité en cours de développement")}</strong><br>
  Certaines parties peuvent ne pas fonctionner.
  </span>
  <button class="fp-wip-close" id="fpWipClose" aria-label="Fermer">✕</button>
  </div>`;

  if (!friends.length) {
    contentEl.innerHTML = wipHtml + (
      _friendsListReady
      ? `<div class="fp-empty">
      <span class="fp-empty-icon">👥</span>
      <strong>${_t('fp-msg-no-followed-friend', "Aucun ami suivi")}</strong><br>
      Suis des utilisateurs depuis l'onglet<br>
      <em>${_t('fp-lbl-following', "Je suis")}</em> pour voir leur activité.
      </div>`
      : `<div class="fp-empty">
      <span class="fp-empty-icon">⏳</span>
      <strong>Chargement…</strong>
      </div>`
    );
    bindWipClose();
    return;
  }

  // Trier : playing > paused > stopped/offline
  const sorted = [...friends].sort((a, b) => {
    const rank = s => s === 'playing' ? 0 : s === 'paused' ? 1 : 2;
    return rank(a.presence?.status) - rank(b.presence?.status);
  });

  const hasActive = sorted.some(f =>
  f.presence?.status === 'playing' || f.presence?.status === 'paused'
  );

  let html = wipHtml;
  if (hasActive) html += `<div class="fp-section-label">${_t('fp-lbl-listening-now', "Écoute en cours")}</div>`;
  sorted.forEach(friend => { html += buildFriendCard(friend); });

  contentEl.innerHTML = html;
  bindWipClose();

  // Card-top (avatar + nom) → page de profil de l'ami
  contentEl.querySelectorAll('.fp-card-top[data-docid]').forEach(top => {
    top.style.cursor = 'pointer';
    top.addEventListener('click', e => {
      e.stopPropagation();
      const docId = top.dataset.docid;
      if (!docId) return;
      const friend = friendsData[docId] || {
        docId,
        name:    top.querySelector('.fp-card-name')?.textContent || docId,
                         picture: top.querySelector('.fp-avatar img')?.src || '',
                         presence: null,
      };
      openProfilePage(friend);
    });
  });

  // Snippet (carte de la musique) → confirmation d'écoute
  contentEl.querySelectorAll('.fp-track-snippet[data-track-id]').forEach(card => {
    card.addEventListener('click', e => {
      e.stopPropagation();
      const docId = card.dataset.docId;
      const f     = friendsData[docId];
      if (!f?.presence?.currentTrack) return;
      openListenConfirmDialog(f);
    });
  });

  // Démarrer le ticker de progression locale
  startProgressTicker();
}

function bindWipClose() {
  document.getElementById('fpWipClose')?.addEventListener('click', () => {
    _wipDismissed = true;
    document.getElementById('fpWipBanner')?.remove();
  });
}

// Nettoie le suffixe "(par Pseudo)" ajouté lors de l'import de playlist
function cleanPlName(name) {
  return (name || '').replace(/\s*\(par [^)]+\)\s*$/, '').trim();
}

// ── openProfilePage — redirige vers la vue principale ──────────
// Le profil s'affiche désormais dans le contenu principal (showUserProfile),
// pas dans le panel étroit. Le panel reste ouvert en arrière-plan.
function openProfilePage(friend) {
  if (window.showUserProfile) {
    window.showUserProfile(friend.docId, {
      name:    friend.name    || '',
      picture: friend.picture || '',
      presence:friend.presence|| null
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFIRMATION D'ÉCOUTE (dialog léger)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// STYLES DU NOUVEAU POPUP (injectés une seule fois, self-contained —
// ne dépend pas de la feuille de style principale)
// ═══════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
// STYLES DU NOUVEAU POPUP (injectés une seule fois, self-contained —
// ne dépend pas de la feuille de style principale)
// ═══════════════════════════════════════════════════════════════
function injectFriendModalStyles() {
  if (document.getElementById('fp-track-modal-css')) return;
  const s = document.createElement('style');
  s.id = 'fp-track-modal-css';
  s.textContent = `
  .fp-tm-overlay {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: fpTmFadeIn .15s ease;
    padding: 24px;
  }
  @keyframes fpTmFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .fp-tm-modal {
    width: 100%; max-width: 420px;
    background: #181818; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; padding: 28px 24px 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    position: relative;
    animation: fpTmPop .18s cubic-bezier(.2,.9,.3,1.2);
  }
  @keyframes fpTmPop { from { transform: scale(.92); opacity:0; } to { transform: scale(1); opacity:1; } }
  .fp-tm-close {
    position: absolute; top: 14px; right: 14px;
    width: 30px; height: 30px; border-radius: 50%; border: none;
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
    cursor: pointer; font-size: 15px; display:flex; align-items:center; justify-content:center;
  }
  .fp-tm-close:hover { background: rgba(255,255,255,0.16); color:#fff; }
  .fp-tm-friend-line {
    text-align:center; font-size: 13px; color: rgba(255,255,255,0.5);
    margin-bottom: 16px;
  }
  .fp-tm-friend-line strong { color: rgba(255,255,255,0.85); }
  .fp-tm-cover {
    width: 100%; aspect-ratio: 1; border-radius: 14px; overflow: hidden;
    background: rgba(255,255,255,0.05); margin-bottom: 18px;
    display:flex; align-items:center; justify-content:center;
  }
  .fp-tm-cover img { width:100%; height:100%; object-fit:cover; }
  .fp-tm-cover svg { width: 25%; height: 25%; color: rgba(255,255,255,0.2); }
  .fp-tm-title { font-size: 19px; font-weight: 700; color:#fff; text-align:center; margin-bottom:4px; }
  .fp-tm-artist { font-size: 14px; color: rgba(255,255,255,0.55); text-align:center; margin-bottom: 22px; }
  .fp-tm-actions { display:flex; flex-direction:column; gap:8px; }
  .fp-tm-btn {
    display:flex; align-items:center; justify-content:center; gap:8px;
    width:100%; padding: 12px 16px; border-radius: 12px; border: none;
    font-size: 14px; font-weight: 600; cursor:pointer;
    background: rgba(255,255,255,0.06); color:#fff;
    transition: background .15s;
  }
  .fp-tm-btn:hover { background: rgba(255,255,255,0.12); }
  .fp-tm-btn.primary { background: var(--green, #1ed760) !important; color:#000 !important; }
  .fp-tm-btn.primary:hover { background: var(--green-hover, #1fdf64) !important; }
  .fp-tm-btn.active { background: color-mix(in srgb, var(--green, #1ed760) 18%, transparent) !important; color: var(--green, #1ed760) !important; }
  .fp-tm-btn svg { width:16px; height:16px; flex-shrink:0; }
  .fp-tm-playlist-picker {
    margin-top: 10px; max-height: 200px; overflow-y: auto;
    border-radius: 12px; background: rgba(0,0,0,0.25);
    border: 1px solid rgba(255,255,255,0.06);
  }
  .fp-tm-pl-item {
    display:flex; align-items:center; gap:10px; padding: 10px 12px;
    cursor:pointer; font-size: 13px; color: rgba(255,255,255,0.85);
  }
  .fp-tm-pl-item:hover { background: rgba(255,255,255,0.06); }
  .fp-tm-pl-item + .fp-tm-pl-item { border-top: 1px solid rgba(255,255,255,0.05); }
  .fp-tm-pl-empty { padding: 14px; text-align:center; font-size:12px; color:rgba(255,255,255,0.4); }

  .fp-sync-banner {
    position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
    z-index: 9999; display:flex; align-items:center; gap:10px;
    background: var(--bg-elevated, #181818) !important; border: 1px solid color-mix(in srgb, var(--green, #1ed760) 40%, transparent) !important;
    border-radius: 999px; padding: 10px 16px 10px 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-size: 13px; color:#fff;
    animation: fpTmFadeIn .2s ease;
  }
  .fp-sync-dot {
    width: 9px; height: 9px; border-radius:50%; background:var(--green, #1ed760); flex-shrink:0;
    animation: fpSyncPulse 1.4s ease-in-out infinite;
  }
  @keyframes fpSyncPulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
  .fp-sync-banner button {
    background: rgba(255,255,255,0.1); border:none; color:#fff;
    border-radius:999px; padding:5px 12px; font-size:12px; cursor:pointer;
  }
  .fp-sync-banner button:hover { background: rgba(255,255,255,0.18); }
  `;
  document.head.appendChild(s);
}

function openFriendTrackModal(friend) {
  document.getElementById('fpTrackModal')?.remove();

  const track = friend.presence?.currentTrack;
  if (!track?.title) return;

  injectFriendModalStyles();
  _openModalDocId = friend.docId;

  const isSyncing = syncListenTarget === friend.docId;

  const overlay = document.createElement('div');
  overlay.id = 'fpTrackModal';
  overlay.className = 'fp-tm-overlay';
  overlay.dataset.docid = friend.docId;
  overlay.innerHTML = `
  <div class="fp-tm-modal">
  <button class="fp-tm-close" id="fpTmClose">✕</button>
  <div class="fp-tm-friend-line">🎧 <strong>${esc(friend.name)}</strong> écoute en ce moment</div>
  <div class="fp-tm-cover" id="fpTmCover">
  ${track.imageUrl
    ? `<img src="${esc(track.imageUrl)}" alt="">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/>
    <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/>
    </svg>`}
    </div>
    <div class="fp-tm-title" id="fpTmTitle">${esc(track.title)}</div>
    <div class="fp-tm-artist" id="fpTmArtist">${esc(track.artist)}${track.album ? ` — ${esc(track.album)}` : ''}</div>
    <div class="fp-tm-actions">
    <button class="fp-tm-btn primary" id="fpTmPlay">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    Écouter
    </button>
    <button class="fp-tm-btn" id="fpTmQueue">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    Ajouter à la file d'attente
    </button>
    <button class="fp-tm-btn" id="fpTmPlaylist">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    Ajouter à la playlist
    </button>
    <button class="fp-tm-btn ${isSyncing ? 'active' : ''}" id="fpTmSync">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    <span id="fpTmSyncLabel">${isSyncing ? _t('fp-title-stop-sync', "Arrêter l'écoute synchronisée") : _t('fp-lbl-synced-listening', "Écoute synchronisée")}</span>
    </button>
    </div>
    <div id="fpTmPlaylistPicker" class="fp-tm-playlist-picker" style="display:none"></div>
    </div>`;

    document.body.appendChild(overlay);

    const closeModal = () => { _openModalDocId = null; overlay.remove(); };
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('fpTmClose').addEventListener('click', closeModal);

    // ── Écouter (comportement identique à avant) ──────────────────
    document.getElementById('fpTmPlay').addEventListener('click', () => {
      closeModal();
      playFriendTrack(track, friend.docId, 0, false);
    });

    // ── Ajouter à la file d'attente ────────────────────────────────
    document.getElementById('fpTmQueue').addEventListener('click', () => {
      addTrackToQueue(track);
    });

    // ── Ajouter à la playlist (sous-menu déroulant) ─────────────────
    document.getElementById('fpTmPlaylist').addEventListener('click', () => {
      const picker = document.getElementById('fpTmPlaylistPicker');
      if (picker.style.display === 'block') { picker.style.display = 'none'; return; }
      const playlists = Object.entries(window.customPlaylists || {});
      if (!playlists.length) {
        picker.innerHTML = `<div class="fp-tm-pl-empty">Aucune playlist — crée-en une depuis la bibliothèque.</div>`;
      } else {
        picker.innerHTML = playlists.map(([id, pl]) => `
        <div class="fp-tm-pl-item" data-pl-id="${esc(id)}">
        <span>📃</span><span>${esc(cleanPlName(pl.name))}</span>
        </div>`).join('');
        picker.querySelectorAll('.fp-tm-pl-item').forEach(item => {
          item.addEventListener('click', async () => {
            const plId = item.dataset.plId;
            // Toujours la piste EN COURS de l'ami au moment du clic (le popup
            // se rafraîchit en direct — voir refreshOpenFriendModal), pas la
            // piste figée au moment de l'ouverture.
            const liveTrack = friendsData[friend.docId]?.presence?.currentTrack || track;
            const ok = await window.FirebasePlaylists?.addToPlaylist(plId, liveTrack);
            showToast(ok ? _t('toast-added-to-playlist', "✅ Ajouté à la playlist") : _t('toast-add-failed-duplicate', "Impossible d'ajouter (déjà présent ?)"), ok ? 'success' : 'error');
            picker.style.display = 'none';
          });
        });
      }
      picker.style.display = 'block';
    });

    // ── Écoute synchronisée (toggle) ────────────────────────────────
    document.getElementById('fpTmSync').addEventListener('click', () => {
      if (syncListenTarget === friend.docId) {
        closeModal();
        stopSyncListen();
      } else {
        const started = startSyncListen(friend);
        if (started) closeModal();
        // Si bloqué (started === false), on laisse le popup ouvert —
        // startSyncListen a déjà affiché le message d'erreur explicite.
      }
    });
}

// Rafraîchit le popup ouvert en direct (titre/artiste/cover/statut sync)
// quand la présence de l'ami change, au lieu de le laisser figé sur
// l'ancienne piste jusqu'à ce qu'on le referme et le rouvre.
function refreshOpenFriendModal(friend) {
  const overlay = document.getElementById('fpTrackModal');
  if (!overlay || overlay.dataset.docid !== friend.docId) return;

  const track = friend.presence?.currentTrack;
  if (!track?.title) {
    // L'ami a arrêté d'écouter — le popup n'a plus de sens, on le ferme.
    _openModalDocId = null;
    overlay.remove();
    return;
  }

  const titleEl  = document.getElementById('fpTmTitle');
  const artistEl = document.getElementById('fpTmArtist');
  const coverEl  = document.getElementById('fpTmCover');
  if (titleEl)  titleEl.textContent  = track.title;
  if (artistEl) artistEl.textContent = track.artist + (track.album ? ` — ${track.album}` : '');
  if (coverEl) {
    coverEl.innerHTML = track.imageUrl
    ? `<img src="${esc(track.imageUrl)}" alt="">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/>
    <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/>
    </svg>`;
  }

  const syncBtn   = document.getElementById('fpTmSync');
  const syncLabel = document.getElementById('fpTmSyncLabel');
  const isSyncing = syncListenTarget === friend.docId;
  if (syncBtn)   syncBtn.classList.toggle('active', isSyncing);
  if (syncLabel) syncLabel.textContent = isSyncing ? _t('fp-title-stop-sync', "Arrêter l'écoute synchronisée") : _t('fp-lbl-synced-listening', "Écoute synchronisée");
}

// Alias — conserve le nom d'origine utilisé ailleurs dans le fichier
const openListenConfirmDialog = openFriendTrackModal;

// ═══════════════════════════════════════════════════════════════
// AJOUT À LA FILE D'ATTENTE
// ⚠️ L'app n'a pas de vraie file d'attente éditable — "à venir" est
// calculé depuis le contexte de lecture actif (window._playContext).
// On insère donc le morceau juste après la piste en cours dans ce
// contexte, seulement si le morceau existe dans ta bibliothèque locale
// (impossible sinon, la file étant indexée sur window.tracks).
// ═══════════════════════════════════════════════════════════════
function addTrackToQueue(track) {
  const lib = window.tracks;
  if (!Array.isArray(lib) || !lib.length) {
    showToast('File d\'attente indisponible pour le moment', 'error');
    return;
  }
  const idx = lib.findIndex(t => String(t.id) === String(track.id));
  if (idx === -1) {
    showToast(_t('toast-track-not-in-library', "Ce titre n'est pas dans ta bibliothèque — impossible à mettre en file"), 'error');
    return;
  }
  // ⚠️ CORRIGÉ : window.currentIndex ≠ la variable currentIndex
  // réellement tenue à jour par le moteur de lecture (scope global
  // partagé entre scripts classiques — voir core/state.js). Elle
  // était quasi toujours undefined/obsolète ici, donc cette condition
  // était presque toujours fausse même pendant une lecture active —
  // "Ajouter à la file d'attente" depuis le panel amis affichait à
  // tort "Lance d'abord une lecture" alors que de la musique jouait.
  if (Array.isArray(window._playContext) && typeof currentIndex !== 'undefined' && currentIndex >= 0) {
    const pos = window._playContext.indexOf(currentIndex);
    const insertAt = pos === -1 ? 0 : pos + 1;
    // Évite les doublons consécutifs si déjà juste après
    if (window._playContext[insertAt] !== idx) {
      window._playContext.splice(insertAt, 0, idx);
    }
    if (typeof window._renderPanelQueue === 'function') window._renderPanelQueue();
    showToast(_t('toast-added-to-queue', "✅ Ajouté à la file d'attente"), 'success');
  } else {
    showToast('Lance d\'abord une lecture pour activer la file d\'attente', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// ÉCOUTE SYNCHRONISÉE (Listen Together)
// Réplique automatiquement chez toi les changements de piste/statut
// d'un ami tant que la synchro est active.
// ═══════════════════════════════════════════════════════════════
function startSyncListen(friend) {
  // ── Blocage mutuel : si CET ami (ou n'importe qui) synchronise déjà
  // son écoute sur la mienne, je ne peux pas démarrer ma propre synchro
  // — ça créerait une boucle (chacun suivrait l'autre indéfiniment).
  if (_syncedToMeBy.size > 0) {
    const nameList = [..._syncedToMeBy].map(id => friendsData[id]?.name || id);
    const isPlural = nameList.length > 1;
    const names = nameList.length === 1
    ? nameList[0]
    : nameList.slice(0, -1).join(', ') + ' et ' + nameList[nameList.length - 1];
    showToast(
      isPlural
      ? _t('fp-toast-already-synced-many', '❌ {names} synchronisent déjà leur écoute sur la tienne — tu ne peux pas démarrer ta propre synchro maintenant.', {names})
      : _t('fp-toast-already-synced-one', '❌ {names} synchronise déjà son écoute sur la tienne — tu ne peux pas démarrer ta propre synchro maintenant.', {names}),
              'error'
    );
    return false;
  }

  syncListenTarget = friend.docId;
  _syncLastTrackId = null; // force la lecture immédiate de la piste actuelle
  window._activeSyncTarget = friend.docId; // lu par pocketbase-sync.js / firebase-sync.js à la prochaine écriture
  showSyncBanner(friend);
  showToast(_t('fp-toast-synced-with', '🔗 Écoute synchronisée avec {name}', {name: friend.name}), 'success');

  const track = friend.presence?.currentTrack;
  if (track?.title) {
    playFriendTrack(track, friend.docId, friend.presence?.position || 0, true);
  }

  _forceSyncPresenceWrite();
  return true;
}

function stopSyncListen(silent) {
  if (!syncListenTarget) return;
  const name = friendsData[syncListenTarget]?.name || '';
  syncListenTarget = null;
  _syncLastTrackId = null;
  window._activeSyncTarget = null;
  hideSyncBanner();
  if (!silent) showToast(_t('fp-toast-sync-stopped', 'Écoute synchronisée arrêtée{suffix}', {suffix: name ? ' (' + name + ')' : ''}), 'info');
  _forceSyncPresenceWrite();
}

// Déclenche une écriture de présence immédiate pour propager le
// changement de window._activeSyncTarget sans attendre le prochain tick
// de l'interval (30s) ou un événement play/pause naturel.
function _forceSyncPresenceWrite() {
  const audio = document.getElementById('audioPlayer');
  const track = window.currentTrack;
  if (!audio || !track) return;
  const status = audio.paused ? 'paused' : 'playing';
  window.FirebaseSync?.updatePresence(status, track, Math.floor(audio.currentTime || 0));
}

function showSyncBanner(friend) {
  hideSyncBanner();
  const bar = document.createElement('div');
  bar.id = 'fpSyncBanner';
  bar.className = 'fp-sync-banner';
  bar.innerHTML = `
  <span class="fp-sync-dot"></span>
  <span>${_t('fp-lbl-synced-with', "Synchronisé avec")} <strong>${esc(friend.name)}</strong></span>
  <button id="fpSyncStopBtn">${_t('fp-btn-stop', "Arrêter")}</button>`;
  document.body.appendChild(bar);
  document.getElementById('fpSyncStopBtn').addEventListener('click', () => stopSyncListen());
}

function hideSyncBanner() {
  document.getElementById('fpSyncBanner')?.remove();
}

// Appelé à chaque mise à jour de présence de l'ami avec qui on synchronise
function handleSyncUpdate(docId, { status, track, position }) {
  if (status === 'offline' || status === 'stopped') {
    stopSyncListen();
    showToast(_t('fp-msg-friend-stopped-sync', '{name} a arrêté d\'écouter — synchro coupée', {name: friendsData[docId]?.name || 'Ton ami'}), 'info');
    return;
  }

  const audio = document.getElementById('audioPlayer');
  const newTrackId = track?.id || null;

  if (newTrackId && newTrackId !== _syncLastTrackId) {
    _syncLastTrackId = newTrackId;
    playFriendTrack(track, docId, position || 0, true);
    return;
  }

  // Pas de changement de piste — on ne fait que refléter play/pause
  if (!audio) return;
  if (status === 'paused' && !audio.paused) audio.pause();
  else if (status === 'playing' && audio.paused) audio.play().catch(() => {});
}

// Joue la piste d'un ami (utilisé par "Écouter" et par la synchro).
// `seekPos` : position en secondes à atteindre une fois la lecture démarrée
// (best-effort — dépend du support de l'événement 'canplay').
function playFriendTrack(track, friendDocId, seekPos, isSyncCall) {
  if (!window.playTrack) { showToast('Lecteur non disponible', 'error'); return; }
  const friendName = friendsData[friendDocId]?.name || 'ton ami';
  const lib = window.tracks;
  const found = Array.isArray(lib) ? lib.find(t => String(t.id) === String(track.id)) : null;
  const toPlay = found || track;
  const label = isSyncCall ? `Synchronisé avec ${friendName}` : `Avec ${friendName}`;

  window.playTrack(toPlay, null, label);
  if (!isSyncCall) showToast(`▶ ${toPlay.title}`);

  if (seekPos > 0) {
    const audio = document.getElementById('audioPlayer');
    if (audio) {
      const trySeek = () => {
        try { audio.currentTime = seekPos; } catch (_) {}
        audio.removeEventListener('canplay', trySeek);
      };
      audio.addEventListener('canplay', trySeek, { once: true });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TICKER DE PROGRESSION LOCALE (1 s — pas de re-render)
// Met à jour uniquement les éléments DOM de position/barre.
// onSnapshot Firestore reste la source de vérité pour position+statut.
// ═══════════════════════════════════════════════════════════════
function startProgressTicker() {
  clearInterval(progressTicker);
  progressTicker = setInterval(tickProgress, 1000);
}

function stopProgressTicker() {
  clearInterval(progressTicker);
  progressTicker = null;
}

function tickProgress() {
  if (!isOpen || activeTab !== 'activity') return;

  for (const [docId, state] of localProgress) {
    if (state.status !== 'playing') continue;

    const elapsed    = (Date.now() - state.lastUpdate) / 1000;
    const currentPos = Math.min(state.pos + elapsed, state.duration);
    const pct        = state.duration > 0
    ? Math.min((currentPos / state.duration) * 100, 100).toFixed(1)
    : '0.0';

    // Mise à jour chirurgicale du DOM uniquement
    const timeline = contentEl?.querySelector(`.fp-snippet-timeline[data-pdoc="${CSS.escape(docId)}"]`);
    if (!timeline) continue;
    const posEl  = timeline.querySelector('.fp-snippet-pos');
    const fillEl = timeline.querySelector('.fp-snippet-fill');
    if (posEl)  posEl.textContent  = fmtTime(currentPos);
    if (fillEl) fillEl.style.width = pct + '%';
  }
}

function buildFriendCard(friend) {
  const p       = friend.presence || {};
  const status  = p.status || 'stopped';
  const track   = p.currentTrack;
  const isPlaying = status === 'playing';
  const isPaused  = status === 'paused';
  const isOnline  = isPlaying || isPaused;

  const statusLabel = p.syncingWith
  ? `🔗 Synchronisé avec ${esc(friendsData[p.syncingWith]?.name || (p.syncingWith === window.FirebaseSocial?.getMyDocId?.() ? 'toi' : 'quelqu\'un'))}`
  : isPlaying ? _t('fp-lbl-listening', "En écoute") : isPaused ? _t('text-paused', "En pause") : _t('text-offline', "Hors ligne");
  const dotClass    = isPlaying ? '' : isPaused ? 'paused' : 'stopped';

  let trackSnippet = '';
  if (isOnline && track?.title) {
    const duration = track.duration || 0;
    const position = p.position || 0;

    // Lire la position depuis localProgress (source de vérité locale)
    const lp       = localProgress.get(friend.docId);
    const initPos  = lp ? Math.min(lp.pos + (Date.now() - lp.lastUpdate) / 1000, duration) : position;
    const initPct  = duration > 0 ? Math.min((initPos / duration) * 100, 100).toFixed(1) : '0.0';

    trackSnippet = `
    <div class="fp-track-snippet ${isPaused ? 'paused' : ''}"
    data-doc-id="${esc(friend.docId)}" data-track-id="${esc(track.id)}">
    <div class="fp-snippet-art">
    ${track.imageUrl
      ? `<img src="${esc(track.imageUrl)}" class="fp-snippet-cover" loading="lazy" alt="">`
      : `<div class="fp-snippet-cover-ph">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/>
      </svg>
      </div>`}
      </div>
      <div class="fp-snippet-body">
      <div class="fp-snippet-title">${esc(track.title)}</div>
      <div class="fp-snippet-artist">${esc(track.artist)}${track.album ? ` — ${esc(track.album)}` : ''}</div>
      <div class="fp-snippet-timeline" data-pdoc="${esc(friend.docId)}">
      <span class="fp-snippet-pos">${fmtTime(initPos)}</span>
      <div class="fp-snippet-bar">
      <div class="fp-snippet-fill" style="width:${initPct}%"></div>
      </div>
      <span class="fp-snippet-dur">${fmtTime(duration)}</span>
      </div>
      </div>
      </div>`;
  }

  return `
  <div class="fp-friend-card ${isPlaying ? 'is-playing' : ''}">
  <div class="fp-card-top" data-docid="${esc(friend.docId)}">
  <div class="fp-avatar" style="background:${gradientForName(friend.name)}">
  ${avatarHTML(friend.picture, friend.name)}
  </div>
  <div class="fp-card-meta">
  <div class="fp-card-name">${esc(friend.name)}</div>
  <div class="fp-card-status ${status}">${statusLabel}</div>
  </div>
  </div>
  ${trackSnippet}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// TAB: FOLLOWING
// ═══════════════════════════════════════════════════════════════
async function renderFollowing() {
  contentEl.innerHTML = `
  <div class="fp-search-wrap">
  <div class="fp-search-box">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round">
  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
  <input class="fp-search-input" id="fpSearchInput"
  placeholder="${_t('fp-ph-search-user', "Rechercher un utilisateur…")}" autocomplete="off">
  </div>
  </div>
  <div id="fpSearchResults" class="fp-search-results"></div>
  <div class="fp-section-label">${_t('fp-lbl-followed-people', "Personnes suivies")}</div>
  <div id="fpFollowingList"><span class="fp-spinner"></span></div>`;

  document.getElementById('fpSearchInput').addEventListener('input', onSearchInput);

  const list = await window.FirebaseSocial.getFollowing();
  renderUserList(list, 'fpFollowingList', true);
}

// ═══════════════════════════════════════════════════════════════
// TAB: FOLLOWERS
// ═══════════════════════════════════════════════════════════════
async function renderFollowers() {
  contentEl.innerHTML = `
  <div class="fp-section-label">${_t('fp-lbl-your-followers', "Tes abonnés")}</div>
  <div id="fpFollowersList"><span class="fp-spinner"></span></div>`;

  const list = await window.FirebaseSocial.getFollowers();
  renderUserList(list, 'fpFollowersList', false);
}

// ═══════════════════════════════════════════════════════════════
// TAB: SHARE (partager/importer)
// ═══════════════════════════════════════════════════════════════
function renderShare() {
  const playlists = Object.values(window.customPlaylists || {});

  contentEl.innerHTML = `
  <div class="fp-section-label">${_t('fp-btn-share-playlist', "Partager une playlist")}</div>
  <div style="padding:4px 12px 8px">
  <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 8px">
  Génère un code à 8 caractères pour partager ta playlist avec n'importe qui.
  </p>
  <select id="fpPlaylistSelect"
  style="width:100%;background:rgba(255,255,255,.06);border:1px solid
  rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;
  font-family:inherit;padding:9px 12px;margin-bottom:8px;
  outline:none;box-sizing:border-box">
  ${playlists.length
    ? playlists.map(pl =>
    `<option value="${esc(pl.id)}">${esc(pl.name)} (${pl.tracks?.length || 0} titres)</option>`
    ).join('')
    : ('<option value="" disabled>' + _t('fp-opt-no-playlist', "Aucune playlist créée") + '</option>')}
    </select>
    <button class="fp-share-btn" id="fpGenerateToken" ${!playlists.length ? 'disabled' : ''}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Générer un code de partage
    </button>
    <div id="fpShareTokenDisplay" style="display:none;margin-top:8px"></div>
    </div>

    <div class="fp-section-label" style="margin-top:8px">${_t('fp-btn-import-playlist', "Importer une playlist")}</div>
    <div class="fp-import-section">
    <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 8px">
    Colle le code à 14 caractères partagé par un ami.
    </p>
    <div class="fp-import-row">
    <input class="fp-import-input" id="fpImportInput"
    placeholder="${_t('fp-ph-code-long', "Code (ex: AB3X12CDXY2Z34)")}" maxlength="14">
    <button class="fp-import-btn" id="fpImportBtn">Importer</button>
    </div>
    <div id="fpImportResult" style="margin-top:8px"></div>
    </div>

    <div class="fp-section-label" style="margin-top:8px">Mode Party</div>
    <div style="padding:4px 12px 8px" id="fpPartySection">
    ${window.PocketBaseParty?.isInParty?.() ? `
      <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 8px">
      ${window.PocketBaseParty.isHost() ? _t('fp-msg-hosting-party', "Tu héberges cette Party.") : _t('fp-msg-synced-with-host', "Tu écoutes en synchro avec l'hôte.")}
      </p>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-family:monospace;font-size:20px;letter-spacing:3px;background:rgba(255,255,255,.06);
      border-radius:8px;padding:8px 14px">${esc(window.PocketBaseParty.getCurrentPartyCode() || '')}</span>
      <button class="fp-share-btn" id="fpPartyLeaveBtn" style="flex:0 0 auto">${_t('fp-btn-leave', "Quitter")}</button>
      </div>
      ` : `
      <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 8px">
      Écoutez la même musique à plusieurs, en direct. Crée une Party ou rejoins-en une avec un code.
      </p>
      <button class="fp-share-btn" id="fpPartyCreateBtn" style="margin-bottom:8px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      ${_t('fp-btn-create-party', "Créer une Party")}
      </button>
      <div class="fp-import-row">
      <input class="fp-import-input" id="fpPartyJoinInput" placeholder="${_t('fp-ph-code-short', "Code (ex: X7K2QP)")}" maxlength="6" style="text-transform:uppercase">
      <button class="fp-import-btn" id="fpPartyJoinBtn">${_t('fp-btn-join', "Rejoindre")}</button>
      </div>
      `}
      <div id="fpPartyResult" style="margin-top:8px"></div>
      </div>`;

      document.getElementById('fpGenerateToken').addEventListener('click', async () => {
        const sel = document.getElementById('fpPlaylistSelect');
        const playlistId = sel?.value;
        if (!playlistId) return;

        const btn = document.getElementById('fpGenerateToken');
        btn.textContent = _t('fp-status-generating', "Génération…");
        btn.disabled = true;

        const token = await window.FirebaseSocial.sharePlaylist(playlistId);
        btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
        <circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Générer un nouveau code`;
        btn.disabled = false;

        if (token) {
          const display = document.getElementById('fpShareTokenDisplay');
          display.style.display = 'block';
          display.dataset.shareToken = token;   // stocker pour la délégation

          const copyBtn = document.createElement('button');
          copyBtn.className = 'fp-token-copy';
          copyBtn.title = 'Copier le code';
          copyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>`;

          const codeSpan = document.createElement('span');
          codeSpan.className = 'fp-token-code';
          codeSpan.textContent = token;

          const row = document.createElement('div');
          row.className = 'fp-token-display';
          row.style.cssText = 'width:100%;box-sizing:border-box';
          row.appendChild(codeSpan);
          row.appendChild(copyBtn);

          display.innerHTML = '';
          display.appendChild(row);

          // Listener direct sur l'élément créé — pas de getElementById après innerHTML
          copyBtn.addEventListener('click', () => {
            const code = display.dataset.shareToken;
            if (!code) return;
            if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(code)
              .then(() => {
                copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#1DB954"
                stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
                showToast(_t('toast-code-copied-clipboard', "✅ Code copié dans le presse-papier"));
                setTimeout(() => {
                  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  width="14" height="14">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>`;
                }, 2000);
              })
              .catch(() => {
                // Fallback: sélectionner le texte
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(codeSpan);
                sel.removeAllRanges();
                sel.addRange(range);
                showToast(`Code : ${code} — Copier manuellement`);
              });
            } else {
              // HTTP context fallback
              const ta = document.createElement('textarea');
              ta.value = code;
              ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
              document.body.appendChild(ta);
              ta.focus(); ta.select();
              document.execCommand('copy');
              ta.remove();
              showToast(_t('toast-code-copied-short', "✅ Code copié !"));
            }
          });
        } else {
          showToast('Erreur lors du partage', 'error');
        }
      });

      document.getElementById('fpImportBtn').addEventListener('click', async () => {
        const input = document.getElementById('fpImportInput');
        const token = input.value.trim();
        if (!token || token.length < 4) {
          showToast(_t('toast-invalid-code', "Saisis un code valide"), 'error');
          return;
        }

        const btn = document.getElementById('fpImportBtn');
        btn.textContent = '…';
        btn.disabled = true;

        const result = await window.FirebaseSocial.importSharedPlaylist(token);
        btn.textContent = 'Importer';
        btn.disabled = false;

        // Nettoyer le suffixe "(par X)" immédiatement après l'import
        await _stripParSuffix();

        const resultEl = document.getElementById('fpImportResult');
        if (result) {
          input.value = '';
          resultEl.innerHTML = `
          <div style="background:rgba(29,185,84,.1);border:1px solid rgba(29,185,84,.25);
          border-radius:8px;padding:8px 12px;font-size:12px;color:#1DB954">
          ✅ <strong>${esc(result.name)}</strong> importée depuis ${esc(result.sharedByName)}
          </div>`;
          // Refresh sidebar
          if (typeof window.renderSidebarView === 'function') {
            window.renderSidebarView('playlists');
          }
          showToast(`Playlist "${result.name}" importée !`);
        } else {
          resultEl.innerHTML = `
          <div style="background:rgba(220,80,80,.1);border:1px solid rgba(220,80,80,.25);
          border-radius:8px;padding:8px 12px;font-size:12px;color:#ff6b6b">
          ❌ Code invalide ou playlist introuvable.
          </div>`;
          showToast('Code invalide', 'error');
        }
      });

      // ── Mode Party (P3-2) ──────────────────────────────────────────
      const partyResultEl = document.getElementById('fpPartyResult');

      // ⚠️ Garde-fou générique (le vrai bug était l'oubli du <script> dans
      // index.html, corrigé séparément) : distingue quand même "module
      // absent" de "appel refusé", au cas où un build oublierait à nouveau
      // ce fichier ou le chargerait dans le mauvais ordre.
      function _partyUnavailable() {
        if (partyResultEl) partyResultEl.innerHTML = `
          <div style="background:rgba(220,80,80,.1);border:1px solid rgba(220,80,80,.25);
        border-radius:8px;padding:8px 12px;font-size:12px;color:#ff6b6b">
        ❌ Mode Party indisponible (module non chargé). Vérifie index.html.
        </div>`;
        showToast(_t('toast-party-mode-unavailable', "❌ Mode Party indisponible (module non chargé)"), 'error');
      }

      document.getElementById('fpPartyCreateBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!window.PocketBaseParty?.createParty) { _partyUnavailable(); return; }
        btn.disabled = true; btn.textContent = 'Création…';
        const code = await window.PocketBaseParty.createParty();
        if (code) {
          showToast(_t('toast-party-created', '🎉 Party créée — code {code}', {code}), 'success');
          renderShare(); // re-render pour afficher l'état "en Party"
        } else {
          btn.disabled = false; btn.textContent = 'Créer une Party';
          if (partyResultEl) partyResultEl.innerHTML = `
            <div style="background:rgba(220,80,80,.1);border:1px solid rgba(220,80,80,.25);
          border-radius:8px;padding:8px 12px;font-size:12px;color:#ff6b6b">
          ${_t('fp-msg-party-create-failed', '❌ Impossible de créer la Party. Réessaie dans un instant.')}
          </div>`;
        }
      });

      document.getElementById('fpPartyJoinBtn')?.addEventListener('click', async () => {
        if (!window.PocketBaseParty?.joinParty) { _partyUnavailable(); return; }
        const input = document.getElementById('fpPartyJoinInput');
        const code = (input?.value || '').trim();
        if (code.length < 4) { showToast(_t('toast-invalid-code', "Saisis un code valide"), 'error'); return; }
        const btn = document.getElementById('fpPartyJoinBtn');
        btn.textContent = '…'; btn.disabled = true;
        const ok = await window.PocketBaseParty.joinParty(code);
        btn.textContent = 'Rejoindre'; btn.disabled = false;
        if (ok) {
          showToast(_t('toast-party-joined', '🔗 Party rejointe !'), 'success');
          renderShare();
        } else if (partyResultEl) {
          partyResultEl.innerHTML = `
          <div style="background:rgba(220,80,80,.1);border:1px solid rgba(220,80,80,.25);
          border-radius:8px;padding:8px 12px;font-size:12px;color:#ff6b6b">
          ❌ Code invalide ou Party terminée.
          </div>`;
        }
      });

      document.getElementById('fpPartyLeaveBtn')?.addEventListener('click', async () => {
        if (!window.PocketBaseParty?.leaveParty) { _partyUnavailable(); return; }
        await window.PocketBaseParty.leaveParty();
        showToast(_t('toast-party-left', "Party quittée"), 'info');
        renderShare();
      });
}

// ═══════════════════════════════════════════════════════════════
// USER LIST (following / followers)
// ═══════════════════════════════════════════════════════════════
// Bouton Suivre/Suivi centralisé — évite toute divergence entre les
// différents endroits où il est rendu (liste, recherche, mise à jour
// après clic). État "Suivi" = icône compacte (✓ au repos, ✕ au survol),
// pour ne pas surcharger l'interface avec un pavé de texte partout.
// Bouton Suivre/Suivi centralisé — évite toute divergence entre les
// différents endroits où il est rendu (liste, recherche, mise à jour
// après clic). État "Suivi" = icône compacte, un SEUL <svg> affiché à
// la fois : ✓ au repos, remplacé par ✕ au survol (et inversement à la
// sortie du survol) — voir _bindFollowIconHover(), pas les deux icônes
// superposées/masquées en CSS comme avant.
function _followIconCheck() {
  return '<svg class="fp-follow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}
function _followIconX() {
  return '<svg class="fp-follow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}
// À appeler juste après avoir inséré/mis à jour un bouton en état
// "following" dans le DOM — pose le survol qui échange l'icône.
function _bindFollowIconHover(btn) {
  const wrap = btn?.querySelector('.fp-follow-icon-wrap');
  if (!wrap) return;
  btn.addEventListener('mouseenter', () => {
    if (btn.classList.contains('following')) wrap.innerHTML = _followIconX();
  });
    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('following')) wrap.innerHTML = _followIconCheck();
    });
}
function followBtnHTML(isFollowing, docId) {
  const icon = `<span class="fp-follow-icon-wrap">${_followIconCheck()}</span>`;
  return `<button class="fp-follow-btn ${isFollowing ? 'following' : ''}" data-doc-id="${esc(docId)}" title="${isFollowing ? 'Ne plus suivre' : _t('fp-btn-follow', "Suivre")}">
  ${isFollowing ? icon : `<span class="fp-follow-btn-label">${_t('fp-btn-follow', "Suivre")}</span>`}
  </button>`;
}

async function renderUserList(users, containerId, showUnfollow) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!users.length) {
    container.innerHTML = `
    <div class="fp-empty" style="padding:16px">
    <span class="fp-empty-icon" style="font-size:24px">
    ${showUnfollow ? '🔍' : '👋'}
    </span>
    ${showUnfollow
      ? 'Tu ne suis personne encore.<br>Recherche un utilisateur ci-dessus.'
      : 'Personne ne te suit encore.'}
      </div>`;
      return;
  }

  // ── (Code mort retiré) ────────────────────────────────────────────
  // L'ancien bloc d'enrichissement Firestore (lecture directe
  // db.collection('users').where(documentId,'in',ids).get()) est
  // supprimé : PocketBaseSocial.getFollowing()/getFollowers()
  // (normalizeUser()) renvoient déjà name/picture à jour directement
  // depuis PocketBase — cette relecture était devenue redondante.

  // Pour les abonnés, vérifier lesquels on suit déjà (suivi mutuel)
  // ── Corrigé : UNE seule requête groupée (getFollowing) au lieu d'un
  //    isFollowing(u.docId) par utilisateur affiché. Chaque appel à
  //    isFollowing() relit "follows" avec un filtre dédié (+ un aller-
  //    retour resolvePbId caché derrière) — pour une liste de N abonnés,
  //    c'était N requêtes réseau en parallèle pour une info qu'une
  //    seule requête "ma liste d'abonnements" suffit à donner. ────────
  let followStatus = {};
  if (!showUnfollow && window.FirebaseSocial?.getFollowing) {
    try {
      const myFollowing = await window.FirebaseSocial.getFollowing();
      const followingIds = new Set(myFollowing.map(u => u.docId));
      users.forEach(u => { followStatus[u.docId] = followingIds.has(u.docId); });
    } catch (_) { /* échec réseau — on retombe silencieusement sur "aucun suivi connu" */ }
  }

  let html = '';
  for (const user of users) {
    const isAlreadyFollowing = showUnfollow || followStatus[user.docId] === true;
    html += `
    <div class="fp-friend-card">
    <div class="fp-card-top">
    <div class="fp-avatar" style="background:${gradientForName(user.name)}">
    ${avatarHTML(user.picture, user.name)}
    </div>
    <div class="fp-card-meta">
    <div class="fp-card-name">${esc(user.name)}</div>
    <div class="fp-card-status" style="color:var(--text-subdued, rgba(255,255,255,0.4));font-size:11px">
    Utilisateur Beartify
    </div>
    </div>
    ${followBtnHTML(isAlreadyFollowing, user.docId)}
    </div>
    </div>`;
  }
  container.innerHTML = html;

  // Bind follow/unfollow buttons
  container.querySelectorAll('.fp-follow-btn').forEach(btn => {
    btn.addEventListener('click', () => onFollowBtnClick(btn));
    _bindFollowIconHover(btn);
  });

  // Bind profile page on avatar+name click
  container.querySelectorAll('.fp-friend-card').forEach(card => {
    const docId = card.querySelector('.fp-follow-btn')?.dataset.docId;
    if (!docId) return;
    const top = card.querySelector('.fp-card-top');
    if (!top) return;
    top.style.cursor = 'pointer';
    top.addEventListener('click', e => {
      if (e.target.closest('.fp-follow-btn')) return;
      const name    = card.querySelector('.fp-card-name')?.textContent || docId;
      const picture = card.querySelector('.fp-avatar img')?.src || '';
      const fd      = friendsData[docId] || { docId, name, picture, presence: null };
      openProfilePage(fd);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════
function onSearchInput(e) {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('fpSearchResults');
  if (!resultsEl) return;

  if (!q || q.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.innerHTML = '<span class="fp-spinner" style="margin:8px auto"></span>';
  searchDebounce = setTimeout(() => doSearch(q, resultsEl), 450);
}

async function doSearch(query, resultsEl) {
  const results = await window.FirebaseSocial.searchUser(query);
  if (!resultsEl.isConnected) return; // panel may have been closed

  if (!results.length) {
    resultsEl.innerHTML = `
    <div style="padding:8px 4px;font-size:12px;color:rgba(255,255,255,.4)">
    Aucun résultat pour "${esc(query)}"
    </div>`;
    return;
  }

  // Pre-check follow status for all results
  // ── Même correctif que plus haut : une seule requête groupée au lieu
  //    d'un isFollowing() par résultat de recherche. ──────────────────
  let followingIds = new Set();
  try {
    const myFollowing = await window.FirebaseSocial.getFollowing();
    followingIds = new Set(myFollowing.map(u => u.docId));
  } catch (_) { /* échec réseau — on retombe sur "aucun suivi connu" */ }

  let html = '';
  results.forEach((user) => {
    const isFollowing = followingIds.has(user.docId);
    html += `
    <div class="fp-search-result-item">
    <div class="fp-avatar" style="background:${gradientForName(user.name)}">
    ${avatarHTML(user.picture, user.name)}
    </div>
    <div class="fp-search-result-meta">
    <div class="fp-search-result-name">${esc(user.name)}</div>
    <div class="fp-search-result-sub">Utilisateur Beartify</div>
    </div>
    ${followBtnHTML(isFollowing, user.docId)}
    </div>`;
  });
  resultsEl.innerHTML = html;
  resultsEl.querySelectorAll('.fp-follow-btn').forEach(btn => {
    btn.addEventListener('click', () => onFollowBtnClick(btn, true));
    _bindFollowIconHover(btn);
  });
}

// ═══════════════════════════════════════════════════════════════
// FOLLOW / UNFOLLOW BUTTON HANDLER
// ═══════════════════════════════════════════════════════════════
async function onFollowBtnClick(btn, isSearchResult = false) {
  const docId   = btn.dataset.docId;
  if (!docId) return;
  btn.disabled = true;

  const wasFollowing = btn.classList.contains('following');

  if (wasFollowing) {
    const ok = await window.FirebaseSocial.unfollowUser(docId);
    if (ok) {
      btn.classList.remove('following');
      btn.title = _t('fp-btn-follow', "Suivre");
      btn.innerHTML = '<span class="fp-follow-btn-label">' + _t('fp-btn-follow', "Suivre") + '</span>';
      // Remove from local friendsData
      delete friendsData[docId];
      showToast(_t('fp-status-unfollowed', "Désabonné"));
      if (activeTab === 'following') renderContent();
    }
  } else {
    const ok = await window.FirebaseSocial.followUser(docId);
    if (ok) {
      btn.classList.add('following');
      btn.title = 'Ne plus suivre';
      btn.innerHTML = `<span class="fp-follow-icon-wrap">${_followIconCheck()}</span>`;
      _bindFollowIconHover(btn);
      showToast('✅ Suivi !');
      // Redémarre l'écoute complète avec la liste à jour (inclut le nouvel ami)
      startFriendListeners();
      if (activeTab === 'following') setTimeout(renderContent, 500);
    }
  }
  btn.disabled = false;
}

// ═══════════════════════════════════════════════════════════════
// REALTIME PRESENCE LISTENERS
// ═══════════════════════════════════════════════════════════════
async function startFriendListeners() {
  stopFriendListeners();

  const [following, followers] = await Promise.all([
    window.FirebaseSocial.getFollowing(),
                                                   window.FirebaseSocial.getFollowers(),
  ]);

  _friendsListReady = true;
  _followingIds = new Set(following.map(f => f.docId));

  // Seed friendsData avec les profils des personnes qu'on SUIT (affichées
  // dans l'onglet "En écoute"). Les abonnés ne sont pas affichés dans cet
  // onglet mais on a besoin de recevoir leur présence pour détecter s'ils
  // synchronisent leur écoute sur la nôtre (cf. plus bas).
  following.forEach(f => {
    if (!friendsData[f.docId]) {
      friendsData[f.docId] = { docId: f.docId, name: f.name, picture: f.picture, presence: null };
    }
  });
  followers.forEach(f => {
    if (!friendsData[f.docId]) {
      friendsData[f.docId] = { docId: f.docId, name: f.name, picture: f.picture, presence: null };
    }
  });

  // ⚠️ CORRECTIF : sans ce ré-affichage immédiat, le panel restait bloqué
  // sur "Aucun ami suivi" (l'état capturé au moment du tout premier
  // rendu synchrone dans openPanel(), avant que cette fonction async
  // n'ait fini de peupler friendsData) jusqu'à ce qu'un événement de
  // présence arrive naturellement ou qu'on change d'onglet.
  if (activeTab === 'activity' && isOpen) renderActivity();

  // ⚠️ Un SEUL appel avec la liste complète (pas un par ami) : la version
  // Native de listenToFriends réinitialise tous les listeners à chaque
  // appel — l'appeler en boucle par ami écraserait les précédents en
  // mode secours. On s'abonne à l'union suivis+abonnés.
  const allIds = new Set([...following.map(f => f.docId), ...followers.map(f => f.docId)]);
  subscribeToFriendsPresence([...allIds]);

  // Le ticker local (1 s) démarre dans renderActivity() si l'onglet est ouvert.

  // ⚠️ CORRECTIF : sans ceci, localProgress (vidée à la fermeture du panel —
  // voir stopFriendListeners()) ne se réalimente QUE via un nouvel
  // événement temps réel — donc seulement quand la présence d'un ami
  // change réellement côté serveur. Si un ami écoute déjà le même morceau
  // sans que rien ne change entre la fermeture et la réouverture du
  // panel, aucun événement n'arrive : le ticker n'a rien à faire avancer
  // et l'affichage reste figé sur la dernière position connue. On
  // réamorce donc localProgress ici depuis les données de présence déjà
  // en cache (friendsData), avec leur timestamp d'origine, pour que le
  // ticker reprenne immédiatement le calcul de la position réelle au
  // lieu d'attendre la prochaine écriture.
  allIds.forEach(docId => {
    const p = friendsData[docId]?.presence;
    if (!p || localProgress.has(docId)) return;
    if (p.status !== 'playing' && p.status !== 'paused') return;
    localProgress.set(docId, {
      pos:        p.position || 0,
      lastUpdate: p.timestamp || Date.now(),
                      status:     p.status,
                      duration:   p.currentTrack?.duration || 0,
                      trackId:    p.currentTrack?.id || null,
    });
  });
}

function subscribeToFriendsPresence(friendIds) {
  if (!friendIds.length) return;

  const unsubscribe = window.FirebaseSync?.listenToFriends(friendIds, (docId, record) => {
    if (!record) {
      if (friendsData[docId]) friendsData[docId].presence = null;
      _syncedToMeBy.delete(docId);
      return;
    }

    // Normalise les deux formats possibles :
    //   PocketBase : { status, track, position, updatedAt, syncingWith }
    //   Firestore  : { status, currentTrack, position, syncingWith }
    const currentTrack = record.track || record.currentTrack || null;
    let   newStatus     = record.status || 'stopped';
    const newTrackId   = currentTrack?.id || null;
    const newPosition  = record.position || 0;
    const newSyncing   = record.syncingWith || null;
    const now          = Date.now();

    // ⚠️ CORRECTIF : rien ne marque jamais un ami hors ligne si son app se
    // ferme brutalement (crash, tab tuée, perte réseau, app mobile mise en
    // arrière-plan puis tuée par l'OS) — le pause/ended/beacon de fermeture
    // ne se déclenche alors jamais, et son dernier "playing" écrit reste
    // figé en base pour toujours. L'écriture normale a lieu toutes les 30s
    // (PRESENCE_INTERVAL_MS côté pocketbase-sync.js) tant que la lecture
    // est active — on considère donc périmé (donc hors ligne) tout statut
    // "playing"/"paused" dont l'enregistrement n'a pas été mis à jour
    // depuis plus de 90s (3× la marge), plutôt que de faire confiance
    // aveuglément à la valeur stockée.
    // ⚠️ BUG TROUVÉ ICI : le repli `: now` faisait qu'en l'absence du champ
    // `record.updated` (jamais confirmé comme réellement transmis par le
    // SDK PocketBase sur les events temps réel — doute que j'avais soulevé
    // sans le vérifier), la donnée était considérée comme fraîche à 0ms
    // TOUJOURS — donc la vérification d'ancienneté ne se déclenchait
    // JAMAIS, et un fantôme "playing" figé restait affiché indéfiniment.
    // Le repli inverse (0 → considéré infiniment vieux) fait qu'en cas de
    // doute sur la fraîcheur, on affiche hors ligne par défaut plutôt que
    // ce fantôme permanent — pire cas : un ami réellement actif clignote
    // hors ligne un instant si updated manque, largement préférable.
    const STALE_MS = 90000;
    const updatedAtMs = record.updated ? new Date(record.updated).getTime() : 0;
    if ((newStatus === 'playing' || newStatus === 'paused') && (now - updatedAtMs) > STALE_MS) {
      newStatus = 'stopped';
    }

    if (!friendsData[docId]) {
      friendsData[docId] = { docId, name: docId, picture: '', presence: null };
    }

    const prevStatus  = friendsData[docId].presence?.status;
    const prevTrackId = friendsData[docId].presence?.currentTrack?.id;

    friendsData[docId].presence = {
      status:       newStatus,
      currentTrack: currentTrack,
      position:     newPosition,
      syncingWith:  newSyncing,
      timestamp:    now,
    };

    // ── Détection : cet ami synchronise-t-il SON écoute sur LA MIENNE ? ──
    const myDocId = window.FirebaseSocial?.getMyDocId?.();
    if (newSyncing && myDocId && newSyncing === myDocId) {
      _syncedToMeBy.add(docId);
    } else {
      _syncedToMeBy.delete(docId);
    }

    localProgress.set(docId, {
      pos:        newPosition,
      lastUpdate: now,
      status:     newStatus,
      duration:   currentTrack?.duration || 0,
      trackId:    newTrackId,
    });

    const trackChanged  = newTrackId  !== prevTrackId;
    const statusChanged = newStatus   !== prevStatus;

    if ((trackChanged || statusChanged) && activeTab === 'activity' && isOpen && _followingIds.has(docId)) {
      renderActivity();
    }

    // ── Popup ouvert sur cet ami : le rafraîchir en direct plutôt que de
    // le laisser figé sur l'ancienne piste ──────────────────────────────
    if (docId === _openModalDocId) {
      refreshOpenFriendModal(friendsData[docId]);
    }

    // ── Écoute synchronisée : si on synchronise avec CET ami, on réplique ──
    if (docId === syncListenTarget) {
      handleSyncUpdate(docId, { status: newStatus, track: currentTrack, position: newPosition });
    }
  });

  if (typeof unsubscribe === 'function') {
    presenceListeners.push(unsubscribe);
  } else if (unsubscribe && typeof unsubscribe.then === 'function') {
    unsubscribe.then(fn => { if (typeof fn === 'function') presenceListeners.push(fn); });
  }
}

function stopFriendListeners() {
  presenceListeners.forEach(u => u?.());
  presenceListeners = [];
  stopProgressTicker();
  localProgress.clear();
}

// ═══════════════════════════════════════════════════════════════
// PATCH AUDIO PLAYER — mises à jour immédiates de la présence
// ═══════════════════════════════════════════════════════════════
let _presencePatched = false;
function patchAudioPresence() {
  if (_presencePatched) return;
  _presencePatched = true;

  const audio = document.getElementById('audioPlayer');
  if (!audio) return;

  // Mise à jour immédiate sur play
  audio.addEventListener('play', () => {
    const t = window.currentTrack;
    if (!t) return;
    window.FirebaseSocial?.updatePresenceWithProfile('playing', t, Math.floor(audio.currentTime));
  });

  // Mise à jour immédiate sur pause
  audio.addEventListener('pause', () => {
    const t = window.currentTrack;
    if (!t) return;
    window.FirebaseSocial?.updatePresenceWithProfile('paused', t, Math.floor(audio.currentTime));
  });

  // Mise à jour sur fin de piste
  audio.addEventListener('ended', () => {
    window.FirebaseSocial?.updatePresenceWithProfile('stopped', null, 0);
  });

  // ⚠️ SUPPRIMÉ : l'ancien interval de 5s qui dupliquait l'écriture de
  // présence en plus de celui de pocketbase-sync.js (30s). Un seul
  // interval suffit désormais — voir FirebaseSync.enablePresenceSync().
  // Ne pas en rajouter un ici, c'était la cause principale du
  // dépassement de quota identifié précédemment.

  // ── Présence "stopped" à la fermeture réelle de l'onglet uniquement ──
  // ⚠️ CORRECTIF : on ne se base plus sur "visibilitychange" pour marquer
  // hors ligne — cet événement se déclenche aussi en changeant simplement
  // de fenêtre/application (alt-tab), alors que la musique continue de
  // jouer en arrière-plan. Ça rendait les amis "hors ligne" à tort dès
  // qu'ils changeaient de fenêtre. On ne marque désormais hors ligne
  // qu'à la fermeture réelle de l'onglet (pagehide/beforeunload).
  function _sendStoppedBeacon() {
    const recordId = window._myPresenceRecordId;
    const client = window.PocketBaseConfig?.getClient();
    if (!recordId || !client) return;
    try {
      fetch(`/api/pb/api/collections/presence/records/${recordId}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': client.authStore.token,
        },
        body: JSON.stringify({ status: 'offline', track: null }),
      }).catch(() => {});
    } catch (_) {}
  }

  // pagehide : se déclenche à la fermeture de l'onglet ou à la navigation
  // (y compris mise en bfcache) — beaucoup plus fiable que beforeunload
  // seul sur mobile, et surtout NE se déclenche PAS sur un simple alt-tab.
  window.addEventListener('pagehide', _sendStoppedBeacon);
  window.addEventListener('beforeunload', _sendStoppedBeacon);


  console.log('[FriendsPanel] ✅ Présence audio patchée (5s interval + événements immédiats)');
}

// ═══════════════════════════════════════════════════════════════
// EXPOSE — override window._showFriendsActivity
// ═══════════════════════════════════════════════════════════════
window._showFriendsActivity = function () {
  if (!isOpen) openPanel();
  else         closePanel();
};

// Utilisé par mobile/mobile-friends.js : au clic sur une carte du
// widget léger, ouvre le même popup complet (Écouter / File d'attente
// / Playlist / Écoute synchronisée) que le panneau complet, plutôt que
// de réimplémenter cette logique (état de lecture, file d'attente,
// playlists, synchronisation) qui est loin d'être une simple question
// de rendu. `friend` doit avoir la forme { docId, name, picture,
// presence: { status, currentTrack, position } } — exactement ce que
// mobile-friends.js construit déjà pour son propre rendu.
window._openFriendTrackModal = openFriendTrackModal;

// Permet à la recherche principale d'ouvrir directement un profil
window._openFriendProfile = function(friendObj) {
  if (!panel) buildPanel();
  openProfilePage(friendObj);
};

// Échap : ferme d'abord le popup "musique en cours" s'il est ouvert,
// sinon ferme le panel (un appui = une fermeture à la fois, pas les deux
// d'un coup).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('fpTrackModal');
  if (modal) { _openModalDocId = null; modal.remove(); return; }
  if (isOpen) closePanel();
});

// ═══════════════════════════════════════════════════════════════
// INIT — s'assurer que le panel est prêt après le chargement
// ═══════════════════════════════════════════════════════════════
function init() {
  buildPanel();

  // Patcher la présence audio dès maintenant (même si panel fermé)
  patchAudioPresence();

  console.log('[FriendsPanel] ✅ Panel initialisé');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('[FriendsPanel] Module chargé ✅');
})();
