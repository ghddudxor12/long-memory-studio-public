// Leave no local copies behind once videos are done (user rule 2026-11-12: "로컬에 남는 폴더 없게").
// usage: node scripts/cleanup-local.mjs [--dry] [--min-age 15] [--no-evict]
// Removes (only items untouched for --min-age minutes, so work in progress is safe):
//   - repo out/<ID>/ scratch (previews, test renders, SRT copies) and out/shorts/<SHORT_ID>/ build stages
//   - Aside session temp copies made for uploads: ~/.aside/u/*/sessions/*/tmp/{flow,yt2}/ media files (png/jpg/mp4/srt/json)
// Then evicts the Google Drive local cache (originals stay in Drive) of every archived episode's media folders
// (1_발행본, 2_소스, 3_폐기_이전본, 4_프로젝트백업), which get cached again whenever shorts or renders read them.
// Never touches ~/Downloads files it did not create, the episode folders' contents, or _app/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, config, episodePaths, readJson } from './lib/paths.mjs';

const args = process.argv.slice(2); const dry = args.includes('--dry'); const noEvict = args.includes('--no-evict');
const minAge = Number(args[args.indexOf('--min-age') + 1]) || 15; const cutoff = Date.now() - minAge * 60e3;
const report = { removed: [], kept: [], bytes: 0, evicted: [], evictErrors: [] };
const size = (p) => { try { const st = fs.statSync(p); if (!st.isDirectory()) return st.size; return fs.readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0); } catch { return 0; } };
const newest = (p) => { try { const st = fs.statSync(p); if (!st.isDirectory()) return st.mtimeMs; return Math.max(st.mtimeMs, ...fs.readdirSync(p).map((f) => newest(path.join(p, f)))); } catch { return 0; } };
const rm = (p) => { if (newest(p) > cutoff) { report.kept.push(path.relative(os.homedir(), p) + ' (in use)'); return; } report.bytes += size(p); report.removed.push(path.relative(os.homedir(), p)); if (!dry) fs.rmSync(p, { recursive: true, force: true }); };

const out = path.join(root, 'out');
if (fs.existsSync(out)) for (const d of fs.readdirSync(out)) {
  const p = path.join(out, d);
  if (d === 'shorts') { for (const s of fs.readdirSync(p)) rm(path.join(p, s)); continue; }
  if (fs.statSync(p).isDirectory()) rm(p);
}
const media = /\.(png|jpe?g|mp4|mov|wav|srt|json)$/i;
for (const acct of fs.readdirSync(path.join(os.homedir(), '.aside', 'u')).filter((x) => /^\d+$/.test(x))) {
  const sdir = path.join(os.homedir(), '.aside', 'u', acct, 'sessions'); if (!fs.existsSync(sdir)) continue;
  for (const s of fs.readdirSync(sdir)) for (const sub of ['flow', 'yt2']) {
    const d = path.join(sdir, s, 'tmp', sub); if (!fs.existsSync(d)) continue;
    const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (media.test(f)) rm(p); } };
    walk(d);
  }
}
if (!noEvict && !dry) {
  for (const id of Object.keys(config.episodes)) {
    let prod; try { prod = readJson(path.join(episodePaths(id).app, 'production.json')); } catch { continue; }
    if (!prod.archive?.done) continue;
    const P = episodePaths(id); const dirs = ['1_발행본', '2_소스', '3_폐기_이전본', '4_프로젝트백업'].map((x) => path.join(P.dir, x)).filter((x) => fs.existsSync(x));
    const r = spawnSync('swift', [path.join(root, 'scripts', 'evict.swift'), ...dirs], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (r.status === 0) report.evicted.push(id); else report.evictErrors.push(`${id}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]}`);
  }
}
console.log(JSON.stringify({ dry, freedMB: Math.round(report.bytes / 1e6), removed: report.removed.length, kept: report.kept, evicted: report.evicted, evictErrors: report.evictErrors.slice(0, 10) }, null, 1));
