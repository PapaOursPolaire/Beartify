// ══════════════════════════════════════════════════════════════════
//  BEARTIFY — account/auth-flow.js
//  Extrait de script.js (découpage v1) : sauvegarde locale de session,
//  reprise cross-device, connexion Google (Firebase Auth) et Discord
//  (OAuth custom), callback Discord, déconnexion, restauration de
//  session au démarrage — déplacé tel quel, comportement inchangé.
//
//  ⚠️ Contient l'IIFE initAuth() qui s'exécute immédiatement à son
//  chargement (comme elle le faisait déjà dans script.js) : détecte le
//  callback Discord ou restaure la session, met en place
//  window._authGoogle/window._authDiscord, câble les boutons de
//  connexion/déconnexion du menu profil. Déjà auditée précédemment
//  (aucune dépendance à un nom déplacé dans son corps) — ce constat
//  reste valable ici puisque son code n'a pas changé, seul son fichier
//  d'appartenance a bougé.
//
//  ⚠️ DÉPENDANCES EXTERNES (définies dans script.js/library/views/,
//  visibles ici par nom nu — même mécanisme de scope partagé que
//  core/state.js) :
//    renderSidebarView() (library/sidebar-render.js), showUserProfile()
//    (views/profile-view.js) — appels différés, sans risque —,
//    window.PocketBaseAuthBridge / window.PocketBaseSync /
//    window.FirebaseSync (modules déjà chargés avant), showToast(), _t()
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID = '1475132757188280471';
// Note : l'auth Google est désormais gérée par Firebase Auth (firebase-config.js).
// Plus besoin de GOOGLE_CLIENT_ID ni du SDK GSI externe.

// ── Sauvegarde locale (session Discord ou fallback) ──
function saveUserLocally(user) {
  try { localStorage.setItem('beartify_user', JSON.stringify(user)); } catch (e) { console.warn('[Auth] Sauvegarde locale de session échouée :', e); }
}

// ── Appliquer l'utilisateur connecté à l'UI ──
function applyUserToUI(user) {
  window._authUser = user;

  // Bouton de profil (top-bar)
  const nameEl   = document.getElementById('topProfileName');
  const avatarEl = document.getElementById('topProfileAvatar');
  const btnProf  = document.getElementById('btnProfile');
  if (nameEl) nameEl.textContent = user.name || _t('text-profile-fallback', 'Profil');
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

  // ── Sessions actives + reprise cross-device ──────────────────────
  // Démarre le heartbeat "cet appareil est connecté" (liste dans les
  // paramètres), et vérifie s'il existe une position plus récente sur
  // un autre appareil pour proposer une reprise. applyUserToUI() est
  // appelé aussi bien à la connexion qu'à la restauration de session
  // (Discord ET Google), donc un seul point d'accroche suffit.
  window.PocketBaseSync?.enableDeviceHeartbeat?.();
  _checkCrossDeviceResume();
}

// ── Vérifie s'il existe une lecture plus récente sur un autre appareil ─
// et propose de reprendre dessus. Ne bloque rien : simple prompt dismissible.
let _crossDeviceResumeChecked = false;
async function _checkCrossDeviceResume() {
  if (_crossDeviceResumeChecked) return; // une seule vérification par session
  _crossDeviceResumeChecked = true;
  if (!window.PocketBaseSync?.getLastPositionElsewhere) return;

  try {
    const remote = await window.PocketBaseSync.getLastPositionElsewhere();
    if (!remote || !remote.track || !remote.position || remote.position < 15) return; // trop court pour valoir une reprise

    const overlay = document.createElement('div');
    overlay.id = 'crossDeviceResumePrompt';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:24px;background:rgba(0,0,0,0.35);font-family:inherit;';
    overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="cdResumeTitle" style="background:#181818;border:1px solid rgba(255,255,255,0.1);
    border-radius:14px;padding:22px 24px;max-width:420px;width:100%;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.6)">
    <div id="cdResumeTitle" style="font-size:.95rem;font-weight:700;margin-bottom:4px">_t('text-resume-playback', 'Reprendre la lecture ?')</div>
    <div style="font-size:.82rem;color:#b3b3b3;margin-bottom:16px;line-height:1.5">
    "${(remote.track.title || _t('text-unknown-title', 'Titre inconnu'))}" ${_t('text-resume-was-playing-on', 'était en cours sur')} ${remote.deviceLabel || _t('text-another-device', 'un autre appareil')},
    ${_t('text-resume-at', 'à')} ${formatTime(remote.position)}.
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
    <button id="cdResumeDismiss" style="padding:8px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;font-size:.82rem">Ignorer</button>
    <button id="cdResumeAccept" style="padding:8px 16px;border-radius:20px;border:none;background:#1ed760;color:#000;font-weight:700;cursor:pointer;font-size:.82rem">Reprendre</button>
    </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#cdResumeDismiss').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function _esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _esc); }
    });

    overlay.querySelector('#cdResumeAccept').onclick = async () => {
      overlay.remove();
      const idx = _ensureTrackInLibrary(remote.track);
      if (idx === -1) return;
      currentIndex = idx;
      _setPlayContext([remote.track.id]);
      // Seek une fois la lecture réellement démarrée (le flux doit être
      // prêt — écrire currentTime trop tôt est ignoré par certains navigateurs).
      const _seekOnce = () => {
        audioPlayer.removeEventListener('playing', _seekOnce);
        if (window.currentTrack?.id === remote.track.id) audioPlayer.currentTime = remote.position;
      };
        audioPlayer.addEventListener('playing', _seekOnce);
        await playCurrentTrack();
    };
  } catch (e) {
    console.warn('[CrossDeviceResume] Vérification impossible:', e);
  }
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
  // ⚠️ FIX : onAuthStateChanged (firebase-config.js) et applyUserToUI
  // (ci-dessus) ne retirent JAMAIS la classe 'loading' du bouton — seul
  // le fait qu'applyUserToUI ferme la modale de connexion (_authCloseModal)
  // masquait visuellement le spinner resté collé en cas de succès. À la
  // reconnexion suivante, la modale se rouvre avec le spinner déjà actif
  // → spinner infini avant même le clic. On le retire systématiquement ici,
  // que la connexion réussisse ou non.
  document.getElementById('authGoogleBtn')?.classList.remove('loading');
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
const DISCORD_TAURI_REDIRECT = 'https://beartify.duckdns.org/account/discord-callback.html';

async function fetchDiscordUser(token) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Discord API error ' + res.status);
  return res.json();
}

// ⚠️ OBSOLÈTE — jamais appelée nulle part dans le code (vérifié). Le vrai
// échange Custom Token Discord est maintenant intégré directement dans
// handleDiscordToken() ci-dessous, avec un vrai backend
// (auth-bridge-service.js /discord-firebase-token) au lieu du placeholder
// "https://votre-api.com/auth/discord" jamais implémenté ici. Conservée
// uniquement pour référence historique — à supprimer si personne n'en a
// besoin.
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

    // Discord n'est pas géré par Firebase Auth nativement — on sauvegarde
    // la session localement pour l'UI...
    applyUserToUI(user);

    // ── CORRECTIF STRUCTUREL (firestore.rules) ──────────────────────────
    // ...MAIS on ouvre quand même une vraie session Firebase Auth via un
    // Custom Token, pour que request.auth ne soit plus jamais null côté
    // règles Firestore (voir isDiscordOwner() dans firestore.rules et
    // /discord-firebase-token dans auth-bridge-service.js). Avant ce
    // correctif, n'importe qui connaissant un ID Discord pouvait écraser
    // le profil ou le statut VIP de ce compte — cette étape ferme ce trou.
    // Échec non bloquant : si le bridge est indisponible, la session
    // locale (UI) et le pont PocketBase plus bas continuent de fonctionner
    // — seules les écritures Firestore directes resteraient refusées tant
    // que cette étape n'a pas réussi.
    try {
      const fbRes = await fetch(_fbAuthBridgeUrl('/api/auth-bridge/discord-firebase-token'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token }),
      });
      const fbData = await fbRes.json();
      if (fbData?.firebaseToken) {
        const auth = window.FirebaseConfig?.getAuth?.();
        if (auth?.signInWithCustomToken) {
          await auth.signInWithCustomToken(fbData.firebaseToken);
          console.log('[Auth] ✅ Session Firebase (Custom Token) ouverte pour Discord');
        } else if (window.firebase?.auth) {
          // Fallback si getAuth() n'est pas exposé mais firebase.auth() l'est.
          await window.firebase.auth().signInWithCustomToken(fbData.firebaseToken);
          console.log('[Auth] ✅ Session Firebase (Custom Token, fallback) ouverte pour Discord');
        } else {
          console.warn('[Auth] ⚠️ Firebase Auth non accessible — Custom Token reçu mais non utilisé');
        }
      } else {
        console.warn('[Auth] ⚠️ Pas de firebaseToken reçu du bridge Discord :', fbData?.error);
      }
    } catch (e) {
      console.warn('[Auth] ⚠️ Échange Custom Token Discord échoué (mode dégradé, règles Firestore Discord resteront fermées) :', e.message || e);
    }

    // ── Pont vers PocketBase (silencieux si indisponible — le mode secours
    //    Firebase Native continue de fonctionner sans cette session PB) ──
    try {
      await window.PocketBaseAuthBridge?.loginWithDiscord(token);
    } catch (e) {
      console.warn('[Auth] ⚠️ Session PocketBase non ouverte pour Discord (mode secours actif) :', e.message || e);
    }

    // ── Sync Discord : PocketBase si nominal, sinon fallback Firestore ──
    // ⚠️ CORRECTIF : l'appel getDB() plantait ici (TypeError: not a function)
    // faute du double optional-chaining (?.getDB?.() partout ailleurs dans
    // ce fichier, mais ?.getDB() ici) — l'exception non rattrapée coupait
    // court à _startDiscordSync AVANT tout chargement de données. De plus,
    // cette fonction ne connaissait que Firestore : en mode PocketBase
    // nominal (cf. fallback-router.js), getDB() ne renvoie rien d'utile et
    // la boucle setTimeout tournait indéfiniment sans jamais charger quoi
    // que ce soit. On tente PocketBase en priorité s'il est disponible.
    const _startDiscordSync = async () => {
      if (window.PocketBaseConfig?.isAuthenticated?.()) {
        try {
          await window.PocketBasePlaylists?.loadMyPlaylists?.();
          await _checkBanStatus();
          window.PocketBaseSync?.enablePresenceSync?.();
          if (typeof window.renderSidebarView === 'function') {
            window.renderSidebarView(window.currentSidebarFilter || 'playlists');
          }
          console.log('[Auth] ✅ Données PocketBase chargées après login Discord');
        } catch (e) {
          console.error('[Auth] ❌ Erreur chargement PocketBase post-login:', e);
        }
        return;
      }

      const db = window.FirebaseConfig?.getDB?.();
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
    showToast(_t('toast-welcome-user', 'Bienvenue, {name} !', {name: user.name}), 'success');
  } catch (err) {
    console.error('[Auth] Discord login error:', err);
    showToast(_t('toast-error-discord-connection', 'Erreur lors de la connexion Discord.'), 'error');
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
  // ⚠️ CORRECTIF : sans cette ligne, aucun statut "stopped" n'était
  // jamais écrit avant de couper la présence juste en dessous — le
  // dernier enregistrement restait "playing" si un morceau tournait au
  // moment de la déconnexion, ce qui affichait un ami "en écoute" alors
  // qu'il vient de se déconnecter volontairement (à ne pas confondre
  // avec le filet de sécurité de 90s côté friends-panel.js, qui ne
  // couvre lui que les déconnexions brutales/crash où on ne peut pas
  // écrire ce "stopped" explicitement).
  await window.PocketBaseSync?.updatePresence('stopped');
  window.PocketBaseSync?.disableDeviceHeartbeat?.();
  window.PocketBaseSync?.disablePresenceSync?.();
  window.FirebaseSync?.disableAutoSync?.();

  // Déconnexion Firebase (Google) + nettoyage session locale (Discord)
  await window.firebaseSignOut?.();
  try { localStorage.removeItem('beartify_user'); } catch (e) { console.warn('[Auth] Nettoyage de session locale échoué :', e); }

  // ⚠️ CORRECTIF : la session PocketBase (pb.authStore) n'était jamais
  // vidée ici — client.authStore.isValid restait `true` après logout,
  // et rien ne réinitialisait l'état mémoire des playlists. Elles vivent
  // dans window.customPlaylists (pocketbase-playlists.js), PAS dans
  // window.myPlaylists (qui n'existe nulle part ailleurs dans le code —
  // erreur dans un correctif précédent, sans effet puisque personne ne
  // lit cette variable). D'où les playlists de l'ancien utilisateur qui
  // restaient affichées jusqu'à un rechargement de page (qui relit alors
  // une session PocketBase vide/différente) ou un changement d'utilisateur
  // (qui écrase l'état en mémoire par celui du nouveau compte).
  window.PocketBaseAuthBridge?.logout?.();

  window.customPlaylists = {};

  // ⚠️ CORRECTIF (2) : NE PAS réassigner `window.likedTracks = new Set()`
  // ni pareil pour favoriteAlbums/favoriteArtists/recentlyPlayed —
  // script.js/sidebar-render.js capturent ces objets une fois dans une
  // variable locale (ex: `let likedTracks = window.likedTracks;`, voir
  // le commentaire de applyFavoritesFromRecord dans pocketbase-config.js
  // qui documente précisément ce piège pour le bug "un like ne se
  // sauvegarde jamais"). Remplacer la référence orpheline l'ancien objet
  // que ces modules continuent de lire — les "playlists par défaut"
  // (Titres likés, Mes favoris) affichaient donc encore les titres de
  // l'ancien compte. On vide les objets EXISTANTS en place à la place.
  if (window.likedTracks instanceof Set) window.likedTracks.clear();
  else window.likedTracks = new Set();

  if (window.favoriteAlbums instanceof Set) window.favoriteAlbums.clear();
  else window.favoriteAlbums = new Set();

  if (window.favoriteArtists instanceof Set) window.favoriteArtists.clear();
  else window.favoriteArtists = new Set();

  if (Array.isArray(window.recentlyPlayed)) window.recentlyPlayed.length = 0;
  else window.recentlyPlayed = [];

  resetAuthUI();

  if (typeof window.renderSidebarView === 'function') {
    window.renderSidebarView(window.currentSidebarFilter || 'playlists');
  }

  showToast(_t('toast-logged-out', 'Déconnecté.'), 'info');
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
        // ── Déclencher le sync (PocketBase si nominal, sinon Firestore) ──
        // ⚠️ CORRECTIF : même bug que _startDiscordSync (getDB() sans le
        // second ?. plantait), et même angle mort : ce chemin (exécuté à
        // CHAQUE rechargement de page pour les sessions Discord) ne
        // tentait jamais PocketBase, alors que le SDK PocketBase peut très
        // bien avoir déjà restauré une session valide depuis son propre
        // localStorage à ce stade (cf. pocketbase-config.js).
        const _tryDiscordSync = () => {
          if (window.PocketBaseConfig?.isAuthenticated?.()) {
            window.PocketBasePlaylists?.loadMyPlaylists?.().then(() => {
              _checkBanStatus?.();
              if (typeof window.renderSidebarView === 'function') {
                window.renderSidebarView(window.currentSidebarFilter || 'playlists');
              }
            });
            window.PocketBaseSync?.enablePresenceSync?.();
            return;
          }
          if (window.FirebaseConfig?.getDB?.() && window.FirebaseSync?.syncFromFirestore) {
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
  } catch (e) { console.warn('[Auth] Restauration de session au chargement échouée :', e); }
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
    // Web : le spinner est retiré par triggerGoogleLogin() lui-même (succès
    // ou échec) — voir le fix dans cette fonction.
    // Tauri : firebaseSignInWithGoogle() (firebase-config.js) ouvre le
    // navigateur système (flux PKCE + loopback local via tauri-plugin-oauth)
    // et retire elle-même le spinner une fois le callback OAuth traité
    // (voir le listener 'oauth://url' dans firebase-config.js) — rien à
    // faire ici après l'await, le retrait du spinner est géré côté callback.
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
      //   https://beartify.duckdns.org/account/discord-callback.html
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
        showToast(_t('toast-error-open-browser', "Impossible d'ouvrir le navigateur."), 'error');
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
    document.getElementById('profileDropdown')?.classList.remove('open');
    // showUserProfile(docId) résout déjà tout seul "mon profil" quand
    // docId est omis (voir views/profile-view.js : const uid = docId ||
    // myId, avec sa PROPRE chaîne de repli PocketBaseSocial →
    // FirebaseSocial → window.currentUser?.uid). Recalculer myId ici
    // avec une chaîne incomplète (sans PocketBaseSocial) et référençant
    // window.currentUser — qui n'est jamais défini nulle part dans tout
    // le code, uniquement window._authUser — faisait échouer ce bouton
    // silencieusement (if (!myId) return;) dès que FirebaseSocial seul
    // ne suffisait pas à résoudre l'id.
    showUserProfile();
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
