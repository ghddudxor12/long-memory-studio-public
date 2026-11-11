// Composes generation prompts from series style + assets + rules + episode rules + shot description.
// Shared by the app server (preview, job snapshots) and Aside skills.
export function assetsForShot(series, shot) {
  const byName = new Map(series.assets.map((a) => [a.name.toLowerCase(), a]));
  return (shot.assets || []).map((n) => byName.get(String(n).toLowerCase())).filter(Boolean);
}

export function composePrompt({ series, production, shot, kind = 'keyframe' }) {
  const assets = assetsForShot(series, shot);
  const ruleIds = new Set(['no-text', 'no-cutaway']);
  for (const a of assets) for (const r of a.rules || []) ruleIds.add(r);
  if (assets.some((a) => /hand/i.test(a.description)) || /hand/i.test(shot.prompts?.visual || '')) ruleIds.add('hands-anatomy');
  const rules = series.rules.filter((r) => ruleIds.has(r.id) && r.prompt);
  const epRules = (production?.rules || []).filter((r) => r.prompt && (!r.scenes || r.scenes.includes(shot.scene)));
  const head = kind === 'end'
    ? 'Final frame of the same shot 8 seconds later. Same camera, composition, figures and wardrobe as the attached start frame; only the described change has happened.'
    : kind === 'asset' ? 'Reference image for a recurring asset.' : 'Keyframe for one shot of a long-form documentary, 16:9.';
  const text = series.promptTemplate
    .replace('{shot}', `${head}\n${shot.prompts?.visual || shot.description || ''}`)
    .replace('{assets}', assets.map((a) => `${a.name}: ${a.description}`).join('\n') || 'none')
    .replace('{rules}', [...rules.map((r) => r.prompt), ...epRules.map((r) => r.prompt)].join('; ') || 'none')
    .replace('{style}', series.style.gptSuffix || series.style.prompt);
  // lint: words that summon what a rule forbids (EP001: "dawn"/"burst" produced sun discs before Day Four)
  const warnings = [];
  const shotText = `${shot.prompts?.visual || ''} ${shot.prompts?.motion || ''}`;
  if (epRules.some((r) => /sun/.test(r.id))) for (const w of ['sun', 'sunrise', 'sunset', 'dawn', 'dusk', 'burst', 'starburst', 'erupts', 'horizon glow'])
    if (new RegExp(`\\b${w}\\b`, 'i').test(shotText)) warnings.push(`"${w}" 단어가 있어요: 해 원반을 부를 수 있어요 (긍정형 광원 없는 빛으로)`);
  if (assets.some((a) => a.id === 'god') && /\b(full body|full-length|standing figure|wide shot)\b/i.test(shotText)) warnings.push('하나님 전신·와이드 구도: 영상화하면 허리띠가 생길 수 있어요 (어깨 위 클로즈업 권장)');
  if (/underwater|beneath the (surface|waves)|cross-section|roots/i.test(shotText)) warnings.push('단면 묘사(물속, 뿌리)가 있어요');
  const refs = assets.flatMap((a) => a.refs.filter((r) => r.state === 'adopted').map((r) => ({ asset: a.id, file: r.file })));
  return { text, refs, warnings, rules: [...rules.map((r) => r.id), ...epRules.map((r) => r.id)], assets: assets.map((a) => a.id) };
}
