// Places lib/ops-source.js inside the app bundle's business rules (between markers), so the
// browser, the local demo adapter and the server (via lib/domain.cjs) all run the same rules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'index.html');
const source = fs.readFileSync(path.join(root, 'lib/ops-source.js'), 'utf8');
if (/<\/script/i.test(source)) throw new Error('ops-source.js must not contain a closing script tag');
const START = '/*rigo-ops:start*/', END = '/*rigo-ops:end*/', ANCHOR = 'function rigoBillableQty(';
let html = fs.readFileSync(file, 'utf8');
const a = html.indexOf(START), b = html.indexOf(END);
if (a >= 0 && b > a) html = html.slice(0, a) + html.slice(b + END.length);
const at = html.indexOf(ANCHOR);
if (at < 0 || html.indexOf(ANCHOR, at + 1) >= 0) throw new Error('Rules anchor not found exactly once');
html = html.slice(0, at) + START + source.replace(/\/\*[\s\S]*?\*\//, '').trim() + END + html.slice(at);
fs.writeFileSync(file, html);
