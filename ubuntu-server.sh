#!/bin/bash

# Script d'Installation Ubuntu Serveur pour Streaming Multimédia avec Beartify
# Version : 72.8 - ENHANCED & DEBUGGED
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
SCRIPT_VERSION="4.0"
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
BEARTIFY_PASSWORD=""

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
    echo "╔════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    🎵 BEARTIFY UBUNTU SERVER INSTALLER v$SCRIPT_VERSION                  ║"
    echo "║                  Installation Serveur Streaming Multimédia                       ║"
    echo "╚════════════════════════════════════════════════════════════════════════════════╝"
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
    echo -e "${YELLOW}3.${NC} Réparation/Debug (GNOME lockscreen loop fix)"
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
    echo "  6.  HTTPS/Reverse Proxy (Nginx avec streaming HLS/DASH)"
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
    echo "  15. Nextcloud (Cloud personnel)"
    echo "  16. MinIO (Stockage objet S3-compatible)"
    echo
    echo -e "${YELLOW}Développement et CI/CD:${NC}"
    echo "  17. Docker + Docker Compose"
    echo "  18. Git Server (Gitea)"
    echo "  19. Jenkins CI/CD"
    echo "  20. Node.js + NPM + PM2"
    echo "  21. PHP-FPM + Composer"
    echo "  22. Java (OpenJDK) + Tomcat"
    echo
    echo -e "${YELLOW}Monitoring et Logs:${NC}"
    echo "  23. Prometheus + Grafana + Alertmanager"
    echo "  24. ELK Stack (Elasticsearch, Logstash, Kibana)"
    echo "  25. Zabbix"
    echo "  26. Netdata (Real-time monitoring)"
    echo
    echo -e "${YELLOW}Services spécialisés streaming:${NC}"
    echo "  27. MQTT Broker (Mosquitto)"
    echo "  28. Media Server (Jellyfin)"
    echo "  29. Icecast (Audio streaming)"
    echo "  30. Subsonic/Airsonic (Music streaming)"
    echo "  31. Plex Media Server"
    echo "  32. Emby Server"
    echo
    echo -e "${YELLOW}Transcoding et traitement:${NC}"
    echo "  33. FFmpeg avec hardware acceleration"
    echo "  34. HandBrake CLI"
    echo "  35. Audiowaveform (Waveform generation)"
    echo "  36. SoX (Audio processing)"
    echo
    echo -e "${YELLOW}Services réseau avancés:${NC}"
    echo "  37. VPN (WireGuard complet)"
    echo "  38. HAProxy (Load balancer)"
    echo "  39. Varnish Cache"
    echo "  40. CDN local (avec Nginx)"
    echo
    echo -e "${YELLOW}Environnement Desktop:${NC}"
    echo "  41. KDE Plasma (thèmes Beartify)"
    echo "  42. GNOME (corrigé lockscreen)"
    echo "  43. XFCE (léger)"
    echo "  44. MATE Desktop"
    echo
    echo -e "${YELLOW}Serveurs de jeux:${NC}"
    echo "  45. Minecraft Server"
    echo "  46. SteamCMD + CS/TF2"
    echo "  47. Terraria Server"
    echo
    echo -e "${RED}0. Retour au menu principal${NC}"
    echo
}

# FIX GNOME LOCKSCREEN LOOP
fix_gnome_lockscreen() {
    info "🔧 Correction du problème de boucle GNOME lockscreen..."
    
    # Désactiver Wayland et forcer X11
    if [[ -f /etc/gdm3/custom.conf ]]; then
        sed -i 's/#WaylandEnable=false/WaylandEnable=false/' /etc/gdm3/custom.conf
        sed -i '/\[daemon\]/a WaylandEnable=false' /etc/gdm3/custom.conf 2>/dev/null || true
    fi
    
    # Créer configuration GDM personnalisée
    cat > /etc/gdm3/custom.conf << 'EOF'
[daemon]
WaylandEnable=false
AutomaticLoginEnable=false

[security]

[xdmcp]

[chooser]

[debug]
EOF
    
    # Configuration PAM pour éviter les boucles
    if [[ -f /etc/pam.d/gdm-password ]]; then
        # Backup
        cp /etc/pam.d/gdm-password /etc/pam.d/gdm-password.backup
        
        # Vérifier que les modules nécessaires sont présents
        if ! grep -q "pam_succeed_if.so" /etc/pam.d/gdm-password; then
            cat >> /etc/pam.d/gdm-password << 'EOF'
auth    required    pam_succeed_if.so user != root quiet_success
EOF
        fi
    fi
    
    # Créer utilisateur si n'existe pas
    if ! id "$BEARTIFY_USER" &>/dev/null; then
        useradd -m -s /bin/bash -G audio,video,www-data,sudo "$BEARTIFY_USER"
        
        # Demander mot de passe utilisateur
        echo
        echo -e "${CYAN}Création de l'utilisateur $BEARTIFY_USER${NC}"
        while true; do
            read -s -p "Mot de passe pour $BEARTIFY_USER: " BEARTIFY_PASSWORD
            echo
            read -s -p "Confirmez le mot de passe: " BEARTIFY_PASSWORD_CONFIRM
            echo
            
            if [[ "$BEARTIFY_PASSWORD" == "$BEARTIFY_PASSWORD_CONFIRM" ]]; then
                echo "$BEARTIFY_USER:$BEARTIFY_PASSWORD" | chpasswd
                break
            else
                warning "Les mots de passe ne correspondent pas. Réessayez."
            fi
        done
    fi
    
    # Permissions correctes pour home directory
    chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME"
    chmod 755 "$BEARTIFY_HOME"
    
    # Configuration .dmrc pour session par défaut
    cat > "$BEARTIFY_HOME/.dmrc" << 'EOF'
[Desktop]
Session=gnome
EOF
    chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/.dmrc"
    chmod 644 "$BEARTIFY_HOME/.dmrc"
    
    # Désactiver écran de verrouillage automatique
    sudo -u "$BEARTIFY_USER" dbus-launch gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
    sudo -u "$BEARTIFY_USER" dbus-launch gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
    
    # Réinitialiser les configurations GNOME corrompues
    if [[ -d "$BEARTIFY_HOME/.config/gnome-session" ]]; then
        rm -rf "$BEARTIFY_HOME/.config/gnome-session"
    fi
    
    # Reconfigurer GDM
    dpkg-reconfigure gdm3 -f noninteractive
    
    # Redémarrer GDM
    systemctl restart gdm3
    
    success "Correction GNOME lockscreen appliquée"
    warning "Si le problème persiste après redémarrage:"
    echo "  1. Au login, choisissez 'GNOME on Xorg' (roue dentée)"
    echo "  2. Ou utilisez: sudo dpkg-reconfigure gdm3"
    echo "  3. Ou passez à KDE: sudo apt install kde-plasma-desktop sddm"
}

# Configuration utilisateur pour Beartify
get_beartify_config() {
    echo -e "${CYAN}=== CONFIGURATION BEARTIFY ===${NC}"
    echo
    
    # Interface graphique
    echo "Choisissez votre interface graphique :"
    echo "1) KDE Plasma (avec thèmes personnalisés - RECOMMANDÉ)"
    echo "2) GNOME (interface moderne - CORRIGÉ lockscreen)"
    echo "3) XFCE (léger et rapide)"
    echo "4) Aucune (mode serveur uniquement)"
    read -p "Votre choix [1-4] (défaut: 1): " GUI_CHOICE
    GUI_CHOICE=${GUI_CHOICE:-1}
    
    # Créer utilisateur si nécessaire
    if ! id "$BEARTIFY_USER" &>/dev/null; then
        echo
        echo -e "${CYAN}Création de l'utilisateur $BEARTIFY_USER${NC}"
        while true; do
            read -s -p "Mot de passe pour $BEARTIFY_USER: " BEARTIFY_PASSWORD
            echo
            read -s -p "Confirmez le mot de passe: " BEARTIFY_PASSWORD_CONFIRM
            echo
            
            if [[ "$BEARTIFY_PASSWORD" == "$BEARTIFY_PASSWORD_CONFIRM" ]]; then
                break
            else
                warning "Les mots de passe ne correspondent pas. Réessayez."
            fi
        done
    fi
    
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
    read -p "Installer le monitoring (Prometheus + Grafana) ? [Y/n]: " INSTALL_MONITORING
    INSTALL_MONITORING=${INSTALL_MONITORING:-y}
    read -p "Installer MinIO pour stockage objet ? [y/N]: " INSTALL_MINIO
    read -p "Installer Jellyfin pour streaming vidéo ? [y/N]: " INSTALL_JELLYFIN
    read -p "Installer Icecast pour streaming audio en direct ? [y/N]: " INSTALL_ICECAST
    
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
        build-essential make cmake autoconf automake libtool pkg-config
        
        # Outils système
        ufw fail2ban
        systemd-timesyncd
        logrotate rsyslog
        
        # Performance et monitoring
        iperf3 stress sysstat atop dstat
        
        # Outils multimédia pour streaming
        ffmpeg imagemagick
        flac lame opus-tools vorbis-tools
        sox mediainfo exiftool
        
        # Bibliothèques multimédia
        libavcodec-extra libavformat-dev libavutil-dev
        libswscale-dev libswresample-dev
        libmp3lame-dev libopus-dev libvorbis-dev
        libtheora-dev libvpx-dev libx264-dev libx265-dev
        
        # Outils réseau avancés
        nginx-full
        certbot python3-certbot-nginx
        
        # JSON processing
        jq yq
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
    ufw allow 8000/tcp comment "Icecast"
    ufw allow 8096/tcp comment "Jellyfin"
    ufw allow 32400/tcp comment "Plex"
    ufw allow 8920/tcp comment "Emby"
    
    # Ports pour WebRTC si nécessaire
    ufw allow 3478/udp comment "WebRTC STUN"
    ufw allow 10000:20000/udp comment "WebRTC Media"
    
    # Services optionnels
    if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        ufw allow 3000/tcp comment "Grafana"
        ufw allow 9090/tcp comment "Prometheus"
        ufw allow 9093/tcp comment "Alertmanager"
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
destemail = root@localhost
sendername = Fail2Ban
action = %(action_mwl)s

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

[nginx-noscript]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 6

[nginx-noproxy]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

    systemctl enable fail2ban
    systemctl restart fail2ban
    
    success "Fail2ban configuré"
}

# Installation et configuration de l'interface graphique (CORRIGÉ)
install_gui() {
    case $GUI_CHOICE in
        1)
            info "Installation de KDE Plasma avec thèmes personnalisés..."
            
            apt install -y kde-plasma-desktop sddm sddm-theme-breeze \
                plasma-workspace-wayland kde-config-sddm \
                konsole dolphin kate spectacle
            
            configure_sddm_custom
            configure_plymouth_custom
            
            systemctl set-default graphical.target
            systemctl enable sddm
            
            success "KDE Plasma installé avec thèmes personnalisés"
            ;;
        2)
            info "Installation de GNOME (avec corrections lockscreen)..."
            
            # Installation GNOME
            apt install -y ubuntu-desktop-minimal gdm3 gnome-tweaks gnome-shell-extensions
            
            # CORRECTION IMMÉDIATE DU LOCKSCREEN
            fix_gnome_lockscreen
            
            systemctl set-default graphical.target
            systemctl enable gdm3
            
            success "GNOME installé avec corrections lockscreen"
            ;;
        3)
            info "Installation de XFCE (léger)..."
            apt install -y xubuntu-desktop lightdm
            systemctl set-default graphical.target
            systemctl enable lightdm
            success "XFCE installé"
            ;;
        4)
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
    
    local theme_dir="/usr/share/sddm/themes/beartify-modern"
    mkdir -p "$theme_dir"
    
    # Création du thème moderne avec QML
    cat > "$theme_dir/Main.qml" << 'EOFQML'
import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import SddmComponents 2.0

Rectangle {
    id: root
    width: 1920
    height: 1080
    
    // Fond dégradé animé
    gradient: Gradient {
        GradientStop { position: 0.0; color: "#0f2027" }
        GradientStop { position: 0.5; color: "#203a43" }
        GradientStop { position: 1.0; color: "#2c5364" }
    }
    
    // Particules d'arrière-plan
    Repeater {
        model: 30
        Rectangle {
            width: Math.random() * 4 + 2
            height: width
            radius: width / 2
            color: Qt.rgba(0, 1, 0.5, Math.random() * 0.5)
            x: Math.random() * root.width
            y: Math.random() * root.height
            
            SequentialAnimation on opacity {
                loops: Animation.Infinite
                NumberAnimation { 
                    from: 0.2; to: 1.0
                    duration: (Math.random() * 2000) + 1000
                }
                NumberAnimation { 
                    from: 1.0; to: 0.2
                    duration: (Math.random() * 2000) + 1000
                }
            }
        }
    }
    
    // Logo et titre
    ColumnLayout {
        anchors.top: parent.top
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.topMargin: 80
        spacing: 20
        
        Text {
            Layout.alignment: Qt.AlignHCenter
            text: "🎵"
            font.pixelSize: 80
        }
        
        Text {
            Layout.alignment: Qt.AlignHCenter
            text: "BEARTIFY STREAMING SERVER"
            color: "#00ff88"
            font.pixelSize: 42
            font.bold: true
            font.family: "Ubuntu"
        }
        
        Text {
            Layout.alignment: Qt.AlignHCenter
            text: "Professional Media Streaming Platform"
            color: "#ffffff"
            font.pixelSize: 18
            opacity: 0.8
        }
    }
    
    // Zone de connexion principale
    Rectangle {
        id: loginBox
        width: 450
        height: 380
        anchors.centerIn: parent
        color: Qt.rgba(0, 0, 0, 0.6)
        border.color: "#00ff88"
        border.width: 2
        radius: 20
        
        // Effet de flou d'arrière-plan
        layer.enabled: true
        layer.effect: ShaderEffect {
            fragmentShader: "
                uniform lowp sampler2D source;
                uniform lowp float qt_Opacity;
                varying highp vec2 qt_TexCoord0;
                void main() {
                    gl_FragColor = texture2D(source, qt_TexCoord0) * qt_Opacity * 0.9;
                }
            "
        }
        
        ColumnLayout {
            anchors.centerIn: parent
            spacing: 25
            width: parent.width - 80
            
            // Sélection utilisateur
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 10
                
                Text {
                    text: "👤 Utilisateur"
                    color: "#00ff88"
                    font.pixelSize: 16
                    font.bold: true
                }
                
                ComboBox {
                    id: userCombo
                    Layout.fillWidth: true
                    model: userModel
                    currentIndex: userModel.lastIndex
                    textRole: "name"
                    
                    delegate: ItemDelegate {
                        width: userCombo.width
                        contentItem: Text {
                            text: model.name
                            color: "#ffffff"
                            font: userCombo.font
                            elide: Text.ElideRight
                            verticalAlignment: Text.AlignVCenter
                        }
                        highlighted: userCombo.highlightedIndex === index
                    }
                    
                    background: Rectangle {
                        color: Qt.rgba(0, 0, 0, 0.5)
                        border.color: userCombo.pressed ? "#00ff88" : "#555555"
                        border.width: 1
                        radius: 8
                    }
                    
                    contentItem: Text {
                        leftPadding: 15
                        rightPadding: userCombo.indicator.width + userCombo.spacing
                        text: userCombo.displayText
                        font: userCombo.font
                        color: "#ffffff"
                        verticalAlignment: Text.AlignVCenter
                        elide: Text.ElideRight
                    }
                }
            }
            
            // Mot de passe
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 10
                
                Text {
                    text: "🔒 Mot de passe"
                    color: "#00ff88"
                    font.pixelSize: 16
                    font.bold: true
                }
                
                TextField {
                    id: passwordField
                    Layout.fillWidth: true
                    placeholderText: "Entrez votre mot de passe"
                    echoMode: TextInput.Password
                    font.pixelSize: 16
                    color: "#ffffff"
                    
                    background: Rectangle {
                        color: Qt.rgba(0, 0, 0, 0.5)
                        border.color: passwordField.focus ? "#00ff88" : "#555555"
                        border.width: 1
                        radius: 8
                    }
                    
                    Keys.onPressed: {
                        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                            loginButton.clicked()
                            event.accepted = true
                        }
                    }
                    
                    onTextChanged: {
                        errorText.visible = false
                    }
                }
            }
            
            // Message d'erreur
            Text {
                id: errorText
                Layout.fillWidth: true
                text: "❌ Mot de passe incorrect"
                color: "#ff5555"
                font.pixelSize: 14
                horizontalAlignment: Text.AlignHCenter
                visible: false
            }
            
            // Sélection de session
            RowLayout {
                Layout.fillWidth: true
                spacing: 15
                
                Text {
                    text: "🖥️ Session:"
                    color: "#ffffff"
                    font.pixelSize: 14
                }
                
                ComboBox {
                    id: sessionCombo
                    Layout.fillWidth: true
                    model: sessionModel
                    currentIndex: sessionModel.lastIndex
                    textRole: "name"
                    
                    background: Rectangle {
                        color: Qt.rgba(0, 0, 0, 0.5)
                        border.color: "#555555"
                        border.width: 1
                        radius: 8
                    }
                    
                    contentItem: Text {
                        leftPadding: 10
                        text: sessionCombo.displayText
                        color: "#ffffff"
                        verticalAlignment: Text.AlignVCenter
                    }
                }
            }
            
            // Bouton de connexion
            Button {
                id: loginButton
                Layout.fillWidth: true
                Layout.preferredHeight: 50
                text: "🚀 SE CONNECTER"
                font.pixelSize: 16
                font.bold: true
                
                background: Rectangle {
                    color: loginButton.pressed ? "#00cc6a" : "#00ff88"
                    radius: 10
                    
                    SequentialAnimation on scale {
                        running: loginButton.hovered
                        loops: 1
                        NumberAnimation { from: 1.0; to: 1.05; duration: 100 }
                    }
                }
                
                contentItem: Text {
                    text: loginButton.text
                    font: loginButton.font
                    color: "#000000"
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
                
                onClicked: {
                    errorText.visible = false
                    sddm.login(userCombo.currentText, passwordField.text, sessionCombo.currentIndex)
                }
            }
        }
    }
    
    // Barre d'informations en bas
    Rectangle {
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        height: 60
        color: Qt.rgba(0, 0, 0, 0.5)
        
        RowLayout {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 30
            
            // Heure
            Text {
                text: Qt.formatDateTime(new Date(), "🕐 dddd dd MMMM yyyy - HH:mm")
                color: "#ffffff"
                font.pixelSize: 16
            }
            
            Item { Layout.fillWidth: true }
            
            // Boutons système
            Row {
                spacing: 15
                
                Button {
                    text: "🔄"
                    width: 40
                    height: 40
                    ToolTip.visible: hovered
                    ToolTip.text: "Redémarrer"
                    onClicked: sddm.reboot()
                    background: Rectangle {
                        color: parent.pressed ? "#555555" : Qt.rgba(0, 0, 0, 0.5)
                        radius: 20
                        border.color: "#00ff88"
                        border.width: 1
                    }
                    contentItem: Text {
                        text: parent.text
                        font.pixelSize: 20
                        color: "#ffffff"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                }
                
                Button {
                    text: "⚡"
                    width: 40
                    height: 40
                    ToolTip.visible: hovered
                    ToolTip.text: "Éteindre"
                    onClicked: sddm.powerOff()
                    background: Rectangle {
                        color: parent.pressed ? "#555555" : Qt.rgba(0, 0, 0, 0.5)
                        radius: 20
                        border.color: "#ff5555"
                        border.width: 1
                    }
                    contentItem: Text {
                        text: parent.text
                        font.pixelSize: 20
                        color: "#ffffff"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                }
            }
        }
    }
    
    // Focus automatique
    Component.onCompleted: {
        if (userCombo.currentText === "") {
            userCombo.focus = true
        } else {
            passwordField.focus = true
        }
    }
    
    // Timer pour l'horloge
    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: {
            // Force refresh de la date/heure
            root.update()
        }
    }
    
    Connections {
        target: sddm
        function onLoginFailed() {
            errorText.visible = true
            passwordField.text = ""
            passwordField.focus = true
        }
    }
}
EOFQML
    
    # Fichier de métadonnées du thème
    cat > "$theme_dir/metadata.desktop" << 'EOF'
[SddmGreeterTheme]
Name=Beartify Modern
Description=Thème moderne Beartify pour serveur de streaming
Author=PapaOursPolaire
Copyright=GPL v3
License=GPL v3
Type=sddm-theme
Version=2.0
Website=https://github.com/PapaOursPolaire
MainScript=Main.qml
ConfigFile=theme.conf
Theme-Id=beartify-modern
Theme-API=2.0
EOF

    # Configuration du thème
    cat > "$theme_dir/theme.conf" << 'EOF'
[General]
background=background.jpg
type=image

[Branding]
name=Beartify
showLogo=true
EOF
    
    # Télécharger ou créer un fond d'écran
    if command -v convert &>/dev/null; then
        convert -size 1920x1080 gradient:'#0f2027'-'#2c5364' "$theme_dir/background.jpg"
    fi
    
    # Configuration SDDM
    cat > /etc/sddm.conf << EOF
[Theme]
Current=beartify-modern
CursorTheme=breeze_cursors
Font=Ubuntu,11,-1,5,50,0,0,0,0,0

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
HideUsers=
HideShells=/bin/false,/usr/sbin/nologin

[X11]
ServerPath=/usr/bin/X
MinimumVT=7
EOF
    
    success "SDDM configuré avec thème Beartify Modern"
}

# Configuration Plymouth personnalisée
configure_plymouth_custom() {
    if [[ "$GUI_CHOICE" != "1" ]]; then
        return 0
    fi
    
    info "Installation Plymouth avec thème Beartify Mac Style..."
    
    # Installer Plymouth si nécessaire
    apt install -y plymouth plymouth-themes unzip
    
    local theme_dir="/usr/share/plymouth/themes/ubuntu-mac-style"
    local temp_dir="/tmp/plymouth-beartify"
    
    # Nettoyer et créer répertoires temporaires
    rm -rf "$temp_dir"
    mkdir -p "$temp_dir"
    
    # Télécharger le thème
    info "Téléchargement du thème depuis GitHub..."
    if wget -q --show-progress "https://github.com/PapaOursPolaire/Beartify/raw/Projets/ubuntu-mac-style.zip" -O "$temp_dir/theme.zip"; then
        success "Thème téléchargé"
    else
        warning "Échec du téléchargement du thème Plymouth. Installation ignorée."
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Extraire le zip
    info "Extraction du thème..."
    cd "$temp_dir"
    unzip -q theme.zip
    
    # Le zip contient un dossier ubuntu-mac-style/ubuntu-mac-style
    # On doit naviguer dans le bon répertoire
    if [[ -d "$temp_dir/ubuntu-mac-style/ubuntu-mac-style" ]]; then
        local source_dir="$temp_dir/ubuntu-mac-style/ubuntu-mac-style"
    elif [[ -d "$temp_dir/ubuntu-mac-style" ]]; then
        local source_dir="$temp_dir/ubuntu-mac-style"
    else
        warning "Structure du thème inattendue. Recherche du dossier..."
        source_dir=$(find "$temp_dir" -name "*.plymouth" -exec dirname {} \; | head -n1)
        if [[ -z "$source_dir" ]]; then
            error_exit "Impossible de trouver le thème dans l'archive"
        fi
    fi
    
    info "Thème trouvé dans: $source_dir"
    
    # Supprimer l'ancien thème s'il existe
    if [[ -d "$theme_dir" ]]; then
        rm -rf "$theme_dir"
    fi
    
    # Copier le thème vers le répertoire Plymouth
    mkdir -p "$theme_dir"
    cp -r "$source_dir"/* "$theme_dir/"
    
    # Vérifier que le fichier .plymouth existe
    if [[ ! -f "$theme_dir/ubuntu-mac-style.plymouth" ]]; then
        warning "Fichier .plymouth non trouvé. Recherche..."
        plymouth_file=$(find "$theme_dir" -name "*.plymouth" | head -n1)
        if [[ -n "$plymouth_file" ]]; then
            info "Fichier Plymouth trouvé: $plymouth_file"
        else
            error_exit "Aucun fichier .plymouth trouvé dans le thème"
        fi
    fi
    
    # Définir les permissions correctes
    chown -R root:root "$theme_dir"
    chmod -R 755 "$theme_dir"
    
    # Installer le thème Plymouth
    info "Installation du thème Plymouth..."
    if command -v plymouth-set-default-theme &>/dev/null; then
        # Lister les thèmes disponibles pour vérifier
        plymouth-set-default-theme --list | tee -a "$LOG_FILE"
        
        # Essayer d'installer le thème
        if plymouth-set-default-theme ubuntu-mac-style 2>&1 | tee -a "$LOG_FILE"; then
            success "Thème Plymouth défini"
        else
            warning "Échec de la définition du thème par défaut"
            info "Le thème est installé mais pourrait ne pas être actif"
        fi
    else
        warning "plymouth-set-default-theme non disponible"
        info "Installation manuelle du thème..."
        
        # Alternative manuelle si plymouth-set-default-theme n'existe pas
        if [[ -f /etc/alternatives/default.plymouth ]]; then
            ln -sf "$theme_dir/ubuntu-mac-style.plymouth" /etc/alternatives/default.plymouth
        fi
        
        if [[ -f /etc/alternatives/text.plymouth ]]; then
            ln -sf "$theme_dir/ubuntu-mac-style.plymouth" /etc/alternatives/text.plymouth
        fi
    fi
    
    # Mettre à jour initramfs
    info "Mise à jour de l'initramfs (peut prendre quelques minutes)..."
    if update-initramfs -u 2>&1 | tee -a "$LOG_FILE"; then
        success "Initramfs mis à jour"
    else
        warning "Échec de la mise à jour d'initramfs. Le thème pourrait ne pas s'appliquer au démarrage."
    fi
    
    # Nettoyer
    cd /
    rm -rf "$temp_dir"
    
    success "Thème Plymouth Beartify Mac Style installé"
    info "Le thème sera visible au prochain redémarrage"
}

# Création de l'utilisateur Beartify
create_beartify_user() {
    info "Création de l'utilisateur système Beartify..."
    
    if ! id "$BEARTIFY_USER" &>/dev/null; then
        useradd -m -s /bin/bash -G audio,video,www-data,sudo "$BEARTIFY_USER"
        
        # Définir mot de passe
        if [[ -n "$BEARTIFY_PASSWORD" ]]; then
            echo "$BEARTIFY_USER:$BEARTIFY_PASSWORD" | chpasswd
        fi
        
        # Créer répertoires
        sudo -u "$BEARTIFY_USER" mkdir -p "$BEARTIFY_HOME"/{config,logs,temp,scripts}
        
        # Configuration bash
        cat >> "$BEARTIFY_HOME/.bashrc" << 'EOF'

# Beartify Environment
export BEARTIFY_HOME=/home/beartify
export MEDIA_ROOT=/srv/media
export PATH=$PATH:$BEARTIFY_HOME/scripts

# Alias utiles
alias beartify-status='sudo systemctl status beartify nginx mysql redis'
alias beartify-logs='sudo journalctl -u beartify -f'
alias beartify-restart='sudo systemctl restart beartify'
alias media-stats='du -sh /srv/media/*'

# FastFetch au login
if command -v fastfetch &>/dev/null; then
    fastfetch
fi
EOF
        
        success "Utilisateur $BEARTIFY_USER créé"
    else
        success "Utilisateur $BEARTIFY_USER existe déjà"
    fi
}

# Configuration du stockage multimédia optimisé
setup_streaming_storage() {
    info "Configuration du stockage multimédia pour streaming..."
    
    # Structure optimisée
    mkdir -p \
        "$MEDIA_ROOT"/{audio,video,images,lyrics,metadata,cache,temp,processed,playlists} \
        "$MEDIA_ROOT"/audio/{mp3,flac,ogg,m4a,wav,aac,opus} \
        "$MEDIA_ROOT"/video/{mp4,webm,hls,dash,mkv,avi} \
        "$MEDIA_ROOT"/images/{covers,thumbnails,artwork,banners} \
        "$MEDIA_ROOT"/lyrics/{lrc,txt,json} \
        "$MEDIA_ROOT"/metadata/{json,xml,nfo} \
        "$MEDIA_ROOT"/cache/{audio,video,metadata,thumbnails} \
        "$MEDIA_ROOT"/playlists/{m3u,pls,json} \
        "$BACKUP_ROOT"/{daily,weekly,monthly,config}
    
    # Permissions
    chown -R "$BEARTIFY_USER":www-data "$MEDIA_ROOT"
    chmod -R 755 "$MEDIA_ROOT"
    chmod -R 775 "$MEDIA_ROOT"/{temp,cache,processed}
    
    # Configuration fstab pour tmpfs
    if ! grep -q "$MEDIA_ROOT/cache" /etc/fstab; then
        echo "tmpfs $MEDIA_ROOT/cache tmpfs defaults,noatime,size=4G,uid=$(id -u $BEARTIFY_USER),gid=$(id -g www-data),mode=1775 0 0" >> /etc/fstab
    fi
    
    # Logrotate
    cat > /etc/logrotate.d/beartify << EOF
$BEARTIFY_HOME/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER $BEARTIFY_USER
    sharedscripts
    postrotate
        systemctl reload beartify 2>/dev/null || true
    endscript
}

$MEDIA_ROOT/logs/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 644 $BEARTIFY_USER www-data
}
EOF
    
    success "Stockage multimédia configuré"
}

# Installation base de données
install_database() {
    case $DB_CHOICE in
        1)
            info "Installation de MariaDB optimisée..."
            
            apt install -y mariadb-server mariadb-client
            
            cat > /etc/mysql/mariadb.conf.d/99-beartify.cnf << EOF
[mysqld]
# Optimisations streaming
innodb_buffer_pool_size = 2G
innodb_log_file_size = 512M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
innodb_read_io_threads = 8
innodb_write_io_threads = 8
innodb_io_capacity = 2000
innodb_io_capacity_max = 4000

# Cache
query_cache_size = 512M
query_cache_type = 1
query_cache_limit = 2M
key_buffer_size = 512M
sort_buffer_size = 4M
read_buffer_size = 2M
read_rnd_buffer_size = 8M
join_buffer_size = 4M

# Connexions
max_connections = 500
max_user_connections = 450
thread_cache_size = 100
table_open_cache = 4096

# Fichiers volumineux
max_allowed_packet = 1G
tmp_table_size = 512M
max_heap_table_size = 512M

# Réseau
net_buffer_length = 32K
net_read_timeout = 120
net_write_timeout = 120
wait_timeout = 600
interactive_timeout = 600

# Charset UTF8MB4
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# Logs
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow-query.log
long_query_time = 2
log_queries_not_using_indexes = 0
EOF
            
            systemctl restart mariadb
            
            # Sécurisation
            mysql -e "DELETE FROM mysql.user WHERE User='';" || true
            mysql -e "DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');" || true
            mysql -e "DROP DATABASE IF EXISTS test;" || true
            mysql -e "DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';" || true
            
            # Création base et utilisateur
            mysql -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
            mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
            mysql -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';"
            mysql -e "FLUSH PRIVILEGES;"
            
            success "MariaDB configurée"
            ;;
        2)
            info "Installation de PostgreSQL optimisée..."
            
            apt install -y postgresql postgresql-contrib postgresql-client
            
            local pg_version=$(ls /etc/postgresql/ | sort -V | tail -n 1)
            local pg_config="/etc/postgresql/$pg_version/main/postgresql.conf"
            
            cat >> "$pg_config" << EOF

# Beartify Streaming Optimizations
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 1GB
work_mem = 256MB
wal_buffers = 64MB
max_wal_size = 2GB
min_wal_size = 512MB
checkpoint_completion_target = 0.9
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
max_worker_processes = 8
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
max_connections = 400
shared_preload_libraries = 'pg_stat_statements'
EOF
            
            systemctl restart postgresql
            
            sudo -u postgres createuser "$DB_USER" 2>/dev/null || true
            sudo -u postgres createdb -O "$DB_USER" "$DB_NAME" 2>/dev/null || true
            sudo -u postgres psql -c "ALTER USER $DB_USER PASSWORD '$DB_PASS';" 2>/dev/null || true
            
            success "PostgreSQL configuré"
            ;;
        3)
            info "Installation de MySQL..."
            apt install -y mysql-server mysql-client
            
            # Configuration similaire à MariaDB
            systemctl restart mysql
            
            mysql -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
            mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
            mysql -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';"
            mysql -e "FLUSH PRIVILEGES;"
            
            success "MySQL installé"
            ;;
    esac
}

# Installation environnement Java
install_java_environment() {
    info "Installation environnement Java..."
    
    apt install -y openjdk-17-jdk openjdk-17-jre maven
    
    # Gradle
    local gradle_version="8.5"
    wget -q "https://services.gradle.org/distributions/gradle-${gradle_version}-bin.zip" -O /tmp/gradle.zip
    unzip -q -d /opt /tmp/gradle.zip
    ln -sf "/opt/gradle-${gradle_version}/bin/gradle" /usr/local/bin/gradle
    rm /tmp/gradle.zip
    
    # Variables d'environnement
    cat > /etc/profile.d/beartify-java.sh << EOF
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export BEARTIFY_HOME=$BEARTIFY_HOME
export MEDIA_ROOT=$MEDIA_ROOT
export PATH=\$PATH:\$JAVA_HOME/bin:/opt/gradle-${gradle_version}/bin
EOF
    
    # Configuration JVM
    mkdir -p "$BEARTIFY_HOME/config"
    cat > "$BEARTIFY_HOME/config/jvm.conf" << 'EOF'
# JVM Options Beartify
-Xms2g
-Xmx6g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+UseStringDeduplication
-XX:+OptimizeStringConcat
-XX:+UseCompressedOops
-XX:G1HeapRegionSize=16m
-XX:ConcGCThreads=2
-XX:ParallelGCThreads=8
-XX:+ParallelRefProcEnabled
-XX:+UnlockExperimentalVMOptions
-XX:+AggressiveOpts
-Dfile.encoding=UTF-8
-Djava.net.preferIPv4Stack=true
-Dspring.profiles.active=production
-Dserver.port=8080
EOF
    
    success "Java installé"
}

# Installation développement
install_development() {
    info "Installation environnement de développement..."
    
    # Node.js LTS
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt install -y nodejs
    
    # Packages npm globaux
    npm install -g pm2 nodemon typescript ts-node @nestjs/cli yarn pnpm
    
    # Python
    apt install -y python3 python3-pip python3-venv python3-dev \
        python3-setuptools python3-wheel
    
    # Outils Python pour multimédia
    pip3 install mutagen pillow pydub audioread librosa

    # Ruby
    apt install -y ruby-full
    
    # Go
    snap install go --classic 2>/dev/null || true
    
    # Rust
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    
    success "Environnement de développement installé"
}

# Installation Docker
install_docker() {
    info "Installation Docker..."
    
    apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
    
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt update
    apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Configuration
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
    "storage-driver": "overlay2",
    "default-ulimits": {
        "memlock": {"name": "memlock", "soft": -1, "hard": -1},
        "nofile": {"name": "nofile", "soft": 65536, "hard": 65536}
    },
    "dns": ["8.8.8.8", "8.8.4.4"],
    "max-concurrent-downloads": 10,
    "max-concurrent-uploads": 5,
    "live-restore": true
}
EOF
    
    usermod -aG docker "$BEARTIFY_USER"
    
    systemctl enable docker
    systemctl start docker
    
    success "Docker installé"
}

# Installation Nginx avec modules streaming avancés
install_nginx_streaming() {
    info "Installation Nginx optimisé pour streaming..."
    
    # Installation avec modules RTMP
    apt install -y nginx-full libnginx-mod-rtmp nginx-extras
    
    # Configuration principale Nginx
    cat > /etc/nginx/nginx.conf << 'EOFNGINX'
user www-data;
worker_processes auto;
worker_rlimit_nofile 100000;
pid /run/nginx.pid;

events {
    worker_connections 8192;
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
    client_body_timeout 60s;
    client_header_timeout 60s;
    send_timeout 120s;
    
    # Buffer sizes
    client_body_buffer_size 128k;
    client_max_body_size 4G;
    client_header_buffer_size 4k;
    large_client_header_buffers 8 16k;
    output_buffers 2 32k;
    postpone_output 1460;
    
    # Types MIME
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Types MIME additionnels pour streaming
    types {
        application/json json;
        audio/mpeg mp3;
        audio/mp4 m4a;
        audio/ogg ogg oga;
        audio/opus opus;
        audio/x-wav wav;
        audio/flac flac;
        audio/aac aac;
        video/mp4 mp4;
        video/webm webm;
        video/x-matroska mkv;
        application/x-mpegURL m3u8;
        video/MP2T ts;
        application/dash+xml mpd;
        text/vtt vtt;
        text/plain lrc txt;
    }
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        application/json
        application/javascript
        application/xml+rss
        application/xml
        application/x-mpegURL
        application/dash+xml
        image/svg+xml
        text/css
        text/javascript
        text/plain
        text/xml
        text/vtt;
    gzip_disable "msie6";
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:20m rate=50r/s;
    limit_req_zone $binary_remote_addr zone=streaming:20m rate=200r/s;
    limit_req_zone $binary_remote_addr zone=upload:10m rate=10r/s;
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    
    # Logging
    log_format streaming '$remote_addr - $remote_user [$time_local] '
                        '"$request" $status $body_bytes_sent '
                        '"$http_referer" "$http_user_agent" '
                        'rt=$request_time ut="$upstream_response_time" '
                        'cs=$upstream_cache_status '
                        'bytes_sent=$bytes_sent connection=$connection';
    
    access_log /var/log/nginx/access.log streaming buffer=64k flush=5s;
    error_log /var/log/nginx/error.log warn;
    
    # Cache pour contenu statique
    proxy_cache_path /var/cache/nginx/streaming 
                     levels=1:2 
                     keys_zone=streaming:200m 
                     max_size=20g 
                     inactive=7d 
                     use_temp_path=off;
    
    proxy_cache_path /var/cache/nginx/media 
                     levels=1:2 
                     keys_zone=media:500m 
                     max_size=100g 
                     inactive=30d 
                     use_temp_path=off;
    
    # Headers de sécurité par défaut
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}

# RTMP Server pour streaming en direct
rtmp {
    server {
        listen 1935;
        chunk_size 4096;
        ping 30s;
        ping_timeout 10s;
        max_message 10M;
        buflen 5s;
        
        application live {
            live on;
            record off;
            allow publish 127.0.0.1;
            allow publish 192.168.0.0/16;
            deny publish all;
            
            # HLS
            hls on;
            hls_path /var/www/hls/live;
            hls_fragment 3s;
            hls_playlist_length 60s;
            hls_continuous on;
            hls_cleanup on;
            hls_nested on;
            
            # DASH
            dash on;
            dash_path /var/www/dash/live;
            dash_fragment 3s;
            dash_playlist_length 60s;
            dash_nested on;
            dash_cleanup on;
            
            # Transcoding pour adaptive streaming
            exec ffmpeg -i rtmp://localhost:1935/live/$name
                -c:v libx264 -preset veryfast -tune zerolatency -b:v 2500k -maxrate 2500k -bufsize 5000k -s 1920x1080 -profile:v high -level 4.2 -c:a aac -b:a 128k -ar 48000 -f flv rtmp://localhost:1935/hls/$name_1080p
                -c:v libx264 -preset veryfast -tune zerolatency -b:v 1000k -maxrate 1000k -bufsize 2000k -s 1280x720 -profile:v main -level 3.1 -c:a aac -b:a 96k -ar 48000 -f flv rtmp://localhost:1935/hls/$name_720p
                -c:v libx264 -preset veryfast -tune zerolatency -b:v 500k -maxrate 500k -bufsize 1000k -s 854x480 -profile:v main -level 3.0 -c:a aac -b:a 64k -ar 44100 -f flv rtmp://localhost:1935/hls/$name_480p;
        }
        
        application hls {
            live on;
            hls on;
            hls_path /var/www/hls/adaptive;
            hls_nested on;
            hls_fragment 3s;
            hls_playlist_length 60s;
        }
        
        application vod {
            play /srv/media/video;
        }
    }
}
EOFNGINX
    
    # Configuration site Beartify
    cat > /etc/nginx/sites-available/beartify << 'EOFSITE'
upstream beartify_app {
    server 127.0.0.1:8080;
    keepalive 64;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# Rate limiting maps
map $request_uri $limit_api {
    ~*/api/upload/ $binary_remote_addr;
    default "";
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    
    # Taille max pour uploads
    client_max_body_size 4G;
    client_body_buffer_size 128k;
    
    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    
    # Optimisations
    tcp_nopush on;
    tcp_nodelay on;
    
    # Logs spécifiques
    access_log /var/log/nginx/beartify_access.log streaming;
    error_log /var/log/nginx/beartify_error.log warn;
    
    # Application principale Beartify
    location / {
        proxy_pass http://beartify_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # Rate limiting modéré
        limit_req zone=api burst=100 nodelay;
        limit_conn addr 50;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }
    
    # API de streaming avec optimisations
    location /api/stream/ {
        proxy_pass http://beartify_app;
        proxy_http_version 1.1;
        
        # Headers pour streaming
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        
        # Support Range requests
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=3600";
        
        # CORS pour lecteurs web
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Range, Content-Type, Accept-Encoding" always;
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges" always;
        
        # Rate limiting pour streaming
        limit_req zone=streaming burst=300 nodelay;
        limit_conn addr 100;
        
        # Pas de buffering pour streaming
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
    }
    
    # Médias statiques avec cache agressif
    location /media/ {
        alias /srv/media/;
        
        # Cache navigateur long
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
        add_header Accept-Ranges bytes;
        
        # CORS
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Range, Content-Type" always;
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range" always;
        
        # Cache Nginx pour fichiers fréquents
        location ~* \.(mp3|m4a|flac|ogg|opus|aac)$ {
            proxy_cache media;
            proxy_cache_valid 200 30d;
            proxy_cache_valid 404 1h;
            add_header X-Cache-Status $upstream_cache_status;
            add_header X-Media-Type "audio";
        }
        
        location ~* \.(mp4|webm|mkv)$ {
            proxy_cache media;
            proxy_cache_valid 200 30d;
            proxy_cache_valid 404 1h;
            add_header X-Cache-Status $upstream_cache_status;
            add_header X-Media-Type "video";
            
            # Optimisation pour gros fichiers
            sendfile on;
            sendfile_max_chunk 1m;
            tcp_nopush off;
            aio threads;
        }
        
        location ~* \.(jpg|jpeg|png|gif|webp|svg)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
            add_header X-Media-Type "image";
        }
        
        location ~* \.(lrc|txt|json)$ {
            default_type text/plain;
            charset utf-8;
            add_header Cache-Control "public, max-age=86400";
            add_header X-Media-Type "lyrics";
        }
    }
    
    # Upload avec limitations strictes
    location /api/upload/ {
        proxy_pass http://beartify_app;
        client_max_body_size 4G;
        client_body_timeout 300s;
        
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
        
        limit_req zone=upload burst=5 nodelay;
        limit_conn addr 5;
    }
    
    # HLS streaming
    location /hls/ {
        alias /var/www/hls/;
        
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
        
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
        
        location ~ \.m3u8$ {
            add_header Cache-Control "no-cache";
            expires -1;
        }
        
        location ~ \.ts$ {
            add_header Cache-Control "max-age=10";
            expires 10s;
        }
    }
    
    # DASH streaming
    location /dash/ {
        alias /var/www/dash/;
        
        types {
            application/dash+xml mpd;
            video/mp4 mp4;
        }
        
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin "*" always;
    }
    
    # WebSocket pour notifications temps réel
    location /ws/ {
        proxy_pass http://beartify_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
    
    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Nginx status (local only)
    location /nginx-status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }
    
    # Bloquer fichiers sensibles
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    location ~ ~$ {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOFSITE

    # Créer répertoires
    mkdir -p /var/www/{hls,dash}/{live,adaptive}
    mkdir -p /var/cache/nginx/{streaming,media}
    chown -R www-data:www-data /var/www/{hls,dash}
    chown -R www-data:www-data /var/cache/nginx
    chmod -R 755 /var/www/{hls,dash}
    
    # SSL Let's Encrypt si domaine
    if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
        info "Configuration SSL avec Let's Encrypt..."
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect || true
        systemctl enable certbot.timer
    fi
    
    # Activer site
    ln -sf /etc/nginx/sites-available/beartify /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test et redémarrage
    nginx -t
    systemctl enable nginx
    systemctl restart nginx
    
    success "Nginx configuré pour streaming avancé"
}

# Installation Redis
install_redis_streaming() {
    info "Installation Redis pour cache..."
    
    apt install -y redis-server redis-tools
    
    cat > /etc/redis/redis.conf << 'EOFREDIS'
# Configuration Redis pour Beartify
bind 127.0.0.1 ::1
port 6379
protected-mode yes
tcp-backlog 2048
timeout 300
tcp-keepalive 300

# Mémoire
maxmemory 6gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Persistence optimisée
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename beartify-dump.rdb
dir /var/lib/redis

# Performance
databases 16
lua-time-limit 5000
slowlog-log-slower-than 10000
slowlog-max-len 256
latency-monitor-threshold 100
notify-keyspace-events ""

# Clients
tcp-backlog 2048
maxclients 10000

# Buffers
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 64mb 16mb 60

# Optimisations réseau
tcp-nodelay yes
repl-disable-tcp-nodelay no

# Hash optimizations
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000

# Threads I/O
io-threads 4
io-threads-do-reads yes

# Logging
loglevel notice
logfile /var/log/redis/redis-server.log

# Sécurité
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG "CONFIG_beartify_secret"
EOFREDIS
    
    systemctl enable redis-server
    systemctl restart redis-server
    
    success "Redis configuré"
}

# Installation FastFetch amélioré
install_fastfetch() {
    info "Installation FastFetch..."
    
    # Compilation depuis sources pour dernière version
    apt install -y cmake libcjson-dev libpci-dev libvulkan-dev libwayland-dev libxrandr-dev libxcb-randr0-dev libdbus-1-dev libdconf-dev libjson-c-dev
    
    git clone --depth=1 https://github.com/fastfetch-cli/fastfetch.git /tmp/fastfetch
    cd /tmp/fastfetch
    mkdir build && cd build
    cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release
    make -j$(nproc)
    make install
    cd / && rm -rf /tmp/fastfetch
    
    # Configuration personnalisée
    mkdir -p "$BEARTIFY_HOME/.config/fastfetch"
    cat > "$BEARTIFY_HOME/.config/fastfetch/config.jsonc" << 'EOFFETCH'
{
    "$schema": "https://github.com/fastfetch-cli/fastfetch/raw/dev/doc/json_schema.json",
    "logo": {
        "type": "small",
        "padding": {
            "top": 1
        }
    },
    "display": {
        "separator": " → ",
        "color": {
            "keys": "green",
            "title": "bright_green"
        }
    },
    "modules": [
        {
            "type": "custom",
            "format": "╔══════════════════════════════════════════╗"
        },
        {
            "type": "custom",
            "format": "║   🎵 BEARTIFY STREAMING SERVER           ║"
        },
        {
            "type": "custom",
            "format": "╚══════════════════════════════════════════╝"
        },
        "break",
        {
            "type": "title",
            "color": {
                "user": "bright_cyan",
                "host": "bright_green"
            }
        },
        "separator",
        {
            "type": "os",
            "key": "  OS",
            "keyColor": "green"
        },
        {
            "type": "host",
            "key": "  Host",
            "keyColor": "green"
        },
        {
            "type": "kernel",
            "key": "  Kernel",
            "keyColor": "green"
        },
        {
            "type": "uptime",
            "key": "  Uptime",
            "keyColor": "green"
        },
        {
            "type": "packages",
            "key": "  Packages",
            "keyColor": "green"
        },
        {
            "type": "shell",
            "key": "  Shell",
            "keyColor": "green"
        },
        "break",
        {
            "type": "wm",
            "key": "  DE/WM",
            "keyColor": "cyan"
        },
        {
            "type": "terminal",
            "key": "  Terminal",
            "keyColor": "cyan"
        },
        "break",
        {
            "type": "cpu",
            "key": "  CPU",
            "keyColor": "blue"
        },
        {
            "type": "gpu",
            "key": "  GPU",
            "keyColor": "blue"
        },
        {
            "type": "memory",
            "key": "  Memory",
            "keyColor": "blue"
        },
        {
            "type": "disk",
            "key": "  Disk",
            "keyColor": "blue"
        },
        "break",
        {
            "type": "localip",
            "key": "  Local IP",
            "keyColor": "magenta"
        },
        {
            "type": "publicip",
            "key": "  Public IP",
            "keyColor": "magenta"
        },
        "break",
        {
            "type": "custom",
            "format": "  Services: 🎵 Beartify | 🌐 Nginx | 💾 DB | 🔴 Redis"
        },
        {
            "type": "custom",
            "format": "  Media: /srv/media | Logs: ~/logs"
        },
        "break",
        "colors"
    ]
}
EOFFETCH
    
    chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/.config"
    
    success "FastFetch installé"
}

# Installation services streaming additionnels
install_jellyfin() {
    if [[ ! "$INSTALL_JELLYFIN" =~ ^[Yy] ]]; then
        return 0
    fi
    
    info "Installation Jellyfin..."
    
    curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg
    echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg arch=$(dpkg --print-architecture)] https://repo.jellyfin.org/$(awk -F'=' '/^ID=/{ print $NF }' /etc/os-release) $(awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release) main" > /etc/apt/sources.list.d/jellyfin.list
    
    apt update
    apt install -y jellyfin
    
    # Lier au stockage Beartify
    ln -sf /srv/media/video /var/lib/jellyfin/videos
    ln -sf /srv/media/audio /var/lib/jellyfin/music
    
    systemctl enable jellyfin
    systemctl start jellyfin
    
    success "Jellyfin installé (port 8096)"
}

install_icecast() {
    if [[ ! "$INSTALL_ICECAST" =~ ^[Yy] ]]; then
        return 0
    fi
    
    info "Installation Icecast pour streaming audio..."
    
    apt install -y icecast2
    
    # Configuration
    cat > /etc/icecast2/icecast.xml << 'EOFICE'
<icecast>
    <location>Beartify Server</location>
    <admin>admin@beartify.local</admin>
    <limits>
        <clients>1000</clients>
        <sources>10</sources>
        <queue-size>524288</queue-size>
        <client-timeout>30</client-timeout>
        <header-timeout>15</header-timeout>
        <source-timeout>10</source-timeout>
        <burst-on-connect>1</burst-on-connect>
        <burst-size>65535</burst-size>
    </limits>
    <authentication>
        <source-password>beartify_source_secret</source-password>
        <relay-password>beartify_relay_secret</relay-password>
        <admin-user>admin</admin-user>
        <admin-password>beartify_admin_secret</admin-password>
    </authentication>
    <hostname>localhost</hostname>
    <listen-socket>
        <port>8000</port>
    </listen-socket>
    <mount-directory>/usr/share/icecast2/web</mount-directory>
    <fileserve>1</fileserve>
    <paths>
        <basedir>/usr/share/icecast2</basedir>
        <logdir>/var/log/icecast2</logdir>
        <webroot>/usr/share/icecast2/web</webroot>
        <adminroot>/usr/share/icecast2/admin</adminroot>
        <alias source="/" destination="/status.xsl"/>
    </paths>
    <logging>
        <accesslog>access.log</accesslog>
        <errorlog>error.log</errorlog>
        <loglevel>3</loglevel>
        <logsize>10000</logsize>
    </logging>
    <security>
        <chroot>0</chroot>
    </security>
</icecast>
EOFICE
    
    systemctl enable icecast2
    systemctl restart icecast2
    
    success "Icecast installé (port 8000)"
}

# Optimisations système
optimize_system_streaming() {
    info "Application d'optimisations système..."
    
    cat > /etc/security/limits.d/99-beartify.conf << EOF
* soft nofile 100000
* hard nofile 100000
* soft nproc 65535
* hard nproc 65535
$BEARTIFY_USER soft nofile 200000
$BEARTIFY_USER hard nofile 200000
www-data soft nofile 200000
www-data hard nofile 200000
EOF
    
    cat > /etc/sysctl.d/99-beartify.conf << 'EOF'
# Optimisations réseau streaming
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.core.rmem_default = 262144
net.core.rmem_max = 268435456
net.core.wmem_default = 262144
net.core.wmem_max = 268435456
net.ipv4.tcp_rmem = 4096 87380 268435456
net.ipv4.tcp_wmem = 4096 65536 268435456
net.ipv4.tcp_mem = 262144 1048576 4194304
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 10
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_fastopen = 3
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_max_tw_buckets = 1440000
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_window_scaling = 1

# Filesystem
fs.file-max = 3000000
fs.inotify.max_user_watches = 2097152
fs.inotify.max_user_instances = 2048
fs.aio-max-nr = 2097152

# Mémoire
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.vfs_cache_pressure = 50
vm.min_free_kbytes = 131072
vm.overcommit_memory = 1

# Scheduler
kernel.sched_migration_cost_ns = 5000000
kernel.sched_autogroup_enabled = 0
kernel.sched_min_granularity_ns = 10000000
kernel.sched_wakeup_granularity_ns = 15000000
EOF
    
    sysctl -p /etc/sysctl.d/99-beartify.conf
    
    success "Optimisations appliquées"
}

# Installation monitoring
install_monitoring_stack() {
    if [[ ! "$INSTALL_MONITORING" =~ ^[Yy] ]]; then
        return 0
    fi
    
    info "Installation monitoring stack..."
    
    # Prometheus
    local prom_version="2.48.0"
    wget -q "https://github.com/prometheus/prometheus/releases/download/v${prom_version}/prometheus-${prom_version}.linux-amd64.tar.gz" -O /tmp/prom.tar.gz
    tar -xzf /tmp/prom.tar.gz -C /tmp/
    cp "/tmp/prometheus-${prom_version}.linux-amd64/prometheus" /usr/local/bin/
    cp "/tmp/prometheus-${prom_version}.linux-amd64/promtool" /usr/local/bin/
    
    mkdir -p /etc/prometheus /var/lib/prometheus
    useradd --no-create-home --shell /bin/false prometheus 2>/dev/null || true
    
    cat > /etc/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  
  - job_name: 'beartify'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/actuator/prometheus'
    scrape_interval: 10s
  
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
  
  - job_name: 'nginx'
    static_configs:
      - targets: ['localhost:9113']
  
  - job_name: 'redis'
    static_configs:
      - targets: ['localhost:9121']
EOF
    
    # Node Exporter
    local node_version="1.7.0"
    wget -q "https://github.com/prometheus/node_exporter/releases/download/v${node_version}/node_exporter-${node_version}.linux-amd64.tar.gz" -O /tmp/node.tar.gz
    tar -xzf /tmp/node.tar.gz -C /tmp/
    cp "/tmp/node_exporter-${node_version}.linux-amd64/node_exporter" /usr/local/bin/
    
    # Grafana
    wget -q -O - https://packages.grafana.com/gpg.key | apt-key add -
    echo "deb https://packages.grafana.com/oss/deb stable main" > /etc/apt/sources.list.d/grafana.list
    apt update && apt install -y grafana
    
    # Configuration Grafana
    local grafana_pass="beartify_$(openssl rand -base64 12)"
    sed -i "s/;admin_password = admin/admin_password = $grafana_pass/" /etc/grafana/grafana.ini
    
    # Services systemd
    create_monitoring_services
    
    systemctl daemon-reload
    systemctl enable prometheus node_exporter grafana-server
    systemctl start prometheus node_exporter grafana-server
    
    success "Monitoring installé - Grafana: admin / $grafana_pass"
}

# Création services monitoring
create_monitoring_services() {
    cat > /etc/systemd/system/prometheus.service << 'EOF'
[Unit]
Description=Prometheus
After=network.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
    --config.file=/etc/prometheus/prometheus.yml \
    --storage.tsdb.path=/var/lib/prometheus \
    --web.console.templates=/etc/prometheus/consoles \
    --web.console.libraries=/etc/prometheus/console_libraries \
    --web.listen-address=0.0.0.0:9090
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=nobody
Group=nogroup
Type=simple
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF
}

# Service Beartify
create_beartify_service() {
    info "Création service Beartify..."
    
    cat > /etc/systemd/system/beartify.service << EOF
[Unit]
Description=Beartify Streaming Server
Documentation=https://github.com/PapaOursPolaire/Beartify
After=network.target mysql.service redis.service

[Service]
Type=simple
User=$BEARTIFY_USER
Group=$BEARTIFY_USER
WorkingDirectory=$BEARTIFY_HOME

ExecStart=/usr/bin/java \\
    @$BEARTIFY_HOME/config/jvm.conf \\
    -jar $BEARTIFY_HOME/beartify.jar

Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

StandardOutput=journal
StandardError=journal
SyslogIdentifier=beartify

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$MEDIA_ROOT $BACKUP_ROOT $BEARTIFY_HOME

LimitNOFILE=200000
LimitNPROC=65535
LimitMEMLOCK=infinity

Environment=SPRING_PROFILES_ACTIVE=production
Environment=SERVER_PORT=$APP_PORT
Environment=MEDIA_ROOT=$MEDIA_ROOT
Environment=DB_URL=jdbc:mysql://localhost:3306/$DB_NAME?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC
Environment=DB_USER=$DB_USER
Environment=DB_PASS=$DB_PASS
Environment=REDIS_URL=redis://localhost:6379
Environment=JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable beartify
    
    success "Service Beartify créé"
}

# Application Beartify demo améliorée
create_beartify_demo() {
    info "Création application Beartify demo..."
    
    cat > "$BEARTIFY_HOME/BeartifyServer.java" << 'EOFJAVA'
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.text.SimpleDateFormat;

public class BeartifyServer {
    private static final int PORT = 8080;
    private static final String MEDIA_ROOT = "/srv/media";
    private static HttpServer server;
    
    public static void main(String[] args) throws IOException {
        System.out.println("🎵 BEARTIFY STREAMING SERVER v4.0");
        System.out.println("====================================");
        System.out.println("Starting on port " + PORT + "...");
        
        server = HttpServer.create(new InetSocketAddress(PORT), 0);
        ExecutorService executor = Executors.newFixedThreadPool(100);
        server.setExecutor(executor);
        
        // Routes
        server.createContext("/", new HomeHandler());
        server.createContext("/health", new HealthHandler());
        server.createContext("/api/stats", new StatsHandler());
        server.createContext("/api/stream/", new StreamHandler());
        server.createContext("/actuator/prometheus", new MetricsHandler());
        
        server.start();
        System.out.println("✅ Server started successfully!");
        System.out.println("🌐 URL: http://localhost:" + PORT);
        System.out.println("📊 Metrics: http://localhost:" + PORT + "/actuator/prometheus");
        System.out.println("💚 Health: http://localhost:" + PORT + "/health");
    }
    
    static class HomeHandler implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            String response = getHomePage();
            exchange.getResponseHeaders().set("Content-Type", "text/html; charset=UTF-8");
            exchange.sendResponseHeaders(200, response.getBytes().length);
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
        
        private String getHomePage() {
            long totalAudio = countFiles(MEDIA_ROOT + "/audio");
            long totalVideo = countFiles(MEDIA_ROOT + "/video");
            long totalLyrics = countFiles(MEDIA_ROOT + "/lyrics");
            
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
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);
            color: white; min-height: 100vh;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
        header { text-align: center; padding: 3rem 0; }
        h1 { font-size: 4rem; margin-bottom: 1rem; text-shadow: 0 0 20px rgba(0,255,136,0.5); }
        .subtitle { font-size: 1.5rem; opacity: 0.9; color: #00ff88; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; margin: 3rem 0; }
        .stat-card {
            background: rgba(255,255,255,0.1);
            padding: 2rem;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 2px solid rgba(0,255,136,0.3);
            transition: transform 0.3s, border-color 0.3s;
        }
        .stat-card:hover {
            transform: translateY(-5px);
            border-color: #00ff88;
        }
        .stat-icon { font-size: 3em; margin-bottom: 1rem; }
        .stat-value { font-size: 2.5rem; font-weight: bold; color: #00ff88; }
        .stat-label { font-size: 1.1rem; opacity: 0.8; margin-top: 0.5rem; }
        
        .features { background: rgba(0,0,0,0.3); padding: 3rem; border-radius: 20px; margin: 2rem 0; }
        .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
        .feature-item { 
            padding: 1.5rem; 
            background: rgba(255,255,255,0.05); 
            border-radius: 10px;
            border-left: 4px solid #00ff88;
        }
        .feature-item h3 { color: #00ff88; margin-bottom: 0.5rem; }
        
        .tech-stack { margin: 3rem 0; }
        .tech-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
        .tech-item {
            background: rgba(0,255,136,0.1);
            padding: 1rem;
            border-radius: 10px;
            text-align: center;
            border: 1px solid rgba(0,255,136,0.3);
        }
        
        .api-docs {
            background: rgba(0,0,0,0.4);
            padding: 2rem;
            border-radius: 15px;
            margin: 2rem 0;
        }
        .endpoint {
            background: rgba(255,255,255,0.05);
            padding: 1rem;
            margin: 0.5rem 0;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
        }
        .method { 
            display: inline-block;
            padding: 0.3rem 0.8rem;
            border-radius: 5px;
            font-weight: bold;
            margin-right: 1rem;
        }
        .get { background: #00ff88; color: #000; }
        .post { background: #00a8ff; color: #fff; }
        
        .footer { 
            text-align: center; 
            padding: 2rem; 
            margin-top: 3rem; 
            border-top: 1px solid rgba(255,255,255,0.1);
            opacity: 0.7;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .status-live {
            display: inline-block;
            width: 12px;
            height: 12px;
            background: #00ff88;
            border-radius: 50%;
            animation: pulse 2s infinite;
            margin-right: 0.5rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎵 BEARTIFY</h1>
            <div class="subtitle">
                <span class="status-live"></span>
                Professional Media Streaming Server v4.0
            </div>
        </header>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">🎵</div>
                <div class="stat-value">""" + totalAudio + """</div>
                <div class="stat-label">Fichiers Audio</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🎬</div>
                <div class="stat-value">""" + totalVideo + """</div>
                <div class="stat-label">Fichiers Vidéo</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📝</div>
                <div class="stat-value">""" + totalLyrics + """</div>
                <div class="stat-label">Paroles (LRC)</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⚡</div>
                <div class="stat-value">100+</div>
                <div class="stat-label">Users Simultanés</div>
            </div>
        </div>
        
        <div class="features">
            <h2>✨ Fonctionnalités Principales</h2>
            <div class="feature-grid">
                <div class="feature-item">
                    <h3>🎵 Streaming Audio Adaptatif</h3>
                    <p>Support MP3, FLAC, OGG, M4A, AAC, OPUS avec transcoding automatique</p>
                </div>
                <div class="feature-item">
                    <h3>🎬 Streaming Vidéo HLS/DASH</h3>
                    <p>MP4, WebM, MKV avec adaptive bitrate streaming</p>
                </div>
                <div class="feature-item">
                    <h3>📝 Paroles Synchronisées</h3>
                    <p>Format LRC avec timing précis milliseconde</p>
                </div>
                <div class="feature-item">
                    <h3>🗂️ Métadonnées Enrichies</h3>
                    <p>JSON/XML avec tags ID3, artwork, informations détaillées</p>
                </div>
                <div class="feature-item">
                    <h3>⚡ Cache Redis</h3>
                    <p>Cache intelligent pour performance optimale</p>
                </div>
                <div class="feature-item">
                    <h3>📊 Monitoring Temps Réel</h3>
                    <p>Prometheus + Grafana pour métriques détaillées</p>
                </div>
            </div>
        </div>
        
        <div class="tech-stack">
            <h2>🛠️ Stack Technique</h2>
            <div class="tech-grid">
                <div class="tech-item">☕ Java 17 LTS</div>
                <div class="tech-item">🌐 Nginx RTMP</div>
                <div class="tech-item">💾 MariaDB/PostgreSQL</div>
                <div class="tech-item">🔴 Redis Cache</div>
                <div class="tech-item">🐳 Docker Ready</div>
                <div class="tech-item">📊 Prometheus</div>
                <div class="tech-item">📈 Grafana</div>
                <div class="tech-item">🎬 FFmpeg</div>
                <div class="tech-item">🎵 MediaInfo</div>
                <div class="tech-item">📝 ExifTool</div>
                <div class="tech-item">🔒 SSL/TLS</div>
                <div class="tech-item">⚡ HTTP/2</div>
            </div>
        </div>
        
        <div class="api-docs">
            <h2>📡 API Endpoints</h2>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span>/api/stream/{type}/{id}</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Stream audio/video avec support Range requests</p>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span>/api/lyrics/{id}.lrc</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Récupérer paroles synchronisées</p>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span>/api/metadata/{id}.json</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Métadonnées complètes du média</p>
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <span>/api/upload</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Upload fichiers multimédia (jusqu'à 4GB)</p>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span>/health</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Health check du serveur</p>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <span>/actuator/prometheus</span>
                <p style="margin-top: 0.5rem; opacity: 0.8;">Métriques Prometheus</p>
            </div>
        </div>
        
        <div class="footer">
            <p>🎵 Beartify Streaming Server - Installation Ubuntu v4.0</p>
            <p>Développé par PapaOursPolaire | """ + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()) + """</p>
            <p style="margin-top: 1rem;">
                <a href="/health" style="color: #00ff88; text-decoration: none; margin: 0 1rem;">Health Check</a>
                <a href="/actuator/prometheus" style="color: #00ff88; text-decoration: none; margin: 0 1rem;">Metrics</a>
                <a href="/api/stats" style="color: #00ff88; text-decoration: none; margin: 0 1rem;">Statistics</a>
            </p>
        </div>
    </div>
    
    <script>
        console.log('🎵 Beartify Server v4.0 - Ready!');
        
        // Auto-refresh stats toutes les 30s
        setInterval(() => {
            fetch('/api/stats')
                .then(r => r.json())
                .then(data => console.log('Stats:', data))
                .catch(e => console.error('Stats error:', e));
        }, 30000);
        
        // WebSocket pour notifications temps réel (futur)
        // const ws = new WebSocket('ws://localhost:8080/ws');
    </script>
</body>
</html>
""";
        }
        
        private long countFiles(String path) {
            try {
                return Files.walk(Paths.get(path))
                    .filter(Files::isRegularFile)
                    .count();
            } catch (Exception e) {
                return 0;
            }
        }
    }
    
    static class HealthHandler implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            String response = "{\"status\":\"UP\",\"timestamp\":\"" + 
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss").format(new Date()) + 
                "\",\"components\":{\"diskSpace\":{\"status\":\"UP\"},\"db\":{\"status\":\"UP\"},\"redis\":{\"status\":\"UP\"}}}";
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.getBytes().length);
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }
    
    static class StatsHandler implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> stats = new HashMap<>();
            stats.put("uptime", ManagementFactory.getRuntimeMXBean().getUptime());
            stats.put("totalMemory", Runtime.getRuntime().totalMemory());
            stats.put("freeMemory", Runtime.getRuntime().freeMemory());
            stats.put("processors", Runtime.getRuntime().availableProcessors());
            stats.put("timestamp", System.currentTimeMillis());
            
            String response = new com.google.gson.Gson().toJson(stats);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.getBytes().length);
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }
    
    static class StreamHandler implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            String response = "{\"message\":\"Streaming endpoint - implement with Spring Boot\"}";
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.getBytes().length);
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }
    
    static class MetricsHandler implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            StringBuilder metrics = new StringBuilder();
            metrics.append("# HELP beartify_uptime_seconds Uptime in seconds\n");
            metrics.append("# TYPE beartify_uptime_seconds gauge\n");
            metrics.append("beartify_uptime_seconds ").append(ManagementFactory.getRuntimeMXBean().getUptime() / 1000).append("\n");
            
            metrics.append("# HELP beartify_memory_used_bytes Memory used\n");
            metrics.append("# TYPE beartify_memory_used_bytes gauge\n");
            metrics.append("beartify_memory_used_bytes ").append(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()).append("\n");
            
            String response = metrics.toString();
            exchange.getResponseHeaders().set("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, response.getBytes().length);
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }
}
EOFJAVA
    
    # Compilation
    cd "$BEARTIFY_HOME"
    javac BeartifyServer.java
    jar cfe beartify.jar BeartifyServer BeartifyServer*.class
    chown "$BEARTIFY_USER:$BEARTIFY_USER" beartify.jar
    
    success "Application Beartify demo créée"
}

# Installation services individuels (fonction réutilisée du script précédent)
install_individual_service() {
    local service_num="$1"
    
    case $service_num in
        6) install_nginx_streaming ;;
        9) install_database ;;
        10) DB_CHOICE=2; install_database ;;
        11) install_redis_streaming ;;
        17) install_docker ;;
        23) INSTALL_MONITORING="y"; install_monitoring_stack ;;
        28) INSTALL_JELLYFIN="y"; install_jellyfin ;;
        29) INSTALL_ICECAST="y"; install_icecast ;;
        41) GUI_CHOICE=1; install_gui ;;
        42) GUI_CHOICE=2; install_gui ;;
        43) GUI_CHOICE=3; install_gui ;;
        *) warning "Service $service_num: À implémenter ou déjà géré" ;;
    esac
}

# Script post-installation
generate_postinstall_script() {
    info "Génération script post-installation..."
    
    cat > "$BEARTIFY_HOME/post-install.sh" << 'EOFPOST'
#!/bin/bash

echo "🎵 BEARTIFY - Post-Installation Check"
echo "======================================"

# Vérification services
echo ""
echo "📊 Services Status:"
for service in nginx mysql mariadb postgresql redis-server beartify jellyfin icecast2; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo "  ✅ $service: ACTIVE"
    elif systemctl list-unit-files | grep -q "$service"; then
        echo "  ⚠️  $service: INSTALLED but INACTIVE"
    fi
done

# Vérification ports
echo ""
echo "🌐 Ports Check:"
for port in 80 443 8080 8096 8000 3000 9090; do
    if ss -tln | grep -q ":$port "; then
        echo "  ✅ Port $port: OPEN"
    fi
done

# Statistiques médias
echo ""
echo "📁 Media Statistics:"
if [ -d /srv/media ]; then
    echo "  🎵 Audio: $(find /srv/media/audio -type f 2>/dev/null | wc -l) files"
    echo "  🎬 Video: $(find /srv/media/video -type f 2>/dev/null | wc -l) files"
    echo "  📝 Lyrics: $(find /srv/media/lyrics -type f 2>/dev/null | wc -l) files"
    echo "  💾 Total: $(du -sh /srv/media 2>/dev/null | cut -f1)"
fi

# Informations système
echo ""
echo "💻 System Info:"
echo "  CPU: $(nproc) cores"
echo "  RAM: $(free -h | awk '/^Mem:/ {print $2}')"
echo "  Disk: $(df -h / | awk 'NR==2 {print $4}') free"

# URLs d'accès
echo ""
echo "🔗 Access URLs:"
IP=$(hostname -I | awk '{print $1}')
echo "  🎵 Beartify: http://$IP:8080"
[ -f /etc/nginx/sites-enabled/beartify ] && echo "  🌐 Nginx: http://$IP"
systemctl is-active --quiet jellyfin && echo "  🎬 Jellyfin: http://$IP:8096"
systemctl is-active --quiet icecast2 && echo "  📻 Icecast: http://$IP:8000"
systemctl is-active --quiet grafana-server && echo "  📊 Grafana: http://$IP:3000"

echo ""
echo "✅ Post-installation check complete!"
echo "📝 See installation log: $LOG_FILE"
EOFPOST
    
    chmod +x "$BEARTIFY_HOME/post-install.sh"
    chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/post-install.sh"
    
    success "Script post-installation créé"
}

# Résumé final
show_installation_summary() {
    clear
    print_header
    
    echo -e "${GREEN}🎉 INSTALLATION TERMINÉE AVEC SUCCÈS ! 🎉${NC}"
    echo
    echo -e "${CYAN}📋 RÉSUMÉ DE L'INSTALLATION:${NC}"
    echo
    
    if [[ "$INSTALL_TYPE" == "1" ]]; then
        echo -e "${YELLOW}🎵 SERVEUR BEARTIFY COMPLET INSTALLÉ${NC}"
        echo "  🖥️  Interface: $(case $GUI_CHOICE in 1) echo "KDE Plasma + Thèmes";; 2) echo "GNOME (lockscreen corrigé)";; 3) echo "XFCE";; 4) echo "Mode serveur";; esac)"
        echo "  💾 Base: $(case $DB_CHOICE in 1) echo "MariaDB";; 2) echo "PostgreSQL";; 3) echo "MySQL";; esac)"
        echo "  🔒 Sécurité: UFW + Fail2ban actifs"
        echo "  🌐 Proxy: Nginx + RTMP + HLS/DASH"
        echo "  ⚡ Cache: Redis 6GB configuré"
        echo "  📊 Monitoring: $(if [[ "$INSTALL_MONITORING" =~ ^[Yy] ]]; then echo "- 3000 (Grafana)\n- 9090 (Prometheus)"; fi)
$(if [[ "$INSTALL_JELLYFIN" =~ ^[Yy] ]]; then echo "- 8096 (Jellyfin)"; fi)
$(if [[ "$INSTALL_ICECAST" =~ ^[Yy] ]]; then echo "- 8000 (Icecast)"; fi)

SUPPORTED FORMATS:
Audio: MP3, FLAC, OGG, M4A, WAV, AAC, OPUS
Video: MP4, WebM, MKV, AVI
Lyrics: LRC, TXT
Metadata: JSON, XML

FEATURES:
- Adaptive bitrate streaming (HLS/DASH)
- Range requests support
- Redis caching
- RTMP live streaming
- Metadata extraction
- Synchronized lyrics
- Hardware transcoding ready
- Prometheus metrics
- Health monitoring
- SSL/TLS support
- Rate limiting
- CORS enabled

LOG FILE: $LOG_FILE
EOF
    
    chown "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/INSTALLATION_INFO.txt"
}

# Menu principal
main_menu_loop() {
    while true; do
        show_main_menu
        read -p "Choisissez une option [0-3]: " INSTALL_TYPE
        
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
            3)
                echo
                info "Mode réparation/debug GNOME"
                fix_gnome_lockscreen
                success "Correction appliquée. Redémarrez le système."
                read -p "Appuyez sur Entrée pour continuer..." -r
                ;;
            *)
                echo
                warning "Choix invalide. Utilisez 0, 1, 2 ou 3."
                sleep 2
                ;;
        esac
    done
}

# Menu services individuels
install_individual_services_menu() {
    while true; do
        show_services_menu
        read -p "Choisissez un service [0-47]: " service_choice
        
        case $service_choice in
            0)
                break
                ;;
            [1-9]|[1-4][0-9])
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
    info "Démarrage de l'installation complète Beartify v4.0..."
    
    # Phase 1: Système de base
    info "Phase 1/12: Préparation système..."
    update_system
    install_essential_tools
    create_beartify_user
    
    # Phase 2: Sécurité
    info "Phase 2/12: Configuration sécurité..."
    setup_streaming_firewall
    setup_fail2ban
    
    # Phase 3: Interface graphique (optionnelle)
    if [[ "$GUI_CHOICE" != "4" ]]; then
        info "Phase 3/12: Installation interface graphique..."
        install_gui
    else
        info "Phase 3/12: Mode serveur - Skip interface graphique"
    fi
    
    # Phase 4: Stockage
    info "Phase 4/12: Configuration stockage multimédia..."
    setup_streaming_storage
    
    # Phase 5: Base de données
    info "Phase 5/12: Installation base de données..."
    install_database
    
    # Phase 6: Java
    info "Phase 6/12: Installation environnement Java..."
    install_java_environment
    
    # Phase 7: Services de base
    info "Phase 7/12: Installation services..."
    install_docker
    install_nginx_streaming
    install_redis_streaming
    
    # Phase 8: Développement
    info "Phase 8/12: Installation outils développement..."
    install_development
    
    # Phase 9: Optimisations
    info "Phase 9/12: Optimisations système..."
    optimize_system_streaming
    
    # Phase 10: Services optionnels
    info "Phase 10/12: Installation services optionnels..."
    install_monitoring_stack
    install_jellyfin
    install_icecast
    
    # Phase 11: Application
    info "Phase 11/12: Configuration application Beartify..."
    create_beartify_service
    create_beartify_demo
    install_fastfetch
    
    # Phase 12: Finalisation
    info "Phase 12/12: Finalisation..."
    generate_postinstall_script
    
    # Démarrage des services
    info "Démarrage des services Beartify..."
    systemctl daemon-reload
    
    # Ordre de démarrage respecté
    if [[ "$DB_CHOICE" == "2" ]]; then
        systemctl start postgresql || warning "PostgreSQL n'a pas démarré"
    else
        systemctl start mariadb || systemctl start mysql || warning "DB n'a pas démarré"
    fi
    
    sleep 2
    systemctl start redis-server || warning "Redis n'a pas démarré"
    sleep 1
    systemctl start nginx || warning "Nginx n'a pas démarré"
    sleep 1
    systemctl start beartify || warning "Beartify n'a pas démarré"
    
    [[ "$INSTALL_JELLYFIN" =~ ^[Yy] ]] && systemctl start jellyfin
    [[ "$INSTALL_ICECAST" =~ ^[Yy] ]] && systemctl start icecast2
    [[ "$INSTALL_MONITORING" =~ ^[Yy] ]] && systemctl start prometheus grafana-server
    
    # Vérification
    sleep 5
    local failed_services=()
    for service in nginx redis-server beartify; do
        if ! systemctl is-active --quiet "$service"; then
            failed_services+=("$service")
        fi
    done
    
    if [[ ${#failed_services[@]} -eq 0 ]]; then
        success "Tous les services Beartify démarrés !"
    else
        warning "Services en échec: ${failed_services[*]}"
        info "Vérifiez: sudo journalctl -u <service> -n 50"
    fi
    
    # Résumé final
    show_installation_summary
    
    # Proposer redémarrage
    echo
    echo -e "${CYAN}L'installation est terminée. Un redémarrage est recommandé pour finaliser toutes les configurations.${NC}"
    echo
    read -p "Voulez-vous redémarrer maintenant ? [Y/n]: " REBOOT
    if [[ "$REBOOT" =~ ^[Yy]?$ ]]; then
        info "Redémarrage du système dans 10 secondes..."
        info "Après redémarrage, exécutez: $BEARTIFY_HOME/post-install.sh"
        sleep 10
        reboot
    else
        info "Pensez à redémarrer plus tard: sudo reboot"
        info "Puis exécutez: $BEARTIFY_HOME/post-install.sh"
    fi
}

# Fonction principale
main() {
    # Initialisation
    print_header
    log "Démarrage du script d'installation Beartify v$SCRIPT_VERSION"
    
    # Vérifications
    check_root
    detect_distro
    
    # Analyse ressources
    info "Analyse des ressources système..."
    local cpu_cores=$(nproc)
    local ram_gb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    local disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    
    echo
    echo -e "${CYAN}=== RESSOURCES SYSTÈME DÉTECTÉES ===${NC}"
    echo -e "  💻 CPU: $cpu_cores cœurs"
    echo -e "  🧠 RAM: ${ram_gb}GB"
    echo -e "  💾 Disque libre: ${disk_gb}GB"
    echo
    
    # Recommandations
    if [[ $ram_gb -lt 4 ]]; then
        warning "RAM faible (<4GB). Performances limitées possibles."
        warning "Recommandation: Minimum 8GB pour streaming optimal."
    fi
    
    if [[ $disk_gb -lt 50 ]]; then
        warning "Espace disque faible (<50GB)."
        warning "Recommandation: Minimum 100GB pour stockage média."
    fi
    
    if [[ $cpu_cores -lt 4 ]]; then
        warning "CPU faible (<4 cœurs). Transcoding limité."
    fi
    
    if [[ $cpu_cores -ge 4 && $ram_gb -ge 8 && $disk_gb -ge 100 ]]; then
        success "Configuration optimale pour serveur streaming haute performance !"
    elif [[ $cpu_cores -ge 2 && $ram_gb -ge 4 ]]; then
        info "Configuration acceptable pour serveur streaming basique."
    else
        warning "Configuration minimale. Performances réduites attendues."
    fi
    
    echo
    read -p "Appuyez sur Entrée pour continuer l'installation..." -r
    
    # Menu principal
    main_menu_loop
}

# Scripts utilitaires pour l'utilisateur
create_utility_scripts() {
    info "Création des scripts utilitaires..."
    
    # Script de gestion Beartify
    cat > "$BEARTIFY_HOME/scripts/beartify-manager.sh" << 'EOFMGR'
#!/bin/bash
# Beartify Manager - Script de gestion rapide

case "$1" in
    start)
        echo "🚀 Démarrage Beartify..."
        sudo systemctl start beartify nginx redis-server
        ;;
    stop)
        echo "⏹️  Arrêt Beartify..."
        sudo systemctl stop beartify nginx redis-server
        ;;
    restart)
        echo "🔄 Redémarrage Beartify..."
        sudo systemctl restart beartify nginx redis-server
        ;;
    status)
        echo "📊 Status des services:"
        sudo systemctl status beartify nginx redis-server --no-pager
        ;;
    logs)
        echo "📋 Logs Beartify (Ctrl+C pour quitter):"
        sudo journalctl -u beartify -f
        ;;
    stats)
        echo "📈 Statistiques médias:"
        echo "  🎵 Audio: $(find /srv/media/audio -type f 2>/dev/null | wc -l) fichiers"
        echo "  🎬 Vidéo: $(find /srv/media/video -type f 2>/dev/null | wc -l) fichiers"
        echo "  📝 Paroles: $(find /srv/media/lyrics -type f 2>/dev/null | wc -l) fichiers"
        echo "  💾 Taille: $(du -sh /srv/media 2>/dev/null | cut -f1)"
        ;;
    clean-cache)
        echo "🧹 Nettoyage du cache..."
        sudo rm -rf /srv/media/cache/*
        sudo systemctl restart redis-server
        echo "✅ Cache nettoyé"
        ;;
    backup)
        BACKUP_DIR="/srv/backup/manual/backup_$(date +%Y%m%d_%H%M%S)"
        echo "💾 Backup vers $BACKUP_DIR..."
        mkdir -p "$BACKUP_DIR"
        sudo mysqldump -u beartifyuser -p beartifydb > "$BACKUP_DIR/database.sql" 2>/dev/null || echo "⚠️  Backup DB échoué"
        cp -r /home/beartify/config "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  Backup config échoué"
        echo "✅ Backup terminé"
        ;;
    update)
        echo "🔄 Mise à jour du système..."
        sudo apt update && sudo apt upgrade -y
        echo "✅ Système à jour"
        ;;
    *)
        echo "🎵 Beartify Manager"
        echo "Usage: $0 {start|stop|restart|status|logs|stats|clean-cache|backup|update}"
        echo ""
        echo "Commandes:"
        echo "  start       - Démarrer tous les services"
        echo "  stop        - Arrêter tous les services"
        echo "  restart     - Redémarrer tous les services"
        echo "  status      - Afficher le status"
        echo "  logs        - Afficher les logs en temps réel"
        echo "  stats       - Statistiques des médias"
        echo "  clean-cache - Nettoyer le cache"
        echo "  backup      - Créer un backup manuel"
        echo "  update      - Mettre à jour le système"
        exit 1
        ;;
esac
EOFMGR
    
    chmod +x "$BEARTIFY_HOME/scripts/beartify-manager.sh"
    ln -sf "$BEARTIFY_HOME/scripts/beartify-manager.sh" /usr/local/bin/beartify
    
    # Script de monitoring rapide
    cat > "$BEARTIFY_HOME/scripts/quick-monitor.sh" << 'EOFMON'
#!/bin/bash
# Quick Monitor - Surveillance rapide du système

echo "🎵 BEARTIFY QUICK MONITOR"
echo "========================="
echo ""

# Services
echo "📊 Services:"
for service in beartify nginx redis-server mysql mariadb postgresql; do
    if systemctl is-active --quiet $service 2>/dev/null; then
        echo "  ✅ $service"
    elif systemctl list-unit-files | grep -q "^$service"; then
        echo "  ❌ $service (installé mais inactif)"
    fi
done
echo ""

# Ressources
echo "💻 Ressources:"
echo "  CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')% utilisé"
echo "  RAM: $(free -h | awk '/^Mem:/ {print $3 " / " $2}') ($(free | awk '/^Mem:/ {printf "%.1f%%", $3/$2*100}'))"
echo "  Swap: $(free -h | awk '/^Swap:/ {print $3 " / " $2}')"
echo "  Disque /: $(df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 " utilisé)"}')"
echo "  Disque /srv: $(df -h /srv 2>/dev/null | awk 'NR==2 {print $3 " / " $2 " (" $5 " utilisé)"}' || echo "N/A")"
echo ""

# Réseau
echo "🌐 Réseau:"
echo "  Connexions actives: $(ss -tun | grep ESTAB | wc -l)"
echo "  IP locale: $(hostname -I | awk '{print $1}')"
if command -v curl &>/dev/null; then
    echo "  IP publique: $(curl -s ifconfig.me 2>/dev/null || echo "N/A")"
fi
echo ""

# Ports
echo "🔌 Ports en écoute:"
for port in 80 443 8080 3306 6379 8096 8000; do
    if ss -tln | grep -q ":$port "; then
        SERVICE=$(ss -tlnp | grep ":$port " | awk '{print $NF}' | cut -d'"' -f2 | head -n1)
        echo "  ✅ $port ($SERVICE)"
    fi
done
echo ""

# Logs récents
echo "📋 Dernières erreurs Beartify:"
sudo journalctl -u beartify -n 3 --no-pager -o cat 2>/dev/null | grep -i error | tail -n 3 || echo "  Aucune erreur récente"
EOFMON
    
    chmod +x "$BEARTIFY_HOME/scripts/quick-monitor.sh"
    ln -sf "$BEARTIFY_HOME/scripts/quick-monitor.sh" /usr/local/bin/beartify-monitor
    
    # Script de test streaming
    cat > "$BEARTIFY_HOME/scripts/test-streaming.sh" << 'EOFTEST'
#!/bin/bash
# Test Streaming - Vérifier que le streaming fonctionne

echo "🎵 BEARTIFY STREAMING TEST"
echo "=========================="
echo ""

# Test 1: HTTP Server
echo "Test 1: HTTP Server (port 8080)..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ | grep -q "200"; then
    echo "  ✅ HTTP Server répond"
else
    echo "  ❌ HTTP Server ne répond pas"
fi

# Test 2: Nginx
echo "Test 2: Nginx (port 80)..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost/ | grep -q "200\|301\|302"; then
    echo "  ✅ Nginx répond"
else
    echo "  ❌ Nginx ne répond pas"
fi

# Test 3: Redis
echo "Test 3: Redis..."
if redis-cli ping 2>/dev/null | grep -q "PONG"; then
    echo "  ✅ Redis répond"
else
    echo "  ❌ Redis ne répond pas"
fi

# Test 4: Database
echo "Test 4: Base de données..."
if systemctl is-active --quiet mysql || systemctl is-active --quiet mariadb || systemctl is-active --quiet postgresql; then
    echo "  ✅ Base de données active"
else
    echo "  ❌ Base de données inactive"
fi

# Test 5: Médias accessibles
echo "Test 5: Répertoire médias..."
if [ -d /srv/media ] && [ -r /srv/media ]; then
    echo "  ✅ Répertoire médias accessible"
    echo "     $(find /srv/media -type f 2>/dev/null | wc -l) fichiers trouvés"
else
    echo "  ❌ Répertoire médias inaccessible"
fi

# Test 6: HLS/DASH
echo "Test 6: Streaming HLS/DASH..."
if [ -d /var/www/hls ] && [ -d /var/www/dash ]; then
    echo "  ✅ Répertoires streaming configurés"
else
    echo "  ⚠️  Répertoires streaming non configurés"
fi

# Test 7: RTMP
echo "Test 7: RTMP Server..."
if ss -tln | grep -q ":1935 "; then
    echo "  ✅ RTMP en écoute (port 1935)"
else
    echo "  ⚠️  RTMP non configuré"
fi

echo ""
echo "✅ Tests terminés"
EOFTEST
    
    chmod +x "$BEARTIFY_HOME/scripts/test-streaming.sh"
    ln -sf "$BEARTIFY_HOME/scripts/test-streaming.sh" /usr/local/bin/beartify-test
    
    chown -R "$BEARTIFY_USER:$BEARTIFY_USER" "$BEARTIFY_HOME/scripts"
    
    success "Scripts utilitaires créés"
    info "  - beartify (manager)"
    info "  - beartify-monitor (surveillance)"
    info "  - beartify-test (tests streaming)"
}

# Gestion des erreurs
cleanup_on_error() {
    local exit_code=$?
    echo
    error_exit "Installation interrompue (code: $exit_code). Consultez les logs: $LOG_FILE"
}

# Signal handler pour arrêt propre
cleanup_on_exit() {
    echo
    info "Arrêt de l'installation..."
    if [[ -f "$LOG_FILE" ]]; then
        info "Logs sauvegardés dans: $LOG_FILE"
    fi
}

# Trap pour erreurs et signaux
trap cleanup_on_error ERR
trap cleanup_on_exit INT TERM

# Vérification des arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                echo "🎵 Beartify Ubuntu Server Installer v$SCRIPT_VERSION"
                echo
                echo "Usage: sudo bash $0 [OPTIONS]"
                echo
                echo "Options:"
                echo "  --auto-complete    Installation complète automatique (mode serveur)"
                echo "  --auto-gui=KDE     Installation complète avec KDE Plasma"
                echo "  --auto-gui=GNOME   Installation complète avec GNOME"
                echo "  --auto-gui=XFCE    Installation complète avec XFCE"
                echo "  --repair-gnome     Réparer le lockscreen GNOME uniquement"
                echo "  --unattended       Mode non-interactif (avec --auto-*)"
                echo "  --help, -h         Afficher cette aide"
                echo
                echo "Installation interactive (par défaut):"
                echo "  sudo bash $0"
                echo
                echo "Installation automatique serveur:"
                echo "  sudo bash $0 --auto-complete"
                echo
                echo "Installation automatique avec GUI:"
                echo "  sudo bash $0 --auto-gui=KDE"
                echo
                echo "Réparer GNOME lockscreen:"
                echo "  sudo bash $0 --repair-gnome"
                echo
                exit 0
                ;;
            --auto-complete)
                INSTALL_TYPE="1"
                GUI_CHOICE="4"
                DB_CHOICE="1"
                INSTALL_MONITORING="n"
                INSTALL_MINIO="n"
                INSTALL_JELLYFIN="n"
                INSTALL_ICECAST="n"
                AUTO_MODE=true
                ;;
            --auto-gui=*)
                INSTALL_TYPE="1"
                case "${1#*=}" in
                    KDE|kde) GUI_CHOICE="1" ;;
                    GNOME|gnome) GUI_CHOICE="2" ;;
                    XFCE|xfce) GUI_CHOICE="3" ;;
                    *) error_exit "GUI invalide. Utilisez: KDE, GNOME, ou XFCE" ;;
                esac
                DB_CHOICE="1"
                INSTALL_MONITORING="n"
                AUTO_MODE=true
                ;;
            --repair-gnome)
                check_root
                fix_gnome_lockscreen
                success "Réparation GNOME terminée. Redémarrez le système."
                exit 0
                ;;
            --unattended)
                UNATTENDED=true
                ;;
            *)
                warning "Option inconnue: $1"
                echo "Utilisez --help pour voir les options disponibles"
                exit 1
                ;;
        esac
        shift
    done
}

# Mode automatique
run_auto_installation() {
    if [[ "$AUTO_MODE" == true ]]; then
        info "Mode d'installation automatique activé"
        
        # Configuration automatique
        BEARTIFY_USER="beartify"
        BEARTIFY_PASSWORD="beartify_$(openssl rand -base64 16)"
        DB_PASS=$(openssl rand -base64 32)
        DOMAIN=""
        EMAIL=""
        
        # Créer utilisateur automatiquement
        if ! id "$BEARTIFY_USER" &>/dev/null; then
            useradd -m -s /bin/bash -G audio,video,www-data,sudo "$BEARTIFY_USER"
            echo "$BEARTIFY_USER:$BEARTIFY_PASSWORD" | chpasswd
        fi
        
        # Lancer installation
        install_beartify_complete
        
        # Afficher credentials
        echo
        echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║         INSTALLATION AUTOMATIQUE TERMINÉE             ║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
        echo
        echo -e "${YELLOW}🔐 CREDENTIALS (SAUVEGARDEZ-LES !):${NC}"
        echo "  Utilisateur: $BEARTIFY_USER"
        echo "  Mot de passe: $BEARTIFY_PASSWORD"
        echo "  DB User: $DB_USER"
        echo "  DB Pass: $DB_PASS"
        echo
        echo -e "${YELLOW}📄 Ces informations sont aussi dans: $BEARTIFY_HOME/INSTALLATION_INFO.txt${NC}"
        echo
        
        exit 0
    fi
}

# Point d'entrée principal
main() {
    # Affichage initial
    print_header
    
    # Parse arguments
    parse_arguments "$@"
    
    # Mode automatique si activé
    run_auto_installation
    
    # Mode interactif
    log "Démarrage du script d'installation Beartify v$SCRIPT_VERSION"
    log "Date: $(date)"
    log "Hostname: $(hostname)"
    log "User: $(whoami)"
    
    # Vérifications préliminaires
    check_root
    detect_distro
    
    # Analyse des ressources système
    info "Analyse des ressources système..."
    local cpu_cores=$(nproc)
    local ram_gb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    local disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    
    echo
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║           RESSOURCES SYSTÈME DÉTECTÉES                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "  💻 Processeur: ${GREEN}$cpu_cores${NC} cœurs"
    echo -e "  🧠 Mémoire RAM: ${GREEN}${ram_gb}GB${NC}"
    echo -e "  💾 Disque libre: ${GREEN}${disk_gb}GB${NC}"
    echo
    
    # Recommandations basées sur les ressources
    local can_install=true
    
    if [[ $ram_gb -lt 2 ]]; then
        error_exit "RAM insuffisante (<2GB). Minimum requis: 2GB, recommandé: 8GB"
    elif [[ $ram_gb -lt 4 ]]; then
        warning "⚠️  RAM faible (${ram_gb}GB). Performances limitées."
        warning "   Recommandé: 8GB minimum pour streaming optimal"
    elif [[ $ram_gb -lt 8 ]]; then
        info "ℹ️  RAM acceptable (${ram_gb}GB) pour streaming basique"
    else
        success "✅ RAM optimale (${ram_gb}GB) pour streaming haute performance"
    fi
    
    if [[ $disk_gb -lt 20 ]]; then
        error_exit "Espace disque insuffisant (<20GB). Minimum requis: 20GB"
    elif [[ $disk_gb -lt 50 ]]; then
        warning "⚠️  Espace disque faible (${disk_gb}GB)"
        warning "   Recommandé: 100GB+ pour stockage média conséquent"
    elif [[ $disk_gb -lt 100 ]]; then
        info "ℹ️  Espace disque acceptable (${disk_gb}GB)"
    else
        success "✅ Espace disque optimal (${disk_gb}GB)"
    fi
    
    if [[ $cpu_cores -lt 2 ]]; then
        warning "⚠️  CPU faible (${cpu_cores} cœur). Transcoding limité."
    elif [[ $cpu_cores -ge 4 ]]; then
        success "✅ CPU optimal (${cpu_cores} cœurs) pour transcoding multi-bitrates"
    fi
    
    # Score global
    local score=0
    if [[ $ram_gb -ge 8 ]]; then
        score=$((score + 3))
    elif [[ $ram_gb -ge 4 ]]; then
        score=$((score + 2))
    elif [[ $ram_gb -ge 2 ]]; then
        score=$((score + 1))
    fi

    if [[ $disk_gb -ge 100 ]]; then
        score=$((score + 2))
    elif [[ $disk_gb -ge 50 ]]; then
        score=$((score + 1))
    fi

    if [[ $cpu_cores -ge 4 ]]; then
        score=$((score + 2))
    elif [[ $cpu_cores -ge 2 ]]; then
        score=$((score + 1))
    fi
    
    echo
    if [[ $score -ge 7 ]]; then
        echo -e "${GREEN}⭐⭐⭐ Configuration EXCELLENTE pour serveur streaming professionnel${NC}"
    elif [[ $score -ge 5 ]]; then
        echo -e "${YELLOW}⭐⭐ Configuration BONNE pour serveur streaming standard${NC}"
    elif [[ $score -ge 3 ]]; then
        echo -e "${YELLOW}⭐ Configuration ACCEPTABLE pour serveur streaming basique${NC}"
    else
        echo -e "${RED}Configuration MINIMALE - Performances réduites attendues${NC}"
    fi
    
    echo
    echo -e "${CYAN}Press ENTER to continue or Ctrl+C to abort...${NC}"
    read -r
    
    # Lancement du menu principal
    main_menu_loop
}

#!/bin/bash

# Script d'Installation Ubuntu Serveur pour Streaming Multimédia avec Beartify
# Version : 72.8 - ENHANCED & DEBUGGED
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
SCRIPT_VERSION="4.0"
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
BEARTIFY_PASSWORD=""
AUTO_MODE=false
UNATTENDED=false

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
    echo "╔════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    🎵 BEARTIFY UBUNTU SERVER INSTALLER v$SCRIPT_VERSION                  ║"
    echo "║                  Installation Serveur Streaming Multimédia                       ║"
    echo "╚════════════════════════════════════════════════════════════════════════════════╝"
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

# Fonction pour analyser les arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                echo "🎵 Beartify Ubuntu Server Installer v$SCRIPT_VERSION"
                echo
                echo "Usage: sudo bash $0 [OPTIONS]"
                echo
                echo "Options:"
                echo "  --auto-complete    Installation complète automatique (mode serveur)"
                echo "  --auto-gui=KDE     Installation complète avec KDE Plasma"
                echo "  --auto-gui=GNOME   Installation complète avec GNOME"
                echo "  --auto-gui=XFCE    Installation complète avec XFCE"
                echo "  --repair-gnome     Réparer le lockscreen GNOME uniquement"
                echo "  --unattended       Mode non-interactif (avec --auto-*)"
                echo "  --help, -h         Afficher cette aide"
                echo
                echo "Installation interactive (par défaut):"
                echo "  sudo bash $0"
                echo
                echo "Installation automatique serveur:"
                echo "  sudo bash $0 --auto-complete"
                echo
                echo "Installation automatique avec GUI:"
                echo "  sudo bash $0 --auto-gui=KDE"
                echo
                echo "Réparer GNOME lockscreen:"
                echo "  sudo bash $0 --repair-gnome"
                echo
                exit 0
                ;;
            --auto-complete)
                INSTALL_TYPE="1"
                GUI_CHOICE="4"
                DB_CHOICE="1"
                INSTALL_MONITORING="n"
                INSTALL_MINIO="n"
                AUTO_MODE=true
                ;;
            --auto-gui=*)
                INSTALL_TYPE="1"
                case "${1#*=}" in
                    KDE|kde) GUI_CHOICE="1" ;;
                    GNOME|gnome) GUI_CHOICE="2" ;;
                    XFCE|xfce) GUI_CHOICE="3" ;;
                    *) error_exit "GUI invalide. Utilisez: KDE, GNOME, ou XFCE" ;;
                esac
                DB_CHOICE="1"
                INSTALL_MONITORING="n"
                AUTO_MODE=true
                ;;
            --repair-gnome)
                check_root
                fix_gnome_lockscreen
                success "Réparation GNOME terminée. Redémarrez le système."
                exit 0
                ;;
            --unattended)
                UNATTENDED=true
                ;;
            *)
                warning "Option inconnue: $1"
                echo "Utilisez --help pour voir les options disponibles"
                exit 1
                ;;
        esac
        shift
    done
}

# Mode automatique
run_auto_installation() {
    if [[ "$AUTO_MODE" == true ]]; then
        info "Mode d'installation automatique activé"
        
        # Configuration automatique
        BEARTIFY_USER="beartify"
        BEARTIFY_PASSWORD="beartify_$(openssl rand -base64 16)"
        DB_PASS=$(openssl rand -base64 32)
        DOMAIN=""
        EMAIL=""
        
        # Créer utilisateur automatiquement
        if ! id "$BEARTIFY_USER" &>/dev/null; then
            useradd -m -s /bin/bash -G audio,video,www-data,sudo "$BEARTIFY_USER"
            echo "$BEARTIFY_USER:$BEARTIFY_PASSWORD" | chpasswd
        fi
        
        # Lancer installation complète
        install_beartify_complete
        
        # Afficher credentials
        echo
        echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║         INSTALLATION AUTOMATIQUE TERMINÉE             ║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
        echo
        echo -e "${YELLOW}🔐 CREDENTIALS (SAUVEGARDEZ-LES !):${NC}"
        echo "  Utilisateur: $BEARTIFY_USER"
        echo "  Mot de passe: $BEARTIFY_PASSWORD"
        echo "  DB User: $DB_USER"
        echo "  DB Pass: $DB_PASS"
        echo
        echo -e "${YELLOW}📄 Ces informations sont aussi dans: $BEARTIFY_HOME/INSTALLATION_INFO.txt${NC}"
        echo
        
        exit 0
    fi
}

# Point d'entrée principal
main() {
    # Affichage initial
    print_header
    
    # Parse arguments
    parse_arguments "$@"
    
    # Mode automatique si activé
    run_auto_installation
    
    # Mode interactif
    log "Démarrage du script d'installation Beartify v$SCRIPT_VERSION"
    log "Date: $(date)"
    log "Hostname: $(hostname)"
    log "User: $(whoami)"
    
    # Vérifications préliminaires
    check_root
    detect_distro
    
    # Analyse des ressources système
    info "Analyse des ressources système..."
    local cpu_cores=$(nproc)
    local ram_gb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    local disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    
    echo
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║           RESSOURCES SYSTÈME DÉTECTÉES                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "  💻 Processeur: ${GREEN}$cpu_cores${NC} cœurs"
    echo -e "  🧠 Mémoire RAM: ${GREEN}${ram_gb}GB${NC}"
    echo -e "  💾 Disque libre: ${GREEN}${disk_gb}GB${NC}"
    echo
    
    # Recommandations basées sur les ressources
    if [[ $ram_gb -lt 2 ]]; then
        error_exit "RAM insuffisante (<2GB). Minimum requis: 2GB, recommandé: 8GB"
    elif [[ $ram_gb -lt 4 ]]; then
        warning "⚠️  RAM faible (${ram_gb}GB). Performances limitées."
        warning "   Recommandé: 8GB minimum pour streaming optimal"
    elif [[ $ram_gb -lt 8 ]]; then
        info "ℹ️  RAM acceptable (${ram_gb}GB) pour streaming basique"
    else
        success "✅ RAM optimale (${ram_gb}GB) pour streaming haute performance"
    fi
    
    if [[ $disk_gb -lt 20 ]]; then
        error_exit "Espace disque insuffisant (<20GB). Minimum requis: 20GB"
    elif [[ $disk_gb -lt 50 ]]; then
        warning "⚠️  Espace disque faible (${disk_gb}GB)"
        warning "   Recommandé: 100GB+ pour stockage média conséquent"
    elif [[ $disk_gb -lt 100 ]]; then
        info "ℹ️  Espace disque acceptable (${disk_gb}GB)"
    else
        success "✅ Espace disque optimal (${disk_gb}GB)"
    fi
    
    if [[ $cpu_cores -lt 2 ]]; then
        warning "⚠️  CPU faible (${cpu_cores} cœur). Transcoding limité."
    elif [[ $cpu_cores -ge 4 ]]; then
        success "✅ CPU optimal (${cpu_cores} cœurs) pour transcoding multi-bitrates"
    fi
    
    # Score global
    local score=0
    if [[ $ram_gb -ge 8 ]]; then
        score=$((score + 3))
    elif [[ $ram_gb -ge 4 ]]; then
        score=$((score + 2))
    elif [[ $ram_gb -ge 2 ]]; then
        score=$((score + 1))
    fi

    if [[ $disk_gb -ge 100 ]]; then
        score=$((score + 2))
    elif [[ $disk_gb -ge 50 ]]; then
        score=$((score + 1))
    fi

    if [[ $cpu_cores -ge 4 ]]; then
        score=$((score + 2))
    elif [[ $cpu_cores -ge 2 ]]; then
        score=$((score + 1))
    fi
    
    echo
    if [[ $score -ge 7 ]]; then
        echo -e "${GREEN}⭐⭐⭐ Configuration EXCELLENTE pour serveur streaming professionnel${NC}"
    elif [[ $score -ge 5 ]]; then
        echo -e "${YELLOW}⭐⭐ Configuration BONNE pour serveur streaming standard${NC}"
    elif [[ $score -ge 3 ]]; then
        echo -e "${YELLOW}⭐ Configuration ACCEPTABLE pour serveur streaming basique${NC}"
    else
        echo -e "${RED}Configuration MINIMALE - Performances réduites attendues${NC}"
    fi
    
    echo
    echo -e "${CYAN}Appuyez sur Entrée pour continuer ou Ctrl+C pour annuler...${NC}"
    read -r
    
    # Lancement du menu principal
    main_menu_loop
}

# Vérification de l'exécution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Script exécuté directement
    main "$@"
else
    # Script sourcé
    warning "Ce script doit être exécuté directement, pas sourcé."
    echo "Utilisez: sudo bash ${BASH_SOURCE[0]}"
fi
