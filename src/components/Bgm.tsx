import { Audio, Sequence, interpolate, staticFile } from "remotion";
import type { Bgm as BgmT } from "../lib/types";

// Background music: scene-anchored cues, fade in/out, ducked under narration.
export const Bgm: React.FC<{ bgm: BgmT }> = ({ bgm }) => {
  const duckWeight = (abs: number) => {
    let w = 0;
    for (const [s, e] of bgm.speech) {
      if (abs < s - bgm.attack || abs > e + bgm.release) continue;
      const v = abs < s ? (abs - (s - bgm.attack)) / bgm.attack : abs > e ? 1 - (abs - e) / bgm.release : 1;
      if (v > w) w = v;
      if (w >= 1) break;
    }
    return w;
  };
  return (
    <>
      {bgm.cues.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.duration} name={`BGM ${i + 1}`}>
          <Audio
            src={staticFile(c.src)}
            trimBefore={c.trimBefore || undefined}
            volume={(f) => {
              const fade = Math.min(
                c.fadeIn > 0 ? interpolate(f, [0, c.fadeIn], [0, 1], { extrapolateRight: "clamp" }) : 1,
                c.fadeOut > 0 ? interpolate(f, [c.duration - c.fadeOut, c.duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1,
              );
              const w = duckWeight(c.from + f);
              const level = bgm.volume - (bgm.volume - bgm.duckVolume) * w;
              return Math.max(0, level * fade * c.gain);
            }}
          />
        </Sequence>
      ))}
    </>
  );
};
