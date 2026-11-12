// usage: node scripts/mkveo.mjs <EP_ID> [shot keys...]
// Creates approved flow-veo jobs (model/length from studio.config.json flowVideo, frames mode) for video shots that have adopted start + end frames
// and no open (queued/approved/running) flow-veo job. Approval: user delegation 2026-11-10 (Ultra credits).
// Prompt = timeline + "Keep" rules. Since 2026-11-11 the Keep line also forbids Omni's curling/swirling wisps
// (EP010-2 S04-03 v1 grew white spiral smoke for 5 s); "no smoke/mist" is added only when the shot does not ask for them.
const [ep, ...rawOnly] = process.argv.slice(2); const only = rawOnly.filter((x, i, a) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
if (!ep) { console.error('usage: node scripts/mkveo.mjs <EP_ID> [keys...]'); process.exit(1); }
const API = 'http://127.0.0.1:5178/api';
// model and length: studio.config.json "flowVideo" (user's Flow choice), overridable with --model / --dur
const meta = await (await fetch(`${API}/queue/meta`)).json(); const FV = meta.flowVideo || {};
const argv = process.argv; const optv = (k) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : null; };
const MODEL = optv('--model') || FV.model || 'omni-1.2-720p'; const DUR = Number(optv('--dur')) || FV.durationSec || 8;
const A = Math.max(1, Math.round(DUR / 4)), B = DUR - A; // timeline marks: 8 s -> 0-2 / 2-6 / 6-8, 4 s -> 0-1 / 1-3 / 3-4
const e = await (await fetch(`${API}/episodes/${ep}`)).json();
const shots = (e.shots || e.production.shots).filter((s) => s.type === 'video' && (!only.length || only.includes(s.key)));
const open = (await (await fetch(`${API}/queue?episode=${ep}&status=queued,approved,running`)).json()).filter((j) => j.type === 'flow-veo').map((j) => j.target.shot);

export function keepLine(s) {
  const assets = (s.assets || []).join(' ');
  const text = `${s.prompts?.visual || ''} ${s.prompts?.motion || ''}`.toLowerCase();
  const keep = ['Classical oil-painting look in every frame; no text; no new characters appear.'];
  if (/God/.test(assets)) keep.push('God is shown only as a hand or light from above: no face, no profile, no figure.');
  keep.push('Any people stay seen strictly from behind the whole time: heads never turn, no faces, no profiles.');
  keep.push('No blood, no wounds, no weapons raised, no symbols or letters on bodies.');
  keep.push('No curling or swirling wisps, no spiral patterns in the air, no new shapes appear.');
  if (!/smoke|mist|fog|incense|steam|cloud of dust|haze/.test(text)) keep.push('The air stays clear: no smoke, no mist.');
  return keep.join(' ');
}

const ids = [];
for (const s of shots) {
  if (open.includes(s.key)) { console.log('open job exists', s.key); continue; }
  const hasEnd = s.keyframes.some((k) => k.state === 'adopted' && k.role === 'end'); if (!hasEnd) { console.log('no end', s.key); continue; }
  const prompt = `Image 1 = FIRST FRAME, Image 2 = LAST FRAME. ${DUR} seconds.\nScene: ${s.prompts.visual}\nMotion: ${s.prompts.motion || 'Slow push-in.'}\n0-${A}s: start exactly on the first frame, motion begins slowly.\n${A}-${B}s: the motion continues smoothly, no cuts.\n${B}-${DUR}s: settle exactly on the last frame.\nKeep: ${keepLine(s)}`;
  const r = await (await fetch(`${API}/queue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'flow-veo', episode: ep, shot: s.key, model: MODEL, durationSec: DUR, prompt, by: 'aside' }) })).json();
  if (r.id) { ids.push(r.id); await fetch(`${API}/queue/${r.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'user', note: '사용자 위임 2026-11-10 (Ultra 크레딧)' }) }); }
  else console.log('ERR', s.key, JSON.stringify(r).slice(0, 120));
}
console.log(JSON.stringify(ids));
