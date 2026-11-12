// Agent layer (2026-11-11): endpoints designed for an AI operator (Aside) rather than the human UI.
//   GET  /api                     self-describing route index
//   GET  /api/next                every episode's next action, owner, blocker and "how" (commands/helpers) in one call
//   GET  /api/episodes/:id/summary compact episode state (no shot arrays)
//   GET  /api/flow/plan           Google Flow work plan: what to submit, what to collect, pacing, block state
//   POST /api/queue/:jid/submitted record a Flow submission (pacing + collect list)
//   POST /api/flow/block          record / clear a Flow anti-automation block
//   GET  /api/agent/brief         one compact markdown brief for a fresh agent context (rules + live state)
//   GET  /api/agent/helpers.js    the Aside REPL helper library (eval it in the REPL)
import fs from 'node:fs';
import path from 'node:path';
import { root, config, episodePaths, readJson } from '../../scripts/lib/paths.mjs';
import { listJobs, findJob, saveJob } from './m3.mjs';
import { stages, ledger, uploadQuota, packageStatus } from './m4.mjs';

const now = () => new Date().toISOString();
const STATE = path.join(root, 'state', 'flow.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { submissions: [], block: null }; } };
const writeState = (s) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); };
const prodFile = (id) => path.join(episodePaths(id).app, 'production.json');
const epTag = (id) => id.replace('BIB-GEN-00', 'EP'); // Flow upload names: EP9_S01-01_START_v1.png, BIB-GEN-010-1_S01-01_START_v1.png
const epLabel = (id) => (config.episodes[id].split('/').pop().match(/^(EP\d+(?:-\d+)?)_/) || [])[1] || id;
const FLOW_GAP_SEC = 90; // one job at a time, 60-90 s apart (anti-automation, see longform-flow-veo skill)

// ---------- route index ----------
const DOC = {
  'GET /api': 'this index',
  'GET /api/next': 'all episodes: next step, owner (aside/user/worker), blocker, how-to; start every session here',
  'GET /api/agent/brief': 'markdown brief = standing rules (docs/agent-rules.md) + live next actions + Flow plan + upload quota',
  'GET /api/agent/helpers.js': 'Aside REPL helpers: eval(await (await fetch(url)).text()); await lmsAttach()',
  'GET /api/episodes/:id/summary': 'compact state of one episode',
  'GET /api/flow/plan': 'Flow queue: submit list (approved), collect list (running, with START tile label), pacing, block',
  'POST /api/queue/:jid/submitted': 'record a Flow submission {at?, cost?}',
  'POST /api/flow/block': 'record a Flow block {message} or clear it {clear:true}',
  'GET /api/episodes': 'episode list with stageLabel',
  'GET /api/episodes/:id': 'FULL episode + production (large: prefer /summary)',
  'GET /api/episodes/:id/stages': '12-step engine for one episode',
  'GET /api/ledger': 'ledger rows (epLabel, stage, youtube, scheduledPublish, blocked)',
  'GET /api/upload-quota': 'YouTube uploads in 24 h vs limit 10, nextAt',
  'PATCH /api/episodes/:id/blocker': 'external wait {reason, until} | {clear:true}',
  'POST /api/episodes/:id/approve': 'gate {gate:G1|G2|G3, by:"aside"|"user", note}',
  'GET /api/queue': 'jobs (?episode=&status=queued,approved,running)',
  'POST /api/queue': 'create job (flow-veo: use scripts/mkveo.mjs)',
  'PATCH /api/queue/:jid': 'edit prompt/durationSec before submission',
  'POST /api/queue/:jid/complete': 'register outputs (flow-veo: scripts/flow-ingest.mjs does this)',
  'POST /api/queue/:jid/fail': '{category, message, credits}',
  'POST /api/episodes/:id/shots/:key/adopt': '{kind:"clip"|"keyframe", file, segments?}',
  'PATCH /api/episodes/:id/shots/:key': 'status/defects/note; segments (video) or Ken Burns motion (image only)',
  'GET /api/episodes/:id/package': 'metadata, chapters, composed description, package checks',
  'PATCH /api/episodes/:id/upload': 'upload checklist {checks:{…}, youtube:{videoId, privacy, scheduledPublish}, by}',
  'POST /api/episodes/:id/archive/done': 'mark archived {by} (snapshot stages BEFORE evict)',
};
export function apiIndex(app) {
  const out = []; const stack = app.router?.stack || app._router?.stack || [];
  for (const l of stack) { const r = l.route; if (!r || !String(r.path).startsWith('/api')) continue; for (const m of Object.keys(r.methods)) { const k = `${m.toUpperCase()} ${r.path}`; out.push({ route: k, doc: DOC[k] || '' }); } }
  return { note: 'AI-facing entry points first: /api/next, /api/agent/brief, /api/flow/plan, /api/episodes/:id/summary', routes: out.sort((a, b) => (b.doc ? 1 : 0) - (a.doc ? 1 : 0) || a.route.localeCompare(b.route)) };
}

// ---------- compact summary ----------
export function summary(id) {
  const prod = readJson(prodFile(id)); const s = stages(id); const shots = prod.shots || [];
  const vids = shots.filter((x) => x.type === 'video');
  const q = {}; for (const j of listJobs().filter((j) => j.episode === id)) q[`${j.type}:${j.status}`] = (q[`${j.type}:${j.status}`] || 0) + 1;
  return {
    id, epLabel: epLabel(id), title: prod.title, stage: s.current ? `${s.current.n} ${s.current.label}` : '완료', who: s.current?.who || null, detail: s.current?.detail || null, blocked: s.current?.blocked || null,
    approvals: Object.fromEntries(Object.entries(prod.approvals || {}).map(([g, a]) => [g, { by: a.by, at: a.at }])),
    shots: { total: shots.length, video: vids.length, clipsAdopted: vids.filter((x) => x.clips.some((c) => c.state === 'adopted')).length, keyframesAdopted: shots.filter((x) => x.keyframes.some((k) => k.state === 'adopted')).length },
    queue: q, youtube: prod.youtube ? { videoId: prod.youtube.videoId, privacy: prod.youtube.privacy, scheduledPublish: prod.youtube.scheduledPublish || null } : null,
    archive: prod.archive ? { done: prod.archive.done || null, evictPending: !!prod.archive.evictPending } : null,
  };
}

// ---------- next release slot (1 per day, 06:00 New York, EP order) ----------
function nextReleaseSlot() {
  const dates = ledger().map((r) => r.scheduledPublish).filter(Boolean).map((d) => d.slice(0, 10)).sort();
  if (!dates.length) return null; const d = new Date(dates[dates.length - 1] + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  const ymd = d.toISOString().slice(0, 10); return { date: ymd, studio: `${+ymd.slice(0, 4)}. ${+ymd.slice(5, 7)}. ${+ymd.slice(8, 10)}.`, iso: `${ymd}T06:00:00-05:00` };
}

// ---------- how-to per step (keep short: names of scripts/helpers, details live in the skill) ----------
function howFor(id, cur, jobs) {
  const E = id; const vj = jobs.filter((j) => j.type === 'flow-veo');
  switch (cur.key) {
    case 'plan': case 'script': return ['OpenCrab 팩 읽기(opencrab_query package_id) → 대본(단어 상한 없음, 8분 넘으면 분할) → POST /api/episodes/' + E + '/approve {gate:"G1",by:"aside",note}'];
    case 'narration': return [`node scripts/tts.mjs ${E} && node scripts/build-manifest.mjs ${E}`, 'voice: Ava (Premium) rate 115, timing.lineGapSec 1.0 확인'];
    case 'shots': return [`POST /api/episodes/${E}/plan/check → PUT /api/episodes/${E}/plan`];
    case 'keyframes': return ['gpt-keyframe / gpt-endframe 작업 → POST /api/queue/<job>/run-local (Codex, 한 번에 1건)'];
    case 'kf-review': return ['키프레임 직접 검수(얼굴·옆모습·글자·유혈) → POST /approve {gate:"G2",by:"aside",note}'];
    case 'video': {
      const ap = vj.filter((j) => j.status === 'approved').length, run = vj.filter((j) => j.status === 'running').length, open = ap + run;
      const out = [];
      if (run) out.push(`수집 ${run}건: REPL collectShot((await flowPlan()).collect[0]) 를 done:true가 나올 때까지 반복 호출(한 번에 90초 이내, 이어서 진행) → 돌려준 ingest 명령을 Bash로 실행`);
      if (ap) out.push(`제출 ${ap}건: REPL const L = await pacedList('${E}'); 이후 await pacedNext(L) 반복 (동작마다 3~5초 랜덤 대기, 5건마다 pacedCheck, 하루 35건 안팎에서 끊기)`);
      if (!open) out.push(`작업 없음: node scripts/mkveo.mjs ${E} (채택된 시작·끝 프레임이 있는 영상 샷)`);
      out.push(`검수: REPL clipSheet('${E}', shots) → 채택 POST /api/episodes/${E}/shots/<key>/adopt {kind:"clip",file}`);
      return out;
    }
    case 'edit': return [`node scripts/build-manifest.mjs ${E} && node scripts/render.mjs ${E} final --publish && node scripts/loudnorm.mjs ${E}`];
    case 'review': return [`node scripts/qc.mjs ${E} <1_발행본>/${E}_final_youtube.mp4 --json <ep>/_app/qc/final_youtube.json → 클립 검수 → POST /approve {gate:"G3",by:"aside",note}`];
    case 'package': return [`node scripts/export-srt.mjs ${E} --out <1_발행본>; node scripts/translate.mjs ${E} --jobs 6; metadata/thumbnail 확인 (GET /package)`];
    case 'upload': { const slot = nextReleaseSlot(); return ['하루 업로드 10편 이내 (GET /api/upload-quota)', 'REPL ytUpload → 업로드 중 표시가 사라질 때까지 대기 → ytFinish → Studio 목록 확인 → enSub → langLoop → delAutoEn 1회', slot ? `ytSchedule(videoId, '${slot.studio}') (다음 슬롯, 뉴욕 06:00)` : 'ytSchedule(videoId, 다음 날짜)', 'PATCH /upload {checks…, youtube:{videoId, privacy, scheduledPublish}, by:"aside"}']; }
    case 'archive': return [`node scripts/proxy.mjs ${E} → POST /archive/index → POST /archive/done {by:"aside"} → swift scripts/evict.swift <1_발행본 2_소스 3_폐기_이전본 4_프로젝트백업>`];
    default: return [];
  }
}

export function nextActions() {
  const jobs = listJobs(); const items = [];
  for (const id of Object.keys(config.episodes)) {
    try {
      const s = stages(id); const prod = readJson(prodFile(id)); const ej = jobs.filter((j) => j.episode === id);
      if (!s.current) { if (prod.archive?.evictPending) items.push({ episode: id, epLabel: epLabel(id), step: '12 보관', who: 'aside', detail: '맥 캐시 비우기 보류 (Drive 동기화 대기)', how: [`swift scripts/evict.swift <${id} 폴더들> (실패하면 나중에)`] }); continue; }
      items.push({ episode: id, epLabel: epLabel(id), step: `${s.current.n} ${s.current.label}`, key: s.current.key, who: s.current.who, detail: s.current.detail, blocked: s.current.blocked || null, how: howFor(id, s.current, ej) });
    } catch (e) { items.push({ episode: id, error: e.message }); }
  }
  // standing order (2026-11-10): keep producing. When no unblocked production work is left, propose the next planned episode.
  const busy = items.some((x) => !x.blocked && !x.error && x.key && !['archive', 'upload'].includes(x.key));
  const up = (config.upcoming || [])[0];
  if (!busy && up) items.push({ episode: null, epLabel: up.label, step: '새 에피소드', key: 'new', who: 'aside', detail: `${up.title || ''} ${up.pack ? '(팩 ' + up.pack + ')' : ''}`.trim(), how: ['clear 또는 새 작업에서 시작 (에피소드마다 새 컨텍스트)', `OpenCrab opencrab_query package_id=${up.pack || '?'} → 대본 → node scripts/new-episode.mjs <ID> --series bible-in-order --ep <N> --title … --en … → 서버 재시작`, '등록 후 voice.rate 115 / timing.lineGapSec 1.0 확인', ...((config.upcoming || [])[1]?.note ? [`그다음: ${config.upcoming[1].note}`] : [])] });
  const order = (x) => (x.blocked ? 2 : x.who === 'aside' || x.who === 'worker' ? 0 : 1);
  items.sort((a, b) => order(a) - order(b) || a.epLabel?.localeCompare(b.epLabel || '') || 0);
  return { at: now(), uploadQuota: uploadQuota(), nextReleaseSlot: nextReleaseSlot(), flow: flowPlan({ brief: true }), actions: items };
}

// ---------- Flow plan ----------
export function flowPlan({ brief = false } = {}) {
  const st = readState(); const jobs = listJobs().filter((j) => j.type === 'flow-veo' && ['approved', 'running'].includes(j.status));
  const last = st.submissions[st.submissions.length - 1]?.at || null;
  const nextSubmitAt = last ? new Date(Date.parse(last) + FLOW_GAP_SEC * 1000).toISOString() : null;
  const submit = jobs.filter((j) => j.status === 'approved').sort((a, b) => a.episode.localeCompare(b.episode) || a.target.shot.localeCompare(b.target.shot))
    .map((j) => ({ job: j.id, episode: j.episode, shot: j.target.shot, start: path.basename(j.input.start?.file || ''), end: path.basename(j.input.end?.file || ''), credits: j.credits?.estimated }));
  const collect = jobs.filter((j) => j.status === 'running').map((j) => ({ job: j.id, episode: j.episode, shot: j.target.shot, tileLabel: `${epTag(j.episode)}_${j.target.shot}_START`, submittedAt: j.flow?.submittedAt || null }));
  const lastHour = st.submissions.filter((s) => Date.parse(s.at) > Date.now() - 3600e3).length;
  const plan = { block: st.block, canSubmitNow: !st.block && (!nextSubmitAt || Date.parse(nextSubmitAt) <= Date.now()), nextSubmitAt, gapSec: FLOW_GAP_SEC, submittedLastHour: lastHour, submitCount: submit.length, collectCount: collect.length };
  return brief ? plan : { ...plan, submit, collect, project: config.flowProjectUrl || 'https://flow.google.com/', rules: ['한 번에 1건, 60-90초 간격', "'비정상적인 활동' → POST /api/flow/block 후 중단, 한참 뒤 1건만 재시도", '우회 시도 금지'] };
}
export function markSubmitted(jid, body = {}) {
  if (body.at && Number.isNaN(Date.parse(body.at))) throw Object.assign(new Error('at은 ISO 시각이어야 해요'), { status: 400 });
  const job = findJob(jid); job.flow = { ...(job.flow || {}), submittedAt: body.at || now(), cost: body.cost ?? null };
  if (job.status === 'approved') { job.status = 'running'; job.history.push({ at: now(), status: 'running', by: 'aside', note: 'submitted to Flow' }); }
  saveJob(job); const st = readState(); st.submissions.push({ at: job.flow.submittedAt, job: jid }); st.submissions = st.submissions.slice(-200); writeState(st);
  return { job: jid, submittedAt: job.flow.submittedAt };
}
export function setFlowBlock(body = {}) { const st = readState(); st.block = body.clear ? null : { at: now(), message: body.message || 'blocked' }; (st.blocks ||= []).push({ at: now(), clear: !!body.clear, message: body.message || null }); writeState(st); return { block: st.block }; }

// ---------- brief ----------
export function brief() {
  let rules = ''; try { rules = fs.readFileSync(path.join(root, 'docs', 'agent-rules.md'), 'utf8'); } catch {}
  const n = nextActions(); const q = n.uploadQuota; const f = n.flow;
  const line = (a) => `- ${a.epLabel} · ${a.step} · ${a.who}${a.blocked ? ` · 막힘: ${a.blocked.reason}${a.blocked.until ? ' (' + a.blocked.until + ' 이후)' : ''}` : ''}\n${(a.how || []).map((h) => `    - ${h}`).join('\n')}`;
  return `${rules.trim()}\n\n## 지금 상태 (${n.at})\n- YouTube 업로드: 24시간 ${q.used}/${q.limit}${q.nextAt ? `, 다음 가능 ${q.nextAt}` : ''} (추정, 실제 막힘 우선)\n- 다음 공개 예약 슬롯: ${n.nextReleaseSlot?.studio || '-'} 06:00 뉴욕\n- Flow: ${f.block ? `차단 중 (${f.block.message}, ${f.block.at})` : '차단 없음'} · 제출 대기 ${f.submitCount} · 수집 대기 ${f.collectCount} · 최근 1시간 제출 ${f.submittedLastHour}${f.nextSubmitAt ? ` · 다음 제출 가능 ${f.nextSubmitAt}` : ''}\n\n## 다음 할 일\n${n.actions.map(line).join('\n')}\n`;
}

export function register(app) {
  const wrap = (fn) => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  app.get('/api', wrap(() => apiIndex(app)));
  app.get('/api/next', wrap(() => nextActions()));
  app.get('/api/episodes/:id/summary', wrap((req) => summary(req.params.id)));
  app.get('/api/flow/plan', wrap(() => flowPlan()));
  app.post('/api/queue/:jid/submitted', wrap((req) => markSubmitted(req.params.jid, req.body)));
  app.post('/api/flow/block', wrap((req) => setFlowBlock(req.body)));
  app.get('/api/agent/brief', (_req, res) => { try { res.type('text/markdown; charset=utf-8').send(brief()); } catch (e) { res.status(500).send(String(e.message)); } });
  app.get('/api/agent/helpers.js', (_req, res) => res.type('application/javascript; charset=utf-8').sendFile(path.join(root, 'agent', 'repl_helpers.js')));
}
