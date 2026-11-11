// Usage: node scripts/qc.mjs <ID> <render.mp4> [--json out.json]
// Technical checks on a rendered episode: frame count vs manifest, black dips at shot boundaries,
// loudness (integrated LUFS / true peak), subtitle line rules on the sibling .en.srt, duration.
// Uses Remotion's bundled ffmpeg (no blackdetect/ebur128 there, so brightness is computed in Node).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { root, episodePaths, readJson } from './lib/paths.mjs';

const args = process.argv.slice(2);
const id = args[0]; const file = args[1];
if (!id || !file) { console.error('usage: node scripts/qc.mjs <ID> <render.mp4> [--json out.json]'); process.exit(1); }
const ji = args.indexOf('--json'); const jsonOut = ji > 0 ? args[ji + 1] : null;
const P = episodePaths(id);
const ffdir = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: ffdir };
const bin = (n) => path.join(ffdir, n);
const t0 = Date.now();
const checks = [];
const add = (id, label, ok, detail, items = []) => checks.push({ id, label, ok, detail, items });

// manifest boundaries
const m = readJson(P.manifest);
const fps = m.fps, T = m.titleCardFrames || 0;
const bounds = [];
for (const sc of m.scenes) for (const s of sc.shots) bounds.push({ key: s.key, frame: T + sc.from + s.from });

// 1) stream info
const probe = JSON.parse(execFileSync(bin('ffprobe'), ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets:format=duration', '-of', 'json', file], { env }).toString());
const v = probe.streams.find((s) => s.codec_type === 'video'); const a = probe.streams.find((s) => s.codec_type === 'audio');
const frames = Number(v?.nb_read_packets); const duration = Number(probe.format.duration);
add('frames', '프레임 수 = manifest', frames === m.durationInFrames, `${frames} / ${m.durationInFrames} (${duration.toFixed(2)}s, ${v?.width}x${v?.height}, 오디오 ${a ? '있음' : '없음'})`);

// 2) brightness per frame (64x36 gray)
const W = 64, H = 36, F = W * H;
const r = spawnSync(bin('ffmpeg'), ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-pix_fmt', 'gray', '-c:v', 'rawvideo', '-f', 'image2pipe', '-'], { env, maxBuffer: 1 << 30 });
const buf = r.stdout; const n = Math.floor(buf.length / F);
const lum = new Float32Array(n);
for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < F; j++) s += buf[i * F + j]; lum[i] = s / F; }
const mean = (a0, a1) => { let s = 0, c = 0; for (let i = Math.max(0, a0); i < Math.min(n, a1); i++) { s += lum[i]; c++; } return c ? s / c : 0; };
const minIn = (a0, a1) => { let mn = 255, at = a0; for (let i = Math.max(0, a0); i < Math.min(n, a1); i++) if (lum[i] < mn) { mn = lum[i]; at = i; } return [mn, at]; };
const dips = [];
for (const b of bounds) {
  if (b.frame < 10 || b.frame > n - 10) continue;
  const [mn, at] = minIn(b.frame - 6, b.frame + 7);
  const ref = Math.min(mean(b.frame - 24, b.frame - 8), mean(b.frame + 8, b.frame + 24));
  if (ref - mn > 15 && mn < ref * 0.5) dips.push({ key: b.key, t: +(at / fps).toFixed(2), min: +mn.toFixed(1), around: +ref.toFixed(1) });
}
add('black-dips', '샷 경계 검은 화면', dips.length === 0, `경계 ${bounds.length}곳 중 급락 ${dips.length}곳`, dips);
// dark stretches (info only): >= 1s below 12
const dark = []; let s0 = -1;
for (let i = 0; i <= n; i++) { const d = i < n && lum[i] < 12; if (d && s0 < 0) s0 = i; if (!d && s0 >= 0) { if (i - s0 >= fps) dark.push({ from: +(s0 / fps).toFixed(1), to: +(i / fps).toFixed(1) }); s0 = -1; } }
add('dark-stretches', '1초 이상 어두운 구간 (참고)', true, `${dark.length}곳`, dark);

// 3) loudness
const ln = spawnSync(bin('ffmpeg'), ['-hide_banner', '-i', file, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { env }).stderr.toString();
const lj = JSON.parse(ln.slice(ln.lastIndexOf('{'), ln.lastIndexOf('}') + 1));
const I = Number(lj.input_i), TP = Number(lj.input_tp);
const isYoutube = /youtube/i.test(path.basename(file));
add('loudness', isYoutube ? '음량 (YouTube 업로드본: -15~-13 LUFS, TP ≤ -1)' : '음량 (마스터, 업로드 전 정규화 필요)', isYoutube ? I >= -15 && I <= -13 && TP <= -1 : true, `${I.toFixed(1)} LUFS, TP ${TP.toFixed(1)} dBTP`);

// 4) subtitles
const srtCandidates = [file.replace(/_(final|preview)(_youtube)?\.mp4$/, '.en.srt'), path.join(path.dirname(file), `${id}.en.srt`)];
const srt = srtCandidates.find((f) => fs.existsSync(f));
if (srt) {
  const cues = fs.readFileSync(srt, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/).map((b) => b.split('\n'));
  const bad = [];
  for (const c of cues) {
    const lines = c.slice(2);
    for (const l of lines) if (l.length > 56) bad.push({ cue: +c[0], issue: '한 줄 56자 초과', text: l });
    if (lines.length > 2) bad.push({ cue: +c[0], issue: '3줄 이상', text: lines.join(' / ') });
    if (lines.length === 2 && lines[1].trim().split(/\s+/).length <= 2) bad.push({ cue: +c[0], issue: '둘째 줄 1~2단어', text: lines.join(' / ') });
  }
  add('subtitles', '자막 줄 규칙', bad.length === 0, `${cues.length}개 구간, 위반 ${bad.length}`, bad);
} else add('subtitles', '자막 줄 규칙', false, 'SRT 없음');

const result = { id, file: path.relative(P.dir, file).startsWith('..') ? file : path.relative(P.dir, file), at: new Date().toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1), ok: checks.every((c) => c.ok), checks, luminance: { fps, step: 1, values: Array.from(lum, (x) => Math.round(x)) } };
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(result)); }
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: ${c.detail}`);
console.log(`qc ${result.ok ? 'PASS' : 'FAIL'} in ${result.seconds}s`);
