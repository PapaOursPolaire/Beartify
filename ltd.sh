papaours@papaours:~$ sudo ss -lptun 'sport = :3003'
Netid   State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process                              
tcp     LISTEN   0        511              0.0.0.0:3003          0.0.0.0:*      users:(("node",pid=323304,fd=18))   
papaours@papaours:~$ sudo kill -9 <PID>
bash: erreur de syntaxe près du symbole inattendu « newline »
papaours@papaours:~$ docker rm -f libretranslate 2>/dev/null || true
libretranslate
papaours@papaours:~$ nano ltd.sh
papaours@papaours:~$ sudo ./ltd.sh
✔ Docker déjà présent (Docker version 29.6.1, build 8900f1d)

➜ Récupération de l'image libretranslate/libretranslate:latest
latest: Pulling from libretranslate/libretranslate
Digest: sha256:4a48d5fd9ed482b61fa28803e4438603caf4cab92685e659cb4811178b2039dc
Status: Image is up to date for libretranslate/libretranslate:latest
docker.io/libretranslate/libretranslate:latest

➜ Démarrage sur 127.0.0.1:3005 → conteneur:5000
   Langues chargées : fr,en,es,de,it,pt,nl,ja,ko,zh
✔ Conteneur démarré (état: running)

➜ Attente du démarrage (le tout premier lancement télécharge les modèles, ça peut prendre plusieurs minutes)...
   ... toujours en attente (30s) — voir 'docker logs -f libretranslate' pour le détail
   ... toujours en attente (60s) — voir 'docker logs -f libretranslate' pour le détail
✔ LibreTranslate traduit correctement côté serveur.
  Réponse : {"translatedText":"bonjour monde"}

➜ Rechargement de Caddy
✔ Caddy rechargé

➜ Test de bout en bout via https://beartify.duckdns.org/api/translate/...
✘ Le conteneur local fonctionne mais le chemin via Caddy échoue encore.
   → Vérifie que 'import libretranslate_proxy' est bien présent dans le bloc
     'beartify.duckdns.org { ... }' de ton Caddyfile, puis : sudo systemctl reload caddy
   Réponse brute reçue : <vide>

✔ Terminé.
papaours@papaours:~$ sudo systemctl reload caddy
papaours@papaours:~$ 










