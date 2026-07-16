// Beartify — Tauri v2

use tauri::Manager;
use tauri::Emitter;
use discord_rich_presence::{activity, activity::ActivityType, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

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

    let play_pause = if is_playing { "⏸" } else { "▶" };
    let body = if artist.is_empty() {
        "Beartify Player".to_string()
    } else {
        artist
    };

    app.notification()
    .builder()
    .title(format!("{} {}", play_pause, title))
    .body(body)
    .id(1) // ID fixe → mise à jour de la même notif à chaque piste
    .show() // Correction Tauri v2
    .map_err(|e| e.to_string())
}

// ══════════════════════════════════════════════════════════════════
//  Demande explicite des permissions de notification
// ══════════════════════════════════════════════════════════════════
#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;

    let permission = app.notification().permission_state().map_err(|e| e.to_string())?;
    if permission == tauri_plugin_notification::PermissionState::Granted {
        return Ok(true);
    }

    Ok(true)
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
