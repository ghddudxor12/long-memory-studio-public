import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { EpisodeData, Issue, RenderFile, QcResult, Job, Review } from "./types";
import { DEFECTS, defectLabel } from "./catalog";
import { fmt, fmt1, fileUrl, api } from "./util";

// Render review (G3): play a render, see shot boundaries, drop issues with a frame capture, run QC, start renders.
export function RenderReview({ ep, data, onChanged }: { ep: string; data: EpisodeData; onChanged: () => void }) {
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const [ref, setRef] = useState<string>("");
  const [review, setReview] = useState<Review>({ issues: [] });
  const [qc, setQc] = useState<QcResult | null>(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [draft, setDraft] = useState<{ t: number; shot?: string; tags: string[]; text: string; capture?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);

  const shots = data.timing.shots ?? {};
  const order = useMemo(() => Object.entries(shots).sort((a, b) => a[1].start - b[1].start), [shots]);
  const shotAt = useCallback((sec: number) => order.find(([, s]) => sec >= s.start && sec < s.start + s.duration)?.[0], [order]);
  const cur = renders.find((r) => r.ref === ref);
  const total = dur || data.timing.total || 1;

  const loadRenders = useCallback(() => api<RenderFile[]>(`/api/episodes/${ep}/renders`).then((l) => { setRenders(l); setRef((r) => r || l.find((x) => /final_youtube/.test(x.name))?.ref || l[0]?.ref || ""); }), [ep]);
  const loadReview = useCallback(() => api<Review>(`/api/episodes/${ep}/review`).then(setReview), [ep]);
  useEffect(() => { loadRenders(); loadReview(); }, [loadRenders, loadReview]);
  useEffect(() => { setQc(null); if (cur?.qc) api<QcResult>(`/api/episodes/${ep}/qc?ref=${encodeURIComponent(cur.ref)}`).then(setQc).catch(() => setQc(null)); }, [ep, cur?.ref, cur?.qc]);

  // poll running jobs
  useEffect(() => {
    const running = Object.values(jobs).filter((j) => j.status === "running"); if (!running.length) return;
    const h = setInterval(async () => {
      for (const j of running) { const n = await api<Job>(`/api/jobs/${j.id}`); setJobs((m) => ({ ...m, [n.id]: n })); if (n.status !== "running") { loadRenders(); } }
    }, 1500);
    return () => clearInterval(h);
  }, [jobs, loadRenders]);

  async function startRender(kind: "preview" | "final") { try { const r = await api(`/api/episodes/${ep}/render`, "POST", { kind }); setJobs((m) => ({ ...m, [r.job]: { id: r.job, kind: "render", status: "running", progress: 0, target: kind } })); } catch (e: any) { alert(e.message); } }
  async function startQc() { if (!cur) return; const r = await api(`/api/episodes/${ep}/qc`, "POST", { ref: cur.ref }); setJobs((m) => ({ ...m, [r.job]: { id: r.job, kind: "qc", status: "running", progress: 0, target: cur.ref } })); }

  function openDraft() {
    const v = vid.current; if (!v) return; v.pause();
    let capture: string | undefined;
    try { const c = document.createElement("canvas"); c.width = 640; c.height = 360; c.getContext("2d")!.drawImage(v, 0, 0, 640, 360); capture = c.toDataURL("image/jpeg", 0.82); } catch { /* ignore */ }
    setDraft({ t: v.currentTime, shot: shotAt(v.currentTime), tags: [], text: "", capture });
  }
  async function saveDraft() {
    if (!draft) return; await api(`/api/episodes/${ep}/issues`, "POST", { ...draft, render: ref }); setDraft(null); loadReview(); onChanged();
  }
  async function setStatus(i: Issue, status: Issue["status"]) { await api(`/api/episodes/${ep}/issues/${i.id}`, "PATCH", { status, resolvedRender: status === "resolved" ? ref : undefined }); loadReview(); }
  async function del(i: Issue) { if (confirm("이 지적을 지울까요?")) { await api(`/api/episodes/${ep}/issues/${i.id}`, "DELETE"); loadReview(); } }
  const seek = (sec: number) => { if (vid.current) { vid.current.currentTime = sec; vid.current.pause(); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input,select")) return;
      if (e.key === "i" || e.key === "I") { e.preventDefault(); openDraft(); }
      if (e.key === " " && vid.current) { e.preventDefault(); vid.current.paused ? vid.current.play() : vid.current.pause(); }
      if (e.key === "," && vid.current) vid.current.currentTime -= 1 / 30;
      if (e.key === "." && vid.current) vid.current.currentTime += 1 / 30;
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });

  const issues = review.issues.filter((i) => showAll || i.status !== "resolved").sort((a, b) => a.t - b.t);
  const nowShot = shotAt(t);
  const jobList = Object.values(jobs).sort((a, b) => (a.status === "running" ? -1 : 1) - (b.status === "running" ? -1 : 1));

  return (
    <div className="review">
      <div className="rv-main">
        <div className="rv-bar">
          <select value={ref} onChange={(e) => setRef(e.target.value)}>
            {renders.map((r) => <option key={r.ref} value={r.ref}>{r.where === "publish" ? "발행본" : "작업본"} · {r.name} · {(r.size / 1e6).toFixed(0)}MB · {r.mtime.slice(5, 16).replace("T", " ")}</option>)}
          </select>
          <button onClick={() => startRender("preview")}>프리뷰 렌더</button>
          <button onClick={() => startRender("final")}>최종 렌더</button>
          <button onClick={startQc} disabled={!cur}>기술 검사</button>
        </div>
        {jobList.length > 0 && <div className="jobs">{jobList.slice(0, 3).map((j) => (
          <div key={j.id} className={"job " + j.status}><span>{j.kind === "render" ? `렌더 ${j.target}` : `기술 검사`}</span>
            <div className="prog"><i style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>
            <span className="small">{j.status === "running" ? `${Math.round(j.progress * 100)}%` : j.status === "done" ? "완료" : "실패"}</span></div>))}</div>}
        <div className="player">
          {cur ? <video ref={vid} key={cur.url} src={cur.url} controls preload="auto" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} /> : <div className="noimg">렌더 파일이 없어요. 프리뷰 렌더를 눌러 주세요.</div>}
        </div>
        <div className="nowbar">
          <span className="tc">{fmt1(t)}</span>
          <span><b>{nowShot ?? "타이틀"}</b> {nowShot ? data.production?.shots.find((s) => s.key === nowShot)?.title : ""}</span>
          <button className="primary" onClick={openDraft} disabled={!cur}>지적 추가 (I)</button>
          <span className="small">Space 재생/정지 · , . 한 프레임</span>
        </div>
        <Timeline order={order} total={total} t={t} issues={review.issues} lum={qc?.luminance} onSeek={seek} />
        {draft && <div className="draft">
          {draft.capture && <img src={draft.capture} />}
          <div className="dbody">
            <div className="row"><b>{fmt1(draft.t)} · {draft.shot ?? "타이틀"}</b><button onClick={() => setDraft(null)}>취소</button></div>
            <div className="chips edit">{DEFECTS.map((d) => <label key={d.id} className={"chip" + (draft.tags.includes(d.id) ? " on" : "")}><input type="checkbox" checked={draft.tags.includes(d.id)} onChange={(e) => setDraft({ ...draft, tags: e.target.checked ? [...draft.tags, d.id] : draft.tags.filter((x) => x !== d.id) })} />{d.label}</label>)}</div>
            <textarea autoFocus placeholder="무엇이 문제인지 (예: 손가락 모양 이상)" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <div className="row"><span className="small">태그를 고르면 해당 샷 상태가 "수정 필요"로 바뀌고 샷 보드에 결함이 표시돼요.</span><button className="primary" onClick={saveDraft}>저장</button></div>
          </div>
        </div>}
        {qc && <Qc qc={qc} onSeek={seek} />}
      </div>
      <aside className="rv-side">
        <div className="row"><h3>지적 {review.issues.filter((i) => i.status !== "resolved").length}건 열림</h3><label className="small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 해결 포함</label></div>
        {issues.length === 0 && <p className="small">아직 지적이 없어요. 영상을 보다가 I를 누르세요.</p>}
        {issues.map((i) => (
          <div key={i.id} className={"issue " + i.status}>
            {i.capture ? <img src={fileUrl(ep, i.capture)} onClick={() => seek(i.t)} /> : <div className="noimg" onClick={() => seek(i.t)}>-</div>}
            <div>
              <div className="row"><a onClick={() => seek(i.t)}><b>{fmt1(i.t)}</b> {i.shot}</a><span className={"state " + (i.status === "resolved" ? "adopted" : i.status === "doing" ? "alternative" : "rejected")}>{i.status === "resolved" ? "해결" : i.status === "doing" ? "처리중" : "열림"}</span></div>
              {i.tags.length > 0 && <div className="chips">{i.tags.map((x) => <span key={x} className="chip">{defectLabel(x)}</span>)}</div>}
              {i.text && <div className="itext">{i.text}</div>}
              <div className="iact">
                {i.status !== "doing" && i.status !== "resolved" && <button onClick={() => setStatus(i, "doing")}>처리중</button>}
                {i.status !== "resolved" ? <button onClick={() => setStatus(i, "resolved")}>해결</button> : <button onClick={() => setStatus(i, "open")}>다시 열기</button>}
                <button onClick={() => del(i)}>삭제</button>
                <span className="small">{i.render.split("/").pop()}</span>
              </div>
            </div>
          </div>))}
      </aside>
    </div>
  );
}

function Timeline({ order, total, t, issues, lum, onSeek }: { order: [string, { start: number; duration: number }][]; total: number; t: number; issues: Issue[]; lum?: { fps: number; values: number[] }; onSeek: (s: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cvs.current; if (!c || !lum) return; const w = c.width = c.clientWidth * 2, h = c.height = 64; const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h); g.fillStyle = "#9e9e9e"; const n = lum.values.length;
    for (let x = 0; x < w; x++) { const i = Math.floor((x / w) * n); const v = lum.values[i] / 255; g.fillRect(x, h - v * h, 1, v * h); }
  }, [lum]);
  const click = (e: React.MouseEvent) => { const r = bar.current!.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * total); };
  return (
    <div className="timeline" ref={bar} onClick={click}>
      {lum && <canvas ref={cvs} className="lum" />}
      <div className="shots">{order.map(([k, s], i) => <div key={k} className={"seg" + (i % 2 ? " alt" : "")} style={{ left: `${(s.start / total) * 100}%`, width: `${(s.duration / total) * 100}%` }} title={`${k} ${fmt(s.start)}`}><span>{k.slice(1)}</span></div>)}</div>
      {issues.map((i) => <div key={i.id} className={"mark " + i.status} style={{ left: `${(i.t / total) * 100}%` }} title={`${fmt1(i.t)} ${i.text}`} />)}
      <div className="head" style={{ left: `${(t / total) * 100}%` }} />
    </div>
  );
}

function Qc({ qc, onSeek }: { qc: QcResult; onSeek: (s: number) => void }) {
  return (
    <div className="qc">
      <div className="row"><h3>기술 검사 {qc.ok ? <span className="state adopted">통과</span> : <span className="state rejected">문제 있음</span>}</h3><span className="small">{qc.at.slice(0, 16).replace("T", " ")} · {qc.seconds}s</span></div>
      {qc.checks.map((c) => (
        <div key={c.id} className="qrow">
          <span className={"state " + (c.ok ? "adopted" : "rejected")}>{c.ok ? "OK" : "확인"}</span>
          <div><b>{c.label}</b> <span className="small">{c.detail}</span>
            {c.items?.length > 0 && <div className="qitems">{c.items.slice(0, 12).map((it: any, i: number) => (
              <a key={i} onClick={() => it.t != null ? onSeek(it.t) : it.from != null ? onSeek(it.from) : undefined}>
                {it.t != null ? `${fmt1(it.t)} ${it.key} (밝기 ${it.min}, 주변 ${it.around})` : it.from != null ? `${fmt1(it.from)}~${fmt1(it.to)}` : `#${it.cue} ${it.issue}: ${it.text}`}</a>))}</div>}
          </div>
        </div>))}
    </div>
  );
}
