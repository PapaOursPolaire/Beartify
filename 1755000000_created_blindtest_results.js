/// <reference path="../pb_data/types.d.ts" />
// ══════════════════════════════════════════════════════════════════
// Migration PocketBase — collection `blindtest_results`
// ⚠️ Nécessite PocketBase >= 0.23 (syntaxe BaseCollection / fields.add).
//    Vérifie ta version avec `./pocketbase --version` ou en bas à
//    droite du dashboard admin (/_/). Si tu es en 0.22.x ou avant,
//    dis-le-moi : la syntaxe des champs est différente avant 0.23.
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

  const collection = new BaseCollection("blindtest_results");

  // Lecture publique nécessaire pour calculer l'histogramme agrégé
  // (tous les joueurs, pas seulement l'utilisateur courant).
  collection.listRule = "";
  collection.viewRule = "";
  // Un joueur ne peut créer que SA propre ligne de résultat.
  collection.createRule = "@request.auth.id != '' && @request.body.user = @request.auth.id";
  collection.updateRule = null; // un résultat n'est jamais modifié après coup
  collection.deleteRule = "@request.auth.id != '' && user = @request.auth.id";

  collection.fields.add(
    new RelationField({
      name: "user",
      required: true,
      collectionId: usersCollection.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
    new TextField({
      name: "track_id",
      required: true,
      max: 100,
    }),
    new TextField({
      name: "track_title",
      required: true,
      max: 300,
    }),
    new TextField({
      name: "track_artist",
      required: false,
      max: 300,
    }),
    new BoolField({
      name: "success",
      required: false,
    }),
    new NumberField({
      name: "attempt",
      required: false,
      min: 1,
      max: 6,
    }),
    new NumberField({
      name: "snippet_seconds",
      required: false,
      min: 0,
    }),
    new AutodateField({
      name: "created",
      onCreate: true,
      onUpdate: false,
    })
  );

  collection.indexes = [
    "CREATE INDEX idx_blindtest_track ON blindtest_results (track_id)",
    "CREATE INDEX idx_blindtest_user ON blindtest_results (user)",
  ];

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("blindtest_results");
  app.delete(collection);
});
