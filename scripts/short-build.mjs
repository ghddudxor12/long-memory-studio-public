// Promo short (YouTube Shorts / Reels) from an episode's existing media. No Flow, no new pictures.
// usage:
//   node scripts/short-build.mjs --candidates <EPISODE_ID>   print candidates only (no files)
//   node scripts/short-build.mjs --init <EPISODE_ID>   create the next <EP>-S<n>/short.json skeleton and print candidates
//   node scripts/short-build.mjs <SHORT_ID> --dry      resolve timeline + QC only (fast, no render)
//   node scripts/short-build.mjs <SHORT_ID>            TTS new lines, render, loudnorm, QC, review frames
// short.json (written by the agent; everything is semantic, the script computes all times):
//   { "hook": ["*Light* shines on Day One.", "The sun? Not until *Day Four*."],   fixed headline, *word* = gold
//     "emphasis": ["light", "fourth"],                                              gold words in captions
//     "beats": [ { "say": "S01_L1", "shots": ["S01-02", {"shot": "S06-05", "from": "But"}] },
//                { "say": "new:Genesis one, read in order.", "shots": ["S01-02@2"], "endCard": true } ],
//     "endCard": { "lines": ["THE BIBLE IN ORDER", "The Long Memory"] },
//     "bgm": { "src": "bgm/<file>.wav", "trim": 0 },                                optional (default: first episode cue)
//     "upload": { "title": "...", "description": "...", "relatedVideo": "<longform videoId>" } }   used at upload
//   say: narration line id of the episode (reuses its WAV) or "new:<text>" (recorded with the episode voice).
//   shots: "KEY", "KEY@trim", "KEY#c" or {shot, from (first caption word where the shot starts), trim, c, zoom:[a,b]}.
//   c defaults to _app/subjects.json (node scripts/subject-map.mjs <EP>), then 0.5.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { root, episodePaths, readJson } from './lib/paths.mjs';
import { ff, probeDur, shortPaths, loadManifest, shotIndex, lineIndex, chunkTimes, chunks, weakEnding, emphasize, BRAND_ICON, CHANNEL_NAME } from './lib/shorts.mjs';

const args = process.argv.slice(2);
const LEAD = 0.4, TAIL = 1.6, OVERLAP = 0.2, MAX_SEC = 60;

if (args[0] === '--init' || args[0] === '--candidates') {
  const create = args[0] === '--init';
  const ep = args[1]; const P = episodePaths(ep); const base = path.join(P.app, 'shorts'); if (create) fs.mkdirSync(base, { recursive: true });
  const n = 1 + Math.max(0, ...(fs.existsSync(base) ? fs.readdirSync(base) : []).map((d) => Number((d.match(/-S(\d+)$/) || [])[1] || 0)));
  const id = `${ep}-S${n}`; const dir = path.join(base, id); if (create) fs.mkdirSync(dir, { recursive: true });
  const episode = readJson(P.episodeJson); const lines = lineIndex(episode); const idx = shotIndex(loadManifest(ep));
  const subjects = fs.existsSync(path.join(P.app, 'subjects.json')) ? readJson(path.join(P.app, 'subjects.json')) : {};
  const spec = { hook: ['', ''], emphasis: [], beats: [], endCard: { lines: ['THE BIBLE IN ORDER', CHANNEL_NAME] }, upload: { title: '', description: '', relatedVideo: '' } };
  if (create) fs.writeFileSync(path.join(dir, 'short.json'), JSON.stringify(spec, null, 1));
  // candidates: hook-like lines (cold open, scripture quotes, turns) with their duration and the shots of their scene
  const cand = Object.values(lines).map((l) => {
    const f = path.join(P.src, l.src); const d = fs.existsSync(f) ? probeDur(f) : null;
    const tags = [l.scene === 1 && 'cold-open', /^["“]/.test(l.text) && 'quote', /\b(notice|never|not|only|but|why|first|no one)\b/i.test(l.text) && 'turn'].filter(Boolean);
    return { id: l.id, sec: d && +d.toFixed(2), tags, scene: `${l.scene} ${l.sceneTitle}`, text: l.text };
  });
  const shotsByScene = {}; for (const s of Object.values(idx)) { const sc = s.key.split('-')[0]; (shotsByScene[sc] ||= []).push(`${s.key}(${s.type[0]}${subjects[s.key]?.c != null ? ' c=' + subjects[s.key].c : ''})`); }
  console.log(JSON.stringify({ short: create ? id : null, nextId: id, spec: create ? path.join(dir, 'short.json') : null, unsetSubjects: Object.keys(idx).filter((k) => subjects[k]?.c == null).length, candidates: cand, shotsByScene }, null, 1));
  process.exit(0);
}

const id = args.find((a) => !a.startsWith('-')); if (!id) { console.error('usage: node scripts/short-build.mjs <SHORT_ID> [--dry] | --init <EPISODE_ID>'); process.exit(1); }
const dry = args.includes('--dry');
const S = shortPaths(id); const { ep, P } = S;
const spec = readJson(S.spec); const episode = readJson(P.episodeJson); const manifest = loadManifest(ep);
const lines = lineIndex(episode); const idx = shotIndex(manifest);
const subjects = fs.existsSync(path.join(P.app, 'subjects.json')) ? readJson(path.join(P.app, 'subjects.json')) : {};
const gap = episode.timing?.lineGapSec ?? 0.8;
const problems = [], warnings = [];

// 1. audio for every beat (episode WAV or new TTS line)
fs.mkdirSync(S.audio, { recursive: true });
const beats = spec.beats.map((b, i) => {
  if (b.say.startsWith('new:')) {
    const text = b.say.slice(4).trim(); const rel = `shortaudio/${id}_${i + 1}.wav`; const file = path.join(S.audio, `${id}_${i + 1}.wav`);
    const stamp = file + '.txt'; const v = episode.voice;
    if (!fs.existsSync(file) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== `${v.voice}|${v.rate}|${text}`) {
      if (!dry) { execFileSync('say', ['-v', v.voice, '-r', String(v.rate), '-o', file, '--file-format=WAVE', '--data-format=LEI16@44100', text]); fs.writeFileSync(stamp, `${v.voice}|${v.rate}|${text}`); }
    }
    const dur = fs.existsSync(file) ? probeDur(file) : text.split(' ').length / 2.6;
    return { ...b, text, src: rel, file, dur };
  }
  const l = lines[b.say]; if (!l) throw new Error(`beat ${i + 1}: unknown narration line ${b.say}`);
  const file = path.join(P.src, l.src); return { ...b, text: l.text, src: l.src, file, dur: probeDur(file) };
});

// 2. timeline: lines back to back with the episode gap; each beat's shots split its window (anchored at caption words)
let t = LEAD; for (const b of beats) { b.at = +t.toFixed(3); t += b.dur + gap; }
const end = beats.at(-1).at + beats.at(-1).dur; const total = +(end + TAIL).toFixed(2);
const shots = [];
beats.forEach((b, i) => {
  const ws = i === 0 ? 0 : beats[i - 1].at + beats[i - 1].dur + gap / 2;
  const we = i === beats.length - 1 ? total : b.at + b.dur + gap / 2;
  const list = b.shots.map((s) => typeof s === 'string' ? (() => { const m = s.match(/^([^@#]+)(?:@([\d.]+))?(?:#([\d.]+))?$/); return { shot: m[1], trim: m[2] && +m[2], c: m[3] && +m[3] }; })() : { ...s });
  const ct = chunkTimes(b.text, b.dur); let after = 0; // anchors are searched in order: each one after the previous match
  const bounds = list.map((s, k) => {
    if (k === 0) return ws;
    if (!s.from) return null;
    const n = ct.findIndex((c, ci) => ci >= after && c.text.replace(/[^\w ]/g, '').toLowerCase().split(' ').includes(s.from.toLowerCase()));
    if (n < 0) { problems.push(`beat ${i + 1}: anchor word "${s.from}" not found in captions after the previous anchor`); return null; }
    after = n + 1; return Math.max(ws + 0.8, b.at + ct[n].t - 0.1);
  });
  bounds.push(we);
  for (let k = 1; k < bounds.length - 1; k++) if (bounds[k] == null) { let j = k + 1; while (bounds[j] == null) j++; const a = bounds[k - 1]; bounds[k] = a + (bounds[j] - a) / (j - k + 1); }
  list.forEach((s, k) => {
    const sh = idx[s.shot]; if (!sh) { problems.push(`beat ${i + 1}: unknown shot ${s.shot}`); return; }
    const at = bounds[k]; const isLast = i === beats.length - 1 && k === list.length - 1; const dur = bounds[k + 1] - at + (isLast ? 0 : OVERLAP);
    if (dur <= 0.5) problems.push(`${s.shot} at ${at.toFixed(1)}s has no room (${dur.toFixed(1)}s): check anchors`);
    else if (dur < 1.2) warnings.push(`${s.shot} at ${at.toFixed(1)}s is only ${dur.toFixed(1)}s`);
    const c = s.c ?? subjects[s.shot]?.c ?? 0.5; if (subjects[s.shot]?.c == null && s.c == null) warnings.push(`${s.shot}: no subject position (c=0.5 used); run subject-map.mjs`);
    let trim = s.trim ?? 0;
    if (sh.type === 'video') { const len = probeDur(path.join(P.src, sh.src)); if (trim + dur > len - 0.05) { const t2 = Math.max(0, len - dur - 0.05); if (t2 < trim) warnings.push(`${s.shot}: trim ${trim}s lowered to ${t2.toFixed(2)}s to fit ${dur.toFixed(1)}s`); trim = t2; if (dur > len) problems.push(`${s.shot}: needs ${dur.toFixed(1)}s but the clip is ${len.toFixed(1)}s; add another shot to beat ${i + 1}`); } }
    shots.push({ src: sh.src, key: s.shot, at: +at.toFixed(3), dur: +dur.toFixed(3), ...(sh.type === 'video' ? { trim: +trim.toFixed(3) } : {}), c, ...(s.zoom ? { zoom: s.zoom } : {}) });
  });
});
const endBeat = beats.findIndex((b) => b.endCard); const endAt = endBeat >= 0 ? beats[endBeat].at - 0.15 : total - 2.5;
const cue0 = manifest.bgm?.cues?.[0];
const bgm = spec.bgm ? { src: spec.bgm.src, trim: spec.bgm.trim || 0 } : cue0 ? { src: cue0.src, trim: (cue0.trimBefore || 0) / (manifest.fps || 30) } : null;
const props = { spec: { durationSec: total, channel: { name: CHANNEL_NAME, icon: 'brand/icon.png' }, hook: spec.hook, band: spec.band || { top: 450, height: 810 }, channelTop: 110, captionHeight: 220,
  shots: shots.map(({ key, ...s }) => s), lines: beats.map((b) => ({ src: b.src, at: b.at, dur: +b.dur.toFixed(3), text: emphasize(b.text, spec.emphasis) })),
  ...(bgm ? { bgm: { src: bgm.src, trim: bgm.trim, volume: 0.22, duckVolume: 0.09 } } : {}), endCard: { at: +endAt.toFixed(2), lines: spec.endCard?.lines || ['THE BIBLE IN ORDER', CHANNEL_NAME] } } };

// 3. QC that does not need the render
if (total > MAX_SEC) problems.push(`duration ${total}s is over ${MAX_SEC}s: drop a beat`);
else if (total > 58) warnings.push(`duration ${total}s is close to 60s`);
for (const h of spec.hook) if (h.replace(/\*/g, '').length > 34) warnings.push(`hook line over 34 characters wraps: "${h}"`);
if (!spec.hook.filter(Boolean).length) problems.push('hook is empty');
const capIssues = beats.flatMap((b) => chunks(b.text).filter((c) => weakEnding(c) || c.split(' ').length > 5).map((c) => `"${c}"`));
if (capIssues.length) warnings.push('caption chunks to check: ' + capIssues.join(' '));
const timeline = shots.map((s) => `${s.at.toFixed(1).padStart(5)}s ${s.dur.toFixed(1)}s ${s.key}${s.trim ? '@' + s.trim : ''} c=${s.c}`);
const report = { short: id, durationSec: total, beats: beats.map((b) => ({ say: b.say.slice(0, 40), at: b.at, sec: +b.dur.toFixed(2) })), timeline, problems, warnings };
if (dry || problems.length) { console.log(JSON.stringify(report, null, 1)); if (problems.length) process.exit(1); process.exit(0); }

// 4. stage only the files this short uses, render, loudnorm
fs.rmSync(S.stage, { recursive: true, force: true }); const pub = path.join(S.stage, 'public');
const need = new Set([...props.spec.shots.map((s) => s.src), ...beats.filter((b) => !b.say.startsWith('new:')).map((b) => b.src), ...(bgm ? [bgm.src] : [])]);
for (const rel of need) { const d = path.join(pub, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(P.src, rel), d); }
for (const b of beats.filter((x) => x.say.startsWith('new:'))) { const d = path.join(pub, b.src); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(b.file, d); }
fs.mkdirSync(path.join(pub, 'brand'), { recursive: true }); fs.copyFileSync(BRAND_ICON, path.join(pub, 'brand', 'icon.png'));
const propsFile = path.join(S.stage, 'props.json'); fs.writeFileSync(propsFile, JSON.stringify(props, null, 1));
const raw = path.join(S.stage, `${id}_raw.mp4`);
const t0 = Date.now();
execFileSync(path.join(root, 'node_modules', '.bin', 'remotion'), ['render', 'src/index.ts', 'PromoShort', raw, `--props=${propsFile}`, `--public-dir=${pub}`, '--log=error'], { cwd: root, stdio: 'inherit' });
fs.mkdirSync(S.publish, { recursive: true }); const outFile = path.join(S.publish, `${id}.mp4`);
const p1 = ff(['-i', raw, '-vn', '-af', 'loudnorm=I=-14.5:TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-']);
const j = JSON.parse(p1.stderr.toString().match(/\{[\s\S]*?\}/g).at(-1));
const af = `loudnorm=I=-14.5:TP=-1.0:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:print_format=json`;
const p2 = ff(['-y', '-i', raw, '-map', '0', '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outFile]);
if (p2.status !== 0) { console.error(p2.stderr.toString().slice(-600)); process.exit(1); }
const k = JSON.parse(p2.stderr.toString().match(/\{[\s\S]*?\}/g).at(-1));

// 5. review frames (middle of every shot) + sheet for the agent
fs.rmSync(S.frames, { recursive: true, force: true }); fs.mkdirSync(S.frames, { recursive: true });
const frames = shots.map((s, n) => { const tt = Math.min(total - 0.2, s.at + s.dur / 2); const f = path.join(S.frames, `${String(n + 1).padStart(2, '0')}_${s.key}_${tt.toFixed(1)}s.jpg`); ff(['-y', '-loglevel', 'error', '-ss', String(tt), '-i', outFile, '-vf', 'scale=300:-2', '-frames:v', '1', f]); return f; });
const sheet = path.join(S.dir, 'sheet.html');
fs.writeFileSync(sheet, `<html><body style="margin:0;background:#444;display:flex;flex-wrap:wrap;gap:4px;width:${Math.min(frames.length, 8) * 304}px">${frames.map((f) => `<div style="position:relative"><img src="http://127.0.0.1:5199/f${encodeURI(f)}" style="width:300px;height:533px;display:block"><span style="position:absolute;left:3px;bottom:3px;background:#c00;color:#fff;font:13px sans-serif;padding:1px 3px">${path.basename(f, '.jpg')}</span></div>`).join('')}</body></html>`);
const build = { ...report, file: outFile, loudness: { I: k.output_i, TP: k.output_tp }, renderSec: Math.round((Date.now() - t0) / 1000), sheet: 'http://127.0.0.1:5199/f' + encodeURI(sheet), sheetSize: { width: Math.min(frames.length, 8) * 304, height: Math.ceil(frames.length / 8) * 537 }, at: new Date().toISOString() };
fs.writeFileSync(S.build, JSON.stringify(build, null, 1));
console.log(JSON.stringify(build, null, 1));
