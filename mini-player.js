// ══════════════════════════════════════════════════════════════════
//  Beartify – mini-player.js  (PiP 320 × 320)
//
//  Indépendant de background.js.
//  Prérequis script.js (2 lignes ajoutées à la fin) :
//    window.AppState         = AppState;
//    window.playCurrentTrack = () => playCurrentTrack();
// ══════════════════════════════════════════════════════════════════

(function initMiniPlayer() {
  'use strict';

  const PIP_W = 320;
  const PIP_H = 320;

  const PIP_OK = 'documentPictureInPicture' in window;
  const btn    = document.getElementById('nowPlayingBtn');

  // ── Détection Tauri (lazy) ────────────────────────────────────────
  // Réévaluée à chaque appel — withGlobalTauri injecte window.__TAURI__
  // après l'exécution des scripts, donc les consts top-level seraient false.
  function _isTauriDesktop() {
    const T = window.__TAURI__;
    if (!T) return false;
    return !/Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // ── Masquer sur Android ───────────────────────────────────────────
  if (/Android/i.test(navigator.userAgent)) {
    if (btn) btn.style.display = 'none';
    return;
  }

  // ── Masquer si ni PiP ni Tauri disponibles ────────────────────────
  // On attend 2 rAF pour laisser Tauri s'injecter avant de décider.
  if (!PIP_OK) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!_isTauriDesktop() && btn) btn.style.display = 'none';
    }));
  }

  // ── Thèmes ────────────────────────────────────────────────────────
  const THEMES = {
    amoled: { bg: '#000000', elevated: '#000000', text: '#ffffff', sub: '#b3b3b3', deco: 'rgba(255,255,255,0.1)',  lyricsText: null,              lyricsActive: null },
 clair:  { bg: '#f0f0f2', elevated: '#ffffff', text: '#121216', sub: '#50505a', deco: 'rgba(0,0,0,0.08)',       lyricsText: 'rgba(0,0,0,0.50)', lyricsActive: '#121216' },
 starry: { bg: '#000000', elevated: 'transparent', text: '#ffffff', sub: '#c2d9f5', deco: 'rgba(255,255,255,0.12)', lyricsText: null,          lyricsActive: null },
  };

  function _getThemeKey() {
    try {
      const s = JSON.parse(localStorage.getItem('beartify_settings') || '{}');
      return s.theme && THEMES[s.theme] ? s.theme : 'amoled';
    } catch { return 'amoled'; }
  }

  // ── État ──────────────────────────────────────────────────────────
  let _pipWin         = null;
  let _lyricNode      = null;
  let _lyricParent    = null;
  let _rafId          = null;
  let _lastLineEl     = null;
  let _themeObs       = null;
  let _paddingObs     = null;
  let _starryObs      = null;
  let _queueMode      = false;
  let _dynBgMode      = false;
  // ── Miroir paroles ────────────────────────────────────────────────
  // Contrairement à l'ancienne approche adoptNode, #lyricsDisplay
  // reste dans le document principal. Un clone est injecté dans le PiP
  // et synchronisé via MutationObserver (classes + styles).
  let _mirrorObs      = null;   // MutationObserver sur #lyricsDisplay original
  let _rebuildPending = false;  // évite les rebuild rAF en double

  const $  = id => document.getElementById(id);
  const $p = id => _pipWin?.document.getElementById(id);

  // ── État Tauri ────────────────────────────────────────────────────
  let _tauriWin         = null;
  let _tauriUnlisten    = null;
  let _tauriTimer       = null;
  let _tauriTrackCb     = null;
  let _tauriPlayCb      = null;

  // Envoie un message à la fenêtre mini-player via emit (broadcast Tauri).
  // emit() est reçu par tous les listen() de n'importe quelle fenêtre.
  function _tSend(type, payload) {
    // invoke('relay_event') passe par le backend Rust qui fait app.emit_to().
    // C'est la SEULE approche 100% fiable pour la communication inter-fenêtres
    // en Tauri v2 — emitTo() JS→JS est non fiable selon la version de WRY/WebView2.
    try {
      window.__TAURI__?.core?.invoke('relay_event', {
        target: 'beartify-mini-player',
        event:  'beartify://mp-msg',
        payload: { type, payload },
      });
    } catch(_) {}
  }

  // Les mêmes THEMES que la version PiP web — rendu identique garanti
  const TCOLORS = {
    amoled: { bg:'#000000', elevated:'#000000', text:'#ffffff', sub:'#b3b3b3', deco:'rgba(255,255,255,0.1)', lyricsText:null, lyricsActive:null },
 clair:  { bg:'#f0f0f2', elevated:'#ffffff', text:'#121216', sub:'#50505a', deco:'rgba(0,0,0,0.08)',      lyricsText:'rgba(0,0,0,0.50)', lyricsActive:'#121216' },
 starry: { bg:'#000000', elevated:'transparent', text:'#ffffff', sub:'#c2d9f5', deco:'rgba(255,255,255,0.12)', lyricsText:null, lyricsActive:null },
  };

  // Snapshot de l'état — même données que le PiP web
  function _tState() {
    const ap = $('audioPlayer'), t = window.currentTrack;
    return {
      title:      t?.title    || '—',
 artist:     $('currentArtist')?.textContent?.trim() || t?.artist || '—',
 imageUrl:   t?.imageUrl || '',
 playing:    ap ? !ap.paused : false,
 shuffled:   !!window.isShuffled,
 repeatIcon: $('repeatIcon')?.innerHTML || '',
 theme:      _getThemeKey(),   // 'amoled' | 'clair' | 'starry' — lu depuis localStorage
 bpm:        t?.bpm,
 loudness:   t?.loudness,
    };
  }

  // ── Sync paroles Tauri : miroir DOM réel par IPC ──────────────────
  // On ne peut pas cloner un nœud DOM entre deux fenêtres/process Tauri
  // séparés (contrairement au PiP web, même document/contexte). Donc on
  // sérialise le même principe que _buildMirror() : HTML complet envoyé
  // à chaque reconstruction structurelle (nouvelle piste…), puis de
  // simples mises à jour d'index→className à chaque tick d'animation
  // (Active/Sung/NotSung) — bien plus léger qu'un renvoi de HTML complet
  // à 100ms, et surtout un rendu FIDÈLE (mêmes classes sl2-, donc mêmes
  // styles CSS) au lieu du triplet texte prev/cur/next précédent.
  let _tauriLyricsObs  = null;
  let _tauriLyricsFlat = null; // Map<Element, index> — même ordre que le flatten côté HTML

  function _tLyricsRebuild() {
    const ld = $('lyricsDisplay');
    _tSend('lyricsRebuild', { html: ld ? ld.innerHTML : '' });
    _tauriLyricsFlat = ld
    ? new Map([ld, ...ld.querySelectorAll('*')].map((el, i) => [el, i]))
    : null;
  }

  function _tStartLyricsSync() {
    const ld = $('lyricsDisplay');
    if (!ld) return;
    _tLyricsRebuild();
    _tauriLyricsObs = new MutationObserver(muts => {
      let needRebuild = false;
      const updates = [];
      for (const m of muts) {
        if (m.type === 'childList' && m.target === ld) { needRebuild = true; }
        else if (!needRebuild && m.type === 'attributes' && m.attributeName === 'class') {
          const idx = _tauriLyricsFlat?.get(m.target);
          if (idx != null) updates.push({ index: idx, className: m.target.className });
        }
      }
      if (needRebuild) requestAnimationFrame(_tLyricsRebuild);
      else if (updates.length) _tSend('lyricsClass', { updates });
    });
    _tauriLyricsObs.observe(ld, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class'],
    });
  }
  function _tStopLyricsSync() {
    _tauriLyricsObs?.disconnect(); _tauriLyricsObs = null; _tauriLyricsFlat = null;
  }

  function _tStartSync() {
    const ap = $('audioPlayer'); if (!ap) return;
    _tauriTrackCb = () => {
      const s = _tState();
      _tSend('state', s);
    };
    _tauriPlayCb = () => _tSend('state', _tState());
    ap.addEventListener('loadstart', _tauriTrackCb);
    ap.addEventListener('play',      _tauriPlayCb);
    ap.addEventListener('pause',     _tauriPlayCb);
    // Réémettre l'état complet (avec thème) quand les settings changent
    window._tauriSyncSettings = () => _tSend('state', _tState());
    document.addEventListener('beartify:settingChanged', () => {
      if (_tauriWin) _tSend('state', _tState());
    });
      _tauriTimer = setInterval(() => {
        if (!_tauriWin) { clearInterval(_tauriTimer); return; }
        _tSend('progress', { currentTime: ap.currentTime||0, duration: ap.duration||0 });
      }, 100); // 100ms = sync avec SpicyLyrics (vs 500ms trop lent)
_tSend('state', _tState());
_tSend('progress', { currentTime: ap.currentTime||0, duration: ap.duration||0 });
  }

  function _tStopSync() {
    const ap = $('audioPlayer');
    if (ap) {
      if (_tauriTrackCb) ap.removeEventListener('loadstart', _tauriTrackCb);
      if (_tauriPlayCb)  { ap.removeEventListener('play', _tauriPlayCb); ap.removeEventListener('pause', _tauriPlayCb); }
    }
    _tauriTrackCb = _tauriPlayCb = null;
    if (_tauriTimer) { clearInterval(_tauriTimer); _tauriTimer = null; }
  }

  async function _openTauri() {
    const T = window.__TAURI__;
    if (!T) return;
    const WW = T.webviewWindow?.WebviewWindow;
    if (!WW) { console.error('[MiniPlayer] WebviewWindow introuvable'); return; }

    // Ramener au premier plan si déjà ouverte
    if (_tauriWin) {
      try { await _tauriWin.show(); await _tauriWin.setFocus(); _tSend('state', _tState()); return; }
      catch(_) { _tauriWin = null; }
    }

    // Enregistrer le listener AVANT de créer la fenêtre
    if (_tauriUnlisten) { try { _tauriUnlisten(); } catch(_){} }
    _tauriUnlisten = await T.event.listen('beartify://mp-cmd', ({ payload: d }) => {
      switch (d?.cmd) {
        case 'play':     $('playPauseBtn')?.click(); break;
        case 'prev':     $('prevBtn')?.click();      break;
        case 'next':     $('nextBtn')?.click();      break;
        case 'shuffle':  $('shuffleBtn')?.click();   break;
        case 'repeat':   $('repeatBtn')?.click();    break;
        case 'seek':     { const ap=$('audioPlayer'); if(ap&&isFinite(d.value)) ap.currentTime=d.value; break; }
        case 'getState': {
          _tSend('state', _tState());
          _tSend('progress', { currentTime: $('audioPlayer')?.currentTime||0, duration: $('audioPlayer')?.duration||0 });
          // Paroles : renvoyer le miroir DOM complet (HTML + classes réelles),
          // pas juste un triplet texte — voir _tLyricsRebuild()/_tStartLyricsSync().
          _tLyricsRebuild();
          break;
        }
        case 'repeat': $('repeatBtn')?.click(); setTimeout(()=>{ _tSend('state', _tState()); }, 80); break;
        case 'getQueue': {
          const items = (window._mpGetQueue?.() || []).map(({ idx, track: t }) => ({
            idx,
            title:    t.title    || '—',
            artist:   t.artist   || '',
            imageUrl: t.imageUrl || '',
            duration: t.duration || 0,
          }));
          _tSend('queue', { items });
          break;
        }
      }
    });

    // Chemin relatif à la racine de l'app (distDir), PAS une URL absolue
    // avec origine : un `url` absolu (http://…/tauri://…) est traité par
    // WebviewWindow comme une navigation EXTERNE plutôt qu'un asset interne,
    // et peut alors arriver sans le bon Content-Type text/html — d'où un
    // rendu en texte brut au lieu du HTML parsé. Même convention que
    // l'attribut src="mini-player/mini-player.js" déjà utilisé par index.html.
    const url = 'mini-player/mini-player.html';
    const x = Math.max(0, screen.width - 340), y = Math.max(0, screen.height - 380);
    try {
      _tauriWin = new WW('beartify-mini-player', {
        url, title: 'Beartify — Mini Player',
        width: 320, height: 320, minWidth: 220, minHeight: 220,
        resizable: true, decorations: false, alwaysOnTop: true,
        transparent: false, backgroundColor: '#0d0d0d',
        maximized: false, fullscreen: false, skipTaskbar: false, x, y,
      });
    } catch(err) { console.error('[MiniPlayer] WebviewWindow exception:', err); return; }

    _tauriWin.once('tauri://created', () => {
      _tStartSync();
      _tStartLyricsSync();
      setTimeout(() => {
        const s = _tState();
        _tSend('state', s);
        _tSend('progress', { currentTime: $('audioPlayer')?.currentTime||0, duration: $('audioPlayer')?.duration||0 });
      }, 300);
    });
    _tauriWin.once('tauri://error', err => { console.error('[MiniPlayer] tauri://error:', err); _tauriWin = null; });
    _tauriWin.once('tauri://destroyed', () => { _tStopSync(); _tStopLyricsSync(); if(_tauriUnlisten){_tauriUnlisten();_tauriUnlisten=null;} _tauriWin=null; });
    _tauriWin.once('tauri://close-requested', () => { _tauriWin?.close().catch(()=>{}); });
  }

  async function _closeTauri() {
    _tStopSync();
    _tStopLyricsSync();
    if (_tauriUnlisten) { try { _tauriUnlisten(); } catch(_){} _tauriUnlisten = null; }
    if (_tauriWin) { try { await _tauriWin.close(); } catch(_){} _tauriWin = null; }
  }

  // ── Utilitaires ───────────────────────────────────────────────────
  function _fmt(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }
  function _esc(s) {
    return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ────────────────────────────────────────────────────────────────
  //  Fond — div de fond ou étoiles starry
  // ────────────────────────────────────────────────────────────────
  function _applyBg(pipDoc) {
    const key = _getThemeKey();
    const t   = THEMES[key];

    pipDoc.getElementById('mp-bg-div')?.remove();
    pipDoc.getElementById('mp-starry-bg')?.remove();
    if (_starryObs) { _starryObs.disconnect(); _starryObs = null; }

    if (key === 'starry') {
      _initStarryPip(pipDoc);
    } else {
      const bgDiv = pipDoc.createElement('div');
      bgDiv.id = 'mp-bg-div';
      Object.assign(bgDiv.style, {
        position:'fixed', inset:'0', zIndex:'-1',
        background: t.bg, width:'100%', height:'100%',
        pointerEvents:'none',
      });
      pipDoc.body.insertBefore(bgDiv, pipDoc.body.firstChild);
    }

    const root = pipDoc.getElementById('mpRoot');
    if (root) { root.style.background = t.elevated; root.style.color = t.text; }

    const tw = pipDoc.getElementById('mpTitleWrap');
    const aw = pipDoc.getElementById('mpArtistWrap');
    const sl = pipDoc.getElementById('mpLyricsSlot');
    const qs = pipDoc.getElementById('mpQueueSlot');
    if (tw) tw.style.color = t.text;
    if (aw) aw.style.color = t.sub;
    if (sl) sl.style.borderTop = `1px solid ${t.deco}`;
    if (qs) { qs.style.borderTop = `1px solid ${t.deco}`; qs.style.color = t.text; }

    // Couleurs paroles thème clair
    let lyricsStyle = pipDoc.getElementById('mp-lyrics-colors');
    if (!lyricsStyle) {
      lyricsStyle = pipDoc.createElement('style');
      lyricsStyle.id = 'mp-lyrics-colors';
      pipDoc.head.appendChild(lyricsStyle);
    }
    // Classes réelles générées par spicy-lyrics-engine.js : préfixe "sl2-".
    // (.spicy-lyrics-line / .lrc-line / .line n'existent nulle part dans le
    // moteur — anciens noms jamais mis à jour après le renommage en sl2-.)
    lyricsStyle.textContent = t.lyricsText ? `
    #lyricsDisplay .sl2-line,
    #lyricsDisplay .sl2-bg-line { color: ${t.lyricsText} !important; }
    #lyricsDisplay .sl2-line.sl2-Active,
    #lyricsDisplay .sl2-bg-line.sl2-Active { color: ${t.lyricsActive} !important; }
    ` : '';
  }

  // ── Fond dynamique CSS (indépendant de background.js) ─────────────
  // Tente d'extraire les couleurs via canvas. En cas d'échec CORS,
  // utilise un dégradé basé sur le titre/artiste (hash).
  function _updateDynBg(pipDoc) {
    const dynBg = pipDoc.getElementById('mpDynBg');
    if (!dynBg) return;

    const t   = window.currentTrack;
    const src = t?.imageUrl;

    // Dégradé de fallback dérivé du titre (toujours lisible)
    const _fallback = () => {
      const str  = (t?.title || '') + (t?.artist || '');
      let h1 = 0, h2 = 137;
      for (let i = 0; i < str.length; i++) {
        h1 = ((h1 << 5) - h1 + str.charCodeAt(i)) | 0;
        h2 = ((h2 << 3) + str.charCodeAt(i)) | 0;
      }
      const c1 = `hsl(${Math.abs(h1) % 360},40%,18%)`;
      const c2 = `hsl(${Math.abs(h2) % 360},50%,12%)`;
      dynBg.style.background = `linear-gradient(135deg,${c1},${c2},${c1})`;
    };

    if (!src) { _fallback(); return; }

    // Tenter l'extraction canvas (échoue si CORS bloque)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const _timer = setTimeout(_fallback, 1500); // timeout si CORS bloque
    img.onload = () => {
      clearTimeout(_timer);
      try {
        const c = document.createElement('canvas');
        c.width = 4; c.height = 4;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 4, 4);
        const d  = ctx.getImageData(0, 0, 4, 4).data;
        const c1 = `rgb(${d[0]},${d[1]},${d[2]})`;
        const c2 = `rgb(${d[48]},${d[49]},${d[50]})`;
        const c3 = `rgb(${Math.round((d[0]+d[48])/2)},${Math.round((d[1]+d[49])/2)},${Math.round((d[2]+d[50])/2)})`;
        dynBg.style.background = `linear-gradient(135deg,${c1},${c3},${c2})`;
      } catch { _fallback(); }
    };
    img.onerror = () => { clearTimeout(_timer); _fallback(); };
    img.src = src;
  }

  // ── Fond dynamique WebGL (ImmersiveBgRenderer de background.js) ──────
  let _renderer = null, _beatSync = null, _timeCb = null;
  const ND_PIP = { warpIntensity:1, blurPasses:8, animationSpeed:.1,
    saturation:1.0, dithering:.008, transitionDuration:1000, tintIntensity:0, scale:1 };

    async function _startDynBg(pipDoc) {
      if (!window._ImmersiveBgRenderer) return false;
      const canvas = pipDoc.getElementById('mpDynBgCanvas');
      if (!canvas) return false;
      canvas.width = PIP_W; canvas.height = PIP_H; canvas.style.opacity = '0';
      try { _renderer = new window._ImmersiveBgRenderer(canvas, ND_PIP); }
      catch(e) { _renderer = null; return false; }
      const _scc = window._sampleCoverColors || ((s,cb)=>cb(['#1a0a2e','#2e0a1a','#0a1a2e']));
      const src = window.currentTrack?.imageUrl || 'pictures/default-cover.png';
      await _renderer.loadImage(src).catch(()=>
      new Promise(r=>{_scc(src,cols=>{_renderer?.loadGradient(cols);r();});}));
      canvas.style.opacity = '1';
      _renderer.start();
      if (window._BeatSync) _beatSync = new window._BeatSync();
      const ap = document.getElementById('audioPlayer');
      if (ap) {
        _timeCb = () => {
          if (!_renderer) return;
          if (ap.paused) { _renderer.setOptions({animationSpeed:.1}); return; }
          const bpm = window.currentTrack?.bpm;
          _renderer.setOptions({animationSpeed:(bpm&&_beatSync)?_beatSync.getSpeedMultiplier(ap.currentTime):1});
        };
        ap.addEventListener('timeupdate', _timeCb);
      }
      return true;
    }
    function _stopDynBg() {
      const ap = document.getElementById('audioPlayer');
      if (ap && _timeCb) { ap.removeEventListener('timeupdate', _timeCb); _timeCb = null; }
      if (_renderer) { _renderer.stop?.(); _renderer.dispose?.(); _renderer = null; }
      _beatSync = null;
    }
    function _updateDynBg() {
      if (!_renderer) return;
      const src = window.currentTrack?.imageUrl; if (!src) return;
      const _scc = window._sampleCoverColors||((s,cb)=>cb(['#1a0a2e','#2e0a1a','#0a1a2e']));
      _renderer.loadImage(src).catch(()=>
      new Promise(r=>{_scc(src,cols=>{_renderer?.loadGradient(cols);r()});}));
      if (_beatSync&&window.currentTrack?.bpm)
        _beatSync.setTrack(window.currentTrack.bpm, window.currentTrack.loudness);
    }

    // ── Étoiles starry ────────────────────────────────────────────────
    function _initStarryPip(pipDoc) {
      if (!pipDoc.getElementById('mp-starry-style')) {
        const st = pipDoc.createElement('style');
        st.id = 'mp-starry-style';
        st.textContent = `
        .beartify-starry-bg{position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;overflow:hidden;background:linear-gradient(180deg,#000000 0%,#142b44 100%);}
        .bsn-star{position:absolute;border-radius:50%;background:#fff;}
        .bsn-shooting{position:absolute;width:4px;height:4px;background:#fff;border-radius:50%;animation:bsnShoot 3s linear forwards;}
        .bsn-shooting::before{content:'';position:absolute;top:50%;transform:translateY(-50%);width:200px;height:1px;background:linear-gradient(90deg,#fff,transparent);}
        @keyframes bsnShoot{0%{transform:rotate(315deg) translateX(0);opacity:1}70%{opacity:1}100%{transform:rotate(315deg) translateX(-800px);opacity:0}}
        @keyframes bsnTwinkle1{0%,80%,100%{box-shadow:0 0 8px 2px #fff}20%,40%,60%{box-shadow:none}}
        @keyframes bsnTwinkle2{0%,20%,100%{box-shadow:0 0 8px 2px #fff}40%,60%,80%{box-shadow:none}}
        @keyframes bsnTwinkle3{0%,40%,60%{box-shadow:0 0 8px 2px #fff}20%,80%,100%{box-shadow:none}}
        @keyframes bsnTwinkle4{0%,20%{box-shadow:none}40%,60%,80%{box-shadow:0 0 8px 2px #fff}100%{box-shadow:none}}
        `;
        pipDoc.head.appendChild(st);
      }
      const bg = pipDoc.createElement('div');
      bg.className = 'beartify-starry-bg'; bg.id = 'mp-starry-bg';
      pipDoc.body.insertBefore(bg, pipDoc.body.firstChild);

      const _gen = container => {
        container.querySelectorAll('.bsn-star').forEach(s => s.remove());
        const w = container.clientWidth || PIP_W, h = container.clientHeight || PIP_H;
        const frag = pipDoc.createDocumentFragment();
        for (let i = 0; i < Math.min(Math.floor((w*h)/4000), 200); i++) {
          const size = Math.random() < 0.6 ? 1 : 2, el = pipDoc.createElement('div');
          el.className = 'bsn-star';
          const tw = Math.random() < 0.2 ? `animation:bsnTwinkle${Math.floor(Math.random()*4)+1} 5s infinite` : '';
          el.style.cssText = [`left:${(Math.random()*99).toFixed(2)}%`,`top:${(Math.random()*99).toFixed(2)}%`,`width:${size}px`,`height:${size}px`,`opacity:${(0.5+Math.random()*0.5).toFixed(2)}`,tw].filter(Boolean).join(';');
          frag.appendChild(el);
        }
        container.appendChild(frag);
      };
      const _shoot = container => {
        const el = pipDoc.createElement('span');
        el.className = 'bsn-shooting';
        const _pos = () => { el.style.top='-4px'; el.style.right=`${(Math.random()*90).toFixed(1)}%`; el.style.left='auto'; };
        _pos(); el.style.animationDuration=`${Math.floor(Math.random()*3)+3}s`; el.style.animationDelay=`${Math.floor(Math.random()*7)}s`;
        el.addEventListener('animationend', () => { _pos(); el.style.animation='none'; void el.offsetWidth; el.style.animation=''; el.style.animationDuration=`${Math.floor(Math.random()*4)+3}s`; el.style.animationDelay='0s'; });
        container.appendChild(el);
      };
      const _start = () => { _gen(bg); for (let i=0;i<2;i++) _shoot(bg); };
      bg.clientWidth ? _start() : _pipWin.requestAnimationFrame(_start);
      if (_pipWin.ResizeObserver) { _starryObs = new _pipWin.ResizeObserver(() => _gen(bg)); _starryObs.observe(bg); }
    }

    function _watchTheme() {
      _themeObs = new MutationObserver(() => {
        if (_pipWin && !_pipWin.closed) _applyBg(_pipWin.document);
      });
        _themeObs.observe(document.body, { attributes: true, attributeFilter: ['class','style'] });
    }
    function _unwatchTheme() { _themeObs?.disconnect(); _themeObs = null; }

    // ── Copie des stylesheets ─────────────────────────────────────────
    function _copyStyles(pipDoc) {
      document.head
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach(n => pipDoc.head.appendChild(n.cloneNode(true)));
    }

    // ── HTML du widget ─────────────────────────────────────────────────
    function _widgetHTML(base) {
      const p = n => `${base}pictures/${n}`;
      return `
      <div class="mp-root" id="mpRoot">

      <div class="mp-header">
      <div class="mp-cover-thumb" id="mpCoverThumb">
      <img id="mpCoverImg" src="${p('default-cover.png')}" alt="Pochette">
      </div>
      <div class="mp-meta">
      <div class="mp-title-wrap"  id="mpTitleWrap"><span class="marquee-inner">—</span></div>
      <div class="mp-artist-wrap" id="mpArtistWrap"><span class="marquee-inner">—</span></div>
      </div>
      </div>

      <!-- Zone principale : dynbg + paroles + queue empilés -->
      <div class="mp-content" id="mpContent">
      <!-- Fond dynamique (CSS, derrière les paroles) -->
      <canvas class="mp-dynbg-canvas" id="mpDynBgCanvas"></canvas>
      <!-- Paroles -->
      <div class="mp-lyrics-slot" id="mpLyricsSlot"></div>
      <!-- File d'attente -->
      <div class="mp-queue-slot" id="mpQueueSlot"></div>
      </div>

      <!-- Overlay cover (survol) -->
      <div class="mp-cover-overlay" id="mpCoverOverlay">
      <img class="mp-overlay-img" id="mpOverlayImg" src="${p('default-cover.png')}" alt="">
      <div class="mp-cover-controls">

      <!-- Boutons haut : queue + fond dynamique -->
      <div class="mp-overlay-top">
      <button class="mp-icon-btn" id="mpQueueToggle" title="File d'attente">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M15 15H1v-1.5h14zm0-4.5H1V9h14zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5m2.5-1a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2z"></path></svg>
      </button>
      <button class="mp-icon-btn" id="mpDynBgToggle" title="Fond dynamique">
      <!-- Même tracé que #immBtnDynBg dans fullscreen.js -->
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/>
      <path d="M19 14l.8 2.6L22 17.5l-2.2.9L19 21l-.8-2.6-2.2-.9 2.2-.9L19 14z"/>
      </svg>
      </button>
      </div>

      <!-- Transport -->
      <div class="mp-transport">
      <button class="mp-ctrl-btn" id="mpBtnShuffle" title="Aléatoire">
      <svg class="mp-ctrl-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75z"></path>
      <path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"></path>
      <path d="M.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"></path>
      </svg>
      </button>
      <button class="mp-ctrl-btn" id="mpBtnPrev" title="Précédent">
      <svg class="mp-ctrl-icon" viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7z"></path>
      </svg>
      </button>
      <button class="mp-play-btn" id="mpBtnPlay" title="Lecture / Pause">
      <svg class="mp-play-icon" id="mpPlayIcon" viewBox="0 0 16 16" width="20" height="20" fill="#000" aria-hidden="true">
      <path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z"></path>
      </svg>
      <svg class="mp-play-icon" id="mpPauseIcon" viewBox="0 0 16 16" width="20" height="20" fill="#000" aria-hidden="true" style="display:none">
      <path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>
      </svg>
      </button>
      <button class="mp-ctrl-btn" id="mpBtnNext" title="Suivant">
      <svg class="mp-ctrl-icon" viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z"></path>
      </svg>
      </button>
      <button class="mp-ctrl-btn" id="mpBtnRepeat" title="Répéter">
      <!-- Contenu (tracé "playlist" vs "titre") synchronisé dynamiquement
      depuis #repeatIcon (index.html) via innerHTML — voir _syncRepeat().
      Le tracé initial ci-dessous est celui du mode "playlist" par défaut. -->
      <svg class="mp-ctrl-icon" id="mpRepeatIcon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75z"></path>
      </svg>
      </button>
      </div>

      <!-- Barre de progression -->
      <div class="mp-progress-row">
      <span class="mp-time" id="mpTimeCur">0:00</span>
      <div class="mp-prog-track" id="mpProgTrack">
      <div class="mp-prog-fill" id="mpProgFill"></div>
      </div>
      <span class="mp-time end" id="mpTimeEnd">—</span>
      </div>

      </div>
      </div>

      </div>
      `;
    }

    // ── Marquee ────────────────────────────────────────────────────────
    function _marquee(pd, wrapId, text) {
      const wrap = pd.getElementById(wrapId);
      if (!wrap) return;
      wrap.classList.remove('has-marquee');
      wrap.innerHTML = '';
      const inner = pd.createElement('span');
      inner.className = 'marquee-inner'; inner.textContent = text;
      wrap.appendChild(inner);
      _pipWin.requestAnimationFrame(() => {
        const ov = inner.scrollWidth - wrap.clientWidth;
        if (ov > 6) {
          const gap = 52, total = inner.scrollWidth + gap;
          const safe = _esc(text);
          inner.innerHTML = `<span class="marquee-orig">${safe}</span><span style="display:inline-block;width:${gap}px"></span><span class="marquee-clone" aria-hidden="true">${safe}</span>`;
          inner.style.setProperty('--marquee-offset',   `-${total}px`);
          inner.style.setProperty('--marquee-duration', `${Math.max(8, total / 16)}s`);
          inner.classList.add('marquee-on'); wrap.classList.add('has-marquee');
        }
      });
    }

    // ── Sync piste ─────────────────────────────────────────────────────
    function _syncTrack() {
      if (!_pipWin || _pipWin.closed) return;
      const pd = _pipWin.document, t = window.currentTrack;
      const src = t?.imageUrl || 'pictures/default-cover.png';
      const ci  = pd.getElementById('mpCoverImg'), oi = pd.getElementById('mpOverlayImg');
      if (ci) ci.src = src;
      if (oi) oi.src = src;
      _marquee(pd, 'mpTitleWrap',  t?.title || '—');
      _marquee(pd, 'mpArtistWrap', $('currentArtist')?.textContent || t?.artist || '—');
      if (_queueMode)  _populateQueue(pd);
      if (_dynBgMode)  _updateDynBg();
    }

    function _syncPlay() {
      if (!_pipWin || _pipWin.closed) return;
      const ap = $('audioPlayer'), pi = $p('mpPlayIcon'), pai = $p('mpPauseIcon');
      if (!pi || !pai) return;
      const playing = ap && !ap.paused;
      pi.style.display  = playing ? 'none' : '';
      pai.style.display = playing ? ''     : 'none';
    }

    function _syncRepeat() {
      // #repeatIcon (index.html) est un <svg> dont playback-engine.js réécrit le
      // innerHTML (tracé "playlist" ↔ "titre" avec le petit 1) — copier .src
      // (propriété inexistante sur un SVGElement) ne faisait donc jamais rien.
      // Même pattern que fullscreen.js (_initPlaybackStateSync / syncIcon).
      const s = $('repeatIcon'), d = $p('mpRepeatIcon');
      if (s && d) d.innerHTML = s.innerHTML;
    }

    let _repeatIconObs = null;
    function _watchRepeatIcon() {
      const s = $('repeatIcon');
      if (!s) return;
      _repeatIconObs = new MutationObserver(_syncRepeat);
      _repeatIconObs.observe(s, { childList: true });
    }
    function _unwatchRepeatIcon() { _repeatIconObs?.disconnect(); _repeatIconObs = null; }

    function _bindAudio() {
      const ap = $('audioPlayer');
      ap?.addEventListener('play',      _syncPlay);
      ap?.addEventListener('pause',     _syncPlay);
      ap?.addEventListener('loadstart', _syncTrack);
    }
    function _unbindAudio() {
      const ap = $('audioPlayer');
      ap?.removeEventListener('play',      _syncPlay);
      ap?.removeEventListener('pause',     _syncPlay);
      ap?.removeEventListener('loadstart', _syncTrack);
    }

    // ────────────────────────────────────────────────────────────────
    //  File d'attente — lit directement le DOM de #panelQueueContent
    //  déjà rendu par script.js. Simule un clic sur l'item original
    //  pour déclencher la lecture (aucune modification de script.js).
    // ────────────────────────────────────────────────────────────────
    function _populateQueue(pipDoc) {
      const slot = pipDoc.getElementById('mpQueueSlot');
      if (!slot) return;
      slot.innerHTML = '';

      const source = document.getElementById('panelQueueContent');
      const items  = source?.querySelectorAll('.panel-queue-item');

      if (!items || items.length === 0) {
        slot.innerHTML = `<p style="padding:14px;opacity:.5;font-size:.77rem;text-align:center">File d'attente vide</p>`;
        return;
      }

      const t = _getThemeKey();
      const textColor = THEMES[t].text;
      const subColor  = THEMES[t].sub;

      items.forEach(orig => {
        const img    = orig.querySelector('.panel-queue-art img')?.src || '';
        const title  = orig.querySelector('.panel-queue-title')?.textContent?.trim() || '—';
        const artist = orig.querySelector('.panel-queue-artist')?.textContent?.trim() || '';
        const dur    = orig.querySelector('.panel-queue-dur')?.textContent?.trim() || '';

        const row = pipDoc.createElement('div');
        row.className = 'mp-q-item';
        row.innerHTML = `
        ${img ? `<img class="mp-q-thumb" src="${_esc(img)}" alt="">` : '<div class="mp-q-thumb"></div>'}
        <div class="mp-q-info">
        <div class="mp-q-title" style="color:${textColor}">${_esc(title)}</div>
        <div class="mp-q-artist" style="color:${subColor}">${_esc(artist)}</div>
        </div>
        ${dur ? `<div class="mp-q-dur" style="color:${subColor}">${_esc(dur)}</div>` : ''}
        `;

        // Clic → simule le clic sur l'item original dans le document parent
        // script.js gère alors la lecture (currentIndex + playCurrentTrack)
        row.addEventListener('click', () => {
          orig.click();
          _setQueueMode(false, pipDoc);
        });

        slot.appendChild(row);
      });
    }

    function _setQueueMode(on, pipDoc) {
      _queueMode = on;
      const lyricsSlot  = pipDoc.getElementById('mpLyricsSlot');
      const queueSlot   = pipDoc.getElementById('mpQueueSlot');
      const queueToggle = pipDoc.getElementById('mpQueueToggle');
      if (!lyricsSlot || !queueSlot) return;
      if (on) {
        _populateQueue(pipDoc);
        lyricsSlot.style.display = 'none';
        queueSlot.classList.add('active');
        queueToggle?.classList.add('active');
      } else {
        queueSlot.classList.remove('active');
        queueSlot.innerHTML = '';
        lyricsSlot.style.display = '';
        queueToggle?.classList.remove('active');
      }
    }

    // ── Barre de progression ───────────────────────────────────────────
    function _startProgressLoop(pipDoc) {
      const fill    = pipDoc.getElementById('mpProgFill');
      const timeCur = pipDoc.getElementById('mpTimeCur');
      const timeEnd = pipDoc.getElementById('mpTimeEnd');
      const ap      = $('audioPlayer');
      if (!fill || !ap) return;

      const _update = () => {
        const cur = ap.currentTime || 0;
        const dur = ap.duration   || 0;
        fill.style.width              = dur > 0 ? `${(cur / dur) * 100}%` : '0%';
        if (timeCur) timeCur.textContent = _fmt(cur);
        if (timeEnd) timeEnd.textContent = dur > 0 ? _fmt(dur) : '—';
      };
        ap.addEventListener('timeupdate', _update);
        ap._mpProgressCb = _update;
        _update();

        const track = pipDoc.getElementById('mpProgTrack');
        if (!track) return;
        let dragging = false;
      const _seek = e => {
        const r   = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        if (isFinite(ap.duration) && ap.duration > 0) {
          ap.currentTime = pct * ap.duration;
          fill.style.width = `${pct * 100}%`;
          if (timeCur) timeCur.textContent = _fmt(ap.currentTime);
        }
      };
      track.addEventListener('mousedown', e => {
        dragging = true; _seek(e); fill.style.transition = 'none';
      });
      pipDoc.addEventListener('mousemove', e => { if (dragging) _seek(e); });
      pipDoc.addEventListener('mouseup',   () => {
        if (dragging) { dragging = false; fill.style.transition = ''; }
      });
    }

    function _stopProgressLoop() {
      const ap = $('audioPlayer');
      if (ap && ap._mpProgressCb) {
        ap.removeEventListener('timeupdate', ap._mpProgressCb);
        delete ap._mpProgressCb;
      }
    }

    // ── Padding scroll container ───────────────────────────────────────
    function _zeroScrollPadding(sc) {
      sc.style.setProperty('padding',             '0 10px 60px', 'important');
      sc.style.setProperty('padding-top',         '0',           'important');
      sc.style.setProperty('padding-bottom',      '60px',        'important');
      sc.style.setProperty('padding-block-start', '0',           'important');
      sc.style.setProperty('padding-block-end',   '60px',        'important');
      sc.style.setProperty('margin',              '0',           'important');
      sc.style.setProperty('margin-top',          '0',           'important');
      sc.style.setProperty('margin-bottom',       '0',           'important');
    }
    function _unwatchScrollPadding() { _paddingObs?.disconnect(); _paddingObs = null; }

    // ── Scroll ─────────────────────────────────────────────────────────
    function _scrollToLine(lineEl, behavior) {
      if (!_lyricNode || !lineEl) return;
      const ch = _lyricNode.clientHeight;
      if (!ch) return;
      const cRect  = _lyricNode.getBoundingClientRect();
      const lRect  = lineEl.getBoundingClientRect();
      const relTop = lRect.top - cRect.top + _lyricNode.scrollTop;
      const target = relTop - ch / 2 + lineEl.offsetHeight / 2;
      _lyricNode.scrollTo({ top: Math.max(0, Math.min(target, _lyricNode.scrollHeight - ch)), behavior });
    }

    function _initialScrollSync() {
      if (!_lyricNode) return;
      // Retrouve la ligne active dans l'original (#lyricsDisplay, document
      // principal), puis son homologue dans le clone miroir en comparant leur
      // index dans le conteneur de scroll — pas besoin d'un objet d'état global
      // du moteur (ex. "window.spicy"), qui n'existe nulle part dans ce projet.
      const ld = $('lyricsDisplay');
      const origScrollCont = ld?.querySelector('.sl2-scroll-container');
      if (!origScrollCont) { _lyricNode.scrollTo({ top:0, behavior:'instant' }); return; }

      let targetOrigEl = origScrollCont.querySelector('.sl2-line.sl2-Active:not(.sl2-musical-line)');
      if (!targetOrigEl) {
        const sung = origScrollCont.querySelectorAll('.sl2-line.sl2-Sung:not(.sl2-musical-line)');
        if (sung.length) targetOrigEl = sung[sung.length - 1];
      }
      if (!targetOrigEl) { _lyricNode.scrollTo({ top:0, behavior:'instant' }); return; }

      const mirrorScrollCont = _lyricNode.querySelector('.sl2-scroll-container');
      if (!mirrorScrollCont) { _lyricNode.scrollTo({ top:0, behavior:'instant' }); return; }

      const idx      = [...origScrollCont.children].indexOf(targetOrigEl);
      const mirrorEl = mirrorScrollCont.children[idx];
      if (!mirrorEl) { _lyricNode.scrollTo({ top:0, behavior:'instant' }); return; }

      _scrollToLine(mirrorEl, 'instant');
    }

    function _startScrollLoop() {
      _lastLineEl = null;
      let _pending = false;
      function tick() {
        if (!_pipWin || _pipWin.closed || !_lyricNode) return;
        _rafId = _pipWin.requestAnimationFrame(tick);
        let active = _lyricNode.querySelector('.sl2-line.sl2-Active:not(.sl2-musical-line)');
        if (!active) { const s = _lyricNode.querySelectorAll('.sl2-line.sl2-Sung:not(.sl2-musical-line)'); if (s.length) active = s[s.length-1]; }
        if (!active || active === _lastLineEl) return;
        _lastLineEl = active;
        if (_pending) return;
        _pending = true;
        setTimeout(() => {
          _pending = false;
          if (!active || !_lyricNode) return;
          const ch = _lyricNode.clientHeight;
          const cRect = _lyricNode.getBoundingClientRect(), lRect = active.getBoundingClientRect();
          const lineC = lRect.top - cRect.top + _lyricNode.scrollTop + active.offsetHeight / 2;
          if (Math.abs(lineC - (_lyricNode.scrollTop + ch / 2)) > ch * 0.25) _scrollToLine(active, 'smooth');
        }, 80);
      }
      _rafId = _pipWin.requestAnimationFrame(tick);
    }

    function _stopScrollLoop() {
      if (_rafId && _pipWin && !_pipWin.closed) _pipWin.cancelAnimationFrame(_rafId);
      _rafId = null; _lastLineEl = null;
    }

    // ── Miroir #lyricsDisplay ──────────────────────────────────────────
    //
    //  Ancienne approche : adoptNode déplaçait #lyricsDisplay dans le PiP,
    //  laissant le panneau Paroles principal vide.
    //
    //  Nouvelle approche : #lyricsDisplay RESTE dans le document principal.
    //  Un clone profond (cloneNode) est injecté dans le PiP, puis un
    //  MutationObserver synchronise en temps-réel toutes les mutations
    //  de classe et de style (animations SpicyLyrics) de l'original vers
    //  le clone. Les deux vues sont ainsi identiques et simultanées.
    //
    //  Quand renderSpicyLyrics reconstruit entièrement lyricsDisplay
    //  (nouvelle piste, état de chargement, aucune parole trouvée…),
    //  un childList change est détecté → le clone est reconstruit au prochain
    //  requestAnimationFrame (après que le JS courant ait fini de remplir le DOM).

    function _buildMirror(ld, slot) {
      // Déconnecter l'observateur précédent avant de reconstruire
      if (_mirrorObs) { _mirrorObs.disconnect(); _mirrorObs = null; }
      _stopScrollLoop();

      // ── Clonage ──────────────────────────────────────────────────────
      slot.innerHTML = '';
      const clone = ld.cloneNode(true);
      clone.id = 'lyricsDisplayMirror';
      // Appliquer les mêmes overrides que l'ancienne approche adoptNode
      clone.style.setProperty('display',             'block',   'important');
      clone.style.setProperty('--DefaultLyricsSize', '1.65rem', 'important');
      clone.style.setProperty('mask-image',          'none',    'important');
      clone.style.setProperty('-webkit-mask-image',  'none',    'important');
      const sc = clone.querySelector('.sl2-scroll-container');
      if (sc) _zeroScrollPadding(sc);
      slot.appendChild(clone);
      _lyricNode   = clone;
      _lyricParent = null;  // rien n'a été sorti du document principal

      // ── Table de correspondance original → clone ─────────────────────
      // Les deux arbres DOM sont structurellement identiques juste après le clone.
      const origEls   = [ld, ...ld.querySelectorAll('*')];
      const mirrorEls = [clone, ...clone.querySelectorAll('*')];
      const map = new Map();
      origEls.forEach((el, i) => map.set(el, mirrorEls[i]));

      // ── MutationObserver ─────────────────────────────────────────────
      // Surveille l'original sur deux axes :
      //   1. childList direct (lyricsDisplay.innerHTML = '…') → reconstruction
      //   2. attributes class/style sur tout le sous-arbre → synchronisation animation
      _mirrorObs = new MutationObserver(mutations => {
        let needRebuild = false;
        for (const m of mutations) {
          if (m.type === 'childList' && m.target === ld) {
            // Le DOM de lyricsDisplay a été entièrement reconstruit
            needRebuild = true;
          } else if (m.type === 'attributes') {
            const mirror = map.get(m.target);
            if (!mirror) continue;
            if (m.attributeName === 'class') {
              // Synchronise Active / Sung / NotSung et les animations SpicyLyrics
              mirror.className = m.target.className;
            } else if (m.attributeName === 'style') {
              // Ne pas copier le padding du scroll container :
              // il est géré indépendamment par _zeroScrollPadding.
              if (m.target.classList.contains('sl2-scroll-container')) continue;
              mirror.setAttribute('style', m.target.getAttribute('style') || '');
            }
          }
        }
        // Reconstruction différée : attend que renderSpicyLyrics (ou fetchLyrics)
        // ait fini de peupler le DOM avant de re-cloner.
        if (needRebuild && !_rebuildPending) {
          _rebuildPending = true;
          requestAnimationFrame(() => {
            _rebuildPending = false;
            if (!_pipWin || _pipWin.closed) return;
            const ldFresh   = $('lyricsDisplay');
            const slotFresh = $p('mpLyricsSlot');
            if (ldFresh && slotFresh) _buildMirror(ldFresh, slotFresh);
          });
        }
      });

      _mirrorObs.observe(ld, {
        childList:       true,   // détecter lyricsDisplay.innerHTML = '…'
        subtree:         true,   // couvrir tous les descendants
        attributes:      true,
        attributeFilter: ['class', 'style'],
      });

      // Deux rAF : laisser le PiP finir son layout avant de scroller
      _pipWin.requestAnimationFrame(() =>
      _pipWin.requestAnimationFrame(() => { _initialScrollSync(); _startScrollLoop(); })
      );
    }

    function _takeLyrics() {
      const ld = $('lyricsDisplay'), slot = $p('mpLyricsSlot');
      if (!ld || !slot) return;
      _buildMirror(ld, slot);
      // Note : aucun placeholder n'est nécessaire — #lyricsDisplay reste en place
      // dans le document principal et continue d'être animé normalement.
    }

    function _restoreLyrics() {
      _stopScrollLoop();
      _unwatchScrollPadding();
      if (_mirrorObs) { _mirrorObs.disconnect(); _mirrorObs = null; }
      _rebuildPending = false;
      // Vider le slot PiP (le clone y est ; l'original est intact dans le doc principal)
      const slot = $p('mpLyricsSlot');
      if (slot) slot.innerHTML = '';
      _lyricNode = null; _lyricParent = null;
      // Aucune restauration adoptNode nécessaire — #lyricsDisplay n'a jamais bougé.
    }

    // ── Cover hover ────────────────────────────────────────────────────
    function _bindCoverHover() {
      const root = $p('mpRoot'), thumb = $p('mpCoverThumb'), overlay = $p('mpCoverOverlay');
      if (!root || !thumb || !overlay) return;
      const expand   = () => root.classList.add('cover-expanded');
      const collapse = () => root.classList.remove('cover-expanded');
      thumb.addEventListener('mouseenter',   expand);
      overlay.addEventListener('mouseenter', expand);
      thumb.addEventListener('mouseleave',   e => { if (!overlay.contains(e.relatedTarget)) collapse(); });
      overlay.addEventListener('mouseleave', e => { if (!thumb.contains(e.relatedTarget))   collapse(); });
    }

    // ── Transport + boutons overlay ────────────────────────────────────
    function _bindTransport(pipDoc) {
      $p('mpBtnPlay')?.addEventListener('click',    () => $('playPauseBtn')?.click());
      $p('mpBtnPrev')?.addEventListener('click',    () => $('prevBtn')?.click());
      $p('mpBtnNext')?.addEventListener('click',    () => $('nextBtn')?.click());
      $p('mpBtnShuffle')?.addEventListener('click', () => $('shuffleBtn')?.click());
      $p('mpBtnRepeat')?.addEventListener('click',  () => { $('repeatBtn')?.click(); setTimeout(_syncRepeat, 80); });

      // Bouton file d'attente
      $p('mpQueueToggle')?.addEventListener('click', e => {
        e.stopPropagation();
        _setQueueMode(!_queueMode, pipDoc);
      });

      // Bouton fond dynamique (derrière les paroles)
      $p('mpDynBgToggle')?.addEventListener('click', async e => {
        e.stopPropagation();
        _dynBgMode = !_dynBgMode;
        const canvas = pipDoc.getElementById('mpDynBgCanvas');
        const tog    = pipDoc.getElementById('mpDynBgToggle');
        if (_dynBgMode) {
          const ok = await _startDynBg(pipDoc);
          if (!ok) { _dynBgMode = false; return; }
          tog?.classList.add('active');
        } else {
          _stopDynBg();
          if (canvas) canvas.style.opacity = '0';
          tog?.classList.remove('active');
        }
      });
    }

    // ── Fermeture ──────────────────────────────────────────────────────
    function _onClose() {
      _unbindAudio(); _unwatchTheme(); _unwatchRepeatIcon(); _restoreLyrics(); _stopProgressLoop(); _stopDynBg();
      if (_starryObs) { _starryObs.disconnect(); _starryObs = null; }
      _queueMode = false; _dynBgMode = false;
      _pipWin = null;
    }

    // ── OUVERTURE ──────────────────────────────────────────────────────
    async function _open() {
      if (_pipWin && !_pipWin.closed) { _pipWin.focus(); return; }
      window._closeImmersive?.();

      let pipWin;
      try {
        pipWin = await window.documentPictureInPicture.requestWindow({ width: PIP_W, height: PIP_H });
      } catch (err) {
        console.error('[MiniPlayer] requestWindow() échoué :', err);
        // Afficher un toast explicatif
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);' +
        'background:#1e1e2e;color:#fff;padding:10px 18px;border-radius:8px;font-size:0.82rem;' +
        'z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-width:300px;text-align:center;' +
        'font-family:DM Sans,sans-serif;';
        t.textContent = 'Mini-player indisponible. Accède via http://localhost:' +
        (location.port || '3000') + ' (contexte sécurisé requis).';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
        return;
      }

      _pipWin = pipWin; _queueMode = false; _dynBgMode = false;
      const pd   = pipWin.document;
      const base = window.location.href.replace(/[^/]*$/, '');

      _copyStyles(pd);
      pd.body.innerHTML = _widgetHTML(base);
      _applyBg(pd);
      _watchTheme();
      _watchRepeatIcon();
      _bindCoverHover();
      _bindTransport(pd);
      _syncTrack();
      _bindAudio();
      _syncPlay();
      _syncRepeat();
      _takeLyrics();
      _startProgressLoop(pd);

      pipWin.addEventListener('pagehide', _onClose);
    }

    function _close() {
      if (_pipWin && !_pipWin.closed) _pipWin.close();
    }

    if (btn) {
      btn.addEventListener('click', async e => {
        e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
        if (_isTauriDesktop()) {
          _tauriWin ? _closeTauri() : await _openTauri();
        } else if (PIP_OK) {
          (_pipWin && !_pipWin.closed) ? _close() : _open();
        } else {
          const toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);background:#1e1e2e;color:#fff;padding:10px 18px;border-radius:8px;font-size:.82rem;z-index:9999;max-width:300px;text-align:center;font-family:DM Sans,sans-serif;';
          toast.textContent = 'Mini-player non supporté (Chrome/Edge 116+ requis).';
          document.body.appendChild(toast); setTimeout(() => toast.remove(), 4000);
        }
      }, true);
    }

    // La fermeture de la fenêtre principale est gérée dans lib.rs via on_window_event :
    // quand main se ferme → process::exit(0) → toute l'app se ferme proprement.
    // Aucune gestion JS nécessaire ici.

    const _orig = window._openImmersive;
    window._openImmersive = function () {
      if (_pipWin && !_pipWin.closed) {
        // Restaurer synchronement avant que background.js prenne lyricsDisplay
        _restoreLyrics();
        _unbindAudio();
        _unwatchTheme();
        _unwatchRepeatIcon();
        _stopProgressLoop();
        _stopDynBg();
        if (_starryObs) { _starryObs.disconnect(); _starryObs = null; }
        _pipWin.removeEventListener('pagehide', _onClose);
        _pipWin.close();
        _pipWin = null;
        _queueMode = false; _dynBgMode = false;
      }
      _orig?.();
    };
    window._openMiniPlayer  = () => _isTauriDesktop() ? _openTauri()  : _open();
    window._closeMiniPlayer = () => _isTauriDesktop() ? _closeTauri() : _close();

})();
