require('./extract-domain.cjs');
const fs = require('node:fs');
fs.mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'rigo-access.js', 'rigo-access.css', 'manifest.webmanifest']) fs.copyFileSync(file, 'public/' + file);
fs.cpSync('icons', 'public/icons', { recursive: true });
