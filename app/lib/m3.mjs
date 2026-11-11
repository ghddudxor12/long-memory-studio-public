// M3: series style/assets, generation job queue (input snapshots, failure categories, credits, approval),
// validated results as candidate versions, adoption into render paths, AI pre-review.
import fs from 'node:fs';
import path from 'node:path';
import { config, episodePaths, readJson } from '../../scripts/lib/paths.mjs';
import { composePrompt } from '../../scripts/lib/prompt.mjs';
import { sha256, validate, toJpg, previewJpg, probe } from './media.mjs';

export const FAILURE = ['credits-insufficient', 'quota', 'policy-refused', 'ui-changed', 'timeout', 'validation-failed', 'cancelled', 'other'];
// Flow credits (Google AI Pro). Omni 1.2 is billed per second: 360p 1/s, 720p 3/s up to 10 s, then 2/s and 6/s for 11-15 s.
// Upscale of an Omni clip to 1080p: 0 up to 10 s, 1/s beyond. Veo 3.1 Fast/Quality and Omni 1.1 are retired on 2026-12-05.
export const CREDITS = { 'omni-1.2-360p': 8, 'omni-1.2-720p': 24, 'veo-3.1-lite': 10, 'veo-3.1-fast': 20, 'veo-3.1-quality': 100 };
export const DEFAULT_VIDEO_MODEL = 'omni-1.2-720p'; // 2026-11-09 test: 720p→1080p keeps oil-brush texture, 360p→720p looks soft
export function videoCredits(model, sec = 8) {
  const m = /^omni-1\.2-(360p|720p)$/.exec(model); if (!m) return CREDITS[model] ?? 20;
  const [a, b] = m[1] === '360p' ? [1, 2] : [3, 6]; const s = Math.max(3, Math.min(15, Math.round(sec)));
  return Math.min(s, 10) * a + Math.max(0, s - 10) * b;
}
export const upscaleCredits = (sec = 8) => Math.max(0, Math.round(sec) - 10);
export const BACKENDS = {
  'chatgpt-web': { label: 'ChatGPT 웹 (Aside 브라우저)', kinds: ['gpt-keyframe', 'gpt-endframe', 'gpt-asset'] },
  'codex-local': { label: 'Codex CLI (ChatGPT 구독, 서버가 바로 실행)', kinds: ['gpt-keyframe', 'gpt-endframe', 'gpt-asset'] },
  'flow-web': { label: 'Google Flow (Aside 브라우저)', kinds: ['flow-veo'], features: { endFrame: true, maxSec: 15, models: Object.keys(CREDITS), upscale: ['720p'] } },
  'aside-vision': { label: 'Aside(Claude) 이미지 판독', kinds: ['ai-review'] },
};

const writeJsonAtomic = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const now = () => new Date().toISOString();
const stamp = () => now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// ---------- series ----------
export const seriesDir = (sid) => { const f = config.series?.[sid]; if (!f) throw new Error('unknown series ' + sid); return path.join(config.workspace, f, '00_시리즈공통'); };
export const seriesFile = (sid) => path.join(seriesDir(sid), 'series.json');
export const loadSeries = (sid) => readJson(seriesFile(sid));
export function seriesOf(epId) { const f = config.episodes[epId]; return Object.entries(config.series || {}).find(([, folder]) => f.startsWith(folder + '/'))?.[0]; }
const prodFile = (id) => path.join(episodePaths(id).app, 'production.json');

// ---------- jobs ----------
function jobsDir(scope) { return scope.episode ? path.join(episodePaths(scope.episode).app, 'jobs') : path.join(seriesDir(scope.series), '_app', 'jobs'); }
export function listJobs() {
  const out = [];
  const dirs = [...Object.keys(config.episodes).map((e) => jobsDir({ episode: e })), ...Object.keys(config.series || {}).map((s) => jobsDir({ series: s }))];
  for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) { try { out.push(readJson(path.join(d, f))); } catch { /* partial write */ } }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function findJob(jid) { const j = listJobs().find((x) => x.id === jid); if (!j) throw Object.assign(new Error('no job ' + jid), { status: 404 }); return j; }
export function saveJob(job) { job.updatedAt = now(); writeJsonAtomic(path.join(jobsDir(job), job.id + '.json'), job); return job; }
const absOf = (job, rel) => path.join(job.episode ? episodePaths(job.episode).dir : seriesDir(job.series), rel);
const snapRef = (base, rel) => { const abs = path.join(base, rel); return { file: rel, sha256: fs.existsSync(abs) ? sha256(abs) : null }; };

function adoptedFrame(shot, roles) { return shot.keyframes.find((k) => k.state === 'adopted' && roles.some((r) => k.role.startsWith(r))); }

// create a job with a frozen input snapshot
export function createJob(body) {
  const type = body.type; const t = stamp();
  if (type === 'gpt-asset') {
    const sid = body.series; const s = loadSeries(sid); const a = s.assets.find((x) => x.id === body.asset);
    if (!a) throw new Error('no asset ' + body.asset);
    const base = seriesDir(sid); const v = (a.refs?.length || 0) + 1;
    const text = `Please generate one image. ${a.type === 'character' ? 'Character' : a.type === 'location' ? 'Location' : 'Prop'} reference image. ${a.description}${body.extra ? '\n' + body.extra : ''}\n\nRules: ${s.rules.filter((r) => (a.rules || []).includes(r.id) && r.prompt).map((r) => r.prompt).concat(['no text, no letters']).join('; ')}\n\nStyle: ${s.style.gptSuffix || s.style.prompt}`;
    const job = { id: `${t}_gpt-asset_${a.id}`, type, series: sid, target: { asset: a.id }, backend: body.backend || 'codex-local', needsApproval: false,
      input: { prompt: text, refs: (a.refs || []).filter((r) => r.state === 'adopted').map((r) => snapRef(base, r.file)), styleVersion: s.version },
      output: { dir: 'assets', name: `${a.id}_v${v}.png` }, status: 'queued', credits: { estimated: 0 }, createdAt: now(), history: [{ at: now(), status: 'queued', by: body.by || 'user' }] };
    return saveJob(job);
  }
  const ep = body.episode; const P = episodePaths(ep); const prod = readJson(prodFile(ep));
  if (type === 'ai-review') {
    const shots = (body.shots?.length ? body.shots : prod.shots.filter((s) => !s.kfReview).map((s) => s.key));
    const frames = shots.map((k) => { const s = prod.shots.find((x) => x.key === k); const st = adoptedFrame(s, ['start', 'render', 'still']) || s.keyframes.find((x) => x.state === 'candidate'); const en = adoptedFrame(s, ['end']); return { shot: k, start: st?.file, end: en?.file, visual: s.prompts.visual }; });
    return saveJob({ id: `${t}_ai-review_${shots.length}shots`, type, episode: ep, target: { shots }, backend: 'aside-vision', needsApproval: false,
      input: { frames, checklist: ['face-profile', 'hand-deformed', 'sun-disc', 'fish-cutaway', 'roots-exposed', 'sash', 'land-animals', 'apple', 'text-in-image', 'duplicate-composition', 'style-mismatch'], rules: prod.rules || [] },
      status: 'queued', credits: { estimated: 0 }, createdAt: now(), history: [{ at: now(), status: 'queued', by: body.by || 'user' }] });
  }
  const shot = prod.shots.find((s) => s.key === body.shot); if (!shot) throw new Error('no shot ' + body.shot);
  const sid = seriesOf(ep); const series = sid ? loadSeries(sid) : null; const sBase = sid ? seriesDir(sid) : null;
  let job;
  if (type === 'gpt-keyframe' || type === 'gpt-endframe') {
    const kind = type === 'gpt-endframe' ? 'end' : 'keyframe';
    const c = series ? composePrompt({ series, production: prod, shot, kind }) : { text: shot.prompts.visual, refs: [], warnings: [], rules: [] };
    const refs = c.refs.map((r) => ({ ...snapRef(sBase, r.file), base: 'series', asset: r.asset }));
    if (kind === 'end') { const st = adoptedFrame(shot, ['start', 'render', 'still']); if (st) refs.unshift({ ...snapRef(P.dir, st.file), base: 'episode', role: 'start-frame' }); }
    const prompt = kind === 'end' ? `${c.text}\n\nChange over the 8 seconds: ${shot.prompts.motion || body.change || ''}` : c.text;
    const n = shot.keyframes.length + 1;
    job = { id: `${t}_${ep}_${type}_${shot.key}`, type, episode: ep, target: { shot: shot.key }, backend: body.backend || 'codex-local', needsApproval: false,
      input: { prompt: body.extra ? `${prompt}\n\n${body.extra}` : prompt, refs, rules: c.rules, warnings: c.warnings, styleVersion: series?.version },
      output: { dir: kind === 'end' ? '2_소스/keyframes/end' : '2_소스/keyframes/gen', name: `${shot.key}${kind === 'end' ? '_END' : ''}_v${n}.png` },
      status: 'queued', credits: { estimated: 0 } };
  } else if (type === 'flow-veo') {
    const model = body.model || DEFAULT_VIDEO_MODEL; const mode = body.mode || 'frames-to-video'; const isOmni = model.startsWith('omni-');
    const durationSec = isOmni ? Math.max(3, Math.min(15, Number(body.durationSec) || 8)) : 8; const upscale = isOmni ? (body.upscale ?? (model.endsWith('360p') ? '720p' : '1080p')) : (body.upscale || null);
    const st = adoptedFrame(shot, ['start', 'render', 'still']); const en = mode === 'frames-to-video' ? adoptedFrame(shot, ['end']) : null;
    if (!st) throw new Error('채택된 시작 프레임이 없어요');
    if (mode === 'frames-to-video' && !en) throw new Error('채택된 끝 프레임이 없어요 (시작 프레임만 모드로 바꾸거나 끝 프레임을 먼저 만드세요)');
    const n = shot.clips.length + 1;
    job = { id: `${t}_${ep}_flow-veo_${shot.key}`, type, episode: ep, target: { shot: shot.key }, backend: 'flow-web', needsApproval: true,
      input: { model, mode, durationSec, upscale, prompt: body.prompt || shot.prompts.motion || shot.prompts.visual, start: snapRef(P.dir, st.file), end: en ? snapRef(P.dir, en.file) : null },
      output: { dir: '2_소스/clips/_raw', name: `${shot.key}_v${n}.mp4` }, status: 'queued', credits: { estimated: videoCredits(model, durationSec) + (upscale ? upscaleCredits(durationSec) : 0) } };
  } else throw new Error('unknown job type ' + type);
  Object.assign(job, { createdAt: now(), history: [{ at: now(), status: 'queued', by: body.by || 'user' }] });
  if (body.note) job.note = body.note;
  return saveJob(job);
}

// Allowed moves. done and cancelled are final: re-approving a finished job used to put it back on the Flow submit list.
// running -> approved releases a job whose submission did not happen; failed jobs may be retried. To regenerate a shot, create a new job (scripts/mkveo.mjs).
const NEXT = { queued: ['approved', 'running', 'failed', 'cancelled'], approved: ['approved', 'running', 'failed', 'cancelled'], running: ['running', 'approved', 'failed', 'cancelled'], failed: ['approved', 'running', 'failed', 'cancelled'], done: [], cancelled: [] };
const nfc = (x) => String(x || '').normalize('NFC');
export function transition(jid, to, body = {}) {
  const job = findJob(jid);
  if (NEXT[job.status] && !NEXT[job.status].includes(to)) throw Object.assign(new Error(`${job.status} 상태의 작업은 ${to}(으)로 바꿀 수 없어요. 다시 만들려면 새 작업을 만드세요 (flow-veo: node scripts/mkveo.mjs <EP> <shot>)`), { status: 409 });
  if (to === 'approved') { if (!job.needsApproval) throw new Error('승인이 필요 없는 작업'); job.approvedAt = now(); }
  if (to === 'running' && job.needsApproval && !job.approvedAt) throw Object.assign(new Error('크레딧 작업은 승인 후에만 실행할 수 있어요'), { status: 409 });
  if (to === 'failed') { const cat = FAILURE.includes(body.category) ? body.category : 'other'; job.failure = { category: cat, message: String(body.message || ''), at: now() }; if (body.credits != null) job.credits.actual = Number(body.credits); }
  job.status = to; job.history.push({ at: now(), status: to, by: body.by || 'aside', ...(body.message ? { message: body.message } : {}) });
  return saveJob(job);
}

// Aside reports results: validate, then register as candidate versions (never auto-adopt)
export function completeJob(jid, body = {}) {
  const job = findJob(jid);
  if (job.needsApproval && !job.approvedAt) throw Object.assign(new Error('승인되지 않은 작업'), { status: 409 });
  if (job.status === 'cancelled') throw Object.assign(new Error('취소된 작업이에요. 새 작업을 만드세요'), { status: 409 });
  // idempotent: completing a finished job again with the same file(s) changes nothing (no second clip, no second ledger row)
  if (job.status === 'done') {
    const prev = new Set((job.result?.files || []).map((x) => nfc(x.file))); const base = job.episode ? episodePaths(job.episode).dir : seriesDir(job.series);
    const req = (body.files?.length ? body.files : []).map((x) => nfc(path.isAbsolute(x) ? path.relative(base, x) : x));
    if (job.type === 'ai-review' || req.every((x) => prev.has(x))) return { ...job, alreadyDone: true };
    throw Object.assign(new Error('이미 완료된 작업이에요. 다른 파일을 등록하려면 새 작업을 만드세요'), { status: 409 });
  }
  if (body.credits != null) job.credits.actual = Number(body.credits);
  if (body.flow && job.type === 'flow-veo') job.flow = { ...(job.flow || {}), ...body.flow }; // Flow edit id + collect time (scripts/flow-ingest.mjs)
  if (job.type === 'ai-review') {
    const prod = readJson(prodFile(job.episode));
    for (const r of body.reviews || []) { const s = prod.shots.find((x) => x.key === r.shot); if (s) s.aiReview = { tags: r.tags || [], notes: r.notes || '', confidence: r.confidence ?? null, at: now(), job: job.id }; }
    prod.log.push({ at: now(), by: 'aside', text: `AI pre-review ${job.id}: ${(body.reviews || []).length} shots` }); writeJsonAtomic(prodFile(job.episode), prod);
    job.result = { reviews: (body.reviews || []).length }; job.status = 'done'; job.history.push({ at: now(), status: 'done', by: 'aside' }); return saveJob(job);
  }
  const files = (body.files?.length ? body.files : [path.join(job.output.dir, job.output.name)]).map((f) => (path.isAbsolute(f) ? f : absOf(job, f)));
  const kind = job.type === 'flow-veo' ? 'video' : 'image';
  const known = new Set([...(job.input.refs || []).map((r) => r.sha256), job.input.start?.sha256, job.input.end?.sha256].filter(Boolean));
  const results = files.map((f) => ({ file: f, ...validate(f, kind, known) }));
  job.result = { files: results.map((r) => ({ file: path.relative(job.episode ? episodePaths(job.episode).dir : seriesDir(job.series), r.file), ok: r.ok, checks: r.checks, sha256: r.hash })) };
  if (!results.every((r) => r.ok)) { job.status = 'failed'; job.failure = { category: 'validation-failed', message: results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).join('; '), at: now() }; job.history.push({ at: now(), status: 'failed', by: 'validator' }); return saveJob(job); }

  if (job.type === 'gpt-asset') {
    const sf = seriesFile(job.series); const s = readJson(sf); const a = s.assets.find((x) => x.id === job.target.asset); a.refs = a.refs || [];
    for (const r of job.result.files) a.refs.push({ v: a.refs.length + 1, file: r.file, state: 'candidate', source: job.backend, job: job.id, at: now() });
    s.log.push({ at: now(), by: 'aside', text: `${a.id}: candidate from ${job.id}` }); writeJsonAtomic(sf, s);
  } else {
    const P = episodePaths(job.episode); const prod = readJson(prodFile(job.episode)); const s = prod.shots.find((x) => x.key === job.target.shot);
    let added = 0;
    for (const r of job.result.files) {
      if ((kind === 'video' ? s.clips : s.keyframes).some((c) => nfc(c.file) === nfc(r.file))) continue; // same file already registered on this shot
      added++;
      const prevRel = path.join('_app', 'preview', s.key, r.file.replace(/[\/\s]+/g, '__').replace(/\.\w+$/, '') + '.jpg');
      try { previewJpg(path.join(P.dir, r.file), path.join(P.dir, prevRel), kind === 'video'); } catch { /* preview optional */ }
      if (kind === 'video') s.clips.push({ v: s.clips.length + 1, file: r.file, state: 'candidate', model: job.input.model, mode: job.input.mode, credits: job.credits.actual ?? job.credits.estimated, job: job.id, preview: prevRel });
      else s.keyframes.push({ v: s.keyframes.length + 1, file: r.file, role: job.type === 'gpt-endframe' ? 'end' : (s.type === 'video' ? 'start' : 'still'), state: 'candidate', note: `${job.backend} ${job.id}`, job: job.id, preview: prevRel });
    }
    if (added) s.status = kind === 'video' ? 'review' : 'kf-review';
    prod.credits = prod.credits || {}; prod.credits.ledger = prod.credits.ledger || [];
    if (job.type === 'flow-veo' && added && !prod.credits.ledger.some((l) => l.job === job.id)) prod.credits.ledger.push({ at: now(), job: job.id, shot: s.key, model: job.input.model, credits: job.credits.actual ?? job.credits.estimated });
    if (added) { prod.log.push({ at: now(), by: 'aside', text: `${s.key}: candidate from ${job.id}` }); writeJsonAtomic(prodFile(job.episode), prod); }
  }
  job.status = 'done'; job.history.push({ at: now(), status: 'done', by: 'aside' });
  return saveJob(job);
}

// adopt a version: keyframe (image shot → render jpg), start/end frame (video shot), clip (→ clips/<key>.mp4 + episode.json), series asset ref
export function adopt(epId, key, body) {
  const P = episodePaths(epId); const prod = readJson(prodFile(epId)); const s = prod.shots.find((x) => x.key === key);
  if (!s) throw new Error('no shot ' + key);
  const archive = (rel) => { const abs = path.join(P.dir, rel); if (!fs.existsSync(abs)) return; const dst = path.join(P.archive, path.dirname(rel).replace(/^2_소스\//, ''), path.basename(rel).replace(/(\.\w+)$/, `_${stamp()}$1`)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(abs, dst); return path.relative(P.dir, dst); };
  const ep = readJson(P.episodeJson); const es = ep.scenes.flatMap((x) => x.shots).find((x) => x.key === key);
  if (body.kind === 'clip') {
    const c = s.clips.find((x) => x.file === body.file); if (!c) throw new Error('no clip version');
    const target = `2_소스/clips/${key}.mp4`; const old = s.clips.find((x) => x.state === 'adopted');
    if (old && old.file === target) { const moved = archive(target); old.file = moved; }
    for (const x of s.clips) if (x.state === 'adopted') x.state = 'superseded';
    fs.copyFileSync(path.join(P.dir, c.file), path.join(P.dir, target));
    const dur = probe(path.join(P.dir, target)).duration;
    c.state = 'adopted'; c.adoptedAs = target; c.segments = body.segments || c.segments || [[0, +Math.min(dur, 8).toFixed(2)]];
    Object.assign(es, { type: 'video', src: `clips/${key}.mp4`, segments: c.segments }); delete es.motion;
    Object.assign(s, { type: 'video', src: es.src, segments: c.segments, status: 'adopted' });
  } else {
    const k = s.keyframes.find((x) => x.file === body.file); if (!k) throw new Error('no keyframe version');
    const role = body.role || k.role;
    for (const x of s.keyframes) if (x.state === 'adopted' && (x.role === role || (role.startsWith('start') && x.role === 'render'))) x.state = 'superseded';
    k.state = 'adopted'; k.role = role;
    if (s.type === 'image') {
      const target = `2_소스/keyframes/${key}.jpg`; archive(target); toJpg(path.join(P.dir, k.file), path.join(P.dir, target));
      k.renderAs = target; Object.assign(es, { src: `keyframes/${key}.jpg` });
    }
    s.status = s.type === 'image' ? 'adopted' : 'kf-review';
  }
  fs.writeFileSync(P.episodeJson, JSON.stringify(ep, null, 2) + '\n');
  prod.log.push({ at: now(), by: body.by || 'user', text: `${key}: adopted ${body.kind || 'keyframe'} ${body.file}` });
  writeJsonAtomic(prodFile(epId), prod);
  return s;
}

export function adoptAssetRef(sid, aid, file) {
  const sf = seriesFile(sid); const s = readJson(sf); const a = s.assets.find((x) => x.id === aid);
  for (const r of a.refs) if (r.state === 'adopted') r.state = 'superseded';
  const r = a.refs.find((x) => x.file === file); if (!r) throw new Error('no ref'); r.state = 'adopted';
  s.version = (s.version || 1) + 1; s.log.push({ at: now(), by: 'user', text: `${aid}: adopted ${file} (series v${s.version})` }); writeJsonAtomic(sf, s); return a;
}


// ---------- plan: script → scenes/shots (written by Claude/Aside), with rule checks ----------
// body: { rules?: [...episode rules], scenes: [{ scene, title, captions?, narration: [{id,text}], shots: [{ key, title, type, visual, motion?, assets: [names], highlight? }] }] }
export function lintPlan(epId, plan) {
  const sid = seriesOf(epId); const series = sid ? loadSeries(sid) : null; const report = { errors: [], warnings: [], shots: {} };
  const shots = plan.scenes.flatMap((sc) => sc.shots.map((s) => ({ ...s, scene: sc.scene })));
  const keys = new Set(); for (const s of shots) { if (keys.has(s.key)) report.errors.push(`키 중복: ${s.key}`); keys.add(s.key); if (!/^S\d\d-\d\d[a-z]?$/.test(s.key)) report.errors.push(`키 형식: ${s.key} (S01-01)`); }
  for (const sc of plan.scenes) { if (!sc.narration?.length) report.errors.push(`Scene ${sc.scene}: 내레이션 없음`); if (!sc.shots?.length) report.errors.push(`Scene ${sc.scene}: 샷 없음`); }
  if (series) {
    const names = new Set(series.assets.map((a) => a.name.toLowerCase()));
    for (const s of shots) for (const n of s.assets || []) if (!names.has(String(n).toLowerCase())) report.warnings.push(`${s.key}: 등록되지 않은 에셋 "${n}" (시리즈 화면에서 먼저 만들기)`);
    const godShots = shots.filter((s) => (s.assets || []).some((n) => /god/i.test(n)));
    if (godShots.length > Math.ceil(shots.length * 0.35)) report.warnings.push(`하나님 등장 ${godShots.length}/${shots.length}샷: EP001 기준 1/3 이하 권장`);
    const prodLike = { rules: plan.rules || [] };
    for (const s of shots) { const c = composePrompt({ series, production: prodLike, shot: { ...s, prompts: { visual: s.visual, motion: s.motion || '' } } }); if (c.warnings.length) report.shots[s.key] = c.warnings; }
  }
  const hl = shots.filter((s) => s.highlight || s.type === 'video').length; if (hl > Math.ceil(shots.length * 0.45)) report.warnings.push(`영상화 ${hl}/${shots.length}샷: 크레딧 부담 (EP001은 17/39)`);
  return report;
}
export function savePlan(epId, plan, dryRun = false) {
  const report = lintPlan(epId, plan); if (dryRun || report.errors.length) return { saved: false, report };
  const P = episodePaths(epId); const ep = readJson(P.episodeJson); const prod = readJson(prodFile(epId));
  if (prod.shots.some((s) => s.keyframes?.length || s.clips?.length) && !plan.force) throw Object.assign(new Error('이미 키프레임/클립이 있는 에피소드예요 (force 필요)'), { status: 409 });
  ep.scenes = plan.scenes.map((sc) => ({ scene: sc.scene, title: sc.title, captions: sc.captions || [], narration: sc.narration,
    shots: sc.shots.map((s) => (s.type === 'video' ? { key: s.key, title: s.title, type: 'video', src: `clips/${s.key}.mp4`, segments: [[0, 8]] } : { key: s.key, title: s.title, type: 'image', src: `keyframes/${s.key}.jpg`, motion: s.motion_kenburns || 'zoomIn' })) }));
  if (plan.rules) prod.rules = plan.rules;
  prod.shots = plan.scenes.flatMap((sc) => sc.shots.map((s) => ({ key: s.key, scene: sc.scene, sceneTitle: sc.title, title: s.title, type: s.type || 'image', highlight: !!(s.highlight || s.type === 'video'), status: 'design',
    src: s.type === 'video' ? `clips/${s.key}.mp4` : `keyframes/${s.key}.jpg`, prompts: { visual: s.visual || '', audio: s.audio || '', motion: s.motion || '' }, assets: s.assets || [], keyframes: [], clips: [], defects: [], notes: [] })));
  prod.stage = 'shot-design'; prod.log.push({ at: now(), by: plan.by || 'aside', text: `plan saved: ${plan.scenes.length} scenes, ${prod.shots.length} shots` });
  fs.writeFileSync(P.episodeJson, JSON.stringify(ep, null, 2) + '\n'); writeJsonAtomic(prodFile(epId), prod);
  // episode tags on series assets (usedIn) follow the shots that reference them
  const sid = seriesOf(epId);
  if (sid) { const sf = seriesFile(sid); const s = readJson(sf); const used = new Set(prod.shots.flatMap((x) => x.assets.map((n) => String(n).toLowerCase())));
    for (const a of s.assets) { const has = (a.usedIn || []).includes(epId); const uses = used.has(a.name.toLowerCase()); if (uses && !has) a.usedIn = [...(a.usedIn || []), epId]; if (!uses && has && a.scope === 'episode') a.usedIn = a.usedIn.filter((x) => x !== epId); }
    writeJsonAtomic(sf, s); }
  return { saved: true, report };
}

export function register(app) {
  const wrap = (fn) => (req, res) => { try { const r = fn(req); res.json(r ?? { ok: true }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  app.get('/api/series', wrap(() => Object.keys(config.series || {}).map((sid) => { const s = loadSeries(sid); return { id: sid, name: s.name, assets: s.assets.length, version: s.version }; })));
  app.get('/api/series/:sid', wrap((req) => {
    const s = loadSeries(req.params.sid); const folder = config.series[req.params.sid];
    const episodes = Object.entries(config.episodes).filter(([, f]) => f.startsWith(folder + '/')).map(([id, f]) => { const m = f.split('/').pop().match(/^EP(\d+)_[^_]+_(.*)$/); return { id, ep: m ? +m[1] : null, label: m ? `EP${m[1]} ${m[2]}` : id }; }).sort((a, b) => (a.ep ?? 0) - (b.ep ?? 0));
    return { ...s, episodes };
  }));
  app.patch('/api/series/:sid', wrap((req) => {
    const sf = seriesFile(req.params.sid); const s = readJson(sf);
    if (req.body.style) s.style = { ...s.style, ...req.body.style };
    if (req.body.rules) s.rules = req.body.rules;
    if (req.body.promptTemplate) s.promptTemplate = req.body.promptTemplate;
    s.version = (s.version || 1) + 1; s.log.push({ at: now(), by: 'user', text: `series updated (v${s.version}): ${Object.keys(req.body).join(', ')}` });
    writeJsonAtomic(sf, s); return s;
  }));
  app.patch('/api/series/:sid/assets/:aid', wrap((req) => {
    const sf = seriesFile(req.params.sid); const s = readJson(sf); const a = s.assets.find((x) => x.id === req.params.aid); if (!a) throw new Error('no asset');
    for (const k of ['name', 'type', 'description', 'rules', 'locked', 'scope', 'usedIn', 'tags']) if (k in req.body) a[k] = req.body[k];
    s.version = (s.version || 1) + 1; s.log.push({ at: now(), by: 'user', text: `${a.id} updated` }); writeJsonAtomic(sf, s); return a;
  }));
  app.post('/api/series/:sid/assets', wrap((req) => {
    const sf = seriesFile(req.params.sid); const s = readJson(sf); const b = req.body || {};
    const id = (b.id || b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); if (!id || s.assets.some((a) => a.id === id)) throw new Error('id 중복 또는 비어 있음');
    const a = { id, name: b.name, type: b.type || 'character', description: b.description || '', rules: b.rules || [], locked: false, scope: b.scope || 'series', usedIn: b.usedIn || [], tags: b.tags || [], refs: [] };
    s.assets.push(a); s.log.push({ at: now(), by: 'user', text: `${id} created` }); writeJsonAtomic(sf, s); return a;
  }));
  app.post('/api/series/:sid/assets/:aid/adopt', wrap((req) => adoptAssetRef(req.params.sid, req.params.aid, req.body.file)));
  app.get('/api/episodes/:id/shots/:key/prompt', wrap((req) => {
    const prod = readJson(prodFile(req.params.id)); const shot = prod.shots.find((s) => s.key === req.params.key); const sid = seriesOf(req.params.id);
    if (!sid) return { text: shot.prompts.visual, refs: [], warnings: [], rules: [] };
    return composePrompt({ series: loadSeries(sid), production: prod, shot, kind: req.query.kind || 'keyframe' });
  }));
  app.patch('/api/episodes/:id/meta', wrap((req) => { const f = prodFile(req.params.id); const prod = readJson(f); prod.tools = { ...(prod.tools || {}), ...req.body }; prod.log.push({ at: now(), by: 'aside', text: `tools: ${Object.keys(req.body).join(', ')}` }); writeJsonAtomic(f, prod); return prod.tools; }));
  app.post('/api/episodes/:id/plan/check', wrap((req) => lintPlan(req.params.id, req.body)));
  app.put('/api/episodes/:id/plan', wrap((req) => savePlan(req.params.id, req.body, req.query.dry === '1')));
  app.post('/api/episodes/:id/shots/:key/adopt', wrap((req) => adopt(req.params.id, req.params.key, req.body || {})));
  app.get('/api/queue', wrap((req) => listJobs().filter((j) => (!req.query.episode || j.episode === req.query.episode) && (!req.query.status || String(req.query.status).split(',').includes(j.status)))));
  app.get('/api/queue/meta', wrap(() => ({ backends: BACKENDS, failure: FAILURE, credits: CREDITS })));
  app.post('/api/queue', wrap((req) => createJob(req.body || {})));
  app.post('/api/queue/:jid/approve', wrap((req) => transition(req.params.jid, 'approved', req.body)));
  app.post('/api/queue/:jid/start', wrap((req) => transition(req.params.jid, 'running', req.body)));
  app.post('/api/queue/:jid/fail', wrap((req) => transition(req.params.jid, 'failed', req.body)));
  app.post('/api/queue/:jid/cancel', wrap((req) => transition(req.params.jid, 'cancelled', req.body)));
  app.post('/api/queue/:jid/complete', wrap((req) => completeJob(req.params.jid, req.body)));
  // edit the prompt (and optionally durationSec) of a job that has not been submitted yet; keeps the previous text
  app.patch('/api/queue/:jid', wrap((req) => {
    const job = findJob(req.params.jid); const b = req.body || {};
    if (!['queued', 'approved'].includes(job.status)) throw Object.assign(new Error(`제출 전 작업만 수정할 수 있어요 (현재 ${job.status})`), { status: 409 });
    const changed = [];
    if (typeof b.prompt === 'string' && b.prompt !== job.input.prompt) { (job.input.promptHistory ||= []).push({ at: now(), prompt: job.input.prompt }); job.input.prompt = b.prompt; changed.push('prompt'); }
    if (b.durationSec != null && job.type === 'flow-veo') { job.input.durationSec = Number(b.durationSec); changed.push('durationSec'); }
    job.history.push({ at: now(), status: job.status, by: b.by || 'user', note: `edited: ${changed.join(', ') || 'nothing'}${b.note ? ' · ' + b.note : ''}` });
    return saveJob(job);
  }));
}
