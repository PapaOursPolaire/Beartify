papaours@papaours:~$ sudo systemctl restart caddy
[sudo] Mot de passe de papaours : 
papaours@papaours:~$ sudo systemctl reload caddy
papaours@papaours:~$ sudo systemctl reload caddy
papaours@papaours:~$ sudo cat /etc/caddy/Caddyfile | grep -A5 "Content-Security-Policy"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://discord.com https://lrclib.net https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://apis.google.com https://accounts.google.com https://www.gstatic.com wss://grizzly-stream.duckdns.org https://grizzly-stream.duckdns.org; frame-ancestors 'none';"

        -Server
    }

    # ── Cache statique (assets compilés) ──────────────────────────────
papaours@papaours:~$ sudo systemctl restart caddy
papaours@papaours:~$ sudo caddy stop && sudo caddy start
2026/05/07 11:41:03.077 INFO    maxprocs: Leaving GOMAXPROCS=4: CPU quota undefined
2026/05/07 11:41:03.077 INFO    GOMEMLIMIT is updated   {"GOMEMLIMIT": 30231211622, "previous": 9223372036854775807}
2026/05/07 11:41:03.078 INFO    admin   admin endpoint started  {"address": "localhost:2019", "enforce_origin": false, "origins": ["//localhost:2019", "//[::1]:2019", "//127.0.0.1:2019"]}
2026/05/07 11:41:03.078 INFO    serving initial configuration
Successfully started Caddy (pid=861074) - Caddy is running in the background
papaours@papaours:~$ curl -I https:LLbeartify.duckdns.org | grep -i content-security-policy
curl: (3) URL rejected: Port number was not a decimal number between 0 and 65535
papaours@papaours:~$ 







