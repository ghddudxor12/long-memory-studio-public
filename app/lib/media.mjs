// Media helpers: hashing, probing (Remotion's bundled ffprobe), JPG conversion, validation of generated files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root } from '../../scripts/lib/paths.mjs';

const ffdir = path.join(root, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: ffdir };

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function probe(file) {
  const j = JSON.parse(execFileSync(path.join(ffdir, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration,format_name', '-of', 'json', file], { env }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { width: v?.width, height: v?.height, duration: Number(j.format?.duration) || 0, format: j.format?.format_name, audio: j.streams.some((s) => s.codec_type === 'audio') };
}

export function toJpg(src, out, quality = 2) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-q:v', String(quality), out], { env });
}

export function previewJpg(src, out, isVideo, at = 1) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const a = isVideo ? ['-ss', String(at), '-i', src] : ['-i', src];
  execFileSync(path.join(ffdir, 'ffmpeg'), ['-v', 'error', '-y', ...a, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out], { env });
}

// Validates a generated file before it may enter the project (ShotForward idea: results enter only after media validation).
// kind: image | video. known: set of sha256 already in the project (inputs, refs, previous versions).
export function validate(file, kind, known = new Set()) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  if (!fs.existsSync(file)) { add('exists', false, 'file not found'); return { ok: false, checks }; }
  const size = fs.statSync(file).size; add('size', size > 20_000, `${(size / 1e6).toFixed(2)}MB`);
  const hash = sha256(file); add('new', !known.has(hash), known.has(hash) ? '이미 있는 파일과 같음 (이전 이미지를 잘못 잡았을 가능성)' : 'new content');
  let p = {};
  try { p = probe(file); } catch (e) { add('probe', false, 'ffprobe failed'); return { ok: false, checks, hash }; }
  const ratio = p.width && p.height ? p.width / p.height : 0;
  add('aspect', Math.abs(ratio - 16 / 9) < 0.03, `${p.width}x${p.height}`);
  if (kind === 'image') add('resolution', (p.width || 0) >= 1024, `width ${p.width}`);
  if (kind === 'video') { add('duration', p.duration >= 2.5 && p.duration <= 16, `${p.duration.toFixed(2)}s`); add('resolution', (p.width || 0) >= 1280, `width ${p.width} (360p 초안은 1080p 업스케일본을 받아 넣기)`); }
  return { ok: checks.every((c) => c.ok), checks, hash, probe: p };
}
