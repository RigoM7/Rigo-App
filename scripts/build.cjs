require('./extract-domain.cjs');
const fs = require('node:fs');
fs.mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'rigo-access.js', 'rigo-access.css']) fs.copyFileSync(file, 'public/' + file);
