/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Beartify — Migration Firestore → PocketBase (via REST,     ║
 * ║   sans gRPC — contourne le blocage réseau rencontré)          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * npm install google-auth-library pocketbase
 */

const { GoogleAuth } = require('google-auth-library');
const PocketBase = require('pocketbase/cjs');
const crypto = require('crypto');
const https = require('https');

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
const SERVER_BRIDGE_SECRET = '87b92f11263872ac7da00e5dbc1a3d76db53e9a753fda30e018f7bba818e6c9d';
const PROJECT_ID = FIREBASE_SERVICE_ACCOUNT.project_id;

const pb = new PocketBase(POCKETBASE_URL);
function derivePassword(externalId) {
  return crypto.createHmac('sha256', SERVER_BRIDGE_SECRET).update(externalId).digest('hex');
}
function detectProvider(docId) { return docId.includes('@') ? 'google' : 'discord'; }

// ── Requête HTTPS générique ──
function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
      });
    }).on('error', reject);
  });
}

// ── Décodeur de valeurs Firestore REST (format {stringValue:...}, {mapValue:...}, etc.) ──
function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

async function fetchAllUsers(token) {
  let all = [];
  let pageToken = null;
  do {
    let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?pageSize=100`;
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const data = await httpsGet(url, token);
    for (const doc of (data.documents || [])) {
      const docId = doc.name.split('/').pop();
      all.push({ id: docId, data: decodeFields(doc.fields) });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return all;
}

const stats = { usersCreated: 0, usersSkipped: 0, playlistsCreated: 0, playlistsSkipped: 0, followsCreated: 0, followsSkipped: 0, errors: [] };
const pbIdCache = new Map();
const firestoreUserCache = new Map();

async function upsertPocketBaseUser(docId, data) {
  if (pbIdCache.has(docId)) return pbIdCache.get(docId);
  try {
    const existing = await pb.collection('users').getFirstListItem(`externalId="${docId}"`);
    pbIdCache.set(docId, existing.id);
    stats.usersSkipped++;
    return existing.id;
  } catch (_) {}

  const provider = detectProvider(docId);
  const password = derivePassword(docId);
  const email = provider + '_' + docId.replace(/[^a-zA-Z0-9]/g, '_') + '@bridge.local';
  const displayName = data.displayName || data.profile?.displayName || data.publicProfile?.displayName || '';
  const avatarUrl = data.photoURL || data.avatarUrl || '';

  try {
    const record = await pb.collection('users').create({
      provider, externalId: docId, displayName, avatarUrl,
      email, emailVisibility: false, password, passwordConfirm: password, verified: true,
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
    try {
      const existing = await pb.collection('playlists').getFirstListItem(
        `user="${pbUserId}" && name="${(playlist.name || '').replace(/"/g, '')}"`
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

async function migrateFollows(pbUserId, docId, data, token) {
  const following = Array.isArray(data.following) ? data.following : [];
  for (const targetDocId of following) {
    if (!targetDocId || targetDocId === docId) continue;
    let targetPbId = pbIdCache.get(targetDocId);
    if (!targetPbId) {
      let targetData = firestoreUserCache.get(targetDocId);
      if (!targetData) {
        try {
          const doc = await httpsGet(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(targetDocId)}`, token);
          targetData = decodeFields(doc.fields);
        } catch (_) { targetData = {}; }
        firestoreUserCache.set(targetDocId, targetData);
      }
      targetPbId = await upsertPocketBaseUser(targetDocId, targetData);
    }
    if (!targetPbId) continue;
    try {
      await pb.collection('follows').create({ follower: pbUserId, following: targetPbId });
      stats.followsCreated++;
    } catch (err) {
      if (String(err.message).toLowerCase().includes('valid') || String(err.message).toLowerCase().includes('unique')) stats.followsSkipped++;
      else stats.errors.push(`Follow ${docId} → ${targetDocId}: ${err.message}`);
    }
  }
}

async function main() {
  console.log('→ Authentification Google (REST, sans gRPC)...');
  const auth = new GoogleAuth({ credentials: FIREBASE_SERVICE_ACCOUNT, scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await auth.getAccessToken();
  console.log('✅ Jeton Google obtenu.\n');

  console.log('→ Authentification PocketBase (super-admin)...');
  await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
  console.log('✅ Authentifié.\n');

  console.log('→ Lecture de tous les documents utilisateurs Firestore (via REST)...');
  const users = await fetchAllUsers(token);
  console.log(`   ${users.length} utilisateur(s) trouvé(s).\n`);

  let i = 0;
  for (const { id: docId, data } of users) {
    i++;
    process.stdout.write(`[${i}/${users.length}] ${docId} ... `);
    const pbUserId = await upsertPocketBaseUser(docId, data);
    if (!pbUserId) { console.log('❌ échec utilisateur'); continue; }
    await migratePlaylists(pbUserId, docId, data);
    await migrateFollows(pbUserId, docId, data, token);
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
  if (stats.errors.length) { console.log('\nDétail des erreurs :'); stats.errors.forEach(e => console.log('  - ' + e)); }
}

main().catch(err => { console.error('❌ Erreur fatale:', err); process.exit(1); });
