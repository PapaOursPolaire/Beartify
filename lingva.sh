#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║         Beartify — Script d'installation et d'automatisation        ║
# ║                                                                      ║
# ║  Installe et configure :                                             ║
# ║    1. Caddy (reverse proxy)                                          ║
# ║    2. Lingva Translate (traducteur open-source auto-hébergé)         ║
# ║    3. Services systemd pour démarrage automatique                    ║
# ║                                                                      ║
# ║  Usage :                                                             ║
# ║    chmod +x install-beartify-services.sh                             ║
# ║    sudo ./install-beartify-services.sh                               ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Couleurs pour les logs ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
sep()  { echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ── Vérifications préalables ─────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Ce script doit être exécuté en root (sudo)"
command -v apt-get &>/dev/null || err "Ce script nécessite apt (Debian/Ubuntu)"

sep
echo -e "${BOLD}  Beartify — Installation des services${NC}"
sep

# ══════════════════════════════════════════════════════════════════════
# 1. MISE À JOUR SYSTÈME
# ══════════════════════════════════════════════════════════════════════
sep; log "Mise à jour des paquets système…"
apt-get update -qq
apt-get install -y -qq curl wget git unzip tar ca-certificates gnupg lsb-release
ok "Paquets de base installés"

# ══════════════════════════════════════════════════════════════════════
# 2. INSTALLATION DE CADDY
# ══════════════════════════════════════════════════════════════════════
sep; log "Installation de Caddy…"

if command -v caddy &>/dev/null; then
    warn "Caddy déjà installé — $(caddy version)"
else
    # Clé GPG officielle Caddy
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y caddy
    ok "Caddy installé — $(caddy version)"
fi

# Créer les dossiers nécessaires
mkdir -p /srv/beartify
mkdir -p /var/log/caddy
chown -R caddy:caddy /var/log/caddy

# Copier le Caddyfile
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/Caddyfile" ]]; then
    cp "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
    ok "Caddyfile copié dans /etc/caddy/Caddyfile"
else
    warn "Caddyfile non trouvé dans $SCRIPT_DIR — copie manuelle requise vers /etc/caddy/Caddyfile"
fi

# ══════════════════════════════════════════════════════════════════════
# 3. INSTALLATION DE NODE.JS (pour Lingva Translate)
# ══════════════════════════════════════════════════════════════════════
sep; log "Vérification de Node.js…"

if command -v node &>/dev/null && [[ $(node -e "process.exit(+process.version.slice(1).split('.')[0] < 18)"; echo $?) -eq 0 ]]; then
    ok "Node.js $(node --version) déjà installé"
else
    log "Installation de Node.js 20 LTS…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    ok "Node.js $(node --version) installé"
fi

# ══════════════════════════════════════════════════════════════════════
# 4. INSTALLATION DE LINGVA TRANSLATE
# ══════════════════════════════════════════════════════════════════════
sep; log "Installation de Lingva Translate…"

LINGVA_DIR="/opt/lingva-translate"
LINGVA_PORT=3003

if [[ -d "$LINGVA_DIR" ]]; then
    warn "Lingva déjà installé dans $LINGVA_DIR"
    cd "$LINGVA_DIR"
    log "Mise à jour…"
    git pull --quiet
else
    log "Clonage du dépôt Lingva Translate…"
    git clone --depth=1 https://github.com/thedaviddelta/lingva-translate.git "$LINGVA_DIR"
    cd "$LINGVA_DIR"
fi

log "Installation des dépendances npm…"
npm ci --silent --production 2>/dev/null || npm install --silent --production

log "Build de Lingva Translate (Next.js)…"
npm run build 2>/dev/null || { warn "Build standard échoué, tentative avec next build…"; npx next build; }

ok "Lingva Translate prêt dans $LINGVA_DIR"

# Créer l'utilisateur de service si absent
if ! id lingva &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin lingva
    ok "Utilisateur système 'lingva' créé"
fi
chown -R lingva:lingva "$LINGVA_DIR"

# ══════════════════════════════════════════════════════════════════════
# 5. SERVICE SYSTEMD — LINGVA TRANSLATE
# ══════════════════════════════════════════════════════════════════════
sep; log "Création du service systemd pour Lingva Translate…"

cat > /etc/systemd/system/lingva-translate.service << EOF
[Unit]
Description=Lingva Translate — Traducteur open-source (Beartify)
Documentation=https://github.com/thedaviddelta/lingva-translate
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lingva
Group=lingva
WorkingDirectory=$LINGVA_DIR
ExecStart=/usr/bin/node_modules/.bin/next start --port $LINGVA_PORT
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=lingva-translate

# Variables d'environnement
Environment=NODE_ENV=production
Environment=PORT=$LINGVA_PORT
Environment=NEXT_TELEMETRY_DISABLED=1
# Instance Google Translate utilisée par Lingva (changer si throttled)
Environment=LINGVA_SOURCE=google

# Sécurité
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$LINGVA_DIR/.next

[Install]
WantedBy=multi-user.target
EOF

ok "Service systemd 'lingva-translate' créé"

# ══════════════════════════════════════════════════════════════════════
# 6. ACTIVATION ET DÉMARRAGE DES SERVICES
# ══════════════════════════════════════════════════════════════════════
sep; log "Activation des services…"

systemctl daemon-reload

# Lingva Translate
systemctl enable lingva-translate
systemctl restart lingva-translate
sleep 2
if systemctl is-active --quiet lingva-translate; then
    ok "Lingva Translate actif sur le port $LINGVA_PORT"
else
    warn "Lingva Translate ne semble pas démarrer — vérifier : journalctl -u lingva-translate -n 50"
fi

# Caddy
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
if systemctl is-active --quiet caddy; then
    ok "Caddy actif"
else
    warn "Caddy ne semble pas démarrer — vérifier : journalctl -u caddy -n 50"
fi

# ══════════════════════════════════════════════════════════════════════
# 7. VÉRIFICATION FINALE
# ══════════════════════════════════════════════════════════════════════
sep
echo -e "${BOLD}  Vérification des services${NC}"
sep

check_service() {
    local name=$1
    if systemctl is-active --quiet "$name"; then
        ok "$name : ${GREEN}actif${NC}"
    else
        warn "$name : ${RED}inactif${NC}"
    fi
}

check_service caddy
check_service lingva-translate

# Test rapide de Lingva
log "Test de l'API Lingva Translate…"
LINGVA_TEST=$(curl -s --max-time 5 "http://localhost:$LINGVA_PORT/api/v1/auto/fr/Hello" 2>/dev/null | grep -o '"translation":"[^"]*"' | head -1)
if [[ -n "$LINGVA_TEST" ]]; then
    ok "Lingva répond correctement : $LINGVA_TEST"
else
    warn "Lingva ne répond pas encore (peut nécessiter 10-30s de démarrage)"
    warn "Tester manuellement : curl http://localhost:$LINGVA_PORT/api/v1/auto/fr/Hello"
fi

# ══════════════════════════════════════════════════════════════════════
# 8. MISE À JOUR DU FRONT BEARTIFY pour utiliser /api/translate au lieu de lingva.ml
# ══════════════════════════════════════════════════════════════════════
sep
echo -e "${BOLD}  Configuration Beartify${NC}"
sep

warn "⚠️  ACTIONS MANUELLES REQUISES :"
echo ""
echo "  1. Dans /etc/caddy/Caddyfile :"
echo "     → Remplacer 'ton.email@example.com' par votre email Let's Encrypt"
echo "     → Remplacer 'beartify.tondomaine.fr' par votre vrai domaine"
echo "     → Remplacer 'JELLYFIN_API_TOKEN_ICI' par votre token Jellyfin"
echo "     → Remplacer 'NEXTCLOUD_BASE64_CREDENTIALS_ICI' par vos credentials Nextcloud (base64)"
echo ""
echo "  2. Dans script.js, mettre '/api/translate' en premier dans _LINGVA_INSTANCES :"
echo "     const _LINGVA_INSTANCES = ["
echo "       '/api/translate',          // instance locale auto-hébergée (prioritaire)"
echo "       'https://lingva.ml',       // fallback public"
echo "       'https://translate.plausibility.cloud',"
echo "     ];"
echo ""
echo "  3. Déployer les fichiers Beartify dans /srv/beartify :"
echo "     cp -r /chemin/vers/beartify/* /srv/beartify/"
echo ""
echo "  4. Redémarrer Caddy après modification du Caddyfile :"
echo "     sudo systemctl restart caddy"
echo ""

sep
echo -e "${GREEN}${BOLD}  Installation terminée !${NC}"
sep
echo ""
echo "  Logs en temps réel :"
echo "    Caddy            : journalctl -fu caddy"
echo "    Lingva Translate : journalctl -fu lingva-translate"
echo ""
echo "  Test Lingva local  : curl 'http://localhost:$LINGVA_PORT/api/v1/auto/fr/Hello'"
echo "  Test via Caddy     : curl 'https://beartify.tondomaine.fr/api/translate/api/v1/auto/fr/Hello'"
echo ""
