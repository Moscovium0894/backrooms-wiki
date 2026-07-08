// Post-build step: inject the build version and precache manifest into
// dist/sw.js. Run automatically via `npm run build`.

import { execSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const BASE = '/backrooms-wiki/';

let version = String(Date.now());
try {
  version = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() + '-' + Math.floor(Date.now() / 1000);
} catch {
  /* not a git checkout */
}

// app shell: core pages + all hashed assets + fonts + search index
const precache = new Set([
  BASE,
  BASE + 'levels/',
  BASE + 'entities/',
  BASE + 'items/',
  BASE + 'guides/',
  BASE + 'progress/',
  BASE + 'offline/',
  BASE + 'search-index.json',
  BASE + 'manifest.webmanifest',
  BASE + 'fonts/ibm-plex-mono-latin-400.woff2',
  BASE + 'fonts/ibm-plex-mono-latin-600.woff2',
  BASE + 'icons/icon-192.png',
]);

async function walk(dir, rel = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), r);
    else if (rel.startsWith('_astro')) precache.add(BASE + r);
  }
}
await walk(dist);

const swPath = path.join(dist, 'sw.js');
let sw = await readFile(swPath, 'utf8');
sw = sw
  .replace('__BUILD__', version)
  .replace('__PRECACHE__', JSON.stringify([...precache], null, 0));
await writeFile(swPath, sw);
console.log(`sw.js finalized: version ${version}, ${precache.size} precached URLs`);
