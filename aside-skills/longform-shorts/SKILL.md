---
name: "longform-shorts"
description: "Long Memory Studio 홍보용 쇼츠/릴스(YouTube Shorts, Instagram·Facebook Reels) 제작: 롱폼 에피소드의 기존 클립·키프레임·내레이션만 재사용해 Remotion으로 1080x1920 액자형 세로 영상을 만든다. '쇼츠 만들어', '릴스', '숏폼', 'short-build' 요청 시 읽는다."
---

# Promo shorts from Long Memory episodes

Repo `<repo>`, Node `node`. Shorts reuse an episode's adopted media only: no Flow, no new images, no credits. One render takes ~40 s.

## Layout (user-approved 2026-11-12, do not drift)
1080x1920, black background, framed like popular faith Shorts (reference https://www.youtube.com/shorts/QPWwG_eMwYg):
- top-left (y=110): channel icon + "The Long Memory"; then a fixed 2-line hook (white serif, *word* = gold), ~100 px below the channel row.
- picture band y=450-1260, 4:3, cropped from 16:9 around the subject, **held still** with a slow zoom (1.00→1.04). **No left/right pans** (user: dizzy). Two subjects that do not fit = two shots (a cut), not a pan.
- captions in the black block under the picture (y=1260-1480), 2-4 words, serif bold, emphasis words gold italic.
- bottom ~440 px left empty for the platform UI (title, channel, buttons). Small "THE LONG MEMORY" at the bottom of the picture; end card "THE BIBLE IN ORDER / The Long Memory" over the last beat.
Component: `src/compositions/PromoShort.tsx` (composition id `PromoShort`). Change layout values only on the user's request.

## Content rules
- 30-58 s. One idea that works without the long video: a hook line, the scripture, the turn, a closing line pointing to the channel.
- Quote the KJV only (reuse the episode's narration lines; they are already checked). Interpretations stay labelled as interpretations, as in the episode.
- Series wording comes from the episode's series profile (`GET /api/episodes/<ID>/profile`): `shorts.closing` for the closing line (fill {work}, e.g. "Genesis 4"), `shorts.hashtags`, `shorts.endCard`, `source.quoteRule`. `--init` copies them into short.json (closingHint, hashtags, endCard).
- Prefer existing narration WAVs (`say: "S06_L3"`). New lines (`say: "new:..."`) are recorded with the episode voice and rate automatically; keep them to one short closing line.
- Shots must match the words: the sun on "sun", the moon on "moon", the light column on "Let there be light". Use `from` anchors so the cut lands on the word.
- Visual rules of the series still apply (people from behind, no text in images, no gore).

## Workflow
1. Subject map (once per episode): `node scripts/subject-map.mjs <EP>` → open each sheet URL it prints in a tab (setViewportSize ~1590x2200, screenshot, close) and set where the subject sits: `node scripts/subject-map.mjs <EP> --set S01-02=0.6:hand and light column,S06-05=0.5:sun left moon right`. c = horizontal centre in the 16:9 source (0-1); the 4:3 window covers c±0.375. Only set the shots you use; `--show` prints the map (`_app/subjects.json`).
2. New short: `node scripts/short-build.mjs --init <EP>` → creates `<EP>-S<n>/short.json` in `<episode>/_app/shorts/` and prints candidate lines (id, seconds, tags cold-open/quote/turn, text) and the shots of each scene.
3. Write short.json (semantic only; the script computes every time):
```json
{ "hook": ["*Light* shines on Day One.", "The sun? Not until *Day Four*."],
  "emphasis": ["light", "fourth", "sun", "moon"],
  "beats": [
    { "say": "S01_L1", "shots": ["S01-02", { "shot": "S06-05", "from": "But" }, { "shot": "S10-02", "from": "This" }] },
    { "say": "S03_L1", "shots": [{ "shot": "S01-02", "trim": 3.5, "zoom": [1.04, 1.1] }] },
    { "say": "new:Genesis one, read in order. Only on The Long Memory.", "shots": ["S01-02@2"], "endCard": true } ],
  "bgm": { "src": "bgm/<episode cue>.wav", "trim": 0 },
  "upload": { "title": "... #shorts", "description": "...", "relatedVideo": "<long-form videoId>" } }
```
   Shot forms: `"KEY"`, `"KEY@trim"`, `"KEY#c"`, or `{shot, from, trim, c, zoom}`. Hook lines ≤ 34 characters each.
4. `node scripts/short-build.mjs <EP>-S<n> --dry` → timeline + QC. Fix every `problems` entry (unknown shot/line, anchor not found, clip too short for its window, > 60 s); read `warnings` (short shots, weak caption endings, missing subject positions).
5. `node scripts/short-build.mjs <EP>-S<n>` → renders, loudness-normalises (-14.5 LUFS, TP ≤ -1), writes `<episode>/1_발행본/shorts/<id>.mp4`, review frames + `build.json` with a `sheet` URL and `sheetSize`. Open the sheet (setViewportSize to sheetSize, screenshot) and check every frame: subject inside the picture, caption matches the picture, no text cut off. Show the user the sheet image inline and the mp4 path.
6. Record the review: `PATCH /api/shorts/<id>/state {"review":{"note":"…"},"by":"aside"}`.
7. Upload (YouTube): check `GET /api/upload-quota` first. Shorts count toward the same 10 uploads / 24 h limit as the long videos and are included in that count (2026-11-12: the 11th upload of the day, a short, was refused with "일일 업로드 한도 도달"). Then REPL `await ytShortUpload("<id>")` (helpers from /api/agent/helpers.js): private upload, title from short.json, composed description with the long-video link, AI label "예"; it records the videoId and upload time through `PATCH /api/shorts/:id/state`. A vertical file under 3 min becomes a Short automatically (the dialog shows "Shorts 리믹스"). If YouTube shows the limit, stop, close the dialog and tell the user; do not retry.
8. Link the long video: `await ytShortLink(videoId, relatedVideo)` opens the edit page "관련 동영상"; pick the long video, save, record `{"youtube":{"relatedLinked":true}}`. If YouTube answers with another dialog it returns `{blocked}`: record `{"youtube":{"linkBlockedBy":"…"}}` and tell the user. The description already carries the long-video link either way.
9. Release (only on the user's word):
   - scheduled: `ytSchedule(videoId, 'YYYY. M. D.')` (New York 06:00 = 20:00 KST, same slot as the long videos) → record `{"youtube":{"scheduledPublish":"<ISO>"}}`;
   - now: `await ytVisibility(videoId, "public")` (returns the label after reload, expect "공개") → record `{"youtube":{"privacy":"public","scheduledPublish":null}}`.
   Check the public page once (`https://www.youtube.com/shorts/<id>`): the platform title and channel overlay sit in the empty bottom block, not over the captions.

## Cleanup
short-build removes its out/shorts/<id> stage after a successful build. After a batch run `node scripts/cleanup-local.mjs`; do not copy finished shorts into session artifacts (link the Drive file or show the review sheet).

## App
`GET /api/shorts` (all shorts, 6 steps: 기획 → 빌드 → 검수 → 업로드(비공개) → 롱폼 연결 → 공개, current step, how-to), `GET /api/shorts/:id`, `GET /api/episodes/:id/short-candidates`, `POST /api/episodes/:id/shorts` (new skeleton), `POST /api/shorts/:id/build {dry}` (job), `PATCH /api/shorts/:id/state`. Unfinished shorts appear in `/api/next` and the brief; the app has a 숏폼 tab with the video and step list.

## Lessons (2026-11-12, EP1-EP4 shorts)
- Center-only 9:16 crops lost the subject; pans between subjects made viewers dizzy. The framed 4:3 layout with still shots solved both.
- Keyframe stills often carry the exact image a line needs (sun+moon, moon alone, Milky Way) even when no video clip does: check image shots in the subject sheets.
- Caption chunks: break at punctuation, ≤ 4 words (5-word clauses kept whole), never end on a function word; the same chunking lives in `scripts/lib/shorts.mjs` and the component (keep both in sync).
- Anchors are searched in order: a later anchor never matches a word before the previous one (EP4 "This" once matched "this" in the first sentence and made a negative-length shot; now a QC problem).
- `emphasis` marks every occurrence of a word: never add common words ("her" turned "her husband with her" gold).
- Avoid using the same shot three times in one short; pick another scene shot or a keyframe still.
- Caption timing is estimated from character share of each line (not word-aligned); fine for 2-4 word chunks.
