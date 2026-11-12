// Multi-topic support: channel + series profiles for the agent (AI-native entry points).
// GET /api/channel, GET /api/series/:id/profile, PATCH /api/series/:id/profile, GET /api/episodes/:id/profile,
// POST /api/series (runs scripts/new-series.mjs). The brief lists every series with its label and source.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, config, readJson } from '../../scripts/lib/paths.mjs';
import { profile, profileOfEpisode, seriesIds, seriesCommon, loadSeriesJson } from '../../scripts/lib/series.mjs';

const now = () => new Date().toISOString();
const reloadConfig = () => { const c = readJson(path.join(root, 'studio.config.json')); config.series = c.series; config.episodes = c.episodes; config.upcoming = c.upcoming; config.channel = c.channel; };

export function seriesOverview() {
  reloadConfig();
  return seriesIds().map((sid) => {
    const p = profile(sid); const eps = Object.entries(config.episodes).filter(([, f]) => f.startsWith(config.series[sid] + '/')).map(([id]) => id);
    return { id: sid, name: p.name, folder: p.folder, label: p.label, playlist: p.playlist, source: p.source?.name, topic: p.topic || null, episodes: eps.length, lastEpisode: eps.at(-1) || null, upcoming: (config.upcoming || []).filter((u) => u.series === sid) };
  });
}

export function channel() { reloadConfig(); return { ...(config.channel || {}), workspace: config.workspace, uploadDailyLimit: config.uploadDailyLimit || 10, series: seriesOverview() }; }

export function seriesProfile(sid) {
  reloadConfig(); const s = loadSeriesJson(sid); let rulesMd = ''; try { rulesMd = fs.readFileSync(path.join(seriesCommon(sid), '시리즈_규칙.md'), 'utf8'); } catch {}
  return { profile: profile(sid), style: s.style || null, rules: (s.rules || []).map((r) => ({ id: r.id, text: r.text })), assets: (s.assets || []).map((x) => x.name || x.id), rulesMd, version: s.version || 1 };
}

export function patchProfile(sid, body = {}) {
  const f = path.join(seriesCommon(sid), 'series.json'); const s = loadSeriesJson(sid);
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k], v) : v; return o; };
  if (body.profile) s.profile = merge(s.profile, body.profile);
  if (body.style) s.style = merge(s.style, body.style);
  if (Array.isArray(body.rules)) s.rules = body.rules;
  s.version = (s.version || 1) + 1; (s.log ||= []).push({ at: now(), by: body.by || 'aside', text: `profile updated: ${Object.keys(body).filter((k) => k !== 'by').join(', ')}` });
  const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(s, null, 1)); fs.renameSync(t, f);
  return seriesProfile(sid);
}

export function createSeries(body = {}) {
  if (!body.id || !body.name) throw Object.assign(new Error('id and name are required'), { status: 400 });
  const specFile = path.join(root, 'out', `series-${body.id}.json`); fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, JSON.stringify({ profile: body.profile || {}, style: body.style, rules: body.rules, notes: body.notes }, null, 1));
  const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'new-series.mjs'), body.id, '--name', body.name, ...(body.folder ? ['--folder', body.folder] : []), '--spec', specFile], { cwd: root }).toString();
  reloadConfig(); return JSON.parse(out);
}

export function seriesBrief() {
  const rows = seriesOverview();
  return `## 시리즈 (주제별 프로필: GET /api/series/:id/profile, 새 시리즈: POST /api/series)\n${rows.map((r) => `- ${r.id} · ${r.name} · 표기 "${r.label}" · 원문 ${r.source || '-'} · 에피소드 ${r.episodes}편${r.upcoming.length ? ` · 예정 ${r.upcoming.map((u) => u.label).join(', ')}` : ''}`).join('\n')}\n- 에피소드 작업 전 그 에피소드의 시리즈 규칙을 읽는다: GET /api/episodes/<ID>/profile (원문 출처, 인용 규칙, 표기, 재생목록, 쇼츠 문구, 목소리).\n`;
}

export function register(app) {
  const wrap = (fn) => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  app.get('/api/channel', wrap(() => channel()));
  app.get('/api/series/:id/profile', wrap((req) => seriesProfile(req.params.id)));
  app.patch('/api/series/:id/profile', wrap((req) => patchProfile(req.params.id, req.body)));
  app.get('/api/episodes/:id/profile', wrap((req) => profileOfEpisode(req.params.id)));
  app.post('/api/series', wrap((req) => createSeries(req.body)));
}
