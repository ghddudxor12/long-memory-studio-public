import { useEffect, useState } from "react";
import { api } from "./util";

// Promo shorts list (read-mostly: Aside creates and builds shorts through the API and scripts).
type Step = { n: number; key: string; label: string; who: string; done: boolean };
type Short = {
  id: string; episode: string; hook: string; durationSec: number | null; stale: boolean; problems: string[]; warnings: string[];
  steps: Step[]; current: Step | null; how: string[]; upload: { title?: string; relatedVideo?: string };
  state: { review?: { by: string; at: string; note: string }; youtube?: { videoId?: string; privacy?: string; relatedLinked?: boolean } };
  files: { video: string | null; sheet: string | null }; builtAt: string | null; error?: string;
};
const WHO: Record<string, string> = { aside: "Aside", user: "사용자", worker: "작업기" };
const kst = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

export function ShortsView({ episodes }: { episodes?: string[] }) {
  const [rows, setRows] = useState<Short[]>([]); const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { api<Short[]>("/api/shorts").then((l) => setRows(episodes ? l.filter((r) => episodes.includes(r.episode)) : l)); }, [episodes?.join()]);
  const cur = rows.find((r) => r.id === sel) || null;
  return (
    <div className="ledger">
      <div className="kfr-bar"><b>숏폼 (쇼츠·릴스)</b><span className="small">{rows.length}편 · 롱폼의 기존 소재로 만든 1080x1920 홍보 영상</span></div>
      <table className="tbl"><thead><tr><th>쇼츠</th><th>훅</th><th>길이</th><th>단계</th><th>다음</th><th>YouTube</th><th>빌드</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} onClick={() => setSel(r.id === sel ? null : r.id)} className={r.id === sel ? "on" : ""}>
          <td><b>{r.id}</b></td>
          <td>{r.error ? <span className="blocked">{r.error}</span> : r.hook}</td>
          <td className="small">{r.durationSec ? `${r.durationSec.toFixed(1)}s` : "-"}</td>
          <td><div className="prog"><i style={{ width: `${((r.steps?.filter((s) => s.done).length || 0) / 6) * 100}%` }} /></div><span className="small">{r.current ? `${r.current.n} ${r.current.label}` : "완료"}{r.stale ? " · 설정 변경됨(재빌드)" : ""}</span>{r.problems?.length ? <div className="small blocked">{r.problems[0]}</div> : null}</td>
          <td className="small">{r.current ? WHO[r.current.who] ?? r.current.who : "-"}</td>
          <td className="small">{r.state?.youtube?.videoId ? <a href={`https://youtu.be/${r.state.youtube.videoId}`} target="_blank" onClick={(e) => e.stopPropagation()}>{r.state.youtube.privacy || "업로드됨"}</a> : "-"}</td>
          <td className="small">{kst(r.builtAt)}</td></tr>)}</tbody></table>
      {cur && <section className="panelbox" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {cur.files.video ? <video src={cur.files.video} controls style={{ width: 300, height: 533, background: "#000" }} /> : <div className="small" style={{ width: 300 }}>아직 빌드 전</div>}
        <div style={{ flex: 1 }}>
          <h3>{cur.id}</h3>
          <p className="small">업로드 제목: {cur.upload.title || "-"} · 연결할 롱폼: {cur.upload.relatedVideo ? <a href={`https://youtu.be/${cur.upload.relatedVideo}`} target="_blank">{cur.upload.relatedVideo}</a> : "-"}</p>
          <ol className="notes">{cur.steps.map((s) => <li key={s.key}>{s.done ? "✓" : "·"} {s.label} <span className="small">({WHO[s.who] ?? s.who})</span></li>)}</ol>
          {cur.how?.length ? <><h3>다음 방법 (AI 기준)</h3><ul className="notes">{cur.how.map((h, i) => <li key={i} className="small">{h}</li>)}</ul></> : null}
          {cur.warnings?.length ? <><h3>빌드 경고</h3><ul className="notes">{cur.warnings.map((w, i) => <li key={i} className="small">{w}</li>)}</ul></> : null}
          {cur.state.review ? <p className="small">검수: {cur.state.review.by} · {kst(cur.state.review.at)} · {cur.state.review.note}</p> : null}
          {cur.files.sheet ? <p className="small"><a href={cur.files.sheet} target="_blank">프레임 검수 시트 열기</a></p> : null}
        </div>
      </section>}
      <p className="small">쇼츠는 Aside가 만들어요: GET /api/episodes/:id/short-candidates → short.json → POST /api/shorts/:id/build. 공개 전환만 사용자 확인이 필요해요.</p>
    </div>
  );
}
