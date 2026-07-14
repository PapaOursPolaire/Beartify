#!/usr/bin/env bash
# ============================================================================
#  install-libretranslate.sh — Remplace Lingva par LibreTranslate auto-hébergé
#  pour Beartify (proxifié par Caddy sur /api/translate, port local 3003).
#
#  Différences importantes par rapport à Lingva :
#   - LibreTranslate ne scrape rien : il fait tourner ses propres modèles de
#     traduction en local (moteur Argos). Aucune dépendance à Google, mais
#     ça veut aussi dire :
#       1) le TOUT PREMIER démarrage télécharge les modèles de langue
#          (peut prendre plusieurs minutes selon ta connexion),
#       2) chaque traduction fait tourner un modèle neuronal en local, donc
#          c'est plus lent qu'un simple scraping (d'où les délais augmentés
#          côté Caddy et côté script.js),
#       3) il n'existe plus de mirroir public gratuit fiable pour se replier
#          dessus (contrairement à Lingva) — cette instance locale doit donc
#          être fiable, d'où les tests approfondis ci-dessous.
#
#  Ce script :
#   1) Installe Docker s'il est absent
#   2) Déploie libretranslate/libretranslate, lié UNIQUEMENT à 127.0.0.1:3003
#   3) Ne charge que les langues utilisées par ton sélecteur de paramètres
#      (modifiable via la variable LANGUAGES ci-dessous)
#   4) Attend la fin du téléchargement des modèles (peut être long la 1ère fois)
#   5) Vérifie que ça TRADUIT réellement, pas juste "le port répond"
#   6) Recharge Caddy et teste le chemin complet via ton domaine public
#
#  Idempotent : relançable sans risque (supprime/recrée le conteneur).
#  Usage : sudo bash install-libretranslate.sh
# ============================================================================
set -euo pipefail

HOST_BIND="127.0.0.1"          # jamais 0.0.0.0 : accès uniquement via Caddy
HOST_PORT="3003"               # doit correspondre à (libretranslate_proxy) dans le Caddyfile
CONTAINER_PORT="5000"          # port interne fixe de l'image
IMAGE="libretranslate/libretranslate:latest"
NAME="libretranslate"
DOMAIN="beartify.duckdns.org"  # domaine public défini dans le Caddyfile
MEM_LIMIT="4g"                 # plafond RAM du conteneur, ajustable

# Langues chargées au démarrage = celles de ton sélecteur dans settings.js.
# Laisser vide (LANGUAGES="") pour charger TOUTES les langues disponibles
# (beaucoup plus lourd en RAM/disque et bien plus long à démarrer).
LANGUAGES="fr,en,es,de,it,pt,nl,ja,ko,zh"

c_info() { printf '\n\033[1;36m➜ %s\033[0m\n' "$1"; }
c_ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$1"; }
c_err()  { printf '\033[1;31m✘ %s\033[0m\n' "$1" >&2; }

if [[ $EUID -ne 0 ]]; then
  c_err "Lance ce script en root : sudo bash install-libretranslate.sh"
  exit 1
fi

# ── 1. Docker ──────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  c_info "Docker absent → installation via le script officiel get.docker.com"
  curl -fsSL https://get.docker.com | sh
else
  c_ok "Docker déjà présent ($(docker --version))"
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ── 2. Libérer le port 3003, peu importe QUI l'occupe ──────────────────────
# Important : si un ancien conteneur Lingva (ou autre) tourne encore sur ce
# port, "docker run -d" pour LibreTranslate va ÉCHOUER à démarrer (le port
# est déjà pris), mais laissera quand même un conteneur en état "Created" —
# silencieux si on ne vérifie pas explicitement, d'où le check à l'étape 4.
OCCUPANTS="$(docker ps -a --filter "publish=${HOST_PORT}" --format '{{.Names}}' 2>/dev/null || true)"
if [[ -n "$OCCUPANTS" ]]; then
  c_info "Port ${HOST_PORT} déjà utilisé par : ${OCCUPANTS} → suppression"
  echo "$OCCUPANTS" | xargs -r docker rm -f >/dev/null
fi
# Filet de sécurité : un vieux conteneur nommé explicitement lingva-translate
# ou libretranslate mais qui n'apparaîtrait pas via --filter publish (bug
# connu sur de très vieilles versions de Docker).
for old in lingva-translate "$NAME"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$old"; then
    c_info "Conteneur '$old' existant → suppression"
    docker rm -f "$old" >/dev/null
  fi
done

# ── 3. Image ────────────────────────────────────────────────────────────────
c_info "Récupération de l'image $IMAGE"
docker pull "$IMAGE"

# ── 4. Lancement du conteneur ────────────────────────────────────────────────
c_info "Démarrage sur ${HOST_BIND}:${HOST_PORT} → conteneur:${CONTAINER_PORT}"
echo "   Langues chargées : ${LANGUAGES:-toutes}"
RUN_ARGS=(
  -d --name "$NAME" --restart unless-stopped
  -p "${HOST_BIND}:${HOST_PORT}:${CONTAINER_PORT}"
  --memory="$MEM_LIMIT"
  # DNS publics explicites : sur beaucoup de systèmes (Ubuntu/Debian avec
  # systemd-resolved), /etc/resolv.conf de l'hôte pointe vers 127.0.0.53,
  # une adresse qui n'a aucun sens depuis l'intérieur d'un conteneur (c'est
  # sa PROPRE loopback, pas celle de l'hôte). Sans ça, le téléchargement
  # des modèles Argos échoue avec "Temporary failure in name resolution".
  --dns=1.1.1.1 --dns=8.8.8.8
  -e LT_DISABLE_WEB_UI=true
)
[[ -n "$LANGUAGES" ]] && RUN_ARGS+=(-e "LT_LOAD_ONLY=${LANGUAGES}")
if ! docker run "${RUN_ARGS[@]}" "$IMAGE" >/dev/null; then
  c_err "\"docker run\" a échoué (voir l'erreur ci-dessus — souvent un port déjà occupé)."
  exit 1
fi

# "docker run" peut réussir à CRÉER le conteneur tout en échouant à le
# DÉMARRER (port déjà occupé, par ex.) sans faire remonter d'erreur au
# shell — le conteneur reste alors bloqué en état "Created" pour toujours.
# D'où cette vérification explicite de l'état réel avant de continuer.
sleep 2
STATUS="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo unknown)"
if [[ "$STATUS" != "running" ]]; then
  c_err "Le conteneur est en état '${STATUS}' au lieu de 'running'."
  echo "   Cause la plus fréquente : le port ${HOST_PORT} était déjà occupé"
  echo "   par autre chose (ancien conteneur Lingva par ex.) au moment du"
  echo "   démarrage. Pour identifier qui l'occupe :"
  echo "     sudo ss -tlnp | grep ${HOST_PORT}"
  echo "   Logs du conteneur (vides si jamais démarré) :"
  docker logs --tail 40 "$NAME" 2>&1 || true
  exit 1
fi
c_ok "Conteneur démarré (état: running)"

# ── 5/6. Attente + test réel de traduction (combinés) ───────────────────────
# Pas de vérification "le port répond" séparée : tant que les modèles ne sont
# pas chargés, une simple requête HTTP peut répondre sans pouvoir traduire.
# Le seul test qui veut dire quelque chose, c'est une VRAIE traduction.
c_info "Attente du démarrage (le tout premier lancement télécharge les modèles, ça peut prendre plusieurs minutes)..."
UP=0
MAX_WAIT=600   # 10 minutes pour laisser le temps au 1er téléchargement
ELAPSED=0
RESP=""
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  RESP="$(curl -fsS --max-time 20 -X POST "http://${HOST_BIND}:${HOST_PORT}/translate" \
    -H "Content-Type: application/json" \
    -d '{"q":"hello world","source":"en","target":"fr","format":"text"}' 2>/dev/null || true)"
  if echo "$RESP" | grep -q '"translatedText"'; then
    UP=1; break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if (( ELAPSED % 30 == 0 )); then
    echo "   ... toujours en attente (${ELAPSED}s) — voir 'docker logs -f $NAME' pour le détail"
  fi
done

if [[ "$UP" -ne 1 ]]; then
  c_err "Toujours pas de traduction valide après ${MAX_WAIT}s. Logs du conteneur :"
  docker logs --tail 80 "$NAME"
  exit 1
fi
c_ok "LibreTranslate traduit correctement côté serveur."
echo "  Réponse : $RESP"

# ── 7. Reload Caddy + test de bout en bout via le domaine public ──────────
if systemctl is-active --quiet caddy 2>/dev/null; then
  c_info "Rechargement de Caddy"
  systemctl reload caddy && c_ok "Caddy rechargé"
else
  echo "   (service systemd 'caddy' non actif/détecté — recharge-le manuellement si besoin)"
fi

c_info "Test de bout en bout via https://${DOMAIN}/api/translate/..."
E2E="$(curl -fsSk --max-time 20 -X POST "https://${DOMAIN}/api/translate/translate" \
  -H "Content-Type: application/json" \
  -d '{"q":"hello world","source":"en","target":"fr","format":"text"}' 2>/dev/null || true)"
if echo "$E2E" | grep -q '"translatedText"'; then
  c_ok "Chemin complet navigateur → Caddy → LibreTranslate fonctionnel. Tout est prêt !"
else
  c_err "Le conteneur local fonctionne mais le chemin via Caddy échoue encore."
  echo "   → Vérifie que 'import libretranslate_proxy' est bien présent dans le bloc"
  echo "     '${DOMAIN} { ... }' de ton Caddyfile, puis : sudo systemctl reload caddy"
  echo "   Réponse brute reçue : ${E2E:-<vide>}"
fi

echo
c_ok "Terminé."
