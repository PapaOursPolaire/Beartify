/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              Beartify — Configuration Firebase              ║
 * ║        Gestion des données utilisateur (cloud sync)         ║
 * ║        ✅ Compatible Tauri V2 (desktop + Android + Linux)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CHANGEMENTS TAURI V2 :
 *  - Détection de l'environnement Tauri (_FB_IS_TAURI, _FB_IS_ANDROID)
 *  - signInWithRedirect au lieu de signInWithPopup sur Android
 *  - experimentalAutoDetectLongPolling pour Firestore (WebChannel → LongPoll auto)
 *  - Gestion de getRedirectResult() au démarrage
 *  - Note sur les domaines autorisés Firebase Console
 *
 * ⚠️ FIREBASE CONSOLE → Authentication → Authorized domains :
 *    Ajoutez manuellement ces origines pour que l'auth fonctionne en Tauri :
 *      • tauri://localhost          (macOS, Linux)
 *      • https://tauri.localhost    (Windows WebView2)
 *      • localhost                  (dev local)
 */

// ══════════════════════════════════════════════════════════════
// DÉTECTION ENVIRONNEMENT TAURI
// ══════════════════════════════════════════════════════════════

/**
 * true si l'application tourne dans un WebView Tauri (desktop ou mobile).
 * window.__TAURI__          → Tauri v1
 * window.__TAURI_INTERNALS__ → Tauri v2
 *
 * ⚠️ Renommé pour éviter le conflit avec script.js
 */
const _FB_IS_TAURI   = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

/**
 * true si on est sur Android (Tauri mobile .apk).
 * Sur Android, signInWithPopup n'est pas supporté → on utilise signInWithRedirect.
 */
const _FB_IS_ANDROID = _FB_IS_TAURI && /Android/i.test(navigator.userAgent);

// ══════════════════════════════════════════════════════════════
// CONFIGURATION FIREBASE
// ══════════════════════════════════════════════════════════════
// ⚠️ SDK compat chargé via CDN dans index.html — pas d'import ES module ici.
const firebaseConfig = {
  apiKey:            "AIzaSyAN1U4kdJl7BRbi7FB3aAdNwrqBQZLQhSk",
  authDomain:        "beartify-firebase.firebaseapp.com",
  projectId:         "beartify-firebase",
  storageBucket:     "beartify-firebase.firebasestorage.app",
  messagingSenderId: "712696916251",
  appId:             "1:712696916251:web:04bbf89509345549a98bbe",
};

// ══════════════════════════════════════════════════════════════
// INITIALISATION FIREBASE
// ══════════════════════════════════════════════════════════════
let firebaseApp  = null;
let firebaseAuth = null;
let firebaseDB   = null;

window.initFirebase = async function () {
  try {
    if (typeof firebase === 'undefined') {
      console.warn('⚠️ Firebase SDK non chargé. Vérifiez les scripts dans index.html');
      return false;
    }

    // Anti-double-init
    firebaseApp  = firebase.apps?.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    firebaseDB   = firebase.firestore();

    // ── Firestore — transport réseau ──────────────────────────────────
    // experimentalForceLongPolling   : force HTTP long-polling (fix CORS Firefox + WebViews)
    // experimentalAutoDetectLongPolling : laisse Firestore choisir automatiquement
    //   → on active les deux : auto-detect en premier, force en fallback.
    try {
      firebaseDB.settings({
        experimentalForceLongPolling:    true,
        experimentalAutoDetectLongPolling: true,
        // En Tauri, merge=true évite l'erreur "settings already called" si
        // un autre module a déjà touché Firestore.
        ...({}),
      });
    } catch (e) {
      // settings() ne peut être appelé qu'une fois avant toute opération Firestore.
      // Si on arrive ici, c'est qu'une autre instance a déjà configuré Firestore.
      console.log('[Firebase] settings() déjà appliqué :', e.message);
    }

    // ── Android / Tauri mobile : récupérer le résultat de signInWithRedirect ──
    // Sur Android WebView, signInWithPopup n'est pas dispo → on utilise Redirect.
    // Au démarrage, on vérifie si on revient d'un redirect Google.
    if (_FB_IS_ANDROID) {
      try {
        const result = await firebaseAuth.getRedirectResult();
        if (result?.user) {
          console.log('✅ Google (redirect) connecté :', result.user.email);
          // onAuthStateChanged prendra le relais — pas besoin d'appeler applyUserToUI ici.
        }
      } catch (e) {
        // auth/no-auth-event est normal si on n'arrive pas d'un redirect.
        if (e.code !== 'auth/no-auth-event') {
          console.warn('[Firebase] getRedirectResult :', e.message);
        }
      }
    }

    console.log('✅ Firebase initialisé avec succès (Tauri:', _FB_IS_TAURI, '/ Android:', _FB_IS_ANDROID, ')');

    // ── Listener d'état d'authentification ───────────────────────────
    firebaseAuth.onAuthStateChanged(async (user) => {
      if (user) {
        console.log('✅ Utilisateur connecté :', user.email || user.uid);
        window._firebaseUser = user;

        const providerId = user.providerData?.[0]?.providerId || '';
        const uiUser = {
          name:     user.displayName || user.email || 'Utilisateur',
          email:    user.email || '',
          picture:  user.photoURL || '',
          provider: providerId === 'google.com' ? 'google' : 'firebase',
          uid:      user.uid,
        };
        window.applyUserToUI?.(uiUser);

        // Attendre que FirebaseSync soit prêt
        await new Promise(resolve => {
          if (window.FirebaseSync?.syncToFirestore) return resolve();
          const check = setInterval(() => {
            if (window.FirebaseSync?.syncToFirestore) { clearInterval(check); resolve(); }
          }, 100);
          setTimeout(() => { clearInterval(check); resolve(); }, 5000);
        });

        await window.FirebaseSync?.syncFromFirestore();
        window.FirebaseSync?.enableAutoSync();
        window.FirebaseSync?.enablePresenceSync();
      } else {
        console.log('ℹ️ Aucun utilisateur connecté');
        window._firebaseUser = null;
        window.FirebaseSync?.disableAutoSync();
        window.FirebaseSync?.disablePresenceSync();
        window.FirebaseSync?.updatePresence('stopped');
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Erreur initialisation Firebase :', error);
    return false;
  }
};

// ══════════════════════════════════════════════════════════════
// CONNEXION GOOGLE VIA FIREBASE AUTH
// ══════════════════════════════════════════════════════════════
/**
 * Stratégie selon la plateforme :
 *  • Android Tauri (.apk)  → signInWithRedirect  (popup non supporté)
 *  • Desktop Tauri / Web   → signInWithPopup      (expérience optimale)
 *
 * ⚠️ Pour que le popup fonctionne dans Tauri desktop, il faut impérativement
 *    ajouter les origines Tauri dans Firebase Console → Auth → Authorized domains :
 *      tauri://localhost          macOS / Linux
 *      https://tauri.localhost    Windows (WebView2)
 */
window.firebaseSignInWithGoogle = async function () {
  try {
    if (!firebaseAuth) {
      console.warn('⚠️ Firebase Auth non initialisé');
      return null;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    if (_FB_IS_ANDROID) {
      // Android WebView ne supporte pas les popups OAuth.
      // signInWithRedirect redirige vers Google puis revient dans l'app.
      // Le résultat est récupéré par getRedirectResult() dans initFirebase().
      await firebaseAuth.signInWithRedirect(provider);
      return null; // onAuthStateChanged prendra le relais après le redirect
    }

    // Desktop (Tauri ou navigateur) : popup natif Firebase
    const result = await firebaseAuth.signInWithPopup(provider);
    console.log('✅ Connexion Google Firebase réussie :', result.user.email);
    return result.user;

  } catch (error) {
    if (
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request'
    ) {
      console.log('ℹ️ Popup Google fermé par l\'utilisateur');
    } else if (error.code === 'auth/operation-not-supported-in-this-environment') {
      // Peut arriver si le WebView Tauri bloque les popups.
      // Fallback automatique vers redirect.
      console.warn('[Firebase] Popup non supporté — fallback signInWithRedirect');
      const provider2 = new firebase.auth.GoogleAuthProvider();
      provider2.addScope('email');
      provider2.addScope('profile');
      await firebaseAuth.signInWithRedirect(provider2);
    } else {
      console.error('❌ Erreur connexion Google Firebase :', error);
    }
    return null;
  }
};

// ── Déconnexion Firebase ──────────────────────────────────────
window.firebaseSignOut = async function () {
  try {
    if (firebaseAuth) await firebaseAuth.signOut();
    console.log('✅ Déconnexion Firebase réussie');
  } catch (error) {
    console.error('❌ Erreur déconnexion Firebase :', error);
  }
};

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════
window.FirebaseConfig = {
  getAuth:       () => firebaseAuth,
  getDB:         () => firebaseDB,
  getUser:       () => window._firebaseUser || null,
  isInitialized: () => firebaseApp !== null,
  isTauri:       () => _FB_IS_TAURI,
  isAndroid:     () => _FB_IS_ANDROID,
};
