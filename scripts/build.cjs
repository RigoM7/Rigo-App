require('./inject-ops.cjs');
require('./extract-domain.cjs');
const fs = require('node:fs');
fs.mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'rigo-access.js', 'rigo-ops.js', 'rigo-access.css', 'manifest.webmanifest']) fs.copyFileSync(file, 'public/' + file);
// The demo recipe is served as a static script; it only runs in the browser that opens the demo.
fs.copyFileSync('lib/demo-seed.js', 'public/rigo-demo-seed.js');
fs.cpSync('icons', 'public/icons', { recursive: true });

// Service worker: stamped with a hash of the shell files so each deployment replaces old caches.
const crypto = require('node:crypto');
const shellHash = crypto.createHash('sha256');
for (const file of ['index.html', 'rigo-access.js', 'rigo-ops.js', 'rigo-access.css', 'manifest.webmanifest']) shellHash.update(fs.readFileSync(file));
fs.writeFileSync('public/sw.js', fs.readFileSync('sw.js', 'utf8').replace('__RIGO_BUILD__', shellHash.digest('hex').slice(0, 12)));
// Android app links for a Play Store package: published only when the owner provides the package
// name and signing certificate fingerprint (Vercel environment variables), never invented.
const pkg = process.env.RIGO_ANDROID_PACKAGE, fingerprint = process.env.RIGO_ANDROID_SHA256;
if (pkg && fingerprint) {
  fs.mkdirSync('public/.well-known', { recursive: true });
  fs.writeFileSync('public/.well-known/assetlinks.json', JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprint.split(',').map(f => f.trim()) } }], null, 2));
}
