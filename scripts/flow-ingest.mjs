// usage: node scripts/flow-ingest.mjs <jobId> <file_1080p.mp4> <file_720p.mp4> [--edit <flowEditId>] [--credits 24] [--no-complete]
// One step after a Flow download (replaces /tmp/move_clips.mjs, which matched files by truncated tile titles):
//  1. moves the 1080p file to <episode>/2_소스/clips/_raw/<shot>_vN.mp4 and the 720p original next to it (_vN_720p.mp4)
//  2. ffprobe check (1920x1080, 2.5-16 s) and 5 review frames (0.3/2.5/4.5/6.5/7.8 s, 480 px) in <episode>/_app/preview/clipcheck/
//  3. POST /api/queue/<job>/complete with the output and the Flow edit id, so the app never shows a collected clip as "running".
// Adoption stays a separate, reviewed step (POST /api/episodes/<ID>/shots/<key>/adopt).
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [jobId, hi, lo] = args.filter((a, i) => !a.startsWith('--') && !['--edit', '--credits'].includes(args[i - 1]));
if (!jobId || !hi || !lo) { console.error('usage: node scripts/flow-ingest.mjs <jobId> <1080p.mp4> <720p.mp4> [--edit id] [--credits 24] [--no-complete]'); process.exit(1); }
const m = jobId.match(/^\d{8}-\d{6}_(.+)_flow-veo_(S\d\d-\d\d)$/); if (!m) { console.error('unexpected job id ' + jobId); process.exit(1); }
const [, ep, shot] = m;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'studio.config.json'), 'utf8'));
const epDir = path.join(cfg.workspace, cfg.episodes[ep]);
const C = path.join(ROOT, 'node_modules/@remotion/compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: C };
if (!/_1080p\.mp4$/.test(hi)) { console.error('first file must be the 1080p upscale'); process.exit(1); }

const raw = path.join(epDir, '2_소스/clips/_raw'); fs.mkdirSync(raw, { recursive: true });
let n = 1; while (fs.existsSync(path.join(raw, `${shot}_v${n}.mp4`))) n++;
const dst = path.join(raw, `${shot}_v${n}.mp4`), dstLo = path.join(raw, `${shot}_v${n}_720p.mp4`);
const move = (a, b) => { fs.copyFileSync(a, b); fs.unlinkSync(a); };
move(hi, dst); move(lo, dstLo);
const [w, h, dur] = execFileSync(path.join(C, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', dst], { env }).toString().trim().split(/[\n,]+/).map(Number);
const fr = path.join(epDir, '_app/preview/clipcheck'); fs.mkdirSync(fr, { recursive: true });
const frames = [];
for (const t of ['0.3', '2.5', '4.5', '6.5', '7.8']) {
  const out = path.join(fr, `${shot}_v${n}_f${t}.jpg`);
  try { execFileSync(path.join(C, 'ffmpeg'), ['-v', 'error', '-y', '-ss', t, '-i', dst, '-frames:v', '1', '-vf', 'scale=480:-1', '-q:v', '4', out], { env, stdio: ['ignore', 'ignore', 'ignore'] }); frames.push(out); } catch { /* clip shorter than t */ }
}
const rel = `2_소스/clips/_raw/${shot}_v${n}.mp4`;
const res = { ep, shot, job: jobId, file: rel, probe: `${w}x${h} ${dur}s`, ok: w === 1920 && h === 1080 && dur >= 2.5 && dur <= 16, frames };
if (!args.includes('--no-complete')) {
  const body = { credits: Number(opt('--credits', 24)), output: rel, files: [rel], flow: { editId: opt('--edit', null), collectedAt: new Date().toISOString() }, by: 'aside' };
  const r = await (await fetch(`http://127.0.0.1:5178/api/queue/${jobId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  res.complete = r.status || r.error || 'unknown';
}
console.log(JSON.stringify(res));
