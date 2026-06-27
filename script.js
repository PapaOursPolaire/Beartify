
Une seule ligne changée. Dans le bloc Discord Tauri, j'ai remplacé :

```js
window.__TAURI__.core.invoke('plugin:shell|open', { path: discordUrl, openWith: null })
```

par :

```js
const shellOpenArgs = _FB_IS_ANDROID
  ? { path: discordUrl }
  : { path: discordUrl, openWith: null };
window.__TAURI__.core.invoke('plugin:shell|open', shellOpenArgs)
```

C'est tout. `openWith: null` fait planter `plugin:shell|open` sur Android car ce paramètre n'est pas reconnu sur mobile. Sur Desktop il reste inchangé.
