// Usage: node scripts/translate.mjs <ID> [--langs ja,ko] [--jobs 4] [--force]
// Translates the English SRT + YouTube title/description (with chapters) into the channel's 36 languages
// using Codex CLI (ChatGPT subscription, text only). Writes into <episode>/1_발행본:
//   자막/<ID>.<lang>.srt (same cue count and timings as English), 번역/<lang>.json {title, description},
//   <ID>_metadata.translations.json (all languages). Validates cue count and chapter stamps; retries once.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { episodePaths } from './lib/paths.mjs';

const id = process.argv[2];
if (!id) { console.error('usage: node scripts/translate.mjs <ID> [--langs a,b] [--jobs 4] [--force]'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const JOBS = Number(arg('--jobs', 4));
const API = arg('--api', 'http://127.0.0.1:5178');
const CODEX = process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const CODEX_HOME = process.env.CODEX_HOME_REAL || (process.env.HOME + '/.codex');

export const LANGS = { ar: 'Arabic', bn: 'Bengali', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', es: 'Spanish (Latin America)', fa: 'Persian', fi: 'Finnish', fil: 'Filipino', fr: 'French', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', ms: 'Malay', nb: 'Norwegian Bokmål', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese (Brazil)', ro: 'Romanian', ru: 'Russian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', 'zh-Hans': 'Chinese (Simplified)', 'zh-Hant': 'Chinese (Traditional)' };
const langs = arg('--langs', null)?.split(',') || Object.keys(LANGS);

const P = episodePaths(id);
const enFile = path.join(P.publish, `${id}.en.srt`);
const cues = fs.readFileSync(enFile, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/).map((b) => { const l = b.split('\n'); return { n: l[0], time: l[1], text: l.slice(2).join('\n') }; });
const meta = JSON.parse(fs.readFileSync(path.join(P.dir, '_app', 'metadata.json'), 'utf8'));
const pkg = await (await fetch(`${API}/api/episodes/${id}/package`)).json();
const description = pkg.description || meta.description;
const stamps = pkg.chapters.map((c) => c.stamp);
fs.mkdirSync(path.join(P.publish, '자막'), { recursive: true });
fs.mkdirSync(path.join(P.publish, '번역'), { recursive: true });

function prompt(lang) {
  return `You are a professional subtitle and YouTube metadata translator for a calm Bible documentary channel ("The Long Memory").
Translate from English into ${LANGS[lang]} (${lang}).
Rules:
- Scripture quotations are from the King James Version: render them in the dignified traditional register used by Bibles in ${LANGS[lang]}, keep the meaning exact, and keep biblical names in the forms used by Bibles in that language.
- Keep Hebrew/Greek terms that the narrator explains (e.g. adam, adamah, nephesh chayyah, Isha, Ish, paradeisos, edin) in Latin letters, optionally followed by the native script.
- Subtitles: return exactly ${cues.length} cue strings in the same order, one per input cue, each at most 2 lines (use \\n), short enough to read; never merge or split cues.
- Description: translate everything, keep the line structure, keep every chapter timestamp (${stamps.join(', ')}) exactly as written at the start of its line, keep hashtags in English, keep "King James Version" in English (you may add the local name in parentheses).
- Title: natural and compelling in ${LANGS[lang]}, at most 90 characters.
Return ONLY a JSON object, no prose, no code fences: {"title": "...", "description": "...", "cues": ["...", ...]}

TITLE:
${meta.title}

DESCRIPTION:
${description}

CUES (JSON array):
${JSON.stringify(cues.map((c) => c.text))}
`;
}

function runCodex(input) {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `tr_${id}_${Math.random().toString(36).slice(2)}.txt`);
    const p = spawn(CODEX, ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', out, '-'], { env: { ...process.env, CODEX_HOME } });
    let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 10 * 60_000);
    p.on('close', (code) => { clearTimeout(timer); const msg = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''; try { fs.unlinkSync(out); } catch {} resolve({ code, msg, log }); });
    p.stdin.end(input);
  });
}

function parse(msg) {
  const s = msg.indexOf('{'); const e = msg.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON');
  return JSON.parse(msg.slice(s, e + 1));
}

async function one(lang) {
  const srt = path.join(P.publish, '자막', `${id}.${lang}.srt`); const tj = path.join(P.publish, '번역', `${lang}.json`);
  if (!force && fs.existsSync(srt) && fs.existsSync(tj)) return { lang, skipped: true };
  let err = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now(); const r = await runCodex(prompt(lang));
    try {
      const j = parse(r.msg);
      if (!Array.isArray(j.cues) || j.cues.length !== cues.length) throw new Error(`cue count ${j.cues?.length} != ${cues.length}`);
      const missing = stamps.filter((s) => !new RegExp(`(^|\\n)${s.replace(':', '\\:')}\\b`).test(j.description));
      if (missing.length) throw new Error('missing chapter stamps ' + missing.join(','));
      if (!j.title || j.title.length > 100) throw new Error('bad title');
      fs.writeFileSync(srt, cues.map((c, i) => `${c.n}\n${c.time}\n${String(j.cues[i]).trim()}\n`).join('\n'));
      fs.writeFileSync(tj, JSON.stringify({ title: j.title.trim(), description: j.description.trim() }, null, 2));
      return { lang, ok: true, secs: Math.round((Date.now() - t0) / 1000), attempt };
    } catch (e) { err = `${e.message}; exit ${r.code}; ${/usage limit|rate limit/i.test(r.log) ? 'QUOTA' : ''} ${r.log.slice(-200)}`; }
  }
  return { lang, ok: false, err };
}

const queue = [...langs]; const results = [];
await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length) { const l = queue.shift(); const r = await one(l); results.push(r); console.log(JSON.stringify(r).slice(0, 300)); } }));
const all = {};
for (const l of Object.keys(LANGS)) { const tj = path.join(P.publish, '번역', `${l}.json`); if (fs.existsSync(tj)) all[l] = JSON.parse(fs.readFileSync(tj, 'utf8')); }
fs.writeFileSync(path.join(P.publish, `${id}_metadata.translations.json`), JSON.stringify(all, null, 2));
const bad = results.filter((r) => r.ok === false);
console.log(`done: ${Object.keys(all).length}/${Object.keys(LANGS).length} languages${bad.length ? `, failed: ${bad.map((b) => b.lang).join(', ')}` : ''}`);
process.exit(bad.length ? 2 : 0);
