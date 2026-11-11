// Usage: node scripts/build-manifest.mjs BIB-GEN-001
// Reads <episode>/episode.json + narration WAV durations, writes src/episodes/<ID>.manifest.json
// All media paths in the manifest are relative to <episode>/2_소스 (rendered with --public-dir).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { episodePaths, readJson } from './lib/paths.mjs';

// episode id: first non-flag argument, or npm --ep=<ID> (npm_config_ep)
const id = process.argv.slice(2).find((a) => !a.startsWith('-')) || process.env.npm_config_ep;
if (!id) { console.error('usage: node scripts/build-manifest.mjs <EPISODE_ID> [--force]'); process.exit(1); }
if (!id) { console.error('episode id required'); process.exit(1); }
const root = path.resolve(import.meta.dirname, '..');
const P = episodePaths(id);
const ep = readJson(P.episodeJson);
const fps = ep.format.fps;
const T = ep.timing;
const f = (sec) => Math.round(sec * fps);

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length - 8) {
    const idc = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (idc === 'data') return size / byteRate;
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk: ' + file);
}
// ---- subtitle splitting -------------------------------------------------
// Where a break may go between words[i-1] and words[i]. Lower score = better.
const STARTERS = /^(but|because|which|who|what|where|when|while|then|from|upon|in|into|on|to|with|after|before|between|across|among|over|under|not|that|as|for|than)$/i;
const ENDERS_BAD = /^(the|a|an|of|to|and|or|but|in|on|for|from|with|his|her|its|their|our|my|we|he|she|it|they|i|you|is|was|were|are|be|been|makes|made|create|created|thirty|forty|very|no|not|will|would|shall|can|does|do|did|has|have|had|this|these|those|two|three|six|seven|first|second|third|fourth|fifth|sixth|seventh|greater|lesser|great)$/i;
function breakPenalty(words, i) {
  const prev = words[i - 1], next = words[i];
  let p = 0;
  if (/[.!?]["\u201d]?$/.test(prev)) p -= 30;          // sentence end
  else if (/[,;:]["\u201d]?$/.test(prev)) p -= 22;     // clause pause
  else if (STARTERS.test(next.replace(/^["\u201c]/, ''))) p -= 10; // break before a conjunction/preposition
  if (ENDERS_BAD.test(prev.replace(/["\u201d,;:]/g, ''))) p += 25;  // never end a line on a function word
  if (/-$/.test(prev)) p += 25;
  return p;
}
function bestBreak(words, { minA, minB, target, weight }) {
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (a.length < minA || b.length < minB) continue;
    if (i < 3 || words.length - i < 3) continue;        // no 1-2 word line
    const score = weight * Math.abs(a.length - target(a, b)) + breakPenalty(words, i);
    if (!best || score < best.score) best = { score, i };
  }
  return best ? best.i : -1;
}
// Two-line layout for one subtitle chunk.
function breakLines(text) {
  const ONE_LINE = 46, MAX_LINE = 56;
  if (text.length <= ONE_LINE) return text;
  const words = text.split(' ');
  const i = bestBreak(words, { minA: 12, minB: 12, target: (a, b) => (a.length + b.length) / 2, weight: 0.6 });
  if (i < 0) return text;
  const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
  if (Math.max(a.length, b.length) > MAX_LINE) return text; // let CSS wrap as fallback
  return a + '\n' + b;
}
// Chunks shown one at a time: sentences, long sentences split at natural points, tiny pieces merged.
function splitChunks(text) {
  const MAX = 80, MIN = 30;
  const sents = (text.match(/[^.!?]+[.!?]+["\u201d]?|[^.!?]+$/g) || [text]).map((x) => x.trim()).filter(Boolean);
  const pieces = [];
  for (const sent of sents) {
    let rest = sent;
    while (rest.length > MAX) {
      const words = rest.split(' ');
      const i = bestBreak(words, { minA: MIN, minB: MIN, target: (a, b) => (a.length + b.length) / 2, weight: 0.35 });
      if (i < 0) break;
      pieces.push(words.slice(0, i).join(' ')); rest = words.slice(i).join(' ');
    }
    pieces.push(rest);
  }
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && (p.length < MIN || last.length < MIN) && (last + ' ' + p).length <= MAX) out[out.length - 1] = last + ' ' + p;
    else out.push(p);
  }
  return out;
}

let cursor = 0;
const scenes = [];
for (const sc of ep.scenes) {
  const start = cursor;
  let t = f(0.6); // lead-in inside scene
  const lines = [];
  for (const ln of sc.narration) {
    const wav = path.join(P.src, 'narration', `${ln.id}.wav`);
    let sec = 0; let estimated = false;
    try { sec = fs.existsSync(wav) ? wavSeconds(wav) : 0; } catch { sec = 0; }
    if (sec < 0.3) { sec = ln.text.split(/\s+/).length / (ep.voice.rate / 60) + 0.4; estimated = true; }
    const dur = f(sec);
    const chunks = splitChunks(ln.text).map(breakLines);
    const total = chunks.reduce((a, c) => a + c.length, 0);
    let ct = t; const subs = chunks.map((c) => { const d = Math.max(f(0.8), Math.round(dur * c.length / total)); const s = { text: c, from: ct, duration: d }; ct += d; return s; });
    lines.push({ id: ln.id, estimated, src: `narration/${ln.id}.wav`, from: t, duration: dur, subtitles: subs });
    t += dur + f(T.lineGapSec);
  }
  const sceneDur = t + f(T.sceneTailSec);
  // shots: videos get their usable length, images share the rest
  const vids = sc.shots.filter((s) => s.type === 'video');
  const vidLen = (s) => f(s.segments.reduce((a, [a1, b1]) => a + (b1 - a1), 0));
  const vidTotal = vids.reduce((a, s) => a + vidLen(s), 0);
  const imgs = sc.shots.filter((s) => s.type === 'image');
  let imgEach = imgs.length ? Math.max(f(T.minImageShotSec), Math.round((sceneDur - vidTotal) / imgs.length)) : 0;
  let shotCursor = 0;
  const shots = sc.shots.map((s) => {
    const d = s.type === 'video' ? vidLen(s) : imgEach;
    const o = { ...s, from: shotCursor, duration: d, src: s.src };
    shotCursor += d; return o;
  });
  const dur = Math.max(sceneDur, shotCursor);
  // stretch last shot if visuals shorter than narration
  if (shotCursor < dur) shots[shots.length - 1].duration += dur - shotCursor;
  scenes.push({ scene: sc.scene, title: sc.title, captions: sc.captions, from: start, duration: dur, lines, shots });
  cursor += dur;
}
// ---- BGM: cues anchored to scenes so they follow narration timing changes
const sceneStart = (n) => { const sc = scenes.find((x) => x.scene === n); if (!sc) throw new Error('bgm: no scene ' + n); return f(4) + sc.from; };
const totalFrames = cursor + f(4);
let bgm = null;
if (ep.bgm && ep.bgm.cues?.length) {
  const B = ep.bgm;
  const cues = B.cues.map((c) => {
    const from = Math.max(0, (c.startScene ? sceneStart(c.startScene) : 0) + f(c.startOffsetSec || 0));
    const end = c.endScene ? sceneStart(c.endScene) + f(c.endOffsetSec || 0) : totalFrames;
    const file = path.join(P.src, c.src);
    let fileSec = null;
    try { const out = execFileSync('afinfo', [file]).toString(); const m = out.match(/estimated duration: ([\d.]+)/); if (m) fileSec = +m[1]; } catch {}
    const need = (end - from) / fps + (c.trimStartSec || 0);
    if (!fs.existsSync(file)) console.warn('bgm: missing file ' + file);
    else if (fileSec && fileSec + 0.05 < need) console.warn(`bgm: ${c.src} is ${fileSec.toFixed(1)}s but cue needs ${need.toFixed(1)}s (will go silent at the end)`);
    return { src: c.src, from, duration: end - from, trimBefore: f(c.trimStartSec || 0), fadeIn: f(c.fadeInSec ?? 2), fadeOut: f(c.fadeOutSec ?? 3), gain: c.gain ?? 1 };
  });
  const speech = scenes.flatMap((sc) => sc.lines.filter((l) => !l.estimated).map((l) => [f(4) + sc.from + l.from, f(4) + sc.from + l.from + l.duration]));
  bgm = { volume: B.volume ?? 0.3, duckVolume: B.duckVolume ?? 0.12, attack: f(B.duckAttackSec ?? 0.35), release: f(B.duckReleaseSec ?? 0.8), cues, speech };
}
const anyEstimated = scenes.some((s) => s.lines.some((l) => l.estimated));
const manifest = { id, audioEstimated: anyEstimated, title: ep.title, subtitle: ep.subtitle, ...ep.format, crossfadeFrames: T.crossfadeFrames, titleCardFrames: f(4), durationInFrames: cursor + f(4), scenes, bgm, burnSubtitles: ep.burnSubtitles !== false };
const outFile = path.join(root, 'src', 'episodes', `${id}.manifest.json`);
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
console.log(`manifest: ${scenes.length} scenes, ${(manifest.durationInFrames / fps).toFixed(1)}s -> ${outFile}`);

// copy series thumbnail spec
const thumbSrc = P.thumbnailJson;
if (fs.existsSync(thumbSrc)) { fs.copyFileSync(thumbSrc, path.join(root, "src", "episodes", id + ".thumbnail.json")); console.log("thumbnail spec copied"); }
