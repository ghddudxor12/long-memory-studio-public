---
name: "longform-gpt-images"
description: "Long Memory Studio의 gpt-keyframe / gpt-endframe / gpt-asset 작업을 Codex CLI(기본) 또는 ChatGPT 웹으로 처리하는 절차. 키프레임·끝 프레임·에셋 기준 이미지 생성 작업을 실행할 때 읽는다."
---

# GPT images for Long Memory Studio jobs

Input comes only from the job file (`input.prompt`, `input.refs`, `output.dir/name`). Do not rewrite the prompt; add only what the job's `extra` already contains. If `input.warnings` is non-empty, tell the user before generating and continue only if they accept.

## ChatGPT web (backend `chatgpt-web`)
1. Account: open chatgpt.com, check `/api/auth/session` → must be google-account@example.com with a paid plan (naver account is Free). Do not trust the sidebar label.
2. One conversation per episode: reuse `production.tools.chatgptConversation` (`GET /api/episodes/<ID>`); if missing, create one and save it with `PATCH /api/episodes/<ID>/meta {"chatgptConversation":"<id>"}`. Series assets use the series' latest episode conversation.
3. Attach references: upload each `input.refs[].file` (series refs live in `<series>/00_시리즈공통/`, episode refs in the episode folder; `base` tells which) through the composer's file chooser. For end frames the first ref is the start frame: say "same shot 8 seconds later, same camera and wardrobe".
4. Prompt box is contenteditable: click it, `keyboard.insertText(prompt)`, then click the Send button (Enter alone sometimes leaves the text unsent). If Send stays disabled in a long conversation, reload once; if still stuck, start a new conversation for the episode and update meta.
5. Wait for the new image: record the last image `src` before sending, then poll until an image **after your request message** has a new src (alt text is always "생성된 이미지 1"; the right-side output panel lags behind). ~40-60 s per image.
6. Save: fetch the image bytes in the page and write them with REPL `fs` to `<base dir>/<output.dir>/<output.name>` (create the dir). PNG at full size.
7. `POST /api/queue/<id>/complete {"credits":0}`. If the server answers `validation-failed` with "new: 이미 있는 파일과 같음", you grabbed an older image: fetch again, overwrite, and create a new job (do not reuse a failed job).
8. Refusals → `fail {"category":"policy-refused"}`; UI that no longer matches these steps → `ui-changed`; no image after 3 min → `timeout`.

## Codex (backend `codex-local`, default since 2026-11-04)
Tested: `codex exec` with the ChatGPT subscription generates one 1672x941 PNG in ~60 s, references attached with `-i` are respected (God from behind, curly hair, no sash, no sun disc on the first try).
- Run: `node scripts/codex-image.mjs <jobId>` in the repo, or the app does it (`POST /api/queue/<id>/run-local`, 생성 탭 "Codex (바로 실행)"). The script starts the job, runs Codex with `CODEX_HOME=~/.codex`, copies the newest PNG from `~/.codex/generated_images/<session>/` to the job output and completes it.
- Run in the foreground (a backgrounded Bash child is killed when the command returns). One Codex job at a time.
- Usage limit is ample on the user's plan (confirmed 2026-11-04, ≈23k tokens per image). If a "usage limit" ever appears the job fails as `quota` → retry later or switch the job to `chatgpt-web`.

## Prompt rules that held on EP001
- Describe light positively ("sourceless glow evenly across the clouds"); never write sun/dawn/sunrise/burst for scenes before Day Four, not even as a negative.
- God: from behind, thick tightly curled white ringlets, ivory/pale rose robe, no sash. For shots that will become video, frame shoulders-up so the waist is out of frame.
- Humans: back view or backlit silhouette only. Hands: five fingers with a visible thumb. No underwater/soil cross-sections. Figs, never apples. No text in images.
