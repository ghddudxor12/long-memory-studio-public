# Aside skills (example)

These are the three [Aside](https://asidehq.com) agent skills that operate Long Memory Studio day to day, shared as
real-world examples. They are copies of a working setup with personal values replaced by placeholders
(`<repo>`, `<workspace>`, `<google-account>`, `<YOUR_CHANNEL_ID>`, `<YOUR_FLOW_PROJECT_ID>` ...). They also keep the
channel's own decisions and incident notes (dates, limits observed, what failed): read them as a worked example,
then rewrite the rules for your own project.

## Structure

```
aside-skills/
├── longform-studio/        orchestrator: pipeline, gates, app API, upload/archive, release schedule, decisions log
│   └── SKILL.md
├── longform-flow-veo/      Google Flow video jobs: model policy, submit, collect, upscale, block handling
│   └── SKILL.md
└── longform-gpt-images/    keyframe / end-frame / asset images (Codex CLI by default, ChatGPT web as fallback)
    └── SKILL.md
```

How the pieces fit together:

```mermaid
flowchart TD
  U[User request<br/>e.g. "continue EP011"] --> O[longform-studio<br/>orchestrator skill]
  O -->|GET /api/agent/brief, /api/next| A[Long Memory Studio app<br/>127.0.0.1:5178]
  O -->|keyframes, end frames, assets| G[longform-gpt-images]
  O -->|video clips| F[longform-flow-veo]
  G -->|POST /api/queue/:job/run-local| A
  F -->|eval /api/agent/helpers.js<br/>freshOne, collectShot| B[Browser: Google Flow]
  F -->|node scripts/flow-ingest.mjs| A
  O -->|ytUpload, langLoop, ytSchedule| Y[Browser: YouTube Studio]
  A --> W[(Workspace folder<br/>episode.json, _app/, media)]
```

- **Skill = instructions, app = state.** The skills tell the agent what to do and which rules apply; every result
  (jobs, approvals, clips, uploads, blockers) is written to the app so a fresh agent context can resume from
  `GET /api/agent/brief` without the previous conversation.
- **Browser helpers live in the repo** (`agent/repl_helpers.js`, served at `/api/agent/helpers.js`), not in the skill
  folders, so there is one source of truth. The original setup kept a fallback copy in `longform-studio/scripts/`.
- **The orchestrator owns the decisions log.** User rulings (approval delegation, upload limits, caption policy,
  "never shorten the script", pacing for Flow) are recorded in `longform-studio/SKILL.md` and repeated in
  `docs/agent-rules.md`, which the app serves inside the brief.

## Installing in Aside

Copy a skill folder to `~/.aside/u/0/skills/user/<skill-name>/` (the folder name must match `name:` in the SKILL.md
front matter), then replace the placeholders. Aside lists user skills to the agent by their `description`, so keep
that line specific about when the skill should be read.

## Minimal template

```markdown
---
name: "my-video-studio"
description: "When to read this skill (one sentence the agent can match against a request)."
---

# My video studio

Reply language, tone and hard rules (what needs the user's approval, what is never automated).

## Start here
GET http://127.0.0.1:5178/api/agent/brief, then load the browser helpers.

## Pipeline and gates
Steps, who acts at each step, approval gates.

## Procedures
One section per recurring task (render, package, upload, archive), each with the exact commands.

## Decisions log
Dated user decisions and observed platform limits, newest first.
```
