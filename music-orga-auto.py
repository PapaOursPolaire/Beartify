#!/usr/bin/env python3
"""
music-orga-auto.py
---------------------
Réorganise et nettoie automatiquement une bibliothèque musicale Jellyfin.

FONCTIONNALITÉS :
  1. FUSION    – Déplace tous les fichiers audio vers Artiste/Album/ selon
                 leur tag ALBUM embarqué (traite aussi les sous-sous-dossiers).
  2. NETTOYAGE – Supprime les fichiers superflus détectés par leur nom :
                 remix, live, acoustic, extended, bonus, slowed, reverb, etc.
  3. PURGE     – Supprime les dossiers vides après le nettoyage.
  4. CRON      – Peut tourner en arrière-plan de façon planifiée.

UTILISATION :
  # Simulation complète (rien n'est modifié) :
  python3 music-orga-auto.py /home/papaours/Musique --dry-run

  # Fusion seule (sans supprimer les remixes) :
  python3 music-orga-auto.py /home/papaours/Musique --no-delete

  # Exécution réelle + rapport :
  python3 music-orga-auto.py /home/papaours/Musique --log /var/log/music-orga.log

  # Installer le cron (tâche quotidienne à 03h00) :
  python3 music-orga-auto.py /home/papaours/Musique --install-cron

OPTIONS :
  --dry-run         Simule tout sans toucher aux fichiers
  --no-delete       Fusionne uniquement, ne supprime rien
  --log FICHIER     Rapport (défaut : rapport_organisation.log)
  --install-cron    Installe une tâche cron quotidienne (03h00)
  --remove-cron     Supprime la tâche cron installée
  --patterns FICH   Fichier JSON de patterns personnalisés (optionnel)
"""

import os
import sys
import json
import shutil
import argparse
import unicodedata
import re
import subprocess
import logging
from datetime import datetime
from pathlib import Path

try:
    from mutagen import File as MutagenFile
except ImportError:
    print("❌  La bibliothèque 'mutagen' est requise : pip install mutagen")
    sys.exit(1)


# ---------------------------------------------------------------------------
# PATTERNS DE SUPPRESSION (insensible à la casse)
# Appliqués sur le NOM DU FICHIER (sans extension)
# ---------------------------------------------------------------------------
DEFAULT_DELETE_PATTERNS: list[str] = [
    # Remixes
    r'\bremix\b',
    r'\bremixed\b',
    r'\brmx\b',
    r'\bedit\b',           # radio edit, club edit…
    r'\bvip mix\b',
    r'\bvip\b',
    r'\brework\b',
    r'\bflip\b',
    r'\bbootleg\b',
    r'\bmashup\b',

    # Versions live / concert
    r'\blive\b',
    r'\bconcert\b',
    r'\bin concert\b',
    r'\bunplugged\b',
    r'\bsession\b',        # BBC session, live session…

    # Versions alternatives
    r'\bacoustic\b',
    r'\binstrumental\b',
    r'\bkaraoke\b',
    r'\ba cappella\b',
    r'\bacapella\b',

    # Extended / short
    r'\bextended\b',
    r'\bclub mix\b',
    r'\bradio mix\b',
    r'\bradio version\b',
    r'\bshort version\b',

    # Effets audio
    r'\bslowed\b',
    r'\breverb\b',
    r'\bsped[\s\-]?up\b',
    r'\bnightcore\b',
    r'\blofi\b',
    r'\blo[\s\-]fi\b',

    # Bonus / interlude
    r'\bbonus\b',
    r'\binterlude\b',
    r'\bskit\b',
    r'\boutro\b',
    r'\bintro\b',          # attention : peut être un vrai titre → voir --patterns

    # Rééditions
    r'\br[eé]édition\b',
    r'\breissue\b',
    r'\bdeluxe\b',         # "Deluxe Edition" contient souvent des bonus
    r'\banniversary\b',
]

AUDIO_EXTENSIONS = {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.aac', '.wav'}
FORBIDDEN_CHARS   = r'[<>:"/\\|?*\x00-\x1f]'
CRON_MARKER       = "# music-orga-auto"


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def setup_logging(log_path: Path) -> logging.Logger:
    log = logging.getLogger("music-orga")
    log.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    # Console
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    log.addHandler(ch)
    # Fichier (append)
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    return log


def sanitize_name(name: str) -> str:
    name = unicodedata.normalize("NFC", name)
    name = re.sub(FORBIDDEN_CHARS, "_", name)
    name = name.strip(". ")
    return name or "Album_Inconnu"


def get_album_tag(filepath: Path) -> str | None:
    try:
        audio = MutagenFile(filepath, easy=True)
        if audio is None or audio.tags is None:
            return None
        album = audio.tags.get("album") or audio.tags.get("ALBUM")
        if isinstance(album, list):
            album = album[0]
        return str(album).strip() if album else None
    except Exception:
        return None


def is_superfluous(filename: str, patterns: list[str]) -> str | None:
    """Retourne le pattern correspondant si le fichier est superflus, sinon None."""
    stem = Path(filename).stem.lower()
    for pat in patterns:
        if re.search(pat, stem, re.IGNORECASE):
            return pat
    return None


def remove_empty_dirs(root: Path, log: logging.Logger, dry_run: bool):
    """Supprime récursivement les dossiers vides sous root (sauf root lui-même)."""
    removed = 0
    # On parcourt de bas en haut
    for dirpath in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not dirpath.is_dir() or dirpath == root:
            continue
        try:
            contents = list(dirpath.iterdir())
        except PermissionError:
            continue
        if not contents:
            if dry_run:
                log.info(f"[SIMUL] Dossier vide supprimé : {dirpath}")
            else:
                dirpath.rmdir()
                log.info(f"🗑️  Dossier vide supprimé : {dirpath}")
            removed += 1
    return removed


# ---------------------------------------------------------------------------
# Logique principale
# ---------------------------------------------------------------------------

def collect_audio_files(music_root: Path) -> list[Path]:
    """Collecte tous les fichiers audio dans tous les sous-dossiers d'artistes."""
    files = []
    for artist_dir in sorted(music_root.iterdir()):
        if not artist_dir.is_dir():
            continue
        for item in sorted(artist_dir.rglob("*")):
            if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS:
                files.append(item)
    return files


def run(music_root: Path, dry_run: bool, no_delete: bool,
        patterns: list[str], log: logging.Logger) -> dict:

    music_root = music_root.resolve()
    log.info(f"{'[SIMULATION]' if dry_run else '[EXÉCUTION]'}  Racine : {music_root}")

    all_files = collect_audio_files(music_root)
    log.info(f"Fichiers audio trouvés : {len(all_files)}")

    stats = dict(found=len(all_files), deleted=0, merged=0,
                 skipped_no_album=0, skipped_collision=0, errors=0,
                 empty_dirs=0)

    deleted_files   = []
    merged_files    = []
    no_album_files  = []
    collision_files = []
    error_files     = []

    # ── Étape 1 : suppression des fichiers superflus ──────────────────────
    if not no_delete:
        log.info("── Étape 1 : détection et suppression des fichiers superflus ──")
        for filepath in all_files[:]:          # copie pour itérer en supprimant
            matched = is_superfluous(filepath.name, patterns)
            if matched:
                if dry_run:
                    log.info(f"  [SIMUL] SUPPR  {filepath.relative_to(music_root)}"
                             f"  (pattern: {matched})")
                else:
                    try:
                        filepath.unlink()
                        log.info(f"  🗑️  {filepath.relative_to(music_root)}")
                    except Exception as e:
                        log.error(f"  ❌ {filepath.name} : {e}")
                        error_files.append((filepath, str(e)))
                        stats["errors"] += 1
                        continue
                deleted_files.append(filepath)
                stats["deleted"] += 1
                all_files.remove(filepath)
    else:
        log.info("── Étape 1 : suppression désactivée (--no-delete) ──")

    # ── Étape 2 : fusion par tag ALBUM ────────────────────────────────────
    log.info("── Étape 2 : fusion des fichiers par tag ALBUM ──")
    for filepath in all_files:
        # Fichier encore présent ?
        if not filepath.exists():
            continue

        artist_dir = filepath.parts[len(music_root.parts)]   # nom du dossier artiste
        artist_path = music_root / artist_dir
        album = get_album_tag(filepath)

        if not album:
            no_album_files.append(filepath)
            stats["skipped_no_album"] += 1
            continue

        album_dir_name = sanitize_name(album)
        dest_dir  = artist_path / album_dir_name
        dest_file = dest_dir / filepath.name

        # Déjà au bon endroit ?
        if filepath.parent == dest_dir:
            continue

        # Collision
        if dest_file.exists():
            collision_files.append((filepath, dest_file))
            stats["skipped_collision"] += 1
            continue

        if dry_run:
            log.info(f"  [SIMUL] FUSION  {filepath.relative_to(music_root)}"
                     f"\n               → {dest_file.relative_to(music_root)}")
        else:
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(filepath), str(dest_file))
                merged_files.append((filepath, dest_file))
                stats["merged"] += 1
                log.info(f"  ✅ {filepath.name}  →  {album_dir_name}/")
            except Exception as e:
                error_files.append((filepath, str(e)))
                stats["errors"] += 1
                log.error(f"  ❌ {filepath.name} : {e}")

    # ── Étape 3 : purge des dossiers vides ────────────────────────────────
    log.info("── Étape 3 : suppression des dossiers vides ──")
    stats["empty_dirs"] = remove_empty_dirs(music_root, log, dry_run)

    # ── Rapport final ─────────────────────────────────────────────────────
    sep = "=" * 60
    log.info(sep)
    log.info("RAPPORT FINAL")
    log.info(f"  Fichiers trouvés      : {stats['found']}")
    log.info(f"  Supprimés (superflus) : {stats['deleted']}"
             + (" (simulation)" if dry_run else ""))
    log.info(f"  Fusionnés (album)     : {stats['merged']}"
             + (" (simulation)" if dry_run else ""))
    log.info(f"  Sans tag ALBUM        : {stats['skipped_no_album']}")
    log.info(f"  Collisions ignorées   : {stats['skipped_collision']}")
    log.info(f"  Dossiers vides purgés : {stats['empty_dirs']}")
    log.info(f"  Erreurs               : {stats['errors']}")

    if no_album_files:
        log.info("  Fichiers sans tag ALBUM :")
        for f in no_album_files:
            log.info(f"    {f.relative_to(music_root)}")

    if collision_files:
        log.info("  Collisions (ignorées) :")
        for src, dst in collision_files:
            log.info(f"    {src.relative_to(music_root)}  →  {dst.relative_to(music_root)}")

    log.info(sep)
    return stats


# ---------------------------------------------------------------------------
# Gestion du cron
# ---------------------------------------------------------------------------

def get_cron_line(script_path: str, music_root: str, log_path: str) -> str:
    python = sys.executable
    # Tous les jours à 03h00
    return (f"0 3 * * *  {python} {script_path} {music_root} "
            f"--log {log_path}  {CRON_MARKER}")


def install_cron(script_path: str, music_root: str, log_path: str):
    line = get_cron_line(script_path, music_root, log_path)
    try:
        existing = subprocess.check_output(["crontab", "-l"],
                                           stderr=subprocess.DEVNULL).decode()
    except subprocess.CalledProcessError:
        existing = ""

    if CRON_MARKER in existing:
        print("⚠️  Une tâche cron music-orga-auto est déjà installée.")
        print("   Utilisez --remove-cron pour la supprimer d'abord.")
        return

    new_crontab = existing.rstrip("\n") + "\n" + line + "\n"
    proc = subprocess.run(["crontab", "-"], input=new_crontab.encode(), check=True)
    print(f"✅ Tâche cron installée (quotidien 03h00) :")
    print(f"   {line}")


def remove_cron():
    try:
        existing = subprocess.check_output(["crontab", "-l"],
                                           stderr=subprocess.DEVNULL).decode()
    except subprocess.CalledProcessError:
        print("Aucun crontab existant.")
        return

    lines = [l for l in existing.splitlines() if CRON_MARKER not in l]
    new_crontab = "\n".join(lines) + "\n"
    subprocess.run(["crontab", "-"], input=new_crontab.encode(), check=True)
    print("✅ Tâche cron music-orga-auto supprimée.")


# ---------------------------------------------------------------------------
# Entrée principale
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Réorganise et nettoie automatiquement une bibliothèque musicale."
    )
    parser.add_argument("music_root", type=Path,
                        help="Dossier racine de la musique")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simule sans modifier les fichiers")
    parser.add_argument("--no-delete", action="store_true",
                        help="Fusionne uniquement, ne supprime pas les superflus")
    parser.add_argument("--log", type=Path,
                        default=Path("rapport_organisation.log"),
                        help="Fichier de log (défaut : rapport_organisation.log)")
    parser.add_argument("--patterns", type=Path, default=None,
                        help="Fichier JSON de patterns de suppression personnalisés")
    parser.add_argument("--install-cron", action="store_true",
                        help="Installe une tâche cron quotidienne (03h00)")
    parser.add_argument("--remove-cron", action="store_true",
                        help="Supprime la tâche cron installée")
    args = parser.parse_args()

    # ── Actions cron ──────────────────────────────────────────────────────
    if args.remove_cron:
        remove_cron()
        return

    if args.install_cron:
        install_cron(
            script_path=str(Path(__file__).resolve()),
            music_root=str(args.music_root.resolve()),
            log_path=str(args.log.resolve()),
        )
        return

    # ── Vérification du dossier racine ────────────────────────────────────
    if not args.music_root.is_dir():
        print(f"❌ Dossier introuvable : {args.music_root}")
        sys.exit(1)

    # ── Chargement des patterns ───────────────────────────────────────────
    patterns = DEFAULT_DELETE_PATTERNS[:]
    if args.patterns:
        try:
            with open(args.patterns, encoding="utf-8") as f:
                custom = json.load(f)
            if isinstance(custom, list):
                patterns = custom
                print(f"✅ Patterns personnalisés chargés : {args.patterns}")
            else:
                print("⚠️  Le fichier de patterns doit être une liste JSON.")
        except Exception as e:
            print(f"⚠️  Impossible de lire {args.patterns} : {e}")

    # ── Logging ───────────────────────────────────────────────────────────
    log = setup_logging(args.log)
    log.info(f"{'='*60}")
    log.info(f"music-orga-auto  –  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # ── Exécution ─────────────────────────────────────────────────────────
    run(
        music_root=args.music_root,
        dry_run=args.dry_run,
        no_delete=args.no_delete,
        patterns=patterns,
        log=log,
    )


if __name__ == "__main__":
    main()