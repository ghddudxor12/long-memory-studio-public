import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Motion } from "../lib/types";

export const KenBurnsImage: React.FC<{ src: string; motion: Motion; duration: number }> = ({ src, motion, duration }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, duration], [0, 1], { extrapolateRight: "clamp" });
  let scale = 1.08, x = 0, y = 0;
  switch (motion) {
    case "zoomIn": scale = 1.0 + 0.12 * p; break;
    case "zoomOut": scale = 1.12 - 0.12 * p; break;
    case "panLeft": scale = 1.12; x = 3 - 6 * p; break;
    case "panRight": scale = 1.12; x = -3 + 6 * p; break;
    case "driftUp": scale = 1.1; y = 2.5 - 5 * p; break;
    case "static": scale = 1; break;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translate(${x}%, ${y}%)` }} />
    </AbsoluteFill>
  );
};
