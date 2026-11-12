// Shared helpers for promo shorts (YouTube Shorts / Reels) built from an episode's existing media.
// A short lives in <episode>/_app/shorts/<SHORT_ID>/ (short.json = what the agent writes, build.json = last build).
// SHORT_ID = <EPISODE_ID>-S<n>, e.g. BIB-GEN-001-S1.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, config, episodePaths } from './paths.mjs';

export const FFDIR = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: FFDIR };
export const ff = (args) => spawnSync(path.join(FFDIR, 'ffmpeg'), ['-hide_banner', ...args], { env, maxBuffer: 1 << 26 });
export const probeDur = (file) => {
  const r = spawnSync(path.join(FFDIR, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { env });
  const d = Number(r.stdout.toString().trim()); if (!d) throw new Error('cannot read duration of ' + file); return d;
};

export const BRAND_ICON = path.join(config.workspace, '00_채널공통', '브랜딩', 'channel_icon_800.png');
export const CHANNEL_NAME = 'The Long Memory';

export function shortPaths(shortId) {
  const m = shortId.match(/^(.+)-S(\d+)$/); if (!m) throw new Error(`short id must look like <EPISODE_ID>-S<n>: ${shortId}`);
  const ep = m[1]; const P = episodePaths(ep); const dir = path.join(P.app, 'shorts', shortId);
  return { ep, P, dir, spec: path.join(dir, 'short.json'), build: path.join(dir, 'build.json'), audio: path.join(dir, 'audio'), frames: path.join(dir, 'frames'),
    stage: path.join(root, 'out', 'shorts', shortId), publish: path.join(P.publish, 'shorts') };
}

export function loadManifest(ep) {
  const f = path.join(root, 'src', 'episodes', `${ep}.manifest.json`);
  if (!fs.existsSync(f)) spawnSync('node', [path.join(root, 'scripts', 'build-manifest.mjs'), ep], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
// shot key -> { key, type, src (relative to 2_소스) }
export function shotIndex(manifest) {
  const idx = {}; for (const sc of manifest.scenes) for (const s of sc.shots) idx[s.key] = { key: s.key, type: s.type, src: s.src, title: s.title };
  return idx;
}
// narration line id -> { id, text, scene, src }
export function lineIndex(episode) {
  const idx = {}; for (const sc of episode.scenes) for (const l of sc.narration || []) idx[l.id] = { id: l.id, text: l.text, scene: sc.scene, sceneTitle: sc.title, src: `narration/${l.id}.wav` };
  return idx;
}

// Caption chunking: keep identical to chunks() in src/compositions/PromoShort.tsx
export const WEAK = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'but', 'or', 'that', 'is', 'was', 'we', 'it', 'its', 'for', 'with', 'as', 'by', 'what', 'not', 'one', 'two', 'would', 'could', 'should', 'were', 'are', 'be', 'because', 'their', 'his', 'her']);
export function chunks(text, max = 4) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const clauses = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[.,;:!?]["\u201d*]*$/.test(w)) { clauses.push(cur); cur = []; } }
  if (cur.length) clauses.push(cur);
  const weak = (w) => WEAK.has(w.toLowerCase().replace(/[^a-z]/g, ''));
  const out = [];
  for (const c of clauses) {
    if (c.length <= max + 1) { out.push(c.join(' ')); continue; }
    let start = 0;
    while (c.length - start > max) {
      const left = c.length - start, n = Math.ceil(left / max), ideal = start + Math.round(left / n);
      let best = -1;
      for (let cut = start + 2; cut <= Math.min(start + max, c.length - 2); cut++) if (!weak(c[cut - 1]) && (best < 0 || Math.abs(cut - ideal) < Math.abs(best - ideal))) best = cut;
      const cut = best > 0 ? best : ideal; out.push(c.slice(start, cut).join(' ')); start = cut;
    }
    out.push(c.slice(start).join(' '));
  }
  return out;
}
// start time (s, relative to the line) of every caption chunk, same weighting as the component
export function chunkTimes(text, dur) {
  const cs = chunks(text); const w = (c) => c.replace(/\*/g, '').length + 6; const total = cs.reduce((a, c) => a + w(c), 0);
  let acc = 0; return cs.map((c) => { const t = (acc / total) * dur; acc += w(c); return { text: c, t }; });
}
export const weakEnding = (chunk) => WEAK.has(chunk.split(' ').pop().toLowerCase().replace(/[^a-z]/g, ''));

// mark emphasis words (single words, case-insensitive, whole word) with *asterisks*
export function emphasize(text, words = []) {
  let t = text;
  for (const w of words) t = t.replace(new RegExp(`(?<![*\\w])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w*])`, 'gi'), '*$1*');
  return t;
}
