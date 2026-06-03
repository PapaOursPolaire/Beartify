// Forcer un téléchargement test immédiat
const b = new Blob(['{"test":true}'], {type:'application/json'});
const u = URL.createObjectURL(b);
const a = Object.assign(document.createElement('a'), {href:u, download:'__test_lyricssaver.json'});
document.body.appendChild(a); a.click(); document.body.removeChild(a);
