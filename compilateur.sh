papaours@papaours:~/Tauri$ chmod +x compilateur.sh
papaours@papaours:~/Tauri$ ./compilateur.sh
  [INFO]  Projet : /home/papaours/Tauri
Ce script installe des paquets systeme et necessite sudo.
[sudo] Mot de passe de papaours : 

================================================================
  ETAPE 1/8 - Paquets systeme Debian
================================================================
  [INFO]  Mise a jour des sources apt...
  [INFO]  Outils de base...
Lecture des listes de paquets... Fait
Construction de l'arbre des dépendances... Fait
Lecture des informations d'état... Fait      
build-essential est déjà la version la plus récente (12.12).
curl est déjà la version la plus récente (8.14.1-2+deb13u2).
wget est déjà la version la plus récente (1.25.0-2).
git est déjà la version la plus récente (1:2.47.3-0+deb13u1).
git passé en « installé manuellement ».
file est déjà la version la plus récente (1:5.46-5).
unzip est déjà la version la plus récente (6.0-29).
zip est déjà la version la plus récente (3.0-15).
zip passé en « installé manuellement ».
xz-utils est déjà la version la plus récente (5.8.1-1).
ca-certificates est déjà la version la plus récente (20250419).
gnupg est déjà la version la plus récente (2.4.7-21+deb13u1).
lsb-release est déjà la version la plus récente (12.1-1).
libssl-dev est déjà la version la plus récente (3.5.5-1~deb13u2).
libssl-dev passé en « installé manuellement ».
Le paquet suivant a été installé automatiquement et n'est plus nécessaire :
  linux-image-6.12.74+deb13+1-amd64
Veuillez utiliser « sudo apt autoremove » pour le supprimer.
Les NOUVEAUX paquets suivants seront installés :
  pkg-config
0 mis à jour, 1 nouvellement installés, 0 à enlever et 1 non mis à jour.
Il est nécessaire de prendre 14,0 kB dans les archives.
Après cette opération, 29,7 ko d'espace disque supplémentaires seront utilisés.
Réception de : 1 http://deb.debian.org/debian trixie/main amd64 pkg-config amd64 1.8.1-4 [14,0 kB]
14,0 ko réceptionnés en 0s (205 ko/s) 
Sélection du paquet pkg-config:amd64 précédemment désélectionné.
(Lecture de la base de données... 312908 fichiers et répertoires déjà installés.)
Préparation du dépaquetage de .../pkg-config_1.8.1-4_amd64.deb ...
Dépaquetage de pkg-config:amd64 (1.8.1-4) ...
Paramétrage de pkg-config:amd64 (1.8.1-4) ...
  [INFO]  Debian 13 (trixie) detecte
  [INFO]  Installation de webkit2gtk (requis par Tauri V2)...
Lecture des listes de paquets... Fait
Construction de l'arbre des dépendances... Fait
Lecture des informations d'état... Fait      
libwebkit2gtk-4.1-dev est déjà la version la plus récente (2.52.3-2~deb13u1).
libjavascriptcoregtk-4.1-dev est déjà la version la plus récente (2.52.3-2~deb13u1).
libjavascriptcoregtk-4.1-dev passé en « installé manuellement ».
libsoup-3.0-dev est déjà la version la plus récente (3.6.5-3).
libsoup-3.0-dev passé en « installé manuellement ».
Le paquet suivant a été installé automatiquement et n'est plus nécessaire :
  linux-image-6.12.74+deb13+1-amd64
Veuillez utiliser « sudo apt autoremove » pour le supprimer.
0 mis à jour, 0 nouvellement installés, 0 à enlever et 1 non mis à jour.
  [INFO]  Dependances Tauri supplementaires...
Lecture des listes de paquets... Fait
Construction de l'arbre des dépendances... Fait
Lecture des informations d'état... Fait      
Note : sélection de « libfuse2t64 » au lieu de « libfuse2 »
libgtk-3-dev est déjà la version la plus récente (3.24.49-3).
librsvg2-dev est déjà la version la plus récente (2.60.0+dfsg-1).
patchelf est déjà la version la plus récente (0.18.0-1.4).
libglib2.0-dev est déjà la version la plus récente (2.84.4-3~deb13u2).
libglib2.0-dev passé en « installé manuellement ».
libcairo2-dev est déjà la version la plus récente (1.18.4-1+b1).
libcairo2-dev passé en « installé manuellement ».
libpango1.0-dev est déjà la version la plus récente (1.56.3-1).
libpango1.0-dev passé en « installé manuellement ».
libgdk-pixbuf-2.0-dev est déjà la version la plus récente (2.42.12+dfsg-4+deb13u1).
libgdk-pixbuf-2.0-dev passé en « installé manuellement ».
libatk1.0-dev est déjà la version la plus récente (2.56.2-1+deb13u1).
libatk1.0-dev passé en « installé manuellement ».
libfuse2t64 est déjà la version la plus récente (2.9.9-9).
libfuse2t64 passé en « installé manuellement ».
Le paquet suivant a été installé automatiquement et n'est plus nécessaire :
  linux-image-6.12.74+deb13+1-amd64
Veuillez utiliser « sudo apt autoremove » pour le supprimer.
Les paquets supplémentaires suivants seront installés : 
  libxdo3
Les NOUVEAUX paquets suivants seront installés :
  fuse libxdo-dev libxdo3 squashfs-tools
0 mis à jour, 4 nouvellement installés, 0 à enlever et 1 non mis à jour.
Il est nécessaire de prendre 321 kB dans les archives.
Après cette opération, 1.343 ko d'espace disque supplémentaires seront utilisés.
Réception de : 1 http://deb.debian.org/debian trixie/main amd64 fuse all 3.17.2-3 [16,4 kB]
Réception de : 2 http://deb.debian.org/debian trixie/main amd64 libxdo3 amd64 1:3.20160805.1-5.1 [31,0 kB]
Réception de : 3 http://deb.debian.org/debian trixie/main amd64 libxdo-dev amd64 1:3.20160805.1-5.1 [79,2 kB]
Réception de : 4 http://deb.debian.org/debian trixie/main amd64 squashfs-tools amd64 1:4.6.1-1 [194 kB]
321 ko réceptionnés en 0s (2.041 ko/s)  
Sélection du paquet fuse précédemment désélectionné.
(Lecture de la base de données... 312913 fichiers et répertoires déjà installés.)
Préparation du dépaquetage de .../archives/fuse_3.17.2-3_all.deb ...
Dépaquetage de fuse (3.17.2-3) ...
Sélection du paquet libxdo3:amd64 précédemment désélectionné.
Préparation du dépaquetage de .../libxdo3_1%3a3.20160805.1-5.1_amd64.deb ...
Dépaquetage de libxdo3:amd64 (1:3.20160805.1-5.1) ...
Sélection du paquet libxdo-dev précédemment désélectionné.
Préparation du dépaquetage de .../libxdo-dev_1%3a3.20160805.1-5.1_amd64.deb ...
Dépaquetage de libxdo-dev (1:3.20160805.1-5.1) ...
Sélection du paquet squashfs-tools précédemment désélectionné.
Préparation du dépaquetage de .../squashfs-tools_1%3a4.6.1-1_amd64.deb ...
Dépaquetage de squashfs-tools (1:4.6.1-1) ...
Paramétrage de fuse (3.17.2-3) ...
Paramétrage de squashfs-tools (1:4.6.1-1) ...
Paramétrage de libxdo3:amd64 (1:3.20160805.1-5.1) ...
Paramétrage de libxdo-dev (1:3.20160805.1-5.1) ...
Traitement des actions différées (« triggers ») pour man-db (2.13.1-1) ...
Traitement des actions différées (« triggers ») pour libc-bin (2.41-12+deb13u2) ...
Lecture des listes de paquets... Fait
Construction de l'arbre des dépendances... Fait
Lecture des informations d'état... Fait      
libayatana-appindicator3-dev est déjà la version la plus récente (0.5.94-1).
Le paquet suivant a été installé automatiquement et n'est plus nécessaire :
  linux-image-6.12.74+deb13+1-amd64
Veuillez utiliser « sudo apt autoremove » pour le supprimer.
0 mis à jour, 0 nouvellement installés, 0 à enlever et 1 non mis à jour.
  [OK]    Paquets systeme installes
  [INFO]  Duree : 9s

================================================================
  ETAPE 2/8 - Rust + Cargo (via rustup)
================================================================
  [INFO]  Rust deja present : rustc 1.95.0 (59807616e 2026-04-14) - mise a jour...
  stable-x86_64-unknown-linux-gnu unchanged - rustc 1.95.0 (59807616e 2026-04-14)

info: checking for self-update (current version: 1.29.0)
  [OK]    Rust  : rustc 1.95.0 (59807616e 2026-04-14)
  [OK]    Cargo : cargo 1.95.0 (f2d3ce0bd 2026-03-21)
  [INFO]  Duree : 0s

================================================================
  ETAPE 3/8 - Node.js 20 LTS + npm (via NodeSource)
================================================================
  [OK]    Node.js deja installe et suffisant : v20.19.2
  [OK]    Node.js : v20.19.2
  [OK]    npm     : v9.2.0
  [INFO]  Duree : 1s

================================================================
  ETAPE 4/8 - Tauri CLI v2
================================================================
  [INFO]  Installation globale de Tauri CLI v2...
  [WARN]  Permission refusee pour install globale - installation locale...

added 5 packages, removed 1 package, and audited 19 packages in 1s

4 packages are looking for funding
  run `npm fund` for details

2 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
  [OK]    Tauri CLI v2 installe localement
  [OK]    Tauri CLI : 9.2.0
  [INFO]  Duree : 4s

================================================================
  ETAPE 5/8 - OpenJDK 17 (requis pour Android)
================================================================
Lecture des listes de paquets... Fait
Construction de l'arbre des dépendances... Fait
Lecture des informations d'état... Fait      
Aucune version du paquet openjdk-17-jre n'est disponible, mais il existe dans la base
de données. Cela signifie en général que le paquet est manquant, qu'il est devenu obsolète
ou qu'il n'est disponible que sur une autre source

E: Impossible de trouver le paquet openjdk-17-jdk
E: Le paquet « openjdk-17-jre » n'a pas de version susceptible d'être installée
papaours@papaours:~/Tauri$ 
