/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          Beartify — Friends Activity Panel                  ║
 * ║   Activité temps réel · Follow/Unfollow · Partage           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Remplace window._showFriendsActivity par un vrai panneau.
 * Se monte sur le DOM après le chargement de la page.
 *
 * Dépendances :
 *   firebase-config.js   → window.FirebaseConfig
 *   firebase-sync.js     → window.FirebaseSync
 *   firebase-social.js   → window.FirebaseSocial
 */

(function () {
  'use strict';

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

    // Backdrop visuel (derrière le panel, z-index 198)
    backdrop = document.createElement('div');
    backdrop.id = 'friendsPanelBackdrop';
    // Pas de listener sur le backdrop lui-même — on utilise un listener
    // document pour éviter tout conflit de z-index (voir _onDocClick).
    document.body.appendChild(backdrop);

    // Panel
    panel = document.createElement('div');
    panel.id = 'friendsPanel';
    panel.setAttribute('aria-label', 'Activité des amis');
    panel.innerHTML = `
      <div class="fp-header">
        <span class="fp-header-title">Activité des amis</span>
        <button class="fp-close-btn" id="fpCloseBtn" aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="fp-tabs">
        <button class="fp-tab active" data-tab="activity">En écoute</button>
        <button class="fp-tab" data-tab="following">Je suis</button>
        <button class="fp-tab" data-tab="followers">Abonnés</button>
        <button class="fp-tab" data-tab="share">Partager</button>
      </div>

      <div class="fp-content" id="fpContent"></div>

      <div class="fp-footer" id="fpFooter" style="display:none">
        <button class="fp-share-btn" id="fpOpenShareModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          Partager une playlist
        </button>
      </div>
    `;

    document.body.appendChild(panel);
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
    document.getElementById('fpOpenShareModal').addEventListener('click', openShareModal);
  }

  // ═══════════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════════
  // Listener document pour détecter les clics à l'extérieur du panel.
  // Attaché/détaché à l'ouverture/fermeture pour ne pas tourner inutilement.
  function _onDocClick(e) {
    if (!isOpen) return;
    // Ignorer si le clic est à l'intérieur du panel ou de ses modales
    if (panel?.contains(e.target)) return;
    if (document.getElementById('fpProfilePage')?.contains(e.target)) return;
    if (document.getElementById('fpListenConfirm')?.contains(e.target)) return;
    if (document.getElementById('fpProfileModal')?.contains(e.target)) return;
    // Ignorer le bouton qui ouvre le panel (géré par _showFriendsActivity)
    if (document.getElementById('btnFriends')?.contains(e.target)) return;
    closePanel();
  }

  function openPanel() {
    if (!panel) buildPanel();
    isOpen = true;
    panel.classList.add('open');
    backdrop.classList.add('open');
    document.getElementById('btnFriends')?.classList.add('active');
    renderContent();
    startFriendListeners();
    patchAudioPresence();
    // Délai pour éviter que le clic d'ouverture déclenche immédiatement la fermeture
    setTimeout(() => document.addEventListener('click', _onDocClick, true), 150);
  }

  function closePanel() {
    isOpen = false;
    panel?.classList.remove('open');
    backdrop?.classList.remove('open');
    document.getElementById('btnFriends')?.classList.remove('active');
    stopFriendListeners();
    document.removeEventListener('click', _onDocClick, true);
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER DISPATCHER
  // ═══════════════════════════════════════════════════════════════
  function renderContent() {
    if (!contentEl) return;
    const db = window.FirebaseConfig?.getDB();
    const myId = window.FirebaseSocial?.getMyDocId?.();

    if (!myId) {
      contentEl.innerHTML = `
        <div class="fp-empty">
          <span class="fp-empty-icon">🔒</span>
          <strong>Connexion requise</strong><br>
          Connecte-toi pour voir l'activité de tes amis.
        </div>`;
      return;
    }

    switch (activeTab) {
      case 'activity':  renderActivity();  break;
      case 'following': renderFollowing(); break;
      case 'followers': renderFollowers(); break;
      case 'share':     renderShare();     break;
    }

    // Footer share button: only on activity tab
    const footer = document.getElementById('fpFooter');
    if (footer) footer.style.display = activeTab === 'activity' ? 'block' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB: ACTIVITY (En écoute en temps réel)
  // ═══════════════════════════════════════════════════════════════
  let _wipDismissed = false;  // Banner WIP dismissed for this session

  function renderActivity() {
    const friends = Object.values(friendsData);

    // ── Bannière WIP ──────────────────────────────────────────
    const wipHtml = _wipDismissed ? '' : `
      <div class="fp-wip-banner" id="fpWipBanner">
        <span class="fp-wip-icon">🚧</span>
        <span class="fp-wip-text">
          <strong>Fonctionnalité en cours de développement</strong><br>
          Certaines parties peuvent ne pas fonctionner.
        </span>
        <button class="fp-wip-close" id="fpWipClose" aria-label="Fermer">✕</button>
      </div>`;

    if (!friends.length) {
      contentEl.innerHTML = wipHtml + `
        <div class="fp-empty">
          <span class="fp-empty-icon">👥</span>
          <strong>Aucun ami suivi</strong><br>
          Suis des utilisateurs depuis l'onglet<br>
          <em>Je suis</em> pour voir leur activité.
        </div>`;
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
    if (hasActive) html += `<div class="fp-section-label">Écoute en cours</div>`;
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

  // ═══════════════════════════════════════════════════════════════
  // PROFIL — PAGE COMPLÈTE (slide depuis le panel)
  // ═══════════════════════════════════════════════════════════════
  function openProfilePage(friend) {
    // Fermer toute page de profil existante
    document.getElementById('fpProfilePage')?.remove();

    const p         = friend.presence || {};
    const status    = p.status || 'stopped';
    const track     = p.currentTrack;
    const isPlaying = status === 'playing';
    const isPaused  = status === 'paused';
    const isOnline  = isPlaying || isPaused;

    // Couleur de statut
    const statusColor = isPlaying ? '#1DB954' : isPaused ? '#faad14' : 'rgba(255,255,255,0.3)';
    const statusText  = isPlaying ? 'En écoute' : isPaused ? 'En pause' : 'Hors ligne';

    // Carte de musique (si présente)
    let trackHtml = '';
    if (isOnline && track?.title) {
      const lp      = localProgress.get(friend.docId);
      const dur     = track.duration || 0;
      const pos     = lp ? Math.min(lp.pos + (Date.now() - lp.lastUpdate) / 1000, dur) : (p.position || 0);
      const pct     = dur > 0 ? Math.min((pos / dur) * 100, 100).toFixed(1) : '0.0';
      trackHtml = `
        <div class="fp-pp-section-label">${isPlaying ? '🎵 Écoute en cours' : '⏸ En pause'}</div>
        <div class="fp-pp-track" id="fpPpTrack" data-docid="${esc(friend.docId)}" data-trackid="${esc(track.id)}">
          ${track.imageUrl
            ? `<img src="${esc(track.imageUrl)}" class="fp-pp-track-cover" alt="">`
            : `<div class="fp-pp-track-cover-ph">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                   <circle cx="12" cy="12" r="10"/>
                   <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/>
                 </svg>
               </div>`}
          <div class="fp-pp-track-meta">
            <div class="fp-pp-track-title">${esc(track.title)}</div>
            <div class="fp-pp-track-sub">${esc(track.artist)}${track.album ? ' — ' + esc(track.album) : ''}</div>
            <div class="fp-pp-timeline">
              <span class="fp-pp-pos" data-pp-pos="${esc(friend.docId)}">${fmtTime(pos)}</span>
              <div class="fp-pp-bar"><div class="fp-pp-fill ${isPaused?'paused':''}" data-pp-fill="${esc(friend.docId)}" style="width:${pct}%"></div></div>
              <span class="fp-pp-dur">${fmtTime(dur)}</span>
            </div>
          </div>
          ${isPlaying ? `<div class="fp-pp-wave"><span></span><span></span><span></span><span></span></div>` : ''}
        </div>
        <button class="fp-pp-listen-btn" id="fpPpListenBtn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
          Écouter ce titre
        </button>`;
    }

    // Construire la page
    const page = document.createElement('div');
    page.id = 'fpProfilePage';
    page.className = 'fp-profile-page';
    page.innerHTML = `
      <div class="fp-pp-topbar">
        <button class="fp-pp-back" id="fpPpBack" aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" width="16" height="16">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour
        </button>
      </div>

      <div class="fp-pp-hero">
        <div class="fp-pp-avatar" style="background:${gradientForName(friend.name)}">
          ${avatarHTML(friend.picture, friend.name, 72)}
        </div>
        <div class="fp-pp-name">${esc(friend.name)}</div>
        <div class="fp-pp-status-row">
          <span class="fp-pp-status-dot" style="background:${statusColor}"></span>
          <span class="fp-pp-status-label" style="color:${statusColor}">${statusText}</span>
        </div>
        <div class="fp-pp-follow-row" id="fpPpFollowRow">
          <button class="fp-pp-follow-btn" id="fpPpFollowBtn" data-docid="${esc(friend.docId)}" disabled>
            <span>…</span>
          </button>
        </div>
      </div>

      <div class="fp-pp-body">
        ${trackHtml || `<div class="fp-pp-empty">Aucune écoute en cours.</div>`}
      </div>`;

    // Insérer dans le panel (par-dessus le contenu)
    panel.appendChild(page);
    // Trigger animation
    requestAnimationFrame(() => page.classList.add('open'));

    // Retour
    document.getElementById('fpPpBack').addEventListener('click', () => {
      page.classList.remove('open');
      setTimeout(() => page.remove(), 250);
    });

    // Écouter le titre
    document.getElementById('fpPpListenBtn')?.addEventListener('click', () => {
      openListenConfirmDialog(friend);
    });

    // Track card click aussi
    document.getElementById('fpPpTrack')?.addEventListener('click', () => {
      openListenConfirmDialog(friend);
    });

    // Follow/unfollow
    const followBtn = document.getElementById('fpPpFollowBtn');
    window.FirebaseSocial?.isFollowing(friend.docId).then(following => {
      followBtn.disabled = false;
      followBtn.querySelector('span').textContent = following ? '✓ Suivi' : '+ Suivre';
      followBtn.classList.toggle('following', following);
      followBtn.addEventListener('click', async () => {
        followBtn.disabled = true;
        const wasFollowing = followBtn.classList.contains('following');
        const ok = wasFollowing
          ? await window.FirebaseSocial.unfollowUser(friend.docId)
          : await window.FirebaseSocial.followUser(friend.docId);
        if (ok) {
          const nowFollowing = !wasFollowing;
          followBtn.classList.toggle('following', nowFollowing);
          followBtn.querySelector('span').textContent = nowFollowing ? '✓ Suivi' : '+ Suivre';
          showToast(nowFollowing ? '✅ Suivi !' : 'Désabonné');
          if (nowFollowing) addPresenceListener(friend.docId);
          else delete friendsData[friend.docId];
        }
        followBtn.disabled = false;
      });
    });

    // Ticker local pour la progression dans la page profil
    const ppTicker = setInterval(() => {
      if (!document.getElementById('fpProfilePage')) { clearInterval(ppTicker); return; }
      const lp = localProgress.get(friend.docId);
      if (!lp || lp.status !== 'playing') return;
      const dur = lp.duration || 0;
      const pos = Math.min(lp.pos + (Date.now() - lp.lastUpdate) / 1000, dur);
      const pct = dur > 0 ? Math.min((pos / dur) * 100, 100).toFixed(1) : '0.0';
      const posEl  = page.querySelector(`[data-pp-pos="${CSS.escape(friend.docId)}"]`);
      const fillEl = page.querySelector(`[data-pp-fill="${CSS.escape(friend.docId)}"]`);
      if (posEl)  posEl.textContent  = fmtTime(pos);
      if (fillEl) fillEl.style.width = pct + '%';
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIRMATION D'ÉCOUTE (dialog léger)
  // ═══════════════════════════════════════════════════════════════
  function openListenConfirmDialog(friend) {
    document.getElementById('fpListenConfirm')?.remove();

    const track = friend.presence?.currentTrack;
    if (!track?.title) return;

    const dialog = document.createElement('div');
    dialog.id = 'fpListenConfirm';
    dialog.className = 'fp-listen-confirm-overlay';
    dialog.innerHTML = `
      <div class="fp-listen-confirm">
        <div class="fp-lc-header">
          ${track.imageUrl
            ? `<img src="${esc(track.imageUrl)}" class="fp-lc-cover" alt="">`
            : `<div class="fp-lc-cover-ph">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">
                   <circle cx="12" cy="12" r="10"/>
                   <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/>
                 </svg>
               </div>`}
          <div class="fp-lc-meta">
            <div class="fp-lc-question">Écouter avec ${esc(friend.name)} ?</div>
            <div class="fp-lc-track">${esc(track.title)}</div>
            <div class="fp-lc-artist">${esc(track.artist)}</div>
          </div>
        </div>
        <div class="fp-lc-actions">
          <button class="fp-lc-cancel" id="fpLcCancel">Annuler</button>
          <button class="fp-lc-play" id="fpLcPlay">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z"/></svg>
            Écouter
          </button>
        </div>
      </div>`;

    document.body.appendChild(dialog);
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
    document.getElementById('fpLcCancel').addEventListener('click', () => dialog.remove());

    document.getElementById('fpLcPlay').addEventListener('click', () => {
      dialog.remove();
      if (!window.playTrack || !window.tracks) {
        showToast('Lecteur non disponible', 'error');
        return;
      }
      const localTrack = window.tracks.find(t => t.id === track.id);
      if (localTrack) {
        window.playTrack(localTrack, null, `Avec ${friend.name}`);
        showToast(`▶  ${track.title}`);
      } else {
        showToast("Ce titre n'est pas dans ta bibliothèque", 'error');
      }
    });
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

    const statusLabel = isPlaying ? 'En écoute' : isPaused ? 'En pause' : 'Hors ligne';
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
                 placeholder="Rechercher un utilisateur…" autocomplete="off">
        </div>
      </div>
      <div id="fpSearchResults" class="fp-search-results"></div>
      <div class="fp-section-label">Personnes suivies</div>
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
      <div class="fp-section-label">Tes abonnés</div>
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
      <div class="fp-section-label">Partager une playlist</div>
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
            : '<option value="" disabled>Aucune playlist créée</option>'}
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

      <div class="fp-section-label" style="margin-top:8px">Importer une playlist</div>
      <div class="fp-import-section">
        <p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 8px">
          Colle le code à 14 caractères partagé par un ami.
        </p>
        <div class="fp-import-row">
          <input class="fp-import-input" id="fpImportInput"
                 placeholder="Code (ex: AB3X12CDXY2Z34)" maxlength="14">
          <button class="fp-import-btn" id="fpImportBtn">Importer</button>
        </div>
        <div id="fpImportResult" style="margin-top:8px"></div>
      </div>`;

    document.getElementById('fpGenerateToken').addEventListener('click', async () => {
      const sel = document.getElementById('fpPlaylistSelect');
      const playlistId = sel?.value;
      if (!playlistId) return;

      const btn = document.getElementById('fpGenerateToken');
      btn.textContent = 'Génération…';
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
                showToast('✅ Code copié dans le presse-papier');
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
            showToast('✅ Code copié !');
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
        showToast('Saisis un code valide', 'error');
        return;
      }

      const btn = document.getElementById('fpImportBtn');
      btn.textContent = '…';
      btn.disabled = true;

      const result = await window.FirebaseSocial.importSharedPlaylist(token);
      btn.textContent = 'Importer';
      btn.disabled = false;

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
  }

  // ═══════════════════════════════════════════════════════════════
  // USER LIST (following / followers)
  // ═══════════════════════════════════════════════════════════════
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

    // Récupérer les présences actuelles pour chaque user
    let html = '';
    for (const user of users) {
      const pres = friendsData[user.docId]?.presence;
      const isListening = pres?.status === 'playing' || pres?.status === 'paused';
      html += `
        <div class="fp-friend-card">
          <div class="fp-card-top">
            <div class="fp-avatar" style="background:${gradientForName(user.name)}">
              ${avatarHTML(user.picture, user.name)}

            </div>
            <div class="fp-card-meta">
              <div class="fp-card-name">${esc(user.name)}</div>
              <div class="fp-card-status" style="color:rgba(255,255,255,0.4);font-size:11px">
                Utilisateur Beartify
              </div>
            </div>
            ${showUnfollow
              ? `<button class="fp-follow-btn following" data-doc-id="${esc(user.docId)}">
                   <span>Suivi ✓</span>
                 </button>`
              : `<button class="fp-follow-btn" data-doc-id="${esc(user.docId)}"
                         data-follow-back="true">
                   Suivre
                 </button>`}
          </div>
        </div>`;
    }
    container.innerHTML = html;

    // Bind follow/unfollow buttons
    container.querySelectorAll('.fp-follow-btn').forEach(btn => {
      btn.addEventListener('click', () => onFollowBtnClick(btn));
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
    const followChecks = await Promise.allSettled(
      results.map(r => window.FirebaseSocial.isFollowing(r.docId))
    );

    let html = '';
    results.forEach((user, i) => {
      const isFollowing = followChecks[i]?.value === true;
      html += `
        <div class="fp-search-result-item">
          <div class="fp-avatar" style="background:${gradientForName(user.name)}">
            ${avatarHTML(user.picture, user.name)}
          </div>
          <div class="fp-search-result-meta">
            <div class="fp-search-result-name">${esc(user.name)}</div>
            <div class="fp-search-result-sub">Utilisateur Beartify</div>
          </div>
          <button class="fp-follow-btn ${isFollowing ? 'following' : ''}"
                  data-doc-id="${esc(user.docId)}">
            ${isFollowing ? '<span>Suivi ✓</span>' : 'Suivre'}
          </button>
        </div>`;
    });
    resultsEl.innerHTML = html;
    resultsEl.querySelectorAll('.fp-follow-btn').forEach(btn => {
      btn.addEventListener('click', () => onFollowBtnClick(btn, true));
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
        btn.innerHTML = isSearchResult ? 'Suivre' : 'Suivre';
        // Remove from local friendsData
        delete friendsData[docId];
        showToast('Désabonné');
        if (activeTab === 'following') renderContent();
      }
    } else {
      const ok = await window.FirebaseSocial.followUser(docId);
      if (ok) {
        btn.classList.add('following');
        btn.innerHTML = '<span>Suivi ✓</span>';
        showToast('✅ Suivi !');
        // Start listening to this new friend
        addPresenceListener(docId);
        if (activeTab === 'following') setTimeout(renderContent, 500);
      }
    }
    btn.disabled = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // REALTIME PRESENCE LISTENERS
  // ═══════════════════════════════════════════════════════════════
  async function startFriendListeners() {
    const db = window.FirebaseConfig?.getDB();
    if (!db) return;

    stopFriendListeners();

    const following = await window.FirebaseSocial.getFollowing();
    if (!following.length) return;

    // Seed friendsData with profiles
    following.forEach(f => {
      if (!friendsData[f.docId]) {
        friendsData[f.docId] = { docId: f.docId, name: f.name, picture: f.picture, presence: null };
      }
    });

    // Subscribe to each friend's presence (onSnapshot = push temps réel)
    following.forEach(f => addPresenceListener(f.docId));

    // Le ticker local (1 s) démarre dans renderActivity() si l'onglet est ouvert.
  }

  function addPresenceListener(docId) {
    const db = window.FirebaseConfig?.getDB();
    if (!db || !docId) return;

    const unsubscribe = db.collection('presence').doc(docId)
      .onSnapshot(snap => {
        if (!snap.exists) {
          if (friendsData[docId]) friendsData[docId].presence = null;
          return;
        }
        const data = snap.data();

        // Merge profile from presence document (enriched by firebase-social.js)
        if (!friendsData[docId]) {
          friendsData[docId] = { docId, name: data.profile?.name || docId, picture: data.profile?.picture || '', presence: null };
        }
        if (data.profile?.name) friendsData[docId].name    = data.profile.name;
        if (data.profile?.picture) friendsData[docId].picture = data.profile.picture;

        const prevStatus  = friendsData[docId].presence?.status;
        const prevTrackId = friendsData[docId].presence?.currentTrack?.id;
        const newStatus   = data.status || 'stopped';
        const newTrackId  = data.currentTrack?.id || null;
        const newPosition = data.position || 0;
        const now         = Date.now();

        friendsData[docId].presence = {
          status:       newStatus,
          currentTrack: data.currentTrack || null,
          position:     newPosition,
          timestamp:    now,
        };

        // Mettre à jour localProgress — reset lastUpdate à maintenant
        localProgress.set(docId, {
          pos:        newPosition,
          lastUpdate: now,
          status:     newStatus,
          duration:   data.currentTrack?.duration || 0,
          trackId:    newTrackId,
        });

        // Re-render complet seulement si la piste ou le statut a changé.
        // Si seule la position change, le ticker local s'en occupe sans re-render.
        const trackChanged  = newTrackId  !== prevTrackId;
        const statusChanged = newStatus   !== prevStatus;

        if ((trackChanged || statusChanged) && activeTab === 'activity' && isOpen) {
          renderActivity();
        }
      }, err => {
        console.warn('[FriendsPanel] presence listener error:', err.message);
      });

    presenceListeners.push(unsubscribe);
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

    // Réduire l'intervalle de présence à 5s pour une fluidité Discord-like
    // (firebase-sync.js utilise 10s — on complète ici)
    setInterval(() => {
      const t = window.currentTrack;
      if (!t || audio.paused) return;
      if (document.body.classList.contains('private-session')) return;
      window.FirebaseSocial?.updatePresenceWithProfile('playing', t, Math.floor(audio.currentTime));
    }, 5000);

    // ── Présence "stopped" à la fermeture / mise en arrière-plan ──────
    // visibilitychange couvre les onglets mis en arrière-plan et la fermeture
    // sur la plupart des navigateurs modernes (plus fiable que beforeunload).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // sendBeacon est synchrone et survit à la fermeture de l'onglet.
        // On ne peut pas appeler Firestore async ici → on passe par le endpoint REST.
        const docId  = window.FirebaseSocial?.getMyDocId?.();
        const db     = window.FirebaseConfig?.getDB?.();
        if (!docId || !db) return;
        // Écriture silencieuse via l'API REST Firestore (survit à la fermeture)
        const project = 'beartify-firebase';
        const url     = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/presence/${encodeURIComponent(docId)}?updateMask.fieldPaths=status&updateMask.fieldPaths=currentTrack`;
        const body    = JSON.stringify({
          fields: {
            status:       { stringValue: 'stopped' },
            currentTrack: { nullValue: null },
          }
        });
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));

        // Fallback async (marche si la page est mise en veille, pas fermée)
        window.FirebaseSocial?.updatePresenceWithProfile?.('stopped', null, 0);
      }
    });

    // beforeunload : dernier recours sur les navigateurs qui ne tirent pas visibilitychange
    window.addEventListener('beforeunload', () => {
      const docId = window.FirebaseSocial?.getMyDocId?.();
      const db    = window.FirebaseConfig?.getDB?.();
      if (!docId || !db) return;
      try {
        db.collection('presence').doc(docId).set(
          { status: 'stopped', currentTrack: null },
          { merge: true }
        );
      } catch (_) {}
    });

    console.log('[FriendsPanel] ✅ Présence audio patchée (5s interval + événements immédiats)');
  }

  // ═══════════════════════════════════════════════════════════════
  // SHARE MODAL (footer shortcut)
  // ═══════════════════════════════════════════════════════════════
  function openShareModal() {
    // Switch to share tab
    activeTab = 'share';
    panel.querySelectorAll('.fp-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'share');
    });
    renderContent();
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPOSE — override window._showFriendsActivity
  // ═══════════════════════════════════════════════════════════════
  window._showFriendsActivity = function () {
    if (!isOpen) {
      openPanel();
    } else {
      closePanel();
    }
  };

  // Keyboard shortcut: Escape closes panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closePanel();
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