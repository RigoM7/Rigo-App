require('./extract-domain.cjs');
const fs = require('node:fs');
fs.mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'rigo-access.js', 'rigo-access.css', 'manifest.webmanifest']) fs.copyFileSync(file, 'public/' + file);
// The demo recipe is served as a static script; it only runs in the browser that opens the demo.
fs.copyFileSync('lib/demo-seed.js', 'public/rigo-demo-seed.js');
fs.cpSync('icons', 'public/icons', { recursive: true });
