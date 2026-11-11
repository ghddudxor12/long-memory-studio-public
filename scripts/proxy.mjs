// Usage: node scripts/proxy.mjs <ID>
// Small 360p proxy of the published final (for browsing old episodes after originals go online-only) → <episode>/_app/preview/proxy_360p.mp4
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, episodeId, episodePaths } from './lib/paths.mjs';

const id = episodeId(); const P = episodePaths(id);
const src = ['_final_youtube.mp4', '_final.mp4'].map((s) => path.join(P.publish, id + s)).find((f) => fs.existsSync(f));
if (!src) { console.error('no final render in 1_발행본'); process.exit(1); }
const out = path.join(P.app, 'preview', 'proxy_360p.mp4'); fs.mkdirSync(path.dirname(out), { recursive: true });
const ffdir = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const t0 = Date.now();
execFileSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', '-i', src, '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out], { env: { ...process.env, DYLD_LIBRARY_PATH: ffdir }, stdio: 'inherit' });
console.log(`proxy: ${path.relative(P.dir, out)} ${(fs.statSync(out).size / 1e6).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
