// Long Memory Studio REPL helpers (source of truth: repo agent/repl_helpers.js, served by the app). Load in the Aside REPL with:
//   eval(await (await fetch('http://127.0.0.1:5178/api/agent/helpers.js')).text())
//   (fallback copy: skills/user/longform-studio/scripts/repl_helpers.js)
// then: await lmsAttach()  (binds FLOWTAB, FMTAB, YTTAB to open tabs or opens them)
globalThis.API = 'http://127.0.0.1:5178/api';
globalThis.SES = '/Users/YOU/.aside/u/0/sessions/SESSION_FOLDER/';
// upload staging must live in the CURRENT session dir (setFiles rejects paths outside it); SES stays the old production session (scripts, script.json, frames)
// (eval cannot use await, so lmsPaths() runs inside lmsAttach(); call it yourself if you skip lmsAttach)
globalThis.lmsPaths = async () => { let d = null; try { const id = aside.sessions.current()?.id; d = (await fs.readdir('/Users/YOU/.aside/u/0/sessions/')).find((x) => id && x.endsWith('_' + id)); } catch {}
  globalThis.CURSES = d ? '/Users/YOU/.aside/u/0/sessions/' + d + '/' : SES; globalThis.YT2 = CURSES + 'tmp/yt2/'; globalThis.FLOWTMP = CURSES + 'tmp/flow/'; globalThis.SHEETDIR = CURSES + 'tmp/sheets/'; return CURSES; };
globalThis.FLOWURL = 'https://flow.google.com/project/YOUR_FLOW_PROJECT_ID';
globalThis.WS = '/Users/YOU/Library/CloudStorage/GoogleDrive-you@example.com/내 드라이브/The Long Memory/01_The Bible in Order/';
globalThis.post = async (p, body) => (await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();
globalThis.ref = (tree, re) => tree.match(re)?.[1];
globalThis.snapI = async () => (await snapshot(page, { interactive: true })).tree;
globalThis.epDir = async (ep) => { const cfg = JSON.parse(await fs.readFile('/Users/YOU/long-memory-studio/studio.config.json', 'utf8')); return '/Users/YOU/Library/CloudStorage/GoogleDrive-you@example.com/내 드라이브/The Long Memory/' + cfg.episodes[ep] + '/'; };
globalThis.epTag = (ep) => ep.replace('BIB-GEN-00', 'EP');
globalThis.lmsAttach = async () => {
  await lmsPaths(); const bt = await listBrowserTabs();
  const pick = async (re, url) => { const t = bt.find((x) => re.test(x.url || '')); return t ? await attachBrowserTab(t.targetId) : await openTab(url); };
  globalThis.FLOWTAB = await pick(/flow\.google\.com\/project\/YOUR_FLOW_PROJECT_ID/, FLOWURL);
  globalThis.FMTAB = await pick(/flowmusic\.app\/session/, 'https://www.flowmusic.app/');
  globalThis.YTTAB = await pick(/studio\.youtube\.com\/(channel|video)/, 'https://studio.youtube.com/channel/YOUR_CHANNEL_ID/videos/upload');
  page = FLOWTAB; return 'ok';
};
// ---------- Flow submit ----------
globalThis.flowPrep = async () => { await page.keyboard.press('Escape').catch(()=>{}); let t = await snapI(); const clr = ref(t, /button "프롬프트 지우기" \[ref=(e\d+)\]/); if (clr) { await page.locator(clr).click().catch(()=>{}); await sleep(400); t = await snapI(); } return t; };
globalThis.flowSubmit = async (job, opts = {}) => {
  const ep = job.episode, tag = epTag(ep), key = job.target.shot; const dir = await epDir(ep);
  const sv = (job.input.start.file.match(/_v(\d+)/) || [])[1] || '1', evv = (job.input.end?.file?.match(/_v(\d+)/) || [])[1] || '1';
  const sName = `${tag}_${key}_START_v${sv}.png`, eName = `${tag}_${key}_END_v${evv}.png`;
  await fs.mkdir(FLOWTMP, { recursive: true }); await fs.copyFile(dir + job.input.start.file, FLOWTMP + sName); await fs.copyFile(dir + job.input.end.file, FLOWTMP + eName);
  let t = await flowPrep();
  if (!opts.skipUpload) {
    await page.locator(ref(t, /button "미디어 메뉴 추가" \[ref=(e\d+)\]/)).click(); await sleep(800); t = await snapI();
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.locator(ref(t, /menuitem "업로드" \[ref=(e\d+)\]/)).click()]);
    await fc.setFiles([FLOWTMP + sName, FLOWTMP + eName]);
    for (let i = 0; i < 20; i++) { await sleep(1500); t = await snapI(); if (t.includes(`"${sName}"`) && t.includes(`"${eName}"`)) break; }
    const agree = ref(t, /button "동의" \[ref=(e\d+)\]/); if (agree) { await page.locator(agree).click(); await sleep(650); }
  }
  for (let i = 0; i < 40; i++) { const tx = await page.evaluate(() => document.body.innerText); if (!/\d+%/.test(tx) && !/업로드 중/.test(tx)) break; await sleep(1500); }
  t = await snapI(); await page.locator(ref(t, /button "설정 트리거" \[ref=(e\d+)\]/)).click(); await sleep(650);
  for (const re of [/radio "동영상" \[ref=(e\d+)\]/, /radio "프레임" \[ref=(e\d+)\]/, /radio "720p" \[ref=(e\d+)\]/, /radio "x1" \[ref=(e\d+)\]/]) { t = await snapI(); const r = ref(t, re); if (r) await page.locator(r).click().catch(()=>{}); await sleep(250); }
  t = await snapI();
  const model = t.match(/button "모델 제품군 선택" \[ref=e\d+\]: "([^"]*)"/)?.[1], cost = t.match(/link "(\d+) 크레딧"/)?.[1] || t.match(/(\d+) 크레딧/)?.[1], trig = t.match(/button "설정 트리거" \[ref=e\d+\]: "([^"]*)"/)?.[1];
  if (model !== 'Omni 1.2 Flash' || !/720p/.test(trig || '') || !/x1/.test(trig || '')) return { ok: false, why: `settings mismatch: ${model} ${cost} ${trig}` };
  await page.keyboard.press('Escape'); await sleep(500);
  for (const [slot, file] of [['시작', sName], ['종료', eName]]) {
    t = await snapI(); const sl = ref(t, new RegExp(`button "${slot}" \\[ref=(e\\d+)\\]`)); if (!sl) return { ok: false, why: 'no slot ' + slot };
    await page.locator(sl).click(); await sleep(800); t = await snapI();
    const op = ref(t, new RegExp(`option "${file.replace(/[.]/g, '\\.')}" \\[ref=(e\\d+)\\]`)); if (!op) return { ok: false, why: 'no option ' + file };
    await page.locator(op).click({ timeout: 5000 }).catch(()=>{}); await sleep(650); t = await snapI();
    const add = ref(t, /button "프롬프트에 추가" \[ref=(e\d+)\]/); if (add) { await page.locator(add).click({ timeout: 5000 }).catch(()=>{}); await sleep(650); }
  }
  t = await snapI(); if ((t.match(/button "이미지 소재"/g) || []).length < 2) return { ok: false, why: 'frames not attached' };
  await page.locator(ref(t, /textbox "무엇을 만들고 싶으신가요\?" \[ref=(e\d+)\]/)).click(); await page.keyboard.insertText(job.input.prompt); await sleep(600);
  t = await snapI(); const go = ref(t, /button "생성 시작" \[ref=(e\d+)\]/); if (!go) return { ok: false, why: 'no 생성 시작 (credits?)' };
  await page.locator(go).click(); await sleep(1800); return { ok: true, cost, submittedAt: new Date().toISOString() };
};
globalThis.runJob = async (j) => {
  const st = (await (await fetch(API + '/queue?episode=' + j.episode)).json()).find((x) => x.id === j.id);
  if (!st.approvedAt) await post(`/queue/${j.id}/approve`, { by: 'aside', note: '사용자 위임 2026-11-10' });
  if (st.status !== 'running') await post(`/queue/${j.id}/start`, { by: 'aside' });
  const T = Date.now(); let why = '';
  for (let a = 0; a < 2; a++) {
    if (a > 0 && Date.now() - T > 40000) { why += ' | no time for a retry in this call'; break; } // keep one REPL call under 120 s
    try { const r = await flowSubmit(j, { skipUpload: a === 0 ? false : false }); if (r.ok) return r; why = r.why; console.log('retry', r.why); } catch (e) { why = String(e).slice(0, 120); console.log('err', why); }
    await page.keyboard.press('Escape').catch(()=>{}); await page.goto(FLOWURL); await sleep(6000);
  }
  return { ok: false, why };
};
// submit one job from the list after a fresh page load; returns shot + top tile status
// accepts a full job object, a /api/flow/plan item ({job, episode, shot}) or a job id string
globalThis.lmsJob = async (x) => { if (x && x.target && x.input) return x; const id = typeof x === 'string' ? x : x?.job || x?.id; const ep = (typeof x === 'object' && x.episode) || (id.match(/^\d{8}-\d{6}_(.+)_flow-veo_/) || [])[1]; const j = (await (await fetch(API + '/queue?episode=' + ep)).json()).find((q) => q.id === id); if (!j) throw new Error('no job ' + id); return j; };
// submits ONE job. Reads /api/flow/plan first: returns without submitting when a Flow block is recorded or the 75 s gap has not passed.
globalThis.freshOne = async (list) => { const pl = await (await fetch(API + '/flow/plan')).json(); if (pl.block) return 'BLOCKED (not submitted): ' + pl.block.message + ' @ ' + pl.block.at + '. Retry one job much later after POST /api/flow/block {clear:true}'; if (!pl.canSubmitNow) return 'WAIT (not submitted): next submit at ' + pl.nextSubmitAt;
  const j0 = list.shift(); if (!j0) return 'empty'; const j = await lmsJob(j0); page = FLOWTAB; await page.goto(FLOWURL); for (let i = 0; i < 20; i++) { await sleep(1500); if ((await snapI()).includes("미디어 메뉴 추가")) break; } await sleep(1500); const r = await runJob(j);
  // not submitted: put the job back to approved (server allows running -> approved) so it is not left as a ghost "running" job
  if (!r.ok) { list.unshift(j0); await post(`/queue/${j.id}/approve`, { by: 'aside', note: 'submit failed, released: ' + (r.why || '') }); return j.target.shot + ' NOT SUBMITTED (released): ' + (r.why || 'unknown') + '. Call freshOne again.'; }
  await post(`/queue/${j.id}/submitted`, { at: r.submittedAt, cost: r.cost }); await sleep(12000); const g = await gridMap2();
  if (g[0]?.fail && /비정상/.test(g[0].fail)) await post('/flow/block', { message: g[0].fail }); // app shows the block; stop submitting
  return j.target.shot + ' ' + JSON.stringify(r) + ' | top: ' + (g[0]?.fail ? 'FAIL ' + g[0].fail : (g[0]?.pct || 'ok')); };
// start of every session: rules + live state + next actions (markdown)
globalThis.lmsBrief = async () => (await fetch(API + '/agent/brief')).text();
globalThis.lmsNext = async () => (await fetch(API + '/next')).json();
globalThis.flowPlan = async () => (await fetch(API + '/flow/plan')).json();
// ---------- Flow grid ----------
globalThis.scrollEl = () => page.evaluate(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible'); return !!s; });
globalThis.toGrid = async () => { page = FLOWTAB; if (!/\/project\/[^/]+$/.test(page.url().split('?')[0])) { await page.goto(FLOWURL); await sleep(6000); } return true; };
globalThis.gridLabels = async (pages = 8) => { await page.evaluate(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible'); if (s) s.scrollTop = 0; }); await sleep(800); const out = [];
  for (let k = 0; k < pages; k++) { const ls = await page.evaluate(() => [...document.querySelectorAll('[role="group"]')].map((g) => ({ l: g.getAttribute('aria-label'), t: g.innerText.slice(0, 120) }))); for (const x of ls) if (!out.find((o) => o.l === x.l)) out.push(x);
    const more = await page.evaluate(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible'); if (!s) return false; const b = s.scrollTop; s.scrollTop += 600; return s.scrollTop > b; }); await sleep(500); if (!more) break; }
  return out; };
// map of "EPn:Sxx-xx" -> {title, pct, fail}; video tile precedes its START/END uploads
globalThis.gridMap2 = async () => { const ls = await gridLabels(1); const out = []; let cur = null; for (const x of ls) { const fm = x.l.match(/^(EP[\d-]+|BIB-GEN-[\d-]+)_(S\d\d-\d\d)_(START|END)(?:_v\d+)?\.png$/); if (fm) { if (cur && !cur.shot) cur.shot = fm[1] + ':' + fm[2]; continue; } cur = { title: x.l, pct: x.t.match(/(\d+%)/)?.[1], fail: /실패/.test(x.t) ? x.t.replace(/\n/g, ' ').slice(0, 80) : null }; out.push(cur); } return out; };
globalThis.fullMap = async (re, pages = 12) => { const ls = await gridLabels(pages); const acc = {}; let cur = null; for (const x of ls) { const fm = x.l.match(/^(EP[\d-]+|BIB-GEN-[\d-]+)_(S\d\d-\d\d)_(START|END)(?:_v\d+)?\.png$/); if (fm) { if (cur && !cur.shot) { cur.shot = fm[1] + ':' + fm[2]; if (re.test(cur.shot) && !acc[cur.shot]) acc[cur.shot] = cur; } continue; } cur = { title: x.l, pct: x.t.match(/(\d+%)/)?.[1], fail: /실패/.test(x.t) }; } return acc; };
// ---------- Flow collect (edit view sidebar) ----------
// titles: video tile titles (aria labels). Opens the first via grid, then uses the edit-view sidebar buttons.
// Clicks 720p original + 1080p upscale for each; files land in ~/Downloads (<Title>_<hash>.mp4 / _1080p.mp4); then run /tmp/move_clips.mjs.
globalThis.collectTitles = async (titles, budget = 100000) => { const st = Date.now(); const done = [];
  page = FLOWTAB; if (!/\/edit\//.test(page.url())) { await page.goto(FLOWURL); await sleep(6000); let t = await snapI(); const gi = t.indexOf(`group "${titles[0]}"`); if (gi < 0) return { err: 'not in grid view: ' + titles[0] }; await page.locator(t.slice(gi).split('\n').slice(0, 3).join('\n').match(/\[ref=(e\d+)\]/)[1]).click(); await sleep(3000); }
  for (const ti of titles) { if (Date.now() - st > budget - 15000) break;
    let t = await snapI(); const b = ref(t, new RegExp(`button "${ti.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" \\[ref=(e\\d+)\\]`)); if (!b) { console.log('no sidebar', ti); continue; }
    await page.locator(b).click(); await sleep(2500);
    for (const q of ['720p 원본 크기', '1080p 업스케일링됨']) { t = await snapI(); const dlb = ref(t, /button "미디어 다운로드" \[ref=(e\d+)\]/); if (!dlb) { console.log("no dl button", ti); break; } await page.locator(dlb).click(); await sleep(900); t = await snapI(); const mi = ref(t, new RegExp(`menuitem "${q}" \\[ref=(e\\d+)\\]`)); if (mi) await page.locator(mi).click(); await sleep(2500); }
    done.push(ti); }
  return done; };
// ---------- YouTube scheduled publish ----------
// ytSchedule('<videoId>', '2026. 11. 12.', '오전 6:00', '뉴욕(GMT-05:00)') on the video edit page; returns visibility label after save
globalThis.ytSchedule = async (vid, date, time = '오전 6:00', tz = '뉴욕(GMT-05:00)') => {
  page = YTTAB; await page.goto(`https://studio.youtube.com/video/${vid}/edit`); for (let i = 0; i < 15; i++) { await sleep(1000); if ((await snapI()).includes('동영상 공개 상태 수정')) break; }
  let t = await snapI(); await page.locator(ref(t, /button "동영상 공개 상태 수정" \[ref=(e\d+)\]/)).click(); await sleep(1500);
  t = await snapI(); let di = t.indexOf('dialog "동영상 공개 설정 선택"'); let d = t.slice(di);
  if (!/공개로 예약/.test(d)) { const ex = [...d.matchAll(/button "Click to expand" \[ref=(e\d+)\]/g)].map((m) => m[1]); await page.locator(ex[ex.length - 1]).click(); await sleep(1200); t = await snapI(); d = t.slice(t.indexOf('dialog "동영상 공개 설정 선택"')); }
  if (!d.includes(`button "${tz}"`)) { await page.locator(ref(d, /button "시간대" \[ref=(e\d+)\]/) || ref(d, /button "[^"]*\(GMT[^"]*\)" \[ref=(e\d+)\]/)).click(); await sleep(1000); await page.evaluate((z) => { const it = [...document.querySelectorAll('tp-yt-paper-item, [role="option"]')].find((x) => x.innerText.trim() === z); it?.scrollIntoView(); it?.click(); }, tz); await sleep(900); t = await snapI(); d = t.slice(t.indexOf('dialog "동영상 공개 설정 선택"')); }
  await page.locator(ref(d, /button "\d{4}\. \d+\. \d+\." \[ref=(e\d+)\]/)).click(); await sleep(1000); t = await snapI();
  const dt = ref(t, /textbox "\d{4}\. \d+\. \d+\." \[ref=(e\d+)\] \[focused\]/) || ref(t.slice(t.lastIndexOf('- dialog:')), /textbox "[^"]*" \[ref=(e\d+)\]/); await page.locator(dt).fill(date); await page.keyboard.press('Enter'); await sleep(800);
  t = await snapI(); const tb = ref(t, /textbox "오[전후] \d+:\d\d" \[ref=(e\d+)\]/); await page.locator(tb).click(); await page.locator(tb).fill(time); await page.keyboard.press('Enter'); await sleep(800);
  t = await snapI(); d = t.slice(t.indexOf('dialog "동영상 공개 설정 선택"')); const chk = { date: d.match(/button "(\d{4}\. \d+\. \d+\.)"/)?.[1], time: d.match(/textbox "(오[전후] \d+:\d\d)"/)?.[1], tz: d.match(/button "([^"]*\(GMT[^"]*\))"/)?.[1] };
  if (chk.date !== date || chk.time !== time || chk.tz !== tz) { await page.keyboard.press('Escape'); return { ok: false, chk }; }
  await page.locator(ref(d, /button "완료" \[ref=(e\d+)\]/)).click(); await sleep(1500); t = await snapI(); const sv = ref(t, /button "저장" \[ref=(e\d+)\]/); if (sv) await page.locator(sv).click(); await sleep(3000);
  t = await snapI(); return { ok: /예약됨/.test(t) && /모든 변경사항이 저장/.test(t), chk };
};
// ---------- English auto captions (asr) ----------
// delAutoEn only clicks the options button of the "자동 자막" row (2026-11-11: a looser selector deleted EP3's MANUAL English once).
// It refuses to act when the video-language row has no published manual caption: EP1 keeps its manual English as en-US, the
// en row stays empty, and YouTube re-creates en asr after every delete. Deletes stuck only on EP3/EP5/2-2/10-1; on EP1/2-1/4/6/7/8/9
// YouTube re-created the asr at once. User decision 2026-11-11: try once at upload, verify with watchTracks, and if it returns leave it.
globalThis.delAutoEn = async (vid) => {
  page = YTTAB; await page.goto(`https://studio.youtube.com/video/${vid}/translations`); for (let i = 0; i < 15; i++) { await sleep(1000); if ((await snapI()).includes('region "동영상 언어')) break; }
  let t = await snapI(); await page.locator(ref(t.slice(t.indexOf('region "동영상 언어')), /button "세부정보" \[ref=(e\d+)\]/)).click(); await sleep(2500);
  t = await snapI(); const media = t.slice(t.indexOf('region "미디어"'), t.indexOf('region "미리보기"'));
  // only the button that directly follows the "자동 자막" row text + its status; never the manual row
  const m = media.match(/text: "자동 자막[^"]*"\n\s+- status "[^"]*" \[ref=e\d+\]\n\s+- button "자막 옵션 표시" \[ref=(e\d+)\]/);
  const close = async () => { const tt = await snapI(); const c = ref(tt, /button "취소" \[ref=(e\d+)\]/); if (c) await page.locator(c).click().catch(()=>{}); };
  if (!m) { await close(); return /자동 자막/.test(media) ? 'auto row without options' : 'no auto'; }
  if (!/text: "수동 자막[^"]*"\n\s+- status "게시됨"/.test(media)) { await close(); return 'SKIP: no published manual caption in the video-language row (upload manual first)'; }
  await page.locator(m[1]).click(); await sleep(900); t = await snapI(); await page.locator(ref(t, /option "삭제" \[ref=(e\d+)\]/)).click(); await sleep(1200);
  t = await snapI(); await page.locator(ref(t.slice(t.lastIndexOf('dialog "자막 삭제"')), /button "자막 삭제" \[ref=(e\d+)\]/)).click(); await sleep(2000);
  t = await snapI(); const after = t.slice(t.indexOf('region "미디어"'), t.indexOf('region "미리보기"'));
  if (!/text: "수동 자막[^"]*"\n\s+- status "게시됨"/.test(after)) { await close(); return 'ABORT: manual row changed, not saved'; }
  const up = ref(t, /button "업데이트" \[ref=(e\d+)\](?! \[disabled\])/); if (up) await page.locator(up).click(); await sleep(3000); return 'deleted';
};
globalThis.enRowState = async (vid) => { page = YTTAB; await page.goto(`https://studio.youtube.com/video/${vid}/translations`); for (let i=0;i<15;i++){ await sleep(1000); if ((await snapI()).includes('region "동영상 언어')) break; }
  let t = await snapI(); const head = t.match(/region "동영상 언어: ([^"]+)"/)?.[1];
  await page.locator(ref(t.slice(t.indexOf('region "동영상 언어')), /button "세부정보" \[ref=(e\d+)\]/)).click(); await sleep(2500);
  const txt = await page.evaluate(()=>{ const d=[...document.querySelectorAll('ytcp-dialog, tp-yt-paper-dialog, [role="dialog"]')].find(x=>x.offsetParent!==null && /미디어/.test(x.innerText)); const s=d.innerText.replace(/\s+/g,' '); const i=s.indexOf('유형 이름 출처 상태 작업'); return s.slice(i+14, s.indexOf('미리보기', i)); });
  t = await snapI(); const c = ref(t, /button "취소" \[ref=(e\d+)\]/); if (c) await page.locator(c).click().catch(()=>{}); await page.keyboard.press('Escape').catch(()=>{});
  return head + ' | ' + txt.trim(); };
globalThis.asrAudit = async (vids) => { const out = {}; for (const [k, v] of Object.entries(vids)) out[k] = await watchTracks(v).catch(() => 'ERR'); page = YTTAB; return out; };
globalThis.watchTracks = async (vid) => { const w = await openTab('https://www.youtube.com/watch?v=' + vid); await sleep(4000); const r = await w.evaluate(() => { const tr = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []; return { n: tr.length, asr: tr.filter((x) => x.kind === 'asr').length, priv: window.ytInitialPlayerResponse?.videoDetails?.isPrivate }; }); await closeTab(w); return r; };
// ---------- review sheet: labelled image grid (files = absolute jpg/png paths) ----------
// NEVER embed images as base64 data: URLs (2026-11-11: a 35-image data URL put ~1 MB into the transcript via the
// tab-closed notice and broke the session). file:// is blocked in the REPL browser, so images are served by a tiny
// static server: start it with Bash `nohup <node> <repo>/agent/lms_static.mjs &` (port 5199, GET /f/<abs path>, read-only,
// limited to sessions/ and CloudStorage/). Returns a JPEG buffer (display(buf) only; never console.log it).
globalThis.sheet = async (files, cols = 5, w = 400, name = 'sheet') => { const dir = SHEETDIR; await fs.mkdir(dir, { recursive: true }); const rh = Math.round(w * 0.5625);
  const parts = files.map((f) => `<div style="position:relative;width:${w}px;height:${rh}px;overflow:hidden"><img src="http://127.0.0.1:5199/f${encodeURI(f)}" style="width:${w}px;height:${rh}px;object-fit:cover;display:block"><span style="position:absolute;left:3px;top:2px;background:#000a;color:#fff;font:12px sans-serif;padding:1px 3px">${path.basename(f).replace(/\.(jpg|png)$/, '')}</span></div>`);
  const html = `<html><body style="margin:0;background:#111;overflow:hidden"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);grid-auto-rows:${rh}px;gap:3px">${parts.join('')}</div></body></html>`;
  const hp = dir + name + '.html'; await fs.writeFile(hp, html); const rows = Math.ceil(files.length / cols);
  const tp = await openTab('http://127.0.0.1:5199/f' + encodeURI(hp)); await tp.setViewportSize({ width: cols * (w + 3), height: rows * (rh + 3) }); await sleep(1500);
  const buf = await tp.screenshot({ type: 'jpeg', quality: 70 }); await closeTab(tp); await fs.writeFile(dir + name + '.jpg', buf); return buf; };

globalThis.esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
globalThis.lastDlg = (t) => t.slice(t.lastIndexOf('- dialog'));

// ---------- YouTube upload (restored 2026-11-11 from the old session; tested on EP010-1 <videoId>) ----------
// order: copy mp4/thumbnail/SRTs into YT2 (CURSES tmp, setFiles rejects other dirs) -> ytUpload -> poll the
// '업로드 중' text until gone (keep this tab!) -> ytFinish (private + save) -> check Studio row -> enSub -> langLoop -> ytSchedule
// -> delAutoEn -> watchTracks -> PATCH /upload. SUBDIR holds <ID>.<code>.srt for en + 36 langs and <ID>_metadata.translations.json
// ({code:{title,description}} merged from 1_발행본/번역/*.json). Daily upload limit: on 2026-11-11 the 12th upload in ~24 h showed
// '일일 업로드 한도 도달 (일회성 인증 또는 24시간 대기)' inside the upload dialog and the file did not upload.
globalThis.setText = async (r, text) => { const l = page.locator(r); await l.click(); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); await page.keyboard.insertText(text); await sleep(300); };
globalThis.ytUpload = async (ID, file, thumb, meta, desc) => {
  page = YTTAB; await page.goto('https://studio.youtube.com/channel/YOUR_CHANNEL_ID/videos/upload?d=ud'); await sleep(6000);
  let t = await snapI(); const fsb = ref(t,/button "파일 선택" \[ref=(e\d+)\]/);
  const [fc] = await Promise.all([page.waitForEvent('filechooser', {timeout:15000}), page.locator(fsb).click()]); await fc.setFiles(file); await sleep(9000);
  t = await snapI(); await setText(ref(t,/textbox "동영상을 설명하는 제목 추가[^"]*" \[ref=(e\d+)\]/), meta.title); t = await snapI(); await setText(ref(t,/textbox "시청자에게 동영상에 대해 설명해 주세요[^"]*" \[ref=(e\d+)\]/), desc);
  t = await snapI(); const [ft] = await Promise.all([page.waitForEvent('filechooser', {timeout:10000}), page.locator(ref(t,/button "파일 업로드" \[ref=(e\d+)\]/)).click()]); await ft.setFiles(thumb); await sleep(4000);
  t = await snapI(); await page.locator(ref(t,/button "재생목록 선택" \[ref=(e\d+)\]/)).click(); await sleep(1500);
  await page.evaluate(()=>{ const items=[...document.querySelectorAll('ytcp-checkbox-lit')]; const it = items.find(c=>(c.closest('li')||c.parentElement)?.innerText?.includes('The Bible in Order')); if (it && it.getAttribute('aria-checked')!=='true') it.click(); }); await sleep(800);
  t = await snapI(); await page.locator(ref(t,/button "완료" \[ref=(e\d+)\]/)).click(); await sleep(1000);
  t = await snapI(); await page.locator(ref(t,/button "고급 설정 표시" \[ref=(e\d+)\]/)).click(); await sleep(1500);
  t = await snapI(); await page.locator(ref(t,/radio "아니요, 동영상에 유료 프로모션이 포함되어 있지 않습니다." \[ref=(e\d+)\]/)).click(); await page.locator(ref(t,/radio "예, AI가 사용되었습니다." \[ref=(e\d+)\]/)).click();
  await page.locator(ref(t,/textbox "태그" \[ref=(e\d+)\]/)).click(); for (const tg of meta.tags) { await page.keyboard.type(tg, {delay: 5}); await page.keyboard.press('Enter'); await sleep(100); }
  await sleep(800); t = await snapI(); const tagLen = t.match(/(\d+)\/500/)?.[1]; const pl = t.match(/button "재생목록 선택" \[ref=e\d+\]:\n\s+- button "([^"]+)"/)?.[1];
  const link = await page.evaluate(()=>[...document.querySelectorAll('a')].map(a=>a.href).find(h=>/youtu\.be\//.test(h)));
  return { tagLen, playlist: pl, link };
};
globalThis.ytFinish = async () => { page = YTTAB; let p=''; for (let i=0;i<60;i++) { p = await page.evaluate(()=>document.querySelector('ytcp-uploads-dialog ytcp-video-upload-progress')?.innerText||''); if (!/업로드 중/.test(p)) break; await sleep(5000); } if (/업로드 중/.test(p)) return 'still uploading: '+p;
  for (let i=0;i<3;i++) { await page.evaluate(()=>document.querySelector('ytcp-uploads-dialog #next-button')?.click()); await sleep(2500); }
  await page.evaluate(()=>{ const r=[...document.querySelectorAll('ytcp-uploads-dialog tp-yt-paper-radio-button')].find(x=>/비공개/.test(x.innerText)&&x.getAttribute('name')==='PRIVATE'); if (r) r.click(); }); await sleep(800);
  await page.evaluate(()=>document.querySelector('ytcp-uploads-dialog #done-button')?.click()); await sleep(4000); return 'saved after: '+p; };
globalThis.enSub = async (VID, SUBDIR, ID) => { await page.goto(`https://studio.youtube.com/video/${VID}/translations`); await sleep(6000);
  let t = await snapI(); await page.locator(ref(t,/button "수동 업로드" \[ref=(e\d+)\]/)).click(); await sleep(1500); t = await snapI();
  const [fc] = await Promise.all([page.waitForEvent('filechooser', {timeout:10000}), page.locator(ref(t,/button "계속" \[ref=(e\d+)\]/)).click()]); await fc.setFiles(`${SUBDIR}${ID}.en.srt`); await sleep(5000);
  await page.reload(); await sleep(6000); t = await snapI(); await page.locator(ref(t,/region "동영상 언어: 영어"[\s\S]*?button "세부정보" \[ref=(e\d+)\]/)).click(); await sleep(2500);
  t = await snapI(); const mm = t.match(/text: "수동 자막[^"]*"\n\s+- status "임시본" \[ref=e\d+\]\n\s+- button "자막 옵션 표시" \[ref=(e\d+)\]/);
  if (mm) { await page.locator(mm[1]).click(); await sleep(800); t = await snapI(); await page.locator(ref(t,/option "게시" \[ref=(e\d+)\]/)).click(); await sleep(2000); }
  t = await snapI(); const st = t.match(/status "[^"]+"/g); const up = ref(t,/button "업데이트" \[ref=(e\d+)\](?! \[disabled\])/) || ref(t,/button "취소" \[ref=(e\d+)\]/); await page.locator(up).click(); await sleep(2000); return st; };
globalThis.KO = {"ar":"아랍어","bn":"벵골어","cs":"체코어","da":"덴마크어","de":"독일어(독일)","el":"그리스어","es":"스페인어(라틴 아메리카)","fa":"페르시아어","fi":"핀란드어","fil":"필리핀어","fr":"프랑스어(프랑스)","he":"히브리어","hi":"힌디어","hu":"헝가리어","id":"인도네시아어","it":"이탈리아어","ja":"일본어","ko":"한국어","ms":"말레이어","nb":"노르웨이어","nl":"네덜란드어(네덜란드)","pl":"폴란드어","pt":"포르투갈어(브라질)","ro":"루마니아어","ru":"러시아어","sv":"스웨덴어","sw":"스와힐리어","ta":"타밀어","te":"텔루구어","th":"태국어","tr":"튀르키예어","uk":"우크라이나어","ur":"우르두어","vi":"베트남어","zh-Hans":"중국어(간체)","zh-Hant":"중국어(번체)"};
globalThis.addLang = async (code, TR, SUBDIR, ID) => {
  page = YTTAB; const name = KO[code]; let t = await snapI();
  const rowBtn = ref(t.slice(t.indexOf('region "번역"')), new RegExp(`button "${esc(name)}" \\[ref=(e\\d+)\\]`));
  if (rowBtn) { await page.locator(rowBtn).click(); }
  else {
    await page.evaluate(()=>{ const b=[...document.querySelectorAll('ytcp-button, button')].find(x=>x.innerText?.trim()==='언어 추가'); if (b) b.scrollIntoView({block:'center'}); }); await sleep(500);
    t = await snapI(); await page.locator(ref(t, /button "언어 추가" \[ref=(e\d+)\]/)).click(); await sleep(1200);
    t = await snapI(); const op = ref(t, new RegExp(`option "${esc(name)}" \\[ref=(e\\d+)\\](?! \\[disabled\\])`)); if (!op) return 'no option';
    await page.locator(op).click();
  }
  await sleep(2000); t = await snapI(); let d = lastDlg(t);
  if (!d.includes(`세부정보`)) return 'no details dialog';
  await setText(ref(d, /textbox "제목" \[ref=(e\d+)\]/), TR[code].title);
  await setText(ref(d, /textbox "설명" \[ref=(e\d+)\]/), TR[code].description);
  t = await snapI(); d = lastDlg(t);
  const addB = ref(d.slice(d.indexOf('region "미디어"')), /button "추가" \[ref=(e\d+)\]/);
  if (!addB) { const up = ref(d, /button "업데이트" \[ref=(e\d+)\](?! \[disabled\])/); if (up) await page.locator(up).click(); await sleep(1500); return 'meta only (no 추가)'; }
  await page.locator(addB).click(); await sleep(1500); t = await snapI(); d = lastDlg(t);
  const sv = ref(d, /button "변경사항 저장" \[ref=(e\d+)\]/); if (sv) { await page.locator(sv).click(); await sleep(2500); t = await snapI(); d = lastDlg(t); }
  const fu = ref(d, /button "파일 업로드" \[ref=(e\d+)\]/); if (!fu) return 'no 파일 업로드';
  await page.locator(fu).click(); await sleep(1500); t = await snapI(); d = lastDlg(t);
  const cont = ref(d, /button "계속" \[ref=(e\d+)\]/);
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.locator(cont).click()]);
  await fc.setFiles(`${SUBDIR}${ID}.${code}.srt`);
  for (let i = 0; i < 10; i++) { await sleep(1500); t = await snapI(); if (/button "게시" \[ref=e\d+\]\n\s+- status: "게시 사용 설정됨"/.test(t)) break; }
  const pub = ref(lastDlg(t), /button "게시" \[ref=(e\d+)\]/); await page.locator(pub).click(); await sleep(3000);
  const row = await page.evaluate((n)=>[...document.querySelectorAll('[role="row"], tr')].map(r=>r.innerText.replace(/\s+/g,' ')).find(x=>x.startsWith(n+' ')), name);
  return /1개 게시됨 게시됨/.test(row || '') ? 'ok' : 'check: ' + (row || 'no row');
};
globalThis.langLoop = async (TR, SUBDIR, ID, DONE, budget=100000) => { const st=Date.now(); const out=[]; for (const c of Object.keys(KO)) { if (DONE.includes(c)) continue; if (Date.now()-st > budget-25000) break; const r = await addLang(c, TR, SUBDIR, ID).catch(e=>'ERR '+String(e).slice(0,60)); out.push(c+':'+r); if (r==='ok') DONE.push(c); else { await page.keyboard.press('Escape').catch(()=>{}); await page.reload(); await sleep(5000); } } return [out.join(' '), Object.keys(KO).length - DONE.length]; };

// ---------- Flow collect by shot key (2026-11-11; replaces collectTitles + /tmp/move_clips.mjs) ----------
// Finds the newest video tile directly above <tag>_<shot>_START*.png, opens it (edit id from the URL), downloads 720p + 1080p.
// RESUMABLE: call it repeatedly until it returns done:true (each call <= 90 s). Then run the returned ingest command in Bash: scripts/flow-ingest.mjs moves the files,
// checks 1920x1080, writes 5 review frames to _app/preview/clipcheck/ and completes the app job with flow.editId.
globalThis.collectShot = async (job, opts = {}) => { job = await lmsJob(job);
  // Resumable (2026-11-11): one call works for at most opts.budget ms (default 90 s; the REPL kills a call at 120 s) and returns
  // {done:false, step, next} when time runs out: call collectShot(job) again until done:true. Progress (edit id, download request
  // times) is kept in FLOWTMP/collect_<job>.json, so a later call goes straight to /edit/<id>. opts.reset starts over.
  const budget = opts.budget || 90000, T0 = Date.now(); const left = () => budget - (Date.now() - T0);
  const DL = '/Users/YOU/Downloads/'; const tag = epTag(job.episode), key = job.target.shot, pfx = `${tag}_${key}_START`;
  await fs.mkdir(FLOWTMP, { recursive: true }); const sf = FLOWTMP + 'collect_' + job.id + '.json';
  let st = {}; if (!opts.reset) { try { st = JSON.parse(await fs.readFile(sf, 'utf8')); } catch {} }
  const save = () => fs.writeFile(sf, JSON.stringify(st));
  const again = async (step) => { st.step = step; await save(); return { done: false, step, job: job.id, next: 'call collectShot(job) again' }; };
  const newFiles = async () => { const out = []; for (const f of await fs.readdir(DL)) { if (!f.endsWith('.mp4') || f.endsWith('.crdownload')) continue; const s = await fs.stat(DL + f); if (s.mtimeMs >= st.t0 && f.startsWith(st.stem)) out.push(f); } return out; };
  const got = async () => { const nf = st.t0 ? await newFiles() : []; return { f1080: nf.find((f) => f.endsWith('_1080p.mp4')) || null, f720: nf.find((f) => !f.endsWith('_1080p.mp4')) || null }; };
  const pick = async (label) => { let t = await snapI(); const b = ref(t, /button "미디어 다운로드" \[ref=(e\d+)\]/); if (!b) return false; await page.locator(b).click(); await sleep(900); t = await snapI(); const m = ref(t, new RegExp(`menuitem "${label}" \\[ref=(e\\d+)\\]`)); if (!m) { await page.keyboard.press('Escape').catch(() => {}); return false; } await page.locator(m).click(); return true; };
  page = FLOWTAB;
  // ---- step 1: find the tile (newest video tile directly above <tag>_<shot>_START*.png) and open its edit view
  if (!st.editId) {
    await page.goto(FLOWURL); let loaded = false; for (let i = 0; i < 20 && left() > 20000; i++) { await sleep(1500); if ((await snapI()).includes('미디어 메뉴 추가')) { loaded = true; break; } }
    if (!loaded) return again('open'); // page not ready in this call: never report "tile not found" from an unloaded grid
    let found = null, ended = false;
    for (let k = 0; k < 25 && !found && left() > 12000; k++) {
      found = await page.evaluate((p) => { const gs = [...document.querySelectorAll('[role="group"]')]; gs.forEach((g) => g.removeAttribute('data-lms-target'));
        for (let i = 0; i < gs.length; i++) { const l = gs[i].getAttribute('aria-label') || ''; if (!l.startsWith(p)) continue;
          for (let j = i - 1; j >= 0; j--) { const lj = gs[j].getAttribute('aria-label') || ''; if (/\.png$/i.test(lj)) continue; gs[j].setAttribute('data-lms-target', '1'); const tx = gs[j].innerText; return { title: lj, pct: (tx.match(/(\d+)%/) || [])[1] || null, fail: /실패/.test(tx) ? tx.replace(/\n/g, ' ').slice(0, 80) : null }; }
        } return null; }, pfx);
      if (!found) { const more = await page.evaluate(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible'); if (!s) return false; const b = s.scrollTop; s.scrollTop += 600; return s.scrollTop > b; }); await sleep(600); if (!more) { ended = true; break; } }
    }
    if (!found) return ended ? { err: 'tile not found for ' + pfx } : again('open');
    if (found.fail || found.pct) return { err: found.fail ? 'tile failed: ' + found.fail : 'still generating ' + found.pct + '%', title: found.title };
    st.t0 = Date.now() - 2000; st.title = found.title; st.stem = found.title.replace(/…$/, '').replace(/ /g, '_').slice(0, 20); // Flow names files <Title_with_underscores>…_<hash>[_1080p].mp4
    await page.locator('[data-lms-target="1"] img').first().click(); for (let i = 0; i < 20 && !/\/edit\//.test(page.url()); i++) await sleep(500);
    const editId = page.url().match(/\/edit\/([0-9a-f-]{36})/)?.[1]; if (!editId) return { err: 'edit view did not open', title: found.title };
    st.editId = editId; await save(); await sleep(2000);
  } else if (!page.url().includes(st.editId)) {
    await page.goto(`${FLOWURL}/edit/${st.editId}`); for (let i = 0; i < 12 && left() > 30000; i++) { await sleep(1500); if ((await snapI()).includes('미디어 다운로드')) break; }
  }
  // ---- step 2: 720p original
  let r = await got();
  if (!r.f720) {
    if (left() < 25000) return again('720p');
    if (!st.req720 || Date.now() - st.req720 > 60000) { if (!(await pick('720p 원본 크기'))) return again('720p'); st.req720 = Date.now(); await save(); }
    while (left() > 8000 && !r.f720) { await sleep(1000); r = await got(); }
    if (!r.f720) return again('720p-wait');
  }
  // ---- step 3: 1080p upscale (~1 min). Flow sometimes answers "업스케일링할 수 없습니다": reload and ask again (3 tries)
  if (!r.f1080) {
    if (left() < 15000) return again('1080p');
    if (!st.req1080 || Date.now() - st.req1080 > 45000) { if (st.req1080) { await page.reload(); await sleep(5000); } if ((st.tries1080 || 0) >= 5) return { err: 'upscale failed 3 times', job: job.id, editId: st.editId, f720: DL + r.f720 }; if (!(await pick('1080p 업스케일링됨'))) return again('1080p'); st.req1080 = Date.now(); st.tries1080 = (st.tries1080 || 0) + 1; await save(); }
    while (left() > 6000 && !r.f1080) { await sleep(2500); r = await got(); if (r.f1080) break;
      const tx = await page.evaluate(() => document.body.innerText);
      if (/업스케일링할 수 없습니다/.test(tx) && Date.now() - st.req1080 > 8000) { st.req1080 = 0; await save(); await page.reload(); await sleep(5000); return again('1080p-retry'); } }
    if (!r.f1080) return again('1080p-wait');
  }
  await fs.unlink(sf).catch(() => {});
  const q = (p) => `'${p.replace(/'/g, `'\\''`)}'`;
  return { done: true, job: job.id, editId: st.editId, title: st.title, f1080: DL + r.f1080, f720: DL + r.f720,
    ingest: `node scripts/flow-ingest.mjs ${job.id} ${q(DL + r.f1080)} ${q(DL + r.f720)} --edit ${st.editId}` };
};
// review sheet of the latest collected version per shot (frames written by flow-ingest.mjs)
globalThis.clipSheet = async (ep, shots, name) => { const dir = (await epDir(ep)) + '_app/preview/clipcheck/'; const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.jpg'));
  const files = []; for (const s of shots) { const vs = all.filter((f) => f.startsWith(s + '_v')).map((f) => +f.match(/_v(\d+)_/)[1]); const v = Math.max(...vs); files.push(...all.filter((f) => f.startsWith(`${s}_v${v}_f`)).sort((a, b) => parseFloat(a.match(/_f([\d.]+)\.jpg/)[1]) - parseFloat(b.match(/_f([\d.]+)\.jpg/)[1])).map((f) => dir + f)); }
  return sheet(files, 5, 240, name || `clips_${ep}`); };

// ---------- Paced Flow submit (user instruction 2026-11-12; replaces freshOne for batch work) ----------
// Every UI action (menu click, file choice, settings open/close, slot click, image pick, 프롬프트에 추가, prompt click,
// prompt insert) is followed by a random 3.00-5.00 s pause in 0.01 s steps. Jobs go out back to back without waiting
// for the previous clip to finish, in batches of 5; each submit is checked ~15 s later for a failed tile.
// Observed 2026-11-12: 12-2 (13), 13-1 (11), 13-2 (13) went through with no block; the block came back on about the
// 40th submission of the day (14-1 S02-01, 13:35 KST). Before (fast UI actions) the block came around the 10th.
// On '비정상적인 활동': pacedNext stops, POSTs /flow/block, releases the job (approved) and you rest 2 h+ before 1 test job.
// Usage: const L = await pacedList('BIB-GEN-014-1'); then repeat `await pacedNext(L)` (one REPL call each, ~70 s) until
// it returns {done:true} or {stop:true}. After every 5 submissions call `await pacedCheck(ep)` (tile status).
globalThis.PACE_LOG = globalThis.PACE_LOG || [];
globalThis.pace = async (label) => { const s = Math.round((3 + Math.random() * 2) * 100) / 100; PACE_LOG.push([label, s]); await sleep(s * 1000); return s; };
globalThis.toTop = async () => { await page.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollTop > 0) e.scrollTop = 0; }); }); await sleep(1000); };
globalThis.pacedPrep = async (j) => {
  page = FLOWTAB; const tag = epTag(j.episode), key = j.target.shot, dir = await epDir(j.episode);
  const sv = (j.input.start.file.match(/_v(\d+)/) || [])[1] || '1', ev = (j.input.end.file.match(/_v(\d+)/) || [])[1] || '1';
  const sName = `${tag}_${key}_START_v${sv}.png`, eName = `${tag}_${key}_END_v${ev}.png`;
  await fs.mkdir(FLOWTMP, { recursive: true }); await fs.copyFile(dir + j.input.start.file, FLOWTMP + sName); await fs.copyFile(dir + j.input.end.file, FLOWTMP + eName);
  // always upload a fresh pair: collectShot maps a clip by the video tile directly above its START upload
  let t = await snapI(); await page.locator(ref(t, /button "미디어 메뉴 추가" \[ref=(e\d+)\]/)).click(); await pace('미디어 메뉴');
  t = await snapI(); const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.locator(ref(t, /menuitem "업로드" \[ref=(e\d+)\]/)).click()]);
  await fc.setFiles([FLOWTMP + sName, FLOWTMP + eName]); await pace('파일 선택');
  for (let i = 0; i < 20; i++) { t = await snapI(); if (t.includes(`"${sName}"`) && t.includes(`"${eName}"`)) break; await sleep(1500); }
  for (let i = 0; i < 30; i++) { const tx = await page.evaluate(() => document.body.innerText); if (!/\d+%/.test(tx) && !/업로드 중/.test(tx)) break; await sleep(1500); }
  t = await snapI(); await page.locator(ref(t, /button "설정 트리거" \[ref=(e\d+)\]/)).click(); await pace('설정 열기');
  t = await snapI(); const model = t.match(/button "모델 제품군 선택" \[ref=e\d+\]: "([^"]*)"/)?.[1], cost = t.match(/link "(\d+) 크레딧"/)?.[1];
  const ok = model === 'Omni 1.2 Flash' && /radio "720p" \[ref=e\d+\] \[checked\]/.test(t) && /radio "x1" \[ref=e\d+\] \[checked\]/.test(t) && /radio "프레임" \[ref=e\d+\] \[checked\]/.test(t) && /길이 8초/.test(t);
  await page.keyboard.press('Escape'); await pace('설정 닫기');
  if (!ok || cost !== '24') return { ok: false, why: `settings ${model} ${cost} (set 동영상/프레임/16:9/Omni 1.2 Flash/720p/8초/x1 once by hand)` };
  for (const [slot, file] of [['시작', sName], ['종료', eName]]) {
    t = await snapI(); const sl = ref(t, new RegExp(`button "${slot}" \\[ref=(e\\d+)\\]`)); if (!sl) return { ok: false, why: 'no slot ' + slot };
    await page.locator(sl).click(); await pace(slot + ' 슬롯');
    t = await snapI(); const op = ref(t, new RegExp(`option "${file.replace(/[.]/g, '\\.')}" \\[ref=(e\\d+)\\]`)); if (!op) return { ok: false, why: 'no option ' + file };
    await page.locator(op).click(); await pace(slot + ' 이미지');
    t = await snapI(); const add = ref(t, /button "프롬프트에 추가" \[ref=(e\d+)\]/); if (add) { await page.locator(add).click(); await pace(slot + ' 추가'); }
  }
  t = await snapI(); if ((t.match(/button "이미지 소재"/g) || []).length < 2) return { ok: false, why: 'frames not attached' };
  return { ok: true, cost };
};
globalThis.pacedSubmit = async (j) => {
  page = FLOWTAB; let t = await snapI();
  await page.locator(ref(t, /textbox "무엇을 만들고 싶으신가요\?" \[ref=(e\d+)\]/)).click(); await pace('프롬프트 클릭');
  await page.keyboard.insertText(j.input.prompt); await pace('프롬프트 입력');
  t = await snapI(); if (!/button "생성 시작" \[ref=e\d+\]/.test(t) || /button "생성 시작" \[ref=e\d+\] \[disabled\]/.test(t)) return { ok: false, why: '생성 시작 불가 (credits?)' };
  await page.locator(ref(t, /button "생성 시작" \[ref=(e\d+)\]/)).click(); const at = new Date().toISOString();
  await post(`/queue/${j.id}/submitted`, { at, cost: 24 }); await sleep(15000); const g = await gridMap2();
  return { ok: true, at, top: g[0] };
};
// list of approved jobs of one episode in shot order (the array is consumed by pacedNext)
globalThis.pacedList = async (ep) => (await (await fetch(API + '/queue?episode=' + ep)).json()).filter((j) => j.type === 'flow-veo' && j.status === 'approved' && j.approvedAt).sort((a, b) => a.target.shot.localeCompare(b.target.shot));
// one job per call: prep + submit + quick block check
globalThis.pacedNext = async (list) => {
  const pl = await (await fetch(API + '/flow/plan')).json(); if (pl.block) return { stop: true, msg: 'BLOCKED: ' + pl.block.message + ' @ ' + pl.block.at };
  const j = list.shift(); if (!j) return { done: true }; page = FLOWTAB;
  if (!/\/project\/[^/]+$/.test(page.url().split('?')[0])) { await page.goto(FLOWURL); for (let i = 0; i < 20; i++) { await sleep(1500); if ((await snapI()).includes('미디어 메뉴 추가')) break; } }
  await toTop(); await post(`/queue/${j.id}/start`, { by: 'aside' }); await pace('작업 시작 전');
  const r = await pacedPrep(j); if (!r.ok) { await post(`/queue/${j.id}/approve`, { by: 'aside', note: 'not submitted: ' + r.why }); return { stop: true, msg: j.target.shot + ' NOT SUBMITTED: ' + r.why }; }
  const s = await pacedSubmit(j); if (!s.ok) { await post(`/queue/${j.id}/approve`, { by: 'aside', note: 'not submitted: ' + s.why }); return { stop: true, msg: j.target.shot + ' NOT SUBMITTED: ' + s.why }; }
  if (s.top?.fail) { if (/비정상/.test(s.top.fail)) await post('/flow/block', { message: s.top.fail }); await post(`/queue/${j.id}/approve`, { by: 'aside', note: 'Flow 실패: ' + s.top.fail.slice(0, 80) }); return { stop: true, msg: j.target.shot + ' FAIL ' + s.top.fail }; }
  return { stop: false, msg: j.target.shot + ' 제출 ' + (s.top?.pct || 'ok') + ' | pauses ' + PACE_LOG.slice(-10).map((x) => x[1]).join(',') };
};
// tile status of one episode (title, %, fail); also the title list collectShot results can be checked against
globalThis.pacedCheck = async (ep) => { page = FLOWTAB; await toTop(); const g = await gridMap2(); return g.filter((x) => (x.shot || '').startsWith(ep + ':')).map((x) => [x.shot, x.pct || '', x.fail || 'ok', x.title].join(' | ')); };

// ---------- Promo shorts upload (2026-11-12, tested on BIB-GEN-001-S1 -> <videoId>) ----------
// ytShortUpload('<EP>-S<n>'): private upload of 1_발행본/shorts/<id>.mp4 with short.json upload.title, a composed
// description (hook, link to the long video, KJV + AI notes, #Shorts), AI label "예"; records the videoId through
// PATCH /api/shorts/:id/state (counts toward the 10 uploads / 24 h limit). Vertical <= 3 min files become Shorts
// automatically (the dialog shows "Shorts 리믹스"). Check GET /api/upload-quota first.
globalThis.shortDesc = (S) => { const hook = (S.spec?.hook || []).join(' ').replace(/\*/g, ''); return S.spec?.upload?.description || `${hook}\n\nThe full episode, read in order: https://youtu.be/${S.upload.relatedVideo}\n\nScripture quotations are from the King James Version (public domain). Interpretations are labeled as interpretations.\nMade with AI: narration voice (synthetic) and visuals. Script and editing by the channel.\n\n#Shorts #Bible #Genesis`; };
globalThis.ytShortUpload = async (id) => {
  const S = await (await fetch(`${API}/shorts/${id}`)).json(); if (!S.files?.mp4) return 'no mp4: build first';
  if (S.state?.youtube?.videoId) return 'already uploaded: ' + S.state.youtube.videoId;
  await fs.copyFile(S.files.mp4, YT2 + id + '.mp4');
  page = YTTAB; await page.goto('https://studio.youtube.com/channel/YOUR_CHANNEL_ID/videos/upload?d=ud'); await sleep(6000);
  let t = await snapI(); const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.locator(ref(t, /button "파일 선택" \[ref=(e\d+)\]/)).click()]); await fc.setFiles(YT2 + id + '.mp4'); await sleep(9000);
  t = await snapI(); await setText(ref(t, /textbox "동영상을 설명하는 제목 추가[^"]*" \[ref=(e\d+)\]/), S.upload.title); await sleep(800);
  t = await snapI(); await setText(ref(t, /textbox "시청자에게 동영상에 대해 설명해 주세요[^"]*" \[ref=(e\d+)\]/), shortDesc(S)); await sleep(800);
  t = await snapI(); await page.locator(ref(t, /button "고급 설정 표시" \[ref=(e\d+)\]/)).click(); await sleep(1500);
  t = await snapI(); await page.locator(ref(t, /radio "아니요, 동영상에 유료 프로모션이 포함되어 있지 않습니다." \[ref=(e\d+)\]/)).click(); await page.locator(ref(t, /radio "예, AI가 사용되었습니다." \[ref=(e\d+)\]/)).click(); await sleep(800);
  t = await snapI(); const isShort = /Shorts 리믹스/.test(t);
  const link = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href).find((h) => /youtu\.be\/|shorts\//.test(h)));
  const vid = (link || '').match(/(?:shorts\/|youtu\.be\/)([\w-]{11})/)?.[1];
  const fin = await ytFinish(); if (/still uploading/.test(fin)) return { id, vid, fin, note: 'keep this tab open, call ytFinish() again' };
  await fs.unlink(YT2 + id + '.mp4').catch(() => {});
  if (vid) await post(`/shorts/${id}/state`, { youtube: { videoId: vid, privacy: 'private', url: `https://youtube.com/shorts/${vid}` }, by: 'aside' });
  return { id, vid, isShort, fin };
};
// ytShortLink(videoId, relatedId): edit page "관련 동영상". Needs the channel's one-time advanced-features verification
// (user only). Returns 'verification required' when YouTube shows that dialog (and cancels it).
globalThis.ytShortLink = async (vid, related) => {
  page = YTTAB; await page.goto(`https://studio.youtube.com/video/${vid}/edit`); await sleep(7000);
  let t = await snapI(); const b = ref(t, /button "관련 동영상[^"]*" \[ref=(e\d+)\]/); if (!b) return 'no related-video button';
  await page.locator(b).click(); await sleep(2500); t = await snapI(); const d = t.substring(t.lastIndexOf('- dialog'));
  if (/일회성 인증 필요/.test(d)) { const c = ref(d, /button "취소" \[ref=(e\d+)\]/); if (c) await page.locator(c).click(); return 'verification required'; }
  return { dialog: d.slice(0, 1500), next: `pick ${related} in this dialog, save, then PATCH /shorts/<id>/state {youtube:{relatedLinked:true}}` };
};
