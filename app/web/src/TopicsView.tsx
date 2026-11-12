import { useEffect, useState } from "react";
import { api } from "./util";

// Landing page: every topic (series) on the channel, with progress, its rules, a switch button and "new topic".
// Aside does the same through GET /api/channel, GET /api/series/:id/profile, POST /api/series.
export type Topic = { id: string; name: string; folder: string; label: string; playlist: string; source?: string; topic?: string | null; episodes: number; lastEpisode: string | null; upcoming: { label: string; title?: string }[]; thumb: string | null; unset: string[] };
type Channel = { name: string; handle?: string; series: Topic[] };
type Row = { id: string; series: string | null; youtube: { privacy: string } | null; public?: boolean; scheduledPublish?: string | null };
type Short = { id: string; episode: string };
type Profile = { profile: any; style: { prompt?: string } | null; rules: { id: string; text: string }[]; assets: string[] };

const PRESETS = [
  { name: "Greek Myths in Order", id: "greek-myths", source: "Hesiod, Theogony and Works and Days (Evelyn-White translation, 1914)", note: "그리스 신화: 신들의 탄생부터 순서대로" },
  { name: "The Norse Myths in Order", id: "norse-myths", source: "The Poetic Edda (Bellows translation, 1923)", note: "북유럽 신화: 세계의 시작부터 라그나로크까지" },
  { name: "The Ancient Wars", id: "ancient-wars", source: "Herodotus, The Histories (Macaulay translation, 1890)", note: "고대 전쟁사: 페르시아 전쟁부터" },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function TopicsView({ current, onSwitch, onOpen }: { current: string; onSwitch: (sid: string) => void; onOpen: (sid: string, view: string) => void }) {
  const [ch, setCh] = useState<Channel | null>(null); const [rows, setRows] = useState<Row[]>([]); const [shorts, setShorts] = useState<Short[]>([]);
  const [open, setOpen] = useState<string | null>(null); const [prof, setProf] = useState<Profile | null>(null);
  const [form, setForm] = useState<{ name: string; id: string; source: string } | null>(null); const [msg, setMsg] = useState("");
  const load = () => { api<Channel>("/api/channel").then(setCh); api<Row[]>("/api/ledger").then(setRows); api<Short[]>("/api/shorts").then(setShorts).catch(() => {}); };
  useEffect(load, []);
  useEffect(() => { setProf(null); if (open) api<Profile>(`/api/series/${open}/profile`).then(setProf); }, [open]);
  if (!ch) return <p className="small">불러오는 중…</p>;
  const stats = (sid: string) => {
    const r = rows.filter((x) => x.series === sid); const ids = new Set(r.map((x) => x.id));
    return { pub: r.filter((x) => x.public).length, sched: r.filter((x) => !x.public && x.scheduledPublish).length, priv: r.filter((x) => x.youtube && !x.public && !x.scheduledPublish).length, making: r.filter((x) => !x.youtube).length, shorts: shorts.filter((s) => ids.has(s.episode)).length };
  };
  async function create() {
    if (!form) return; const id = form.id || slug(form.name);
    if (!confirm(`새 주제 "${form.name}" (${id})를 만들까요? Drive에 시리즈 폴더가 생깁니다.`)) return;
    try {
      const r = await api<any>("/api/series", "POST", { id, name: form.name, profile: { label: form.name.toUpperCase(), playlist: form.name, source: { name: form.source } }, by: "user" });
      setMsg(`만들었어요: ${r.folder}. 아직 기본값(성경)인 항목 ${r.stillBibleDefaults.length}개는 Aside에게 "${form.name} 주제 프로필 채워줘"라고 하면 채웁니다.`);
      setForm(null); load(); onSwitch(id);
    } catch (e: any) { setMsg("오류: " + e.message); }
  }
  return (
    <div className="topics">
      <div className="kfr-bar"><b>{ch.name} 주제</b><span className="small">{ch.handle} · 주제 {ch.series.length}개 · 주제마다 원문 출처, 표기, 재생목록, 쇼츠 문구가 따로 있어요</span><span className="spacer" />
        <button onClick={() => setForm(form ? null : { name: "", id: "", source: "" })}>+ 새 주제</button></div>
      {msg && <p className="small">{msg}</p>}
      {form && <section className="panelbox topic-form">
        <h3>새 주제 만들기</h3>
        <div className="topic-row">{PRESETS.map((p) => <button key={p.id} onClick={() => setForm({ name: p.name, id: p.id, source: p.source })} title={p.source}>{p.note}</button>)}</div>
        <label>이름 (영어, 재생목록·썸네일 표기)<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, id: form.id && form.id !== slug(form.name) ? form.id : slug(e.target.value) })} placeholder="Greek Myths in Order" /></label>
        <label>ID<input value={form.id} onChange={(e) => setForm({ ...form, id: slug(e.target.value) })} placeholder="greek-myths" /></label>
        <label>원문 출처 (퍼블릭 도메인 번역)<input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Hesiod, Theogony (Evelyn-White translation, 1914)" /></label>
        <p className="small">번역 규칙, 인용 규칙, 쇼츠 문구, 그림 스타일 같은 나머지 항목은 만든 뒤 Aside가 주제에 맞게 채웁니다.</p>
        <div className="topic-row"><button className="primary" disabled={!form.name || !form.source} onClick={create}>만들기</button><button onClick={() => setForm(null)}>취소</button></div>
      </section>}
      <div className="topic-grid">{ch.series.map((t) => { const s = stats(t.id); const on = t.id === current; return (
        <section key={t.id} className={"panelbox topic" + (on ? " on" : "")}>
          {t.thumb ? <img className="topic-thumb" src={t.thumb} alt="" /> : <div className="topic-thumb empty">대표 이미지 없음</div>}
          <div className="topic-body">
            <div className="topic-row"><h3>{t.name}</h3>{on && <span className="state adopted">현재 주제</span>}</div>
            <p className="small">원문: {t.source || "-"}</p>
            <div className="topic-stats">
              <span><b>{t.episodes}</b>편</span><span>공개 <b>{s.pub}</b></span><span>예약 <b>{s.sched}</b></span><span>비공개 <b>{s.priv}</b></span><span>제작 중 <b>{s.making}</b></span><span>쇼츠 <b>{s.shorts}</b></span>
            </div>
            {t.upcoming.length > 0 && <p className="small">다음 예정: {t.upcoming.map((u) => u.label + (u.title ? ` ${u.title}` : "")).join(", ")}</p>}
            {t.unset.length > 0 && <p className="small blocked">아직 성경 기본값인 항목 {t.unset.length}개: {t.unset.join(", ")}</p>}
            <div className="topic-row">
              {on ? <button className="primary" onClick={() => onOpen(t.id, "ledger")}>에피소드 대장 열기</button> : <button className="primary" onClick={() => onSwitch(t.id)}>이 주제로 전환</button>}
              <button onClick={() => onOpen(t.id, "shorts")}>쇼츠</button>
              <button onClick={() => onOpen(t.id, "series")}>스타일·에셋</button>
              <button onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "규칙 닫기" : "규칙 보기"}</button>
            </div>
            {open === t.id && (prof ? <dl className="topic-prof">
              <dt>표기 / 재생목록</dt><dd>{prof.profile.label} / {prof.profile.playlist}</dd>
              <dt>원문과 인용</dt><dd>{prof.profile.source?.name} ({prof.profile.source?.license}). {prof.profile.source?.quoteRule}</dd>
              <dt>번역 규칙</dt><dd>{prof.profile.source?.translateRule}</dd>
              <dt>설명란 꼬리말</dt><dd>{prof.profile.descriptionFooter}</dd>
              <dt>쇼츠</dt><dd>{prof.profile.shorts?.closing} · {prof.profile.shorts?.hashtags}</dd>
              <dt>목소리</dt><dd>{prof.profile.voice?.voice}, 속도 {prof.profile.voice?.rate}, 줄 간격 {prof.profile.voice?.lineGapSec}초</dd>
              <dt>그림 스타일</dt><dd>{prof.style?.prompt || "-"}</dd>
              <dt>그림 규칙</dt><dd>{prof.rules.length ? prof.rules.map((r) => r.text).join(" / ") : "-"}</dd>
              <dt>에셋</dt><dd>{prof.assets.length ? prof.assets.join(", ") : "-"}</dd>
            </dl> : <p className="small">불러오는 중…</p>)}
          </div>
        </section>); })}</div>
    </div>
  );
}
