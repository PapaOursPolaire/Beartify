/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Beartify — Migration en masse Firestore → PocketBase       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Migre les données déjà existantes dans Firestore vers PocketBase,
 * pour que les utilisateurs retrouvent tout dès leur prochaine
 * connexion (sans dépendre de la création "à la volée" via le pont
 * d'authentification, qui ne couvre que les NOUVELLES connexions).
 *
 * Migré : comptes utilisateurs (users), playlists, relations
 * follow/following (follows).
 * PAS migré volontairement (faible impact utilisateur, à faire
 * plus tard si besoin) : reports, requests, trackStats/artistStats/
 * albumStats/globalStats, presence (éphémère par nature).
 *
 * ⚠️ IMPORTANT : ce script est IDEMPOTENT — tu peux le relancer
 * plusieurs fois sans dupliquer les données (il vérifie l'existence
 * avant de créer). Utile si une première tentative échoue à mi-chemin.
 *
 * ── INSTALLATION ─────────────────────────────────────────────────
 *   npm install firebase-admin pocketbase
 *
 * ── CONFIGURATION (variables ci-dessous, à adapter) ──────────────
 */

// Clé de compte de service intégrée directement (pas de fichier externe requis).
// ⚠️ Ne commite jamais ce script dans un dépôt public tel quel — cette clé
// donne un accès admin complet au projet Firebase.
const FIREBASE_SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "beartify-firebase",
  "private_key_id": "cfd6a8b2196433cbc3da2d7f13c0373017424f8e",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDHcMtFJtuYstoW\noZzk6pSwowRk0x+O4Um4KSIHlYSIN/Xq0bdCdCbj9LUZ2WAFmxlgOmfTk9elkBFn\nVCE2lULFpdskr63oZK+GH2s6Dg4eIvkdfDIccrhQbWSOUJhryV6t5FkPWNmOEL0B\nIIm9dMe6VWwPUF/91bvRzqm9Nkb4FDVWv6S2lON53k7cwc3+7FAdG6vSTuDnQMx7\n0WOqCK8HylaAR9Rzkn6L91zrv+dSEBqwsoRvkONA3Mti8VElhhiuUVWq5f85/vdt\nd2CjfrR8pgugCqArZo/M9SJb/QELdGhlBV6PnCfNiStLFR1BupFFBy0O5NlOFLaF\nxY0QUUlpAgMBAAECggEAR1F+5toX4dlnInulWrjF9go9Wn6ixNmsHnZbDGI7s+hr\nAI8A3PsjIxYRIs64Rxjo8J/CHAc8sKA9kPklLVsftwTxwgMuibFjkO8wTWDUTJOO\nCKyuULz3Sw9rS3bnoneuazmCXXoUxfgXVk1X5A9cErZUP3+q697f3I1t5lL/+trB\nRel8vLRJBf45RqTpG3xrOEEvs69I73MBOqqaSUJQgrXTHa7SmEt/UQCduEY4kOed\nA6DHciZs4GLuhEa2UNJa8uvmBo7DvcxnGQfWD9TAGF0Rbu8rpJ+bnf7kHbgGZ9w/\n1A15bGTSZiLKTW3ZieuWQxd1F6vi+EiuADJ41WdGRwKBgQDupBGYpgSnj9Cz6GrU\nD5ZnIQjx+C/acGPtC0MdrUpGko6f80jJlSoyX9lW9Q50aQE+d7ER6D96/iThJTpc\nBbigvUOcT/Vj7pUsVPs27GB4QWc2d/EeVTorAnA07ah+Sh73Utg5EU6t7ERza5yl\nwsW1NW2aCbZMSmXTCRhNDHaK5wKBgQDV8r5ygQ3sh4k1VWptsYNgmJ7J8aPM316Y\nFFL91TzL7Y75gykE0Nmn7jmTXYi2B3Co/QVePoZIXDzwLP/DJf0spGjrl+VV7dWt\nCkNhjg7wBY3d+jgp1ThmzixQYvwDCamk6T4I28zt8C1U3U++c+JQl4lGNwr3NjVo\n3ZHCrzvPLwKBgDLEaJHmz5qt96IuUXunjUGHP5XqTJPV0Qw+lxqbIO/+gaT5ZoSr\n3Pw2c9AR9e9B32fgoqTCma6anlHfT5kABpT7boS0ZenKeaWitoaqpqMulrx5q6ve\nSa+YpzI7VNr4/blzwFfznJ9XYgCD5iFFXDX+lcBtTIDSWvMYPjk164oFAoGALUGe\n5YvFDT6SWJTL4Y5GMx21oRQbSRAK63KJJ6Z+qMiEkOUcvScMk4hB55lGfPLP8v8q\nrofdUdspDMkIBRi5GENi6ksEOQwJQgREwpMRN9aE7uqqDLdMqfp8xzhZBK97kiXA\neJE+JSrD/AqgfrH2soOLhy3HhQmTfK450gvNRAMCgYEAi72SAoIdKa6TnIzmxHOw\nAcQ9VgQh/NDizivuhgc/9QGUFSS5iOz++5JsNHr3gjxeB34Bw7gOSnkJOQXv+3Ow\nrzIk1cOwfi2Uzw/0gSP0Cm+g4+M97JwWrmI2s6BGG8gxA1NhHLFNgJZv2E+Q1/Ps\nAPDTvlsluqpvZAJBrWoHwdc=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@beartify-firebase.iam.gserviceaccount.com",
  "client_id": "115769592134913986346",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40beartify-firebase.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

const POCKETBASE_URL = 'http://127.0.0.1:8095';
const PB_SUPERUSER_EMAIL = 'papaourspolairegithub@gmail.com';
const PB_SUPERUSER_PASSWORD = 'Banana2008g@mer';

// Copie EXACTE de la valeur SERVER_BRIDGE_SECRET trouvée dans
// /opt/pocketbase/pb_hooks/bridge_utils.js sur le serveur — nécessaire
// pour que le mot de passe créé ici corresponde à celui que le hook
// dérivera plus tard lors d'une vraie connexion Google/Discord.
const SERVER_BRIDGE_SECRET = '87b92f11263872ac7da00e5dbc1a3d76db53e9a753fda30e018f7bba818e6c9d';

// ══════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const PocketBase = require('pocketbase/cjs');
const crypto = require('crypto');

admin.initializeApp({
  credential: admin.credential.cert(FIREBASE_SERVICE_ACCOUNT),
});
const firestore = admin.firestore();

const pb = new PocketBase(POCKETBASE_URL);

// Doit produire EXACTEMENT la même sortie que $security.hs256() côté
// PocketBase (HMAC-SHA256, sortie hexadécimale).
function derivePassword(externalId) {
  return crypto.createHmac('sha256', SERVER_BRIDGE_SECRET).update(externalId).digest('hex');
}

function detectProvider(docId) {
  return docId.includes('@') ? 'google' : 'discord';
}

const stats = { usersCreated: 0, usersSkipped: 0, playlistsCreated: 0, playlistsSkipped: 0, followsCreated: 0, followsSkipped: 0, errors: [] };

// Cache docId (Firestore) → id PocketBase, pour éviter de re-chercher
// à chaque relation follow.
const pbIdCache = new Map();

async function upsertPocketBaseUser(docId, data) {
  if (pbIdCache.has(docId)) return pbIdCache.get(docId);

  try {
    const existing = await pb.collection('users').getFirstListItem(`externalId="${docId}"`);
    pbIdCache.set(docId, existing.id);
    stats.usersSkipped++;
    return existing.id;
  } catch (_) {
    // N'existe pas encore → on le crée
  }

  const provider = detectProvider(docId);
  const password = derivePassword(docId);
  const email = provider + '_' + docId.replace(/[^a-zA-Z0-9]/g, '_') + '@bridge.local';
  const displayName = data.displayName || data.profile?.displayName || data.publicProfile?.displayName || '';
  const avatarUrl = data.photoURL || data.avatarUrl || '';

  try {
    const record = await pb.collection('users').create({
      provider, externalId: docId, displayName, avatarUrl,
      email, emailVisibility: false,
      password, passwordConfirm: password,
      verified: true,
    });
    pbIdCache.set(docId, record.id);
    stats.usersCreated++;
    return record.id;
  } catch (err) {
    stats.errors.push(`Utilisateur ${docId}: ${err.message}`);
    return null;
  }
}

function normalizeTracks(tracks = []) {
  return (Array.isArray(tracks) ? tracks : []).map(t => ({
    id: t.id || '', title: t.title || '', artist: t.artist || '',
    album: t.album || '', imageUrl: t.imageUrl || '',
    duration: t.duration || 0, addedAt: t.addedAt || Date.now(),
  }));
}

async function migratePlaylists(pbUserId, docId, data) {
  const playlists = data.playlists || {};
  for (const [playlistId, playlist] of Object.entries(playlists)) {
    if (!playlist || typeof playlist !== 'object') continue;

    // Idempotence : on retrouve une playlist déjà migrée via son nom + user
    // (pas d'ID Firestore stable à réutiliser tel quel côté PocketBase).
    try {
      const existing = await pb.collection('playlists').getFirstListItem(
        `user="${pbUserId}" && name="${(playlist.name || '').replace(/"/g, '')}" && created~"${playlist.createdAt || ''}"`
      ).catch(() => null);
      if (existing) { stats.playlistsSkipped++; continue; }
    } catch (_) {}

    try {
      await pb.collection('playlists').create({
        user: pbUserId,
        name: playlist.name || `Playlist ${playlistId}`,
        description: playlist.description || '',
        tracks: normalizeTracks(playlist.tracks),
        coverUrl: playlist.coverUrl || '',
        private: !!playlist.private,
      });
      stats.playlistsCreated++;
    } catch (err) {
      stats.errors.push(`Playlist ${playlistId} (${docId}): ${err.message}`);
    }
  }
}

async function migrateFollows(pbUserId, docId, data) {
  const following = Array.isArray(data.following) ? data.following : [];
  for (const targetDocId of following) {
    if (!targetDocId || targetDocId === docId) continue;

    // Le compte suivi doit exister côté PocketBase — on le crée aussi si
    // besoin (avec des données minimales, complétées à sa vraie connexion).
    let targetPbId = pbIdCache.get(targetDocId);
    if (!targetPbId) {
      const targetSnap = await firestore.collection('users').doc(targetDocId).get();
      targetPbId = await upsertPocketBaseUser(targetDocId, targetSnap.exists ? targetSnap.data() : {});
    }
    if (!targetPbId) continue;

    try {
      await pb.collection('follows').create({ follower: pbUserId, following: targetPbId });
      stats.followsCreated++;
    } catch (err) {
      // Duplicate (index unique) = déjà migré, ce n'est pas une vraie erreur
      if (String(err.message).includes('valid') || String(err.message).includes('unique')) {
        stats.followsSkipped++;
      } else {
        stats.errors.push(`Follow ${docId} → ${targetDocId}: ${err.message}`);
      }
    }
  }
}

async function main() {
  console.log('→ Authentification PocketBase (super-admin)...');
  await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
  console.log('✅ Authentifié.\n');

  console.log('→ Lecture de tous les documents utilisateurs Firestore...');
  const usersSnap = await firestore.collection('users').get();
  console.log(`   ${usersSnap.size} utilisateur(s) trouvé(s) dans Firestore.\n`);

  let i = 0;
  for (const doc of usersSnap.docs) {
    i++;
    const docId = doc.id;
    const data = doc.data();
    process.stdout.write(`[${i}/${usersSnap.size}] ${docId} ... `);

    const pbUserId = await upsertPocketBaseUser(docId, data);
    if (!pbUserId) { console.log('❌ échec création utilisateur'); continue; }

    await migratePlaylists(pbUserId, docId, data);
    await migrateFollows(pbUserId, docId, data);
    console.log('✅');
  }

  console.log('\n════════════════════════════════════════');
  console.log('RÉSUMÉ');
  console.log('════════════════════════════════════════');
  console.log(`Utilisateurs créés     : ${stats.usersCreated}`);
  console.log(`Utilisateurs déjà là   : ${stats.usersSkipped}`);
  console.log(`Playlists créées       : ${stats.playlistsCreated}`);
  console.log(`Playlists déjà là      : ${stats.playlistsSkipped}`);
  console.log(`Follows créés          : ${stats.followsCreated}`);
  console.log(`Follows déjà là        : ${stats.followsSkipped}`);
  console.log(`Erreurs                : ${stats.errors.length}`);
  if (stats.errors.length) {
    console.log('\nDétail des erreurs :');
    stats.errors.forEach(e => console.log('  - ' + e));
  }
}

main().catch(err => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
