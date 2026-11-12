// Series profiles: everything that differs between topics (Bible, myths, wars, other religions...) lives in
// <workspace>/<series folder>/00_시리즈공통/series.json under "profile". Scripts and the app read it through here;
// missing fields fall back to the channel defaults in studio.config.json "channel" and then to DEFAULT_PROFILE.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './paths.mjs';

// The Bible series values, kept as the fallback so older series.json files without a profile behave as before.
export const DEFAULT_PROFILE = {
  label: 'THE BIBLE IN ORDER',
  playlist: 'The Bible in Order',
  subject: 'a calm Bible documentary',
  idPattern: 'BIB-<BOOK>-<NNN>',
  source: {
    name: 'King James Version', license: 'public domain',
    quoteRule: 'Quote only the King James Version, word for word, with the reference. Label interpretations as interpretations.',
    translateRule: 'Scripture quotations are from the King James Version: render them in the dignified traditional register used by Bibles in {LANG}, keep the meaning exact, and keep biblical names in the forms used by Bibles in that language.',
    keepInEnglish: 'King James Version',
  },
  glossaryRule: 'Keep Hebrew/Greek terms that the narrator explains (e.g. adam, adamah, nephesh chayyah, Isha, Ish, paradeisos, edin) in Latin letters, optionally followed by the native script.',
  descriptionFooter: 'Scripture quotations are from the King James Version (public domain). Interpretations are labeled as interpretations; other translations may differ.',
  shorts: { closing: '{work}, read in order. Only on The Long Memory.', hashtags: '#Shorts #Bible #Genesis', endCard: ['THE BIBLE IN ORDER', 'The Long Memory'] },
  voice: { engine: 'macos-say', voice: 'Ava (Premium)', rate: 115, lineGapSec: 1.0 },
  research: { source: 'OpenCrab', packQuery: 'BIB' },
  flowProject: null,
};

const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };

export const seriesIds = () => Object.keys(config.series || {});
export const seriesFolder = (sid) => { const f = config.series?.[sid]; if (!f) throw new Error('unknown series ' + sid); return path.join(config.workspace, f); };
export const seriesCommon = (sid) => path.join(seriesFolder(sid), '00_시리즈공통');
export function seriesOfEpisode(epId) {
  const f = config.episodes[epId]; if (!f) throw new Error('unknown episode ' + epId);
  return Object.entries(config.series || {}).find(([, folder]) => f.startsWith(folder + '/'))?.[0] || null;
}
export function loadSeriesJson(sid) { const f = path.join(seriesCommon(sid), 'series.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id: sid }; }
// full profile for a series (channel defaults + series overrides), with identity fields
export function profile(sid) {
  const s = loadSeriesJson(sid); const ch = config.channel || {};
  const base = merge(DEFAULT_PROFILE, ch.profileDefaults || {});
  return { id: sid, name: s.name || sid, folder: config.series[sid], ...merge(base, s.profile || {}), flowProject: s.profile?.flowProject || ch.flowProject || null };
}
export const profileOfEpisode = (epId) => { const sid = seriesOfEpisode(epId); return sid ? profile(sid) : { id: null, ...DEFAULT_PROFILE, flowProject: config.channel?.flowProject || null }; };
export const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
