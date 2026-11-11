export type VersionState = "adopted" | "history" | "superseded" | "rejected" | "alternative" | "candidate";

export type KeyframeVersion = {
  v: number; file: string; role: string; state: VersionState; note?: string; preview?: string;
};
export type ClipVersion = {
  v: number; file: string; state: VersionState; model?: string; segments?: [number, number][]; preview?: string;
};
export type Note = { at: string; by: string; text: string };

export type Shot = {
  key: string; scene: number; sceneTitle: string; title: string; type: "image" | "video";
  highlight: boolean; status: string; src: string; segments?: [number, number][]; motion?: string;
  prompts: { visual: string; audio: string; motion: string }; assets: string[];
  keyframes: KeyframeVersion[]; clips: ClipVersion[]; defects: string[]; notes: Note[]; kfReview?: KfReview; aiReview?: { tags: string[]; notes: string; confidence: number | null; at: string };
};

export type Production = {
  id: string; title: string; series: string; ep: number; stage: string;
  approvals: Record<string, { at: string; by: string; note?: string }>;
  youtube?: { videoId: string; privacy: string };
  credits?: { flow?: { total: number; note?: string } };
  assets: { name: string; type: string; description: string }[];
  shots: Shot[]; log: Note[]; rules?: { id: string; text: string; prompt: string; scenes?: number[] }[];
};

export type Timing = { fps?: number; total?: number; shots?: Record<string, { start: number; duration: number }> };
export type EpisodeData = { id: string; episode: any; production: Production | null; timing: Timing };
export type EpisodeSummary = { id: string; folder: string; title?: string; stage?: string; stageLabel?: string; shots: number; hasProduction: boolean; series?: string };

export type KfReview = { result: "pass" | "redo" | "exception"; tags: string[]; note?: string; at?: string };
export type Issue = { id: string; render: string; t: number; shot?: string; tags: string[]; text: string; status: "open" | "doing" | "resolved"; createdAt: string; capture?: string; resolvedAt?: string };
export type Review = { issues: Issue[] };
export type RenderFile = { ref: string; where: "out" | "publish"; name: string; size: number; mtime: string; url: string; qc: boolean };
export type QcCheck = { id: string; label: string; ok: boolean; detail: string; items: any[] };
export type QcResult = { file: string; at: string; seconds: number; ok: boolean; checks: QcCheck[]; luminance: { fps: number; values: number[] } };
export type Job = { id: string; kind: string; status: "running" | "done" | "failed"; progress: number; log?: string[]; target?: string };

export type SeriesAsset = { id: string; name: string; type: "character" | "location" | "prop"; description: string; rules: string[]; locked: boolean; scope: "series" | "episode"; usedIn: string[]; tags?: string[]; refs: { v: number; file: string; state: string; source?: string; note?: string; job?: string }[] };
export type SeriesRule = { id: string; scope: string; text: string; prompt: string };
export type Series = { id: string; name: string; folder: string; version: number; style: { name: string; prompt: string; gptSuffix?: string; refs?: string[]; note?: string }; rules: SeriesRule[]; promptTemplate: string; assets: SeriesAsset[]; log: Note[]; episodes?: { id: string; ep: number | null; label: string }[] };
export type Composed = { text: string; refs: { asset: string; file: string }[]; warnings: string[]; rules: string[] };
export type QJob = { id: string; type: string; episode?: string; series?: string; target: { shot?: string; asset?: string; shots?: string[] }; backend: string; needsApproval: boolean; approvedAt?: string;
  input: any; output?: { dir: string; name: string }; status: "queued" | "approved" | "running" | "done" | "failed" | "cancelled"; failure?: { category: string; message: string };
  credits: { estimated: number; actual?: number }; result?: any; createdAt: string; updatedAt?: string; history: { at: string; status: string; by: string; message?: string }[] };
