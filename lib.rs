// Beartify — Tauri v2

use tauri::Manager;
use tauri::Emitter;

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
    .plugin(tauri_plugin_notification::init());

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
