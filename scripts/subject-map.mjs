// Subject map for promo shorts: where the important thing sits horizontally in every shot of an episode.
// usage:
//   node scripts/subject-map.mjs <EPISODE_ID>                 extract frames + grid review sheets, create/merge _app/subjects.json
//   node scripts/subject-map.mjs <EPISODE_ID> --set S01-02=0.6,S06-05=0.5:sun left moon right
//   node scripts/subject-map.mjs <EPISODE_ID> --show           print the current map
// c = horizontal centre of the subject in the 16:9 source (0 = left edge, 1 = right edge). Shorts crop a 4:3 window
// around c (any c between 0.375 and 0.625 is reachable; values outside are clamped by the renderer).
// Review sheets: <episode>/_app/preview/subjects/sheet_N.html (open via the static server on :5199 and screenshot).
import fs from 'node:fs';
import path from 'node:path';
import { episodePaths } from './lib/paths.mjs';
import { ff, probeDur, loadManifest, shotIndex } from './lib/shorts.mjs';

const args = process.argv.slice(2); const ep = args.find((a) => !a.startsWith('-') && !a.includes('='));
if (!ep) { console.error('usage: node scripts/subject-map.mjs <EPISODE_ID> [--set KEY=c[:note],...] [--show]'); process.exit(1); }
const P = episodePaths(ep); const mapFile = path.join(P.app, 'subjects.json');
const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
const save = () => fs.writeFileSync(mapFile, JSON.stringify(map, null, 1));

if (args.includes('--set')) {
  const v = args[args.indexOf('--set') + 1];
  for (const part of v.split(',')) { const [k, rest] = part.split('='); const [c, ...note] = rest.split(':'); map[k.trim()] = { ...(map[k.trim()] || {}), c: Number(c), note: note.join(':') || map[k.trim()]?.note || '' }; }
  save(); console.log(JSON.stringify(map, null, 1)); process.exit(0);
}
if (args.includes('--show')) { console.log(JSON.stringify(map, null, 1)); process.exit(0); }

const idx = shotIndex(loadManifest(ep)); const dir = path.join(P.app, 'preview', 'subjects'); fs.mkdirSync(dir, { recursive: true });
const rows = [];
for (const s of Object.values(idx)) {
  const file = path.join(P.src, s.src); if (!fs.existsSync(file)) { console.log('missing', s.key, s.src); continue; }
  const times = s.type === 'video' ? (() => { const d = probeDur(file); return [0.5, d / 2, Math.max(0.6, d - 0.4)]; })() : [0];
  const outs = [];
  for (const t of times) {
    const out = path.join(dir, `${s.key}_${t.toFixed(1)}.jpg`);
    if (!fs.existsSync(out)) ff(['-y', '-loglevel', 'error', ...(s.type === 'video' ? ['-ss', String(t)] : []), '-i', file, '-vf', 'scale=480:-2', '-frames:v', '1', out]);
    outs.push([t, out]);
  }
  rows.push({ s, outs }); if (!map[s.key]) map[s.key] = { c: null, note: '' };
}
save();
const grid = Array.from({ length: 9 }, (_, i) => `<div style="position:absolute;top:0;bottom:0;left:${(i + 1) * 10}%;border-left:1px solid ${i === 4 ? '#ff0' : '#0ff8'}"></div><span style="position:absolute;bottom:2px;left:calc(${(i + 1) * 10}% + 2px);color:#ff0;font:bold 13px sans-serif;text-shadow:0 0 3px #000">${(i + 1) / 10}</span>`).join('');
const pages = []; const per = 8;
for (let p = 0; p * per < rows.length; p++) {
  const html = rows.slice(p * per, (p + 1) * per).map(({ s, outs }) => `<div style="display:flex;gap:6px;margin-bottom:6px;align-items:flex-start"><div style="width:110px;color:#fff;font:bold 15px sans-serif">${s.key}<br><span style="font-weight:normal;font-size:12px;color:#ccc">${s.type}<br>${(s.title || '').slice(0, 40)}<br>c=${map[s.key]?.c ?? '?'}</span></div>` +
    outs.map(([t, f]) => `<div style="position:relative;width:480px;height:270px"><img src="http://127.0.0.1:5199/f${encodeURI(f)}" style="width:480px;height:270px;object-fit:cover">${grid}<span style="position:absolute;top:2px;left:4px;color:#fff;background:#000a;font:13px sans-serif">${s.type === 'video' ? t.toFixed(1) + 's' : 'still'}</span></div>`).join('') + '</div>').join('');
  const f = path.join(dir, `sheet_${p + 1}.html`); fs.writeFileSync(f, `<html><body style="margin:0;background:#222;padding:6px;width:1580px">${html}</body></html>`); pages.push(f);
}
console.log(JSON.stringify({ episode: ep, shots: rows.length, unset: Object.entries(map).filter(([, v]) => v.c == null).map(([k]) => k), sheets: pages.map((f) => 'http://127.0.0.1:5199/f' + encodeURI(f)), map: mapFile }, null, 1));
