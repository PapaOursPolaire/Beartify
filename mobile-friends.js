// ══════════════════════════════════════════════════════════════════
//  BEARTIFY — mobile/mobile-friends.js
//  Widget "amis en écoute" du menu burger mobile.
//  Chargé conditionnellement par index.html, mode compact uniquement.
//
//  Totalement INDÉPENDANT de social/friends-panel.js pour les DONNÉES :
//  pas d'appel à window.FriendsPanel, pas de lecture de son état interne
//  (friendsData y est privé). Ce fichier interroge directement les
//  mêmes APIs backend publiques que friends-panel.js utilise
//  (window.FirebaseSocial.getFollowing, window.FirebaseSync.listenToFriends
//  — exposées par fallback-router.js, pas par friends-panel.js), et
//  maintient son propre état local (Map friends, progression locale).
//
//  En revanche, pour le RENDU, on réutilise volontairement les classes
//  CSS de social/friends-panel.css (.fp-friend-card, .fp-avatar,
//  .fp-track-snippet, etc.) : ce fichier CSS est chargé sans condition
//  sur toutes les pages (pas seulement mobile), donc s'appuyer dessus
//  pour le style ne casse pas l'indépendance de CHARGEMENT demandée —
//  et ça évite de dupliquer ~150 lignes de CSS pour obtenir un rendu
//  pixel-identique à la carte du panneau complet (dégradé d'avatar,
//  pastille de statut colorée, barre de progression en direct).
//
//  Compromis assumé : deux abonnements temps réel séparés à la
//  présence des mêmes amis si friends-panel.js tourne aussi (cas
//  normal) — léger doublon réseau, prix de l'indépendance des données.
// ══════════════════════════════════════════════════════════════════
(function () {
  var label = document.getElementById('mobBurgerListeningLabel');
  var list  = document.getElementById('mobBurgerListening');
  if (!label || !list) {
    console.warn('[MobileFriends] #mobBurgerListeningLabel/#mobBurgerListening introuvables — index.html à jour ?');
    return;
  }

  // ── Petits helpers autonomes, copiés (volontairement) de
  //    social/friends-panel.js : purs, sans dépendance à son état
  //    interne, donc aucune violation de l'indépendance demandée. ────
  function esc(str) {
    if (!str) return '';
    return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  }
  function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + sec.toString().padStart(2, '0');
  }
  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name[0].toUpperCase();
  }
  function avatarHTML(picture, name) {
    if (picture) {
      return '<img src="' + esc(picture) + '" alt="" loading="lazy" ' +
      'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<span class="fp-avatar-initials" style="display:none">' + esc(initials(name)) + '</span>';
    }
    return '<span class="fp-avatar-initials">' + esc(initials(name)) + '</span>';
  }
  function gradientForName(name) {
    var hue = [...(name || '?')].reduce(function (acc, c) { return acc + c.charCodeAt(0); }, 0) % 360;
    return 'linear-gradient(135deg, hsl(' + hue + ',55%,35%), hsl(' + ((hue + 60) % 360) + ',55%,25%))';
  }

  var friends = new Map(); // docId -> { docId, name, picture, presence, localProgress }
  var ticker  = null;

  function buildFriendCard(f) {
    var p         = f.presence || {};
    var status    = p.status || 'stopped';
    var track     = p.currentTrack;
    var isPlaying = status === 'playing';
    var isPaused  = status === 'paused';
    var isOnline  = isPlaying || isPaused;
    var statusLabel = isPlaying ? 'En écoute' : isPaused ? 'En pause' : 'Hors ligne';

    var trackSnippet = '';
    if (isOnline && track?.title) {
      var duration = track.duration || 0;
      var lp       = f.localProgress;
      var initPos  = lp ? Math.min(lp.pos + (Date.now() - lp.lastUpdate) / 1000, duration) : (p.position || 0);
      var initPct  = duration > 0 ? Math.min((initPos / duration) * 100, 100).toFixed(1) : '0.0';

      trackSnippet = '' +
      '<div class="fp-track-snippet ' + (isPaused ? 'paused' : '') + '" data-doc-id="' + esc(f.docId) + '">' +
      '<div class="fp-snippet-art">' +
      (track.imageUrl
      ? '<img src="' + esc(track.imageUrl) + '" class="fp-snippet-cover" loading="lazy" alt="">'
      : '<div class="fp-snippet-cover-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/></svg></div>') +
      '</div>' +
      '<div class="fp-snippet-body">' +
      '<div class="fp-snippet-title">' + esc(track.title) + '</div>' +
      '<div class="fp-snippet-artist">' + esc(track.artist) + (track.album ? ' — ' + esc(track.album) : '') + '</div>' +
      '<div class="fp-snippet-timeline" data-pdoc-mob="' + esc(f.docId) + '">' +
      '<span class="fp-snippet-pos">' + fmtTime(initPos) + '</span>' +
      '<div class="fp-snippet-bar"><div class="fp-snippet-fill" style="width:' + initPct + '%"></div></div>' +
      '<span class="fp-snippet-dur">' + fmtTime(duration) + '</span>' +
      '</div>' +
      '</div>' +
      '</div>';
    }

    return '' +
    '<div class="fp-friend-card ' + (isPlaying ? 'is-playing' : '') + '" data-doc-id="' + esc(f.docId) + '">' +
    '<div class="fp-card-top">' +
    '<div class="fp-avatar" style="background:' + gradientForName(f.name) + '">' + avatarHTML(f.picture, f.name) + '</div>' +
    '<div class="fp-card-meta">' +
    '<div class="fp-card-name">' + esc(f.name) + '</div>' +
    '<div class="fp-card-status ' + status + '">' + statusLabel + '</div>' +
    '</div>' +
    '</div>' +
    trackSnippet +
    '</div>';
  }

  function render() {
    var listening = [...friends.values()].filter(function (f) {
      return f.presence?.status === 'playing' || f.presence?.status === 'paused';
    }).sort(function (a, b) {
      var rank = function (s) { return s === 'playing' ? 0 : 1; };
      return rank(a.presence?.status) - rank(b.presence?.status);
    });

    if (!listening.length) {
      label.style.display = 'none';
      list.innerHTML = '';
      if (ticker) { clearInterval(ticker); ticker = null; }
      return;
    }
    label.style.display = 'block';
    list.innerHTML = listening.map(buildFriendCard).join('');

    if (!ticker) ticker = setInterval(tick, 1000);
  }

  // Avance visuellement les barres de progression entre deux mises à
  // jour de présence (identique au principe de tickProgress() du
  // panneau complet), sans re-render complet — juste le DOM concerné.
  function tick() {
    friends.forEach(function (f) {
      if (f.presence?.status !== 'playing' || !f.localProgress) return;
      var duration = f.presence.currentTrack?.duration || 0;
      var elapsed  = (Date.now() - f.localProgress.lastUpdate) / 1000;
      var pos      = Math.min(f.localProgress.pos + elapsed, duration);
      var pct      = duration > 0 ? Math.min((pos / duration) * 100, 100).toFixed(1) : '0.0';
      var timeline = list.querySelector('.fp-snippet-timeline[data-pdoc-mob="' + CSS.escape(f.docId) + '"]');
      if (!timeline) return;
      var posEl  = timeline.querySelector('.fp-snippet-pos');
      var fillEl = timeline.querySelector('.fp-snippet-fill');
      if (posEl)  posEl.textContent  = fmtTime(pos);
      if (fillEl) fillEl.style.width = pct + '%';
    });
  }

  async function init() {
    if (!window.FirebaseSocial?.getFollowing || !window.FirebaseSync?.listenToFriends) {
      setTimeout(init, 2000);
      return;
    }
    var following;
    try {
      following = await window.FirebaseSocial.getFollowing();
    } catch (err) {
      console.warn('[MobileFriends] getFollowing a échoué :', err);
      return;
    }
    console.log('[MobileFriends] Module chargé ✅ —', following?.length || 0, 'compte(s) suivi(s)');
    if (!following?.length) return;

    following.forEach(function (u) {
      friends.set(u.docId, { docId: u.docId, name: u.name, picture: u.picture, presence: null, localProgress: null });
    });

    window.FirebaseSync.listenToFriends(following.map(function (u) { return u.docId; }), function (docId, record) {
      var f = friends.get(docId);
      if (!f) return;
      if (!record) {
        f.presence = null;
        f.localProgress = null;
        render();
        return;
      }
      var currentTrack = record.track || record.currentTrack || null;
      var newStatus    = record.status || 'stopped';
      var newPosition  = record.position || 0;

      // ⚠️ CORRECTIF (porté depuis social/friends-panel.js — même bug,
      // ce fichier étant indépendant il ne l'héritait pas) : sans ça,
      // un ami qui ferme brutalement l'app (crash, tab tuée, perte
      // réseau) reste figé "playing" ici indéfiniment, rien ne le
      // corrige jamais. On considère périmé (donc hors ligne) tout
      // statut "playing"/"paused" dont l'enregistrement n'a pas été
      // mis à jour depuis plus de 90s (3× l'intervalle d'écriture de
      // 30s). Repli à 0 (infiniment vieux) si "updated" est absent —
      // jamais à "now", qui ferait échouer silencieusement toute la
      // vérification (bug initial déjà rencontré et corrigé côté
      // friends-panel.js).
      var STALE_MS = 90000;
      var updatedAtMs = record.updated ? new Date(record.updated).getTime() : 0;
      if ((newStatus === 'playing' || newStatus === 'paused') && (Date.now() - updatedAtMs) > STALE_MS) {
        newStatus = 'stopped';
      }

      f.presence = { status: newStatus, currentTrack: currentTrack, position: newPosition };
      f.localProgress = { pos: newPosition, lastUpdate: Date.now() };

      console.log('[MobileFriends] Présence reçue pour', docId, '→', newStatus);
      render();
    });
  }

  list.addEventListener('click', function (e) {
    var row = e.target.closest('.fp-friend-card');
    if (!row) return;
    e.stopPropagation();
    var panel    = document.getElementById('mobBurgerPanel');
    var backdrop = document.getElementById('mobBurgerBackdrop');
    if (panel)    panel.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';

    // Le popup complet (Écouter / File d'attente / Playlist / Écoute
    // synchronisée) gère de la vraie logique métier (lecture, file
    // d'attente, playlists, sync) — pas juste du rendu. Le dupliquer
    // ici serait risqué (état de lecture partagé, playlists, etc.) pour
    // un gain quasi nul ; on réutilise donc la fonction exposée par
    // social/friends-panel.js (window._openFriendTrackModal), avec un
    // repli sur le panneau complet si ce fichier n'est pas chargé.
    var docId = row.dataset.docId;
    var friend = docId ? friends.get(docId) : null;
    if (friend && window._openFriendTrackModal) {
      window._openFriendTrackModal(friend);
    } else {
      window._showFriendsActivity?.();
    }
  });

  init();
})();
