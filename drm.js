Deux problèmes clairs dans le log :

1. **Honeypot ffmpeg échoue** — probablement permissions sur `/home/papaours/rickroll.mp3` (non lisible par `www-data`)
2. **500 playlist** — ffmpeg n'arrive pas à accéder à Jellyfin en interne

Avant tout : le `drm.js` déployé est-il bien la **nouvelle version** avec la capture stderr ? Lance ce test pour avoir l'erreur exacte :

```bash
# Test 1 — ffmpeg peut-il accéder à Jellyfin ?
curl "http://127.0.0.1:3001/api/hls/test?item=7bad677480c5183e0ee507874c9c1d4b"
```

```bash
# Test 2 — Jellyfin accessible en interne ?
curl -I "http://127.0.0.1:8096/Audio/7bad677480c5183e0ee507874c9c1d4b/stream?static=true&api_key=aaa8a7df4b364cf7bcc76f351d768798"
```

```bash
# Test 3 — Voir l'erreur ffmpeg en temps réel
journalctl -u beartify-drm -n 50 --no-pager
```

```bash
# Test 4 — Corriger les permissions du Rick Roll
sudo chmod 644 /home/papaours/rickroll.mp3
sudo chown www-data:www-data /home/papaours/rickroll.mp3
# Ou mieux : copier le fichier dans un dossier accessible
sudo cp /home/papaours/rickroll.mp3 /opt/beartify-drm/rickroll.mp3
sudo chown www-data:www-data /opt/beartify-drm/rickroll.mp3
```

Puis mettre à jour le `.env` :
```bash
sudo nano /opt/beartify-drm/.env
# Modifier la ligne :
HONEYPOT_AUDIO=/opt/beartify-drm/rickroll.mp3
```

```bash
sudo systemctl restart beartify-drm
```

Donne-moi la sortie du **Test 1** (`/api/hls/test`) — elle contiendra le stderr ffmpeg exact et je corrige immédiatement.
