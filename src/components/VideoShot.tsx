import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";

// Plays the given [startSec, endSec] segments back-to-back (muted; narration carries the audio).
// `tail` extra frames hold the last frame so the outgoing crossfade never reveals black.
export const VideoShot: React.FC<{ src: string; segments: [number, number][]; tail?: number }> = ({ src, segments, tail = 0 }) => {
  const { fps } = useVideoConfig();
  const SAFE = 3; // stay a few frames before the clip's real end (Veo clips are ~7.93s)
  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {segments.map(([a, b], i) => {
        const from = cursor; const len = Math.round((b - a) * fps); cursor += len;
        const isLast = i === segments.length - 1;
        const video = <OffthreadVideo src={staticFile(src)} trimBefore={Math.round(a * fps)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
        if (!isLast) return <Sequence key={i} from={from} durationInFrames={len}>{video}</Sequence>;
        const playLen = Math.max(1, len - SAFE);
        return (
          <Sequence key={i} from={from} durationInFrames={len + tail}>
            <Sequence durationInFrames={playLen}>{video}</Sequence>
            <Sequence from={playLen} durationInFrames={len + tail - playLen}>
              <Freeze frame={playLen - 1}>{video}</Freeze>
            </Sequence>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
