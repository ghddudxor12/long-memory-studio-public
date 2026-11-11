import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const TitleCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, 20, 100, 120], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "black", justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ fontFamily: "Georgia, serif", color: "#f3e3bd", fontSize: 96, letterSpacing: 4 }}>{title}</div>
      <div style={{ fontFamily: "Georgia, serif", color: "#c9a45c", fontSize: 40, marginTop: 20 }}>{subtitle}</div>
      <div style={{ display: "none" }}>{durationInFrames}</div>
    </AbsoluteFill>
  );
};
