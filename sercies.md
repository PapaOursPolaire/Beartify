papaours@papaours:~$ systemctl list-units --type=service --state=running
  UNIT                          LOAD   ACTIVE SUB     DESCRIPTION                                            
  accounts-daemon.service       loaded active running Accounts Service
  avahi-daemon.service          loaded active running Avahi mDNS/DNS-SD Stack
  caddy.service                 loaded active running Caddy
  cron.service                  loaded active running Regular background program processing daemon
  cups-browsed.service          loaded active running Make remote CUPS printers available locally
  cups.service                  loaded active running CUPS Scheduler
  dbus.service                  loaded active running D-Bus System Message Bus
  deduplicator.service          loaded active running Service de suppression des doublons Papaours
  fail2ban.service              loaded active running Fail2Ban Service
  fwupd.service                 loaded active running Firmware update daemon
  jellyfin.service              loaded active running Jellyfin Media Server
  mariadb.service               loaded active running MariaDB 11.8.6 database server
  ModemManager.service          loaded active running Modem Manager
  NetworkManager.service        loaded active running Network Manager
  nmbd.service                  loaded active running Samba NMB Daemon
  php8.4-fpm.service            loaded active running The PHP 8.4 FastCGI Process Manager
  polkit.service                loaded active running Authorization Manager
  power-profiles-daemon.service loaded active running Power Profiles daemon
  prowlarr.service              loaded active running Prowlarr Daemon
  rtkit-daemon.service          loaded active running RealtimeKit Scheduling Policy Service
  sddm.service                  loaded active running Simple Desktop Display Manager
  smartmontools.service         loaded active running Self Monitoring and Reporting Technology (SMART) Daemon
  smbd.service                  loaded active running Samba SMB Daemon
  switcheroo-control.service    loaded active running Switcheroo Control Proxy service
  systemd-journald.service      loaded active running Journal Service
  systemd-logind.service        loaded active running User Login Management
  systemd-timesyncd.service     loaded active running Network Time Synchronization
  systemd-udevd.service         loaded active running Rule-based Manager for Device Events and Files
  udisks2.service               loaded active running Disk Manager
  upower.service                loaded active running Daemon for power management
  user@1000.service             loaded active running User Manager for UID 1000
  winbind.service               loaded active running Samba Winbind Daemon
  wol-server.service            loaded active running WoL HTTP server
  wpa_supplicant.service        loaded active running WPA supplicant
  xrdp-sesman.service           loaded active running xrdp session manager
  xrdp.service                  loaded active running xrdp daemon

Legend: LOAD   → Reflects whether the unit definition was properly loaded.
        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.
        SUB    → The low-level unit activation state, values depend on unit type.

36 loaded units listed.
papaours@papaours:~$ 







