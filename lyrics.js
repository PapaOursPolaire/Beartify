La réponse est là. Regarde bien :

```
✓ Heuss L'enfoiré - Bar-Mitzvah.json (26 lignes, 176 mots — bgT:2 q:85)
✓ Yorssy, Nouvelle École - CRF - Nouvelle École.json (47 lignes, 297 mots — q:60)
```

**Le code fonctionne parfaitement.** Les fichiers sont "sauvegardés" selon les logs. Le `a.click()` se déclenche aussi (ton test le confirme).

**Le vrai problème : où sont les fichiers ?**

Sur Linux, les téléchargements blob depuis une app Electron/CEF sans interaction utilisateur atterrissent souvent ailleurs que `~/Downloads`. Lance ça dans un terminal :

```bash
find ~ -name "*.json" -newer ~/.config/spicetify/Extensions/lyrics.js 2>/dev/null | grep -v ".config" | grep -v ".cache" | head -20
```

et aussi :

```bash
find /tmp ~ -name "Heuss*" -o -name "Bar-Mitzvah*" -o -name "Nouvelle*" 2>/dev/null | head -10
```

Je parie que les fichiers existent quelque part — juste pas là où tu les cherches.
