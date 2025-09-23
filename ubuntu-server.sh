#!/bin/bash

# Script d'Installation Ubuntu Serveur pour Streaming Multimédia avec Beartify
# Version: 3.0
# Description: Installation automatisée d'un serveur streaming optimisé pour Beartify
# Compatible: Ubuntu Server 20.04+, Debian 11+

set -euo pipefail

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Variables globales
SCRIPT_VERSION="3.0"
LOG_FILE="/tmp/ubuntu_beartify_install_$(date +%Y%m%d_%H%M%S).log"
BEARTIFY_USER="beartify"
BEARTIFY_HOME="/home/$BEARTIFY_USER"
MEDIA_ROOT="/srv/media"
BACKUP_ROOT="/srv/backup"
APP_PORT="8080"
DB_NAME="beartifydb"
DB_USER="beartifyuser"
DB_PASS=""
DOMAIN=""
EMAIL=""
GUI_CHOICE=""
DB_CHOICE=""
INSTALL_MONITORING=""
INSTALL_MINIO=""
INSTALL_TYPE=""

# Fonctions utilitaires
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "${RED}ERREUR: $1${NC}"
    exit 1
}

success() {
    log "${GREEN}✅ $1${NC}"
}

warning() {
    log "${YELLOW}⚠️ $1${NC}"
}

info() {
    log "${BLUE}ℹ️ $1${NC}"
}

print_header() {
    clear
    echo -e "${PURPLE}"
    echo "╔═══════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    🎵 BEARTIFY UBUNTU SERVER INSTALLER v$SCRIPT_VERSION                  ║"
    echo "║                  Installation Serveur Streaming Multimédia                       ║"
    echo "╚═══════════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Vérification des privilèges root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error_exit "Ce script doit être exécuté avec les privilèges root. Utilisez 'sudo $0'"
    fi
    success "Privilèges root confirmés"
}

# Détection de la distribution
detect_distro() {
    info "Détection de la distribution..."
    
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        if [[ "$ID" == "ubuntu" ]] || [[ "$ID" == "debian" ]]; then
            success "Distribution compatible détectée: $PRETTY_NAME"
        else
            warning "Distribution non testée: $PRETTY_NAME. Le script peut ne pas fonctionner correctement."
        fi
    else
        error_exit "Impossible de détecter la distribution"
    fi
}

# Menu principal
show_main_menu() {
    print_header
    echo -e "${CYAN}=== MENU D'INSTALLATION PRINCIPAL ===${NC}"
    echo
    echo "Choisissez le type d'installation :"
    echo
    echo -e "${YELLOW}1.${NC} Installation complète Beartify (serveur streaming multimédia)"
    echo -e "${YELLOW}2.${NC} Installation de services individuels"
    echo
    echo -e "${RED}0.${NC} Quitter"
    echo
}

# Menu des services individuels
show_services_menu() {
    print_header
    echo -e "${CYAN}=== SERVICES DISPONIBLES ===${NC}"
    echo
    echo -e "${YELLOW}Services Web et Proxy:${NC}"
    echo "  1.  DHCP Server (isc-dhcp-server)"
    echo "  2.  DNS Server (Bind9)"
    echo "  3.  FTP Server (vsftpd)"
    echo "  4.  SFTP Server (OpenSSH)"
    echo "  5.  HTTP Server (Apache2)"
    echo "  6.  HTTPS/Reverse Proxy (Nginx)"
    echo "  7.  Mail Server (Postfix + Dovecot)"
    echo "  8.  Proxy Server (Squid)"
    echo
    echo -e "${YELLOW}Bases de données:${NC}"
    echo "  9.  MySQL/MariaDB"
    echo "  10. PostgreSQL"
    echo "  11. Redis (Cache)"
    echo "  12. MongoDB"
    echo
    echo -e "${YELLOW}Services de partage et stockage:${NC}"
    echo "  13. NFS Server"
    echo "  14. Samba Server (SMB)"
    echo "  15. Nextcloud"
    echo "  16. MinIO (Stockage objet)"
    echo
    echo -e "${YELLOW}Développement et CI/CD:${NC}"
    echo "  17. Docker + Docker Compose"
    echo "  18. Git Server (Gitea)"
    echo "  19. Jenkins CI/CD"
    echo "  20. Node.js + NPM"
    echo "  21. PHP-FPM"
    echo "  22. Java (OpenJDK) + Tomcat"
    echo
    echo -e "${YELLOW}Monitoring et Logs:${NC}"
    echo "  23. Prometheus + Grafana"
    echo "  24. ELK Stack"
    echo "  25. Zabbix"
    echo
    echo -e "${YELLOW}Services spécialisés:${NC}"
    echo "  26. MQTT Broker (Mosquitto configuré)"
    echo "  27. Media Server (Jellyfin configuré)"
    echo "  28. VPN (WireGuard complet)"
    echo "  29. Environnement Desktop (KDE/GNOME/XFCE)"
    echo "  30. Serveur de jeux (Minecraft/CS/Terraria)"
    echo
    echo -e "${RED}0. Retour au menu principal${NC}"
    echo
}

# Configuration utilisateur pour Beartify
get_beartify_config() {
    echo -e "${CYAN}=== CONFIGURATION BEARTIFY ===${NC}"
    echo
    
    # Interface graphique
    echo "Choisissez votre interface graphique :"
    echo "1) KDE Plasma (avec thèmes personnalisés)"
    echo "2) GNOME (interface moderne)"
    echo "3) Aucune (mode serveur uniquement)"
    read -p "Votre choix [1-3] (défaut: 3): " GUI_CHOICE
    GUI_CHOICE=${GUI_CHOICE:-3}
    
    # Domaine et SSL
    echo
    read -p "Nom de domaine (optionnel, ex: music.mondomaine.com): " DOMAIN
    if [[ -n "$DOMAIN" ]]; then
        read -p "Email pour Let's Encrypt: " EMAIL
    fi
    
    # Base de données
    echo
    echo "Choisissez votre base de données :"
    echo "1) MariaDB (recommandé pour streaming)"
    echo "2) PostgreSQL (haute performance)"
    echo "3) MySQL"
    read -p "Votre choix [1-3] (défaut: 1): " DB_CHOICE
    DB_CHOICE=${DB_CHOICE:-1}
    
    # Services optionnels
    echo
    read -p "Installer le monitoring (Prometheus + Grafana) ? [y/N]: " INSTALL_MONITORING
    read -p "Installer MinIO pour stockage objet ? [y/N]: " INSTALL_MINIO
    
    # Génération du mot de passe DB
    DB_PASS=$(openssl rand -base64 32)
    
    echo
    success "Configuration terminée!"
}

# Mise à jour du système
update_system() {
    info "Mise à jour complète du système..."
    
    export DEBIAN_FRONTEND=noninteractive
    
    apt update -qq
    apt upgrade -y -qq
    apt autoremove -y -qq
    apt autoclean -qq
    
    success "Système mis à jour"
}

# Installation des outils essentiels
install_essential_tools() {
    info "Installation des outils essentiels..."
    
    local essential_packages=(
        # Outils de base
        curl wget git unzip zip p7zip-full
        htop iotop nethogs tree ncdu
        net-tools dnsutils telnet
        software-properties-common
        apt-transport-https ca-certificates gnupg lsb-release
        
        # Compilation et développement
        build-essential make cmake
        
        # Outils système
        ufw fail2ban
        systemd-timesyncd
        logrotate rsyslog
        
        # Performance et monitoring
        iperf3 stress sysstat atop
        
        # Outils multimédia pour streaming
        ffmpeg imagemagick
        flac lame opus-tools vorbis-tools
        sox mediainfo exiftool
        
        # Outils réseau avancés
        nginx-light
        certbot python3-certbot-nginx
    )
    
    apt install -y "${essential_packages[@]}"
    
    success "Outils essentiels installés"
}

# Configuration du pare-feu pour streaming
setup_streaming_firewall() {
    info "Configuration du pare-feu pour streaming multimédia..."
    
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    
    # Ports essentiels
    ufw allow 22/tcp comment "SSH"
    ufw allow 80/tcp comment "HTTP"
    ufw allow 443/tcp comment "HTTPS"
    ufw allow $APP_PORT/tcp comment "Beartify App"
    
    # Ports pour streaming
    ufw allow 1935/tcp comment "RTMP Streaming"
    ufw allow 8000:8999/tcp comment "Streaming Ports Range"
    
    # Ports pour WebRTC si nécessaire
    ufw allow 3478/udp comment "WebRTC STUN"
    ufw allow 10000:20000/udp comment "WebRTC Media"
    
    # Services optionnels
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        ufw allow 3000/tcp comment "Grafana"
        ufw allow 9090/tcp comment "Prometheus"
    fi
    
    if [[ "$INSTALL_MINIO" =~ ^[Yy] ]]; then
        ufw allow 9000/tcp comment "MinIO API"
        ufw allow 9001/tcp comment "MinIO Console"
    fi
    
    ufw --force enable
    success "Pare-feu configuré pour streaming"
}

# Configuration Fail2ban optimisée
setup_fail2ban() {
    info "Configuration avancée de Fail2ban..."
    
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd
ignoreip = 127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s
maxretry = 3

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 3

[nginx-badbots]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2

[nginx-botsearch]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

    systemctl enable fail2ban
    systemctl restart fail2ban
    
    success "Fail2ban configuré"
}

# Installation et configuration de l'interface graphique
install_gui() {
    case $GUI_CHOICE in
        1)
            info "Installation de KDE Plasma avec thèmes personnalisés..."
            
            # Installation KDE
            apt install -y kde-plasma-desktop sddm sddm-theme-*
            
            # Configuration SDDM avec thème personnalisé
            configure_sddm_custom
            
            # Configuration Plymouth
            configure_plymouth_custom
            
            systemctl set-default graphical.target
            systemctl enable sddm
            
            success "KDE Plasma installé avec thèmes personnalisés"
            ;;
        2)
            info "Installation de GNOME..."
            apt install -y ubuntu-desktop-minimal gdm3
            systemctl set-default graphical.target
            systemctl enable gdm3
            success "GNOME installé"
            ;;
        3)
            info "Mode serveur - aucune interface graphique"
            systemctl set-default multi-user.target
            ;;
    esac
}

# Configuration SDDM personnalisée (adaptée d'Arch Linux)
configure_sddm_custom() {
    if [[ "$GUI_CHOICE" != "1" ]]; then
        return 0
    fi
    
    info "Configuration SDDM avec thème personnalisé..."
    
    local theme_dir="/usr/share/sddm/themes/beartify-fallout"
    local temp_dir="/tmp/beartify-theme"
    
    # Création du répertoire du thème
    mkdir -p "$theme_dir"
    mkdir -p "$temp_dir"
    
    # Téléchargement des ressources (si disponibles)
    if curl -fsSL "https://github.com/PapaOursPolaire/arch/archive/refs/heads/Projets.zip" -o "$temp_dir/theme.zip" 2>/dev/null; then
        cd "$temp_dir"
        unzip -q theme.zip
        if [[ -d "arch-Projets/SDDM-Fallout-theme" ]]; then
            cp -r arch-Projets/SDDM-Fallout-theme/* "$theme_dir/"
        fi
    fi
    
    # Création d'un thème par défaut si téléchargement échoue
    if [[ ! -f "$theme_dir/Main.qml" ]]; then
        cat > "$theme_dir/Main.qml" << 'EOF'
import QtQuick 2.15
import QtQuick.Controls 2.15
import SddmComponents 2.0

Rectangle {
    width: 1920
    height: 1080
    
    // Fond dégradé
    gradient: Gradient {
        GradientStop { position: 0.0; color: "#001122" }
        GradientStop { position: 1.0; color: "#003366" }
    }
    
    // Logo Beartify
    Text {
        id: logo
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: 100
        text: "🎵 BEARTIFY SERVER"
        color: "#00ff88"
        font.pixelSize: 48
        font.bold: true
    }
    
    // Zone de connexion
    Rectangle {
        id: loginArea
        width: 400
        height: 200
        anchors.centerIn: parent
        color: "transparent"
        border.color: "#00ff88"
        border.width: 2
        radius: 20
        
        Column {
            anchors.centerIn: parent
            spacing: 20
            
            Text {
                text: "Utilisateur:"
                color: "white"
                font.pixelSize: 16
            }
            
            TextField {
                id: userField
                width: 300
                height: 40
                placeholderText: "Nom d'utilisateur"
                color: "white"
                background: Rectangle {
                    color: "transparent"
                    border.color: "#00ff88"
                    border.width: 1
                    radius: 5
                }
                text: userModel.lastUser
            }
            
            Text {
                text: "Mot de passe:"
                color: "white"
                font.pixelSize: 16
            }
            
            TextField {
                id: passwordField
                width: 300
                height: 40
                placeholderText: "Mot de passe"
                echoMode: TextInput.Password
                color: "white"
                background: Rectangle {
                    color: "transparent"
                    border.color: "#00ff88"
                    border.width: 1
                    radius: 5
                }
                
                Keys.onPressed: {
                    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        sddm.login(userField.text, passwordField.text, sessionModel.lastIndex)
                        event.accepted = true
                    }
                }
            }
            
            Button {
                text: "Connexion"
                width: 300
                height: 40
                background: Rectangle {
                    color: "#00ff88"
                    radius: 5
                }
                
                onClicked: {
                    sddm.login(userField.text, passwordField.text, sessionModel.lastIndex)
                }
            }
        }
    }
    
    // Informations système en bas
    Text {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 30
        text: "Beartify Streaming Server - " + Qt.formatDateTime(new Date(), "dd/MM/yyyy hh:mm")
        color: "#888888"
        font.pixelSize: 14
    }
    
    Component.onCompleted: {
        if (userField.text === "") {
            userField.focus = true
        } else {
            passwordField.focus = true
        }
    }
}
EOF
        
        # Fichier de métadonnées du thème
        cat > "$theme_dir/metadata.desktop" << 'EOF'
[SddmGreeterTheme]
Name=Beartify Fallout
Description=Thème Beartify pour serveur de streaming
Author=PapaOursPolaire
Copyright=GPL v3
License=GPL v3
Type=sddm-theme
Version=1.0
Website=https://github.com/PapaOursPolaire
MainScript=Main.qml
ConfigFile=theme.conf
TranslationsDirectory=translations
Theme-Id=beartify-fallout
Theme-API=2.0
EOF
    fi
    
    # Configuration SDDM
    cat > /etc/sddm.conf << EOF
[Theme]
Current=beartify-fallout
CursorTheme=breeze_cursors
Font=Ubuntu

[General]
DisplayServer=x11
Numlock=on

[Autologin]
Relogin=false
Session=plasma
User=

[Users]
MaximumUid=60513
MinimumUid=1000
EOF
    
    success "SDDM configuré avec thème Beartify"
}

# Configuration Plymouth personnalisée (adaptée d'Arch Linux)
configure_plymouth_custom() {
    if [[ "$GUI_CHOICE" != "1" ]]; then
        return 0
    fi
    
    info "Configuration Plymouth avec thème personnalisé..."
    
    # Installation Plymouth
    apt install -y plymouth plymouth-themes
    
    local theme_dir="/usr/share/plymouth/themes/beartify"
    mkdir -p "$theme_dir"
    
    # Téléchargement du thème si disponible
    local temp_dir="/tmp/plymouth-theme"
    mkdir -p "$temp_dir"
    
    if curl -fsSL "https://raw.githubusercontent.com/PapaOursPolaire/arch/Projets/arch-mac-style.zip" -o "$temp_dir/plymouth.zip" 2>/dev/null; then
        cd "$temp_dir"
        unzip -q plymouth.zip -d "$theme_dir"
    fi
    
    # Création d'un thème par défaut si téléchargement échoue
    if [[ ! -f "$theme_dir/beartify.plymouth" ]]; then
        # Création du script Plymouth
        cat > "$theme_dir/beartify.script" << 'EOF'
# Thème Plymouth Beartify
Window.SetBackgroundTopColor(0.00, 0.17, 0.33);
Window.SetBackgroundBottomColor(0.00, 0.05, 0.15);

# Logo Beartify
logo.image = Image.Text("🎵 BEARTIFY", 1, 1, 1);
logo.sprite = Sprite(logo.image);
logo.sprite.SetPosition(Window.GetWidth() / 2 - logo.image.GetWidth() / 2, 200);

# Texte de chargement
loading_text = Image.Text("Démarrage du serveur streaming...", 0.8, 0.8, 0.8);
loading_sprite = Sprite(loading_text);
loading_sprite.SetPosition(Window.GetWidth() / 2 - loading_text.GetWidth() / 2, 300);

# Animation de points
dots = 0;
fun animate_dots() {
    dots = (dots + 1) % 4;
    dot_text = "";
    for (i = 0; i < dots; i++) {
        dot_text += ".";
    }
    
    status_text = Image.Text("Chargement" + dot_text, 0.6, 0.8, 0.6);
    status_sprite.SetImage(status_text);
    status_sprite.SetPosition(Window.GetWidth() / 2 - status_text.GetWidth() / 2, 400);
}

status_sprite = Sprite();
Plymouth.SetRefreshFunction(animate_dots);

# Messages de démarrage
Plymouth.SetMessageFunction(
    fun (text) {
        my_image = Image.Text(text, 0.6, 0.6, 0.6);
        message_sprite.SetImage(my_image);
        message_sprite.SetPosition(Window.GetWidth() / 2 - my_image.GetWidth() / 2, 500);
    }
);
message_sprite = Sprite();

# Barre de progression
progress_box.image = Image("progress_box.png");
progress_box.sprite = Sprite(progress_box.image);
progress_box.sprite.SetPosition(Window.GetWidth() / 2 - progress_box.image.GetWidth() / 2, 550);

Plymouth.SetBootProgressFunction(
    fun (duration, progress) {
        if (progress_bar.image.GetWidth() != Math.Int(progress * progress_box.image.GetWidth())) {
            progress_bar.image = Image.Scale(progress_box.image, Math.Int(progress * progress_box.image.GetWidth()), progress_box.image.GetHeight());
            progress_bar.sprite.SetImage(progress_bar.image);
        }
    }
);
progress_bar.sprite = Sprite();
progress_bar.sprite.SetPosition(Window.GetWidth() / 2 - progress_box.image.GetWidth() / 2, 550);
EOF
        
        # Fichier de configuration Plymouth
        cat > "$theme_dir/beartify.plymouth" << 'EOF'
[Plymouth Theme]
Name=Beartify
Description=Thème de démarrage Beartify pour serveur streaming
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/beartify
ScriptFile=/usr/share/plymouth/themes/beartify/beartify.script
EOF
        
        # Images par défaut (création d'images simples)
        convert -size 400x20 xc:"#003366" "$theme_dir/progress_box.png" 2>/dev/null || touch "$theme_dir/progress_box.png"
    fi
    
    # Installation du thème
    plymouth-set-default-theme beartify
    update-initramfs -u
    
    success "Plymouth configuré avec thème Beartify"
}

# Création de l'utilisateur Beartify
create_beartify_user() {
    info "Création de l'utilisateur système Beartify..."
    
    if ! id "$BEARTIFY_USER" &>/dev/null; then
        useradd -m -s /bin/bash -G audio,video,www-data "$BEARTIFY_USER"
        
        # Création des répertoires
        sudo -u "$BEARTIFY_USER" mkdir -p "$BEARTIFY_HOME"/{config,logs,temp}
        
        success "Utilisateur $BEARTIFY_USER créé"
    else
        success "Utilisateur $BEARTIFY_USER existe déjà"
    fi
}

# Configuration du stockage multimédia optimisé
setup_streaming_storage() {
    info "Configuration du stockage multimédia pour streaming..."
    
    # Structure optimisée pour streaming haute performance
    mkdir -p \
        "$MEDIA_ROOT"/{audio,video,images,lyrics,metadata,cache,temp,processed} \
        "$MEDIA_ROOT"/audio/{mp3,flac,ogg,m4a,wav} \
        "$MEDIA_ROOT"/video/{mp4,webm,hls,dash} \
        "$MEDIA_ROOT"/images/{covers,thumbnails,artwork} \
        "$MEDIA_ROOT"/cache/{audio,video,metadata} \
        "$BACKUP_ROOT"/{daily,weekly,config}
    
    # Permissions optimisées pour streaming
    chown -R "$BEARTIFY_USER":www-data "$MEDIA_ROOT"
    chmod -R 755 "$MEDIA_ROOT"
    chmod -R 775 "$MEDIA_ROOT"/{temp,cache,processed}
    
    # Configuration des montages optimisés pour performance
    if ! grep -q "$MEDIA_ROOT" /etc/fstab; then
        echo "# Optimisations Beartify streaming" >> /etc/fstab
        echo "tmpfs $MEDIA_ROOT/cache tmpfs defaults,noatime,size=2G,uid=$(id -u $BEARTIFY_USER),gid=$(id -g www-data),mode=1775 0 0" >> /etc/fstab
    fi
    
    # Configuration logrotate pour les logs de streaming
    cat > /etc/logrotate.d/beartify << EOF
$BEARTIFY_HOME/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER $BEARTIFY_USER
    postrotate
        systemctl reload beartify 2>/dev/null || true
    endscript
}

$MEDIA_ROOT/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER www-data
}
EOF
    
    success "Stockage multimédia configuré pour streaming haute performance"
}

# Installation des bases de données optimisées pour streaming
install_database() {
    case $DB_CHOICE in
        1)
            info "Installation de MariaDB optimisée pour streaming..."
            
            apt install -y mariadb-server mariadb-client
            
            # Configuration optimisée pour streaming multimédia
            cat > /etc/mysql/mariadb.conf.d/99-beartify-streaming.cnf << EOF
[mysqld]
# Optimisations pour streaming multimédia
innodb_buffer_pool_size = 2G
innodb_log_file_size = 512M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
innodb_read_io_threads = 8
innodb_write_io_threads = 8

# Cache et performance
query_cache_size = 512M
query_cache_type = 1
key_buffer_size = 512M
sort_buffer_size = 4M
read_buffer_size = 2M
read_rnd_buffer_size = 8M

# Connexions pour streaming simultané
max_connections = 500
max_user_connections = 450

# Support pour fichiers binaires volumineux (audio/video)
max_allowed_packet = 1G
tmp_table_size = 512M
max_heap_table_size = 512M

# Optimisations réseau pour streaming
net_buffer_length = 32K
net_read_timeout = 120
net_write_timeout = 120
EOF
            
            systemctl restart mariadb
            
            # Création base et utilisateur
            mysql -e "CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" || true
            mysql -e "CREATE USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';" || true
            mysql -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';" || true
            mysql -e "FLUSH PRIVILEGES;" || true
            
            success "MariaDB configurée pour streaming"
            ;;
        2)
            info "Installation de PostgreSQL optimisée pour streaming..."
            
            apt install -y postgresql postgresql-contrib
            
            # Configuration optimisée
            local pg_version=$(ls /etc/postgresql/ | sort -V | tail -n 1)
            local pg_config="/etc/postgresql/$pg_version/main/postgresql.conf"
            
            cat >> "$pg_config" << EOF

# Optimisations Beartify Streaming
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 256MB
maintenance_work_mem = 1GB

# Performance streaming
checkpoint_completion_target = 0.9
wal_buffers = 64MB
default_statistics_target = 100

# Connexions simultanées
max_connections = 400
EOF
            
            systemctl restart postgresql
            
            # Création base et utilisateur
            sudo -u postgres createuser "$DB_USER" || true
            sudo -u postgres createdb -O "$DB_USER" "$DB_NAME" || true
            sudo -u postgres psql -c "ALTER USER $DB_USER PASSWORD '$DB_PASS';" || true
            
            success "PostgreSQL configuré pour streaming"
            ;;
        3)
            info "Installation de MySQL..."
            apt install -y mysql-server mysql-client
            # Configuration similaire à MariaDB...
            success "MySQL installé"
            ;;
    esac
}

# Installation environnement Java optimisé pour Beartify
install_java_environment() {
    info "Installation environnement Java optimisé pour Beartify..."
    
    # Installation OpenJDK 17 (LTS)
    apt install -y openjdk-17-jdk openjdk-17-jre
    
    # Maven et Gradle pour builds
    apt install -y maven
    
    # Installation Gradle dernière version
    local gradle_version="8.4"
    wget -q "https://services.gradle.org/distributions/gradle-${gradle_version}-bin.zip" -O /tmp/gradle.zip
    unzip -d /opt /tmp/gradle.zip
    ln -sf "/opt/gradle-${gradle_version}/bin/gradle" /usr/local/bin/gradle
    rm /tmp/gradle.zip
    
    # Configuration des variables d'environnement Java
    cat > /etc/environment << EOF
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
BEARTIFY_HOME=$BEARTIFY_HOME
MEDIA_ROOT=$MEDIA_ROOT
PATH=\$PATH:\$JAVA_HOME/bin
EOF
    
    # Configuration JVM optimisée pour streaming
    mkdir -p "$BEARTIFY_HOME/config"
    cat > "$BEARTIFY_HOME/config/jvm.conf" << EOF
# JVM Options pour Beartify Streaming Server
-Xms2g
-Xmx4g
-XX:+UseG1GC
-XX:+UseStringDeduplication
-XX:+OptimizeStringConcat
-XX:+UseCompressedOops
-XX:MaxGCPauseMillis=200
-XX:G1HeapRegionSize=16m
-XX:+UnlockExperimentalVMOptions
-XX:+UseZGC
-Dfile.encoding=UTF-8
-Dspring.profiles.active=production
EOF
    
    success "Environnement Java optimisé pour Beartify installé"
}

# Installation des outils de développement
install_development() {
    info "Installation de l'environnement de développement complet..."
    
    # Langages de programmation
    local dev_packages=(
        # Python stack complet
        python3 python3-pip python3-venv python3-dev
        python3-setuptools python3-wheel
        
        # Node.js et npm
        nodejs npm
        
        # Outils de build et compilation
        build-essential cmake make
        gcc g++ clang
        gdb valgrind
        
        # Version control et outils
        git git-lfs
        subversion mercurial
        
        # Outils de packaging
        dpkg-dev fakeroot
        
        # Libraries de développement
        libssl-dev libffi-dev
        libbz2-dev libreadline-dev libsqlite3-dev
        libncurses5-dev libncursesw5-dev
        liblzma-dev tk-dev
        
        # Outils réseau et debug
        wireshark-common tcpdump
        strace ltrace
    )
    
    apt install -y "${dev_packages[@]}"
    
    # Installation de la dernière version de Node.js via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt install -y nodejs
    
    # Installation d'outils npm globaux
    npm install -g pm2 nodemon typescript ts-node
    
    # Configuration Git globale pour le serveur
    git config --system user.name "Beartify Server"
    git config --system user.email "server@beartify.local"
    git config --system init.defaultBranch main
    
    success "Environnement de développement installé"
}

# Installation Docker optimisé pour streaming
install_docker() {
    info "Installation Docker optimisé pour applications streaming..."
    
    # Installation des dépendances
    apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
    
    # Ajout du repository Docker officiel
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt update
    apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Configuration Docker pour streaming
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << EOF
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
    "storage-driver": "overlay2",
    "storage-opts": ["overlay2.override_kernel_check=true"],
    "default-ulimits": {
        "memlock": {"name": "memlock", "soft": -1, "hard": -1},
        "nofile": {"name": "nofile", "soft": 65536, "hard": 65536}
    },
    "dns": ["8.8.8.8", "8.8.4.4"],
    "max-concurrent-downloads": 10,
    "max-concurrent-uploads": 5
}
EOF
    
    # Ajout utilisateur au groupe docker
    usermod -aG docker "$BEARTIFY_USER"
    
    systemctl enable docker
    systemctl start docker
    
    success "Docker installé et optimisé"
}

# Installation et configuration Nginx pour streaming
install_nginx_streaming() {
    info "Installation Nginx optimisé pour streaming multimédia..."
    
    # Installation avec modules additionnels
    apt install -y nginx-full nginx-extras
    
    # Configuration Nginx optimisée pour streaming haute performance
    cat > /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes auto;
worker_rlimit_nofile 65535;
pid /run/nginx.pid;

# Modules additionnels
load_module modules/ngx_rtmp_module.so;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
    accept_mutex off;
}

http {
    # Performance
    sendfile on;
    sendfile_max_chunk 512k;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 120s;
    keepalive_requests 10000;
    reset_timedout_connection on;
    
    # Gestion de la mémoire
    client_body_buffer_size 10m;
    client_max_body_size 2g;
    client_header_buffer_size 4k;
    large_client_header_buffers 4 8k;
    
    # Types MIME
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Types MIME additionnels pour streaming
    location ~* \.(mp3|mp4|m4a|flac|ogg|webm|wav|aac)$ {
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=31536000";
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
        add_header Access-Control-Allow-Headers "Range";
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range";
    }
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_comp_level 6;
    gzip_types
        application/json
        application/javascript
        application/xml+rss
        application/xml
        image/svg+xml
        text/css
        text/javascript
        text/plain
        text/xml;
    
    # Rate limiting pour protection
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=streaming:10m rate=100r/s;
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    
    # Logging
    log_format streaming '$remote_addr - $remote_user [$time_local] '
                        '"$request" $status $body_bytes_sent '
                        '"$http_referer" "$http_user_agent" '
                        'rt=$request_time ut="$upstream_response_time" '
                        'cs=$upstream_cache_status';
    
    access_log /var/log/nginx/access.log streaming buffer=32k flush=5s;
    error_log /var/log/nginx/error.log warn;
    
    # Cache pour contenu statique
    proxy_cache_path /var/cache/nginx/streaming levels=1:2 keys_zone=streaming:100m 
                     max_size=10g inactive=60m use_temp_path=off;
    
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}

# Configuration RTMP pour streaming en direct
rtmp {
    server {
        listen 1935;
        chunk_size 4096;
        
        application live {
            live on;
            record off;
            
            # HLS
            hls on;
            hls_path /var/www/hls;
            hls_fragment 3;
            hls_playlist_length 60;
            
            # DASH
            dash on;
            dash_path /var/www/dash;
            dash_fragment 3;
            dash_playlist_length 60;
        }
    }
}
EOF
    
    # Configuration du site Beartify
    cat > /etc/nginx/sites-available/beartify << EOF
# Configuration Beartify Streaming Server
upstream beartify_app {
    server 127.0.0.1:$APP_PORT;
    keepalive 32;
}

# Cache pour médias
proxy_cache_path /var/cache/nginx/media levels=1:2 keys_zone=media:500m max_size=50g 
                 inactive=7d use_temp_path=off;

server {
    listen 80;
    server_name ${DOMAIN:-_};
    
    # Taille max pour uploads
    client_max_body_size 2G;
    
    # Optimisations générales
    tcp_nopush on;
    tcp_nodelay on;
    
    # Application Beartify
    location / {
        proxy_pass http://beartify_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Rate limiting
        limit_req zone=api burst=50 nodelay;
        limit_conn addr 20;
        
        # Timeouts pour streaming
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    
    # API de streaming avec cache
    location /api/stream/ {
        proxy_pass http://beartify_app;
        proxy_buffering off;
        proxy_request_buffering off;
        
        # Headers pour streaming
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        add_header Accept-Ranges bytes;
        
        # Rate limiting spécialisé
        limit_req zone=streaming burst=200 nodelay;
        limit_conn addr 50;
    }
    
    # Médias avec cache agressif
    location /media/ {
        alias $MEDIA_ROOT/;
        
        # Cache navigateur
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
        
        # Support Range requests pour streaming
        add_header Accept-Ranges bytes;
        
        # CORS pour lecteurs web
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
        add_header Access-Control-Allow-Headers "Range, Content-Type, Accept-Encoding";
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges";
        
        # Cache Nginx
        location ~* \.(mp3|mp4|flac|ogg|webm|m4a|wav)$ {
            proxy_cache media;
            proxy_cache_valid 200 7d;
            proxy_cache_valid 404 1h;
            add_header X-Cache-Status \$upstream_cache_status;
        }
        
        # Gestion des gros fichiers
        location ~* \.(mp4|webm|mkv|avi|mov)$ {
            sendfile on;
            sendfile_max_chunk 1m;
            tcp_nopush off;
        }
    }
    
    # Upload avec limitation
    location /api/upload/ {
        proxy_pass http://beartify_app;
        client_max_body_size 2G;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        
        limit_req zone=api burst=10 nodelay;
    }
    
    # HLS streaming
    location /hls/ {
        alias /var/www/hls/;
        add_header Cache-Control no-cache;
        add_header Access-Control-Allow-Origin "*";
        
        location ~ \.m3u8$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }
        
        location ~ \.ts$ {
            add_header Cache-Control "max-age=60";
        }
    }
    
    # Monitoring et health check
    location /nginx-health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

    # HTTPS avec Let's Encrypt si domaine configuré
    if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
        info "Configuration SSL avec Let's Encrypt..."
        
        # Obtention du certificat
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" || true
        
        # Renouvellement automatique
        systemctl enable certbot.timer
    fi
    
    # Création des répertoires de cache
    mkdir -p /var/cache/nginx/{streaming,media}
    mkdir -p /var/www/{hls,dash}
    chown -R www-data:www-data /var/cache/nginx /var/www/{hls,dash}
    
    # Activation du site
    ln -sf /etc/nginx/sites-available/beartify /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test et redémarrage
    nginx -t
    systemctl enable nginx
    systemctl restart nginx
    
    success "Nginx configuré pour streaming haute performance"
}

# Installation Redis optimisé pour streaming
install_redis_streaming() {
    info "Installation Redis optimisé pour cache streaming..."
    
    apt install -y redis-server redis-tools
    
    # Configuration Redis optimisée
    cat > /etc/redis/redis.conf << 'EOF'
# Configuration Redis pour Beartify Streaming

# Network
bind 127.0.0.1
port 6379
protected-mode yes
tcp-keepalive 300
timeout 300

# Mémoire optimisée pour cache streaming
maxmemory 4gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Persistence optimisée
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis

# Performance
databases 16
lua-time-limit 5000
slowlog-log-slower-than 10000
slowlog-max-len 128
latency-monitor-threshold 100

# Clients pour streaming simultané
tcp-backlog 1024
maxclients 10000

# Éviter les timeouts lors de charges élevées
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# Optimisations réseau
tcp-nodelay yes
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000

# Threads pour I/O
io-threads 4
io-threads-do-reads yes

# Logging
loglevel notice
logfile /var/log/redis/redis-server.log
EOF
    
    systemctl enable redis-server
    systemctl restart redis-server
    
    success "Redis configuré pour streaming"
}

# Installation FastFetch (adapté d'Arch Linux)
install_fastfetch() {
    info "Installation et configuration de FastFetch..."
    
    # Installation via snap si disponible, sinon compilation
    if command -v snap >/dev/null 2>&1; then
        snap install fastfetch
    else
        # Compilation depuis les sources
        apt install -y cmake libcjson-dev libpci-dev
        
        git clone https://github.com/fastfetch-cli/fastfetch.git /tmp/fastfetch
        cd /tmp/fastfetch
        mkdir build && cd build
        cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local
        make -j$(nproc)
        make install
        cd / && rm -rf /tmp/fastfetch
    fi
    
    # Configuration personnalisée pour serveur streaming
    mkdir -p "$BEARTIFY_HOME/.config/fastfetch"
    cat > "$BEARTIFY_HOME/.config/fastfetch/config.jsonc" << 'EOF'
{
    "logo": {
        "type": "ascii",
        "source": "ubuntu",
        "color": {
            "1": "32",
            "2": "37"
        }
    },
    "display": {
        "separator": " : ",
        "keyWidth": 18,
        "keyColor": "32",
        "valueColor": "37"
    },
    "modules": [
        {
            "type": "title",
            "format": "🎵 Beartify Streaming Server - {user}@{host}",
            "color": "32"
        },
        {
            "type": "separator",
            "color": "32"
        },
        {
            "type": "os",
            "key": "Système",
            "format": "{name} {version}"
        },
        {
            "type": "kernel",
            "key": "Kernel",
            "format": "{name} {version}"
        },
        {
            "type": "uptime",
            "key": "Uptime",
            "format": "{days}j {hours}h {minutes}m"
        },
        {
            "type": "packages",
            "key": "Paquets",
            "format": "{count} (apt)"
        },
        {
            "type": "shell",
            "key": "Shell",
            "format": "{name} {version}"
        },
        {
            "type": "cpu",
            "key": "CPU",
            "format": "{name} @ {frequency}"
        },
        {
            "type": "gpu",
            "key": "GPU",
            "format": "{name}"
        },
        {
            "type": "memory",
            "key": "Mémoire",
            "format": "{used} / {total} ({percentage}%)"
        },
        {
            "type": "disk",
            "key": "Stockage",
            "format": "{used} / {total} ({percentage}%)"
        },
        {
            "type": "localip",
            "key": "IP Locale",
            "format": "{address}"
        },
        {
            "type": "break"
        },
        {
            "type": "custom",
            "key": "Services",
            "value": "🎵 Beartify | 🌐 Nginx | 🗄️ Database | 📊 Redis"
        }
    ]
}
EOF
    
    # Configuration pour tous les utilisateurs
    cat >> /etc/bash.bashrc << 'EOF'

# FastFetch pour serveur Beartify
if [[ $- == *i* ]] && command -v fastfetch >/dev/null 2>&1; then
    if [[ -f ~/.config/fastfetch/config.jsonc ]]; then
        fastfetch --load-config ~/.config/fastfetch/config.jsonc 2>/dev/null
    else
        fastfetch 2>/dev/null
    fi
fi
EOF
    
    chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/.config"
    
    success "FastFetch installé et configuré"
}

# Optimisations système pour streaming haute performance
optimize_system_streaming() {
    info "Application d'optimisations système pour streaming haute performance..."
    
    # Limites système pour streaming simultané
    cat > /etc/security/limits.d/99-beartify-streaming.conf << EOF
# Optimisations pour Beartify Streaming Server
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
$BEARTIFY_USER soft nofile 131072
$BEARTIFY_USER hard nofile 131072
www-data soft nofile 131072
www-data hard nofile 131072
EOF
    
    # Paramètres kernel optimisés pour streaming
    cat > /etc/sysctl.d/99-beartify-streaming.conf << EOF
# Optimisations réseau pour streaming haute performance
net.core.somaxconn = 32768
net.core.netdev_max_backlog = 16384
net.core.rmem_default = 262144
net.core.rmem_max = 134217728
net.core.wmem_default = 262144
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 10
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_probes = 3
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_syncookies = 1
net.ipv4.ip_local_port_range = 1024 65000

# Optimisations filesystem pour médias
fs.file-max = 2097152
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 1024
fs.aio-max-nr = 1048576

# Gestion mémoire pour streaming
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.vfs_cache_pressure = 50
vm.min_free_kbytes = 65536

# Optimisations scheduler
kernel.sched_migration_cost_ns = 5000000
kernel.sched_autogroup_enabled = 0
EOF
    
    # Application immédiate
    sysctl -p /etc/sysctl.d/99-beartify-streaming.conf
    
    # Optimisations tmpfs pour cache
    if ! grep -q "tmpfs.*beartify" /etc/fstab; then
        echo "tmpfs /tmp/beartify-cache tmpfs defaults,noatime,size=4G,uid=$(id -u $BEARTIFY_USER),gid=$(id -g $BEARTIFY_USER),mode=1777 0 0" >> /etc/fstab
    fi
    
    success "Optimisations système appliquées"
}

# Installation des services de monitoring
install_monitoring_stack() {
    if [[ ! "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        return 0
    fi
    
    info "Installation de la stack de monitoring..."
    
    # Prometheus
    local prom_version="2.47.0"
    wget -q "https://github.com/prometheus/prometheus/releases/download/v${prom_version}/prometheus-${prom_version}.linux-amd64.tar.gz" -O /tmp/prometheus.tar.gz
    tar -xzf /tmp/prometheus.tar.gz -C /tmp/
    
    cp "/tmp/prometheus-${prom_version}.linux-amd64/prometheus" /usr/local/bin/
    cp "/tmp/prometheus-${prom_version}.linux-amd64/promtool" /usr/local/bin/
    
    # Configuration Prometheus pour streaming
    mkdir -p /etc/prometheus /var/lib/prometheus
    cat > /etc/prometheus/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "streaming_alerts.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  
  - job_name: 'beartify'
    static_configs:
      - targets: ['localhost:$APP_PORT']
    metrics_path: '/actuator/prometheus'
    scrape_interval: 10s
  
  - job_name: 'nginx'
    static_configs:
      - targets: ['localhost:9113']
  
  - job_name: 'redis'
    static_configs:
      - targets: ['localhost:9121']
  
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
    scrape_interval: 5s
EOF
    
    # Node Exporter
    local node_exp_version="1.6.1"
    wget -q "https://github.com/prometheus/node_exporter/releases/download/v${node_exp_version}/node_exporter-${node_exp_version}.linux-amd64.tar.gz" -O /tmp/node_exporter.tar.gz
    tar -xzf /tmp/node_exporter.tar.gz -C /tmp/
    cp "/tmp/node_exporter-${node_exp_version}.linux-amd64/node_exporter" /usr/local/bin/
    
    # Redis Exporter
    local redis_exp_version="1.53.0"
    wget -q "https://github.com/oliver006/redis_exporter/releases/download/v${redis_exp_version}/redis_exporter-v${redis_exp_version}.linux-amd64.tar.gz" -O /tmp/redis_exporter.tar.gz
    tar -xzf /tmp/redis_exporter.tar.gz -C /tmp/
    cp "/tmp/redis_exporter-v${redis_exp_version}.linux-amd64/redis_exporter" /usr/local/bin/
    
    # Grafana
    apt install -y software-properties-common
    wget -q -O - https://packages.grafana.com/gpg.key | apt-key add -
    echo "deb https://packages.grafana.com/oss/deb stable main" >> /etc/apt/sources.list.d/grafana.list
    apt update
    apt install -y grafana
    
    # Configuration Grafana
    local grafana_pass="beartify_$(openssl rand -base64 8)"
    cat > /etc/grafana/grafana.ini << EOF
[server]
http_port = 3000
domain = ${DOMAIN:-localhost}
root_url = http://${DOMAIN:-localhost}:3000/

[security]
admin_user = admin
admin_password = $grafana_pass

[auth.anonymous]
enabled = false

[dashboards]
default_home_dashboard_path = /var/lib/grafana/dashboards/beartify-streaming.json
EOF
    
    # Création des services systemd
    create_monitoring_services
    
    # Démarrage des services
    systemctl daemon-reload
    systemctl enable prometheus node_exporter redis_exporter grafana-server
    systemctl start prometheus node_exporter redis_exporter grafana-server
    
    success "Monitoring installé - Grafana: admin / $grafana_pass"
}

# Service Beartify principal
create_beartify_service() {
    info "Création du service systemd Beartify..."
    
    cat > /etc/systemd/system/beartify.service << EOF
[Unit]
Description=Beartify Streaming Server
After=network.target mysql.service redis.service

[Service]
Type=simple
User=$BEARTIFY_USER
Group=$BEARTIFY_USER
WorkingDirectory=$BEARTIFY_HOME

# Configuration JVM depuis fichier
EnvironmentFile=$BEARTIFY_HOME/config/jvm.conf
ExecStart=/usr/bin/java \$JVM_OPTS -jar $BEARTIFY_HOME/beartify.jar

# Gestion des erreurs et redémarrages
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=beartify

# Sécurité
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$MEDIA_ROOT $BACKUP_ROOT $BEARTIFY_HOME

# Limites de ressources
LimitNOFILE=65536
LimitNPROC=32768
LimitMEMLOCK=infinity

# Variables d'environnement
Environment=SPRING_PROFILES_ACTIVE=production
Environment=SERVER_PORT=$APP_PORT
Environment=MEDIA_ROOT=$MEDIA_ROOT
Environment=DB_URL=jdbc:mysql://localhost:3306/$DB_NAME
Environment=DB_USER=$DB_USER
Environment=DB_PASS=$DB_PASS
Environment=REDIS_URL=redis://localhost:6379

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable beartify
    
    success "Service Beartify configuré"
}

# Installation des services individuels
install_individual_service() {
    local service_num="$1"
    
    case $service_num in
        1)  # DHCP Server
            info "Installation du serveur DHCP..."
            apt install -y isc-dhcp-server
            cat > /etc/dhcp/dhcpd.conf << EOF
default-lease-time 600;
max-lease-time 7200;
authoritative;

subnet 192.168.1.0 netmask 255.255.255.0 {
    range 192.168.1.100 192.168.1.200;
    option routers 192.168.1.1;
    option domain-name-servers 8.8.8.8, 8.8.4.4;
    option broadcast-address 192.168.1.255;
}
EOF
            systemctl enable isc-dhcp-server
            success "DHCP Server installé"
            ;;
        2)  # DNS Server (Bind9)
            info "Installation du serveur DNS..."
            apt install -y bind9 bind9utils bind9-doc
            cat > /etc/bind/named.conf.options << EOF
options {
    directory "/var/cache/bind";
    forwarders { 8.8.8.8; 8.8.4.4; };
    dnssec-validation auto;
    listen-on-v6 { any; };
    allow-recursion { localhost; 192.168.0.0/16; 10.0.0.0/8; };
};
EOF
            systemctl enable bind9
            systemctl start bind9
            success "DNS Server installé"
            ;;
        3)  # FTP Server
            info "Installation du serveur FTP..."
            apt install -y vsftpd
            cat > /etc/vsftpd.conf << EOF
listen=YES
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
ftpd_banner=Serveur FTP Beartify
chroot_local_user=YES
allow_writeable_chroot=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
ssl_enable=YES
EOF
            systemctl enable vsftpd
            systemctl start vsftpd
            success "FTP Server installé"
            ;;
        4)  # SSH/SFTP
            info "Configuration OpenSSH pour SFTP..."
            apt install -y openssh-server
            # Configuration SSH sécurisée
            sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
            sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config
            systemctl enable ssh
            systemctl restart ssh
            success "SSH/SFTP configuré"
            ;;
        5)  # Apache2
            info "Installation Apache2..."
            apt install -y apache2
            systemctl enable apache2
            systemctl start apache2
            cat > /var/www/html/index.html << EOF
<!DOCTYPE html>
<html><head><title>Serveur Beartify</title></head>
<body><h1>Serveur Apache Beartify</h1>
<p>Installation réussie - $(date)</p></body></html>
EOF
            success "Apache2 installé"
            ;;
        6)  # Nginx (déjà géré par install_nginx_streaming)
            install_nginx_streaming
            ;;
        7)  # Mail Server
            info "Installation serveur mail..."
            apt install -y postfix dovecot-core dovecot-imapd dovecot-pop3d
            systemctl enable postfix dovecot
            systemctl start postfix dovecot
            success "Serveur mail installé"
            ;;
        8)  # Squid Proxy
            info "Installation Squid Proxy..."
            apt install -y squid
            systemctl enable squid
            systemctl start squid
            success "Squid Proxy installé"
            ;;
        9)  # MariaDB (déjà géré)
            install_database
            ;;
        10) # PostgreSQL (déjà géré)
            DB_CHOICE=2
            install_database
            ;;
        11) # Redis (déjà géré)
            install_redis_streaming
            ;;
        12) # MongoDB
            info "Installation MongoDB..."
            wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | apt-key add -
            echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-6.0.list
            apt update
            apt install -y mongodb-org
            systemctl enable mongod
            systemctl start mongod
            success "MongoDB installé"
            ;;
        13) # NFS Server
            info "Installation NFS Server..."
            apt install -y nfs-kernel-server
            mkdir -p /srv/nfs/beartify
            echo "/srv/nfs/beartify *(rw,sync,no_subtree_check)" >> /etc/exports
            exportfs -a
            systemctl enable nfs-kernel-server
            success "NFS Server installé"
            ;;
        14) # Samba
            info "Installation Samba..."
            apt install -y samba samba-common-bin
            mkdir -p /srv/samba/beartify
            cat >> /etc/samba/smb.conf << EOF

[beartify]
    path = /srv/samba/beartify
    browseable = yes
    writable = yes
    guest ok = no
    valid users = $BEARTIFY_USER
EOF
            systemctl enable smbd nmbd
            systemctl start smbd nmbd
            success "Samba installé"
            ;;
        15) # Nextcloud
            info "Installation Nextcloud..."
            apt install -y apache2 mysql-server php php-mysql php-xml php-gd php-curl php-zip php-mbstring
            wget https://download.nextcloud.com/server/releases/latest.tar.bz2 -O /tmp/nextcloud.tar.bz2
            tar -xjf /tmp/nextcloud.tar.bz2 -C /var/www/
            chown -R www-data:www-data /var/www/nextcloud
            success "Nextcloud installé (configuration manuelle requise)"
            ;;
        16) # MinIO
            info "Installation MinIO..."
            wget https://dl.min.io/server/minio/release/linux-amd64/minio -O /usr/local/bin/minio
            chmod +x /usr/local/bin/minio
            useradd -r minio-user -s /sbin/nologin || true
            mkdir -p /srv/minio/data
            chown minio-user:minio-user /srv/minio/data
            
            local minio_access=$(openssl rand -base64 12)
            local minio_secret=$(openssl rand -base64 32)
            
            cat > /etc/systemd/system/minio.service << EOF
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
Type=notify
User=minio-user
Group=minio-user
Environment=MINIO_ROOT_USER=$minio_access
Environment=MINIO_ROOT_PASSWORD=$minio_secret
ExecStart=/usr/local/bin/minio server --console-address :9001 /srv/minio/data
Restart=always

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable minio
            systemctl start minio
            success "MinIO installé - Access: $minio_access / Secret: $minio_secret"
            ;;
        17) # Docker (déjà géré)
            install_docker
            ;;
        18) # Gitea
            info "Installation Gitea..."
            wget -O /usr/local/bin/gitea https://dl.gitea.io/gitea/1.20.0/gitea-1.20.0-linux-amd64
            chmod +x /usr/local/bin/gitea
            useradd --system --shell /bin/bash --home /var/lib/gitea --create-home gitea
            mkdir -p /var/lib/gitea/{custom,data,log}
            chown -R gitea:gitea /var/lib/gitea
            
            cat > /etc/systemd/system/gitea.service << 'EOF'
[Unit]
Description=Gitea
After=syslog.target network.target mysql.service

[Service]
Type=simple
User=gitea
Group=gitea
WorkingDirectory=/var/lib/gitea/
ExecStart=/usr/local/bin/gitea web -c /etc/gitea/app.ini
Restart=always
Environment=USER=gitea HOME=/var/lib/gitea

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable gitea
            success "Gitea installé"
            ;;
        19) # Jenkins
            info "Installation Jenkins..."
            wget -q -O - https://pkg.jenkins.io/debian/jenkins.io.key | apt-key add -
            sh -c 'echo deb http://pkg.jenkins.io/debian-stable binary/ > /etc/apt/sources.list.d/jenkins.list'
            apt update
            apt install -y jenkins
            systemctl enable jenkins
            systemctl start jenkins
            success "Jenkins installé (port 8080)"
            ;;
        20) # Node.js (déjà géré)
            apt install -y nodejs npm
            npm install -g pm2 nodemon
            success "Node.js installé"
            ;;
        21) # PHP-FPM
            info "Installation PHP-FPM..."
            apt install -y php-fpm php-mysql php-redis php-gd php-xml php-curl php-zip php-mbstring php-json
            systemctl enable php*-fpm
            systemctl start php*-fpm
            success "PHP-FPM installé"
            ;;
        22) # Java + Tomcat
            info "Installation Java + Tomcat..."
            apt install -y openjdk-17-jdk tomcat9
            systemctl enable tomcat9
            systemctl start tomcat9
            success "Java + Tomcat installés"
            ;;
        23) # Monitoring (déjà géré)
            INSTALL_MONITORING="y"
            install_monitoring_stack
            ;;
        24) # ELK Stack complet
            info "Installation ELK Stack complet..."
            # Elasticsearch
            wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | apt-key add -
            echo "deb https://artifacts.elastic.co/packages/8.x/apt stable main" > /etc/apt/sources.list.d/elastic-8.x.list
            apt update
            apt install -y elasticsearch kibana logstash
            
            # Configuration Elasticsearch
            cat >> /etc/elasticsearch/elasticsearch.yml << 'EOF'
# Configuration Beartify
cluster.name: beartify-logs
node.name: beartify-node-1
path.data: /var/lib/elasticsearch
path.logs: /var/log/elasticsearch
network.host: localhost
http.port: 9200
discovery.type: single-node
xpack.security.enabled: false
EOF
            
            # Configuration Kibana
            cat >> /etc/kibana/kibana.yml << 'EOF'
server.port: 5601
server.host: "localhost"
elasticsearch.hosts: ["http://localhost:9200"]
EOF
            
            systemctl daemon-reload
            systemctl enable elasticsearch kibana logstash
            systemctl start elasticsearch
            sleep 10
            systemctl start kibana logstash
            success "ELK Stack installé et configuré"
            ;;
        25) # Zabbix complet
            info "Installation Zabbix complet..."
            # Installation du repository
            wget https://repo.zabbix.com/zabbix/6.0/ubuntu/pool/main/z/zabbix-release/zabbix-release_6.0-4%2Bubuntu$(lsb_release -rs)_all.deb
            dpkg -i zabbix-release_6.0-4+ubuntu$(lsb_release -rs)_all.deb
            apt update
            
            # Installation des composants
            apt install -y zabbix-server-mysql zabbix-frontend-php zabbix-apache-conf zabbix-sql-scripts zabbix-agent
            
            # Configuration base de données
            mysql -e "CREATE DATABASE zabbix CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;" || true
            mysql -e "CREATE USER 'zabbix'@'localhost' IDENTIFIED BY 'zabbix_password';" || true
            mysql -e "GRANT ALL PRIVILEGES ON zabbix.* TO 'zabbix'@'localhost';" || true
            mysql -e "FLUSH PRIVILEGES;" || true
            
            # Import du schéma
            zcat /usr/share/doc/zabbix-sql-scripts/mysql/server.sql.gz | mysql -uzabbix -pzabbix_password zabbix
            
            # Configuration serveur
            sed -i 's/# DBPassword=/DBPassword=zabbix_password/' /etc/zabbix/zabbix_server.conf
            
            systemctl enable zabbix-server zabbix-agent apache2
            systemctl restart zabbix-server zabbix-agent apache2
            success "Zabbix installé - Interface: http://localhost/zabbix (admin/zabbix)"
            ;;
        26) # MQTT Mosquitto configuré
            info "Installation Mosquitto MQTT configuré..."
            apt install -y mosquitto mosquitto-clients
            
            # Configuration sécurisée
            cat > /etc/mosquitto/conf.d/beartify.conf << 'EOF'
# Configuration Beartify MQTT
listener 1883 localhost
allow_anonymous false
password_file /etc/mosquitto/passwd

# Logging
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
log_type information
log_timestamp true

# Persistence
persistence true
persistence_location /var/lib/mosquitto/

# Limits
max_connections 1000
max_queued_messages 10000
EOF
            
            # Création utilisateur MQTT
            mosquitto_passwd -c /etc/mosquitto/passwd beartify_mqtt
            
            systemctl enable mosquitto
            systemctl restart mosquitto
            success "Mosquitto MQTT configuré (port 1883)"
            ;;
        27) # Jellyfin configuré
            info "Installation Jellyfin configuré..."
            # Repository officiel
            curl https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor | tee /usr/share/keyrings/jellyfin.gpg >/dev/null
            echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg arch=$( dpkg --print-architecture )] https://repo.jellyfin.org/$( awk -F'=' '/^ID=/{ print $NF }' /etc/os-release ) $( awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release ) main" > /etc/apt/sources.list.d/jellyfin.list
            
            apt update
            apt install -y jellyfin
            
            # Configuration pour streaming
            mkdir -p /var/lib/jellyfin/config
            cat > /var/lib/jellyfin/config/system.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<ServerConfiguration>
  <EnableUPnP>false</EnableUPnP>
  <PublicPort>8096</PublicPort>
  <PublicHttpsPort>8920</PublicHttpsPort>
  <HttpServerPortNumber>8096</HttpServerPortNumber>
  <HttpsPortNumber>8920</HttpsPortNumber>
  <EnableHttps>false</EnableHttps>
  <EnableRemoteAccess>true</EnableRemoteAccess>
  <MaxConcurrentStreams>100</MaxConcurrentStreams>
</ServerConfiguration>
EOF
            
            chown -R jellyfin:jellyfin /var/lib/jellyfin
            systemctl enable jellyfin
            systemctl start jellyfin
            success "Jellyfin installé (port 8096) - Configuration: http://localhost:8096"
            ;;
        28) # WireGuard VPN complet
            info "Installation WireGuard VPN complet..."
            apt install -y wireguard wireguard-tools qrencode
            
            # Génération des clés
            cd /etc/wireguard
            wg genkey | tee privatekey | wg pubkey > publickey
            
            # Configuration serveur
            cat > /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = $(cat /etc/wireguard/privatekey)
Address = 10.8.0.1/24
ListenPort = 51820
SaveConfig = true

# Règles de routage
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE; ip6tables -A FORWARD -i %i -j ACCEPT; ip6tables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE; ip6tables -D FORWARD -i %i -j ACCEPT; ip6tables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Client exemple (décommentez et configurez)
#[Peer]
#PublicKey = CLIENT_PUBLIC_KEY
#AllowedIPs = 10.8.0.2/32
EOF
            
            # Permissions
            chmod 600 /etc/wireguard/wg0.conf /etc/wireguard/privatekey
            
            # Activation IP forwarding
            echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
            echo 'net.ipv6.conf.all.forwarding=1' >> /etc/sysctl.conf
            sysctl -p
            
            # Service
            systemctl enable wg-quick@wg0
            systemctl start wg-quick@wg0
            
            success "WireGuard VPN configuré (port 51820)"
            info "Clé publique serveur: $(cat /etc/wireguard/publickey)"
            ;;
        29) # Environnement Desktop (nouveau)
            info "Installation environnement desktop..."
            echo "Choisissez votre environnement :"
            echo "1) KDE Plasma (avec thèmes Beartify)"
            echo "2) GNOME"
            echo "3) XFCE (léger)"
            read -p "Votre choix [1-3]: " desktop_choice
            
            case $desktop_choice in
                1)
                    apt install -y kde-plasma-desktop sddm
                    configure_sddm_custom
                    configure_plymouth_custom
                    systemctl set-default graphical.target
                    systemctl enable sddm
                    success "KDE Plasma installé avec thèmes"
                    ;;
                2)
                    apt install -y ubuntu-desktop-minimal gdm3
                    systemctl set-default graphical.target
                    systemctl enable gdm3
                    success "GNOME installé"
                    ;;
                3)
                    apt install -y xubuntu-desktop lightdm
                    systemctl set-default graphical.target
                    systemctl enable lightdm
                    success "XFCE installé"
                    ;;
                *)
                    warning "Choix invalide, installation annulée"
                    ;;
            esac
            ;;
        30) # Serveur de jeux (nouveau)
            info "Installation serveur de jeux..."
            echo "Choisissez votre serveur de jeu :"
            echo "1) Minecraft Java"
            echo "2) Counter-Strike 1.6"
            echo "3) Terraria"
            read -p "Votre choix [1-3]: " game_choice
            
            case $game_choice in
                1)
                    apt install -y openjdk-17-jre screen wget
                    useradd -m -d /home/minecraft minecraft || true
                    cd /home/minecraft
                    wget -O minecraft_server.jar https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar
                    echo "eula=true" > eula.txt
                    chown -R minecraft:minecraft /home/minecraft
                    success "Minecraft server installé (/home/minecraft)"
                    ;;
                2)
                    dpkg --add-architecture i386
                    apt update
                    apt install -y steamcmd lib32gcc-s1
                    success "SteamCMD installé pour serveurs Steam"
                    ;;
                3)
                    apt install -y mono-complete screen
                    success "Environnement Terraria prêt"
                    ;;
            esac
            ;;
        *)
            warning "Service non reconnu: $service_num"
            ;;
    esac
}

# Création des services de monitoring
create_monitoring_services() {
    # Service Prometheus
    cat > /etc/systemd/system/prometheus.service << 'EOF'
[Unit]
Description=Prometheus Server
After=network.target

[Service]
Type=simple
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/prometheus \
    --config.file=/etc/prometheus/prometheus.yml \
    --storage.tsdb.path=/var/lib/prometheus \
    --web.console.templates=/etc/prometheus/consoles \
    --web.console.libraries=/etc/prometheus/console_libraries \
    --web.listen-address=0.0.0.0:9090 \
    --web.external-url=
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    # Service Node Exporter
    cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/node_exporter \
    --web.listen-address=:9100 \
    --collector.filesystem.ignored-mount-points="^/(sys|proc|dev|host|etc)($|/)"
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    # Service Redis Exporter
    cat > /etc/systemd/system/redis_exporter.service << 'EOF'
[Unit]
Description=Redis Exporter
After=network.target redis.service

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/redis_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    # Création des utilisateurs
    useradd --no-create-home --shell /bin/false prometheus || true
    chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus
}

# Application Beartify de démonstration
create_beartify_demo() {
    info "Création de l'application Beartify de démonstration..."
    
    # Création d'une application Java simple pour test
    cat > "$BEARTIFY_HOME/BeartifyDemo.java" << 'EOF'
import java.io.*;
import java.net.*;
import java.util.concurrent.*;

public class BeartifyDemo {
    private static final int PORT = 8080;
    
    public static void main(String[] args) {
        System.out.println("🎵 Démarrage Beartify Demo Server sur port " + PORT);
        
        try {
            ServerSocket server = new ServerSocket(PORT);
            ExecutorService executor = Executors.newFixedThreadPool(100);
            
            System.out.println("✅ Serveur streaming prêt !");
            System.out.println("🌐 URL: http://localhost:" + PORT);
            
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
            
            out.println("HTTP/1.1 200 OK");
            out.println("Content-Type: text/html; charset=UTF-8");
            out.println("Access-Control-Allow-Origin: *");
            out.println("");
            out.println(getHomePage());
            
        } catch (IOException e) {
            System.err.println("Erreur requête: " + e.getMessage());
        } finally {
            try { client.close(); } catch (IOException ignored) {}
        }
    }
    
    private static String getHomePage() {
        return """
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎵 Beartify Streaming Server</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .container { text-align: center; padding: 3rem; max-width: 800px; }
        h1 { font-size: 4rem; margin-bottom: 1rem; }
        .subtitle { font-size: 1.5rem; margin-bottom: 3rem; opacity: 0.9; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
        .status-card { background: rgba(255,255,255,0.1); padding: 1.5rem; border-radius: 15px; backdrop-filter: blur(10px); }
        .feature { margin: 1rem 0; font-size: 1.1rem; }
        .emoji { font-size: 2em; display: block; margin-bottom: 0.5rem; }
        .footer { margin-top: 3rem; font-size: 0.9rem; opacity: 0.7; }
        .tech-stack { background: rgba(0,0,0,0.3); padding: 2rem; border-radius: 15px; margin-top: 2rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 Beartify</h1>
        <div class="subtitle">Serveur de Streaming Multimédia Haute Performance</div>
        
        <div class="status-grid">
            <div class="status-card">
                <span class="emoji">✅</span>
                <h3>Serveur Actif</h3>
                <p>Port 8080 opérationnel</p>
            </div>
            <div class="status-card">
                <span class="emoji">🚀</span>
                <h3>Performance</h3>
                <p>Optimisé pour 100+ utilisateurs</p>
            </div>
            <div class="status-card">
                <span class="emoji">🔒</span>
                <h3>Sécurisé</h3>
                <p>Pare-feu et monitoring actifs</p>
            </div>
            <div class="status-card">
                <span class="emoji">💾</span>
                <h3>Stockage</h3>
                <p>Structure multimédia optimisée</p>
            </div>
        </div>
        
        <div class="tech-stack">
            <h3>🛠️ Stack Technique</h3>
            <div class="feature">📱 Java 17 + Spring Boot</div>
            <div class="feature">🌐 Nginx + Redis Cache</div>
            <div class="feature">🗄️ Base de données optimisée</div>
            <div class="feature">📊 Monitoring Prometheus/Grafana</div>
            <div class="feature">🎬 Support MP3, MP4, FLAC, OGG</div>
            <div class="feature">📝 Paroles synchronisées (.lrc)</div>
        </div>
        
        <div class="footer">
            Installation Ubuntu Server Beartify - """ + new java.util.Date() + """<br>
            Prêt pour votre application de streaming !
        </div>
    </div>
    
    <script>
        console.log('🎵 Beartify Demo Server - Ready for streaming!');
        setInterval(() => {
            fetch('/api/health').catch(() => {});
        }, 30000);
    </script>
</body>
</html>
""";
    }
}
EOF
    
    # Compilation
    cd "$BEARTIFY_HOME"
    javac BeartifyDemo.java
    jar cfe beartify.jar BeartifyDemo BeartifyDemo.class
    chown "$BEARTIFY_USER:$BEARTIFY_USER" beartify.jar
    
    success "Application Beartify de démonstration créée"
}

# Génération du script post-installation
generate_postinstall_script() {
    info "Génération du script post-installation..."
    
    cat > "$BEARTIFY_HOME/post-install.sh" << 'EOF'
#!/bin/bash
# Script post-installation Beartify
# Optimisations et configurations finales

echo "🎵 BEARTIFY - Script Post-Installation"
echo "======================================"

# Test des services
echo "🔍 Vérification des services..."
services=("nginx" "mysql" "redis-server" "beartify")
for service in "${services[@]}"; do
    if systemctl is-active --quiet "$service"; then
        echo "✅ $service: Actif"
    else
        echo "❌ $service: Inactif"
        systemctl status "$service" --no-pager -l
    fi
done

# Test des ports
echo ""
echo "🌐 Vérification des ports..."
ports=("80:HTTP" "443:HTTPS" "3306:MySQL" "6379:Redis" "8080:Beartify")
for port_desc in "${ports[@]}"; do
    port="${port_desc%:*}"
    desc="${port_desc#*:}"
    if ss -tln | grep -q ":$port "; then
        echo "✅ Port $port ($desc): Ouvert"
    else
        echo "❌ Port $port ($desc): Fermé"
    fi
done

# Optimisations finales
echo ""
echo "⚡ Application des optimisations finales..."

# Cache et permissions
find /srv/media -type d -exec chmod 755 {} \;
find /srv/media -type f -exec chmod 644 {} \;

# Nettoyage des logs anciens
find /var/log -name "*.log" -mtime +30 -delete 2>/dev/null || true

echo ""
echo "🎉 Configuration terminée !"
echo "🌐 Accédez à votre serveur: http://$(hostname -I | awk '{print $1}'):8080"
EOF
    
    chmod +x "$BEARTIFY_HOME/post-install.sh"
    chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/post-install.sh"
    
    success "Script post-installation généré"
}

# Résumé final de l'installation
show_installation_summary() {
    clear
    print_header
    
    echo -e "${GREEN}🎉 INSTALLATION TERMINÉE AVEC SUCCÈS ! 🎉${NC}"
    echo
    echo -e "${CYAN}📋 RÉSUMÉ DE L'INSTALLATION:${NC}"
    echo
    
    if [[ "$INSTALL_TYPE" == "1" ]]; then
        echo -e "${YELLOW}🎵 SERVEUR BEARTIFY INSTALLÉ${NC}"
        echo "  🖥️  Interface: $(case $GUI_CHOICE in 1) echo "KDE Plasma + Thèmes";; 2) echo "GNOME";; 3) echo "Mode serveur";; esac)"
        echo "  💾 Base de données: $(case $DB_CHOICE in 1) echo "MariaDB";; 2) echo "PostgreSQL";; 3) echo "MySQL";; esac)"
        echo "  🔒 Sécurité: UFW + Fail2ban configurés"
        echo "  🌐 Reverse Proxy: Nginx optimisé streaming"
        echo "  ⚡ Cache: Redis configuré"
        echo "  📊 Monitoring: $(if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then echo "Prometheus + Grafana"; else echo "Non installé"; fi)"
        echo
        echo -e "${YELLOW}🔗 ACCÈS:${NC}"
        echo "  🌐 Application: http://$(hostname -I | awk '{print $1}'):$APP_PORT"
        [[ -n "$DOMAIN" ]] && echo "  🌍 Domaine: https://$DOMAIN"
        [[ "$INSTALL_MONITORING" =~ ^[Yy] ]] && echo "  📊 Grafana: http://$(hostname -I | awk '{print $1}'):3000"
        [[ "$INSTALL_MINIO" =~ ^[Yy] ]] && echo "  🗄️ MinIO: http://$(hostname -I | awk '{print $1}'):9001"
        echo
        echo -e "${YELLOW}👤 COMPTES CRÉÉS:${NC}"
        echo "  🔧 Utilisateur système: $BEARTIFY_USER"
        echo "  💾 Base de données: $DB_USER"
        echo "  🔑 Mot de passe DB: [Généré automatiquement]"
    fi
    
    echo
    echo -e "${YELLOW}📂 DOSSIERS IMPORTANTS:${NC}"
    echo "  🎵 Médias: $MEDIA_ROOT/"
    echo "  💾 Sauvegardes: $BACKUP_ROOT/"
    echo "  🏠 Application: $BEARTIFY_HOME/"
    echo
    echo -e "${YELLOW}🛠️ COMMANDES UTILES:${NC}"
    echo "  📊 Status global: sudo systemctl status beartify nginx mysql redis"
    echo "  🔄 Redémarrer: sudo systemctl restart beartify"
    echo "  📋 Logs: sudo journalctl -u beartify -f"
    echo "  🎛️ Post-install: $BEARTIFY_HOME/post-install.sh"
    echo "  🚀 FastFetch: fastfetch"
    echo
    echo -e "${YELLOW}⚙️ FICHIERS DE CONFIGURATION:${NC}"
    echo "  ⚙️ Beartify: $BEARTIFY_HOME/config/"
    echo "  🌐 Nginx: /etc/nginx/sites-available/beartify"
    echo "  🔥 Firewall: sudo ufw status"
    echo "  💾 Base de données: /etc/mysql/ ou /etc/postgresql/"
    echo
    echo -e "${GREEN}🎯 PROCHAINES ÉTAPES:${NC}"
    echo "  1. 🎵 Téléversez vos fichiers dans $MEDIA_ROOT/"
    echo "  2. 🔄 Exécutez: $BEARTIFY_HOME/post-install.sh"
    echo "  3. 🎮 Remplacez beartify.jar par votre vraie application"
    echo "  4. 🎉 Profitez de votre serveur de streaming !"
    echo
    echo -e "${YELLOW}⚠️ SÉCURITÉ:${NC}"
    echo "  🔑 Changez les mots de passe par défaut"
    echo "  🔄 Mettez à jour régulièrement: sudo apt update && sudo apt upgrade"
    echo "  📊 Surveillez via les logs et monitoring"
    echo
    echo -e "${PURPLE}📚 LOGS D'INSTALLATION:${NC}"
    echo "  📋 Log complet: $LOG_FILE"
    echo "  🔍 Consultez avec: less $LOG_FILE"
    echo
    echo -e "${GREEN}✅ SERVEUR BEARTIFY STREAMING PRÊT !${NC}"
    
    # Sauvegarde des infos d'installation
    cat > "$BEARTIFY_HOME/INSTALLATION_INFO.txt" << EOF
BEARTIFY - INFORMATIONS D'INSTALLATION
=====================================
Date: $(date)
Hostname: $(hostname)
IP: $(hostname -I | awk '{print $1}')
Type: $(if [[ "$INSTALL_TYPE" == "1" ]]; then echo "Installation complète Beartify"; else echo "Services individuels"; fi)

CONFIGURATION:
- Interface: $(case $GUI_CHOICE in 1) echo "KDE Plasma";; 2) echo "GNOME";; 3) echo "Serveur";; esac)
- Base: $(case $DB_CHOICE in 1) echo "MariaDB";; 2) echo "PostgreSQL";; 3) echo "MySQL";; esac)
- Domaine: ${DOMAIN:-"Non configuré"}
- Monitoring: ${INSTALL_MONITORING:-"Non"}
- MinIO: ${INSTALL_MINIO:-"Non"}

ACCÈS:
- Application: http://$(hostname -I | awk '{print $1}'):$APP_PORT
- Domaine: ${DOMAIN:-"N/A"}

UTILISATEURS:
- Système: $BEARTIFY_USER
- DB: $DB_USER
- DB Pass: $DB_PASS

DOSSIERS:
- Média: $MEDIA_ROOT
- Backup: $BACKUP_ROOT
- App: $BEARTIFY_HOME

SERVICES INSTALLÉS:
- nginx.service
- beartify.service
- mysql.service (ou postgresql.service)
- redis-server.service
- fail2ban.service
EOF
    
    chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/INSTALLATION_INFO.txt"
}

# Menu principal et logique de sélection
main_menu_loop() {
    while true; do
        show_main_menu
        read -p "Choisissez une option [0-2]: " INSTALL_TYPE
        
        case $INSTALL_TYPE in
            0)
                echo
                success "Merci d'avoir utilisé l'installateur Beartify !"
                info "Logs disponibles: $LOG_FILE"
                exit 0
                ;;
            1)
                echo
                info "Installation complète Beartify sélectionnée"
                get_beartify_config
                install_beartify_complete
                break
                ;;
            2)
                echo
                info "Installation de services individuels"
                install_individual_services_menu
                break
                ;;
            *)
                echo
                warning "Choix invalide. Utilisez 0, 1 ou 2."
                sleep 2
                ;;
        esac
    done
}

# Menu pour services individuels
install_individual_services_menu() {
    while true; do
        show_services_menu
        read -p "Choisissez un service [0-30]: " service_choice
        
        case $service_choice in
            0)
                break
                ;;
            [1-9]|[12][0-9]|30)
                echo
                info "Installation du service $service_choice..."
                install_individual_service "$service_choice"
                echo
                read -p "Appuyez sur Entrée pour continuer..." -r
                ;;
            *)
                echo
                warning "Choix invalide: $service_choice"
                sleep 2
                ;;
        esac
    done
}

# Installation complète Beartify
install_beartify_complete() {
    info "Démarrage de l'installation complète Beartify..."
    
    # Phase 1: Préparation système
    update_system
    install_essential_tools
    create_beartify_user
    
    # Phase 2: Sécurité
    setup_streaming_firewall
    setup_fail2ban
    
    # Phase 3: Interface (si demandée)
    if [[ "$GUI_CHOICE" != "3" ]]; then
        install_gui
    fi
    
    # Phase 4: Stockage et structure
    setup_streaming_storage
    
    # Phase 5: Base de données
    install_database
    
    # Phase 6: Environnement Java
    install_java_environment
    
    # Phase 7: Services de base
    install_docker
    install_nginx_streaming
    install_redis_streaming
    
    # Phase 8: Développement
    install_development
    
    # Phase 9: Optimisations système
    optimize_system_streaming
    
    # Phase 10: Monitoring (optionnel)
    install_monitoring_stack
    
    # Phase 11: Applications
    create_beartify_service
    create_beartify_demo
    install_fastfetch
    
    # Phase 12: Scripts finaux
    generate_postinstall_script
    
    # Phase 13: Démarrage des services
    info "Démarrage des services Beartify..."
    systemctl daemon-reload
    
    # Démarrage en ordre de dépendance
    systemctl start mysql 2>/dev/null || systemctl start postgresql 2>/dev/null || true
    systemctl start redis-server
    systemctl start nginx
    systemctl start beartify
    
    # Vérification des services
    sleep 5
    local failed_services=()
    for service in nginx redis-server beartify; do
        if ! systemctl is-active --quiet "$service"; then
            failed_services+=("$service")
        fi
    done
    
    if [[ ${#failed_services[@]} -eq 0 ]]; then
        success "Tous les services Beartify démarrés avec succès"
    else
        warning "Services ayant échoué: ${failed_services[*]}"
        info "Vérifiez les logs avec: sudo journalctl -u <service>"
    fi
    
    # Résumé final
    show_installation_summary
    
    # Proposition de redémarrage
    echo
    read -p "Voulez-vous redémarrer maintenant pour finaliser l'installation ? [Y/n]: " REBOOT
    if [[ "$REBOOT" =~ ^[Yy]?$ ]]; then
        info "Redémarrage du système dans 10 secondes..."
        sleep 10
        reboot
    else
        info "N'oubliez pas de redémarrer plus tard: sudo reboot"
        info "Script post-installation: $BEARTIFY_HOME/post-install.sh"
    fi
}

# Fonction principale
main() {
    # Initialisation
    print_header
    log "Démarrage du script d'installation Beartify v$SCRIPT_VERSION"
    
    # Vérifications préliminaires
    check_root
    detect_distro
    
    # Analyse des ressources système
    info "Analyse des ressources système..."
    local cpu_cores=$(nproc)
    local ram_gb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    local disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    
    echo
    echo -e "${CYAN}=== RESSOURCES SYSTÈME DÉTECTÉES ===${NC}"
    echo -e "CPU: $cpu_cores cœurs"
    echo -e "RAM: ${ram_gb}GB"
    echo -e "Espace disque libre: ${disk_gb}GB"
    echo
    
    # Recommandations
    if [[ $ram_gb -lt 4 ]]; then
        warning "RAM faible détectée (<4GB). Performances limitées possibles."
    fi
    
    if [[ $disk_gb -lt 50 ]]; then
        warning "Espace disque faible (<50GB). Installation basique recommandée."
    fi
    
    if [[ $cpu_cores -ge 4 && $ram_gb -ge 8 ]]; then
        success "Configuration optimale détectée pour serveur streaming !"
    fi
    
    echo
    read -p "Appuyez sur Entrée pour continuer..." -r
    
    # Menu principal
    main_menu_loop
}

# Gestion des erreurs
cleanup_on_error() {
    error_exit "Installation interrompue. Vérifiez les logs: $LOG_FILE"
}

# Trap pour nettoyage
trap cleanup_on_error ERR INT TERM

# Point d'entrée
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi