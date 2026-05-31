papaours@papaours:~$ chmod +x drm.sh
papaours@papaours:~$ sudo ./drm.sh --honeypot-audio /home/papaours/rickroll.mp3
[sudo] Mot de passe de papaours : 

╔══════════════════════════════════════════════════════════╗
║   BEARTIFY DRM v4 — HLS FLAC + AES-128 + Honeypot 1/2   ║
╚══════════════════════════════════════════════════════════╝


▶ Vérification des permissions
✅  Exécution en root

▶ Vérification des prérequis
⚠   ffmpeg : format fmp4 non détecté — vérifier la version (>= 4.0)
✅  Node.js v20.19.2
✅  npm 9.2.0
✅  ffmpeg 7.1.4-0+deb13u1
✅  FLAC fMP4 HLS disponible

▶ Création de /opt/beartify-drm
✅  Dossier : /opt/beartify-drm

▶ Déploiement de drm.js
✅  drm.js copié depuis /home/papaours

▶ Écriture de package.json
✅  package.json écrit

▶ Configuration .env
⚠   SESSION_SECRET conservé (réinstallation)
✅  .env créé (chmod 600)

▶ Installation des dépendances npm
✅  express + dotenv installés

▶ Pré-génération des segments Rick Roll (FLAC fMP4)
ℹ   Transcodage de /home/papaours/rickroll.mp3 en segments FLAC fMP4...
⚠   ffmpeg a échoué — les honeypots seront générés au premier démarrage

▶ Permissions
✅  Permissions appliquées

▶ Service systemd beartify-drm
✅  Service redémarré

▶ Vérification du serveur DRM
   Attente du démarrage.
✅  Serveur DRM actif : {"status":"ok","sessions":0,"honeypot_segs":0,"honeypot_every":"1 sur 2"}

══════════════════════════════════════════════════════════
  Déploiement terminé !                                    
══════════════════════════════════════════════════════════

  📁 Dossier      : /opt/beartify-drm
  🔐 .env         : /opt/beartify-drm/.env  (chmod 600)
  ⚙  Service      : beartify-drm  (auto-démarrage ON)
  🌐 Port         : 127.0.0.1:3001
  🎵 Audio        : FLAC lossless (fMP4 HLS)
  🪤  Honeypot     : Rick Roll — 1 segment sur 2

Commandes utiles :
  journalctl -u beartify-drm -f
  systemctl restart beartify-drm
  curl http://127.0.0.1:3001/health

⚠  Étape finale — Caddy + script.js :
  scp Caddyfile.txt user@serveur:/etc/caddy/Caddyfile
  scp script.js     user@serveur:/var/www/html/player/script.js
  caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy

papaours@papaours:~$ 
