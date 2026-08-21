/// <reference path="../pb_data/types.d.ts" />
// ══════════════════════════════════════════════════════════════════
// Migration PocketBase — collection `blindtest_results`
// Syntaxe vérifiée sur la doc officielle (https://pocketbase.io/docs/js-migrations)
// à jour pour PocketBase v0.23+ : les champs sont des objets JS
// simples ({ type, name, ... }), PAS des classes (pas de
// "BaseCollection"/"TextField" en JS — ça, c'est l'API Go).
//
// À déposer dans le dossier pb_migrations/ de ton instance PocketBase
// (à côté de pb_data/). Appliquée automatiquement au redémarrage du
// serveur, ou via `./pocketbase migrate up`.
//
// Un enregistrement = une manche de blindtest jouée par un joueur.
// Le jeu n'est pas synchrone : chaque joueur crée sa propre ligne
// quand il termine sa manche, indépendamment des autres — c'est cette
// table qui alimente l'histogramme "combien de joueurs ont trouvé à
// quelle tentative / quel extrait" affiché en fin de manche côté front.
// ══════════════════════════════════════════════════════════════════

migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users");

  const collection = new Collection({
    type: "base",
    name: "blindtest_results",

    // Lecture publique nécessaire pour calculer l'histogramme agrégé
    // (tous les joueurs, pas seulement l'utilisateur courant).
    listRule: "",
    viewRule: "",
    // Un joueur ne peut créer que SA propre ligne de résultat.
    createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
    updateRule: null, // un résultat n'est jamais modifié après coup
    deleteRule: "@request.auth.id != '' && user = @request.auth.id",

    fields: [
      {
        type: "relation",
        name: "user",
        required: true,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "text",
        name: "track_id",
        required: true,
        max: 100,
      },
      {
        type: "text",
        name: "track_title",
        required: true,
        max: 300,
      },
      {
        type: "text",
        name: "track_artist",
        required: false,
        max: 300,
      },
      {
        type: "bool",
        name: "success",
        required: false,
      },
      {
        type: "number",
        name: "attempt",
        required: false,
        min: 1,
        max: 6,
      },
      {
        type: "number",
        name: "snippet_seconds",
        required: false,
        min: 0,
      },
      {
        type: "autodate",
        name: "created",
        onCreate: true,
        onUpdate: false,
      },
    ],

    indexes: [
      "CREATE INDEX idx_blindtest_track ON blindtest_results (track_id)",
      "CREATE INDEX idx_blindtest_user ON blindtest_results (user)",
    ],
  });

  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("blindtest_results");
  app.delete(collection);
});
