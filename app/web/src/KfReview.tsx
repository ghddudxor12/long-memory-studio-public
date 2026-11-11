import { useMemo, useState } from "react";
import type { EpisodeData, Shot, KfReview as KR } from "./types";
import { DEFECTS, defectLabel } from "./catalog";
import { fileUrl, api } from "./util";

// Keyframe review (G2): before spending Flow credits, check every shot's adopted frames against the checklist.
const CHECK = ["face-profile", "hand-deformed", "sun-disc", "fish-cutaway", "roots-exposed", "sash", "land-animals", "apple", "text-in-image", "duplicate-composition", "style-mismatch"];
const RESULT: Record<KR["result"], string> = { pass: "통과", redo: "재생성 필요", exception: "예외 승인" };

function frames(s: Shot) {
  const ad = s.keyframes.filter((k) => k.state === "adopted");
  const start = ad.find((k) => k.role.startsWith("start")) || ad.find((k) => k.role === "render") || ad[0];
  const end = ad.find((k) => k.role === "end");
  return { start, end };
}

export function KfReview({ ep, data, onChanged }: { ep: string; data: EpisodeData; onChanged: () => void }) {
  const shots = data.production?.shots ?? [];
  const [page, setPage] = useState(0);
  const [only, setOnly] = useState<"all" | "todo" | "redo">("all");
  const list = useMemo(() => shots.filter((s) => only === "all" || (only === "todo" ? !s.kfReview : s.kfReview?.result === "redo")), [shots, only]);
  const per = 4; const pages = Math.max(1, Math.ceil(list.length / per)); const cur = list.slice(page * per, page * per + per);
  const done = shots.filter((s) => s.kfReview).length; const redo = shots.filter((s) => s.kfReview?.result === "redo").length;
  const g2 = data.production?.approvals?.G2;

  async function approve(revoke = false) { await api(`/api/episodes/${ep}/approve`, "POST", { gate: "G2", note: revoke ? undefined : `키프레임 ${done}/${shots.length} 검수`, revoke }); onChanged(); }

  return (
    <div className="kfr">
      <div className="kfr-bar">
        <b>키프레임 검수 (G2)</b>
        <span className="small">검수 {done}/{shots.length} · 재생성 필요 {redo}</span>
        <div className="prog wide"><i style={{ width: `${(done / Math.max(1, shots.length)) * 100}%` }} /></div>
        {[["all", "전체"], ["todo", "미검수"], ["redo", "재생성 필요"]].map(([v, l]) => <button key={v} className={only === v ? "on" : ""} onClick={() => { setOnly(v as any); setPage(0); }}>{l}</button>)}
        <button onClick={async () => { const j = await api<{ id: string }>(`/api/queue`, "POST", { type: "ai-review", episode: ep }); alert(`AI 사전 검수 요청: ${j.id}\nAside에 "대기 작업 처리해"라고 하면 판독 결과가 카드에 붙어요.`); }}>AI 사전 검수 요청</button>
        <span className="spacer" />
        {g2 ? <><span className="state adopted">G2 승인 {g2.at.slice(0, 10)}</span><button onClick={() => approve(true)}>승인 취소</button></>
          : <button className="primary" disabled={done < shots.length || redo > 0} title="모든 샷 검수 완료 + 재생성 필요 0건일 때" onClick={() => approve()}>G2 승인 (Flow 진행)</button>}
      </div>
      <div className="kfr-grid">
        {cur.map((s) => <KfCard key={s.key} ep={ep} s={s} onSaved={onChanged} />)}
      </div>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>이전 4컷</button>
        <span className="small">{page + 1} / {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음 4컷</button>
      </div>
    </div>
  );
}

function KfCard({ ep, s, onSaved }: { ep: string; s: Shot; onSaved: () => void }) {
  const { start, end } = frames(s);
  const [tags, setTags] = useState<string[]>(s.kfReview?.tags ?? []);
  const [note, setNote] = useState(s.kfReview?.note ?? "");
  const [big, setBig] = useState<string | null>(null);
  async function save(result: KR["result"]) { await api(`/api/episodes/${ep}/shots/${s.key}`, "PATCH", { kfReview: { result, tags, note }, ...(result === "redo" ? { status: "fix", defects: [...new Set([...s.defects, ...tags])] } : {}) }); onSaved(); }
  return (
    <div className={"kfcard" + (s.kfReview ? " r-" + s.kfReview.result : "")}>
      <div className="row"><div><b>{s.key}</b> {s.title} <span className="small">· {s.type === "video" ? "영상 (하이라이트)" : "이미지"}</span></div>
        {s.kfReview && <span className={"state " + (s.kfReview.result === "pass" ? "adopted" : s.kfReview.result === "redo" ? "rejected" : "alternative")}>{RESULT[s.kfReview.result]}</span>}</div>
      <div className={"frames" + (end ? " two" : "")}>
        {start ? <figure onClick={() => setBig(start.file)}><img src={fileUrl(ep, start.file)} loading="lazy" /><figcaption>{end ? "시작" : "키프레임"}</figcaption></figure> : <div className="noimg">키프레임 없음</div>}
        {end && <figure onClick={() => setBig(end.file)}><img src={fileUrl(ep, end.file)} loading="lazy" /><figcaption>끝</figcaption></figure>}
      </div>
      {s.aiReview && <div className="ai"><span className="small">AI 제안{s.aiReview.confidence != null ? ` (${Math.round(s.aiReview.confidence * 100)}%)` : ""}:</span> {s.aiReview.tags.length ? s.aiReview.tags.map((t) => <span key={t} className="chip">{defectLabel(t)}</span>) : <span className="state adopted">문제 없음</span>} {s.aiReview.notes && <span className="small">{s.aiReview.notes}</span>}
        {s.aiReview.tags.length > 0 && <button onClick={() => setTags([...new Set([...tags, ...s.aiReview!.tags])])}>제안 반영</button>}</div>}
      <p className="desc">{s.prompts.visual}</p>
      <div className="chips edit">{CHECK.map((id) => <label key={id} className={"chip" + (tags.includes(id) ? " on" : "")} title={DEFECTS.find((d) => d.id === id)?.fix}>
        <input type="checkbox" checked={tags.includes(id)} onChange={(e) => setTags(e.target.checked ? [...tags, id] : tags.filter((x) => x !== id))} />{defectLabel(id)}</label>)}</div>
      <input className="knote" placeholder="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row acts">
        <button onClick={() => save("pass")} className={s.kfReview?.result === "pass" ? "on" : ""}>통과</button>
        <button onClick={() => save("redo")} className={s.kfReview?.result === "redo" ? "on" : ""}>재생성 필요</button>
        <button onClick={() => save("exception")} className={s.kfReview?.result === "exception" ? "on" : ""}>예외 승인</button>
      </div>
      {big && <div className="lightbox" onClick={() => setBig(null)}><img src={fileUrl(ep, big)} /></div>}
    </div>
  );
}
