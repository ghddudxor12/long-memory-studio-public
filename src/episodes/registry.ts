import type { Manifest } from "../lib/types";
import type { ThumbSpec } from "../compositions/Thumbnail";

// Filled in by scripts/new-episode.mjs (one import per episode). Run node scripts/build-manifest.mjs <ID> afterwards.
export const EPISODES: Manifest[] = [];

// Series thumbnails (episodes/<ID>/thumbnail.json is copied here by build-manifest)
export const THUMBS: ThumbSpec[] = [];
