// Long Memory Studio: local app server (M1 shot board)
// Usage: node app/server.mjs [--port 5178]   → http://127.0.0.1:5178
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { root, config, episodePaths, readJson } from '../scripts/lib/paths.mjs';
import { register as registerM3, seriesDir, seriesOf } from './lib/m3.mjs';
import { register as registerM4, stages as stagesOf } from './lib/m4.mjs';
import { register as registerAgent } from './lib/agent.mjs';

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5178;
const app = express();
app.use(express.json({ limit: '2mb' }));

const prodFile = (id) => path.join(episodePaths(id).app, 'production.json');
const writeJsonAtomic = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const loadManifest = (id) => { const f = episodePaths(id).manifest; return fs.existsSync(f) ? readJson(f) : null; };

// absolute shot timing from the Remotion manifest (title card + scene offset + shot offset)
function shotTimes(id) {
  const m = loadManifest(id); if (!m) return {};
  const out = {}; const fps = m.fps; const T = m.titleCardFrames || 0;
  for (const sc of m.scenes) for (const s of sc.shots) out[s.key] = { start: (T + sc.from + s.from) / fps, duration: s.duration / fps };
  return { fps, total: m.durationInFrames / fps, shots: out };
}

app.get('/api/episodes', (_req, res) => {
  const list = Object.keys(config.episodes).map((id) => {
    const p = episodePaths(id); const f = prodFile(id);
    const prod = fs.existsSync(f) ? readJson(f) : null;
    // stage comes from the 12-step engine (production.stage was a stale free-text field, e.g. "shot-design" on uploaded episodes)
    let cur = null; try { const st = stagesOf(id); cur = st.current ? { key: st.current.key, label: `${st.current.n} ${st.current.label}` } : { key: 'done', label: '완료' }; } catch {}
    return { id, folder: config.episodes[id], series: seriesOf(id), title: prod?.title, stage: cur?.key || prod?.stage, stageLabel: cur?.label || prod?.stage, shots: prod?.shots?.length ?? 0, hasProduction: !!prod, hasEpisode: fs.existsSync(p.episodeJson) };
  });
  res.json(list);
});

app.get('/api/episodes/:id', (req, res) => {
  const { id } = req.params; const p = episodePaths(id);
  res.json({ id, episode: readJson(p.episodeJson), production: fs.existsSync(prodFile(id)) ? readJson(prodFile(id)) : null, timing: shotTimes(id) });
});

// update one shot: production fields (status, highlight, defects, note) and episode.json fields (segments, motion)
app.patch('/api/episodes/:id/shots/:key', (req, res) => {
  const { id, key } = req.params; const body = req.body || {}; const p = episodePaths(id);
  const prod = readJson(prodFile(id)); const shot = prod.shots.find((s) => s.key === key);
  if (!shot) return res.status(404).json({ error: 'no shot ' + key });
  const changes = [];
  for (const k of ['status', 'highlight', 'defects']) if (k in body && JSON.stringify(shot[k]) !== JSON.stringify(body[k])) { shot[k] = body[k]; changes.push(k); }
  if (body.prompts && typeof body.prompts === 'object') { for (const k of ['visual', 'audio', 'motion']) if (typeof body.prompts[k] === 'string' && body.prompts[k] !== shot.prompts?.[k]) { shot.prompts = { ...(shot.prompts || {}), [k]: body.prompts[k] }; changes.push(`prompts.${k}`); } }
  if (Array.isArray(body.assets) && JSON.stringify(body.assets) !== JSON.stringify(shot.assets)) { shot.assets = body.assets; changes.push('assets'); }
  if (!changes.length && !body.note && !('segments' in body) && !('motion' in body) && !('kfReview' in body)) return res.json({ ok: true, changes: [], shot });
  if ('kfReview' in body) { shot.kfReview = { ...body.kfReview, at: new Date().toISOString() }; changes.push('kfReview'); }
  if (body.note && String(body.note).trim()) { shot.notes = shot.notes || []; shot.notes.push({ at: new Date().toISOString(), by: body.by || 'user', text: String(body.note).trim() }); changes.push('note'); }
  if ('segments' in body || 'motion' in body) {
    const ep = readJson(p.episodeJson);
    const es = ep.scenes.flatMap((s) => s.shots).find((s) => s.key === key);
    if (es) {
      if ('segments' in body && es.type === 'video') { es.segments = body.segments; shot.segments = body.segments; changes.push('segments'); }
      if ('motion' in body && es.type === 'image') { es.motion = body.motion; shot.motion = body.motion; changes.push('motion'); }
      writeJsonAtomic(p.episodeJson, ep);
    }
  }
  prod.log = prod.log || []; prod.log.push({ at: new Date().toISOString(), by: body.by || 'user', text: `${key}: ${changes.join(', ')}` });
  writeJsonAtomic(prodFile(id), prod);
  res.json({ ok: true, changes, shot });
});

// media from the episode folder (Range requests supported by express.static)
const statics = {};
app.use('/files/:id', (req, res, next) => {
  const { id } = req.params; if (!config.episodes[id]) return res.status(404).end();
  statics[id] ||= express.static(episodePaths(id).dir, { fallthrough: false, maxAge: '1h' });
  statics[id](req, res, next);
});


// ---------------- M2: renders, jobs (worker), QC, review issues, approvals ----------------
const jobs = new Map();
function startJob(kind, cmdArgs, meta = {}) {
  const id = crypto.randomUUID().slice(0, 8);
  const job = { id, kind, ...meta, status: 'running', progress: 0, log: [], startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const ch = meta.cmd ? spawn(meta.cmd, meta.args || [], { cwd: '/tmp', env: process.env }) : spawn(process.execPath, cmdArgs, { cwd: root, env: process.env });
  const onData = (d) => { for (const line of d.toString().split(/[\r\n]+/)) { if (!line.trim()) continue; const m = line.match(/Rendered (\d+)\/(\d+)/); if (m) job.progress = +m[1] / +m[2]; else { job.log.push(line); if (job.log.length > 200) job.log.shift(); } } };
  ch.stdout.on('data', onData); ch.stderr.on('data', onData);
  ch.on('close', (code) => { job.status = code === 0 ? 'done' : 'failed'; job.code = code; job.endedAt = new Date().toISOString(); if (code === 0) job.progress = 1; job.onDone?.(job); });
  return job;
}
app.get('/api/jobs/:job', (req, res) => { const j = jobs.get(req.params.job); if (!j) return res.status(404).end(); const { onDone, ...pub } = j; res.json(pub); });
app.get('/api/jobs', (_req, res) => res.json([...jobs.values()].map(({ onDone, log, ...j }) => j)));

const reviewFile = (id) => path.join(episodePaths(id).app, 'review.json');
const loadReview = (id) => (fs.existsSync(reviewFile(id)) ? readJson(reviewFile(id)) : { issues: [], qc: {} });
const qcPath = (id, rel) => path.join(episodePaths(id).app, 'qc', rel.replace(/[\/\s]+/g, '__') + '.json');

// renders: local scratch out/<ID>/ and published 1_발행본/
function listRenders(id) {
  const p = episodePaths(id); const out = [];
  for (const [where, dir] of [['out', p.out], ['publish', p.publish]]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.mp4')) {
      const abs = path.join(dir, f); const st = fs.statSync(abs);
      const ref = where === 'out' ? `out/${f}` : `1_발행본/${f}`;
      out.push({ ref, where, name: f, size: st.size, mtime: st.mtime.toISOString(), url: where === 'out' ? `/out/${id}/${encodeURIComponent(f)}` : `/files/${id}/${encodeURIComponent('1_발행본')}/${encodeURIComponent(f)}`, qc: fs.existsSync(qcPath(id, ref)) });
    }
  }
  const proxy = path.join(p.app, 'preview', 'proxy_360p.mp4');
  if (fs.existsSync(proxy)) { const st = fs.statSync(proxy); out.push({ ref: '_app/preview/proxy_360p.mp4', where: 'proxy', name: 'proxy_360p.mp4 (보관용)', size: st.size, mtime: st.mtime.toISOString(), url: `/files/${id}/_app/preview/proxy_360p.mp4`, qc: false }); }
  return out.sort((a, b) => (a.where === 'proxy') - (b.where === 'proxy') || b.mtime.localeCompare(a.mtime));
}
const renderAbs = (id, ref) => { const p = episodePaths(id); return ref.startsWith('out/') ? path.join(p.out, ref.slice(4)) : path.join(p.dir, ref); };
app.get('/api/episodes/:id/renders', (req, res) => res.json(listRenders(req.params.id)));
app.post('/api/episodes/:id/render', (req, res) => {
  const { id } = req.params; const kind = ['preview', 'final', 'thumb'].includes(req.body?.kind) ? req.body.kind : 'preview';
  const running = [...jobs.values()].find((j) => j.kind === 'render' && j.status === 'running'); if (running) return res.status(409).json({ error: '이미 렌더 중', job: running.id });
  const job = startJob('render', ['scripts/render.mjs', id, kind], { episode: id, target: kind });
  res.json({ job: job.id });
});
app.post('/api/episodes/:id/qc', (req, res) => {
  const { id } = req.params; const ref = req.body?.ref; if (!ref) return res.status(400).json({ error: 'ref required' });
  const job = startJob('qc', ['scripts/qc.mjs', id, renderAbs(id, ref), '--json', qcPath(id, ref)], { episode: id, target: ref });
  res.json({ job: job.id });
});
app.get('/api/episodes/:id/qc', (req, res) => { const f = qcPath(req.params.id, String(req.query.ref || '')); if (!fs.existsSync(f)) return res.status(404).json({ error: 'no qc' }); res.sendFile(f); });
app.use('/out/:id', (req, res, next) => { const { id } = req.params; if (!config.episodes[id]) return res.status(404).end(); express.static(episodePaths(id).out, { fallthrough: false })(req, res, next); });

// review issues
app.get('/api/episodes/:id/review', (req, res) => res.json(loadReview(req.params.id)));
app.post('/api/episodes/:id/issues', (req, res) => {
  const { id } = req.params; const b = req.body || {}; const rv = loadReview(id);
  const iss = { id: crypto.randomUUID().slice(0, 8), render: b.render, t: Number(b.t), shot: b.shot, tags: b.tags || [], text: String(b.text || ''), status: 'open', createdAt: new Date().toISOString(), by: b.by || 'user' };
  if (b.capture && String(b.capture).startsWith('data:image/jpeg;base64,')) {
    const rel = path.join('_app', 'review', 'captures', `${iss.id}.jpg`); const abs = path.join(episodePaths(id).dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, Buffer.from(b.capture.split(',')[1], 'base64')); iss.capture = rel;
  }
  rv.issues.push(iss); writeJsonAtomic(reviewFile(id), rv);
  // mirror the defect tags onto the shot so the board shows them
  if (iss.shot && iss.tags.length) { const prod = readJson(prodFile(id)); const sh = prod.shots.find((s) => s.key === iss.shot); if (sh) { sh.defects = [...new Set([...(sh.defects || []), ...iss.tags])]; if (sh.status === 'adopted') sh.status = 'fix'; prod.log.push({ at: iss.createdAt, by: iss.by, text: `${iss.shot}: review issue ${iss.id} @${iss.t.toFixed(1)}s` }); writeJsonAtomic(prodFile(id), prod); } }
  res.json(iss);
});
app.patch('/api/episodes/:id/issues/:iid', (req, res) => {
  const { id, iid } = req.params; const rv = loadReview(id); const iss = rv.issues.find((x) => x.id === iid); if (!iss) return res.status(404).end();
  for (const k of ['status', 'text', 'tags']) if (k in req.body) iss[k] = req.body[k];
  if (req.body.status === 'resolved') { iss.resolvedAt = new Date().toISOString(); iss.resolvedRender = req.body.resolvedRender; }
  writeJsonAtomic(reviewFile(id), rv); res.json(iss);
});
app.delete('/api/episodes/:id/issues/:iid', (req, res) => { const { id, iid } = req.params; const rv = loadReview(id); rv.issues = rv.issues.filter((x) => x.id !== iid); writeJsonAtomic(reviewFile(id), rv); res.json({ ok: true }); });

// approvals (G1 script, G2 keyframes, G3 final)
app.post('/api/episodes/:id/approve', (req, res) => {
  const { id } = req.params; const { gate, note, revoke, by, delegation } = req.body || {}; const who = by === 'aside' ? 'aside' : 'user'; if (!['G1', 'G2', 'G3'].includes(gate)) return res.status(400).end();
  const prod = readJson(prodFile(id)); prod.approvals = prod.approvals || {};
  if (revoke) delete prod.approvals[gate]; else prod.approvals[gate] = { at: new Date().toISOString(), by: who, note, ...(who === 'aside' ? { delegatedBy: 'user', delegation: delegation || '상시 위임 2026-11-10 (Aside 권장안대로 G1/G2/G3 진행)' } : {}) };
  prod.log.push({ at: new Date().toISOString(), by: who, text: `${gate} ${revoke ? 'revoked' : 'approved'}` }); writeJsonAtomic(prodFile(id), prod); res.json(prod.approvals);
});

registerM3(app);
registerM4(app, { startJob });
registerAgent(app); // AI-facing layer: /api, /api/next, /api/agent/brief, /api/flow/plan, summaries
// run codex-local image jobs on this machine (server = worker)
app.post('/api/queue/:jid/run-local', (req, res) => {
  const running = [...jobs.values()].find((j) => j.kind === 'codex' && j.status === 'running'); if (running) return res.status(409).json({ error: 'Codex 작업 진행 중', job: running.id });
  const job = startJob('codex', ['scripts/codex-image.mjs', req.params.jid], { target: req.params.jid }); res.json({ job: job.id });
});
const sstatic = {};
app.use('/series-files/:sid', (req, res, next) => { let d; try { d = seriesDir(req.params.sid); } catch { return res.status(404).end(); } (sstatic[req.params.sid] ||= express.static(d, { fallthrough: false }))(req, res, next); });

app.use(express.static(path.join(root, 'app', 'web', 'dist')));
app.get('/', (_req, res) => res.sendFile(path.join(root, 'app', 'web', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`Long Memory Studio → http://127.0.0.1:${PORT}`));
