// usage: node scripts/ep-build.mjs <ID> --ep <N> --title "<한글>" --script <script.json> --shots <shots.json> [--part <k>] [--series bible-in-order]
// One step from an AI-written script + shot plan to a registered episode with a saved plan (2026-11-11):
//  1. registers the episode (scripts/new-episode.mjs) if needed and restarts the app server (it reads studio.config.json at start);
//     split parts (--part 2) get folder EP###-k_<ID>_<title> and thumbnail ep "NN-k"
//  2. episode.json: voice Ava (Premium) rate 115, timing.lineGapSec 1.0 (user rule 2026-11-11)
//  3. PUT /api/episodes/<ID>/plan (scenes + narration ids + shots + episode rules); stops on lint errors
//  4. new series assets from shots.newAssets (POST /api/series/<sid>/assets) + queued gpt-asset jobs
//  5. _app/metadata.json (settings copied from the previous episode) and thumbnail.json
// Then: node scripts/tts.mjs <ID> && node scripts/build-manifest.mjs <ID>; keyframes with scripts/kf-jobs.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { root } from './lib/paths.mjs';
import { profile } from './lib/series.mjs';

const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const id = a[0]; const n = Number(opt('ep')); const part = opt('part') ? Number(opt('part')) : null; const title = opt('title'); const sid = opt('series', 'bible-in-order');
const script = JSON.parse(fs.readFileSync(opt('script'), 'utf8')); const plan = JSON.parse(fs.readFileSync(opt('shots'), 'utf8'));
if (!id || !n || !title) { console.error('usage: node scripts/ep-build.mjs <ID> --ep N --title "<한글>" --script f --shots f [--part k]'); process.exit(1); }
const API = 'http://127.0.0.1:5178/api'; const NODE = process.execPath;
const j = async (method, p, body) => { const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let v; try { v = JSON.parse(t); } catch { v = t; } if (!r.ok) throw new Error(`${method} ${p} ${r.status}: ${t.slice(0, 300)}`); return v; };
const cfgFile = path.join(root, 'studio.config.json'); const cfg = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const waitServer = async () => { for (let i = 0; i < 40; i++) { try { await j('GET', '/upload-quota'); return; } catch { await new Promise((r) => setTimeout(r, 500)); } } throw new Error('server did not come back'); };
const restart = async () => { try { execFileSync('/usr/bin/pkill', ['-f', 'node app/server.mjs']); } catch {} await new Promise((r) => setTimeout(r, 800));
  const out = fs.openSync('/tmp/lms_server.log', 'a'); spawn(NODE, ['app/server.mjs'], { cwd: root, detached: true, stdio: ['ignore', out, out] }).unref(); await waitServer(); };

// 1. register
if (!cfg().episodes[id]) {
  execFileSync(NODE, ['scripts/new-episode.mjs', id, '--series', sid, '--ep', String(n), '--title', title, '--en', script.title], { cwd: root, stdio: 'inherit' });
  if (part) { // EP###_<ID>_<title> -> EP###-k_<ID>_<title>
    const c = cfg(); const rel = c.episodes[id]; const relNew = rel.replace(/\/EP(\d+)_/, `/EP$1-${part}_`);
    fs.renameSync(path.join(c.workspace, rel), path.join(c.workspace, relNew)); c.episodes[id] = relNew; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2) + '\n');
  }
  await restart(); console.log('registered', cfg().episodes[id]);
}
const c = cfg(); const dir = path.join(c.workspace, c.episodes[id]);
// 2. voice/timing
const epf = path.join(dir, 'episode.json'); const ep = JSON.parse(fs.readFileSync(epf, 'utf8'));
ep.voice = { ...(ep.voice || {}), engine: 'macos-say', voice: 'Ava (Premium)', rate: 115 }; ep.timing = { ...(ep.timing || {}), lineGapSec: 1 };
ep.title = script.title; ep.subtitle = script.subtitle || ''; ep.source = script.scope || '';
fs.writeFileSync(epf, JSON.stringify(ep, null, 2) + '\n');
// 3. plan
const pad = (x) => String(x).padStart(2, '0');
const scenes = script.scenes.map((sc) => ({ scene: sc.scene, title: sc.title, captions: [], narration: sc.narration.map((l, i) => ({ id: l.id || `S${pad(sc.scene)}_L${i + 1}`, text: l.text })), shots: (plan.shots[String(sc.scene)] || []).map((s) => ({ ...s, assets: s.assets || [] })) }));
const missing = scenes.filter((s) => !s.shots.length).map((s) => s.scene); if (missing.length) { console.error('scenes without shots: ' + missing); process.exit(1); }
// 4. new assets first (lint warns about unknown asset names)
const series = await j('GET', `/series/${sid}`); const have = new Set(series.assets.map((x) => x.name.toLowerCase())); const assetJobs = [];
for (const na of plan.newAssets || []) {
  if (have.has(na.name.toLowerCase())) continue;
  const asset = await j('POST', `/series/${sid}/assets`, { name: na.name, type: na.type || 'character', description: na.description, rules: na.rules || ['humans-silhouette', 'no-text', 'earthly-sky'], scope: 'series', usedIn: [id], tags: na.tags || [] });
  const job = await j('POST', '/queue', { type: 'gpt-asset', series: sid, asset: asset.id, by: 'aside' }); assetJobs.push(job.id); console.log('new asset', asset.id, '->', job.id);
}
const res = await j('PUT', `/episodes/${id}/plan`, { by: 'aside', rules: plan.rules || [], scenes });
if (!res.saved) { console.error('plan not saved', JSON.stringify(res.report).slice(0, 1500)); process.exit(1); }
console.log('plan saved', scenes.length, 'scenes', scenes.flatMap((s) => s.shots).length, 'shots', scenes.flatMap((s) => s.shots).filter((s) => s.type === 'video').length, 'video; warnings', res.report.warnings.length);
for (const w of res.report.warnings) console.log('  warn', w);
// 5. metadata + thumbnail
const P = profile(sid); // series profile: playlist, label, ...
const prevId = Object.keys(c.episodes).filter((x) => x !== id && c.episodes[x].startsWith(c.series[sid] + '/')).pop(); let settings = { language: 'English', category: 'Education', audience: 'Not made for kids', aiContent: 'Yes', playlist: P.playlist };
try { if (prevId) settings = { ...(JSON.parse(fs.readFileSync(path.join(c.workspace, c.episodes[prevId], '_app', 'metadata.json'), 'utf8')).settings || settings), playlist: P.playlist }; } catch {}
const m = script.metadata; const tags = (m.tags || []).filter((t) => t !== 'The Long Memory');
fs.writeFileSync(path.join(dir, '_app', 'metadata.json'), JSON.stringify({ title: m.title, titleAlternatives: m.titleAlternatives || [], description: m.description, chapterTitles: m.chapterTitles || [], tags, tagsAll: [...tags], settings, source: 'aside ep-build ' + new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() }, null, 2));
const label = part ? `${pad(n)}-${part}` : pad(n); const th = script.thumbnail || {};
const lines = (th.lines || [script.title.toUpperCase()]).slice(0, 2).map((t, i) => ({ text: t, size: 110, color: i ? 'gold' : 'white' }));
fs.writeFileSync(path.join(dir, 'thumbnail.json'), JSON.stringify({ series: P.label, ep: label, source: (th.highlightLabel || script.scope || '').toUpperCase(), image: 'thumb/thumb_base.png', titleTop: 440, lines, highlight: null }, null, 2));
if (!m.description?.includes('{chapters}')) console.log('  warn: description has no {chapters}');
console.log(JSON.stringify({ id, dir, assetJobs, title: m.title, titleLen: m.title?.length }));
