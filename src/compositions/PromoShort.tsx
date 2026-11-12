import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Vertical promo short (1080x1920) in the "framed" layout used by many faith/history Shorts:
//   top block (black): channel icon + name, then a fixed hook headline
//   middle band: the picture (4:3 by default, cropped from 16:9 sources, held still with a slow zoom; no pans)
//   captions: 2-4 words at a time, centred on the picture; words in *asterisks* are gold
//   bottom block (black): left empty for the platform UI (title, channel, buttons)
// All times are in seconds; media paths are relative to --public-dir.
// c = horizontal centre of the subject in the 16:9 source (0-1); the crop window is held there.
export type ShortShot = { src: string; at: number; dur: number; trim?: number; c?: number; zoom?: [number, number] };
export type ShortLine = { src: string; at: number; dur: number; text: string };
export type ShortSpec = {
  durationSec: number;
  channel: { name: string; icon?: string };
  hook: string[];
  band?: { top: number; height: number };
  channelTop?: number; // y of the icon+name row (default 110)
  captionHeight?: number; // black block under the picture that holds the captions (default 220)
  shots: ShortShot[];
  lines: ShortLine[];
  bgm?: { src: string; volume: number; duckVolume: number; trim?: number };
  endCard: { at: number; lines: string[] };
};

const GOLD = "#f6c945";
const SERIF = "Georgia, 'Times New Roman', serif";
const fade = (f: number, len: number, inF = 8, outF = 8) =>
  interpolate(f, [0, inF, len - outF, len], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// caption chunks of at most 4 words, broken at punctuation first and never ending on a small function word
const WEAK = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "but", "or", "that", "is", "was", "we", "it", "its", "for", "with", "as", "by", "what", "not", "one", "two", "would", "could", "should", "were", "are", "be", "because", "their", "his", "her"]);
export const chunks = (text: string, max = 4) => {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const clauses: string[][] = []; let cur: string[] = [];
  for (const w of words) { cur.push(w); if (/[.,;:!?]["”*]*$/.test(w)) { clauses.push(cur); cur = []; } }
  if (cur.length) clauses.push(cur);
  const weak = (w: string) => WEAK.has(w.toLowerCase().replace(/[^a-z]/g, ""));
  const out: string[] = [];
  for (const c of clauses) { // split each clause on its own; pieces never cross a punctuation mark
    let start = 0;
    if (c.length <= max + 1) { out.push(c.join(" ")); continue; }
    while (c.length - start > max) {
      const left = c.length - start, n = Math.ceil(left / max), ideal = start + Math.round(left / n);
      let best = -1;
      for (let cut = start + 2; cut <= Math.min(start + max, c.length - 2); cut++) if (!weak(c[cut - 1]) && (best < 0 || Math.abs(cut - ideal) < Math.abs(best - ideal))) best = cut;
      if (best < 0 && start + max + 1 <= c.length - 1 && !weak(c[start + max])) best = start + max + 1; // one word longer rather than a weak ending
      const cut = best > 0 ? best : ideal; out.push(c.slice(start, cut).join(" ")); start = cut;
    }
    out.push(c.slice(start).join(" "));
  }
  return out;
};

const Shot: React.FC<{ s: ShortShot; w: number; h: number }> = ({ s, w, h }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const len = Math.round(s.dur * fps);
  const [z0, z1] = s.zoom ?? [1.0, 1.04]; const z = z0 + (z1 - z0) * (f / len);
  const srcH = h * z, srcW = srcH * (16 / 9); const c = s.c ?? 0.5;
  const left = Math.min(0, Math.max(w - srcW, w / 2 - c * srcW));
  const style: React.CSSProperties = { position: "absolute", top: (h - srcH) / 2, left, height: srcH, width: srcW, objectFit: "cover" };
  const still = /\.(jpe?g|png|webp)$/i.test(s.src);
  return (
    <AbsoluteFill style={{ opacity: fade(f, len, 5, 5), overflow: "hidden" }}>
      {still ? <Img src={staticFile(s.src)} style={style} />
        : <OffthreadVideo src={staticFile(s.src)} trimBefore={Math.round((s.trim ?? 0) * fps)} muted style={style} />}
    </AbsoluteFill>
  );
};

const Words: React.FC<{ text: string; size: number }> = ({ text, size }) => (
  <div style={{ textAlign: "center", fontFamily: SERIF, fontWeight: 700, fontSize: size, lineHeight: 1.12, color: "white", maxWidth: 900,
    textShadow: "0 0 14px rgba(0,0,0,0.95), 0 3px 8px rgba(0,0,0,0.95)", WebkitTextStroke: "1.5px rgba(0,0,0,0.6)" }}>
    {text.split(/(\*[^*]+\*)/).map((p, i) => p.startsWith("*") ? <span key={i} style={{ color: GOLD, fontStyle: "italic" }}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>)}
  </div>
);

const Captions: React.FC<{ line: ShortLine }> = ({ line }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const cs = chunks(line.text); const weight = (c: string) => c.replace(/\*/g, "").length + 6;
  const total = cs.reduce((a, c) => a + weight(c), 0);
  let acc = 0; let cur = cs[cs.length - 1];
  for (const c of cs) { const end = ((acc + weight(c)) / total) * line.dur; if (t < end) { cur = c; break; } acc += weight(c); }
  return <Words text={cur} size={76} />;
};

export const PromoShort: React.FC<{ spec: ShortSpec }> = ({ spec }) => {
  const { fps, width } = useVideoConfig(); const F = (s: number) => Math.round(s * fps);
  const f = useCurrentFrame(); const t = f / fps; const total = F(spec.durationSec);
  const band = spec.band ?? { top: 450, height: 810 };
  const speaking = spec.lines.some((l) => t >= l.at - 0.2 && t <= l.at + l.dur + 0.3);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* top block: channel + fixed hook */}
      <AbsoluteFill style={{ height: band.top, justifyContent: "flex-end", alignItems: "center", paddingBottom: 36 }}>
        {spec.hook.map((l, i) => (
          <div key={i} style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 56, lineHeight: 1.18, color: "white", textAlign: "center", maxWidth: 980 }}>
            {l.split(/(\*[^*]+\*)/).map((p, k) => p.startsWith("*") ? <span key={k} style={{ color: GOLD }}>{p.slice(1, -1)}</span> : <span key={k}>{p}</span>)}
          </div>
        ))}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 56, top: spec.channelTop ?? 110, display: "flex", alignItems: "center", gap: 16 }}>
        {spec.channel.icon && <Img src={staticFile(spec.channel.icon)} style={{ width: 72, height: 72, borderRadius: 36 }} />}
        <div style={{ fontFamily: SERIF, fontSize: 36, letterSpacing: 2, color: "#e9dcc0" }}>{spec.channel.name}</div>
      </div>
      {/* picture band */}
      <div style={{ position: "absolute", top: band.top, left: 0, width, height: band.height, overflow: "hidden", backgroundColor: "black" }}>
        {spec.shots.map((s, i) => (
          <Sequence key={i} from={F(s.at)} durationInFrames={F(s.dur)} name={s.src}><Shot s={s} w={width} h={band.height} /></Sequence>
        ))}
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)" }} />
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 18 }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, letterSpacing: 4, color: "rgba(255,255,255,0.75)", textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>{spec.channel.name.toUpperCase()}</div>
        </AbsoluteFill>
        <Sequence from={F(spec.endCard.at)} durationInFrames={total - F(spec.endCard.at)}>
          <EndCard lines={spec.endCard.lines} />
        </Sequence>
      </div>
      <div style={{ position: "absolute", top: band.top + band.height, left: 0, width, height: spec.captionHeight ?? 220, display: "flex", justifyContent: "center", alignItems: "center" }}>
        {spec.lines.map((l, i) => (
          <Sequence key={"c" + i} from={F(l.at)} durationInFrames={F(l.dur) + 2} layout="none"><Captions line={l} /></Sequence>
        ))}
      </div>
      {spec.lines.map((l, i) => (
        <Sequence key={"a" + i} from={F(l.at)} durationInFrames={F(l.dur) + 2} name={l.src}><Audio src={staticFile(l.src)} /></Sequence>
      ))}
      {spec.bgm && (
        <Audio src={staticFile(spec.bgm.src)} trimBefore={F(spec.bgm.trim ?? 0)}
          volume={(fr) => { const base = speaking ? spec.bgm!.duckVolume : spec.bgm!.volume; return base * interpolate(fr, [0, 20, total - 45, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); }} />
      )}
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ lines: string[] }> = ({ lines }) => {
  const f = useCurrentFrame(); const o = interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o, background: `rgba(0,0,0,${0.45 * o})` }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: SERIF, fontWeight: i === 0 ? 400 : 700, fontSize: i === 0 ? 34 : 76, letterSpacing: i === 0 ? 6 : 1, color: i === 0 ? "#e9dcc0" : GOLD, textShadow: "0 3px 10px rgba(0,0,0,0.9)" }}>{l}</div>
      ))}
    </AbsoluteFill>
  );
};
