// Test 1 : brand check IDBRequest
try {
  const r = Object.create(IDBRequest.prototype);
  r.readyState = 'done';
  console.log('IDBRequest brand check OK');
} catch(e) {
  console.error('IDBRequest brand check FAIL:', e);
}

// Test 2 : chrome.downloads
console.log('chrome.downloads:', typeof chrome !== 'undefined' ? chrome?.downloads : 'chrome absent');

// Test 3 : IDB prototype patching
try {
  const orig = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = orig;
  console.log('IDB prototype patch OK');
} catch(e) {
  console.error('IDB prototype patch FAIL:', e);
}

VM108:5 IDBRequest brand check OK
VM108:11 chrome.downloads: undefined
VM108:17 IDB prototype patch OK
undefined
