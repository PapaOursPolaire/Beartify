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
6678
VM252:7 contentDocument: #document (about:blank)#top-layer
VM252:8 contentWindow: Window {__webpack_modules__: {…}, window: Window, self: Window, document: document, name: '', …}
VM252:15 iframe click OK
// Test window.open avec user gesture simulé
document.addEventListener('click', function once() {
  document.removeEventListener('click', once);
  const w = window.open('about:blank');
  console.log('window.open après click:', w);
  if (w) w.close();
}, {once: true});
// Clique n'importe où après avoir collé ça
undefined
VM258:5 window.open après click: Window {__webpack_modules__: {…}, window: Window, self: Window, document: document, name: '', …}
