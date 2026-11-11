import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// Small on-screen caption (verse refs, translation notes, interpretation labels)
export const Caption: React.FC<{ text: string; duration: number }> = ({ text, duration }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, duration - 12, duration], [0, 0.95, 0.95, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: "56px 70px" }}>
      <div style={{ opacity, fontFamily: "Georgia, serif", fontSize: 40, letterSpacing: 1, color: "#f3e3bd", textShadow: "0 2px 6px rgba(0,0,0,0.9)", borderLeft: "3px solid #c9a45c", paddingLeft: 14 }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
