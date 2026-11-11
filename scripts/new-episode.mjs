// Usage: node scripts/new-episode.mjs <ID> --series <sid> --ep <N> --title "<한글 제목>" [--en "<English title>"]
// Creates <WORKSPACE>/<series folder>/EP###_<ID>_<title>/ with the standard layout, an episode.json skeleton
// (format/voice/timing/bgm settings copied from the latest episode of the same series), an empty production.json,
// and registers the episode in studio.config.json and src/episodes/registry.ts.
import fs from 'node:fs';
import path from 'node:path';
import { root, config, readJson } from './lib/paths.mjs';

const a = process.argv.slice(2);
const opt = (k) => { const i = a.indexOf(`--${k}`); return i > 0 ? a[i + 1] : undefined; };
const id = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1]?.startsWith('--') !== true) || a[0];
const sid = opt('series'); const n = Number(opt('ep')); const title = opt('title'); const en = opt('en') || '';
if (!id || !sid || !n || !title) { console.error('usage: node scripts/new-episode.mjs <ID> --series <sid> --ep <N> --title "<한글 제목>" [--en "<English>"]'); process.exit(1); }
if (config.episodes[id]) { console.error(`${id} already registered: ${config.episodes[id]}`); process.exit(1); }
const sFolder = config.series?.[sid]; if (!sFolder) { console.error('unknown series ' + sid); process.exit(1); }

const rel = `${sFolder}/EP${String(n).padStart(3, '0')}_${id}_${title}`;
const dir = path.join(config.workspace, rel);
for (const d of ['_app', '1_발행본/자막', '1_발행본/번역', '2_소스/keyframes/end', '2_소스/keyframes/gen', '2_소스/clips/_raw', '2_소스/narration', '2_소스/bgm', '2_소스/thumb', '3_폐기_이전본', '4_프로젝트백업']) fs.mkdirSync(path.join(dir, d), { recursive: true });

// template: latest episode in the same series
const prev = Object.entries(config.episodes).filter(([, f]) => f.startsWith(sFolder + '/')).map(([eid]) => eid).pop();
const tpl = prev ? readJson(path.join(config.workspace, config.episodes[prev], 'episode.json')) : {};
const episode = {
  id, title: en || title, subtitle: '', source: '',
  format: tpl.format || { width: 1920, height: 1080, fps: 30 },
  voice: tpl.voice || { engine: 'macos-say', voice: 'Ava (Premium)', rate: 145 },
  timing: tpl.timing || {},
  scenes: [],
  bgm: tpl.bgm ? { ...tpl.bgm, cues: [] } : undefined,
  burnSubtitles: tpl.burnSubtitles ?? false,
};
fs.writeFileSync(path.join(dir, 'episode.json'), JSON.stringify(episode, null, 2) + '\n');
const production = { id, version: 1, title: en || title, series: sFolder, ep: n, stage: 'planning', approvals: {}, rules: [], assets: [], shots: [], credits: { ledger: [] },
  log: [{ at: new Date().toISOString(), by: 'new-episode', text: `created from template ${prev || '(none)'}` }] };
fs.writeFileSync(path.join(dir, '_app', 'production.json'), JSON.stringify(production, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'README.txt'), `EP${String(n).padStart(3, '0')}  ${id}  ${title}\n상태: 기획\n`);

// register
const cfgFile = path.join(root, 'studio.config.json');
const cfg = readJson(cfgFile); cfg.episodes[id] = rel; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
const regFile = path.join(root, 'src', 'episodes', 'registry.ts');
const v = id.replace(/[^A-Za-z0-9]/g, '_');
let reg = fs.readFileSync(regFile, 'utf8');
if (!reg.includes(`./${id}.manifest.json`)) {
  reg = reg.replace(/(import type \{ Manifest \}[^\n]*\n)/, `$1import ${v} from "./${id}.manifest.json";\n`);
  reg = reg.replace(/export const EPISODES: Manifest\[\] = \[([^\]]*)\]/, (m, list) => `export const EPISODES: Manifest[] = [${list.trim() ? list.trim() + ", " : ""}${v} as unknown as Manifest]`);
  reg = reg.replace(/(import type \{ ThumbSpec \}[^\n]*\n)/, `$1import ${v}_THUMB from "./${id}.thumbnail.json";\n`);
  reg = reg.replace(/export const THUMBS: ThumbSpec\[\] = \[([^\]]*)\]/, (m, list) => `export const THUMBS: ThumbSpec[] = [${list.trim() ? list.trim() + ", " : ""}{ id: "${id}", ...(${v}_THUMB as Omit<ThumbSpec, "id">) }]`);
  fs.writeFileSync(regFile, reg);
}
// series thumbnail spec: copy the previous episode's thumbnail.json with the new EP number
const prevThumb = prev ? path.join(config.workspace, config.episodes[prev], 'thumbnail.json') : null;
const thumb = prevThumb && fs.existsSync(prevThumb) ? { ...readJson(prevThumb), ep: String(n).padStart(2, '0'), source: '', lines: [{ text: 'TITLE', size: 128, color: 'white' }], highlight: null } : { series: '', ep: String(n).padStart(2, '0'), source: '', image: 'thumb/thumb_base.png', lines: [], highlight: null };
fs.writeFileSync(path.join(dir, 'thumbnail.json'), JSON.stringify(thumb, null, 2) + '\n');
const tf = path.join(root, 'src', 'episodes', `${id}.thumbnail.json`); if (!fs.existsSync(tf)) fs.writeFileSync(tf, JSON.stringify(thumb, null, 2) + '\n');
// placeholder manifest so the bundle compiles before the first build-manifest run
const mf = path.join(root, 'src', 'episodes', `${id}.manifest.json`);
if (!fs.existsSync(mf)) fs.writeFileSync(mf, JSON.stringify({ id, title: episode.title, subtitle: '', width: 1920, height: 1080, fps: 30, crossfadeFrames: 12, titleCardFrames: 120, durationInFrames: 150, scenes: [], bgm: null, burnSubtitles: false, audioEstimated: true }, null, 2) + '\n');
console.log(`created ${rel}\nregistered ${id} (template: ${prev || 'none'})`);
