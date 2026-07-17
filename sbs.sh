#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  setup-beartify-stats.sh
# ═══════════════════════════════════════════════════════════════════
#  Met en place TOUT ce dont stats-cron.js a besoin, au bon endroit,
#  en une seule fois : dossiers, copie du script, fichier .env avec les
#  chemins déjà corrects (LYRICS_DIR = /home/papaours/Téléchargements),
#  et timer systemd qui déclenche le calcul toutes les heures.
#
#  Ce script NE renseigne PAS les identifiants sensibles (clé API
#  Jellyfin, identifiants Nextcloud) — il laisse des emplacements vides
#  et clairement marqués dans le .env, à remplir ensuite à la main.
#
#  Usage :
#    chmod +x setup-beartify-stats.sh
#    ./setup-beartify-stats.sh
#
#  Doit être lancé depuis le dossier où se trouve stats-cron.js
#  (celui téléchargé avec ce script) ; sudo sera utilisé automatiquement
#  pour les étapes qui en ont besoin (dossier système, unités systemd).
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Paramètres — à ajuster si besoin avant de lancer ─────────────────
INSTALL_DIR="/opt/beartify"
LYRICS_DIR="/home/papaours/Téléchargements"
SERVICE_USER="${SUDO_USER:-$USER}"
SCRIPT_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══════════════════════════════════════════════════════════"
echo " Beartify — installation de l'automatisation des statistiques"
echo "═══════════════════════════════════════════════════════════"
echo "Dossier d'installation : $INSTALL_DIR"
echo "Dossier des paroles     : $LYRICS_DIR"
echo "Utilisateur système     : $SERVICE_USER"
echo ""

# ── 1) Vérifications préalables ───────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé ou pas dans le PATH. Installe-le avant de continuer."
  exit 1
fi
NODE_VERSION="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ est requis (fetch natif). Version détectée : $(node -v)."
  exit 1
fi

if [ ! -f "$SCRIPT_SOURCE_DIR/stats-cron.js" ]; then
  echo "❌ stats-cron.js introuvable dans $SCRIPT_SOURCE_DIR."
  echo "   Place ce script .sh dans le même dossier que stats-cron.js puis relance-le."
  exit 1
fi

if [ ! -d "$LYRICS_DIR" ]; then
  echo "⚠️  $LYRICS_DIR n'existe pas encore — création..."
  mkdir -p "$LYRICS_DIR"
fi

# ── 2) Création de l'arborescence ─────────────────────────────────────
echo "→ Création de $INSTALL_DIR ..."
sudo mkdir -p "$INSTALL_DIR/stats-output"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# ── 3) Copie des fichiers ─────────────────────────────────────────────
echo "→ Copie de stats-cron.js ..."
cp "$SCRIPT_SOURCE_DIR/stats-cron.js" "$INSTALL_DIR/stats-cron.js"

# ── 4) Fichier d'environnement (squelette — secrets à compléter) ──────
ENV_FILE="$INSTALL_DIR/.env.stats"
if [ -f "$ENV_FILE" ]; then
  echo "→ $ENV_FILE existe déjà — non écrasé (pour ne pas perdre des identifiants déjà saisis)."
else
  echo "→ Création de $ENV_FILE (chemins pré-remplis, secrets à compléter)..."
  cat > "$ENV_FILE" <<EOF
# ═══════════════════════════════════════════════════════════════════
#  Configuration stats-cron.js — Beartify
#  ⚠️  Fichier sensible : permissions 600, ne jamais commiter.
# ═══════════════════════════════════════════════════════════════════

# ── Jellyfin ───────────────────────────────────────────────────────
JELLYFIN_URL=http://127.0.0.1:8096
JELLYFIN_API_KEY=

# ── Paroles synchronisées (déjà correct, ne pas modifier sauf besoin) ─
LYRICS_DIR=$LYRICS_DIR

# ── Nextcloud (WebDAV) ─────────────────────────────────────────────
NEXTCLOUD_WEBDAV_URL=
NEXTCLOUD_USER=
NEXTCLOUD_PASSWORD=
NEXTCLOUD_REMOTE_DIR=/Beartify/public

# ── Sortie locale ────────────────────────────────────────────────────
OUTPUT_DIR=$INSTALL_DIR/stats-output
EOF
  chmod 600 "$ENV_FILE"
fi

# ── 5) Unités systemd (timer horaire) ─────────────────────────────────
echo "→ Installation du service et du timer systemd..."

sudo tee /etc/systemd/system/beartify-stats.service > /dev/null <<EOF
[Unit]
Description=Beartify - calcul horaire des statistiques du catalogue
After=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $INSTALL_DIR/stats-cron.js --once
EOF

sudo tee /etc/systemd/system/beartify-stats.timer > /dev/null <<EOF
[Unit]
Description=Déclenche beartify-stats.service toutes les heures

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable beartify-stats.timer

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✅ Installation terminée."
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Il reste à faire, à la main :"
echo "  1. Compléter $ENV_FILE :"
echo "       JELLYFIN_API_KEY, NEXTCLOUD_WEBDAV_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD"
echo "  2. Démarrer le timer :"
echo "       sudo systemctl start beartify-stats.timer"
echo "  3. Lancer un premier calcul immédiat pour vérifier que tout fonctionne :"
echo "       sudo systemctl start beartify-stats.service"
echo "       journalctl -u beartify-stats.service -f"
echo "  4. Une fois stats.json/stats.js confirmés sur Nextcloud, créer un lien de"
echo "     partage public pour stats.json et mettre à jour STATS_URL dans"
echo "     onboarding.js avec cette URL."
echo ""
