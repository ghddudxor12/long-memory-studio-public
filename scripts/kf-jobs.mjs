// usage: node scripts/kf-jobs.mjs <ID...> [--end] [--run <concurrency>] [--shots S01-01,S02-03]
// Creates Codex image jobs (2026-11-11):
//   default: gpt-keyframe for every shot that has no keyframe yet (and no open keyframe job)
//   --end:   gpt-endframe for every video shot with an adopted start frame and no end frame (and no open end job)
// --run N runs all queued image jobs of these episodes with N parallel Codex processes (scripts/codex-image.mjs), oldest first,
// and prints a summary. Jobs stay candidates: adoption is a separate, reviewed step.
import { spawn } from 'node:child_process';
import { root } from './lib/paths.mjs';

const a = process.argv.slice(2); const ids = a.filter((x, i) => !x.startsWith('--') && !['--run', '--shots'].includes(a[i - 1]));
const end = a.includes('--end'); const runN = a.includes('--run') ? Number(a[a.indexOf('--run') + 1]) || 3 : 0; const only = a.includes('--shots') ? a[a.indexOf('--shots') + 1].split(',') : null;
const API = 'http://127.0.0.1:5178/api';
const j = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.slice(0, 200)}`); return JSON.parse(t); };
const type = end ? 'gpt-endframe' : 'gpt-keyframe'; const created = [];
for (const id of ids) {
  const e = await j('GET', `/episodes/${id}`); const shots = e.production.shots.filter((s) => !only || only.includes(s.key));
  const open = new Set((await j('GET', `/queue?episode=${id}&status=queued,approved,running`)).filter((x) => x.type === type).map((x) => x.target.shot));
  for (const s of shots) {
    if (open.has(s.key)) continue;
    if (end) { if (s.type !== 'video') continue; const hasStart = s.keyframes.some((k) => k.state === 'adopted' && k.role !== 'end'); const hasEnd = s.keyframes.some((k) => k.role === 'end' && ['adopted', 'candidate'].includes(k.state)); if (!hasStart || hasEnd) continue; }
    else if (s.keyframes.some((k) => k.role !== 'end')) continue;
    const job = await j('POST', '/queue', { type, episode: id, shot: s.key, by: 'aside' }); created.push(job.id);
  }
}
console.log(`created ${created.length} ${type} jobs`);
if (runN) {
  const queue = (await j('GET', '/queue?status=queued')).filter((x) => ids.includes(x.episode) && ['gpt-keyframe', 'gpt-endframe'].includes(x.type)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).map((x) => x.id);
  let ok = 0, fail = 0; const t0 = Date.now();
  const run = (jid) => new Promise((res) => { const p = spawn(process.execPath, ['scripts/codex-image.mjs', jid], { cwd: root }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (c) => { if (c === 0) ok++; else { fail++; console.log('FAIL', jid, o.slice(-200).replace(/\n/g, ' ')); } res(); }); });
  await Promise.all(Array.from({ length: runN }, async () => { while (queue.length) await run(queue.shift()); }));
  console.log(`ran ${ok + fail}: ok ${ok}, fail ${fail}, ${Math.round((Date.now() - t0) / 1000)} s`);
}
