// M4/M5: stage engine (12 steps with completion checks), episode ledger, narration editing, package
// (metadata + auto chapters + translations/subtitles checks + thumbnail spec), upload checklist, archive status.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, config, episodePaths, readJson } from '../../scripts/lib/paths.mjs';
import { seriesOf } from './m3.mjs';

const now = () => new Date().toISOString();
const writeJsonAtomic = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const prodFile = (id) => path.join(episodePaths(id).app, 'production.json');
const metaFile = (id) => path.join(episodePaths(id).app, 'metadata.json');
const exists = (f) => fs.existsSync(f);
const ls = (d, re) => (exists(d) ? fs.readdirSync(d).filter((f) => !re || re.test(f)) : []);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const UPLOAD_ITEMS = [
  ['uploaded', '비공개 업로드 (기본값: 교육, 영어, 아동용 아님)'],
  ['meta', '제목·설명(챕터)·태그 500자 이내'],
  ['playlist', '재생목록 (시리즈)'],
  ['ai-label', 'AI 사용 "예"'],
  ['thumbnail', '썸네일 (시리즈 고정 포맷, EP 번호)'],
  ['en-srt', '영어 SRT 업로드 후 "게시됨" 확인 (임시본 아님)'],
  ['auto-captions', '자동 영어 자막 삭제 시도 (다시 생기면 둠: 사용자 결정 2026-11-11)'],
  ['translations', '번역 제목·설명 + 번역 SRT 게시'],
  ['watch-verify', '시청 페이지 확인: 수동 영어 + 번역 36개 게시'],
  ['public', '공개 전환 (여러 편 모아 EP 순서대로)'],
];

// ---------- chapters from the Remotion manifest ----------
export function chapters(id) {
  const m = readJson(episodePaths(id).manifest); const meta = loadMeta(id);
  const titles = meta?.chapterTitles || [];
  const out = [{ t: 0, title: titles[0] || m.title }];
  m.scenes.forEach((sc, i) => out.push({ t: (m.titleCardFrames + sc.from) / m.fps, title: titles[i + 1] || sc.title }));
  return out.map((c) => ({ ...c, stamp: mmss(c.t) }));
}
export function loadMeta(id) { return exists(metaFile(id)) ? readJson(metaFile(id)) : null; }
export function composeDescription(id, meta = loadMeta(id)) {
  if (!meta) return '';
  const ch = chapters(id).map((c) => `${c.stamp} ${c.title}`).join('\n');
  return meta.description.replace('{chapters}', `Chapters\n${ch}`);
}
const tagLength = (tags) => tags.join(', ').length; // YouTube counts the comma-joined string (+ quotes for tags with spaces; approximate)

// ---------- package checks ----------
export function packageStatus(id) {
  const P = episodePaths(id); const meta = loadMeta(id); const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail });
  add('meta', '메타데이터 (제목·설명·태그)', !!(meta?.title && meta?.description), meta ? `제목 ${meta.title.length}자` : '_app/metadata.json 없음');
  if (meta) add('tags', '태그 500자 이내', tagLength(meta.tags) <= 500, `${tagLength(meta.tags)}/500자 · ${meta.tags.length}개`);
  if (meta) { const d = composeDescription(id, meta); add('desc-len', '설명 5000자 이내', d.length <= 5000, `${d.length}자`); }
  const thumb = ls(P.publish, /_thumbnail\.(jpg|png)$/)[0];
  let tinfo = '';
  if (thumb) { try { const s = fs.statSync(path.join(P.publish, thumb)).size; tinfo = `${thumb} ${(s / 1e6).toFixed(2)}MB`; add('thumbnail', '썸네일 (2MB 이하)', s <= 2e6, tinfo); } catch {} } else add('thumbnail', '썸네일', false, '1_발행본에 썸네일 없음');
  const en = path.join(P.publish, `${id}.en.srt`); const cues = (f) => (fs.readFileSync(f, 'utf8').match(/-->/g) || []).length;
  const enCues = exists(en) ? cues(en) : 0; add('en-srt', '영어 SRT', enCues > 0, exists(en) ? `${enCues}구간` : '없음');
  const subs = ls(path.join(P.publish, '자막'), /\.srt$/); const bad = subs.filter((f) => cues(path.join(P.publish, '자막', f)) !== enCues);
  add('subs', '번역 자막 구간 수 = 영어', subs.length > 0 && bad.length === 0, `${subs.length}개 언어${bad.length ? ` · 불일치 ${bad.join(', ')}` : ''}`);
  const tfile = ls(P.publish, /_metadata\.translations\.json$/)[0];
  if (tfile && meta) {
    const tr = readJson(path.join(P.publish, tfile)); const langs = Object.keys(tr);
    const stamps = new Set(chapters(id).map((c) => c.stamp)); const off = langs.filter((l) => { const ds = new Set((tr[l].description.match(/\b\d{1,2}:\d{2}\b/g) || [])); return [...stamps].some((s) => !ds.has(s)); });
    add('translations', '번역 제목·설명 (챕터 시간 일치)', langs.length > 0 && off.length === 0, `${langs.length}개 언어${off.length ? ` · 챕터 불일치 ${off.join(', ')}` : ''}`);
    const subLangs = new Set(subs.map((f) => f.split('.').slice(-2, -1)[0])); const missing = langs.filter((l) => !subLangs.has(l));
    add('lang-match', '번역 언어 = 자막 언어', missing.length === 0, missing.length ? `자막 없는 언어: ${missing.join(', ')}` : `${langs.length}개 일치`);
  } else add('translations', '번역 제목·설명', false, '번역 파일 없음');
  const yt = ls(P.publish, /_final_youtube\.mp4$/)[0]; add('video', 'YouTube 업로드본', !!yt, yt || '없음 (렌더 후 음량 정규화)');
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------- stage engine ----------
// Archived episodes never read media again (reading an evicted Drive file downloads it back): they return the snapshot taken
// at archive time. Live episodes are cached for 15 s per production.json mtime (package checks read ~40 SRT/JSON files).
const stageCache = new Map();
export function stages(id) {
  const pf = prodFile(id); const mt = fs.statSync(pf).mtimeMs; const hit = stageCache.get(id);
  if (hit && hit.mt === mt && Date.now() - hit.t < 15000) return hit.v;
  const prodA = readJson(pf);
  if (prodA.archive?.done && prodA.archive.stagesSnapshot) {
    const S = prodA.archive.stagesSnapshot.map((s) => (s.key === 'archive' ? { ...s, done: true, detail: `완료 ${prodA.archive.done.slice(0, 10)}` } : s));
    const v = { stages: S, current: S.find((s) => !s.done) || null, package: { ok: true, checks: [], snapshot: true }, openIssues: 0 };
    stageCache.set(id, { mt, t: Date.now(), v }); return v;
  }
  const v = stagesLive(id); stageCache.set(id, { mt, t: Date.now(), v }); return v;
}
function stagesLive(id) {
  const P = episodePaths(id); const prod = readJson(prodFile(id)); const ep = readJson(P.episodeJson);
  const shots = prod.shots || []; const ap = prod.approvals || {};
  const lines = ep.scenes.flatMap((s) => s.narration || []);
  const wavs = new Set(ls(path.join(P.src, 'narration'), /\.wav$/));
  const adoptedStart = (s) => s.keyframes.some((k) => k.state === 'adopted' && (s.type === 'image' ? true : k.role.startsWith('start') || k.role === 'render'));
  const vids = shots.filter((s) => s.type === 'video');
  const rv = exists(path.join(P.app, 'review.json')) ? readJson(path.join(P.app, 'review.json')) : { issues: [] };
  const openIssues = rv.issues.filter((i) => i.status !== 'resolved').length;
  const qcDir = path.join(P.app, 'qc'); const qcFinal = ls(qcDir, /final/).map((f) => { try { return readJson(path.join(qcDir, f)); } catch { return null; } }).filter(Boolean);
  const renders = [...ls(P.publish, /\.mp4$/), ...ls(P.out, /\.mp4$/)];
  const pk = packageStatus(id); const up = prod.upload?.checks || {};
  const S = [];
  const st = (n, key, label, done, detail, who) => S.push({ n, key, label, done: !!done, detail, who });
  st(1, 'plan', '기획', !!prod, `팩 ${prod.id}`, 'user');
  st(2, 'script', '대본 (G1)', lines.length > 0 && ap.G1, `${ep.scenes.length}장면 · 내레이션 ${lines.length}줄${ap.G1 ? ' · G1 승인' : ' · G1 대기'}`, ap.G1 ? 'aside' : 'user');
  st(3, 'narration', '내레이션', lines.length > 0 && lines.every((l) => wavs.has(`${l.id}.wav`)), `WAV ${lines.filter((l) => wavs.has(`${l.id}.wav`)).length}/${lines.length}`, 'worker');
  st(4, 'shots', '샷 설계', shots.length > 0 && shots.every((s) => s.prompts?.visual), `${shots.length}샷 (영상 ${vids.length})`, 'aside');
  st(5, 'keyframes', '키프레임', shots.length > 0 && shots.every(adoptedStart), `채택 ${shots.filter(adoptedStart).length}/${shots.length}`, 'aside');
  st(6, 'kf-review', '키프레임 검수 (G2)', ap.G2, ap.G2 ? `승인 ${ap.G2.at.slice(0, 10)}` : `검수 ${shots.filter((s) => s.kfReview).length}/${shots.length}`, 'user');
  st(7, 'video', '영상 생성', vids.length > 0 && vids.every((s) => s.clips.some((c) => c.state === 'adopted')), `채택 클립 ${vids.filter((s) => s.clips.some((c) => c.state === 'adopted')).length}/${vids.length}`, 'aside');
  st(8, 'edit', '편집', exists(P.manifest) && renders.length > 0, `manifest ${exists(P.manifest) ? '있음' : '없음'} · 렌더 ${renders.length}개`, 'worker');
  st(9, 'review', '검수 (G3)', ap.G3 && openIssues === 0, `${ap.G3 ? 'G3 승인' : 'G3 대기'} · 열린 지적 ${openIssues} · 기술 검사 ${qcFinal.length ? (qcFinal.some((q) => q.ok) ? '통과' : '문제') : '없음'}`, 'user');
  st(10, 'package', '패키지', pk.ok, `${pk.checks.filter((c) => c.ok).length}/${pk.checks.length} 통과`, 'aside');
  st(11, 'upload', '업로드', UPLOAD_ITEMS.filter(([k]) => k !== 'public').every(([k]) => up[k]?.done), `${UPLOAD_ITEMS.filter(([k]) => up[k]?.done).length}/${UPLOAD_ITEMS.length}${prod.youtube?.videoId ? ` · ${prod.youtube.videoId} (${prod.youtube.privacy})` : ''}`, 'aside');
  st(12, 'archive', '보관', !!prod.archive?.done, prod.archive?.done ? `완료 ${prod.archive.done.slice(0, 10)}` : '대기 (360p 프록시 → 목록 → 맥 캐시 비우기)', 'aside');
  const current = S.find((s) => !s.done) || null;
  // external blocker (e.g. YouTube daily upload limit, Flow anti-automation block): shown on the next step
  if (current && prod.blocker) { current.blocked = prod.blocker; current.detail += ` · 막힘: ${prod.blocker.reason}`; }
  if (current?.key === 'upload') { const q = uploadQuota(); if (q.remaining <= 0 && !prod.youtube?.videoId) { current.blocked = current.blocked || { reason: `YouTube 일일 업로드 한도 ${q.limit}편`, until: q.nextAt, auto: true }; } }
  return { stages: S, current, package: pk, openIssues };
}

// ---------- YouTube upload quota (user-confirmed 2026-11-11: 10 uploads per day) ----------
// counts production.youtube.uploadedAt (exact, recorded by Aside) or the 'uploaded' check time (older episodes) in the last 24 h
export function uploadQuota() {
  const limit = config.uploadDailyLimit || 10; const since = Date.now() - 24 * 3600e3; const times = [];
  for (const id of Object.keys(config.episodes)) { try { const p = readJson(prodFile(id)); const t = p.youtube?.uploadedAt || p.upload?.checks?.uploaded?.at; if (t && Date.parse(t) >= since) times.push({ id, at: t }); } catch {} }
  times.sort((a, b) => a.at.localeCompare(b.at));
  const used = times.length; let nextAt = used >= limit ? new Date(Date.parse(times[used - limit].at) + 24 * 3600e3).toISOString() : null; let remaining = Math.max(0, limit - used);
  // the app log is only an estimate (aborted/restarted uploads are not recorded); a limit actually shown by YouTube wins
  for (const id of Object.keys(config.episodes)) { try { const b = readJson(prodFile(id)).blocker; if (b?.until && /업로드 한도/.test(b.reason) && Date.parse(b.until) > Date.now()) { remaining = 0; if (!nextAt || b.until > nextAt) nextAt = b.until; } } catch {} }
  return { limit, used, remaining, nextAt, uploads: times, estimate: true };
}

// ---------- ledger ----------
export function ledger() {
  return Object.entries(config.episodes).map(([id, folder]) => {
    try {
      // folder names: EP003_<ID>_<title> or split parts EP010-1_<ID>_<title>
      const prod = readJson(prodFile(id)); const s = stages(id); const m = folder.split('/').pop().match(/^EP(\d+)(?:-(\d+))?_[^_]+_(.*)$/);
      const flow = (prod.credits?.ledger || []).reduce((a, x) => a + (x.credits || 0), 0) || prod.credits?.flow?.total || 0;
      return { id, series: seriesOf(id), seriesFolder: folder.split('/')[0], ep: m ? +m[1] : null, part: m?.[2] ? +m[2] : null, epLabel: m ? `EP${m[1]}${m[2] ? '-' + m[2] : ''}` : null, title: m?.[3] || id, enTitle: loadMeta(id)?.title || prod.title,
        stage: s.current ? `${s.current.n} ${s.current.label}` : '완료', next: s.current?.who || null, done: s.stages.filter((x) => x.done).length, blocked: s.current?.blocked || null,
        youtube: prod.youtube || null, scheduledPublish: prod.youtube?.scheduledPublish || null, public: !!prod.upload?.checks?.public?.done, uploadedAt: prod.youtube?.uploadedAt || prod.upload?.checks?.uploaded?.at || null, flowCredits: flow,
        length: (() => { try { const mf = readJson(episodePaths(id).manifest); return mf.durationInFrames / mf.fps; } catch { return null; } })() };
    } catch (e) { return { id, error: e.message }; }
  }).sort((a, b) => (a.seriesFolder || '').localeCompare(b.seriesFolder || '') || (a.ep ?? 0) - (b.ep ?? 0) || (a.part ?? 0) - (b.part ?? 0));
}
export function ledgerCsv() {
  const rows = ledger(); const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['EP', '시리즈', '팩 ID', '한글 제목', '영문 제목', '현재 단계', '다음 주체', 'YouTube URL', '공개 상태', '업로드일', '길이', 'Flow 크레딧', '공개 예약'];
  return [head.join(','), ...rows.map((r) => [r.epLabel || r.ep, r.seriesFolder, r.id, r.title, r.enTitle, r.stage, r.next, r.youtube?.videoId ? `https://youtu.be/${r.youtube.videoId}` : '', r.public ? '공개' : r.youtube ? r.youtube.privacy : '', r.uploadedAt?.slice(0, 10) || '', r.length ? mmss(r.length) : '', r.flowCredits, r.scheduledPublish || ''].map(q).join(','))].join('\n') + '\n';
}

// ---------- archive ----------
export function archiveStatus(id) {
  const P = episodePaths(id); const groups = {};
  let out = '';
  try { out = execFileSync('/usr/bin/find', [P.dir, '-type', 'f', '-not', '-name', '.*', '-exec', '/usr/bin/stat', '-f', '%Xf\t%z\t%N', '{}', '+'], { maxBuffer: 1 << 26 }).toString(); } catch (e) { out = e.stdout?.toString() || ''; }
  const files = [];
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [flags, size, file] = line.split('\t'); const rel = path.relative(P.dir, file); const top = rel.split('/')[0];
    const dataless = (parseInt(flags, 16) & 0x40000000) !== 0; files.push({ rel, size: +size, local: !dataless });
    const g = (groups[top] ||= { files: 0, size: 0, localSize: 0, cloudOnly: 0 }); g.files++; g.size += +size; if (dataless) g.cloudOnly++; else g.localSize += +size;
  }
  const total = files.reduce((a, f) => a + f.size, 0), local = files.filter((f) => f.local).reduce((a, f) => a + f.size, 0);
  const proxy = path.join(P.app, 'preview', 'proxy_360p.mp4');
  return { total, local, files: files.length, groups, proxy: exists(proxy) ? path.relative(P.dir, proxy) : null, archiveJson: exists(path.join(P.app, 'archive.json')), done: readJson(prodFile(id)).archive?.done || null };
}
export function writeArchiveJson(id) {
  const P = episodePaths(id); const st = archiveStatus(id);
  let out = ''; try { out = execFileSync('/usr/bin/find', [P.dir, '-type', 'f', '-not', '-name', '.*', '-exec', '/usr/bin/stat', '-f', '%z\t%m\t%N', '{}', '+'], { maxBuffer: 1 << 26 }).toString(); } catch (e) { out = e.stdout?.toString() || ''; }
  const files = out.trim().split('\n').filter(Boolean).map((l) => { const [size, mtime, f] = l.split('\t'); return { file: path.relative(P.dir, f), size: +size, mtime: new Date(+mtime * 1000).toISOString() }; }).sort((a, b) => a.file.localeCompare(b.file));
  const doc = { id, at: now(), workspace: config.episodes[id], total: st.total, files };
  writeJsonAtomic(path.join(P.app, 'archive.json'), doc); return { files: files.length, total: st.total };
}

export function register(app, { startJob }) {
  const wrap = (fn) => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  app.get('/api/episodes/:id/stages', wrap((req) => stages(req.params.id)));
  app.get('/api/ledger', wrap(() => ledger()));
  app.get('/api/upload-quota', wrap(() => uploadQuota()));
  // external blocker on an episode: {reason, until?} sets, {clear:true} removes (Aside records waits it cannot resolve itself)
  app.patch('/api/episodes/:id/blocker', wrap((req) => { const f = prodFile(req.params.id); const prod = readJson(f); const b = req.body || {};
    if (b.clear) delete prod.blocker; else prod.blocker = { reason: b.reason, until: b.until || null, by: b.by || 'aside', at: now() };
    prod.log.push({ at: now(), by: b.by || 'aside', text: b.clear ? 'blocker cleared' : `blocker: ${b.reason}${b.until ? ' (until ' + b.until + ')' : ''}` }); writeJsonAtomic(f, prod); return prod.blocker || { cleared: true }; }));
  app.get('/api/ledger.csv', (_req, res) => { res.type('text/csv; charset=utf-8').send('\ufeff' + ledgerCsv()); });

  // narration: edit lines (episode.json), run TTS / manifest as worker jobs, line durations
  app.get('/api/episodes/:id/narration', wrap((req) => {
    const P = episodePaths(req.params.id); const ep = readJson(P.episodeJson); let m = null; try { m = readJson(P.manifest); } catch {}
    const dur = {}; const subs = {};
    if (m) for (const sc of m.scenes) for (const ln of sc.lines) { dur[ln.id] = { sec: ln.duration / m.fps, estimated: ln.estimated }; subs[ln.id] = ln.subtitles.map((s) => s.text); }
    const wavDir = path.join(P.src, 'narration');
    return { voice: ep.voice, timing: ep.timing, scenes: ep.scenes.map((sc) => ({ scene: sc.scene, title: sc.title, captions: sc.captions, narration: (sc.narration || []).map((l) => ({ ...l, wav: exists(path.join(wavDir, `${l.id}.wav`)), wavMtime: exists(path.join(wavDir, `${l.id}.wav`)) ? fs.statSync(path.join(wavDir, `${l.id}.wav`)).mtime.toISOString() : null, ...dur[l.id], subtitles: subs[l.id] })) })), total: m ? m.durationInFrames / m.fps : null };
  }));
  app.patch('/api/episodes/:id/narration', wrap((req) => {
    const P = episodePaths(req.params.id); const ep = readJson(P.episodeJson); const b = req.body || {}; const changed = [];
    for (const u of b.lines || []) for (const sc of ep.scenes) for (const l of sc.narration || []) if (l.id === u.id && l.text !== u.text) { l.text = u.text; changed.push(l.id); const w = path.join(P.src, 'narration', `${l.id}.wav`); if (exists(w)) fs.renameSync(w, w.replace(/\.wav$/, `.stale-${Date.now()}.wav`)); }
    for (const u of b.captions || []) { const sc = ep.scenes.find((x) => x.scene === u.scene); if (sc) { sc.captions = u.captions; changed.push(`captions ${u.scene}`); } }
    if (b.voice) { ep.voice = { ...ep.voice, ...b.voice }; changed.push('voice'); }
    writeJsonAtomic(P.episodeJson, ep);
    const prod = readJson(prodFile(req.params.id)); prod.log.push({ at: now(), by: 'user', text: `narration: ${changed.join(', ')}` }); writeJsonAtomic(prodFile(req.params.id), prod);
    return { changed };
  }));
  app.post('/api/episodes/:id/tts', wrap((req) => { const j = startJob('tts', ['scripts/tts.mjs', req.params.id, ...(req.body?.force ? ['--force'] : [])], { episode: req.params.id }); j.onDone = (x) => { if (x.status === 'done') { const mj = startJob('manifest', ['scripts/build-manifest.mjs', req.params.id], { episode: req.params.id }); x.log.push(`manifest job ${mj.id}`); } }; return { job: j.id }; }));
  app.post('/api/episodes/:id/manifest', wrap((req) => ({ job: startJob('manifest', ['scripts/build-manifest.mjs', req.params.id], { episode: req.params.id }).id })));

  // package: metadata, chapters, translations, thumbnail
  app.get('/api/episodes/:id/package', wrap((req) => { const id = req.params.id; let ch = []; try { ch = chapters(id); } catch {} return { meta: loadMeta(id), chapters: ch, description: composeDescription(id), status: packageStatus(id), thumbnail: readJson(episodePaths(id).thumbnailJson) }; }));
  app.put('/api/episodes/:id/metadata', wrap((req) => { const m = { ...(loadMeta(req.params.id) || {}), ...req.body, updatedAt: now() }; writeJsonAtomic(metaFile(req.params.id), m); return m; }));
  app.post('/api/episodes/:id/metadata/export', wrap((req) => {
    const id = req.params.id; const P = episodePaths(id); const m = loadMeta(id); if (!m) throw new Error('metadata 없음');
    const md = `# ${id} YouTube metadata (English, primary)\n\n## Title\n${m.title}\n${(m.titleAlternatives || []).map((t) => `- alt: ${t}`).join('\n')}\n\n## Description\n${composeDescription(id, m)}\n\n## Tags\n${m.tags.join(', ')}\n\n## Settings\n${Object.entries(m.settings || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
    const f = path.join(P.publish, `${id}_metadata.en.md`); if (exists(f)) fs.copyFileSync(f, path.join(P.archive, `${id}_metadata.en.${Date.now()}.md`)); fs.writeFileSync(f, md); return { file: path.relative(P.dir, f), length: md.length };
  }));
  app.put('/api/episodes/:id/thumbnail', wrap((req) => { const f = episodePaths(req.params.id).thumbnailJson; const t = { ...readJson(f), ...req.body }; writeJsonAtomic(f, t); return t; }));
  app.post('/api/episodes/:id/thumbnail/render', wrap((req) => ({ job: startJob('render', ['scripts/render.mjs', req.params.id, 'thumb', ...(req.body?.publish ? ['--publish'] : [])], { episode: req.params.id, target: 'thumb' }).id })));

  // upload checklist (Aside or the user ticks items; videoId/privacy recorded on production.youtube)
  app.get('/api/episodes/:id/upload', wrap((req) => { const prod = readJson(prodFile(req.params.id)); return { items: UPLOAD_ITEMS.map(([k, label]) => ({ key: k, label, ...(prod.upload?.checks?.[k] || { done: false }) })), youtube: prod.youtube || null }; }));
  app.patch('/api/episodes/:id/upload', wrap((req) => {
    const f = prodFile(req.params.id); const prod = readJson(f); prod.upload = prod.upload || { checks: {} };
    for (const [k, v] of Object.entries(req.body.checks || {})) prod.upload.checks[k] = { done: !!v, at: now(), by: req.body.by || 'user' };
    if (req.body.youtube) prod.youtube = { ...(prod.youtube || {}), ...req.body.youtube };
    if (req.body.checks?.uploaded && prod.youtube && !prod.youtube.uploadedAt) prod.youtube.uploadedAt = now(); // for the daily upload counter
    if (req.body.checks?.uploaded && prod.blocker) delete prod.blocker;
    if (prod.upload.checks.public?.done && prod.youtube) prod.youtube.privacy = 'public';
    prod.log.push({ at: now(), by: req.body.by || 'user', text: `upload: ${Object.keys(req.body.checks || {}).join(', ')}` }); writeJsonAtomic(f, prod); return prod.upload;
  }));

  // archive
  app.get('/api/episodes/:id/archive', wrap((req) => archiveStatus(req.params.id)));
  app.post('/api/episodes/:id/archive/proxy', wrap((req) => ({ job: startJob('proxy', ['scripts/proxy.mjs', req.params.id], { episode: req.params.id }).id })));
  app.post('/api/episodes/:id/archive/index', wrap((req) => writeArchiveJson(req.params.id)));
  // make media online-only (Drive keeps the file; the local cache is removed). _app stays local for browsing.
  app.post('/api/episodes/:id/archive/evict', wrap((req) => {
    const P = episodePaths(req.params.id); const folders = (req.body?.folders?.length ? req.body.folders : ['1_발행본', '2_소스', '3_폐기_이전본', '4_프로젝트백업']).filter((f) => !f.startsWith('_app'));
    const j = { id: null }; const job = startJob('evict', [], { episode: req.params.id, cmd: '/usr/bin/swift', args: [path.join(root, 'scripts', 'evict.swift'), ...folders.map((f) => path.join(P.dir, f))] }); return { job: job.id };
  }));
  app.post('/api/episodes/:id/archive/done', wrap((req) => { const f = prodFile(req.params.id); const snap = req.body?.undo ? null : stagesLive(req.params.id).stages; const prod = readJson(f); prod.archive = { ...(prod.archive || {}), done: req.body?.undo ? null : now(), stagesSnapshot: snap }; if (!req.body?.undo) prod.stage = 'archived'; prod.log.push({ at: now(), by: req.body?.by || 'user', text: req.body?.undo ? 'archive undone' : 'archived' }); writeJsonAtomic(f, prod); return prod.archive; }));
}
