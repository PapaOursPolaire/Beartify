beartify.duckdns.org {

    root * /var/www/html/player
    encode zstd gzip

    # ── En-têtes de sécurité ──────────────────────────────────────────
    header {
        Strict-Transport-Security "max-age=15768000; includeSubDomains; preload"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "geolocation=(), microphone=(), camera=(), payment=()"

        # CSP : ressources autorisées
        # - 'self'              : fichiers statiques du player
        # - grizzly-stream      : images Jellyfin (pochettes)
        # - fonts.googleapis    : polices UI
        # - ws:// wss://        : WebSocket Jellyfin
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: /api/jellyfin; media-src 'self' /api/jellyfin; connect-src 'self' wss://grizzly-stream.duckdns.org /api/; frame-ancestors 'none'"

        -Server
    }

    # ── Cache statique (assets compilés) ──────────────────────────────
    @static {
        path *.js *.css *.woff2 *.woff *.ttf *.png *.jpg *.svg *.ico *.webp
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # ── PROXY JELLYFIN — clé API injectée par Caddy ───────────────────
    # Le client ne voit jamais la clé X-Emby-Token.
    # Toutes les requêtes player passent par /api/jellyfin/*
    handle /api/jellyfin/* {
        uri strip_prefix /api/jellyfin

        reverse_proxy 127.0.0.1:8096 {
            # flush_interval -1 : désactive le buffering Caddy pour ce proxy.
            # Sans cette directive, Caddy accumule les données de Jellyfin en
            # mémoire avant de les transmettre au navigateur — ce qui provoque
            # plusieurs secondes de latence avant que l'audio commence à jouer.
            # Avec -1, chaque chunk audio est transmis dès réception → démarrage
            # instantané, identique au comportement direct (sans proxy).
            flush_interval -1

            header_up  X-Emby-Token      "aaa8a7df4b364cf7bcc76f351d768798"
            header_up  Host              grizzly-stream.duckdns.org
            header_up  X-Real-IP         {remote_host}
            header_up  X-Forwarded-For   {remote_host}
            header_up  X-Forwarded-Proto {scheme}
            header_up  Connection        {http.request.header.Connection}
            header_up  Upgrade           {http.request.header.Upgrade}

            # Supprimer la clé de la réponse (ne jamais la renvoyer au client)
            header_down -X-Emby-Token

            # ── Intercepter les redirections Jellyfin (302/301) ─────────────
            # Jellyfin peut rediriger le stream vers son propre domaine externe
            # en incluant l'api_key dans l'URL (?api_key=xxx). On réécrit le
            # Location header pour que le navigateur repasse par /api/jellyfin/*
            # sans jamais voir la clé ni le domaine Jellyfin directement.
            header_down Location "https://grizzly-stream.duckdns.org" "/api/jellyfin"
            header_down Location "http://grizzly-stream.duckdns.org"  "/api/jellyfin"
            header_down Location "http://127.0.0.1:8096"              "/api/jellyfin"

            # Supprimer l'api_key des query strings résiduels (3 formes)
            header_down Location `\?api_key=[^&]*&` `?`
            header_down Location `\?api_key=[^&]*$` ``
            header_down Location `&api_key=[^&]*`   ``
        }
    }

    # ── PROXY LAST.FM — clé API injectée par Caddy ────────────────────
    # Le client envoie : /api/lastfm/2.0/?method=...
    # Caddy ajoute : &api_key=...&format=json
    handle /api/lastfm/* {
        uri strip_prefix /api/lastfm

        # Injecter api_key + format dans tous les cas
        # (le client ne transmet PAS ces paramètres)
        rewrite * {path}?{query}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json

        reverse_proxy https://ws.audioscrobbler.com {
            header_up  Host              ws.audioscrobbler.com
            header_up  X-Real-IP         {remote_host}
            header_up  X-Forwarded-For   {remote_host}
            # Supprimer la clé de la réponse (précaution)
            header_down -X-Api-Key
        }
    }

    # ── PROXY GRIZZLYRICS ─────────────────────────────────────────────
    # CAUSE DE LA FUITE : sans X-Forwarded-Proto https, Nextcloud/PHP
    # voit la requête comme HTTP et émet un redirect 301 vers le vrai
    # domaine — que le navigateur suit au niveau réseau avant tout
    # intercepteur JS.
    # Fix 1 : header_up X-Forwarded-Proto https → PHP ne redirige plus.
    # Fix 2 : header_down Location (4 variantes) → filet de sécurité.
    handle /api/lyrics/* {
        uri strip_prefix /api/lyrics

        reverse_proxy 127.0.0.1:443 {
            header_up  Host              grizzlyrics.duckdns.org
            header_up  X-Real-IP         {remote_host}
            header_up  X-Forwarded-For   {remote_host}
            header_up  X-Forwarded-Proto https

            header_down Location "https://grizzlyrics.duckdns.org:443" "/api/lyrics"
            header_down Location "https://grizzlyrics.duckdns.org"     "/api/lyrics"
            header_down Location "http://grizzlyrics.duckdns.org:443"  "/api/lyrics"
            header_down Location "http://grizzlyrics.duckdns.org"      "/api/lyrics"

            transport http {
                tls
                tls_server_name grizzlyrics.duckdns.org
            }
        }
    }

    # ── SPA fallback — toutes les routes inconnues → index.html ───────
    # Permet la navigation côté client sans 404.
    @notFile {
        not path *.js *.css *.png *.jpg *.svg *.ico *.woff* *.ttf *.webp *.json
        not path /api/*
    }
    rewrite @notFile /index.html

    file_server

    log {
        output file /var/log/caddy/beartify-access.log
        format json
    }
}
