#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Beartify — installation de stats-cron.js
# ═══════════════════════════════════════════════════════════════════
#  À coller tel quel dans un terminal Cockpit (ou tout shell root/sudo).
#  Crée le script, demande interactivement les identifiants (clé API
#  Jellyfin, identifiants Nextcloud) pour éviter toute erreur de saisie
#  manuelle, puis installe un timer systemd qui relance le calcul
#  automatiquement toutes les heures en arrière-plan.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Authentification sudo — DOIT être déjà en cache ───────────────────
# En collant tout ce bloc d'un coup, le terminal Cockpit a déjà mis en
# file TOUTES les lignes du paste au moment où un `sudo` essaierait de
# lire ton mot de passe — même en lisant depuis /dev/tty, c'est ce
# contenu déjà en attente qui est lu à la place de ta frappe, d'où les
# "3 saisies incorrectes / disconnected" que tu as eus : le script
# n'attendait jamais réellement toi.
#
# La seule façon fiable d'éviter ça : authentifier sudo AVANT de coller
# quoi que ce soit d'autre, avec le buffer du terminal vide.
#
#   1) Colle et exécute D'ABORD, seule, cette ligne :
#        sudo -v
#      tape ton mot de passe normalement, puis valide.
#   2) Une fois "sudo -v" réussi (aucune erreur affichée), colle TOUT
#      le reste du script ci-dessous en une fois — il n'y aura alors
#      plus aucun prompt de mot de passe, le ticket sudo est en cache.
if ! sudo -n true 2>/dev/null; then
  echo "❌ Session sudo pas encore active."
  echo "   Lance d'abord, seule : sudo -v"
  echo "   Puis recolle ce script en entier une fois le mot de passe validé."
  exit 1
fi
( while true; do sudo -n true; sleep 60; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
SUDO_KEEPALIVE_PID=$!
trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null' EXIT

INSTALL_DIR="/opt/beartify"
LYRICS_DIR_DEFAULT="/home/papaours/Téléchargements"
SERVICE_USER="${SUDO_USER:-$USER}"

echo "═══════════════════════════════════════════════════════════"
echo " Beartify — installation des statistiques du catalogue"
echo "═══════════════════════════════════════════════════════════"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé ou pas dans le PATH."
  exit 1
fi
NODE_VERSION="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ requis (fetch natif). Version détectée : $(node -v)."
  exit 1
fi

echo "→ Création de $INSTALL_DIR ..."
sudo mkdir -p "$INSTALL_DIR/stats-output"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

echo "→ Écriture de stats-cron.js ..."
cat > "$INSTALL_DIR/stats-cron.js" <<'JSEOF'
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
  let lineSynced = 0;
  let total = 0;
  let unreadable = 0;

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
        const type = classifyLyricsFile(raw);
        if (type === 'word') wordSynced++;
        else if (type === 'line') lineSynced++;
      } catch (e) {
        unreadable++;
        if (unreadable <= 5) log(`Fichier illisible ignoré (${entry.name}) : ${e.message}`);
      }
    }
  }
  await walk(CONFIG.lyricsDir);
  log(`Paroles scannées : ${total} fichier(s) — ${wordSynced} mot par mot, ${lineSynced} ligne par ligne` +
      (unreadable ? `, ${unreadable} illisible(s)` : '') + '.');
  return wordSynced;
}

function classifyLyricsFile(rawText) {
  // ⚠️ Volontairement une recherche de sous-chaîne sur le texte BRUT,
  // exactement comme le script lyrics.py qui, lui, détecte correctement
  // ces fichiers — et PAS un JSON.parse() suivi d'une lecture de
  // `metadata.syncType` / `lyrics.syncType` comme la version précédente.
  // Cette dernière approche renvoyait 0 sur l'ensemble du dossier réel
  // (13531 fichiers), alors que lyrics.py — qui fait ce même test de
  // sous-chaîne — en trouve bien. Plus robuste aux variations
  // d'échappement/format qu'un chemin de clé JSON strict.
  if (rawText.includes('"syncType": "WORD"') || /"syncType"\s*:\s*"WORD"/.test(rawText)) return 'word';
  if (rawText.includes('"syncType": "LINE"') || /"syncType"\s*:\s*"LINE"/.test(rawText)) return 'line';
  return null;
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

  async function attempt() {
    const res = await fetch(remoteUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': remoteFileName.endsWith('.json') ? 'application/json' : 'application/javascript',
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Upload WebDAV de ${remoteFileName} a échoué (HTTP ${res.status} — vérifie que le dossier ${CONFIG.nextcloudDir} existe déjà sur Nextcloud, WebDAV ne le crée pas tout seul)`);
    return true;
  }

  try {
    await attempt();
  } catch (e) {
    // "fetch failed" (erreur réseau/TLS/DNS de bas niveau, PAS un code
    // HTTP — sinon on serait dans le if (!res.ok) ci-dessus) masque la
    // vraie cause par défaut. e.cause la révèle (ex: ENOTFOUND,
    // ECONNREFUSED, certificate error…) — on la journalise pour pouvoir
    // diagnostiquer, plutôt que le message générique inexploitable vu
    // dans les logs. Un essai supplémentaire couvre les échecs
    // transitoires (résolution DNS ponctuelle, etc.).
    log(`Premier essai d'upload (${remoteFileName}) échoué : ${e.message}` +
        (e.cause ? ` — cause : ${e.cause.code || e.cause.message || e.cause}` : ''));
    log(`Nouvel essai dans 3s… (teste aussi manuellement : curl -v -u '${CONFIG.nextcloudUser}:***' -T "${localPath}" "${remoteUrl}")`);
    await new Promise(r => setTimeout(r, 3000));
    await attempt();
  }
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

JSEOF

echo ""
echo "── Configuration ──────────────────────────────────────────────"
echo "   Chaque valeur est redemandée pour éviter les erreurs de copier/coller."
echo ""
read -rp "URL Jellyfin [http://127.0.0.1:8096] : " JELLYFIN_URL < /dev/tty
JELLYFIN_URL="${JELLYFIN_URL:-http://127.0.0.1:8096}"
read -rsp "Clé API Jellyfin (Panneau admin > API Keys) : " JELLYFIN_API_KEY < /dev/tty
echo ""
read -rp "Dossier des paroles [$LYRICS_DIR_DEFAULT] : " LYRICS_DIR < /dev/tty
LYRICS_DIR="${LYRICS_DIR:-$LYRICS_DIR_DEFAULT}"
echo ""
read -rp "URL WebDAV Nextcloud (ex: https://grizzlyrics.duckdns.org/remote.php/dav/files/USER) : " NEXTCLOUD_WEBDAV_URL < /dev/tty
read -rp "Utilisateur Nextcloud : " NEXTCLOUD_USER < /dev/tty
read -rsp "Mot de passe d'application Nextcloud (PAS le mot de passe du compte) : " NEXTCLOUD_PASSWORD < /dev/tty
echo ""
read -rp "Dossier distant Nextcloud [/Beartify/public] : " NEXTCLOUD_REMOTE_DIR < /dev/tty
NEXTCLOUD_REMOTE_DIR="${NEXTCLOUD_REMOTE_DIR:-/Beartify/public}"

ENV_FILE="$INSTALL_DIR/.env.stats"
echo ""
echo "→ Écriture de $ENV_FILE ..."
cat > "$ENV_FILE" <<EOF
JELLYFIN_URL=$JELLYFIN_URL
JELLYFIN_API_KEY=$JELLYFIN_API_KEY
LYRICS_DIR=$LYRICS_DIR
NEXTCLOUD_WEBDAV_URL=$NEXTCLOUD_WEBDAV_URL
NEXTCLOUD_USER=$NEXTCLOUD_USER
NEXTCLOUD_PASSWORD=$NEXTCLOUD_PASSWORD
NEXTCLOUD_REMOTE_DIR=$NEXTCLOUD_REMOTE_DIR
OUTPUT_DIR=$INSTALL_DIR/stats-output
EOF
chmod 600 "$ENV_FILE"

echo "→ Installation du service + timer systemd (toutes les heures) ..."
sudo tee /etc/systemd/system/beartify-stats.service > /dev/null <<EOF
[Unit]
Description=Beartify - calcul horaire des statistiques du catalogue
After=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $INSTALL_DIR/stats-cron.js --once
EOF

sudo tee /etc/systemd/system/beartify-stats.timer > /dev/null <<EOF
[Unit]
Description=Déclenche beartify-stats.service toutes les heures

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now beartify-stats.timer

echo ""
echo "→ Premier calcul immédiat (pour vérifier que tout fonctionne) ..."
sudo systemctl start beartify-stats.service

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✅ Installation terminée — recalcul automatique toutes les heures."
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Vérifications :"
echo "  journalctl -u beartify-stats.service -f"
echo "  cat $INSTALL_DIR/stats-output/stats.json"
echo "  systemctl list-timers | grep beartify"
echo ""
echo "Une fois stats.json confirmé sur Nextcloud, crée un lien de partage"
echo "public pour ce fichier et colle-le dans STATS_URL (onboarding.js)."
echo ""
