import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const SubtitleLine: React.FC<{ text: string; duration: number }> = ({ text, duration }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5, duration - 5, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 70 }}>
      <div style={{ opacity, maxWidth: 1700, textAlign: "center", whiteSpace: "pre-line", textWrap: "balance", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 50, lineHeight: 1.3, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.95), 0 0 2px #000", padding: "6px 18px", background: "rgba(0,0,0,0.28)", borderRadius: 8 }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
