papaours@papaours:~$ chmod +x fhsi.sh
papaours@papaours:~$ ./fhsi.sh
❌ Édite ce script et renseigne FIREBASE_WEB_API_KEY avant de le lancer.
papaours@papaours:~$ ./fhsi.sh
[sudo] Mot de passe de papaours : 
→ Redémarrage complet du service (kill + start, pas juste restart)...
./fhsi.sh : ligne 145 : 3341896 Processus arrêté      sudo pkill -9 -f "opt/pocketbase/pocketbase" 2> /dev/null
                                                                                                               → Test en local avec un faux token (doit renvoyer 'Jeton Firebase invalide', pas une ReferenceError)...
                                                                                                  {"error":"Jeton Firebase invalide"}

                 papaours@papaours:~$ 





