papaours@papaours:~$ # Vérifier le Caddyfile actif sur le serveur
grep -A5 "api/extensions" /etc/caddy/Caddyfile
#  Intercepte /api/hls/* et /api/extensions/* AVANT les blocs /api/jellyfin/*.
#  À importer dans tous les blocs Beartify (prod + LAN).
#
#  /api/hls/session/:id       → session + lancement ffmpeg FLAC fMP4
#  /api/hls/key/:id           → clé AES-128 (IP-lockée)
#  /api/hls/init/:id          → init segment fMP4 (auth)
--
#  /api/extensions            → liste des extensions installées (JSON)
#  /api/extensions/:cat/:n/*  → fichiers statiques d'une extension
# ══════════════════════════════════════════════════════════════════════
(drm_routes) {
    handle /api/hls/* {
        reverse_proxy 127.0.0.1:3001 {
            flush_interval -1
--
    handle /api/extensions* {
        reverse_proxy 127.0.0.1:3001 {
            header_up  X-Real-IP       {remote_host}
            header_up  X-Forwarded-For {remote_host}
        }
    }
papaours@papaours:~$ 





