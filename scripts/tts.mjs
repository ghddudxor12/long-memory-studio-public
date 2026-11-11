// Usage: node scripts/tts.mjs BIB-GEN-001 [--force]
// Generates one WAV per narration line into <episode>/2_소스/narration/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { episodePaths, readJson } from './lib/paths.mjs';

// episode id: first non-flag argument, or npm --ep=<ID> (npm_config_ep)
const id = process.argv.slice(2).find((a) => !a.startsWith('-')) || process.env.npm_config_ep;
if (!id) { console.error('usage: node scripts/tts.mjs <EPISODE_ID> [--force]'); process.exit(1); }
const force = process.argv.includes('--force');
if (!id) { console.error('episode id required'); process.exit(1); }
const P = episodePaths(id);
const ep = readJson(P.episodeJson);
const outDir = path.join(P.src, 'narration');
fs.mkdirSync(outDir, { recursive: true });
const { engine, voice, rate } = ep.voice;
if (engine !== 'macos-say') { console.error('only macos-say is implemented'); process.exit(1); }
// validate the voice name against installed voices
const installed = execFileSync('say', ['-v', '?']).toString().split('\n').map((l) => l.replace(/\s+[a-z]{2}_[A-Z]{2}\s+#.*$/, '').trim()).filter(Boolean);
if (!installed.includes(voice)) {
  const near = installed.filter((v) => v.toLowerCase().startsWith(voice.split(' ')[0].toLowerCase()));
  console.error(`voice "${voice}" is not installed. Similar installed voices: ${near.join(', ') || '(none)'}`);
  console.error('Download it in System Settings > Accessibility > Spoken Content > System Voice > Manage Voices, or edit voice in episode.json.');
  process.exit(1);
}
let n = 0;
for (const sc of ep.scenes) for (const line of sc.narration) {
  const out = path.join(outDir, `${line.id}.wav`);
  if (fs.existsSync(out) && !force) continue;
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', out, '--file-format=WAVE', '--data-format=LEI16@44100', line.text]);
  n++;
}
console.log(`tts: generated ${n} file(s) in ${outDir}`);
