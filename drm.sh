papaours@papaours:~$ ls -la /opt/beartify-drm/extensions.js
node -e "const app={get:()=>{}}; require('/opt/beartify-drm/extensions.js')(app); console.log('OK')"
ls: impossible d'accéder à '/opt/beartify-drm/extensions.js': Permission non accordée
node:internal/modules/cjs/loader:1215
  throw err;
  ^

Error: Cannot find module '/opt/beartify-drm/extensions.js'
Require stack:
- /home/papaours/[eval]
    at Module._resolveFilename (node:internal/modules/cjs/loader:1212:15)
    at Module._load (node:internal/modules/cjs/loader:1043:27)
    at Module.require (node:internal/modules/cjs/loader:1298:19)
    at require (node:internal/modules/helpers:182:18)
    at [eval]:1:25
    at runScriptInThisContext (node:internal/vm:209:10)
    at node:internal/process/execution:118:14
    at [eval]-wrapper:6:24
    at runScript (node:internal/process/execution:101:62)
    at evalScript (node:internal/process/execution:133:3) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '/home/papaours/[eval]' ]
}

Node.js v20.19.2
papaours@papaours:~$ 




