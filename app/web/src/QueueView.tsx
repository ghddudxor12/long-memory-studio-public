import { useEffect, useState, useCallback } from "react";
import type { QJob } from "./types";
import { api } from "./util";

const TYPE_LABEL: Record<string, string> = { "gpt-keyframe": "키프레임", "gpt-endframe": "끝 프레임", "gpt-asset": "에셋 이미지", "flow-veo": "Flow 영상", "ai-review": "AI 사전 검수" };
const STATUS: Record<string, [string, string]> = { queued: ["대기", ""], approved: ["승인됨", "alternative"], running: ["진행 중", "alternative"], done: ["완료", "adopted"], failed: ["실패", "rejected"], cancelled: ["취소", ""] };
const FAIL_LABEL: Record<string, string> = { "credits-insufficient": "크레딧 부족", quota: "일일 한도", "policy-refused": "정책 거부", "ui-changed": "화면 변경", timeout: "시간 초과", "validation-failed": "검증 실패", cancelled: "취소", other: "기타" };

// Job queue: what Aside should do next, what needs approval (credits), what failed and why
export function QueueView({ ep }: { ep: string }) {
  const [jobs, setJobs] = useState<QJob[]>([]);
  const [filter, setFilter] = useState("open");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<QJob[]>(`/api/queue`).then(setJobs), []);
  useEffect(() => { load(); const h = setInterval(load, 5000); return () => clearInterval(h); }, [load]);
  const list = jobs.filter((j) => (filter === "open" ? ["queued", "approved", "running"].includes(j.status) : filter === "all" ? true : j.status === filter) && (!j.episode || j.episode === ep));
  const spent = jobs.filter((j) => j.episode === ep && j.type === "flow-veo" && j.status === "done").reduce((a, j) => a + (j.credits.actual ?? j.credits.estimated), 0);
  const pending = jobs.filter((j) => j.episode === ep && j.type === "flow-veo" && ["queued", "approved", "running"].includes(j.status)).reduce((a, j) => a + j.credits.estimated, 0);
  const act = async (j: QJob, a: string) => { await api(`/api/queue/${j.id}/${a}`, "POST", { by: "user" }); load(); };
  return (
    <div className="queue">
      <div className="kfr-bar">
        <b>작업 큐</b>
        <span className="small">이 에피소드 Flow 크레딧: 사용 {spent} · 대기 {pending}</span>
        {[["open", "진행 대기"], ["failed", "실패"], ["done", "완료"], ["all", "전체"]].map(([v, l]) => <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>)}
        <span className="spacer" />
        <span className="small">Aside에 "대기 작업 처리해"라고 하면 승인된 작업부터 처리해요</span>
      </div>
      {list.length === 0 && <p className="small">작업이 없어요. 샷 패널의 "생성" 탭이나 시리즈 에셋에서 요청하세요.</p>}
      <div className="jobs-list">
        {list.map((j) => {
          const [sl, sc] = STATUS[j.status];
          return (
            <div key={j.id} className="jobrow">
              <div className="row" onClick={() => setOpen(open === j.id ? null : j.id)} style={{ cursor: "pointer" }}>
                <div><b>{TYPE_LABEL[j.type] ?? j.type}</b> · {j.target.shot || j.target.asset || `${j.target.shots?.length}샷`} <span className="small">· {j.backend}{j.input?.model ? ` · ${j.input.model} ${j.input.mode}` : ""} · {j.createdAt.slice(5, 16).replace("T", " ")}</span></div>
                <div className="row">
                  {j.type === "flow-veo" && <span className="small">{j.credits.actual ?? j.credits.estimated} 크레딧</span>}
                  {j.failure && <span className="state rejected">{FAIL_LABEL[j.failure.category] ?? j.failure.category}</span>}
                  <span className={"state " + sc}>{sl}</span>
                  {j.needsApproval && !j.approvedAt && j.status === "queued" && <button className="primary" onClick={(e) => { e.stopPropagation(); act(j, "approve"); }}>크레딧 사용 승인</button>}
                  {j.backend === "codex-local" && j.status === "queued" && <button className="primary" onClick={async (e) => { e.stopPropagation(); await api(`/api/queue/${j.id}/run-local`, "POST"); load(); }}>Codex로 실행</button>}
                  {["queued", "approved"].includes(j.status) && <button onClick={(e) => { e.stopPropagation(); act(j, "cancel"); }}>취소</button>}
                </div>
              </div>
              {j.input?.warnings?.length > 0 && <div className="warns">{j.input.warnings.map((w: string, i: number) => <span key={i} className="chip">{w}</span>)}</div>}
              {j.failure && <div className="small fail">{j.failure.message}</div>}
              {open === j.id && <div className="jobdetail">
                {j.input?.prompt && <><h3>고정된 입력 (프롬프트)</h3><pre>{j.input.prompt}</pre></>}
                {(j.input?.refs?.length > 0 || j.input?.start) && <><h3>참조</h3><div className="small">{[...(j.input.refs || []).map((r: any) => `${r.file} (${(r.sha256 || "").slice(0, 8)})`), j.input.start && `시작: ${j.input.start.file}`, j.input.end && `끝: ${j.input.end.file}`].filter(Boolean).join(" · ")}</div></>}
                {j.output && <><h3>저장 위치</h3><div className="small">{j.output.dir}/{j.output.name}</div></>}
                {j.result?.files && <><h3>검증</h3><div className="small">{j.result.files.map((f: any) => `${f.file}: ${f.checks.map((c: any) => `${c.id} ${c.ok ? "OK" : "✗ " + c.detail}`).join(", ")}`).join(" / ")}</div></>}
                <h3>기록</h3><div className="small">{j.history.map((h) => `${h.at.slice(11, 16)} ${h.status} (${h.by})${h.message ? " " + h.message : ""}`).join(" → ")}</div>
              </div>}
            </div>);
        })}
      </div>
    </div>
  );
}
