// Usage: node scripts/codex-image.mjs <jobId> [--api http://127.0.0.1:5178]
// Runs a gpt-keyframe / gpt-endframe / gpt-asset job with Codex CLI (ChatGPT subscription image generation),
// copies the generated PNG to the job's output path and reports completion (the server validates it).
// Tested 2026-11-04: codex-cli 0.166.0-alpha.6, ~60 s per image, 1672x941 PNG, references via -i.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, episodePaths } from './lib/paths.mjs';

const jid = process.argv[2]; const ai = process.argv.indexOf('--api'); const API = ai > 0 ? process.argv[ai + 1] : 'http://127.0.0.1:5178';
if (!jid) { console.error('usage: node scripts/codex-image.mjs <jobId>'); process.exit(1); }
const CODEX = process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const CODEX_HOME = process.env.CODEX_HOME_REAL || (process.env.HOME + '/.codex');
const api = async (p, method = 'GET', body) => { const r = await fetch(API + p, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; };

const job = (await api('/api/queue')).find((j) => j.id === jid);
if (!job) { console.error('no job ' + jid); process.exit(1); }
if (!['gpt-keyframe', 'gpt-endframe', 'gpt-asset'].includes(job.type)) { console.error('not an image job'); process.exit(1); }
const base = job.episode ? episodePaths(job.episode).dir : path.join(config.workspace, config.series[job.series], '00_시리즈공통');
const seriesBase = job.series ? base : path.join(config.workspace, Object.values(config.series).find((f) => config.episodes[job.episode].startsWith(f + '/')), '00_시리즈공통');
const refs = (job.input.refs || []).map((r) => path.join(r.base === 'episode' ? base : seriesBase, r.file)).filter((f) => fs.existsSync(f));

if (job.status === 'queued') await api(`/api/queue/${jid}/start`, 'POST', { by: 'codex-image' });
const instruction = 'Use your image generation tool to create exactly ONE image from the prompt below. ' +
  (refs.length ? 'The attached images are references: keep the same figure, wardrobe and painting style' + (job.type === 'gpt-endframe' ? '; the first attachment is the START FRAME of this same shot (same camera and composition).' : '.') : '') +
  ' Do not write or modify any files and do not run shell commands. Reply with one short line when done.\n\n';
const t0 = Date.now();
const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', ...refs.flatMap((f) => ['-i', f]), '-'];
const r = spawnSync(CODEX, args, { input: instruction + job.input.prompt, env: { ...process.env, CODEX_HOME }, encoding: 'utf8', timeout: 6 * 60_000, maxBuffer: 1 << 26 });
const out = (r.stdout || '') + (r.stderr || '');
const session = out.match(/session id: ([0-9a-f-]+)/)?.[1];
const dir = session ? path.join(CODEX_HOME, 'generated_images', session) : null;
const imgs = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (!imgs.length) {
  const msg = /usage limit|rate limit|quota/i.test(out) ? 'quota' : /refus|policy|can't help|cannot help/i.test(out) ? 'policy-refused' : r.error?.code === 'ETIMEDOUT' ? 'timeout' : 'other';
  await api(`/api/queue/${jid}/fail`, 'POST', { category: msg, message: `codex exit ${r.status}, ${secs}s: ${out.slice(-400)}`, by: 'codex-image' });
  console.error(`failed (${msg}) after ${secs}s`); process.exit(1);
}
const dst = path.join(base, job.output.dir, job.output.name);
fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(imgs[0], dst);
const done = await api(`/api/queue/${jid}/complete`, 'POST', { credits: 0, by: 'codex-image' });
console.log(`${done.status}${done.failure ? ' ' + done.failure.category + ': ' + done.failure.message : ''} · ${secs}s · ${path.relative(base, dst)} · codex session ${session}`);
