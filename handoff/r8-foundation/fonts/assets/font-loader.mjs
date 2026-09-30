// Independent integration helper. No product page integration.
export function inspectText(manifest, family, weight, raw, {normalize = true} = {}) {
  const face = manifest[`${family}:${weight}`];
  if (!face) throw new Error(`Unknown F8 face ${family}:${weight}`);
  const text = normalize ? raw.normalize('NFC') : raw;
  const supported = new Set(face.codepoints);
  const missing = [...new Set([...text].filter(c => !/[\n\r\t]/u.test(c) && !supported.has(c.codePointAt(0))))];
  const unreviewedCombining = [...text].filter(c => /\p{M}/u.test(c));
  return {text, normalized: text !== raw, unreviewedCombining, missing: missing.map(c => ({char:c, codepoint:`U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`}))};
}
export async function requireFont(manifest, family, weight, raw) {
  const check = inspectText(manifest, family, weight, raw);
  const context = `${family}:${weight}; file=${manifest[`${family}:${weight}`].file}`;
  if (check.missing.length) throw new Error(`F8 missing glyphs: ${JSON.stringify(check.missing)} (${context})`);
  if (check.unreviewedCombining.length) throw new Error(`F8 combining sequence requires visual review: ${check.unreviewedCombining.join(' ')} (${context})`);
  let faces;
  try {
    faces = await document.fonts.load(`${weight} 32px "${family}"`, check.text);
  } catch (cause) {
    throw new Error(`F8 font load failed: ${context}; ${cause?.name ?? 'Error'}: ${cause?.message ?? String(cause)}`, {cause});
  }
  // Font matching may return a nearby weight. Require the exact static normal face.
  if (!faces.length || faces.some(f =>
    f.family.replace(/^(['"])(.*)\1$/, '$2') !== family ||
    (f.weight === 'normal' ? '400' : f.weight) !== String(weight) ||
    f.style !== 'normal' || f.status !== 'loaded'
  )) throw new Error(`F8 font unavailable: ${context}`);
  await document.fonts.ready;
  return check; // Render returned NFC text; do not continue with raw or an implicit fallback.
}
