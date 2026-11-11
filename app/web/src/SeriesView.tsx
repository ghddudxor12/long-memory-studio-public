import { useEffect, useState, useCallback } from "react";
import type { Series, SeriesAsset } from "./types";
import { api } from "./util";

// Series style + assets (Storyboard Studio "custom style" + "Assets", kept per series and reused by every episode)
const seriesFile = (sid: string, rel?: string) => (rel ? `/series-files/${sid}/${rel.split("/").map(encodeURIComponent).join("/")}` : "");
const TYPE_LABEL: Record<string, string> = { character: "캐릭터", location: "장소", prop: "소품" };

export function SeriesView({ sid }: { sid: string }) {
  const [s, setS] = useState<Series | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "series" | "episode">("all");
  const [epF, setEpF] = useState("all"); const [tagF, setTagF] = useState(""); const [typeF, setTypeF] = useState("all"); const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<Series>(`/api/series/${sid}`).then(setS), [sid]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <p className="small">불러오는 중…</p>;
  const eps = s.episodes || [];
  const epLabel = (id: string) => { const e = eps.find((x) => x.id === id); return e?.ep != null ? `EP${String(e.ep).padStart(3, "0")}` : id; };
  const allTags = [...new Set(s.assets.flatMap((a) => a.tags || []))].sort();
  const assets = s.assets.filter((a) => (scope === "all" || a.scope === scope) && (typeF === "all" || a.type === typeF)
    && (epF === "all" || (epF === "none" ? !(a.usedIn || []).length : (a.usedIn || []).includes(epF)))
    && (!tagF || (a.tags || []).includes(tagF)) && (!q || `${a.name} ${a.description} ${(a.tags || []).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const asset = s.assets.find((a) => a.id === sel) || null;

  return (
    <div className="series">
      <section className="style-card">
        <div className="row"><h2>{s.name} <small>스타일 "{s.style.name}" · 시리즈 v{s.version}</small></h2><span className="small">{msg}</span></div>
        <StyleEditor s={s} onSaved={(m) => { setMsg(m); load(); }} />
      </section>
      <section>
        <div className="row"><h2>규칙 <small>{s.rules.length}개 · 키프레임·영상 프롬프트에 자동으로 붙어요</small></h2></div>
        <div className="rules">{s.rules.map((r) => <div key={r.id} className="rule"><b>{r.id}</b><div>{r.text}</div>{r.prompt && <code>{r.prompt}</code>}</div>)}</div>
      </section>
      <section>
        <div className="row"><h2>에셋 <small>{assets.length} / {s.assets.length}개 · 잠긴 에셋은 모든 에피소드에서 같은 기준 이미지를 써요</small></h2>
          <NewAsset sid={sid} onCreated={(id) => { load(); setSel(id); }} />
        </div>
        <div className="asset-filters">
          <select value={epF} onChange={(e) => setEpF(e.target.value)}>
            <option value="all">회차 전체</option>
            {eps.map((e) => <option key={e.id} value={e.id}>{e.label} ({s.assets.filter((a) => (a.usedIn || []).includes(e.id)).length})</option>)}
            <option value="none">아직 안 쓰인 에셋 ({s.assets.filter((a) => !(a.usedIn || []).length).length})</option>
          </select>
          <select value={tagF} onChange={(e) => setTagF(e.target.value)}><option value="">태그 전체</option>{allTags.map((t) => <option key={t} value={t}>#{t} ({s.assets.filter((a) => (a.tags || []).includes(t)).length})</option>)}</select>
          <div className="seg-btns">{[["all", "전체"], ["character", "캐릭터"], ["location", "장소"], ["prop", "소품"]].map(([v, l]) => <button key={v} className={typeF === v ? "on" : ""} onClick={() => setTypeF(v)}>{l}</button>)}</div>
          <div className="seg-btns">{[["all", "범위 전체"], ["series", "시리즈 공통"], ["episode", "에피소드 전용"]].map(([v, l]) => <button key={v} className={scope === v ? "on" : ""} onClick={() => setScope(v as any)}>{l}</button>)}</div>
          <input placeholder="이름·설명·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(["character", "location", "prop"] as const).map((t) => assets.some((a) => a.type === t) && (
          <div key={t}><h3 className="sub">{TYPE_LABEL[t]}</h3>
            <div className="grid">{assets.filter((a) => a.type === t).map((a) => {
              const ref = a.refs.find((r) => r.state === "adopted") || a.refs.at(-1);
              const cand = a.refs.filter((r) => r.state === "candidate").length;
              return (
                <div key={a.id} className={"card" + (sel === a.id ? " on" : "")} onClick={() => setSel(a.id)}>
                  <div className="thumb">{ref ? <img src={seriesFile(sid, ref.file)} loading="lazy" /> : <div className="noimg">기준 이미지 없음</div>}
                    <span className="badge">{a.scope === "series" ? "시리즈 공통" : "에피소드"}</span>{a.locked && <span className="time">잠김</span>}</div>
                  <div className="body"><div className="row"><b>{a.name}</b>{cand > 0 && <span className="status st-review">후보 {cand}</span>}</div>
                    <div className="small clamp">{a.description}</div>
                    <div className="chips">{(a.usedIn || []).map((e) => <span key={e} className="status">{epLabel(e)}</span>)}{(a.tags || []).map((t) => <span key={t} className="status">#{t}</span>)}</div></div>
                </div>);
            })}</div></div>))}
      </section>
      {asset && <AssetPanel sid={sid} s={s} a={asset} epLabel={epLabel} onClose={() => setSel(null)} onSaved={load} />}
    </div>
  );
}

function StyleEditor({ s, onSaved }: { s: Series; onSaved: (m: string) => void }) {
  const [prompt, setPrompt] = useState(s.style.prompt); const [suffix, setSuffix] = useState(s.style.gptSuffix || ""); const [tpl, setTpl] = useState(s.promptTemplate);
  const dirty = prompt !== s.style.prompt || suffix !== (s.style.gptSuffix || "") || tpl !== s.promptTemplate;
  async function save() { await api(`/api/series/${s.id}`, "PATCH", { style: { prompt, gptSuffix: suffix }, promptTemplate: tpl }); onSaved("저장됨 (시리즈 버전이 올라가요)"); }
  return (
    <div className="style-grid">
      <label>스타일 설명 (Studio 커스텀 스타일)<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} /></label>
      <label>GPT 이미지 스타일 꼬리말 (모든 이미지 프롬프트 끝에 붙음)<textarea value={suffix} onChange={(e) => setSuffix(e.target.value)} rows={4} /></label>
      <label>프롬프트 틀 <span className="small">{"{shot} {assets} {rules} {style}"}</span><textarea value={tpl} onChange={(e) => setTpl(e.target.value)} rows={3} /></label>
      <div className="row">{s.style.note && <span className="small">{s.style.note}</span>}<button className="primary" disabled={!dirty} onClick={save}>스타일 저장</button></div>
    </div>
  );
}

function NewAsset({ sid, onCreated }: { sid: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [type, setType] = useState("character"); const [scope, setScope] = useState("series");
  if (!open) return <button onClick={() => setOpen(true)}>새 에셋</button>;
  return <div className="newasset"><input placeholder="이름 (예: Adam)" value={name} onChange={(e) => setName(e.target.value)} />
    <select value={type} onChange={(e) => setType(e.target.value)}><option value="character">캐릭터</option><option value="location">장소</option><option value="prop">소품</option></select>
    <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="series">시리즈 공통</option><option value="episode">에피소드 전용</option></select>
    <button className="primary" disabled={!name.trim()} onClick={async () => { const a = await api<SeriesAsset>(`/api/series/${sid}/assets`, "POST", { name, type, scope }); setOpen(false); setName(""); onCreated(a.id); }}>만들기</button>
    <button onClick={() => setOpen(false)}>취소</button></div>;
}

function AssetPanel({ sid, s, a, epLabel, onClose, onSaved }: { sid: string; s: Series; a: SeriesAsset; epLabel: (id: string) => string; onClose: () => void; onSaved: () => void }) {
  const [desc, setDesc] = useState(a.description); const [rules, setRules] = useState<string[]>(a.rules); const [extra, setExtra] = useState(""); const [msg, setMsg] = useState("");
  const [usedIn, setUsedIn] = useState<string[]>(a.usedIn || []); const [tags, setTags] = useState((a.tags || []).join(", "));
  useEffect(() => { setDesc(a.description); setRules(a.rules); setUsedIn(a.usedIn || []); setTags((a.tags || []).join(", ")); setMsg(""); }, [a.id]);
  const main = a.refs.find((r) => r.state === "adopted") || a.refs.at(-1);
  async function save(patch: Partial<SeriesAsset>) { await api(`/api/series/${sid}/assets/${a.id}`, "PATCH", patch); setMsg("저장됨"); onSaved(); }
  async function request() { const j = await api<{ id: string }>(`/api/queue`, "POST", { type: "gpt-asset", series: sid, asset: a.id, extra: extra || undefined }); setMsg(`생성 요청: ${j.id} (작업 큐)`); }
  return (
    <aside className="panel">
      <div className="ph"><div><b>{a.name}</b><div className="small">{a.type} · {a.scope === "series" ? "시리즈 공통" : "에피소드 전용"} · {(a.usedIn || []).map(epLabel).join(", ") || "아직 안 쓰임"}</div></div><button onClick={onClose}>✕</button></div>
      <div className="viewer">{main ? <img src={seriesFile(sid, main.file)} /> : <div className="noimg">기준 이미지 없음</div>}</div>
      <div className="tabbody">
        <h3>기준 이미지 버전</h3>
        <div className="vers">{a.refs.map((r) => <div key={r.file} className={"ver st-" + r.state}><img src={seriesFile(sid, r.file)} loading="lazy" />
          <div><div className="row"><b>v{r.v} {r.source || ""}</b><span className={"state " + (r.state === "adopted" ? "adopted" : r.state === "candidate" ? "alternative" : "")}>{r.state === "adopted" ? "기준" : r.state === "candidate" ? "후보" : "이전"}</span></div>
            <div className="small">{r.note || r.file}</div>
            {r.state === "candidate" && <button onClick={async () => { await api(`/api/series/${sid}/assets/${a.id}/adopt`, "POST", { file: r.file }); onSaved(); }}>기준으로 채택</button>}</div></div>)}</div>
        <h3>설명 (프롬프트에 그대로 들어가요)</h3>
        <textarea rows={7} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <h3>이 에셋에 붙는 규칙</h3>
        <div className="chips edit">{s.rules.map((r) => <label key={r.id} className={"chip" + (rules.includes(r.id) ? " on" : "")} title={r.text}><input type="checkbox" checked={rules.includes(r.id)} onChange={(e) => setRules(e.target.checked ? [...rules, r.id] : rules.filter((x) => x !== r.id))} />{r.id}</label>)}</div>
        <h3>회차 태그 <span className="small">(샷 계획을 저장하면 자동으로 붙어요)</span></h3>
        <div className="chips edit">{(s.episodes || []).map((e) => <label key={e.id} className={"chip" + (usedIn.includes(e.id) ? " on" : "")}><input type="checkbox" checked={usedIn.includes(e.id)} onChange={(ev) => setUsedIn(ev.target.checked ? [...usedIn, e.id] : usedIn.filter((x) => x !== e.id))} />{e.label}</label>)}</div>
        <h3>태그 <span className="small">(쉼표로 구분, 예: genesis, eden)</span></h3>
        <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ width: "100%" }} />
        <h3>새 기준 이미지 요청</h3>
        <input placeholder="추가 지시 (선택, 예: full body back view on plain ground)" value={extra} onChange={(e) => setExtra(e.target.value)} style={{ width: "100%" }} />
      </div>
      <div className="pf">
        <label><input type="checkbox" checked={a.locked} onChange={(e) => save({ locked: e.target.checked })} /> 잠금</label>
        <button onClick={request}>생성 요청</button>
        <span className="small">{msg}</span>
        <button className="primary" onClick={() => save({ description: desc, rules, usedIn, tags: tags.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })}>저장</button>
      </div>
    </aside>
  );
}
