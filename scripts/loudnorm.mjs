// Usage: node scripts/loudnorm.mjs <ID>
// Two-pass linear loudnorm of 1_발행본/<ID>_final.mp4 to -14.5 LUFS / TP -1.0 (video stream copied)
// -> 1_발행본/<ID>_final_youtube.mp4. Uses the ffmpeg bundled with Remotion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { episodePaths } from './lib/paths.mjs';

const id = process.argv[2]; if (!id) { console.error('usage: node scripts/loudnorm.mjs <ID>'); process.exit(1); }
const P = episodePaths(id);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', '@remotion', 'compositor-darwin-arm64');
const ff = path.join(dir, 'ffmpeg'); const env = { ...process.env, DYLD_LIBRARY_PATH: dir };
const src = path.join(P.publish, `${id}_final.mp4`); const dst = path.join(P.publish, `${id}_final_youtube.mp4`);
if (!fs.existsSync(src)) { console.error('missing ' + src); process.exit(1); }
const I = -14.5, TP = -1.0, LRA = 11;
const p1 = spawnSync(ff, ['-hide_banner', '-i', src, '-vn', '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'], { env, maxBuffer: 1 << 26 });
const m = p1.stderr.toString().match(/\{[\s\S]*?\}/g); const j = JSON.parse(m[m.length - 1]);
// keep linear mode: lower the target if the measured true peak would exceed TP
const Ilin = Math.min(I, Math.floor((TP - Number(j.input_tp) + Number(j.input_i) - 0.01) * 10) / 10);
// if linear would land at or below -15 LUFS (QC floor, measured output drifts ~0.05), let loudnorm fall back to dynamic mode at the full target
const Iuse = Ilin >= -14.9 ? Ilin : I;
const TPuse = Iuse === Ilin ? TP : TP - 0.3; // dynamic mode lands right on the ceiling; keep headroom
const af = `loudnorm=I=${Iuse}:TP=${TPuse}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=json`;
const tmp = dst + '.tmp.mp4';
const p2 = spawnSync(ff, ['-hide_banner', '-y', '-i', src, '-map', '0', '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmp], { env, maxBuffer: 1 << 26 });
if (p2.status !== 0) { console.error(p2.stderr.toString().slice(-800)); process.exit(1); }
const m2 = p2.stderr.toString().match(/\{[\s\S]*?\}/g); const k = m2 ? JSON.parse(m2[m2.length - 1]) : {};
fs.renameSync(tmp, dst);
console.log(JSON.stringify({ target: Iuse, linearTarget: Ilin, in_I: j.input_i, in_TP: j.input_tp, out_I: k.output_i, out_TP: k.output_tp, type: k.normalization_type, file: dst }));
