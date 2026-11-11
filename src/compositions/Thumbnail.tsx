import { AbsoluteFill, Img, staticFile } from "remotion";

// Fixed series thumbnail format (1280x720). Edit episodes/<ID>/thumbnail.json, then:
//   npm run thumb --ep=<ID>
export type ThumbLine = { text: string; size: number; color: "white" | "gold" };
export type ThumbSpec = {
  id: string; series: string; ep: string; source: string; image: string; titleTop?: number;
  lines: ThumbLine[];
  highlight?: { x: number; y: number; rx: number; ry: number; label: string; labelX: number; labelY: number } | null;
};

const GOLD = "#ffcf4d", GOLD2 = "#d9b45a";
const SERIF = 'Georgia, "Times New Roman", serif';
const outline = (w: number): React.CSSProperties => ({ WebkitTextStroke: `${w}px rgba(0,0,0,0.85)`, paintOrder: "stroke fill", textShadow: "0 0 24px rgba(0,0,0,0.9)" });

export const Thumbnail: React.FC<{ spec: ThumbSpec }> = ({ spec }) => {
  const t = spec; let y = (t.titleTop ?? 300);
  return (
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: SERIF }}>
      <Img src={staticFile(t.image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 62%)" }} />
      {/* EP badge */}
      <div style={{ position: "absolute", left: 56, top: 44, width: 150, height: 118, boxSizing: "border-box", border: `4px solid ${GOLD}`, borderRadius: 10, background: "rgba(8,8,14,0.78)", textAlign: "center" }}>
        <div style={{ color: GOLD2, fontSize: 22, fontWeight: 700, letterSpacing: 6, marginTop: 10 }}>EP</div>
        <div style={{ color: GOLD, fontSize: t.ep.length > 3 ? 50 : t.ep.length > 2 ? 60 : 74, fontWeight: 900, letterSpacing: t.ep.length > 3 ? 0 : 2, lineHeight: "70px", whiteSpace: "nowrap" }}>{t.ep}</div>
      </div>
      {/* series + source */}
      <div style={{ position: "absolute", left: 232, top: 66, color: "#f2ead8", fontSize: 26, fontWeight: 700, letterSpacing: 7 }}>{t.series}</div>
      <div style={{ position: "absolute", left: 232, top: 104, width: 300, height: 3, background: GOLD2 }} />
      <div style={{ position: "absolute", left: 232, top: 118, color: GOLD, fontSize: 30, fontWeight: 700, letterSpacing: 3 }}>{t.source}</div>
      {/* title */}
      {t.lines.map((l, i) => { const top = y - l.size * 0.82; y += l.size + 8; return (
        <div key={i} style={{ position: "absolute", left: 52, top, fontSize: l.size, fontWeight: 900, letterSpacing: 2, lineHeight: 1, color: l.color === "gold" ? GOLD : "#fff", whiteSpace: "nowrap", ...outline(10) }}>{l.text}</div>
      ); })}
      {/* highlight */}
      {t.highlight && (() => { const h = t.highlight!; return (<>
        <svg width={1280} height={720} style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 0 6px rgba(0,0,0,0.8))" }}>
          <ellipse cx={h.x} cy={h.y} rx={h.rx} ry={h.ry} fill="none" stroke={GOLD} strokeWidth={5} />
          <line x1={h.x - h.rx * 0.65} y1={h.y + h.ry} x2={h.labelX + 90} y2={h.labelY - 38} stroke={GOLD} strokeWidth={5} />
        </svg>
        <div style={{ position: "absolute", left: h.labelX, top: h.labelY - 40, color: GOLD, fontSize: 44, fontWeight: 900, letterSpacing: 1, ...outline(8) }}>{h.label}</div>
      </>); })()}
    </AbsoluteFill>
  );
};
