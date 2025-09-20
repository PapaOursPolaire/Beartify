# VERSION 146

perform_security_audit() {
    log "Audit de sécurité final..."
    
    # Vérification des services exposés
    OPEN_PORTS=$(ss -tlnp | grep LISTEN | awk '{print $4}' | cut -d: -f2 | sort -n | uniq)
    
    echo "🔍 Ports ouverts détectés:"
    for port in $OPEN_PORTS; do
        SERVICE=$(ss -tlnp | grep ":$port " | awk '{print $6}' | cut -d'"' -f2 | head -1)
        echo "  Port $port - $SERVICE"
    done
    
    # Vérification des permissions critiques
    echo "🔍 Vérification des permissions:"
    ls -la "$MEDIA_ROOT" | head -5
    ls -la "$BEARTIFY_HOME" | head -5
    
    # Test de connectivité base de données
    echo "💾 Test base de données:"
    if sudo -u postgres psql -d "$DB_NAME" -c "SELECT version();" > /dev/null 2>&1; then
        echo "  ✅ PostgreSQL: OK"
    else
        echo "  ❌ PostgreSQL: Erreur"
    fi
    
    # Test Redis
echo "📄 TEST CACHE:"
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis: Connecté"
else
    echo "❌ Redis: Erreur de connexion"
fi

echo ""

# Derniers logs d'erreur
echo "📋 DERNIERS LOGS (5 dernières erreurs):"
journalctl -u beartify --since="24 hours ago" -p err -n 5 --no-pager

echo ""
echo "🩺 Health check terminé !"
EOF

    sudo chmod +x /usr/local/bin/beartify-health-check.sh
    
    # Script de performance
    sudo tee /usr/local/bin/beartify-performance.sh > /dev/null <<'EOF'
#!/bin/bash

echo "⚡ BEARTIFY PERFORMANCE MONITOR - $(date)"
echo "========================================="

echo "🏃 PROCESSUS BEARTIFY:"
ps aux | grep -E "(java.*beartify|nginx|postgres|redis)" | grep -v grep

echo ""
echo "📊 UTILISATION CPU/MÉMOIRE (Top 10):"
top -b -n1 | head -17

echo ""
echo "💾 I/O DISQUE:"
iostat -x 1 1 | tail -n +4

echo ""
echo "🌐 CONNEXIONS RÉSEAU:"
netstat -an | grep -E ':(80|443|8080|5432|6379)' | awk '{print $4, $6}' | sort | uniq -c | sort -nr

echo ""
echo "📈 STATISTIQUES REDIS:"
redis-cli info stats | grep -E "(total_commands_processed|total_connections_received|used_memory_human)"

echo ""
echo "⚡ Performance check terminé !"
EOF

    sudo chmod +x /usr/local/bin/beartify-performance.sh
    
    # Script de mise à jour automatique
    sudo tee /usr/local/bin/beartify-update.sh > /dev/null <<'EOF'
#!/bin/bash

echo "🔄 MISE À JOUR BEARTIFY - $(date)"
echo "================================="

# Sauvegarde avant mise à jour
echo "💾 Sauvegarde de sécurité..."
/home/musicuser/backup-config.sh

# Mise à jour système
echo "🔄 Mise à jour du système..."
apt update && apt upgrade -y

# Redémarrage des services si nécessaire
echo "🔄 Redémarrage des services..."
systemctl restart nginx
systemctl restart redis-server

# Vérification post-mise à jour
echo "✅ Vérification des services..."
/usr/local/bin/beartify-health-check.sh

echo "🔄 Mise à jour terminée !"
EOF

    sudo chmod +x /usr/local/bin/beartify-update.sh
    
    # Cron jobs pour maintenance automatique
    sudo tee /etc/cron.d/beartify-maintenance > /dev/null <<EOF
# Beartify - Maintenance automatique

# Health check quotidien
0 6 * * * root /usr/local/bin/beartify-health-check.sh >> /var/log/beartify-health.log 2>&1

# Performance check toutes les heures
0 * * * * root /usr/local/bin/beartify-performance.sh >> /var/log/beartify-performance.log 2>&1

# Nettoyage des logs anciens
0 3 * * 0 root find /srv/media/logs /home/musicuser/logs -name "*.log" -mtime +30 -delete

# Optimisation base de données (hebdomadaire)
0 2 * * 0 postgres vacuumdb --all --analyze

# Mise à jour sécurité (mensuel)
0 4 1 * * root /usr/local/bin/beartify-update.sh >> /var/log/beartify-update.log 2>&1
EOF
    
    log "Outils de maintenance créés"
}

show_installation_summary() {
    clear
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                    🎉 INSTALLATION TERMINÉE ! 🎉             ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    echo -e "${CYAN}🎵 BEARTIFY - Votre serveur de streaming est prêt !${NC}"
    echo
    echo -e "${YELLOW}📊 RÉSUMÉ DE L'INSTALLATION:${NC}"
    echo "  🖥️  Interface: $(case $GUI_CHOICE in 1) echo "KDE Plasma";; 2) echo "GNOME";; 3) echo "Mode serveur";; esac)"
    echo "  💾 Base de données: $(case $DB_CHOICE in 1) echo "PostgreSQL";; 2) echo "MariaDB";; 3) echo "SQLite";; esac)"
    echo "  🔒 Sécurité: UFW + Fail2ban configurés"
    echo "  🌐 Reverse Proxy: Nginx $(if [[ -n "$DOMAIN" ]]; then echo "+ SSL Let's Encrypt"; fi)"
    echo "  ⚡ Cache: Redis + Memcached"
    echo "  📁 Stockage: $MEDIA_ROOT"
    echo "  💾 Sauvegardes: $BACKUP_ROOT"
    
    echo
    echo -e "${YELLOW}🔗 ACCÈS:${NC}"
    echo "  🌐 Application: http://$(hostname -I | awk '{print $1}'):$APP_PORT"
    
    if [[ -n "$DOMAIN" ]]; then
        echo "  🌐 Domaine: https://$DOMAIN"
    fi
    
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        echo "  📊 Grafana: http://$(hostname -I | awk '{print $1}'):3000"
        echo "  📈 Prometheus: http://$(hostname -I | awk '{print $1}'):9090"
    fi
    
    if [[ "$INSTALL_MINIO" =~ ^[Yy] ]]; then
        echo "  🗄️  MinIO Console: http://$(hostname -I | awk '{print $1}'):9001"
    fi
    
    echo
    echo -e "${YELLOW}👤 COMPTES CRÉÉS:${NC}"
    echo "  📧 Utilisateur système: $BEARTIFY_USER"
    echo "  💾 Base de données: $DB_USER"
    echo "  🔑 Mot de passe DB: $DB_PASS"
    
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        GRAFANA_PASS=$(sudo grep ^admin_password /etc/grafana/grafana.ini 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "beartify_admin")
        echo "  📊 Grafana admin: admin / $GRAFANA_PASS"
    fi
    
    if [[ "$INSTALL_MINIO" =~ ^[Yy] && -f "$BEARTIFY_HOME/.beartify_env" ]]; then
        source "$BEARTIFY_HOME/.beartify_env" 2>/dev/null || true
        echo "  🗄️  MinIO: $MINIO_ACCESS_KEY / $MINIO_SECRET_KEY"
    fi
    
    echo
    echo -e "${YELLOW}📂 DOSSIERS IMPORTANTS:${NC}"
    echo "  🎵 Musique: $MEDIA_ROOT/audio/"
    echo "  🎬 Vidéos: $MEDIA_ROOT/video/"
    echo "  🖼️  Images: $MEDIA_ROOT/images/"
    echo "  📋 Métadonnées: $MEDIA_ROOT/meta/"
    echo "  📤 Upload: $MEDIA_ROOT/temp/uploads/"
    echo "  💾 Sauvegardes: $BACKUP_ROOT/"
    echo "  🏠 App: $BEARTIFY_HOME/"
    
    echo
    echo -e "${YELLOW}🛠️  COMMANDES UTILES:${NC}"
    echo "  📊 Status: sudo systemctl status beartify"
    echo "  🔄 Redémarrer: sudo systemctl restart beartify"
    echo "  📋 Logs: sudo journalctl -u beartify -f"
    echo "  💾 Sauvegarde: $BEARTIFY_HOME/backup-config.sh"
    echo "  🔄 Conversion: /usr/local/bin/beartify-convert.sh"
    echo "  🩺 Health Check: sudo /usr/local/bin/beartify-health-check.sh"
    
    echo
    echo -e "${YELLOW}🔧 FICHIERS DE CONFIGURATION:${NC}"
    echo "  ⚙️  App: $BEARTIFY_HOME/application.yml"
    echo "  🌐 Nginx: /etc/nginx/sites-available/beartify"
    echo "  🔥 Firewall: sudo ufw status"
    echo "  💾 PostgreSQL: /etc/postgresql/*/main/postgresql.conf"
    
    echo
    echo -e "${GREEN}🎯 PROCHAINES ÉTAPES:${NC}"
    echo "  1. 📁 Uploadez vos fichiers musicaux dans $MEDIA_ROOT/temp/uploads/"
    echo "  2. 🔄 Ils seront automatiquement traités et convertis"
    echo "  3. 🎵 Remplacez beartify.jar par votre vraie application"
    echo "  4. 👥 Configurez vos utilisateurs et playlists"
    echo "  5. 🎉 Profitez de votre Spotify personnel !"
    
    echo
    echo -e "${YELLOW}⚠️  SÉCURITÉ:${NC}"
    echo "  🔑 Changez les mots de passe par défaut"
    echo "  🛡️  Configurez la sauvegarde externe"
    echo "  🔄 Mettez à jour régulièrement: sudo apt update && sudo apt upgrade"
    echo "  📊 Surveillez les performances via Grafana"
    
    echo
    echo -e "${PURPLE}📚 DOCUMENTATION:${NC}"
    echo "  🌐 Nginx: /var/log/nginx/"
    echo "  📋 App logs: $BEARTIFY_HOME/logs/"
    echo "  📁 Monitoring: $BACKUP_ROOT/logs/"
    echo "  📖 Config: https://github.com/monrepo/beartify/"
    
    echo
    echo -e "${GREEN}✅ INSTALLATION 100% TERMINÉE ! REDÉMARRAGE RECOMMANDÉ.${NC}"
    echo
    
    # Sauvegarde des informations d'installation
    sudo tee "$BEARTIFY_HOME/INSTALLATION_INFO.txt" > /dev/null <<EOF
BEARTIFY - INFORMATIONS D'INSTALLATION
=====================================
Date: $(date)
Hostname: $(hostname)
IP: $(hostname -I | awk '{print $1}')

CONFIGURATION:
- Interface: $(case $GUI_CHOICE in 1) echo "KDE Plasma";; 2) echo "GNOME";; 3) echo "Mode serveur";; esac)
- Base de données: $(case $DB_CHOICE in 1) echo "PostgreSQL";; 2) echo "MariaDB";; 3) echo "SQLite";; esac)
- Domaine: ${DOMAIN:-"Non configuré"}
- Monitoring: ${INSTALL_MONITORING}
- MinIO: ${INSTALL_MINIO}

ACCÈS:
- Application: http://$(hostname -I | awk '{print $1}'):$APP_PORT
- Domaine: ${DOMAIN:-"N/A"}

COMPTES:
- Utilisateur système: $BEARTIFY_USER
- DB User: $DB_USER
- DB Password: $DB_PASS

DOSSIERS:
- Média: $MEDIA_ROOT
- Backup: $BACKUP_ROOT
- App: $BEARTIFY_HOME

SERVICES:
- beartify.service
- beartify-converter.service
- postgresql.service
- nginx.service
- redis-server.service
- fail2ban.service
EOF
    
    sudo chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/INSTALLATION_INFO.txt"
    
    read -p "Voulez-vous redémarrer maintenant pour finaliser l'installation ? [Y/n]: " REBOOT
    if [[ "$REBOOT" =~ ^[Yy]?$ ]]; then
        log "Redémarrage du système dans 10 secondes..."
        sleep 10
        sudo reboot
    else
        log "N'oubliez pas de redémarrer plus tard : sudo reboot"
    fi
}

# EXÉCUTION DU SCRIPT PRINCIPAL
# Vérification que le script n'est pas sourcé
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Lancement de l'installation principale
    main "$@"
else
    echo "Ce script doit être exécuté directement, pas sourcé."
    exit 1
fi

# FIN DU SCRIPT D'INSTALLATION BEARTIFY

# Note: Ce script est conçu pour être robuste et handle les erreurs.
# En cas de problème, consultez les logs dans /var/log/ et /tmp/beartify-install-error-*
# 
# Pour réinstaller complètement :
# 1. sudo systemctl stop beartify beartify-converter
# 2. sudo rm -rf /srv/media /srv/backup /home/musicuser
# 3. sudo userdel musicuser
# 4. Relancer ce script
#
# Support et documentation : https://github.com/monrepo/beartify/
# GESTION DES ERREURS ET NETTOYAGE

cleanup_on_error() {
    error "Installation interrompue. Nettoyage en cours..."
    
    # Arrêt des services potentiellement démarrés
    sudo systemctl stop beartify 2>/dev/null || true
    sudo systemctl stop beartify-converter 2>/dev/null || true
    sudo systemctl stop nginx 2>/dev/null || true
    
    # Sauvegarde des logs d'erreur
    mkdir -p "/tmp/beartify-install-error-$(date +%Y%m%d_%H%M%S)"
    cp /var/log/syslog "/tmp/beartify-install-error-$(date +%Y%m%d_%H%M%S)/" 2>/dev/null || true
    journalctl -u beartify > "/tmp/beartify-install-error-$(date +%Y%m%d_%H%M%S)/beartify.log" 2>/dev/null || true
    
    echo "Logs d'erreur sauvegardés dans /tmp/beartify-install-error-*"
    echo "Contactez le support avec ces fichiers si nécessaire."
    
    exit 1
}

# Gestion des signaux d'interruption
trap cleanup_on_error ERR
trap cleanup_on_error INT
trap cleanup_on_error TERM

# FONCTIONS DE MAINTENANCE POST-INSTALLATION

create_maintenance_tools() {
    log "Création des outils de maintenance..."
    
    # Script de vérification système
    sudo tee /usr/local/bin/beartify-health-check.sh > /dev/null <<'EOF'
#!/bin/bash

echo "🩺 BEARTIFY HEALTH CHECK - $(date)"
echo "=================================="

# Vérification des services
services=("beartify" "nginx" "postgresql" "redis-server" "fail2ban")
for service in "${services[@]}"; do
    if systemctl is-active --quiet "$service"; then
        echo "✅ $service: Running"
    else
        echo "❌ $service: Stopped"
    fi
done

echo ""

# Vérification de l'espace disque
echo "💾 ESPACE DISQUE:"
df -h /srv /home | tail -n +2 | while read line; do
    usage=$(echo $line | awk '{print $5}' | tr -d '%')
    if [ "$usage" -gt 80 ]; then
        echo "⚠️  $line"
    else
        echo "✅ $line"
    fi
done

echo ""

# Vérification de la mémoire
echo "🧠 UTILISATION MÉMOIRE:"
free -h

echo ""

# Vérification des connexions
echo "🌐 CONNEXIONS RÉSEAU:"
ss -tlnp | grep -E ':(80|443|8080|5432|6379) '

echo ""

# Test de connectivité base de données
echo "💾 TEST BASE DE DONNÉES:"
if sudo -u postgres psql -d beartifydb -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL: Connecté"
else
    echo "❌ PostgreSQL: Erreur de connexion"
fi

# Test Redis#!/bin/bash

# BEARTIFY - Script d'installation automatique
# Alternative Spotify auto-hébergée moderne et performante
# Testé sur Ubuntu Server 20.04+ / Intel Core i5-6600U / 32GB RAM / 1TB HDD

set -euo pipefail
IFS=$'\n\t'

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Variables globales
BEARTIFY_USER="musicuser"
BEARTIFY_HOME="/home/$BEARTIFY_USER"
MEDIA_ROOT="/srv/media"
BACKUP_ROOT="/srv/backup"
APP_PORT="8080"
DB_NAME="beartifydb"
DB_USER="beartifyuser"
DB_PASS=$(openssl rand -base64 32)
DOMAIN=""
EMAIL=""
GUI_CHOICE=""
DB_CHOICE=""
INSTALL_MONITORING=""
INSTALL_MINIO=""
MINIO_ACCESS_KEY=""
MINIO_SECRET_KEY=""

# FONCTIONS UTILITAIRES

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "Ce script ne doit PAS être exécuté en root. Utilisez un utilisateur avec sudo."
    fi
    
    if ! sudo -n true 2>/dev/null; then
        error "L'utilisateur actuel n'a pas les privilèges sudo nécessaires."
    fi
}

# INTERFACE UTILISATEUR ET CONFIGURATION

welcome_banner() {
    clear
    echo -e "${PURPLE}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                         🎵 BEARTIFY 🎵                        ║"
    echo "║            Alternative Spotify Auto-hébergée                ║"
    echo "║                  Installation Automatique                   ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo
    log "Bienvenue dans l'installateur Beartify !"
    echo
}

get_user_preferences() {
    echo -e "${CYAN}=== Configuration de votre serveur Beartify ===${NC}"
    echo
    
    # Interface graphique
    echo "Choisissez votre interface graphique :"
    echo "1) KDE Plasma (moderne, léger, recommandé)"
    echo "2) GNOME (classique, plus lourd)"
    echo "3) Aucune (mode serveur uniquement)"
    read -p "Votre choix [1-3] (défaut: 1): " GUI_CHOICE
    GUI_CHOICE=${GUI_CHOICE:-1}
    
    # Domaine et SSL
    echo
    read -p "Nom de domaine (optionnel, ex: music.mondomaine.com): " DOMAIN
    if [[ -n "$DOMAIN" ]]; then
        read -p "Email pour Let's Encrypt: " EMAIL
    fi
    
    # Base de données principale
    echo
    echo "Choisissez votre base de données principale :"
    echo "1) PostgreSQL (recommandé pour production)"
    echo "2) MariaDB (MySQL compatible)"
    echo "3) SQLite (ultra léger, développement)"
    read -p "Votre choix [1-3] (défaut: 1): " DB_CHOICE
    DB_CHOICE=${DB_CHOICE:-1}
    
    # Services optionnels
    echo
    read -p "Installer le monitoring (Prometheus + Grafana) ? [y/N]: " INSTALL_MONITORING
    INSTALL_MONITORING=${INSTALL_MONITORING:-n}
    
    read -p "Installer MinIO pour stockage objet ? [y/N]: " INSTALL_MINIO
    INSTALL_MINIO=${INSTALL_MINIO:-n}
    
    echo
    log "Configuration terminée ! Installation en cours..."
    sleep 2
}

# INSTALLATION DU SYSTÈME DE BASE

update_system() {
    log "Mise à jour du système..."
    sudo apt update
    sudo apt upgrade -y
    sudo apt autoremove -y
}

install_essential_tools() {
    log "Installation des outils essentiels..."
    
    # Paquets de base
    sudo apt install -y \
        curl wget git unzip zip \
        htop iotop nethogs \
        build-essential \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        software-properties-common \
        tree \
        ncdu \
        tmux \
        vim \
        jq
    
    # Outils multimédia avancés
    sudo apt install -y \
        ffmpeg \
        imagemagick \
        flac \
        lame \
        opus-tools \
        vorbis-tools \
        sox \
        mediainfo \
        exiftool
    
    # Outils de performance
    sudo apt install -y \
        iperf3 \
        stress \
        sysstat \
        dstat \
        atop
}

create_beartify_user() {
    log "Création de l'utilisateur système $BEARTIFY_USER..."
    
    if ! id "$BEARTIFY_USER" &>/dev/null; then
        sudo useradd -m -s /bin/bash "$BEARTIFY_USER"
        sudo usermod -aG audio,video "$BEARTIFY_USER"
        
        # Configuration SSH pour l'utilisateur
        sudo -u "$BEARTIFY_USER" mkdir -p "$BEARTIFY_HOME/.ssh"
        sudo -u "$BEARTIFY_USER" chmod 700 "$BEARTIFY_HOME/.ssh"
    fi
    
    log "Utilisateur $BEARTIFY_USER créé avec succès"
}

# SÉCURITÉ ET PARE-FEU

setup_firewall() {
    log "Configuration du pare-feu UFW..."
    
    sudo ufw --force reset
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    
    # Ports essentiels
    sudo ufw allow 22/tcp comment "SSH"
    sudo ufw allow 80/tcp comment "HTTP"
    sudo ufw allow 443/tcp comment "HTTPS"
    sudo ufw allow $APP_PORT/tcp comment "Beartify App"
    
    # Services optionnels
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        sudo ufw allow 3000/tcp comment "Grafana"
        sudo ufw allow 9090/tcp comment "Prometheus"
    fi
    
    if [[ "$INSTALL_MINIO" =~ ^[Yy] ]]; then
        sudo ufw allow 9000/tcp comment "MinIO"
        sudo ufw allow 9001/tcp comment "MinIO Console"
    fi
    
    sudo ufw --force enable
    log "Pare-feu configuré et activé"
}

setup_fail2ban() {
    log "Installation et configuration de Fail2ban..."
    
    sudo apt install -y fail2ban
    
    # Configuration personnalisée
    sudo tee /etc/fail2ban/jail.local > /dev/null <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log

[nginx-noscript]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 6

[nginx-badbots]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2

[nginx-noproxy]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

    sudo systemctl enable fail2ban
    sudo systemctl start fail2ban
    log "Fail2ban configuré et démarré"
}

# INTERFACE GRAPHIQUE

install_gui() {
    case $GUI_CHOICE in
        1)
            log "Installation de KDE Plasma..."
            sudo apt install -y kubuntu-desktop-minimal
            sudo systemctl set-default graphical.target
            ;;
        2)
            log "Installation de GNOME..."
            sudo apt install -y ubuntu-desktop-minimal
            sudo systemctl set-default graphical.target
            ;;
        3)
            log "Mode serveur - pas d'interface graphique"
            ;;
    esac
}

# STOCKAGE MULTIMÉDIA OPTIMISÉ

setup_media_storage() {
    log "Création de l'arborescence multimédia..."
    
    # Structure des dossiers
    sudo mkdir -p \
        "$MEDIA_ROOT/audio/mp3" \
        "$MEDIA_ROOT/audio/flac" \
        "$MEDIA_ROOT/audio/ogg" \
        "$MEDIA_ROOT/audio/lrc" \
        "$MEDIA_ROOT/video/mp4" \
        "$MEDIA_ROOT/video/webm" \
        "$MEDIA_ROOT/video/hls" \
        "$MEDIA_ROOT/meta/json" \
        "$MEDIA_ROOT/meta/cache" \
        "$MEDIA_ROOT/images/png" \
        "$MEDIA_ROOT/images/jpg" \
        "$MEDIA_ROOT/images/webp" \
        "$MEDIA_ROOT/images/thumbnails" \
        "$MEDIA_ROOT/temp/uploads" \
        "$MEDIA_ROOT/temp/processing"
    
    # Permissions optimisées
    sudo chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$MEDIA_ROOT"
    sudo chmod -R 755 "$MEDIA_ROOT"
    
    # Cache et temp avec permissions spéciales
    sudo chmod -R 777 "$MEDIA_ROOT/temp"
    sudo chmod -R 755 "$MEDIA_ROOT/meta/cache"
    
    log "Structure de stockage créée avec succès"
}

setup_backup_system() {
    log "Configuration du système de sauvegarde..."
    
    sudo mkdir -p \
        "$BACKUP_ROOT/database" \
        "$BACKUP_ROOT/media" \
        "$BACKUP_ROOT/config" \
        "$BACKUP_ROOT/logs"
    
    sudo chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$BACKUP_ROOT"
    
    # Script de sauvegarde automatique
    sudo tee /usr/local/bin/beartify-backup.sh > /dev/null <<'EOF'
#!/bin/bash

BACKUP_ROOT="/srv/backup"
MEDIA_ROOT="/srv/media"
DATE=$(date +%Y%m%d_%H%M%S)

# Sauvegarde base de données PostgreSQL
if systemctl is-active --quiet postgresql; then
    sudo -u postgres pg_dump beartifydb > "$BACKUP_ROOT/database/beartify_$DATE.sql"
    gzip "$BACKUP_ROOT/database/beartify_$DATE.sql"
fi

# Sauvegarde métadonnées et images
tar -czf "$BACKUP_ROOT/media/meta_$DATE.tar.gz" -C "$MEDIA_ROOT" meta/ images/

# Nettoyage des anciennes sauvegardes (garde 7 jours)
find "$BACKUP_ROOT" -name "*.gz" -mtime +7 -delete

# Log
echo "$(date): Sauvegarde terminée - $DATE" >> "$BACKUP_ROOT/logs/backup.log"
EOF

    sudo chmod +x /usr/local/bin/beartify-backup.sh
    
    # Cron job pour sauvegarde quotidienne à 2h du matin
    echo "0 2 * * * /usr/local/bin/beartify-backup.sh" | sudo crontab -u "$BEARTIFY_USER" -
    
    log "Système de sauvegarde configuré"
}

# BASES DE DONNÉES

install_postgresql() {
    log "Installation de PostgreSQL..."
    
    sudo apt install -y postgresql postgresql-contrib
    
    # Configuration pour performances optimisées
    PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | grep -oP '\d+\.\d+' | head -1 || echo "14")
    PG_CONFIG="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
    
    sudo tee -a "$PG_CONFIG" > /dev/null <<EOF

# === BEARTIFY OPTIMIZATIONS ===
# Mémoire (pour 32GB RAM)
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 256MB
maintenance_work_mem = 2GB

# Performances
random_page_cost = 1.1
effective_io_concurrency = 200
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4

# WAL et checkpoints
wal_buffers = 16MB
checkpoint_completion_target = 0.9
min_wal_size = 1GB
max_wal_size = 4GB

# Connexions
max_connections = 200

# Logging
log_min_duration_statement = 1000
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
EOF

    sudo systemctl restart postgresql
    
    # Création de la base de données
    sudo -u postgres createuser "$DB_USER" || true
    sudo -u postgres createdb -O "$DB_USER" "$DB_NAME" || true
    sudo -u postgres psql -c "ALTER USER $DB_USER PASSWORD '$DB_PASS';" || true
    
    # Extensions utiles
    sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" || true
    sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS btree_gin;" || true
    
    log "PostgreSQL installé et configuré"
}

install_mariadb() {
    log "Installation de MariaDB..."
    
    sudo apt install -y mariadb-server mariadb-client
    
    # Configuration sécurisée
    sudo mysql -e "CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" || true
    sudo mysql -e "CREATE USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';" || true
    sudo mysql -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';" || true
    sudo mysql -e "FLUSH PRIVILEGES;" || true
    
    # Optimisations MySQL pour multimédia
    sudo tee -a /etc/mysql/mariadb.conf.d/99-beartify.cnf > /dev/null <<EOF
[mysqld]
# Optimisations Beartify
innodb_buffer_pool_size = 8G
innodb_log_file_size = 512M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
query_cache_size = 256M
query_cache_type = 1
max_connections = 200
tmp_table_size = 256M
max_heap_table_size = 256M
key_buffer_size = 256M

# Support pour fichiers binaires volumineux
max_allowed_packet = 64M
EOF

    sudo systemctl restart mariadb
    log "MariaDB installé et configuré"
}

setup_sqlite() {
    log "Configuration de SQLite..."
    sudo apt install -y sqlite3 libsqlite3-dev
    
    # Création du fichier de base
    sudo -u "$BEARTIFY_USER" sqlite3 "$BEARTIFY_HOME/beartify.db" "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=10000;"
    
    log "SQLite configuré"
}

# JAVA ET ENVIRONNEMENT DE DÉVELOPPEMENT

install_java_environment() {
    log "Installation de l'environnement Java..."
    
    # OpenJDK 17 (LTS)
    sudo apt install -y openjdk-17-jdk openjdk-17-jre
    
    # Maven pour la compilation
    sudo apt install -y maven
    
    # Gradle (alternative moderne)
    wget -q https://services.gradle.org/distributions/gradle-8.4-bin.zip
    sudo unzip -d /opt gradle-8.4-bin.zip
    sudo ln -sf /opt/gradle-8.4/bin/gradle /usr/local/bin/gradle
    rm gradle-8.4-bin.zip
    
    # Variables d'environnement
    sudo tee /etc/environment > /dev/null <<EOF
JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
BEARTIFY_HOME="$BEARTIFY_HOME"
MEDIA_ROOT="$MEDIA_ROOT"
EOF
    
    log "Environnement Java configuré"
}

create_systemd_service() {
    log "Création du service systemd Beartify..."
    
    sudo tee /etc/systemd/system/beartify.service > /dev/null <<EOF
[Unit]
Description=Beartify Media Streaming Server
After=network.target postgresql.service

[Service]
Type=simple
User=$BEARTIFY_USER
Group=$BEARTIFY_USER
WorkingDirectory=$BEARTIFY_HOME
ExecStart=/usr/bin/java -Xmx4g -Xms2g -XX:+UseG1GC -jar $BEARTIFY_HOME/beartify.jar
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=beartify

# Sécurité
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=$MEDIA_ROOT $BACKUP_ROOT $BEARTIFY_HOME

# Limites de ressources
LimitNOFILE=65536
LimitNPROC=4096

Environment=SPRING_PROFILES_ACTIVE=production
Environment=SERVER_PORT=$APP_PORT
Environment=MEDIA_ROOT=$MEDIA_ROOT
Environment=DB_URL=jdbc:postgresql://localhost:5432/$DB_NAME
Environment=DB_USER=$DB_USER
Environment=DB_PASS=$DB_PASS

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable beartify
    
    log "Service systemd créé et activé"
}

# REVERSE PROXY ET HTTPS

install_nginx() {
    log "Installation et configuration de Nginx..."
    
    sudo apt install -y nginx
    
    # Configuration optimisée pour streaming
    sudo tee /etc/nginx/nginx.conf > /dev/null <<'EOF'
user www-data;
worker_processes auto;
worker_rlimit_nofile 65535;
pid /run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    # Basic Settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    client_max_body_size 100M;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml
        text/plain
        text/css
        text/js
        text/xml
        text/javascript;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

    # Configuration du site Beartify
    sudo tee /etc/nginx/sites-available/beartify > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};
    
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # Streaming optimisé
    location /api/stream/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    
    # Fichiers statiques
    location /media/ {
        alias $MEDIA_ROOT/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
    }
}
EOF

    # HTTPS avec Let's Encrypt si domaine configuré
    if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
        sudo apt install -y certbot python3-certbot-nginx
        
        sudo tee -a /etc/nginx/sites-available/beartify > /dev/null <<EOF

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    
    # SSL Configuration (sera complétée par certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # API de streaming optimisé
    location /api/stream/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        
        # Headers pour streaming
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
        add_header Access-Control-Allow-Headers "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range";
        add_header Access-Control-Expose-Headers "Content-Length,Content-Range";
    }
    
    # Fichiers média avec cache optimisé
    location /media/ {
        alias $MEDIA_ROOT/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
        
        # Support des requêtes Range pour streaming
        add_header Accept-Ranges bytes;
        
        # CORS pour les fichiers média
        add_header Access-Control-Allow-Origin "*";
    }
    
    # API d'upload avec limite de taille
    location /api/upload/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        client_max_body_size 500M;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        
        limit_req zone=api burst=5 nodelay;
    }
}
EOF
    fi
    
    # Activation du site
    sudo ln -sf /etc/nginx/sites-available/beartify /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test de la configuration
    sudo nginx -t
    sudo systemctl restart nginx
    
    # Let's Encrypt si domaine configuré
    if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
        log "Configuration SSL avec Let's Encrypt..."
        sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" || true
        
        # Renouvellement automatique
        echo "0 12 * * * /usr/bin/certbot renew --quiet" | sudo crontab - || true
    fi
    
    log "Nginx configuré avec succès"
}

# SERVICES DE CACHE ET PERFORMANCE

install_redis() {
    log "Installation de Redis..."
    
    sudo apt install -y redis-server
    
    # Configuration optimisée
    sudo tee -a /etc/redis/redis.conf > /dev/null <<EOF

# === BEARTIFY OPTIMIZATIONS ===
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000

# Performance
tcp-keepalive 60
timeout 300
databases 16

# Sécurité
bind 127.0.0.1
protected-mode yes
EOF

    sudo systemctl restart redis-server
    log "Redis installé et configuré"
}

install_memcached() {
    log "Installation de Memcached..."
    
    sudo apt install -y memcached
    
    # Configuration
    sudo sed -i 's/-m 64/-m 1024/' /etc/memcached.conf
    sudo systemctl restart memcached
    
    log "Memcached configuré"
}

# MONITORING ET OBSERVABILITÉ

install_monitoring() {
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        log "Installation du monitoring (Prometheus + Grafana)..."
        
        # Prometheus
        wget -q https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz
        tar -xzf prometheus-2.45.0.linux-amd64.tar.gz
        sudo mv prometheus-2.45.0.linux-amd64 /opt/prometheus
        sudo ln -sf /opt/prometheus/prometheus /usr/local/bin/
        sudo ln -sf /opt/prometheus/promtool /usr/local/bin/
        rm prometheus-2.45.0.linux-amd64.tar.gz
        
        # Configuration Prometheus
        sudo mkdir -p /etc/prometheus
        sudo tee /etc/prometheus/prometheus.yml > /dev/null <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  
  - job_name: 'beartify'
    static_configs:
      - targets: ['localhost:$APP_PORT']
    metrics_path: '/actuator/prometheus'
  
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
  
  - job_name: 'nginx'
    static_configs:
      - targets: ['localhost:9113']
EOF
        
        # Service Node Exporter
        sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<EOF
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF
        
        sudo useradd --no-create-home --shell /bin/false node_exporter || true
        
        # Grafana
        curl -s https://packages.grafana.com/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
        echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://packages.grafana.com/oss/deb stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
        sudo apt update
        sudo apt install -y grafana
        
        # Configuration Grafana
        GRAFANA_PASS="beartify_admin_$(openssl rand -base64 8)"
        sudo tee /etc/grafana/grafana.ini > /dev/null <<EOF
[server]
http_port = 3000
domain = ${DOMAIN:-localhost}
root_url = http://${DOMAIN:-localhost}:3000/

[security]
admin_user = admin
admin_password = $GRAFANA_PASS

[auth.anonymous]
enabled = false

[dashboards]
default_home_dashboard_path = /var/lib/grafana/dashboards/beartify-overview.json
EOF
        
        # Dashboard Beartify personnalisé
        sudo mkdir -p /var/lib/grafana/dashboards
        sudo tee /var/lib/grafana/dashboards/beartify-overview.json > /dev/null <<'DASHBOARD'
{
  "dashboard": {
    "title": "Beartify Overview",
    "tags": ["beartify"],
    "timezone": "browser",
    "panels": [
      {
        "title": "Active Users",
        "type": "stat",
        "targets": [
          {
            "expr": "beartify_active_users_total",
            "legendFormat": "Users"
          }
        ]
      },
      {
        "title": "Songs Played",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(beartify_songs_played_total[5m])",
            "legendFormat": "Songs/min"
          }
        ]
      },
      {
        "title": "System CPU Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "100 - (avg(irate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
            "legendFormat": "CPU %"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100",
            "legendFormat": "Memory %"
          }
        ]
      },
      {
        "title": "Network I/O",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(node_network_receive_bytes_total[5m])",
            "legendFormat": "RX"
          },
          {
            "expr": "rate(node_network_transmit_bytes_total[5m])",
            "legendFormat": "TX"
          }
        ]
      }
    ],
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "refresh": "30s"
  }
}
DASHBOARD
        
        # Démarrage des services
        sudo systemctl daemon-reload
        sudo systemctl enable prometheus node_exporter grafana-server
        sudo systemctl start prometheus node_exporter grafana-server
        
        log "Monitoring installé - Grafana: http://${DOMAIN:-localhost}:3000"
        log "Grafana admin password: $GRAFANA_PASS"
    fi
}

# STOCKAGE OBJET MINIO (OPTIONNEL)

install_minio() {
    if [[ "$INSTALL_MINIO" =~ ^[Yy] ]]; then
        log "Installation de MinIO..."
        
        # Installation binaire
        wget -q https://dl.min.io/server/minio/release/linux-amd64/minio
        sudo chmod +x minio
        sudo mv minio /usr/local/bin/
        
        # Utilisateur MinIO
        sudo useradd -r minio-user -s /sbin/nologin || true
        sudo mkdir -p /srv/minio/data
        sudo chown minio-user:minio-user /srv/minio/data
        
        # Configuration
        sudo mkdir -p /etc/minio
        MINIO_ACCESS_KEY=$(openssl rand -base64 12)
        MINIO_SECRET_KEY=$(openssl rand -base64 32)
        
        sudo tee /etc/minio/minio.conf > /dev/null <<EOF
MINIO_ROOT_USER=$MINIO_ACCESS_KEY
MINIO_ROOT_PASSWORD=$MINIO_SECRET_KEY
MINIO_VOLUMES="/srv/minio/data"
MINIO_OPTS="--console-address :9001"
EOF
        
        # Service systemd
        sudo tee /etc/systemd/system/minio.service > /dev/null <<EOF
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
Type=notify
User=minio-user
Group=minio-user
EnvironmentFile=/etc/minio/minio.conf
ExecStart=/usr/local/bin/minio server \$MINIO_OPTS \$MINIO_VOLUMES
Restart=always
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
        
        sudo systemctl daemon-reload
        sudo systemctl enable minio
        sudo systemctl start minio
        
        log "MinIO installé - Console: http://${DOMAIN:-localhost}:9001"
        log "Access Key: $MINIO_ACCESS_KEY"
        log "Secret Key: $MINIO_SECRET_KEY"
        
        # Stockage des clés MinIO pour récupération ultérieure
        echo "MINIO_ACCESS_KEY=\"$MINIO_ACCESS_KEY\"" >> "$BEARTIFY_HOME/.beartify_env"
        echo "MINIO_SECRET_KEY=\"$MINIO_SECRET_KEY\"" >> "$BEARTIFY_HOME/.beartify_env"
    fi
}

# OUTILS DE CONVERSION MULTIMÉDIA AVANCÉS
setup_media_tools() {
    log "Configuration des outils de traitement multimédia..."
    
    # Installation d'outils supplémentaires
    sudo apt install -y \
        atomicparsley \
        mp3gain \
        vorbisgain \
        normalize-audio \
        wavpack \
        musepack-tools \
        mac \
        shntool \
        cuetools \
        mpcchap \
        inotify-tools
    
    # Script de conversion automatique
    sudo tee /usr/local/bin/beartify-convert.sh > /dev/null <<'EOF'
#!/bin/bash

# Script de conversion automatique Beartify
# Usage: beartify-convert.sh <input_file> <output_directory>

INPUT="$1"
OUTPUT_DIR="$2"
TEMP_DIR="/srv/media/temp/processing"

if [[ -z "$INPUT" || -z "$OUTPUT_DIR" ]]; then
    echo "Usage: $0 <input_file> <output_directory>"
    exit 1
fi

FILENAME=$(basename "$INPUT")
NAME="${FILENAME%.*}"
EXT="${FILENAME##*.}"

# Création des versions multiples pour streaming adaptatif
case "${EXT,,}" in
    flac|wav|ape|wv)
        # Conversion FLAC -> MP3 320k + OGG + AAC
        ffmpeg -i "$INPUT" -c:a libmp3lame -b:a 320k "$OUTPUT_DIR/${NAME}_320.mp3"
        ffmpeg -i "$INPUT" -c:a libvorbis -b:a 192k "$OUTPUT_DIR/${NAME}_192.ogg"
        ffmpeg -i "$INPUT" -c:a aac -b:a 256k "$OUTPUT_DIR/${NAME}_256.m4a"
        
        # Version lossless conservée
        cp "$INPUT" "$OUTPUT_DIR/${NAME}.flac" 2>/dev/null || \
        ffmpeg -i "$INPUT" -c:a flac "$OUTPUT_DIR/${NAME}.flac"
        ;;
    mp3)
        # Optimisation MP3 existant
        mp3gain -r "$INPUT"
        cp "$INPUT" "$OUTPUT_DIR/"
        
        # Version OGG pour compatibilité
        ffmpeg -i "$INPUT" -c:a libvorbis -b:a 192k "$OUTPUT_DIR/${NAME}.ogg"
        ;;
    m4a|aac)
        # Conversion vers formats ouverts
        ffmpeg -i "$INPUT" -c:a libmp3lame -b:a 320k "$OUTPUT_DIR/${NAME}.mp3"
        ffmpeg -i "$INPUT" -c:a libvorbis -b:a 192k "$OUTPUT_DIR/${NAME}.ogg"
        ;;
esac

# Extraction et optimisation des métadonnées
ffprobe -v quiet -print_format json -show_format -show_streams "$INPUT" > "$OUTPUT_DIR/${NAME}_metadata.json"

# Extraction de la pochette si présente
ffmpeg -i "$INPUT" -an -vcodec copy "$TEMP_DIR/${NAME}_cover.jpg" 2>/dev/null

# Génération de thumbnails optimisés
if [[ -f "$TEMP_DIR/${NAME}_cover.jpg" ]]; then
    # Version haute résolution
    convert "$TEMP_DIR/${NAME}_cover.jpg" -resize 1000x1000^ -quality 85 "$OUTPUT_DIR/${NAME}_cover_1000.jpg"
    # Version moyenne résolution
    convert "$TEMP_DIR/${NAME}_cover.jpg" -resize 500x500^ -quality 80 "$OUTPUT_DIR/${NAME}_cover_500.jpg"
    # Thumbnail
    convert "$TEMP_DIR/${NAME}_cover.jpg" -resize 150x150^ -quality 75 "$OUTPUT_DIR/${NAME}_thumb.jpg"
    # WebP pour navigateurs modernes
    convert "$TEMP_DIR/${NAME}_cover.jpg" -resize 500x500^ -quality 80 "$OUTPUT_DIR/${NAME}_cover_500.webp"
    
    rm "$TEMP_DIR/${NAME}_cover.jpg"
fi

echo "Conversion terminée: $NAME"
EOF
    
    sudo chmod +x /usr/local/bin/beartify-convert.sh
    
    # Script de traitement par lot
    sudo tee /usr/local/bin/beartify-batch-convert.sh > /dev/null <<'EOF'
#!/bin/bash

# Traitement par lot pour nouveaux fichiers
WATCH_DIR="/srv/media/temp/uploads"
AUDIO_OUT="/srv/media/audio"
VIDEO_OUT="/srv/media/video"

# Monitoring des nouveaux fichiers avec inotify
inotifywait -m -r -e close_write "$WATCH_DIR" |
while read path action file; do
    if [[ "$file" =~ \.(flac|wav|mp3|m4a|ape|wv|ogg)$ ]]; then
        echo "Traitement audio: $file"
        /usr/local/bin/beartify-convert.sh "$path$file" "$AUDIO_OUT/"
        mv "$path$file" "$AUDIO_OUT/processed/"
    elif [[ "$file" =~ \.(mp4|mkv|avi|mov|webm)$ ]]; then
        echo "Traitement vidéo: $file"
        # Conversion vidéo basique
        ffmpeg -i "$path$file" -c:v libx264 -crf 23 -c:a aac -b:a 128k "$VIDEO_OUT/${file%.*}.mp4"
        mv "$path$file" "$VIDEO_OUT/processed/"
    fi
done
EOF
    
    sudo chmod +x /usr/local/bin/beartify-batch-convert.sh
    
    # Service pour traitement automatique
    sudo tee /etc/systemd/system/beartify-converter.service > /dev/null <<EOF
[Unit]
Description=Beartify Media Converter
After=network.target

[Service]
Type=simple
User=$BEARTIFY_USER
Group=$BEARTIFY_USER
ExecStart=/usr/local/bin/beartify-batch-convert.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable beartify-converter
    
    log "Outils de conversion multimédia configurés"
}

# CONFIGURATION FINALE ET VÉRIFICATIONS

create_config_files() {
    log "Création des fichiers de configuration Beartify..."
    
    # Configuration principale application
    sudo -u "$BEARTIFY_USER" mkdir -p "$BEARTIFY_HOME/logs"
    sudo -u "$BEARTIFY_USER" tee "$BEARTIFY_HOME/application.yml" > /dev/null <<EOF
server:
  port: $APP_PORT
  compression:
    enabled: true
    mime-types: application/json,text/css,text/html,text/javascript,application/javascript
    min-response-size: 1024

spring:
  profiles:
    active: production
  
  datasource:
    url: jdbc:postgresql://localhost:5432/$DB_NAME
    username: $DB_USER
    password: $DB_PASS
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      idle-timeout: 300000
      max-lifetime: 1200000
  
  jpa:
    hibernate:
      ddl-auto: update
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        format_sql: false
        show_sql: false
  
  redis:
    host: localhost
    port: 6379
    timeout: 2000ms
    lettuce:
      pool:
        max-active: 10
        max-idle: 5
        min-idle: 1

beartify:
  media:
    root-path: $MEDIA_ROOT
    temp-path: $MEDIA_ROOT/temp
    cache-path: $MEDIA_ROOT/meta/cache
    
  streaming:
    buffer-size: 8192
    chunk-size: 1048576
    adaptive-bitrate: true
    
  upload:
    max-file-size: 500MB
    allowed-extensions: .mp3,.flac,.ogg,.m4a,.mp4,.webm,.jpg,.png,.webp
    auto-convert: true
    
  security:
    jwt-secret: $(openssl rand -base64 64)
    session-timeout: 7200
    
  performance:
    cache-ttl: 3600
    thumbnail-cache-size: 1000
    metadata-cache-size: 10000

logging:
  level:
    com.beartify: INFO
    org.springframework: WARN
  file:
    name: $BEARTIFY_HOME/logs/beartify.log
  pattern:
    file: "%d{ISO8601} [%thread] %-5level %logger{36} - %msg%n"
    console: "%d{HH:mm:ss} [%thread] %-5level %logger{36} - %msg%n"

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: always
EOF
    
    # Script de sauvegarde des configurations
    sudo -u "$BEARTIFY_USER" tee "$BEARTIFY_HOME/backup-config.sh" > /dev/null <<EOF
#!/bin/bash

BACKUP_DIR="$BACKUP_ROOT/config/\$(date +%Y%m%d_%H%M%S)"
mkdir -p "\$BACKUP_DIR"

# Sauvegarde configurations
cp -r $BEARTIFY_HOME/*.yml "\$BACKUP_DIR/" 2>/dev/null || true
cp -r /etc/nginx/sites-available/beartify "\$BACKUP_DIR/nginx-beartify.conf"
cp -r /etc/systemd/system/beartify.service "\$BACKUP_DIR/"

# Export base de données
sudo -u postgres pg_dump $DB_NAME > "\$BACKUP_DIR/database.sql"

# Compression
tar -czf "$BACKUP_ROOT/config/config_backup_\$(date +%Y%m%d_%H%M%S).tar.gz" -C "$BACKUP_ROOT/config" "\$(basename \$BACKUP_DIR)"
rm -rf "\$BACKUP_DIR"

echo "Sauvegarde de configuration créée: config_backup_\$(date +%Y%m%d_%H%M%S).tar.gz"
EOF
    
    sudo chmod +x "$BEARTIFY_HOME/backup-config.sh"
    
    log "Fichiers de configuration créés"
}

optimize_system() {
    log "Application des optimisations système..."
    
    # Limites système pour haute charge
    sudo tee /etc/security/limits.conf > /dev/null <<EOF
# === BEARTIFY OPTIMIZATIONS ===
* soft nofile 65536
* hard nofile 65536
* soft nproc 4096
* hard nproc 4096
$BEARTIFY_USER soft nofile 65536
$BEARTIFY_USER hard nofile 65536
EOF
    
    # Paramètres kernel pour performance réseau
    sudo tee /etc/sysctl.d/99-beartify.conf > /dev/null <<EOF
# === BEARTIFY NETWORK OPTIMIZATIONS ===
# TCP/IP Stack
net.core.somaxconn = 32768
net.core.netdev_max_backlog = 5000
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 65536 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1

# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288

# Virtual Memory
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF
    
    # Application immédiate
    sudo sysctl -p /etc/sysctl.d/99-beartify.conf
    
    # Optimisation des montages pour médias
    sudo tee -a /etc/fstab > /dev/null <<EOF
# Beartify optimizations
tmpfs /tmp tmpfs defaults,noatime,mode=1777,size=2G 0 0
EOF
    
    # Configuration logrotate pour éviter la saturation
    sudo tee /etc/logrotate.d/beartify > /dev/null <<EOF
$BEARTIFY_HOME/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER $BEARTIFY_USER
    postrotate
        systemctl reload beartify || true
    endscript
}

/srv/media/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER $BEARTIFY_USER
}
EOF
    
    log "Optimisations système appliquées"
}

setup_sample_app() {
    log "Création d'une application de démo..."
    
    # Application Java basique pour test
    sudo -u "$BEARTIFY_USER" tee "$BEARTIFY_HOME/BeartifyDemo.java" > /dev/null <<'EOF'
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class BeartifyDemo {
    private static final int PORT = 8080;
    
    public static void main(String[] args) {
        System.out.println("🎵 Démarrage de Beartify Demo Server sur le port " + PORT);
        
        try {
            ServerSocket server = new ServerSocket(PORT);
            ExecutorService executor = Executors.newFixedThreadPool(10);
            
            System.out.println("✅ Serveur prêt ! http://localhost:" + PORT);
            
            while (true) {
                Socket client = server.accept();
                executor.submit(() -> handleRequest(client));
            }
        } catch (IOException e) {
            System.err.println("❌ Erreur serveur: " + e.getMessage());
        }
    }
    
    private static void handleRequest(Socket client) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream()));
             PrintWriter out = new PrintWriter(client.getOutputStream(), true)) {
            
            String requestLine = in.readLine();
            System.out.println("📡 Requête: " + requestLine);
            
            // Headers de base
            out.println("HTTP/1.1 200 OK");
            out.println("Content-Type: text/html; charset=UTF-8");
            out.println("Access-Control-Allow-Origin: *");
            out.println("");
            
            // Page d'accueil Beartify
            out.println(getHomePage());
            
        } catch (IOException e) {
            System.err.println("❌ Erreur requête: " + e.getMessage());
        } finally {
            try {
                client.close();
            } catch (IOException e) {
                // Ignore
            }
        }
    }
    
    private static String getHomePage() {
        return """
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>🎵 Beartify - Demo</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; height: 100vh; display: flex; align-items: center; justify-content: center;
                }
                .container { text-align: center; padding: 2rem; }
                h1 { font-size: 4rem; margin-bottom: 1rem; }
                .subtitle { font-size: 1.5rem; margin-bottom: 2rem; opacity: 0.9; }
                .status { background: rgba(255,255,255,0.2); padding: 1rem; border-radius: 10px; margin: 1rem 0; }
                .feature { margin: 0.5rem 0; font-size: 1.1rem; }
                .emoji { font-size: 1.5em; }
                .footer { margin-top: 2rem; font-size: 0.9rem; opacity: 0.7; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎵 Beartify</h1>
                <div class="subtitle">Votre serveur de streaming musical personnel</div>
                
                <div class="status">
                    <div class="feature"><span class="emoji">✅</span> Serveur démarré avec succès</div>
                    <div class="feature"><span class="emoji">🚀</span> Port 8080 actif</div>
                    <div class="feature"><span class="emoji">🔐</span> Sécurité configurée</div>
                    <div class="feature"><span class="emoji">💾</span> Base de données connectée</div>
                    <div class="feature"><span class="emoji">📁</span> Stockage multimédia prêt</div>
                </div>
                
                <div class="status">
                    <h3>🎯 Prochaines étapes:</h3>
                    <div class="feature">1. Remplacez ce serveur de démo par votre application Java</div>
                    <div class="feature">2. Uploadez vos fichiers musicaux dans /srv/media/</div>
                    <div class="feature">3. Configurez vos utilisateurs et playlists</div>
                    <div class="feature">4. Profitez de votre Spotify personnel ! 🎉</div>
                </div>
                
                <div class="footer">
                    Installation automatique Beartify - """ + new Date() + """
                </div>
            </div>
            
            <script>
                console.log('🎵 Beartify Demo Server - Ready!');
                // Auto-refresh toutes les 30 secondes pour vérifier l'état
                setTimeout(() => location.reload(), 30000);
            </script>
        </body>
        </html>
        """;
    }
}
EOF
    
    # Compilation et création du JAR
    sudo -u "$BEARTIFY_USER" javac -d "$BEARTIFY_HOME" "$BEARTIFY_HOME/BeartifyDemo.java"
    sudo -u "$BEARTIFY_USER" bash -c "cd '$BEARTIFY_HOME' && jar cfe beartify.jar BeartifyDemo BeartifyDemo.class"
    
    log "Application de démo créée"
}

main() {
    welcome_banner
    check_root
    get_user_preferences
    
    log "🚀 Début de l'installation Beartify..."
    
    # Installation système de base
    update_system
    install_essential_tools
    create_beartify_user
    
    # Sécurité
    setup_firewall
    setup_fail2ban
    
    # Interface graphique
    install_gui
    
    # Stockage et sauvegarde
    setup_media_storage
    setup_backup_system
    
    # Base de données
    case $DB_CHOICE in
        1) install_postgresql ;;
        2) install_mariadb ;;
        3) setup_sqlite ;;
    esac
    
    # Environnement Java
    install_java_environment
    create_systemd_service
    
    # Reverse proxy et SSL
    install_nginx
    
    # Services de cache
    install_redis
    install_memcached
    
    # Monitoring optionnel
    install_monitoring
    
    # Stockage objet optionnel
    install_minio
    
    # Optimisations avancées
    optimize_system
    setup_media_tools
    
    # Configuration finale
    create_config_files
    setup_sample_app
    
    # Démarrage des services
    log "🎬 Démarrage des services Beartify..."
    sudo systemctl start beartify
    sudo systemctl start beartify-converter
    
    # Audit final
    perform_security_audit
    
    # Résumé final
    log "🎉 Installation terminée ! Accédez à votre serveur Beartify sur http://${DOMAIN:-localhost}:${APP_PORT}"
    log "🎬 Démarrage des services Beartify..."
    sudo systemctl start beartify
    sudo systemctl start beartify-converter
    
    # Audit final
    perform_security_audit
    
    # Résumé final
    show_installation_summary
}

