Testons d'abord ce qui se passe réellement avec l'iframe dans ton contexte CEF avant de conclure. Colle ça dans la console Spotify sur Debian :

```js
// Test iframe contentDocument
const f = document.createElement('iframe');
f.src = 'about:blank';
f.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;';
document.body.appendChild(f);
setTimeout(() => {
  console.log('contentDocument:', f.contentDocument);
  console.log('contentWindow:', f.contentWindow);
  try {
    const a = f.contentDocument.createElement('a');
    a.href = URL.createObjectURL(new Blob(['test'], {type:'text/plain'}));
    a.download = 'test.txt';
    f.contentDocument.body.appendChild(a);
    a.click();
    console.log('iframe click OK');
  } catch(e) {
    console.error('iframe click FAIL:', e);
  }
}, 500);
```

Et aussi :

```js
// Test window.open avec user gesture simulé
document.addEventListener('click', function once() {
  document.removeEventListener('click', once);
  const w = window.open('about:blank');
  console.log('window.open après click:', w);
  if (w) w.close();
}, {once: true});
// Clique n'importe où après avoir collé ça
```

Le résultat va dire exactement ce qui est accessible dans ton CEF. Qu'est-ce que ça donne ?
