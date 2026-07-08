// Rasterize public/icons/icon.svg into the PWA/apple icon set.
// Uses sharp, which ships as a transitive dependency of Astro.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'public', 'icons');
const svg = await readFile(path.join(iconsDir, 'icon.svg'));

// standard icons: transparent-corner rounded square is baked into the SVG
await sharp(svg).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));

// maskable: pad to the 80% safe zone on a solid dark plate
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#14120c' },
})
  .composite([{ input: inner, left: 51, top: 51 }])
  .png()
  .toFile(path.join(iconsDir, 'maskable-512.png'));

// apple-touch-icon: 180px, opaque (iOS renders black behind transparency)
const apple = await sharp(svg).resize(180, 180).png().toBuffer();
await sharp({
  create: { width: 180, height: 180, channels: 4, background: '#14120c' },
})
  .composite([{ input: apple }])
  .flatten({ background: '#14120c' })
  .png()
  .toFile(path.join(iconsDir, 'apple-touch-icon.png'));

console.log('icons written to public/icons/');
