ls -la /opt/beartify-drm/extensions.js
node -e "const app={get:()=>{}}; require('/opt/beartify-drm/extensions.js')(app); console.log('OK')"
