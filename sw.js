// Ajoute syncingWith (texte, nullable) à la collection presence — permet
// de savoir si un utilisateur synchronise actuellement son écoute sur
// quelqu'un d'autre (affichage du statut + détection de conflit mutuel).
const PocketBase = require('pocketbase/cjs');

const POCKETBASE_URL = 'http://127.0.0.1:8095';
const PB_SUPERUSER_EMAIL = 'papaourspolairegithub@gmail.com';
const PB_SUPERUSER_PASSWORD = 'Banana2008g@mer';

async function main() {
  const pb = new PocketBase(POCKETBASE_URL);
  await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
  console.log('✅ Authentifié.');

  const collection = await pb.collections.getOne('presence');
  const existing = collection.fields.find(f => f.name === 'syncingWith');

  if (existing) {
    console.log('ℹ️ Le champ syncingWith existe déjà, rien à faire.');
    return;
  }

  collection.fields.add(new TextField({ name: 'syncingWith', required: false }));
  await pb.collections.update('presence', { fields: collection.fields });
  console.log('✅ Champ syncingWith ajouté à la collection presence.');
}

main().catch(err => { console.error('❌ Erreur:', err.message, err.data ? JSON.stringify(err.data) : ''); process.exit(1); });
