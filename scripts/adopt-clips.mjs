// usage: node scripts/adopt-clips.mjs <ID> [--skip S01-02,...]  adopts the newest candidate clip of every video shot without an adopted clip
const a = process.argv.slice(2); const id = a[0]; const skip = a.includes('--skip') ? a[a.indexOf('--skip') + 1].split(',') : [];
const API = 'http://127.0.0.1:5178/api'; const e = await (await fetch(`${API}/episodes/${id}`)).json(); let n = 0; const errs = [];
for (const s of e.production.shots.filter((x) => x.type === 'video')) {
  if (skip.includes(s.key) || s.clips.some((c) => c.state === 'adopted')) continue; const c = s.clips.filter((x) => x.state === 'candidate').slice(-1)[0]; if (!c) continue;
  const r = await fetch(`${API}/episodes/${id}/shots/${s.key}/adopt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'clip', file: c.file, by: 'aside' }) });
  if (r.ok) n++; else errs.push(`${s.key} ${r.status}`);
}
const st = await (await fetch(`${API}/episodes/${id}/stages`)).json(); console.log(`${id}: adopted ${n} clips${errs.length ? ' errors ' + errs.join(',') : ''} · now ${st.current?.n} ${st.current?.label} ${st.current?.detail || ''}`);
