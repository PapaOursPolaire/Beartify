const dl2 = (name, content) => {
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
  const a = Object.assign(document.createElement('a'), {href: dataUrl, download: name+'.txt'});
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  console.log('clic data URL:', name);
};
dl2('test1', 'contenu1');
setTimeout(() => dl2('test2', 'contenu2'), 2000);
setTimeout(() => dl2('test3', 'contenu3'), 4000);
