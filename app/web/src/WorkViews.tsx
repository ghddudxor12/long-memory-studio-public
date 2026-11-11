import { useEffect, useState, useCallback } from "react";
import { api, fmt, fileUrl } from "./util";

type Line = { id: string; text: string; wav: boolean; wavMtime: string | null; sec?: number; estimated?: boolean; subtitles?: string[] };
type Narr = { voice: { voice: string; rate: number }; scenes: { scene: number; title: string; captions: string[]; narration: Line[] }[]; total: number | null };
type Job = { id: string; status: string; progress: number; log?: string[] };

function useJob(onDone: () => void) {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => { if (!job || job.status !== "running") return; const h = setInterval(async () => { const j = await api<Job>(`/api/jobs/${job.id}`); setJob(j); if (j.status !== "running") onDone(); }, 1500); return () => clearInterval(h); }, [job, onDone]);
  return [job, (id: string) => setJob({ id, status: "running", progress: 0 })] as const;
}

// Script & narration: edit lines, TTS (worker) → manifest, durations and subtitle chunks
export function NarrationView({ ep }: { ep: string }) {
  const [n, setN] = useState<Narr | null>(null); const [edit, setEdit] = useState<Record<string, string>>({}); const [msg, setMsg] = useState("");
  const load = useCallback(() => api<Narr>(`/api/episodes/${ep}/narration`).then((d) => { setN(d); setEdit({}); }), [ep]);
  useEffect(() => { load(); }, [load]);
  const [job, startJob] = useJob(load);
  if (!n) return <p className="small">불러오는 중…</p>;
  const dirty = Object.keys(edit).length;
  const missing = n.scenes.flatMap((s) => s.narration).filter((l) => !l.wav).length;
  async function save() { const r = await api<{ changed: string[] }>(`/api/episodes/${ep}/narration`, "PATCH", { lines: Object.entries(edit).map(([id, text]) => ({ id, text })) }); setMsg(`저장: ${r.changed.join(", ")} (바뀐 줄의 WAV는 다시 만들어야 해요)`); load(); }
  async function tts(force = false) { const r = await api<{ job: string }>(`/api/episodes/${ep}/tts`, "POST", { force }); startJob(r.job); setMsg("TTS 생성 중 → 끝나면 manifest를 다시 만들어요"); }
  return (
    <div className="narr">
      <div className="kfr-bar"><b>대본·내레이션</b>
        <span className="small">목소리 {n.voice.voice} · 속도 {n.voice.rate} · 전체 {n.total ? fmt(n.total) : "-"} · WAV 없는 줄 {missing}</span>
        <span className="spacer" />
        {dirty > 0 && <button className="primary" onClick={save}>수정 {dirty}줄 저장</button>}
        <button onClick={() => tts(false)}>빠진 줄 TTS</button><button onClick={() => tts(true)}>전체 다시 TTS</button>
        <button onClick={async () => { const r = await api<{ job: string }>(`/api/episodes/${ep}/manifest`, "POST"); startJob(r.job); }}>manifest 다시 만들기</button>
      </div>
      {job && <div className="job"><span>{job.status === "running" ? "진행 중" : job.status === "done" ? "완료" : "실패"}</span>{job.log?.slice(-2).map((l, i) => <span key={i} className="small">{l}</span>)}</div>}
      <div className="small">{msg}</div>
      {n.scenes.map((sc) => (
        <section key={sc.scene} className="nscene">
          <h2>Scene {sc.scene} <small>{sc.title}</small></h2>
          {sc.captions?.length > 0 && <div className="small">화면 캡션: {sc.captions.join(" / ")}</div>}
          {sc.narration.map((l) => (
            <div key={l.id} className="nline">
              <div className="nmeta"><b>{l.id}</b><span className={"state " + (l.wav ? "adopted" : "rejected")}>{l.wav ? "WAV" : "WAV 없음"}</span>{l.sec != null && <span className="small">{l.sec.toFixed(1)}s{l.estimated ? " (추정)" : ""}</span>}</div>
              <textarea rows={3} value={edit[l.id] ?? l.text} onChange={(e) => setEdit({ ...edit, [l.id]: e.target.value })} />
              {l.subtitles && <div className="subs">{l.subtitles.map((t, i) => <div key={i} className={"sub" + (t.split("\n").some((x) => x.length > 56) || (t.split("\n")[1] ?? "").trim().split(/\s+/).filter(Boolean).length === 1 ? " bad" : "")}>{t.split("\n").map((x, j) => <div key={j}>{x}</div>)}</div>)}</div>}
            </div>))}
        </section>))}
    </div>
  );
}

// Package & upload: metadata (chapters auto), tags budget, translations/subtitles checks, thumbnail spec + render, upload checklist
export function PackageView({ ep }: { ep: string }) {
  const [p, setP] = useState<any>(null); const [up, setUp] = useState<any>(null); const [m, setM] = useState<any>(null); const [t, setT] = useState<any>(null); const [msg, setMsg] = useState(""); const [v, setV] = useState(0);
  const load = useCallback(() => { api<any>(`/api/episodes/${ep}/package`).then((d) => { setP(d); setM(d.meta ? { ...d.meta, tagsText: d.meta.tags.join(", "), chapterText: (d.meta.chapterTitles || []).join("\n") } : { title: "", description: "{chapters}", tagsText: "", chapterText: "" }); setT(d.thumbnail); }); api<any>(`/api/episodes/${ep}/upload`).then(setUp); }, [ep]);
  useEffect(() => { load(); }, [load]);
  const [job, startJob] = useJob(() => { setV(Date.now()); load(); });
  if (!p || !m || !up) return <p className="small">불러오는 중…</p>;
  const tags = String(m.tagsText).split(",").map((x: string) => x.trim()).filter(Boolean); const tagLen = tags.join(", ").length;
  async function saveMeta() { await api(`/api/episodes/${ep}/metadata`, "PUT", { title: m.title, titleAlternatives: m.titleAlternatives || [], description: m.description, tags, chapterTitles: String(m.chapterText).split("\n").map((x: string) => x.trim()).filter(Boolean), settings: m.settings || {} }); setMsg("메타데이터 저장"); load(); }
  async function exportMd() { const r = await api<any>(`/api/episodes/${ep}/metadata/export`, "POST"); setMsg(`내보냄: ${r.file}`); }
  async function saveThumb(publish: boolean) { await api(`/api/episodes/${ep}/thumbnail`, "PUT", t); const r = await api<{ job: string }>(`/api/episodes/${ep}/thumbnail/render`, "POST", { publish }); startJob(r.job); setMsg(publish ? "썸네일 렌더 → 1_발행본 (JPG)" : "썸네일 미리보기 렌더"); }
  async function tick(key: string, done: boolean) { await api(`/api/episodes/${ep}/upload`, "PATCH", { checks: { [key]: done } }); load(); }
  const thumbFile = p.status.checks.find((c: any) => c.key === "thumbnail")?.detail?.split(" ")[0];
  return (
    <div className="pkg">
      <div className="kfr-bar"><b>패키지·업로드</b><span className="small">{p.status.checks.filter((c: any) => c.ok).length}/{p.status.checks.length} 검사 통과</span><span className="spacer" /><span className="small">{msg}</span></div>
      <div className="pkg-grid">
        <section className="panelbox">
          <h3>자동 검사</h3>
          {p.status.checks.map((c: any) => <div key={c.key} className="qrow"><span className={"state " + (c.ok ? "adopted" : "rejected")}>{c.ok ? "OK" : "확인"}</span><div><b>{c.label}</b> <span className="small">{c.detail}</span></div></div>)}
        </section>
        <section className="panelbox">
          <h3>업로드 체크리스트 {up.youtube?.videoId && <a href={`https://studio.youtube.com/video/${up.youtube.videoId}/edit`} target="_blank" className="small">Studio 열기</a>}</h3>
          {up.items.map((it: any) => <label key={it.key} className="check"><input type="checkbox" checked={!!it.done} onChange={(e) => tick(it.key, e.target.checked)} /> {it.label} {it.at && it.done && <span className="small">{it.at.slice(5, 10)} {it.by}</span>}</label>)}
        </section>
        <section className="panelbox wide2">
          <div className="row"><h3>메타데이터 (영어)</h3><span className="row"><button onClick={exportMd}>md 내보내기</button><button className="primary" onClick={saveMeta}>저장</button></span></div>
          <label className="fld">제목 <span className="small">{m.title.length}/100자</span><input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /></label>
          <div className="two">
            <label className="fld">설명 <span className="small">{"{chapters}"} 자리에 챕터가 자동으로 들어가요</span><textarea rows={14} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} /></label>
            <label className="fld">챕터 제목 (한 줄에 하나: 타이틀, 장면 1, 장면 2 …)<textarea rows={14} value={m.chapterText} onChange={(e) => setM({ ...m, chapterText: e.target.value })} /></label>
          </div>
          <div className="chapters">{p.chapters.map((c: any) => <span key={c.stamp} className="status">{c.stamp} {c.title}</span>)}</div>
          <label className="fld">태그 <span className={"small" + (tagLen > 500 ? " over" : "")}>{tagLen}/500자 · {tags.length}개</span><textarea rows={3} value={m.tagsText} onChange={(e) => setM({ ...m, tagsText: e.target.value })} /></label>
          <details><summary className="small">완성된 설명 미리보기 ({p.description.length}자)</summary><pre className="composed">{p.description}</pre></details>
        </section>
        <section className="panelbox wide2">
          <div className="row"><h3>썸네일 (시리즈 고정 포맷)</h3><span className="row"><button onClick={() => saveThumb(false)}>미리보기 렌더</button><button className="primary" onClick={() => saveThumb(true)}>렌더해서 1_발행본에 저장</button></span></div>
          {job && <div className="small">{job.status === "running" ? "렌더 중…" : job.status === "done" ? "렌더 완료" : "렌더 실패"}</div>}
          <div className="two">
            <div>{thumbFile && <img className="thumbimg" src={fileUrl(ep, `1_발행본/${thumbFile}`) + `?v=${v}`} />}<div className="small">1_발행본/{thumbFile}</div></div>
            <div className="thumbform">
              {["ep", "series", "source", "image"].map((k) => <label key={k} className="fld">{k}<input value={t[k] ?? ""} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>)}
              {t.lines.map((l: any, i: number) => <div key={i} className="row"><input value={l.text} onChange={(e) => { const lines = [...t.lines]; lines[i] = { ...l, text: e.target.value }; setT({ ...t, lines }); }} /><input type="number" value={l.size} style={{ width: 72 }} onChange={(e) => { const lines = [...t.lines]; lines[i] = { ...l, size: +e.target.value }; setT({ ...t, lines }); }} /><select value={l.color} onChange={(e) => { const lines = [...t.lines]; lines[i] = { ...l, color: e.target.value }; setT({ ...t, lines }); }}><option>white</option><option>gold</option></select></div>)}
              {t.highlight && <label className="fld">강조 라벨<input value={t.highlight.label} onChange={(e) => setT({ ...t, highlight: { ...t.highlight, label: e.target.value } })} /></label>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Archive: what is local vs online-only, proxy for browsing, archive index, done flag
export function ArchiveView({ ep }: { ep: string }) {
  const [a, setA] = useState<any>(null); const [msg, setMsg] = useState("");
  const load = useCallback(() => api<any>(`/api/episodes/${ep}/archive`).then(setA), [ep]);
  useEffect(() => { load(); }, [load]);
  const [job, startJob] = useJob(load);
  if (!a) return <p className="small">크기 계산 중…</p>;
  const mb = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(2)}GB` : `${(b / 1e6).toFixed(1)}MB`;
  return (
    <div className="arch">
      <div className="kfr-bar"><b>보관</b><span className="small">전체 {mb(a.total)} (원본은 Drive) · 이 Mac 캐시 {mb(a.local)} · 파일 {a.files}개</span><span className="spacer" />
        {a.done ? <><span className="state adopted">보관 완료 {a.done.slice(0, 10)}</span><button onClick={async () => { await api(`/api/episodes/${ep}/archive/done`, "POST", { undo: true }); load(); }}>되돌리기</button></>
          : <button className="primary" disabled={!a.proxy || !a.archiveJson} title="프록시와 목록을 먼저 만들어요" onClick={async () => { await api(`/api/episodes/${ep}/archive/done`, "POST"); load(); }}>보관 완료 표시</button>}</div>
      <table className="tbl"><thead><tr><th>폴더</th><th>파일</th><th>크기</th><th>이 Mac 캐시</th><th>온라인 전용 파일</th></tr></thead>
        <tbody>{Object.entries(a.groups).sort().map(([k, g]: any) => <tr key={k}><td><b>{k}</b></td><td>{g.files}</td><td>{mb(g.size)}</td><td>{mb(g.localSize)}</td><td>{g.cloudOnly}개</td></tr>)}</tbody></table>
      <div className="pkg-grid">
        <section className="panelbox"><h3>1. 열람용 프록시 (360p)</h3><p className="small">원본을 온라인 전용으로 돌려도 렌더 검수 화면에서 볼 수 있게 작게 만든 사본이에요.</p>
          {a.proxy ? <p className="small">있음: {a.proxy}</p> : null}<button onClick={async () => { const r = await api<{ job: string }>(`/api/episodes/${ep}/archive/proxy`, "POST"); startJob(r.job); setMsg("프록시 만드는 중"); }}>{a.proxy ? "다시 만들기" : "만들기"}</button>
          {job && <span className="small"> {job.status === "running" ? "진행 중…" : job.status}</span>}</section>
        <section className="panelbox"><h3>2. 파일 목록 (archive.json)</h3><p className="small">파일마다 경로·크기·수정 시각을 남겨요. 나중에 무엇이 있었는지 원본을 받지 않고 확인할 수 있어요.</p>
          {a.archiveJson && <p className="small">있음: _app/archive.json</p>}<button onClick={async () => { const r = await api<any>(`/api/episodes/${ep}/archive/index`, "POST"); setMsg(`목록 ${r.files}개 기록`); load(); }}>{a.archiveJson ? "다시 기록" : "기록"}</button></section>
        <section className="panelbox wide2"><h3>3. 이 Mac 캐시 비우기 (온라인 전용으로 전환)</h3>
          <p className="small">Drive 스트리밍은 한 번 읽은 파일을 이 Mac에 받아 둬요(렌더, 검사, 미리보기 때). 원본은 Drive에 그대로 있고, 나중에 열면 다시 받아져요. _app(미리보기·프록시·기록)은 남겨서 앱이 바로 열리게 해요. 손으로 할 때는 Finder에서 폴더를 오른쪽 클릭 → <b>다운로드 제거</b> (이미 온라인 전용이면 그 자리에 "지금 다운로드"가 보여요). "오프라인에서 사용하도록 설정"은 반대로 이 Mac에 고정하는 메뉴예요.</p>
          <button className="primary" onClick={async () => { const r = await api<{ job: string }>(`/api/episodes/${ep}/archive/evict`, "POST", {}); startJob(r.job); setMsg("온라인 전용으로 전환 중…"); }}>1_발행본·2_소스·3_폐기_이전본·4_프로젝트백업 비우기</button>
          {job?.log && <div className="small">{job.log.slice(-1)[0]}</div>}
          <div className="small">{msg}</div></section>
      </div>
    </div>
  );
}
