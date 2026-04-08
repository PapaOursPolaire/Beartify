#!/usr/bin/env python3
"""
organise_par_album.py
---------------------
Réorganise une bibliothèque musicale Jellyfin en créant des sous-dossiers par album.

Structure AVANT :
  Musique/Artiste/chanson.flac

Structure APRÈS :
  Musique/Artiste/Nom de l'Album/chanson.flac

Le script lit le tag ALBUM embarqué dans chaque fichier FLAC (et MP3/M4A/OGG).
Les fichiers sans tag ALBUM sont laissés en place et listés dans un rapport.

UTILISATION :
  # Simulation (aucun fichier déplacé) :
  python3 organise_par_album.py /chemin/vers/Musique --dry-run

  # Exécution réelle :
  python3 organise_par_album.py /chemin/vers/Musique

OPTIONS :
  --dry-run     Affiche ce qui serait fait sans toucher aux fichiers
  --log FICHIER Enregistre le rapport dans un fichier (défaut : rapport_organisation.txt)
"""

import os
import sys
import shutil
import argparse
import unicodedata
import re
from pathlib import Path

try:
    from mutagen.flac import FLAC
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4
    from mutagen.oggvorbis import OggVorbis
    from mutagen import File as MutagenFile
except ImportError:
    print("❌ Erreur : la bibliothèque 'mutagen' est requise.")
    print("   Installez-la avec : pip install mutagen")
    sys.exit(1)


AUDIO_EXTENSIONS = {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.aac', '.wav'}

# Caractères interdits dans les noms de dossiers (Windows + Linux safe)
FORBIDDEN_CHARS = r'[<>:"/\\|?*\x00-\x1f]'


def sanitize_name(name: str) -> str:
    """Nettoie un nom pour en faire un nom de dossier valide."""
    # Normalisation Unicode
    name = unicodedata.normalize('NFC', name)
    # Remplacement des caractères interdits
    name = re.sub(FORBIDDEN_CHARS, '_', name)
    # Suppression des points et espaces en fin de chaîne
    name = name.strip('. ')
    return name or "Album_Inconnu"


def get_album_tag(filepath: Path) -> str | None:
    """Extrait le tag ALBUM d'un fichier audio. Retourne None si absent."""
    try:
        audio = MutagenFile(filepath, easy=True)
        if audio is None:
            return None
        tags = audio.tags
        if tags is None:
            return None
        album = tags.get('album') or tags.get('ALBUM')
        if isinstance(album, list):
            album = album[0]
        return str(album).strip() if album else None
    except Exception:
        return None


def collect_files(music_root: Path) -> list[Path]:
    """Collecte tous les fichiers audio dans les sous-dossiers d'artistes."""
    files = []
    for artist_dir in sorted(music_root.iterdir()):
        if not artist_dir.is_dir():
            continue
        for item in sorted(artist_dir.rglob('*')):
            if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS:
                # Ne traite que les fichiers directement dans le dossier artiste
                # (pas déjà dans un sous-dossier album)
                if item.parent == artist_dir:
                    files.append(item)
    return files


def organise(music_root: Path, dry_run: bool, log_path: Path):
    music_root = music_root.resolve()
    print(f"\n{'[SIMULATION]' if dry_run else '[EXÉCUTION]'} Racine : {music_root}\n")

    files = collect_files(music_root)
    print(f"📁 {len(files)} fichiers audio trouvés dans les dossiers d'artistes\n")

    moved = []
    skipped_no_album = []
    skipped_exists = []
    errors = []

    for filepath in files:
        artist_dir = filepath.parent
        album = get_album_tag(filepath)

        if not album:
            skipped_no_album.append(filepath)
            continue

        album_dir_name = sanitize_name(album)
        dest_dir = artist_dir / album_dir_name
        dest_file = dest_dir / filepath.name

        # Vérification de collision
        if dest_file.exists() and dest_file != filepath:
            skipped_exists.append((filepath, dest_file))
            continue

        if dry_run:
            print(f"  [SIMUL] {filepath.relative_to(music_root)}")
            print(f"       → {dest_file.relative_to(music_root)}")
        else:
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(filepath), str(dest_file))
                moved.append((filepath, dest_file))
                print(f"  ✅ {filepath.name}  →  {album_dir_name}/")
            except Exception as e:
                errors.append((filepath, str(e)))
                print(f"  ❌ {filepath.name} : {e}")

    # --- Rapport ---
    lines = []
    lines.append(f"=== Rapport d'organisation musicale ===")
    lines.append(f"Racine : {music_root}")
    lines.append(f"Mode   : {'Simulation' if dry_run else 'Réel'}\n")
    lines.append(f"Fichiers trouvés    : {len(files)}")
    lines.append(f"Déplacés            : {len(moved) if not dry_run else 'N/A (simulation)'}")
    lines.append(f"Sans tag ALBUM      : {len(skipped_no_album)}")
    lines.append(f"Collisions (ignorés): {len(skipped_exists)}")
    lines.append(f"Erreurs             : {len(errors)}\n")

    if skipped_no_album:
        lines.append("--- Fichiers sans tag ALBUM (non déplacés) ---")
        for f in skipped_no_album:
            lines.append(f"  {f.relative_to(music_root)}")

    if skipped_exists:
        lines.append("\n--- Collisions (destination déjà existante) ---")
        for src, dst in skipped_exists:
            lines.append(f"  {src.relative_to(music_root)}  →  {dst.relative_to(music_root)}")

    if errors:
        lines.append("\n--- Erreurs ---")
        for f, e in errors:
            lines.append(f"  {f.relative_to(music_root)} : {e}")

    report = '\n'.join(lines)
    print(f"\n{'='*60}")
    print(report)

    with open(log_path, 'w', encoding='utf-8') as lf:
        lf.write(report)
    print(f"\n📄 Rapport enregistré : {log_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Réorganise une bibliothèque musicale en sous-dossiers par album."
    )
    parser.add_argument(
        'music_root',
        type=Path,
        help="Chemin vers le dossier racine de la musique (ex: /home/papaours/Musique)"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help="Simule les déplacements sans modifier les fichiers"
    )
    parser.add_argument(
        '--log',
        type=Path,
        default=Path('rapport_organisation.txt'),
        help="Fichier de rapport (défaut : rapport_organisation.txt)"
    )
    args = parser.parse_args()

    if not args.music_root.is_dir():
        print(f"❌ Dossier introuvable : {args.music_root}")
        sys.exit(1)

    organise(args.music_root, args.dry_run, args.log)


if __name__ == '__main__':
    main()
