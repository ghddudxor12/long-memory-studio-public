// Resolves episode folders inside the WORKSPACE (Google Drive streaming folder).
// Layout per episode: episode.json, thumbnail.json, _app/, 1_발행본/, 2_소스/ (Remotion public dir), 3_폐기_이전본/, 4_프로젝트백업/
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..', '..');
const cfgFile = path.join(root, 'studio.config.json');
export const config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

export function episodeId(argv = process.argv.slice(2)) {
  const id = argv.find((a) => !a.startsWith('-')) || process.env.npm_config_ep;
  if (!id) { console.error('usage: <script> <EPISODE_ID>'); process.exit(1); }
  return id;
}

export function episodePaths(id) {
  const rel = config.episodes[id];
  if (!rel) throw new Error(`episode ${id} is not registered in studio.config.json`);
  const dir = path.join(config.workspace, rel);
  return {
    dir,
    episodeJson: path.join(dir, 'episode.json'),
    thumbnailJson: path.join(dir, 'thumbnail.json'),
    src: path.join(dir, '2_소스'),          // Remotion --public-dir
    publish: path.join(dir, '1_발행본'),
    archive: path.join(dir, '3_폐기_이전본'),
    app: path.join(dir, '_app'),
    manifest: path.join(root, 'src', 'episodes', `${id}.manifest.json`),
    out: path.join(root, 'out', id),         // local scratch (previews, tests)
  };
}

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
