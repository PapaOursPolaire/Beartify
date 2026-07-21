// Beartify — Tauri v2

use tauri::Manager;
use tauri::Emitter;
use discord_rich_presence::{activity, activity::ActivityType, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ══════════════════════════════════════════════════════════════════
//  Désactive le Tracking Prevention de WebView2 pour CETTE fenêtre.
//
//  Contexte : les covers Jellyfin (beartify.duckdns.org, un domaine
//  DuckDNS chargé en cross-origin depuis http://tauri.localhost) sont
//  bloquées côté WebView2 avant même réception de la réponse (Network
//  tab : aucun Response Header, statut vide) alors que le serveur
//  répond correctement (vérifié via curl). Tracking Prevention classe
//  parfois ce type de domaine dynamique comme traqueur tiers et bloque
//  la requête en amont — d'où un message "CORS" trompeur dans la
//  console (Chromium réutilise ce message générique même quand la
//  vraie cause est ailleurs).
//
//  ⚠️ Ceci désactive Tracking Prevention pour TOUTE la fenêtre (donc
//  tous les domaines chargés dedans), pas seulement beartify.duckdns.org
//  — WebView2 ne permet pas un scope par domaine sur ce réglage. Pour
//  une app qui ne navigue que vers des domaines de confiance (comme
//  Beartify), c'est un compromis raisonnable ; à revoir si vous chargez
//  un jour du contenu tiers non maîtrisé dans cette même fenêtre.
//
//  ⚠️ Non testable de mon côté (interop COM Windows) — teste la
//  compilation avant de faire confiance à ce patch. Si `cargo build`
//  signale une incompatibilité de type sur les interfaces COM, c'est
//  probablement un désaccord de version entre `webview2-com` (ajouté
//  explicitement dans Cargo.toml) et celle utilisée en interne par
//  `tauri = "2"` — ajuste la version dans Cargo.toml en conséquence.
// ══════════════════════════════════════════════════════════════════
#[cfg(windows)]
fn disable_tracking_prevention(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_13, ICoreWebView2Profile3, ICoreWebView2Settings8,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
    };
    use windows::core::Interface;

    let result = window.with_webview(|webview| {
        unsafe {
            let core = match webview.controller().CoreWebView2() {
                Ok(c) => c,
                                     Err(e) => { eprintln!("[TrackingPrevention] CoreWebView2() a échoué: {e}"); return; }
            };

            // ── 1. Tracking Prevention (déjà en place, laissé tel quel) ──
            let core13: ICoreWebView2_13 = match core.cast() {
                Ok(c) => c,
                                     Err(e) => { eprintln!("[TrackingPrevention] cast ICoreWebView2_13 a échoué: {e}"); return; }
            };
            let profile = match core13.Profile() {
                Ok(p) => p,
                                     Err(e) => { eprintln!("[TrackingPrevention] Profile() a échoué: {e}"); return; }
            };
            let profile3: ICoreWebView2Profile3 = match profile.cast() {
                Ok(p) => p,
                                     Err(e) => { eprintln!("[TrackingPrevention] cast ICoreWebView2Profile3 a échoué: {e}"); return; }
            };
            match profile3.SetPreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE) {
                Ok(_)  => println!("[TrackingPrevention] ✅ Désactivé pour cette fenêtre"),
                                     Err(e) => eprintln!("[TrackingPrevention] SetPreferredTrackingPreventionLevel a échoué: {e}"),
            }

            // ── 2. SmartScreen / vérification de réputation (NOUVEAU) ──
            // Couche distincte de Tracking Prevention : vérifie la réputation
            // d'un domaine AVANT d'autoriser la requête. Un domaine DuckDNS
            // (DNS dynamique) est un candidat typique aux faux positifs de
            // ce genre d'heuristique. Contrairement à Tracking Prevention,
            // ce réglage est partagé par TOUTES les WebView2 utilisant le
            // même user data folder — désactivé une fois, ça reste désactivé
            // pour les navigations suivantes de cette fenêtre.
            let settings = match core.Settings() {
                Ok(s) => s,
                                     Err(e) => { eprintln!("[SmartScreen] Settings() a échoué: {e}"); return; }
            };
            let settings8: ICoreWebView2Settings8 = match settings.cast() {
                Ok(s) => s,
                                     Err(e) => { eprintln!("[SmartScreen] cast ICoreWebView2Settings8 a échoué: {e}"); return; }
            };
            match settings8.SetIsReputationCheckingRequired(false) {
                Ok(_)  => println!("[SmartScreen] ✅ Vérification de réputation désactivée"),
                                     Err(e) => eprintln!("[SmartScreen] SetIsReputationCheckingRequired a échoué: {e}"),
            }
        }
    });
    if let Err(e) = result {
        eprintln!("[TrackingPrevention] with_webview a échoué: {e}");
    }
}

#[cfg(not(windows))]
fn disable_tracking_prevention(_window: &tauri::WebviewWindow) {
    // No-op sur macOS/Linux — Tracking Prevention est une fonctionnalité
    // spécifique à WebView2 (Edge/Chromium sous Windows), le bug d'origine
    // n'a d'ailleurs été observé que là.
}

// ══════════════════════════════════════════════════════════════════
//  Relay événement JS fenêtre → fenêtre via le backend Rust
// ══════════════════════════════════════════════════════════════════
#[tauri::command]
fn relay_event(
    app: tauri::AppHandle,
    target: String,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    app.emit_to(target.as_str(), &event, payload)
    .map_err(|e| e.to_string())
}

// ══════════════════════════════════════════════════════════════════
//  Mise à jour MediaSession Android (notification persistante)
// ══════════════════════════════════════════════════════════════════
#[tauri::command]
fn update_media_session(
    app: tauri::AppHandle,
    title: String,
    artist: String,
    _album: String,
    _art_url: Option<String>,
    is_playing: bool,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    eprintln!("[Beartify] update_media_session appelé: title={} artist={} is_playing={}", title, artist, is_playing);

    let play_pause = if is_playing { "⏸" } else { "▶" };
    let body = if artist.is_empty() {
        "Beartify Player".to_string()
    } else {
        artist
    };

    let result = app.notification()
    .builder()
    .title(format!("{} {}", play_pause, title))
    .body(body)
    .id(1) // ID fixe → mise à jour de la même notif à chaque piste
    .show() // Correction Tauri v2
    .map_err(|e| e.to_string());

    match &result {
        Ok(_) => eprintln!("[Beartify] update_media_session: .show() OK"),
        Err(e) => eprintln!("[Beartify] update_media_session: .show() ECHEC: {}", e),
    }

    result
}

// ══════════════════════════════════════════════════════════════════
//  Demande explicite des permissions de notification
// ══════════════════════════════════════════════════════════════════
#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;

    eprintln!("[Beartify] request_notification_permission appelé");

    let current = app.notification().permission_state().map_err(|e| {
        eprintln!("[Beartify] permission_state() ECHEC: {}", e);
        e.to_string()
    })?;
    eprintln!("[Beartify] permission_state() actuel = {:?}", current);

    if current == tauri_plugin_notification::PermissionState::Granted {
        return Ok(true);
    }

    // C'est cet appel qui déclenche réellement le popup système Android
    // (POST_NOTIFICATIONS, API 33+) — `permission_state()` seul ne fait que
    // lire l'état existant, il ne demande jamais rien.
    let requested = app.notification().request_permission().map_err(|e| {
        eprintln!("[Beartify] request_permission() ECHEC: {}", e);
        e.to_string()
    })?;
    eprintln!("[Beartify] request_permission() résultat = {:?}", requested);
    Ok(requested == tauri_plugin_notification::PermissionState::Granted)
}

// ══════════════════════════════════════════════════════════════════
//  Discord Rich Presence
//
//  Le client IPC vit derrière un Mutex géré par Tauri (.manage) car il
//  doit survivre entre plusieurs appels de commande (connect une fois,
//  puis set_activity à chaque changement de piste). Toutes les erreurs
//  sont retournées en String pour rester cohérent avec le reste du fichier.
// ══════════════════════════════════════════════════════════════════
struct DiscordState(Mutex<Option<DiscordIpcClient>>);

#[tauri::command]
fn discord_connect(state: tauri::State<DiscordState>, client_id: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Ferme proprement une éventuelle connexion précédente avant d'en rouvrir une.
    if let Some(mut old_client) = guard.take() {
        let _ = old_client.close();
    }

    let mut client = DiscordIpcClient::new(client_id.as_str());
    client.connect().map_err(|e| e.to_string())?;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
fn discord_set_activity(
    state: tauri::State<DiscordState>,
    details: String,
    state_text: String,
    large_image: Option<String>,
    large_text: Option<String>,
    position: Option<i64>,
    duration: Option<i64>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let client = guard.as_mut().ok_or("Discord non connecté — appelez discord_connect d'abord")?;

    let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0);

    // start = maintenant moins la position déjà écoulée dans le titre, pour
    // que Discord recalcule lui-même l'écoulé/restant en continu (pas besoin
    // de renvoyer la position à chaque seconde). Si on fournit aussi `end`
    // (start + durée totale), Discord affiche une vraie barre de progression
    // façon Spotify plutôt qu'un simple compteur qui monte.
    let pos = position.unwrap_or(0).max(0);
    let start_ts = now - pos;

    let mut timestamps = activity::Timestamps::new().start(start_ts);
    if let Some(dur) = duration {
        if dur > 0 {
            timestamps = timestamps.end(start_ts + dur);
        }
    }

    let mut act = activity::Activity::new()
    .details(details.as_str())
    .state(state_text.as_str())
    .activity_type(ActivityType::Listening)
    .timestamps(timestamps);

    // La pochette n'est fournie que si l'appelant en a une (Option) — on
    // n'attache le bloc "assets" que dans ce cas plutôt que d'envoyer des
    // champs vides à Discord.
    if let (Some(img), Some(txt)) = (large_image.as_deref(), large_text.as_deref()) {
        act = act.assets(activity::Assets::new().large_image(img).large_text(txt));
    }

    client.set_activity(act).map_err(|e| e.to_string())
}


#[tauri::command]
fn discord_clear_activity(state: tauri::State<DiscordState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.as_mut() {
        client.clear_activity().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn discord_disconnect(state: tauri::State<DiscordState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut client) = guard.take() {
        client.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════
//  Point d'entrée principal de la bibliothèque
// ══════════════════════════════════════════════════════════════════
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // CORRECTION GRAPHIQUE LINUX : Force la désactivation de DMABUF avant le rendu
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let mut builder = tauri::Builder::default();

    // Enregistrement des plugins standards
    builder = builder
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init()) // <-- AJOUTÉ : requis par plugin:opener|open_url (Google/Discord sur Android)
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_fs::init()); // <-- Ligne ajoutée pour le plugin fs

    // Single Instance : activé uniquement sur ordinateur (Desktop)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    builder = builder.manage(DiscordState(Mutex::new(None)));

    builder
    .setup(|app| {
        #[cfg(desktop)]
        {
            use tauri_plugin_deep_link::DeepLinkExt;
            if let Err(e) = app.deep_link().register("beartify") {
                eprintln!("Erreur enregistrement deep-link: {}", e);
            }
        }
        #[cfg(debug_assertions)]
        {
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
        }
        if let Some(win) = app.get_webview_window("main") {
            disable_tracking_prevention(&win);
        }
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        relay_event,
        update_media_session,
        request_notification_permission,
        discord_connect,
        discord_set_activity,
        discord_clear_activity,
        discord_disconnect,
    ])
    // ── Fermeture de l'application ────────────────────────────────
    .on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            if window.label() == "main" {
                std::process::exit(0);
            }
        }
    })
    .run(tauri::generate_context!())
    .expect("Erreur au lancement de Beartify");
}
