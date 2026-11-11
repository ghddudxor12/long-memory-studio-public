// Usage: node scripts/export-srt.mjs BIB-GEN-001
// Writes <ID>.en.srt from the manifest subtitle timings (for YouTube caption upload).
// Default output: out/<ID>/ ; pass --out <dir> to write elsewhere (e.g. 1_발행본).
import fs from 'node:fs';
import path from 'node:path';
const id = process.argv.slice(2).find((a, i, arr) => !a.startsWith('-') && arr[i - 1] !== '--out') || process.env.npm_config_ep;
if (!id) { console.error('usage: node scripts/export-srt.mjs <EPISODE_ID>'); process.exit(1); }
const root = path.resolve(import.meta.dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'src', 'episodes', `${id}.manifest.json`), 'utf8'));
const fps = m.fps, T = m.titleCardFrames;
const ts = (fr) => { const ms = Math.round((fr / fps) * 1000); const h = Math.floor(ms / 3600000), mi = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
// wrap long cues into two balanced lines (YouTube readability; qc limit 56 chars per line)
const wrap = (t) => { if (t.includes('\n') || t.length <= 42) return t; const w = t.split(' '); let best = null; for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(' '), b = w.slice(i).join(' '); const sc = Math.max(a.length, b.length) + (i <= 2 || w.length - i <= 2 ? 30 : 0); if (!best || sc < best.sc) best = { sc, s: a + '\n' + b }; } return best ? best.s : t; };
const cues = [];
for (const sc of m.scenes) for (const ln of sc.lines) for (const sub of ln.subtitles) {
  const a = T + sc.from + sub.from, b = a + sub.duration - 1; // 1-frame gap between cues
  cues.push(`${cues.length + 1}\n${ts(a)} --> ${ts(b)}\n${wrap(sub.text)}\n`);
}
const oi = process.argv.indexOf('--out');
const outDir = oi > 0 ? process.argv[oi + 1] : path.join(root, 'out', id); fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${id}.en.srt`); fs.writeFileSync(out, cues.join('\n'));
console.log(`srt: ${cues.length} cues -> ${out}`);
