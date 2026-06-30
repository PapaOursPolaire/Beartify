// src-tauri/gen/android/app/src/main/java/org/beartify/player/MainActivity.kt
// ══════════════════════════════════════════════════════════════════
//  Beartify — MainActivity Android (Tauri v2)
//
//  Utilise uniquement les APIs Android natives disponibles sans
//  dépendances supplémentaires dans build.gradle :
//  - NotificationCompat (androidx.core déjà inclus par Tauri)
//  - MediaSession (android.media — API native Android >= 21)
//  - BroadcastReceiver pour les boutons de notification
//  - JavascriptInterface pour le bridge JS → Kotlin
// ══════════════════════════════════════════════════════════════════

package org.beartify.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import java.net.URL

// ── Constantes ────────────────────────────────────────────────────
private const val CHANNEL_ID      = "beartify_media"
private const val CHANNEL_NAME    = "Lecture Beartify"
private const val NOTIFICATION_ID = 1001
private const val ACTION_PLAY     = "org.beartify.player.ACTION_PLAY"
private const val ACTION_PAUSE    = "org.beartify.player.ACTION_PAUSE"
private const val ACTION_PREV     = "org.beartify.player.ACTION_PREV"
private const val ACTION_NEXT     = "org.beartify.player.ACTION_NEXT"
private const val ACTION_STOP     = "org.beartify.player.ACTION_STOP"

class MainActivity : TauriActivity() {
  
  private lateinit var notifManager: NotificationManager
    private var mediaSession: MediaSession? = null
      private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
      
      // Etat courant du lecteur
      private var currentTitle     = "Beartify"
      private var currentArtist    = ""
      private var currentIsPlaying = false
      private var currentArtwork: Bitmap? = null
        private var lastArtUrl       = ""
        
        // ── BroadcastReceiver : boutons de notification ───────────────
        private val mediaReceiver = object : BroadcastReceiver() {
          override fun onReceive(ctx: Context?, intent: Intent?) {
            when (intent?.action) {
              ACTION_PLAY  -> sendJSEvent("media-control", """{"action":"play"}""")
              ACTION_PAUSE -> sendJSEvent("media-control", """{"action":"pause"}""")
              ACTION_PREV  -> sendJSEvent("media-control", """{"action":"previoustrack"}""")
              ACTION_NEXT  -> sendJSEvent("media-control", """{"action":"nexttrack"}""")
              ACTION_STOP  -> {
                sendJSEvent("media-control", """{"action":"stop"}""")
                clearNotification()
              }
            }
          }
        }
        
        // ── Interface JS → Kotlin exposée via addJavascriptInterface ──
        inner class BeartifyBridge {
          @JavascriptInterface
          fun onMediaSessionUpdate(
            title: String, artist: String, album: String,
            artUrl: String, isPlayingStr: String
          ) {
            currentTitle     = title
            currentArtist    = artist
            currentIsPlaying = isPlayingStr == "true"
            
            // Mise à jour MediaSession native Android
            mediaSession?.setMetadata(
              MediaMetadata.Builder()
              .putString(MediaMetadata.METADATA_KEY_TITLE,  title)
              .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
              .putString(MediaMetadata.METADATA_KEY_ALBUM,  album)
              .also { b -> currentArtwork?.let { b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
              .build()
            )
            updatePlaybackState()
            
            // Charge la pochette si l URL a changé
            if (artUrl.isNotEmpty() && artUrl != lastArtUrl) {
              lastArtUrl = artUrl
              scope.launch {
                val bmp = withContext(Dispatchers.IO) {
                  try { BitmapFactory.decodeStream(URL(artUrl).openStream()) }
                  catch (e: Exception) { null }
                }
                if (bmp != null) {
                  currentArtwork = bmp
                  mediaSession?.setMetadata(
                    MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE,  currentTitle)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                    .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bmp)
                    .build()
                  )
                }
                showNotification()
              }
            } else {
              showNotification()
            }
          }
        }
        
        override fun onCreate(savedInstanceState: Bundle?) {
          super.onCreate(savedInstanceState)
          notifManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          createNotificationChannel()
          initMediaSession()
          registerMediaReceiver()
          injectJSBridge()
        }
        
        // ── Channel de notification (Android 8+) ─────────────────────
        private fun createNotificationChannel() {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
              CHANNEL_ID, CHANNEL_NAME,
              NotificationManager.IMPORTANCE_LOW
            ).apply {
              description          = "Contrôles de lecture Beartify"
              setShowBadge(false)
              lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            notifManager.createNotificationChannel(ch)
          }
        }
        
        // ── MediaSession native Android (android.media, API 21+) ─────
        private fun initMediaSession() {
          mediaSession = MediaSession(this, "BeartifySession").apply {
            setCallback(object : MediaSession.Callback() {
              override fun onPlay()          { sendJSEvent("media-control", """{"action":"play"}""") }
              override fun onPause()         { sendJSEvent("media-control", """{"action":"pause"}""") }
              override fun onSkipToNext()    { sendJSEvent("media-control", """{"action":"nexttrack"}""") }
              override fun onSkipToPrevious(){ sendJSEvent("media-control", """{"action":"previoustrack"}""") }
              override fun onStop()          { sendJSEvent("media-control", """{"action":"stop"}"""); clearNotification() }
            })
            isActive = true
          }
          updatePlaybackState()
        }
        
        private fun updatePlaybackState() {
          val state = if (currentIsPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
          mediaSession?.setPlaybackState(
            PlaybackState.Builder()
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .setActions(
              PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
              PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
              PlaybackState.ACTION_STOP
            )
            .build()
          )
        }
        
        // ── BroadcastReceiver ─────────────────────────────────────────
        private fun registerMediaReceiver() {
          val filter = IntentFilter().apply {
            addAction(ACTION_PLAY); addAction(ACTION_PAUSE)
            addAction(ACTION_PREV); addAction(ACTION_NEXT); addAction(ACTION_STOP)
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
          } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(mediaReceiver, filter)
          }
        }
        
        // ── Injection du bridge JS dans la WebView Tauri ──────────────
        // Tauri expose la WebView via onWebViewCreate — on ajoute notre
        // interface JS et on écoute l'événement media-session-update.
        private fun injectJSBridge() {
          // Tauri v2 Android : la WebView est accessible via window après onResume
          // On injecte le bridge dès que la page est prête via evaluateJavascript
          scope.launch {
            delay(2000) // attend que Tauri initialise la WebView
            runOnUiThread {
              getWebView()?.let { wv ->
                wv.addJavascriptInterface(BeartifyBridge(), "BeartifyNative")
                wv.evaluateJavascript("""
                (function() {
                if (!window.__TAURI__) return;
                // Ecoute l evenement emis par lib.rs update_media_session()
                window.__TAURI__.event.listen('media-session-update', function(e) {
                const p = e.payload || {};
                BeartifyNative.onMediaSessionUpdate(
                  String(p.title   || ''),
                                      String(p.artist  || ''),
                                      String(p.album   || ''),
                                      String(p.artUrl  || ''),
                                      p.isPlaying ? 'true' : 'false'
                );
              });
                // Relaie les controles media vers le JS de l app
                window.__TAURI__.event.listen('media-control', function(e) {
                const action = e.payload?.action;
                if (!action) return;
                // Declenche l action dans script.js
                const evMap = {
                'play':          'beartify:play',
                'pause':         'beartify:pause',
                'nexttrack':     'beartify:next',
                'previoustrack': 'beartify:prev',
                'stop':          'beartify:stop',
              };
              if (evMap[action]) {
                window.dispatchEvent(new CustomEvent(evMap[action]));
              }
              });
              })();
                """.trimIndent(), null)
              }
            }
          }
        }
        
        // ── Récupère la WebView Tauri ─────────────────────────────────
        // TauriActivity hérite de WryActivity qui expose la WebView
        // via la propriété `view` de type android.webkit.WebView
        private fun getWebView(): android.webkit.WebView? {
          return try {
            val field = Class.forName("com.tauri.core.TauriActivity")
            .getDeclaredField("webView").also { it.isAccessible = true }
            field.get(this) as? android.webkit.WebView
          } catch (_: Exception) {
            try {
              // Fallback : cherche dans la hiérarchie de vues
              val root = window.decorView.rootView
              fun findWebView(v: android.view.View): android.webkit.WebView? {
                if (v is android.webkit.WebView) return v
                  if (v is android.view.ViewGroup) {
                    for (i in 0 until v.childCount) {
                      findWebView(v.getChildAt(i))?.let { return it }
                    }
                  }
                  return null
              }
              findWebView(root)
            } catch (_: Exception) { null }
          }
        }
        
        // ── Notification MediaStyle ───────────────────────────────────
        private fun showNotification() {
          val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
              flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
          
          fun pendingBroadcast(action: String, req: Int) = PendingIntent.getBroadcast(
            this, req, Intent(action).setPackage(packageName),
                                                                                      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
          
          val prevPI  = pendingBroadcast(ACTION_PREV, 0)
          val playPI  = pendingBroadcast(if (currentIsPlaying) ACTION_PAUSE else ACTION_PLAY, 1)
          val nextPI  = pendingBroadcast(ACTION_NEXT, 2)
          val stopPI  = pendingBroadcast(ACTION_STOP, 3)
          val playIcon = if (currentIsPlaying) android.R.drawable.ic_media_pause
          else                  android.R.drawable.ic_media_play
            
            // Sur Android 5+ : notification native Notification.Builder avec MediaStyle
            // Sur Android < 5  : NotificationCompat classique sans MediaStyle
            val notif: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              Notification.Builder(this, CHANNEL_ID)
              .setSmallIcon(R.mipmap.ic_launcher)
              .setContentTitle(currentTitle)
              .setContentText(currentArtist)
              .setContentIntent(openIntent)
              .setDeleteIntent(stopPI)
              .setVisibility(Notification.VISIBILITY_PUBLIC)
              .setOngoing(currentIsPlaying)
              .setOnlyAlertOnce(true)
              .also { b -> currentArtwork?.let { b.setLargeIcon(it) } }
              .addAction(Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_previous),
                                                     "Précédent", prevPI).build())
              .addAction(Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, playIcon),
                                                     if (currentIsPlaying) "Pause" else "Lecture", playPI).build())
              .addAction(Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_next),
                                                     "Suivant", nextPI).build())
              .setStyle(Notification.MediaStyle()
              .setMediaSession(mediaSession?.sessionToken)
              .setShowActionsInCompactView(0, 1, 2))
              .build()
            } else {
              // Fallback Android < 8 : NotificationCompat sans MediaStyle
              @Suppress("DEPRECATION")
              NotificationCompat.Builder(this, CHANNEL_ID)
              .setSmallIcon(R.mipmap.ic_launcher)
              .setContentTitle(currentTitle)
              .setContentText(currentArtist)
              .setContentIntent(openIntent)
              .setDeleteIntent(stopPI)
              .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
              .setPriority(NotificationCompat.PRIORITY_LOW)
              .setOngoing(currentIsPlaying)
              .setOnlyAlertOnce(true)
              .also { b -> currentArtwork?.let { b.setLargeIcon(it) } }
              .addAction(android.R.drawable.ic_media_previous, "Précédent", prevPI)
              .addAction(playIcon, if (currentIsPlaying) "Pause" else "Lecture", playPI)
              .addAction(android.R.drawable.ic_media_next, "Suivant", nextPI)
              .build()
            }
            
            notifManager.notify(NOTIFICATION_ID, notif)
        }
        
        // ── Envoi d'un événement Tauri vers le JS ─────────────────────
        private fun sendJSEvent(event: String, jsonPayload: String) {
          scope.launch(Dispatchers.Main) {
            getWebView()?.evaluateJavascript(
              "window.__TAURI__?.event.emit('$event', $jsonPayload)", null
            )
          }
        }
        
        private fun clearNotification() {
          notifManager.cancel(NOTIFICATION_ID)
        }
        
        override fun onDestroy() {
          super.onDestroy()
          mediaSession?.release()
          scope.cancel()
          try { unregisterReceiver(mediaReceiver) } catch (_: Exception) {}
          clearNotification()
        }
}