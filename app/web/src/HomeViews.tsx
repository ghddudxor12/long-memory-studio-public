import { useEffect, useState, useCallback } from "react";
import { api, fmt } from "./util";

type Blocker = { reason: string; until?: string | null; auto?: boolean };
type Stage = { n: number; key: string; label: string; done: boolean; detail: string; who: string; blocked?: Blocker };
type Approval = { at: string; by: string; note?: string; delegatedBy?: string };
const kst = (iso?: string | null) => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
type StagesResp = { stages: Stage[]; current: Stage | null; openIssues: number };
type LedgerRow = { id: string; seriesFolder: string; ep: number | null; epLabel?: string | null; blocked?: Blocker | null; scheduledPublish?: string | null; title: string; enTitle: string; stage: string; next: string | null; done: number; youtube: { videoId: string; privacy: string } | null; public: boolean; uploadedAt: string | null; flowCredits: number; length: number | null; error?: string };
const WHO: Record<string, string> = { user: "사용자", aside: "Aside", worker: "앱(워커)" };
const VIEW_OF: Record<string, string> = { script: "narration", narration: "narration", shots: "board", keyframes: "board", "kf-review": "kf", video: "queue", edit: "render", review: "render", package: "package", upload: "package", archive: "archive" };

// Episode home: 12 steps with automatic completion checks, gates, next action
export function HomeView({ ep, go, onChanged }: { ep: string; go: (v: any) => void; onChanged: () => void }) {
  const [s, setS] = useState<StagesResp | null>(null);
  const [log, setLog] = useState<{ at: string; by: string; text: string }[]>([]);
  const [appr, setAppr] = useState<Record<string, Approval>>({});
  const load = useCallback(() => { api<StagesResp>(`/api/episodes/${ep}/stages`).then(setS); api<any>(`/api/episodes/${ep}`).then((d) => { setLog((d.production?.log || []).slice(-12).reverse()); setAppr(d.production?.approvals || {}); }); }, [ep]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <p className="small">불러오는 중…</p>;
  const gate = async (g: string, revoke = false) => { await api(`/api/episodes/${ep}/approve`, "POST", { gate: g, revoke, by: "user" }); load(); onChanged(); };
  return (
    <div className="home">
      <div className="steps">{s.stages.map((x) => (
        <div key={x.n} className={"step" + (x.done ? " done" : "") + (s.current?.n === x.n ? " cur" : "")} onClick={() => VIEW_OF[x.key] && go(VIEW_OF[x.key])}>
          <div className="sn">{x.done ? "✓" : x.n}</div><div><b>{x.label}</b><div className="small">{x.detail}</div></div>
        </div>))}</div>
      <div className="home-grid">
        <section className="panelbox">
          <h3>다음 할 일</h3>
          {s.current ? <><p><b>{s.current.n}. {s.current.label}</b> · 담당 {WHO[s.current.who] ?? s.current.who}</p><p className="small">{s.current.detail}</p>
            {s.current.blocked && <p className="blocked">막힘: {s.current.blocked.reason}{s.current.blocked.until ? ` · ${kst(s.current.blocked.until)} 이후 가능` : ""}</p>}
            {VIEW_OF[s.current.key] && <button className="primary" onClick={() => go(VIEW_OF[s.current!.key])}>해당 화면으로</button>}</> : <p>모든 단계 완료</p>}
        </section>
        <section className="panelbox">
          <h3>승인</h3>
          {[["G1", "대본"], ["G2", "키프레임 (Flow 크레딧 사용 전)"], ["G3", "최종본"]].map(([g, l]) => {
            const done = s.stages.find((x) => (g === "G1" ? x.key === "script" : g === "G2" ? x.key === "kf-review" : x.key === "review"))?.detail.includes(g === "G2" ? "승인" : `${g} 승인`);
            return <div key={g} className="row gate"><span><b>{g}</b> {l}</span>{done ? <span className="row"><span className="state adopted">승인됨</span>{appr[g] && <span className="small" title={appr[g].note}>{appr[g].by === "aside" ? "Aside (사용자 위임)" : "사용자"} · {appr[g].at.slice(5, 10)}</span>}<button onClick={() => gate(g, true)}>취소</button></span> : <button className="primary" onClick={() => gate(g)}>승인</button>}</div>;
          })}
        </section>
        <section className="panelbox wide2">
          <h3>최근 기록</h3>
          <ul className="notes">{log.map((l, i) => <li key={i}><span className="small">{l.at.slice(5, 16).replace("T", " ")} · {l.by}</span> {l.text}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}

// Ledger: all series/episodes, current step, YouTube state, release queue, CSV export
export function LedgerView({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<LedgerRow[]>([]); const [f, setF] = useState("all");
  const [next, setNext] = useState<{ epLabel: string; step: string; who: string; detail?: string; blocked?: Blocker | null; how?: string[] }[]>([]);
  const [quota, setQuota] = useState<{ limit: number; used: number; remaining: number; nextAt: string | null } | null>(null);
  useEffect(() => { api<LedgerRow[]>(`/api/ledger`).then(setRows); api<any>(`/api/upload-quota`).then(setQuota); api<any>(`/api/next`).then((n) => setNext(n.actions || [])); }, []);
  const list = rows.filter((r) => f === "all" || (f === "release" ? !!r.youtube && !r.public && r.done >= 10 : f === "progress" ? !r.youtube : r.public));
  return (
    <div className="ledger">
      <div className="kfr-bar"><b>에피소드 대장</b><span className="small">{rows.length}편</span>
        {[["all", "전체"], ["progress", "제작 중"], ["release", "공개 대기"], ["public", "공개됨"]].map(([v, l]) => <button key={v} className={f === v ? "on" : ""} onClick={() => setF(v)}>{l}</button>)}
        <span className="spacer" />{quota && <span className={"small" + (quota.remaining ? "" : " blocked")} title="최근 24시간 YouTube 업로드 (하루 최대 10편)">업로드 {quota.used}/{quota.limit}{quota.nextAt ? ` · 다음 가능 ${kst(quota.nextAt)}` : ` · ${quota.remaining}편 더 가능`}</span>}<a href="/api/ledger.csv" download="에피소드_대장.csv"><button>CSV 내보내기</button></a></div>
      {next.length > 0 && <section className="panelbox next-all"><h3>다음 할 일 (전체, AI 기준)</h3><ul className="notes">{next.map((a, i) => <li key={i} title={(a.how || []).join("\n")}><b>{a.epLabel}</b> · {a.step} · {WHO[a.who] ?? a.who}{a.blocked ? <span className="blocked"> · 막힘: {a.blocked.reason}{a.blocked.until ? ` (${kst(a.blocked.until)} 이후)` : ""}</span> : a.detail ? <span className="small"> · {a.detail}</span> : null}</li>)}</ul><p className="small">Aside는 새 작업을 시작할 때 GET /api/agent/brief로 이 목록과 규칙을 함께 읽어요. 항목에 마우스를 올리면 방법이 보여요.</p></section>}
      <table className="tbl"><thead><tr><th>EP</th><th>시리즈</th><th>제목</th><th>현재 단계</th><th>다음</th><th>YouTube</th><th>길이</th><th>Flow</th></tr></thead>
        <tbody>{list.map((r) => <tr key={r.id} onClick={() => onOpen(r.id)}>
          <td>{r.epLabel || (r.ep != null ? `EP${String(r.ep).padStart(3, "0")}` : "-")}</td><td className="small">{r.seriesFolder}</td>
          <td><b>{r.title}</b><div className="small">{r.id} · {r.enTitle}</div></td>
          <td><div className="prog"><i style={{ width: `${(r.done / 12) * 100}%` }} /></div><span className="small">{r.stage}</span>{r.blocked && <div className="small blocked" title={r.blocked.until ? kst(r.blocked.until) + " 이후 가능" : ""}>막힘: {r.blocked.reason}</div>}</td>
          <td className="small">{r.next ? WHO[r.next] : "-"}</td>
          <td>{r.youtube ? <a href={`https://youtu.be/${r.youtube.videoId}`} target="_blank" onClick={(e) => e.stopPropagation()}>{r.public ? "공개" : r.scheduledPublish ? `예약 ${kst(r.scheduledPublish)}` : r.youtube.privacy}</a> : <span className="small">-</span>}</td>
          <td className="small">{r.length ? fmt(r.length) : "-"}</td><td className="small">{r.flowCredits || "-"}</td></tr>)}</tbody></table>
      <p className="small">예약 시각은 한국 시간이에요 (YouTube에는 뉴욕 06:00으로 예약). 공개 대기 = 패키지까지 끝났고 아직 비공개인 편. 공개는 EP 순서대로 몰아서 해요. CSV는 Drive의 에피소드_대장 시트에 붙여 넣거나 Aside에 갱신을 맡기면 돼요.</p>
    </div>
  );
}
