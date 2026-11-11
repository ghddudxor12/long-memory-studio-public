# Long Memory Studio

A local production studio for narrated long-form AI documentaries (built for the YouTube series "The Bible in Order").
It keeps the state of every episode (script, narration, shot plan, keyframes, video clips, render, QC, package, upload, archive)
in a local web app, renders with [Remotion](https://www.remotion.dev/), and exposes an API designed for an AI agent operator.

Shared as-is from a personal project. Paths, prompts and the 12-step workflow reflect one channel's needs: expect to adapt them.

## Requirements
- macOS (narration uses the built-in `say` voices; `swift` is used for Google Drive cache eviction)
- Node.js 20+ and npm
- Optional, depending on the steps you use: Codex CLI (image generation and translation scripts), a Google Drive for desktop
  folder as the workspace, Google Flow / YouTube Studio accounts operated through a browser agent (`agent/` helpers)

## Quick start
```
npm ci
xattr -dr com.apple.quarantine node_modules      # only if macOS blocks bundled binaries
cp studio.config.example.json studio.config.json # set "workspace" to the folder that will hold your episodes
npm run app                                      # http://127.0.0.1:5178
```
Create a series folder under the workspace (see `series` in the config), then register episodes with
`node scripts/new-episode.mjs <ID> --series <sid> --ep <N> --title "<title>"`.
The browser helpers in `agent/repl_helpers.js` contain placeholders (`YOUR_FLOW_PROJECT_ID`, `YOUR_CHANNEL_ID`, `/Users/YOU`)
that must be replaced before use.

## Agent skills
`aside-skills/` contains the three Aside agent skills that operate this app (orchestrator, Google Flow video, images), with personal values replaced by placeholders. See `aside-skills/README.md` for the structure and how to install them.

## Notes
- Remotion has its own license: free for individuals and small companies, a company license is required otherwise
  (see https://www.remotion.dev/license). This repository's MIT license covers only the code written here.
- Google Flow and YouTube Studio have no public API for these steps; the helpers drive their web UIs. Follow each service's
  terms of use, keep human-like pacing and never try to bypass automation checks.
- AI-generated media should be labelled as such when published.

## License
MIT, see LICENSE.

## Technical notes

## Layout
- Code lives here (git). Media and episode data live in the **WORKSPACE** = Google Drive streaming folder
  (`studio.config.json` → `workspace`). Nothing media-heavy is committed.
- Episode folder (in WORKSPACE): `episode.json`, `thumbnail.json`, `_app/`, `1_발행본/`, `2_소스/`, `3_폐기_이전본/`, `4_프로젝트백업/`.
- `2_소스/` is the Remotion public dir: `keyframes/*.jpg`, `clips/*.mp4`, `narration/*.wav`, `bgm/*.wav`, `thumb/`.
  History lives under `keyframes/png`, `keyframes/end`, `keyframes/fix_*`, `clips/_raw`.

## Commands
```
node scripts/tts.mjs <ID> [--force]          # macOS say → 2_소스/narration
node scripts/build-manifest.mjs <ID>         # episode.json + WAV lengths → src/episodes/<ID>.manifest.json
node scripts/render.mjs <ID> preview|final|thumb [--publish]
                                             # default out/<ID>/; --publish writes to 1_발행본 and archives the old file
```
Register a new episode in `studio.config.json` → `episodes`, then add it to `src/episodes/registry.ts`.

## App
```
npm run app                                  # build UI + start http://127.0.0.1:5178 (server = worker)
node scripts/launchagent.mjs install         # optional: start the server at login (macOS LaunchAgent)
```
Tabs: 대장 · 에피소드 홈 · 시리즈 · 대본·내레이션 · 샷 보드 · 키프레임 검수 (G2) · 작업 큐 · 렌더 검수 (G3) · 패키지·업로드 · 보관

| Area | Data | Notes |
|-|-|-|
| Stage engine | computed | 12 steps with completion checks (`GET /api/episodes/:id/stages`), gates G1-G3 |
| Series | `<series>/00_시리즈공통/series.json` | style, rules (prompt fragments), assets (character/location/prop, scope, lock, episode tags `usedIn`, free `tags`, reference versions) |
| Shots | `episode.json` + `_app/production.json` | versions (keyframes/clips: adopted, candidate, superseded, rejected), prompts, defects, notes, kfReview, aiReview |
| Jobs | `_app/jobs/*.json` | frozen input snapshot, backend (`codex-local` default, `chatgpt-web`, `flow-web`, `aside-vision`), approval gate for credits, failure categories, credit ledger; results validated before becoming candidates |
| Review | `_app/review.json`, `_app/qc/` | issues with captures, QC results |
| Package | `_app/metadata.json`, `thumbnail.json`, `1_발행본/` | chapters auto from the manifest, tag budget, translations/subtitle checks, thumbnail render (`render.mjs thumb --publish` → JPG) |
| Upload | `production.upload`, `production.youtube` | checklist incl. "en SRT 게시됨", "auto captions deleted", watch-page verify |
| Archive | `_app/preview/` (480px stills, `proxy_360p.mp4`), `_app/archive.json` | Drive online-only status per folder; `swift scripts/evict.swift <paths>` clears the local Drive cache (files stay in Drive). Compiled Swift binaries get killed on this Mac, so run it with the `swift` interpreter |

Scripts: `codex-image.mjs <job>` (Codex CLI image), `qc.mjs`, `previews.mjs`, `proxy.mjs`, `new-episode.mjs`, `render.mjs`, `tts.mjs`, `build-manifest.mjs`, `migrate/*` (EP001 one-offs).
UI themes: `astryx-dark.css` (default), `astryx.css`, `original-dark.css` (M1 board only) in `app/web/src/themes/`; switch with `appTheme` in studio.config.json.
Aside skills (account): `longform-studio`, `longform-gpt-images`, `longform-flow-veo`.

## Flow clips and uploads (2026-11-11 mid-review, user-approved)
```
node scripts/mkveo.mjs <ID> [shots]          # approved flow-veo jobs (Omni 1.2 Flash 720p, 8 s); default anti-swirl wording
node scripts/flow-ingest.mjs <job> <1080p> <720p> [--edit <flowEditId>] [--no-complete]
                                             # Downloads → 2_소스/clips/_raw/<shot>_vN*.mp4, 1920x1080 check,
                                             # 5 review frames in _app/preview/clipcheck/, completes the job (job.flow.editId)
```
Browser side (Aside REPL helpers, account skill `longform-studio/scripts/repl_helpers.js`): `collectShot(job)` finds a
Flow tile by the START frame name under it and downloads 720p + 1080p; `clipSheet(ep, shots)` builds review sheets.
YouTube: at most **10 uploads per day**; auto English captions are deleted once at upload and left alone if YouTube
re-creates them (manual English must be published in the video-language row). Keep your own upload checklist next to the workspace.
Work one episode per fresh agent context (`clear` or a new task): all state is in the app, the skill and the helpers file.

## App API additions (2026-11-11)
| Endpoint | Purpose |
|-|-|
| `POST /api/episodes/:id/approve {gate, by:"aside"|"user", note}` | gate approvals keep who decided (`aside` + `delegatedBy:"user"` under the standing delegation) |
| `GET /api/upload-quota` | YouTube uploads in the last 24 h vs `uploadDailyLimit` (default 10), next free time |
| `PATCH /api/episodes/:id/blocker {reason, until} / {clear:true}` | external wait shown on the episode home and the ledger |
| `PATCH /api/queue/:job {prompt, durationSec?}` | edit a job before submission, previous prompts kept in `input.promptHistory` |
| `POST /api/episodes/:id/archive/done {by}` | step 12 is done by Aside after proxy, index and evict |
Ledger rows carry `epLabel` (EP010-2), `scheduledPublish` and `blocked`; `/api/episodes` returns `stageLabel` from the 12-step engine.

## AI-native layer (2026-11-11)
The app is operated mainly by an AI agent (Aside). Entry points: `GET /api/agent/brief` (markdown: `docs/agent-rules.md` + live state),
`GET /api/next` (all episodes: step, owner, blocker, how-to; proposes the next `upcoming` episode from studio.config.json),
`GET /api/flow/plan` (Google Flow submit/collect lists, 75 s pacing, block state; `POST /api/queue/:job/submitted`, `POST /api/flow/block`),
`GET /api/episodes/:id/summary` (compact), `GET /api` (route index). Browser helpers for the agent live in `agent/repl_helpers.js`
(served at `/api/agent/helpers.js`), the review-sheet image server in `agent/lms_static.mjs`. Runtime pacing state: `state/flow.json` (git-ignored).
The ledger shows the same next-action list to the user.

## macOS note (Aside)
Files written by Aside get `com.apple.quarantine`, and Gatekeeper kills unsigned binaries (esbuild, chrome-headless-shell).
After `npm ci` run: `xattr -dr com.apple.quarantine node_modules`.

## Fresh clone
`npm ci` → `node scripts/build-manifest.mjs <ID>` for each registered episode (manifests are generated, not committed) → render.

## M0 result (2026-11-04)
EP001 rendered from Aside with sources read directly from the Drive streaming folder: 8,236 frames / 274.5s in 293.8s,
**byte-identical (md5) to the previously published `1_발행본/BIB-GEN-001_final.mp4`**, SRT identical (66 cues).
