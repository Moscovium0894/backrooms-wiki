// In-place image optimization for public/images/, run after fetch_wiki.py.
//
// - GIF  -> animated WebP (the big win: gameplay GIFs shrink 60-80%);
//           references inside src/data/*.json are rewritten to match.
// - PNG  -> palette-quantized PNG (same file, only kept if >=10% smaller)
// - JPEG -> mozjpeg re-encode   (same file, only kept if >=10% smaller)
//
// Idempotent: converted GIFs are gone on the next run, and re-encoding an
// already-optimized PNG/JPEG yields <10% savings so the original is kept.

import { readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(root, 'public', 'images');
const DATA = path.join(root, 'src', 'data');

let before = 0;
let after = 0;
const renames = []; // [oldRel, newRel]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function replaceIfSmaller(file, buffer, size) {
  if (buffer.length < size * 0.9) {
    await writeFile(file, buffer);
    return buffer.length;
  }
  return size;
}

for await (const file of walk(IMAGES)) {
  const ext = path.extname(file).toLowerCase();
  const { size } = await stat(file);
  before += size;
  try {
    if (ext === '.gif') {
      const out = await sharp(file, { animated: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      const target = file.slice(0, -4) + '.webp';
      await writeFile(target, out);
      await unlink(file);
      renames.push([path.relative(IMAGES, file), path.relative(IMAGES, target)]);
      after += out.length;
    } else if (ext === '.png') {
      const out = await sharp(file)
        .png({ palette: true, quality: 82, compressionLevel: 9 })
        .toBuffer();
      after += await replaceIfSmaller(file, out, size);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      const out = await sharp(file)
        .jpeg({ quality: 78, progressive: true, mozjpeg: true })
        .toBuffer();
      after += await replaceIfSmaller(file, out, size);
    } else {
      after += size;
    }
  } catch (e) {
    console.warn(`  !! skipped ${path.relative(IMAGES, file)}: ${e.message}`);
    after += size;
  }
}

// rewrite gif references inside the data files
if (renames.length) {
  for (const name of ['levels', 'entities', 'items', 'guides']) {
    const p = path.join(DATA, `${name}.json`);
    let text = await readFile(p, 'utf8');
    for (const [oldRel, newRel] of renames) {
      text = text.replaceAll(oldRel, newRel);
    }
    await writeFile(p, text);
  }
  console.log(`rewrote ${renames.length} gif reference(s) to webp in src/data/`);
}

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`images: ${mb(before)}MB -> ${mb(after)}MB (saved ${mb(before - after)}MB)`);
