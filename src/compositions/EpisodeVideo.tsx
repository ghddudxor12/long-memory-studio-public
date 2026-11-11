import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Manifest, Shot } from "../lib/types";
import { KenBurnsImage } from "../components/KenBurnsImage";
import { VideoShot } from "../components/VideoShot";
import { SubtitleLine } from "../components/Subtitles";
import { Caption } from "../components/Caption";
import { TitleCard } from "../components/TitleCard";
import { Bgm } from "../components/Bgm";

const Fade: React.FC<{ duration: number; fade: number; children: React.ReactNode }> = ({ duration, fade, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, fade, duration - fade, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const ShotView: React.FC<{ shot: Shot; tail: number }> = ({ shot, tail }) =>
  shot.type === "video" ? <VideoShot src={shot.src} segments={shot.segments} tail={tail} /> : <KenBurnsImage src={shot.src} motion={shot.motion} duration={shot.duration} />;

export const EpisodeVideo: React.FC<{ manifest: Manifest }> = ({ manifest }) => {
  const m = manifest; const T = m.titleCardFrames; const xf = m.crossfadeFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {m.bgm && <Bgm bgm={m.bgm} />}
      <Sequence durationInFrames={T}><TitleCard title={m.title} subtitle={m.subtitle} /></Sequence>
      {m.scenes.map((sc) => (
        <Sequence key={sc.scene} from={T + sc.from} durationInFrames={sc.duration + xf} name={`Scene ${sc.scene}`}>
          {sc.shots.map((sh) => (
            <Sequence key={sh.key} from={sh.from} durationInFrames={sh.duration + xf} name={sh.key}>
              <Fade duration={sh.duration + xf} fade={xf}><ShotView shot={sh} tail={xf} /></Fade>
            </Sequence>
          ))}
          {sc.captions.map((c, i) => (
            <Sequence key={`c${i}`} from={Math.round(sc.duration * (i / Math.max(1, sc.captions.length))) + 15} durationInFrames={Math.min(210, sc.duration - 20)}>
              <Caption text={c} duration={Math.min(210, sc.duration - 20)} />
            </Sequence>
          ))}
          {sc.lines.map((ln) => (
            <Sequence key={ln.id} from={ln.from} durationInFrames={ln.duration} name={ln.id}>
              {!ln.estimated && <Audio src={staticFile(ln.src)} />}
              {m.burnSubtitles !== false && ln.subtitles.map((s, i) => (
                <Sequence key={i} from={s.from - ln.from} durationInFrames={s.duration}>
                  <SubtitleLine text={s.text} duration={s.duration} />
                </Sequence>
              ))}
            </Sequence>
          ))}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
