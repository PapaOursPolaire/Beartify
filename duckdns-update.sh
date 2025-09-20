# duckdns-update.sh
#!/bin/bash
# ================================================================
# Script : duckdns-update.sh
# Description :
#   Ce script met à jour automatiquement l'IP publique
#   associée à un domaine DuckDNS gratuit (DNS dynamique).
#
# Fonctionnement :
#   - Récupère ton IP publique
#   - Envoie une requête à DuckDNS avec ton token et ton domaine
#   - Enregistre un log avec la date et le résultat
#
# Pré-requis :
#   1. Crée un compte gratuit sur https://www.duckdns.org/
#   2. Ajoute un domaine gratuit (ex: monserveur.duckdns.org)
#   3. Copie ton token personnel affiché sur ton compte DuckDNS
#   4. Remplis DOMAIN et TOKEN ci-dessous
#
# Déploiement :
#   1. Place ce script dans /usr/local/bin/duckdns-update.sh
#   2. Rends-le exécutable : chmod +x /usr/local/bin/duckdns-update.sh
#   3. Teste-le manuellement : ./duckdns-update.sh
#   4. Configure une tâche CRON pour exécuter toutes les 5 min :
#        crontab -e
#        */5 * * * * /usr/local/bin/duckdns-update.sh >/dev/null 2>&1
#
# Vérification :
#   - Vérifie le fichier duckdns.log pour voir les mises à jour
#   - Ping ton domaine : ping monserveur.duckdns.org
# ================================================================

# À personnaliser :
DOMAIN="tonserveur"   # ex: monserveur → ton domaine sera monserveur.duckdns.org
TOKEN="votre_token_duckdns_ici"

# Dossier de travail
WORKDIR="$HOME/duckdns"
LOGFILE="$WORKDIR/duckdns.log"

mkdir -p "$WORKDIR"

# Mise à jour DuckDNS
echo "$(date): Mise à jour en cours..." >> "$LOGFILE"
RESULT=$(curl -s "https://www.duckdns.org/update?domains=$DOMAIN&token=$TOKEN&ip=")

# Résultat
echo "$(date): Résultat = $RESULT" >> "$LOGFILE"

