// usage: node scripts/adopt-latest.mjs <ID> [--end] [--skip S01-02,S03-04] [--by aside]
// Adopts the newest candidate keyframe (default) or end frame (--end) of every shot that has no adopted one yet.
// Use after reviewing the sheet; list rejected shots in --skip (they stay candidates for regeneration).
const a = process.argv.slice(2); const id = a[0]; const end = a.includes('--end');
const skip = a.includes('--skip') ? a[a.indexOf('--skip') + 1].split(',') : []; const by = a.includes('--by') ? a[a.indexOf('--by') + 1] : 'aside';
const API = 'http://127.0.0.1:5178/api';
const e = await (await fetch(`${API}/episodes/${id}`)).json(); let n = 0; const errs = [];
for (const s of e.production.shots) {
  if (skip.includes(s.key)) continue;
  const mine = s.keyframes.filter((k) => (end ? k.role === 'end' : k.role !== 'end'));
  if (mine.some((k) => k.state === 'adopted')) continue; const c = mine.filter((k) => k.state === 'candidate').slice(-1)[0]; if (!c) continue;
  const r = await fetch(`${API}/episodes/${id}/shots/${s.key}/adopt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(end ? { file: c.file, role: 'end', by } : { kind: 'keyframe', file: c.file, by }) });
  if (r.ok) n++; else errs.push(`${s.key} ${r.status} ${(await r.text()).slice(0, 120)}`);
}
console.log(`${id}: adopted ${n} ${end ? 'end frames' : 'keyframes'}${errs.length ? ' · errors: ' + errs.join(' | ') : ''}`);
