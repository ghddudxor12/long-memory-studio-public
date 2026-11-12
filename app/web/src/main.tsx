import { useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { EpisodeData, EpisodeSummary, Shot } from "./types";
import { DEFECTS, defectLabel, STATUSES, statusLabel, STATE_LABEL, ROLE_LABEL, MOTIONS } from "./catalog";
import { fmt, fileUrl } from "./util";
import { RenderReview } from "./RenderReview";
import { KfReview } from "./KfReview";
import { SeriesView } from "./SeriesView";
import { QueueView } from "./QueueView";
import { HomeView, LedgerView } from "./HomeViews";
import { NarrationView, PackageView, ArchiveView } from "./WorkViews";
import { ShortsView } from "./ShortsView";
import { api } from "./util";
import type { Composed, QJob } from "./types";

type View = "ledger" | "home" | "series" | "narration" | "board" | "kf" | "queue" | "render" | "package" | "archive" | "shorts";
const VIEWS: [View, string][] = [["ledger", "대장"], ["home", "에피소드 홈"], ["series", "시리즈"], ["narration", "대본·내레이션"], ["board", "샷 보드"], ["kf", "키프레임 검수"], ["queue", "작업 큐"], ["render", "렌더 검수"], ["package", "패키지·업로드"], ["archive", "보관"], ["shorts", "숏폼"]];

function adoptedPreview(s: Shot): string | undefined {
  if (s.type === "video") return s.clips.find((c) => c.state === "adopted")?.preview;
  return s.keyframes.find((k) => k.state === "adopted")?.preview;
}

// ---------- App ----------
function App() {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [epId, setEpId] = useState<string>(() => new URLSearchParams(location.search).get("ep") || "");
  const [data, setData] = useState<EpisodeData | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ type: string; defect: string; q: string }>({ type: "all", defect: "", q: "" });
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get("view") as View) || "home");
  const go = (v: View) => { setView(v); setSel(null); const q = new URLSearchParams(location.search); q.set("view", v); history.replaceState(null, "", "?" + q); };

  useEffect(() => { fetch("/api/episodes").then((r) => r.json()).then((l: EpisodeSummary[]) => { setEpisodes(l); if (!epId && l[0]) setEpId(l[0].id); }); }, []);
  const load = useCallback(() => { if (epId) fetch(`/api/episodes/${epId}`).then((r) => r.json()).then(setData); }, [epId]);
  useEffect(load, [load]);

  const shots = data?.production?.shots ?? [];
  const visible = useMemo(() => shots.filter((s) =>
    (filter.type === "all" || (filter.type === "defects" ? s.defects.length > 0 : s.type === filter.type)) &&
    (!filter.defect || s.defects.includes(filter.defect)) &&
    (!filter.q || `${s.key} ${s.title} ${s.prompts.visual}`.toLowerCase().includes(filter.q.toLowerCase()))), [shots, filter]);
  const scenes = useMemo(() => { const m = new Map<number, Shot[]>(); for (const s of visible) { if (!m.has(s.scene)) m.set(s.scene, []); m.get(s.scene)!.push(s); } return [...m.entries()]; }, [visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "board" || !sel || (e.target as HTMLElement).closest("textarea,input,select")) return;
      const i = visible.findIndex((s) => s.key === sel);
      if (e.key === "Escape") setSel(null);
      if (e.key === "ArrowRight" && i < visible.length - 1) setSel(visible[i + 1].key);
      if (e.key === "ArrowLeft" && i > 0) setSel(visible[i - 1].key);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [sel, visible, view]);

  const prod = data?.production;
  const defectCount = shots.filter((s) => s.defects.length).length;
  const selected = shots.find((s) => s.key === sel) || null;

  return (
    <div className={"layout" + (view === "board" && selected ? " with-panel" : "") + (view !== "board" ? " no-filters" : "")}>
      <header>
        <div className="brand">Long Memory Studio</div>
        <select value={epId} onChange={(e) => { setEpId(e.target.value); setSel(null); history.replaceState(null, "", `?ep=${e.target.value}&view=${view}`); }}>
          {episodes.map((e) => <option key={e.id} value={e.id}>{e.folder.split("/").pop()}</option>)}
        </select>
        {prod && <div className="meta">
          <span className="pill">{episodes.find((e) => e.id === epId)?.stageLabel ?? prod.stage}</span>
          <span>샷 {shots.length} (영상 {shots.filter((s) => s.type === "video").length} · 이미지 {shots.filter((s) => s.type === "image").length})</span>
          <span>결함 기록 {defectCount}샷</span>
          {data?.timing.total && <span>길이 {fmt(data.timing.total)}</span>}
          {prod.credits?.flow && <span title={prod.credits.flow.note}>Flow 크레딧 ≈{prod.credits.flow.total}</span>}
          {prod.youtube && <a href={`https://youtu.be/${prod.youtube.videoId}`} target="_blank">YouTube ({prod.youtube.privacy})</a>}
        </div>}
      </header>
      <nav className="views">{VIEWS.map(([v, l]) => <button key={v} className={view === v ? "on" : ""} onClick={() => go(v)}>{l}</button>)}
        {prod && <span className="gates">{["G1", "G2", "G3"].map((g) => <span key={g} className={"state " + (prod.approvals?.[g] ? "adopted" : "")} title={prod.approvals?.[g]?.note}>{g} {prod.approvals?.[g] ? "승인" : "대기"}</span>)}</span>}
      </nav>
      {view === "ledger" && <main className="wide"><LedgerView onOpen={(id) => { setEpId(id); go("home"); }} /></main>}
      {view === "home" && data && <main className="wide"><HomeView ep={epId} go={go} onChanged={load} /></main>}
      {view === "narration" && <main className="wide"><NarrationView ep={epId} /></main>}
      {view === "package" && <main className="wide"><PackageView ep={epId} /></main>}
      {view === "archive" && <main className="wide"><ArchiveView ep={epId} /></main>}
      {view === "shorts" && <main className="wide"><ShortsView /></main>}
      {view === "series" && <main className="wide">{episodes.find((e) => e.id === epId)?.series ? <SeriesView sid={episodes.find((e) => e.id === epId)!.series!} /> : <p className="small">이 에피소드는 시리즈에 등록되지 않았어요 (studio.config.json series)</p>}</main>}
      {view === "queue" && <main className="wide"><QueueView ep={epId} /></main>}
      {view === "kf" && data && <main className="wide"><KfReview ep={epId} data={data} onChanged={load} /></main>}
      {view === "render" && data && <main className="wide"><RenderReview ep={epId} data={data} onChanged={load} /></main>}
      {view === "board" && <>
      <div className="filters">
        {[["all", "전체"], ["video", "영상"], ["image", "이미지"], ["defects", "결함 있음"]].map(([v, l]) =>
          <button key={v} className={filter.type === v ? "on" : ""} onClick={() => setFilter({ ...filter, type: v })}>{l}</button>)}
        <select value={filter.defect} onChange={(e) => setFilter({ ...filter, defect: e.target.value })}>
          <option value="">결함 종류 전체</option>
          {DEFECTS.map((d) => <option key={d.id} value={d.id}>{d.label} ({shots.filter((s) => s.defects.includes(d.id)).length})</option>)}
        </select>
        <input placeholder="키·제목·프롬프트 검색" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <span className="count">{visible.length}샷</span>
      </div>
      <main>
        {!prod && data && <p className="empty">이 에피소드에는 아직 _app/production.json이 없어요.</p>}
        {scenes.map(([n, list]) => (
          <section key={n}>
            <h2>Scene {n} <small>{list[0].sceneTitle}</small></h2>
            <div className="grid">
              {list.map((s) => <Card key={s.key} ep={epId} s={s} t={data?.timing.shots?.[s.key]} on={s.key === sel} onClick={() => setSel(s.key)} />)}
            </div>
          </section>
        ))}
      </main>
      </>}
      {view === "board" && selected && data && <Panel ep={epId} s={selected} t={data.timing.shots?.[selected.key]} onClose={() => setSel(null)} onSaved={load} />}
    </div>
  );
}

function Card({ ep, s, t, on, onClick }: { ep: string; s: Shot; t?: { start: number; duration: number }; on: boolean; onClick: () => void }) {
  const pv = adoptedPreview(s);
  return (
    <div className={"card" + (on ? " on" : "")} onClick={onClick}>
      <div className="thumb">{pv ? <img src={fileUrl(ep, pv)} loading="lazy" /> : <div className="noimg">미리보기 없음</div>}
        <span className={"badge " + s.type}>{s.type === "video" ? "영상" : "이미지"}</span>
        {t && <span className="time">{fmt(t.start)} · {t.duration.toFixed(1)}s</span>}
      </div>
      <div className="body">
        <div className="row"><b>{s.key}</b><span className={"status st-" + s.status}>{statusLabel(s.status)}</span></div>
        <div className="title">{s.title}</div>
        <div className="row small"><span>키프레임 {s.keyframes.length}</span>{s.clips.length > 0 && <span>클립 {s.clips.length}</span>}</div>
        {s.defects.length > 0 && <div className="chips">{s.defects.map((d) => <span key={d} className="chip">{defectLabel(d)}</span>)}</div>}
      </div>
    </div>
  );
}

// ---------- Detail panel ----------
function Panel({ ep, s, t, onClose, onSaved }: { ep: string; s: Shot; t?: { start: number; duration: number }; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"versions" | "prompts" | "notes" | "gen">("versions");
  const [viewing, setViewing] = useState<{ kind: "kf" | "clip"; file: string } | null>(null);
  const [defects, setDefects] = useState<string[]>(s.defects);
  const [status, setStatus] = useState(s.status);
  const [note, setNote] = useState("");
  const [segments, setSegments] = useState(JSON.stringify(s.segments ?? []));
  const [motion, setMotion] = useState(s.motion ?? "");
  const [msg, setMsg] = useState("");
  useEffect(() => { setDefects(s.defects); setStatus(s.status); setSegments(JSON.stringify(s.segments ?? [])); setMotion(s.motion ?? ""); setViewing(null); setMsg(""); setNote(""); }, [s.key]);

  const adoptedClip = s.clips.find((c) => c.state === "adopted");
  const adoptedKf = s.keyframes.filter((k) => k.state === "adopted");
  const main = viewing ?? (adoptedClip ? { kind: "clip" as const, file: adoptedClip.file } : adoptedKf[0] ? { kind: "kf" as const, file: adoptedKf[0].file } : null);

  async function save() {
    const body: any = { status, defects };
    if (note.trim()) body.note = note;
    if (s.type === "video") { try { const seg = JSON.parse(segments); if (JSON.stringify(seg) !== JSON.stringify(s.segments ?? [])) body.segments = seg; } catch { setMsg("사용 구간 형식 오류: [[0, 4.5]] 처럼"); return; } }
    if (s.type === "image" && motion !== (s.motion ?? "")) body.motion = motion;
    const r = await fetch(`/api/episodes/${ep}/shots/${s.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); setMsg(r.ok ? `저장됨: ${j.changes.join(", ") || "변경 없음"}` : `오류: ${j.error}`); setNote(""); onSaved();
  }

  return (
    <aside className="panel">
      <div className="ph">
        <div><b>{s.key}</b> {s.title}<div className="small">Scene {s.scene} · {s.type === "video" ? "영상" : "이미지"}{t ? ` · ${fmt(t.start)}부터 ${t.duration.toFixed(1)}초` : ""}</div></div>
        <button onClick={onClose} title="Esc">✕</button>
      </div>
      <div className="viewer">
        {main?.kind === "clip" ? <video key={main.file} src={fileUrl(ep, main.file)} controls autoPlay muted loop /> :
          main ? <img src={fileUrl(ep, main.file)} /> : <div className="noimg">없음</div>}
        <div className="small">{main?.file}</div>
      </div>
      <div className="tabs">
        {[["versions", `버전 이력 (${s.keyframes.length + s.clips.length})`], ["gen", `생성${[...s.keyframes, ...s.clips].some((v) => v.state === "candidate") ? " (후보)" : ""}`], ["prompts", "프롬프트"], ["notes", `결함·메모 (${s.notes.length})`]].map(([v, l]) =>
          <button key={v} className={tab === v ? "on" : ""} onClick={() => setTab(v as any)}>{l}</button>)}
      </div>
      {tab === "versions" && <div className="tabbody">
        {s.clips.length > 0 && <><h3>클립</h3><div className="vers">{s.clips.map((c) => <Ver key={c.file} ep={ep} pv={c.preview} label={`v${c.v} ${c.model ?? ""}`} state={c.state} sub={c.segments ? `사용 ${JSON.stringify(c.segments)}` : c.file.split("/").slice(-2).join("/")} on={main?.file === c.file} onClick={() => setViewing({ kind: "clip", file: c.file })} />)}</div></>}
        <h3>키프레임</h3>
        <div className="vers">{s.keyframes.map((k) => <Ver key={k.file} ep={ep} pv={k.preview} label={`v${k.v} ${ROLE_LABEL[k.role] ?? k.role}`} state={k.state} sub={k.note || k.file.split("/").slice(-2).join("/")} on={main?.file === k.file} onClick={() => setViewing({ kind: "kf", file: k.file })} />)}</div>
      </div>}
      {tab === "gen" && <Generate ep={ep} s={s} onChanged={onSaved} />}
      {tab === "prompts" && <div className="tabbody prompts">
        <h3>장면 설명 (visual)</h3><p>{s.prompts.visual || "없음"}</p>
        <h3>영상 프롬프트 (motion)</h3><pre>{s.prompts.motion || "없음"}</pre>
        <h3>소리 (audio)</h3><p>{s.prompts.audio || "없음"}</p>
        {s.assets.length > 0 && <><h3>참조 에셋</h3><p>{s.assets.join(", ")}</p></>}
      </div>}
      {tab === "notes" && <div className="tabbody">
        <h3>결함 태그</h3>
        <div className="chips edit">{DEFECTS.map((d) => <label key={d.id} title={"해결책: " + d.fix} className={"chip" + (defects.includes(d.id) ? " on" : "")}>
          <input type="checkbox" checked={defects.includes(d.id)} onChange={(e) => setDefects(e.target.checked ? [...defects, d.id] : defects.filter((x) => x !== d.id))} />{d.label}</label>)}</div>
        {defects.length > 0 && <ul className="fixes">{defects.map((d) => <li key={d}><b>{defectLabel(d)}</b>: {DEFECTS.find((x) => x.id === d)?.fix}</li>)}</ul>}
        <h3>메모</h3>
        <ul className="notes">{s.notes.map((n, i) => <li key={i}><span className="small">{n.at.slice(0, 10)} · {n.by}</span> {n.text}</li>)}</ul>
        <textarea placeholder="메모 추가 (예: 2:58 손가락 이상)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>}
      <div className="pf">
        <label>상태 <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        {s.type === "video" && <label>사용 구간 <input value={segments} onChange={(e) => setSegments(e.target.value)} /></label>}
        {s.type === "image" && <label>모션 <select value={motion} onChange={(e) => setMotion(e.target.value)}>{MOTIONS.map((m) => <option key={m}>{m}</option>)}</select></label>}
        <button className="primary" onClick={save}>저장</button>
        <span className="small">{msg}</span>
      </div>
    </aside>
  );
}

function Generate({ ep, s, onChanged }: { ep: string; s: Shot; onChanged: () => void }) {
  const [kind, setKind] = useState<"keyframe" | "end">("keyframe");
  const [c, setC] = useState<Composed | null>(null);
  const [model, setModel] = useState("omni-1.2-720p"); const [mode, setMode] = useState("frames-to-video"); const [dur, setDur] = useState(8);
  const [backend, setBackend] = useState("codex-local"); const [extra, setExtra] = useState(""); const [msg, setMsg] = useState("");
  const [jobs, setJobs] = useState<QJob[]>([]);
  useEffect(() => { api<Composed>(`/api/episodes/${ep}/shots/${s.key}/prompt?kind=${kind}`).then(setC); }, [ep, s.key, kind]);
  useEffect(() => { api<QJob[]>(`/api/queue?episode=${ep}`).then((l) => setJobs(l.filter((j) => j.target.shot === s.key))); }, [ep, s.key, msg]);
  const sid = (c?.refs?.[0] && "bible-in-order") || "bible-in-order";
  async function req(type: string) {
    try {
      const j = await api<QJob>(`/api/queue`, "POST", { type, episode: ep, shot: s.key, backend: type === "flow-veo" ? undefined : backend, model, mode, durationSec: dur, extra: extra || undefined });
      if (j.backend === "codex-local") { await api(`/api/queue/${j.id}/run-local`, "POST"); setMsg(`Codex로 생성 중 (약 1분): ${j.id}`); setTimeout(onChanged, 70000); }
      else setMsg(`요청됨: ${j.id}${j.needsApproval ? " (작업 큐에서 크레딧 승인 필요)" : " (Aside에 \"대기 작업 처리해\")"}`);
    } catch (e: any) { setMsg("오류: " + e.message); }
  }
  async function adopt(kindV: "keyframe" | "clip", file: string, role?: string) { await api(`/api/episodes/${ep}/shots/${s.key}/adopt`, "POST", { kind: kindV, file, role }); setMsg("채택했어요"); onChanged(); }
  const cands = [...s.keyframes.filter((k) => k.state === "candidate").map((k) => ({ ...k, kindV: "keyframe" as const })), ...s.clips.filter((k) => k.state === "candidate").map((k) => ({ ...k, role: "clip", kindV: "clip" as const }))];
  return (
    <div className="tabbody">
      {cands.length > 0 && <><h3>후보 (검증 통과, 채택 대기)</h3><div className="vers">{cands.map((v) => (
        <div key={v.file} className="ver"><img src={fileUrl(ep, v.preview)} /><div><div className="row"><b>v{v.v} {v.role}</b><span className="state alternative">후보</span></div>
          <div className="small">{v.file.split("/").slice(-2).join("/")}</div>
          <div className="iact">{v.kindV === "clip" ? <button className="primary" onClick={() => adopt("clip", v.file)}>영상 채택</button>
            : s.type === "video" ? <><button className="primary" onClick={() => adopt("keyframe", v.file, "start")}>시작 프레임으로</button><button onClick={() => adopt("keyframe", v.file, "end")}>끝 프레임으로</button></>
            : <button className="primary" onClick={() => adopt("keyframe", v.file)}>키프레임 채택</button>}</div></div></div>))}</div></>}
      <h3>조립된 프롬프트</h3>
      <div className="seg-btns"><button className={kind === "keyframe" ? "on" : ""} onClick={() => setKind("keyframe")}>키프레임</button><button className={kind === "end" ? "on" : ""} onClick={() => setKind("end")}>끝 프레임</button></div>
      {c?.warnings?.length ? <div className="warns">{c.warnings.map((w, i) => <span key={i} className="chip">{w}</span>)}</div> : null}
      {c && <pre className="composed">{c.text}</pre>}
      {c?.refs?.length ? <div className="refthumbs">{c.refs.map((r) => <figure key={r.file}><img src={`/series-files/${sid}/${r.file.split("/").map(encodeURIComponent).join("/")}`} /><figcaption>{r.asset}</figcaption></figure>)}</div> : null}
      <h3>요청</h3>
      <input placeholder="추가 지시 (선택)" value={extra} onChange={(e) => setExtra(e.target.value)} style={{ width: "100%" }} />
      <div className="iact">
        <select value={backend} onChange={(e) => setBackend(e.target.value)}><option value="codex-local">Codex (바로 실행)</option><option value="chatgpt-web">ChatGPT 웹 (Aside)</option></select>
        <button onClick={() => req("gpt-keyframe")}>키프레임 생성</button>
        <button onClick={() => req("gpt-endframe")}>끝 프레임 생성</button>
      </div>
      <div className="iact">
        <select value={model} onChange={(e) => setModel(e.target.value)}><option value="omni-1.2-720p">Omni 1.2 720p → 1080p 업스케일 (8초 24)</option><option value="omni-1.2-360p">Omni 1.2 360p 초안 → 720p (8초 8)</option><option value="veo-3.1-lite">Veo Lite (10)</option></select><input type="number" min={3} max={15} value={dur} onChange={(e) => setDur(Number(e.target.value))} style={{ width: 56 }} title="길이(초) 3~15" />
        <select value={mode} onChange={(e) => setMode(e.target.value)}><option value="frames-to-video">시작+끝 프레임</option><option value="start-only">시작 프레임만</option></select>
        <button onClick={() => req("flow-veo")}>영상 생성 요청</button>
      </div>
      <div className="small">{msg}</div>
      {jobs.length > 0 && <><h3>이 샷의 작업</h3><ul className="notes">{jobs.map((j) => <li key={j.id}><span className="small">{j.createdAt.slice(5, 16).replace("T", " ")}</span> {j.type} · {j.status}{j.failure ? ` · ${j.failure.category}` : ""}</li>)}</ul></>}
    </div>
  );
}

function Ver({ ep, pv, label, state, sub, on, onClick }: { ep: string; pv?: string; label: string; state: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <div className={"ver st-" + state + (on ? " on" : "")} onClick={onClick}>
      {pv ? <img src={fileUrl(ep, pv)} loading="lazy" /> : <div className="noimg">-</div>}
      <div><div className="row"><b>{label}</b><span className={"state " + state}>{STATE_LABEL[state] ?? state}</span></div><div className="small">{sub}</div></div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
