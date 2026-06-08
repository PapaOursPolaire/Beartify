// ══════════════════════════════════════════════════════════════════════
//  BEARTIFY — extensions.js
//  Routes Express pour la Marketplace : découverte + serving des fichiers.
//
//  Usage dans drm.js (après la déclaration de `app`) :
//    require('./extensions')(app);
//
//  Structure disque attendue (relative à ce fichier) :
//    extensions/
//      Extensions/<nom>/   config.json  preview.png  main.js  …
//      Themes/<nom>/       config.json  preview.png  main.js  …
//      Snippets/<nom>/     config.json  preview.png  main.css …
//      Integrations/<nom>/ config.json  preview.png  main.js  …
// ══════════════════════════════════════════════════════════════════════
'use strict';

const path = require('path');
const fs   = require('fs');

const EXT_ROOT = path.join(__dirname, 'extensions');

const CATEGORIES = [
  { dir: 'Extensions',   type: 'extension'   },
  { dir: 'Themes',       type: 'theme'       },
  { dir: 'Snippets',     type: 'snippet'     },
  { dir: 'Integrations', type: 'integration' },
];

// ── Helpers ──────────────────────────────────────────────────────────

/** Lit et parse config.json d'un dossier d'extension. Retourne null si absent/invalide. */
function _readConfig(extDir) {
  const cfgPath = path.join(extDir, 'config.json');
  if (!fs.existsSync(cfgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    console.warn(`[extensions] config.json invalide dans ${extDir} :`, e.message);
    return null;
  }
}

/** Retourne les sous-dossiers directs d'un répertoire. */
function _subdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return []; }
}

/** Vérifie qu'un chemin résolu reste bien dans le dossier racine attendu. */
function _isSafe(resolved, expectedRoot) {
  return resolved.startsWith(expectedRoot + path.sep) || resolved === expectedRoot;
}

// ── Module export ─────────────────────────────────────────────────────

module.exports = function registerExtensionRoutes(app) {

  // ════════════════════════════════════════════════════════════════════
  //  GET /api/extensions
  //  Scanne le dossier extensions/ et retourne la liste des manifestes.
  //  Appelé par marketplace.js à chaque ouverture du panel.
  //
  //  Réponse : Array<{
  //    id, category, type, folderName,
  //    name, author, version, description, tags, featured, entry,
  //    previewUrl, accentColor
  //  }>
  // ════════════════════════════════════════════════════════════════════
  app.get('/api/extensions', (_req, res) => {
    const results = [];

    for (const cat of CATEGORIES) {
      const catDir = path.join(EXT_ROOT, cat.dir);
      for (const name of _subdirs(catDir)) {
        const extDir = path.join(catDir, name);
        const cfg    = _readConfig(extDir);
        if (!cfg) continue;

        // URL de preview si le fichier existe
        const previewFile = cfg.preview || 'preview.png';
        const previewUrl  = fs.existsSync(path.join(extDir, previewFile))
          ? `/api/extensions/${cat.dir}/${encodeURIComponent(name)}/${encodeURIComponent(previewFile)}`
          : null;

        results.push({
          id:          `${cat.dir}/${name}`,
          category:    cat.dir,
          type:        cat.type,
          folderName:  name,
          name:        cfg.name        || name,
          author:      cfg.author      || '—',
          version:     cfg.version     || '0.0.1',
          description: cfg.description || '',
          tags:        Array.isArray(cfg.tags) ? cfg.tags : [],
          featured:    !!cfg.featured,
          entry:       cfg.entry       || 'main.js',
          previewUrl,
          accentColor: cfg.accentColor || null,
        });
      }
    }

    res.json(results);
  });

  // ════════════════════════════════════════════════════════════════════
  //  GET /api/extensions/:category/:name/:file(*)
  //  Sert n'importe quel fichier statique d'une extension :
  //    preview.png, main.js, main.css, assets/font.woff2, …
  //
  //  Sécurité :
  //    - Catégorie validée contre la liste blanche CATEGORIES
  //    - path.resolve + startsWith pour bloquer les path traversal
  // ════════════════════════════════════════════════════════════════════
  app.get('/api/extensions/:category/:name/:file(*)', (req, res) => {
    const { category, name, file } = req.params;

    // Valider la catégorie
    if (!CATEGORIES.find(c => c.dir === category))
      return res.status(404).json({ error: 'Catégorie inconnue' });

    const extRoot  = path.resolve(EXT_ROOT, category, name);
    const filePath = path.resolve(extRoot, file);

    // Bloquer path traversal (../../ etc.)
    if (!_isSafe(filePath, extRoot))
      return res.status(403).json({ error: 'Accès refusé' });

    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: 'Fichier introuvable' });

    // Laisser Express/sendFile déduire le Content-Type depuis l'extension
    res.sendFile(filePath);
  });

  console.log('✅  Extensions Marketplace routes enregistrées (/api/extensions)');
};
