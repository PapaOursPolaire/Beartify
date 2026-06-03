const w = window.open('about:blank');
const b = new Blob(['test2'], {type:'text/plain'});
const u = URL.createObjectURL(b);
const a = w.document.createElement('a');
a.href = u;
a.download = 'fichier_via_popup.txt';
w.document.body.appendChild(a);
a.click();
w.close();
