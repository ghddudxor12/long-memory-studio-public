// Usage: node scripts/previews.mjs <ID> [--force]
// Makes small JPG previews for every keyframe/clip version in _app/production.json
// into _app/preview/<shot>/ and writes the preview path back into production.json.
// Previews stay local (offline) so the app can browse old episodes after originals go online-only.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, episodeId, episodePaths, readJson } from './lib/paths.mjs';

const id = episodeId();
const force = process.argv.includes('--force');
const P = episodePaths(id);
const prodFile = path.join(P.app, 'production.json');
const prod = readJson(prodFile);
const ffdir = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const ff = (args) => execFileSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', ...args], { env: { ...process.env, DYLD_LIBRARY_PATH: ffdir } });

let made = 0, skipped = 0, failed = 0;
function preview(entry, shotKey, isVideo, atSec = 1) {
  const src = path.join(P.dir, entry.file);
  const name = entry.file.replace(/[\/\s]+/g, '__').replace(/\.\w+$/, '') + '.jpg';
  const outRel = path.join('_app', 'preview', shotKey, name);
  const out = path.join(P.dir, outRel);
  entry.preview = outRel;
  if (!force && fs.existsSync(out)) { skipped++; return; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    if (isVideo) ff(['-ss', String(atSec), '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out]);
    else ff(['-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
    made++;
  } catch (e) { failed++; delete entry.preview; console.warn('preview failed:', entry.file, String(e.stderr || e.message).slice(0, 160)); }
}

for (const s of prod.shots) {
  for (const k of s.keyframes) preview(k, s.key, false);
  for (const c of s.clips) {
    const seg = c.segments?.[0];
    preview(c, s.key, true, seg ? Math.min(seg[1], seg[0] + 1) : 1);
  }
  process.stdout.write(`${s.key} `);
}
fs.writeFileSync(prodFile, JSON.stringify(prod, null, 2) + '\n');
console.log(`\npreviews: made ${made}, skipped ${skipped}, failed ${failed}`);
