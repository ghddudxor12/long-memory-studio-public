// Usage: node scripts/render.mjs <ID> [preview|final|thumb] [--publish]
// Builds the manifest, writes the SRT, and renders with --public-dir = <episode>/2_소스.
// Default output: out/<ID>/ (local scratch). --publish writes final/thumb into <episode>/1_발행본
// and moves the previous file there into 3_폐기_이전본/renders/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, episodeId, episodePaths } from './lib/paths.mjs';

const args = process.argv.slice(2);
const id = episodeId(args);
const kind = ['preview', 'final', 'thumb'].find((k) => args.includes(k)) || 'preview';
const publish = args.includes('--publish');
const P = episodePaths(id);
const outDir = publish && kind !== 'preview' ? P.publish : P.out;
fs.mkdirSync(outDir, { recursive: true });

const run = (cmd, a) => execFileSync(cmd, a, { cwd: root, stdio: 'inherit' });
const t0 = Date.now();
run('node', ['scripts/build-manifest.mjs', id]);
if (kind !== 'thumb') run('node', ['scripts/export-srt.mjs', id, '--out', outDir]);

const file = kind === 'thumb' ? `${id}_thumbnail.png` : `${id}_${kind}.mp4`;
const target = path.join(outDir, file);
if (publish && kind !== 'thumb' && fs.existsSync(target)) {
  const old = path.join(P.archive, 'renders'); fs.mkdirSync(old, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.renameSync(target, path.join(old, file.replace(/(\.\w+)$/, `_${stamp}$1`)));
}
const remotion = path.join(root, 'node_modules', '.bin', 'remotion');
const common = ['--public-dir', P.src];
if (kind === 'thumb') {
  const png = path.join(P.out, `${id}_thumbnail.png`); fs.mkdirSync(P.out, { recursive: true });
  run(remotion, ['still', 'src/index.ts', `${id}-thumb`, png, ...common]);
  if (publish) { // YouTube: JPG under 2MB, file name <ID>_thumbnail.jpg in 1_발행본
    const jpg = path.join(P.publish, `${id}_thumbnail.jpg`);
    if (fs.existsSync(jpg)) { const old = path.join(P.archive, 'renders'); fs.mkdirSync(old, { recursive: true }); fs.renameSync(jpg, path.join(old, `${id}_thumbnail_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`)); }
    const ffdir = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
    execFileSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', '-i', png, '-q:v', '3', jpg], { env: { ...process.env, DYLD_LIBRARY_PATH: ffdir } });
    console.log(`thumbnail published: ${jpg}`);
  }
}
else run(remotion, ['render', 'src/index.ts', id, target, ...common, ...(kind === 'preview' ? ['--scale=0.5'] : [])]);
console.log(`render ${kind}: ${target} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
