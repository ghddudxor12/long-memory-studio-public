export type Motion = "zoomIn" | "zoomOut" | "panLeft" | "panRight" | "driftUp" | "static";
export type Subtitle = { text: string; from: number; duration: number };
export type Line = { id: string; estimated?: boolean; src: string; from: number; duration: number; subtitles: Subtitle[] };
export type Shot =
  | { key: string; title: string; type: "image"; src: string; motion: Motion; from: number; duration: number }
  | { key: string; title: string; type: "video"; src: string; segments: [number, number][]; from: number; duration: number };
export type Scene = { scene: number; title: string; captions: string[]; from: number; duration: number; lines: Line[]; shots: Shot[] };
export type BgmCue = { src: string; from: number; duration: number; trimBefore: number; fadeIn: number; fadeOut: number; gain: number };
export type Bgm = { volume: number; duckVolume: number; attack: number; release: number; cues: BgmCue[]; speech: [number, number][] };
export type Manifest = {
  id: string; title: string; subtitle: string; audioEstimated?: boolean;
  width: number; height: number; fps: number;
  crossfadeFrames: number; titleCardFrames: number; durationInFrames: number;
  scenes: Scene[];
  bgm?: Bgm | null;
  burnSubtitles?: boolean;
};
