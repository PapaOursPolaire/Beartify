#!/usr/bin/env node
'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  Beartify – stats-cron.js
 * ═══════════════════════════════════════════════════════════════════
 *  Calcule des statistiques réelles sur le catalogue (nombre de titres,
 *  d'artistes, d'albums, et de titres disposant de paroles synchronisées
 *  MOT PAR MOT) directement depuis Jellyfin + le dossier de paroles du
 *  serveur, puis publie le résultat (stats.json + stats.js) sur
 *  Nextcloud via WebDAV, pour que l'onboarding (onboarding.js) et
 *  n'importe quelle autre page publique puissent les lire sans jamais
 *  toucher au serveur Jellyfin ni scanner ~20 000 titres depuis le
 *  navigateur du visiteur.
 *
 *  ── Pourquoi côté serveur et pas côté client ? ──────────────────────
 *  Le décompte des paroles synchronisées mot par mot nécessite de lire
 *  chaque fichier de paroles individuellement. Fait depuis le
 *  navigateur d'un visiteur, ce serait des milliers de requêtes et
 *  plusieurs dizaines de secondes à chaque affichage de l'onboarding —
 *  exactement le problème de lenteur déjà rencontré avec la recherche
 *  d'artistes. Ici, le calcul est fait UNE FOIS par heure sur le
 *  serveur (qui a un accès disque direct au dossier de paroles, donc
 *  pas de latence réseau), et le résultat est juste un petit fichier
 *  JSON servi statiquement.
 *
 *  ── Utilisation ─────────────────────────────────────────────────────
 *    node stats-cron.js            # tourne en continu, recalcule à
 *                                   # chaque lancement puis toutes les
 *                                   # heures (adapté à pm2/systemd
 *                                   # --restart=always)
 *    node stats-cron.js --once     # un seul passage puis quitte
 *                                   # (adapté à un timer cron/systemd
 *                                   # classique déclenché toutes les
 *                                   # heures)
 *
 *  ── Configuration (variables d'environnement) ───────────────────────
 *    JELLYFIN_URL        ex: http://127.0.0.1:8096
 *    JELLYFIN_API_KEY    clé API admin Jellyfin (Panneau admin > API Keys)
 *    LYRICS_DIR           dossier contenant les fichiers de paroles
 *                          (.json / *-line.json) sauvegardés par
 *                          lyrics.js — ajuste selon ton arborescence
 *    NEXTCLOUD_WEBDAV_URL  ex: https://ton-nextcloud/remote.php/dav/files/USER
 *    NEXTCLOUD_USER
 *    NEXTCLOUD_PASSWORD    mot de passe d'application Nextcloud (PAS le mdp du compte)
 *    NEXTCLOUD_REMOTE_DIR  dossier distant cible, ex: /Beartify/public
 *    OUTPUT_DIR            dossier local de sortie (def: ./stats-output)
 *
 *  Toutes les credentials passent par l'environnement (jamais en dur
 *  ici) — même principe que l'injection Caddy déjà utilisée ailleurs
 *  dans le projet pour Nextcloud/Jellyfin/Last.fm.
 * ═══════════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');

const CONFIG = {
  jellyfinUrl:     process.env.JELLYFIN_URL || 'http://127.0.0.1:8096',
  jellyfinApiKey:  process.env.JELLYFIN_API_KEY || '',
  lyricsDir:       process.env.LYRICS_DIR || '/home/papaours/Téléchargements',
  nextcloudUrl:    process.env.NEXTCLOUD_WEBDAV_URL || '',
  nextcloudUser:   process.env.NEXTCLOUD_USER || '',
  nextcloudPass:   process.env.NEXTCLOUD_PASSWORD || '',
  nextcloudDir:    process.env.NEXTCLOUD_REMOTE_DIR || '/Beartify/public',
  outputDir:       process.env.OUTPUT_DIR || path.join(__dirname, 'stats-output'),
  intervalMs:      60 * 60 * 1000, // 1 heure
};

function log(msg) {
  console.log(`[stats-cron] ${new Date().toISOString()} — ${msg}`);
}

// ── 1) Comptages Jellyfin (titres / artistes / albums) ────────────────
// Jellyfin expose un endpoint natif dédié aux comptages, bien plus
// léger qu'un Items?Recursive=true qui rapatrierait tout le catalogue.
async function fetchJellyfinCounts() {
  if (!CONFIG.jellyfinApiKey) {
    throw new Error('JELLYFIN_API_KEY manquant — voir la configuration en tête de fichier.');
  }
  const url = `${CONFIG.jellyfinUrl.replace(/\/$/, '')}/Items/Counts`;
  const res = await fetch(url, {
    headers: { 'X-Emby-Token': CONFIG.jellyfinApiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jellyfin /Items/Counts a répondu ${res.status}`);
  const data = await res.json();
  return {
    trackCount:  data.SongCount   ?? 0,
    artistCount: data.ArtistCount ?? 0,
    albumCount:  data.AlbumCount  ?? 0,
  };
}

// ── 2) Décompte des paroles synchronisées mot par mot ──────────────────
// Parcourt récursivement LYRICS_DIR et classe chaque fichier JSON en
// "mot par mot" (word-synced) ou "ligne par ligne" (line-synced), selon
// le même format que celui lu par script.js à la lecture (voir
// jsonData.lyrics.syncType === 'LINE_SYNCED' et le format compressé
// "array-of-references" du SpicyLyrics v6 utilisé par lyrics.js).
//
// ⚠️ Cette détection est un point d'ajustement : si ton format de
// sauvegarde diffère légèrement, adapte `classifyLyricsFile()`
// ci-dessous — le reste du script n'a pas besoin de changer.
async function countWordSyncedLyrics() {
  if (!CONFIG.lyricsDir) {
    log('LYRICS_DIR non configuré — décompte des paroles ignoré (wordSyncedLyricsCount = null).');
    return null;
  }
  let wordSynced = 0;
  let total = 0;

  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) { log(`Impossible de lire ${dir} : ${e.message}`); return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith('.json')) continue;
      total++;
      try {
        const raw = await fsp.readFile(full, 'utf-8');
        const json = JSON.parse(raw);
        if (classifyLyricsFile(json) === 'word') wordSynced++;
      } catch (e) {
        // Fichier corrompu/illisible : on l'ignore plutôt que de faire
        // échouer tout le calcul pour une seule entrée défectueuse.
      }
    }
  }
  await walk(CONFIG.lyricsDir);
  log(`Paroles scannées : ${total} fichier(s), dont ${wordSynced} synchronisé(s) mot par mot.`);
  return wordSynced;
}

function classifyLyricsFile(json) {
  // Format réel confirmé : présence de "syncType": "WORD" au niveau
  // racine du fichier = synchronisation mot par mot. Son absence
  // signifie une synchronisation ligne par ligne (pas de valeur
  // "unknown" intermédiaire pour ce format).
  return json?.syncType === 'WORD' ? 'word' : 'line';
}

// ── 3) Écriture des fichiers de sortie ─────────────────────────────────
async function writeOutputFiles(stats) {
  await fsp.mkdir(CONFIG.outputDir, { recursive: true });

  const jsonPath = path.join(CONFIG.outputDir, 'stats.json');
  const jsPath   = path.join(CONFIG.outputDir, 'stats.js');

  await fsp.writeFile(jsonPath, JSON.stringify(stats, null, 2), 'utf-8');
  await fsp.writeFile(
    jsPath,
    `// Généré automatiquement par stats-cron.js — ne pas éditer à la main.\n` +
    `window.__BEARTIFY_STATS__ = ${JSON.stringify(stats)};\n`,
    'utf-8'
  );
  log(`Fichiers écrits : ${jsonPath}, ${jsPath}`);
  return { jsonPath, jsPath };
}

// ── 4) Upload WebDAV vers Nextcloud ─────────────────────────────────────
// Même principe d'auth Basic que l'intégration Nextcloud WebDAV déjà en
// place pour les photos de profil (credentials côté serveur, jamais
// exposées au client).
async function uploadToNextcloud(localPath, remoteFileName) {
  if (!CONFIG.nextcloudUrl || !CONFIG.nextcloudUser || !CONFIG.nextcloudPass) {
    log('Configuration Nextcloud incomplète — upload ignoré (fichiers écrits localement uniquement).');
    return false;
  }
  const remoteUrl = `${CONFIG.nextcloudUrl.replace(/\/$/, '')}${CONFIG.nextcloudDir}/${remoteFileName}`;
  const auth = Buffer.from(`${CONFIG.nextcloudUser}:${CONFIG.nextcloudPass}`).toString('base64');
  const body = await fsp.readFile(localPath);

  const res = await fetch(remoteUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': remoteFileName.endsWith('.json') ? 'application/json' : 'application/javascript',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Upload WebDAV de ${remoteFileName} a échoué (${res.status})`);
  log(`Envoyé sur Nextcloud : ${CONFIG.nextcloudDir}/${remoteFileName}`);
  return true;
}

// ── Cycle complet ────────────────────────────────────────────────────
async function runOnce() {
  log('Démarrage du calcul des statistiques…');
  try {
    const counts = await fetchJellyfinCounts();
    const wordSyncedLyricsCount = await countWordSyncedLyrics();

    const stats = {
      generatedAt: Date.now(),
      trackCount:  counts.trackCount,
      artistCount: counts.artistCount,
      albumCount:  counts.albumCount,
      wordSyncedLyricsCount, // null si LYRICS_DIR non configuré
    };

    const { jsonPath, jsPath } = await writeOutputFiles(stats);
    await uploadToNextcloud(jsonPath, 'stats.json');
    await uploadToNextcloud(jsPath, 'stats.js');

    log(`Terminé : ${stats.trackCount} titres, ${stats.artistCount} artistes, ${stats.albumCount} albums, ` +
        `${stats.wordSyncedLyricsCount ?? 'N/A'} paroles mot par mot.`);
  } catch (e) {
    // Une erreur ponctuelle (Jellyfin temporairement indisponible, etc.)
    // ne doit jamais interrompre les cycles suivants.
    log(`ÉCHEC de ce cycle : ${e.message}`);
  }
}

async function main() {
  const once = process.argv.includes('--once');
  await runOnce();
  if (once) return;
  log(`Mode continu — prochain calcul dans ${CONFIG.intervalMs / 60000} min.`);
  setInterval(runOnce, CONFIG.intervalMs);
}

main();
