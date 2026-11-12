// Create a new series (topic) for the channel: folder, 00_시리즈공통/series.json (style, rules, assets, profile),
// 시리즈_규칙.md, and the registration in studio.config.json "series".
// usage: node scripts/new-series.mjs <series-id> --name "<Series Name>" [--folder "<NN_Folder Name>"] [--spec <spec.json>]
//   spec.json (written by the agent): { "profile": {...}, "style": {...}, "rules": [{id, text, prompt}], "notes": "markdown for 시리즈_규칙.md" }
//   profile fields (see scripts/lib/series.mjs DEFAULT_PROFILE): label, playlist, subject, topic, idPattern, epLabel,
//   source {name, license, quoteRule, translateRule ({LANG} placeholder), keepInEnglish}, glossaryRule, descriptionFooter,
//   shorts {closing ({work} placeholder), hashtags, endCard}, voice {voice, rate, lineGapSec}, research {source, packQuery}, flowProject
// Prints the resulting profile and which fields still use the Bible defaults (fix those before the first episode).
import fs from 'node:fs';
import path from 'node:path';
import { root, config } from './lib/paths.mjs';
import { DEFAULT_PROFILE, profile } from './lib/series.mjs';

const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const sid = a[0]; const name = opt('name');
if (!sid || !name || !/^[a-z0-9-]+$/.test(sid)) { console.error('usage: node scripts/new-series.mjs <series-id (a-z0-9-)> --name "<Series Name>" [--folder "<NN_Name>"] [--spec spec.json]'); process.exit(1); }
if (config.series?.[sid]) { console.error(`series ${sid} already exists (${config.series[sid]}); edit its profile with PATCH /api/series/${sid}/profile`); process.exit(1); }
const spec = opt('spec') ? JSON.parse(fs.readFileSync(opt('spec'), 'utf8')) : {};
const nums = Object.values(config.series || {}).map((f) => Number((f.match(/^(\d+)_/) || [])[1] || 0));
const folder = opt('folder') || `${String(Math.max(0, ...nums) + 1).padStart(2, '0')}_${name}`;
const common = path.join(config.workspace, folder, '00_시리즈공통');
for (const d of ['assets', '썸네일_기본', path.join('_app', 'jobs')]) fs.mkdirSync(path.join(common, d), { recursive: true });
const now = new Date().toISOString();
const seriesJson = {
  id: sid, name, folder, version: 1,
  style: spec.style || { name: sid, prompt: '', gptSuffix: '', refs: [], note: 'fill: visual style prompt for this series' },
  rules: spec.rules || [],
  assets: [],
  profile: spec.profile || {},
  log: [{ at: now, by: 'aside', text: 'series created by scripts/new-series.mjs' }],
};
fs.writeFileSync(path.join(common, 'series.json'), JSON.stringify(seriesJson, null, 1));
fs.writeFileSync(path.join(common, '시리즈_규칙.md'), `${name} 시리즈 규칙\n\n${spec.notes || '순서, ID 형식, 원문 출처, 시각 규칙, 썸네일, 재생목록을 적는다.'}\n`);
// register (keep key order: channel/series before episodes)
const cfgFile = path.join(root, 'studio.config.json'); const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
c.series = { ...(c.series || {}), [sid]: folder }; const { episodes, ...rest } = c; fs.writeFileSync(cfgFile, JSON.stringify({ ...rest, episodes }, null, 2) + '\n');
config.series = c.series;
const p = profile(sid);
const stillDefault = []; const walk = (d, v, pre = '') => { for (const [k, x] of Object.entries(d)) { const key = pre + k; if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, v?.[k], key + '.'); else if (JSON.stringify(v?.[k]) === JSON.stringify(x)) stillDefault.push(key); } };
walk(DEFAULT_PROFILE, p);
console.log(JSON.stringify({ series: sid, folder, common, profile: p, stillBibleDefaults: stillDefault.filter((k) => k !== 'flowProject'), next: ['fill the fields in stillBibleDefaults (PATCH /api/series/' + sid + '/profile)', 'set style.prompt/gptSuffix and rules, then create series assets (characters, places) as gpt-asset jobs', 'restart the app server so it reloads studio.config.json', 'add the first episode: node scripts/new-episode.mjs <ID> --series ' + sid + ' --ep 1 --title "..."'] }, null, 1));
