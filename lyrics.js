// Test : deux clics espacés de 2 secondes
const dl = (name) => {
  const b = new Blob([name], {type:'text/plain'});
  const u = URL.createObjectURL(b);
  const a = Object.assign(document.createElement('a'), {href:u, download: name+'.txt'});
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  console.log('clic:', name);
};
dl('fichier1');
setTimeout(() => dl('fichier2'), 2000);
setTimeout(() => dl('fichier3'), 4000);

VM133:9 clic: fichier1
4990
VM133:9 clic: fichier2
VM133:9 clic: fichier3
