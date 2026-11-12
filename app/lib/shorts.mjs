// Promo shorts (YouTube Shorts / Reels) as child items of an episode.
// Files per short: <episode>/_app/shorts/<SHORT_ID>/short.json (agent-written spec), build.json (last build by
// scripts/short-build.mjs), state.json (review / publish records written through PATCH /api/shorts/:id/state).
// Output: <episode>/1_발행본/shorts/<SHORT_ID>.mp4. Skill: longform-shorts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, config, episodePaths, readJson } from '../../scripts/lib/paths.mjs';

const now = () => new Date().toISOString();
const rj = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, data) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(data, null, 1)); fs.renameSync(t, f); };
const err = (status, message) => Object.assign(new Error(message), { status });

export function shortDir(id) {
  const m = String(id).match(/^(.+)-S(\d+)$/); if (!m || !config.episodes[m[1]]) throw err(404, 'unknown short ' + id);
  const P = episodePaths(m[1]); return { ep: m[1], P, dir: path.join(P.app, 'shorts', id), mp4: path.join(P.publish, 'shorts', `${id}.mp4`) };
}

const STEPS = [
  ['spec', '기획', 'aside'], ['build', '빌드', 'aside'], ['review', '검수', 'aside'],
  ['upload', '업로드(비공개)', 'aside'], ['link', '롱폼 연결', 'aside'], ['public', '공개', 'user'],
];

export function shortState(id) {
  const { ep, P, dir, mp4 } = shortDir(id);
  const specF = path.join(dir, 'short.json'); const spec = rj(specF, null); if (!spec) throw err(404, 'no short.json for ' + id);
  const build = rj(path.join(dir, 'build.json')); const state = rj(path.join(dir, 'state.json'), {});
  const specAt = fs.statSync(specF).mtime.toISOString();
  const built = !!build && !build.problems?.length && build.at >= specAt && fs.existsSync(mp4);
  const yt = state.youtube || {};
  const done = {
    spec: (spec.beats || []).length > 0 && (spec.hook || []).some(Boolean),
    build: built,
    review: built && !!state.review && state.review.at >= build.at,
    upload: !!yt.videoId,
    public: yt.privacy === 'public',
    link: !!yt.relatedLinked,
  };
  // linking a Short to a video needs YouTube's one-time advanced-features verification, which only the user can do
  const steps = STEPS.map(([key, label, who], i) => ({ n: i + 1, key, label, who: key === 'link' && yt.linkBlockedBy && !yt.relatedLinked ? 'user' : who, done: done[key] }));
  const current = steps.find((s) => !s.done) || null;
  return {
    id, episode: ep, hook: (spec.hook || []).join(' / ').replace(/\*/g, ''), durationSec: build?.durationSec ?? null,
    stale: !!build && build.at < specAt, problems: build?.problems || [], warnings: build?.warnings || [],
    steps, current, state, upload: spec.upload || {},
    files: { spec: specF, mp4: fs.existsSync(mp4) ? mp4 : null, video: fs.existsSync(mp4) ? `/files/${ep}/${encodeURIComponent('1_발행본')}/shorts/${encodeURIComponent(id + '.mp4')}` : null, sheet: build?.sheet || null, sheetSize: build?.sheetSize || null },
    builtAt: build?.at || null, specAt,
  };
}

export function howForShort(s) {
  const id = s.id; const c = s.current?.key;
  switch (c) {
    case 'spec': return [`short.json 작성 (스킬 longform-shorts): hook 2줄, beats(say=내레이션 id 또는 new:문장, shots=샷 키 + from 앵커), upload.relatedVideo`, `후보: GET /api/episodes/${s.episode}/short-candidates · 위치: node scripts/subject-map.mjs ${s.episode}`];
    case 'build': return [s.problems.length ? `문제 해결: ${s.problems.join(' / ')}` : `node scripts/short-build.mjs ${id} --dry → node scripts/short-build.mjs ${id} (또는 POST /api/shorts/${id}/build)`];
    case 'review': return [`build.json sheet 열어 프레임 검수(피사체·자막·잘림) → PATCH /api/shorts/${id}/state {"review":{"by":"aside","note":"…"}}`];
    case 'upload': return ['GET /api/upload-quota 확인(쇼츠도 하루 10편 한도에 포함)', `YouTube Studio 비공개 업로드: 제목 ${s.upload.title || '(short.json upload.title)'} → PATCH /api/shorts/${id}/state {"youtube":{"videoId":"…","privacy":"private"}}`];
    case 'public': return ['공개 전환은 사용자 확인 후에만 (예약 공개 포함)'];
    case 'link': return s.state.youtube?.linkBlockedBy && !s.state.youtube?.relatedLinked ? [`사용자: YouTube 고급 기능 일회성 인증(Studio 설정 → 채널 → 기능 사용 자격요건) 완료 필요. 끝나면 Aside가 편집 화면 "관련 동영상"에 ${s.upload.relatedVideo || '롱폼'} 연결`] : [`Studio 편집 → 관련 동영상 = ${s.upload.relatedVideo || '(롱폼 videoId)'} → PATCH /api/shorts/${id}/state {"youtube":{"relatedLinked":true}}`];
    default: return [];
  }
}

export function listShorts() {
  const out = [];
  for (const ep of Object.keys(config.episodes)) {
    let dir; try { dir = path.join(episodePaths(ep).app, 'shorts'); } catch { continue; }
    if (!fs.existsSync(dir)) continue;
    for (const id of fs.readdirSync(dir).filter((d) => /-S\d+$/.test(d)).sort((a, b) => Number(a.split('-S').pop()) - Number(b.split('-S').pop()))) {
      try { const s = shortState(id); out.push({ ...s, how: howForShort(s) }); } catch (e) { out.push({ id, episode: ep, error: e.message }); }
    }
  }
  return out;
}

export function patchState(id, body = {}) {
  const { dir } = shortDir(id); const f = path.join(dir, 'state.json'); const st = rj(f, {}); const by = body.by || 'aside';
  if (body.review) st.review = { by, at: now(), note: body.review.note || '' };
  for (const k of ['youtube', 'instagram', 'facebook']) if (body[k]) st[k] = { ...(st[k] || {}), ...body[k], updatedAt: now(), by };
  if (body.youtube?.videoId && !st.youtube.uploadedAt) st.youtube.uploadedAt = now(); // counts toward the 10 uploads / 24 h limit
  (st.log ||= []).push({ at: now(), by, keys: Object.keys(body).filter((k) => k !== 'by') });
  writeJson(f, st); return shortState(id);
}

const node = process.execPath;
export function candidates(ep) {
  const out = execFileSync(node, [path.join(root, 'scripts', 'short-build.mjs'), '--candidates', ep], { cwd: root, maxBuffer: 1 << 24 }).toString();
  return JSON.parse(out);
}
export function createShort(ep) {
  const out = execFileSync(node, [path.join(root, 'scripts', 'short-build.mjs'), '--init', ep], { cwd: root, maxBuffer: 1 << 24 }).toString();
  return JSON.parse(out);
}

export function register(app, { startJob }) {
  const wrap = (fn) => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  app.get('/api/shorts', wrap(() => listShorts()));
  app.get('/api/shorts/:id', wrap((req) => { const s = shortState(req.params.id); const { dir } = shortDir(req.params.id); return { ...s, how: howForShort(s), spec: rj(path.join(dir, 'short.json')), build: rj(path.join(dir, 'build.json')) }; }));
  app.get('/api/episodes/:id/short-candidates', wrap((req) => candidates(req.params.id)));
  app.post('/api/episodes/:id/shorts', wrap((req) => createShort(req.params.id)));
  app.post('/api/shorts/:id/build', wrap((req) => { const { ep } = shortDir(req.params.id); return { job: startJob('short', ['scripts/short-build.mjs', req.params.id, ...(req.body?.dry ? ['--dry'] : [])], { episode: ep, target: req.params.id }).id }; }));
  app.patch('/api/shorts/:id/state', wrap((req) => patchState(req.params.id, req.body)));
}
