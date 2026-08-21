papaours@PapaOurs:~$ sudo journalctl -u pocketbase-beartify.service -n 10 --no-pager
aoû 21 11:10:22 PapaOurs systemd[1]: Stopped pocketbase-beartify.service - PocketBase - Beartify backend.
aoû 21 11:10:22 PapaOurs systemd[1]: Started pocketbase-beartify.service - PocketBase - Beartify backend.
aoû 21 11:10:22 PapaOurs pocketbase[360964]: Error: failed to apply migration 1755000000_created_blindtest_results.js: ReferenceError: BaseCollection is not defined at /opt/pocketbase/pb.js:23:26(6)
aoû 21 11:10:22 PapaOurs systemd[1]: pocketbase-beartify.service: Deactivated successfully.
aoû 21 11:16:11 PapaOurs systemd[1]: Started pocketbase-beartify.service - PocketBase - Beartify backend.
aoû 21 11:16:11 PapaOurs pocketbase[454762]: Error: failed to apply migration 1755000000_created_blindtest_results.js: ReferenceError: BaseCollection is not defined at /opt/pocketbase/pb.js:23:26(6)
aoû 21 11:16:11 PapaOurs systemd[1]: pocketbase-beartify.service: Deactivated successfully.
aoû 21 11:16:39 PapaOurs systemd[1]: Started pocketbase-beartify.service - PocketBase - Beartify backend.
aoû 21 11:16:39 PapaOurs pocketbase[461619]: Error: failed to apply migration 1755000000_created_blindtest_results.js: ReferenceError: BaseCollection is not defined at /opt/pocketbase/pb.js:23:26(6)
aoû 21 11:16:39 PapaOurs systemd[1]: pocketbase-beartify.service: Deactivated successfully.
papaours@PapaOurs:~$ 



