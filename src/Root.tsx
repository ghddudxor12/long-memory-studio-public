import { Composition, Folder, Still } from "remotion";
import { HelloWorld } from "./HelloWorld";
import { EpisodeVideo } from "./compositions/EpisodeVideo";
import { EPISODES, THUMBS } from "./episodes/registry";
import { Thumbnail } from "./compositions/Thumbnail";
import { PromoShort, type ShortSpec } from "./compositions/PromoShort";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Episodes">
        {EPISODES.map((m) => (
          <Composition
            key={m.id}
            id={m.id}
            component={EpisodeVideo}
            durationInFrames={m.durationInFrames}
            fps={m.fps}
            width={m.width}
            height={m.height}
            defaultProps={{ manifest: m }}
          />
        ))}
      </Folder>
      <Folder name="Thumbnails">
        {THUMBS.map((t) => (
          <Still key={t.id} id={t.id + "-thumb"} component={Thumbnail} width={1280} height={720} defaultProps={{ spec: t }} />
        ))}
      </Folder>
      <Folder name="Shorts">
        <Composition id="PromoShort" component={PromoShort} durationInFrames={150} fps={30} width={1080} height={1920}
          defaultProps={{ spec: { durationSec: 5, channel: { name: "The Long Memory" }, hook: ["HOOK"], shots: [], lines: [], endCard: { at: 4, lines: ["THE LONG MEMORY"] } } as ShortSpec }}
          calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.spec.durationSec * 30) })} />
      </Folder>
      <Folder name="Template">
        <Composition id="HelloWorld" component={HelloWorld} durationInFrames={150} fps={30} width={1920} height={1080}
          defaultProps={{ titleText: "Welcome to Remotion", titleColor: "#000000" }} />
      </Folder>
    </>
  );
};
