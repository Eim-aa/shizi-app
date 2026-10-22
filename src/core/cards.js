// 卡片模型：SEED（deck-data.js）+ 语境覆盖（data/context-overrides.js，含 #175 逻辑）→ cards[]。
//
// 纯 ES 模块：不访问浏览器全局、存储或网络，可在 node:test 与内容门禁（scripts/content-corpus.cjs）里直接 import。
// UI 与门禁共用这里的 buildCards / LIBRARIES / cardKey / promptModel / promptHTML（01-架构设计 §2、§6.8）。
//
// 字段与旧 index.html（639f592 L1040–1054，#175 版）CARDS 逐字段、逐键序一致——
// 内容门禁的 protectedCardDataSha256 对 JSON 键序敏感，改字段或顺序会让 baseline 失配。

// 面向用户的题面字串。占位常量：M0-6 建立 src/config/copy/ 后由 UI 通过 copy 参数传入同值；
// 默认值必须与 #175 逐字一致（内容门禁断言 instruction 与 fallback 提示原文）。
export const PROMPT_COPY = Object.freeze({
  // R-W28：重复目标字说明（#175）
  repeatInstruction: '空格里是同一个字，只写一次。',
  // 仅拼音题（ctx === 'fallback'）的可见提示（#175 沿旧版）
  fallbackHint: '这个字暂时没有常用词，按拼音写就好',
  // 其余目标位 □ 的读屏标签（role=img）
  repeatBlankLabel: '同一个字的另一处空格',
  // 缺拼音时原目标位的占位
  missingPinyin: '？',
  // 非原目标位的遮字符号
  repeatBlankGlyph: '□',
});

// 四库的规则表（B4.3：数据与判定分开，ShiziCore 导出这张表供 Swift 版读取，原生源码不写汉字）。
// field = 卡片字段，value = 该字段等于什么算属于这个库。
export const LIBRARY_RULES = Object.freeze([
  Object.freeze({ id: 'core3500', label: '常用字', officialTotal: 3500, field: 'norm', value: '一级' }),
  Object.freeze({ id: 'adv3000', label: '次常用字', officialTotal: 3000, field: 'norm', value: '二级' }),
  Object.freeze({ id: 'rare', label: '少见字', officialTotal: 1605, field: 'norm', value: '三级' }),
  Object.freeze({ id: 'curriculum2500', label: '课本字', officialTotal: 2500, field: 'edu', value: '表一' }),
]);

// 四库。id 沿旧值（存储键 shizi.library.v1 与内容门禁 identitySha256 都依赖它）；
// label 为第十稿四库名（R-L01 / 文案 D4，原「义教」库更名）；officialTotal 为官方字表总数（可练数由 test 计）。
export const LIBRARIES = Object.freeze(LIBRARY_RULES.map(rule => Object.freeze({
  id: rule.id, label: rule.label, officialTotal: rule.officialTotal, test: card => card[rule.field] === rule.value,
})));

// buildCards 的缺省值（SEED 行缺字段时的卡片字段）。B4.3 起单独导出，ShiziCore 读同一张表。
export const CARD_DEFAULTS = Object.freeze({
  rank: 999999, strokes: 0, parts: 1, topic: '综合', d: 50, band: '进阶', edu: null, common: 0, norm: '一级', std: 0, ctx: 'dict',
});

const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);

function overrideTable(overrides) {
  return typeof overrides === 'object' && overrides ? overrides : {};
}

// 单行 SEED 套用语境覆盖（#175 applyContextOverride 逐条移植）。不改动入参。
export function applyContextOverride(source, overrides) {
  const table = overrideTable(overrides);
  const target = source.target || Array.from(source.ans)[Number(source.ci) || 0];
  const override = hasOwn(table, target) ? table[target] : undefined;
  if (!override) return source;
  const row = { ...source };
  if (override.boost) row.common = Math.max(Number(row.common) || 0, 1.2);
  if (override.w) {
    const chars = Array.from(override.w);
    const ci = Number(override.ci);
    if (!Number.isInteger(ci) || chars[ci] !== target) return source;
    const sameContext = source.ans === override.w && source.ci === ci;
    row.ans = override.w;
    row.ci = ci;
    row.target = target;
    if (!sameContext) row.ctx = 'override';
  } else if (override.gloss) {
    row.ans = target;
    row.ci = 0;
    row.target = target;
    row.ctx = 'gloss';
    row.hint = override.gloss;
    if (override.preserveCommon !== true) row.common = Math.max(Number(row.common) || 0, 1);
  }
  if (typeof override.py === 'string' && override.py.trim()) row.py = override.py.trim();
  if (typeof override.promptHint === 'string') row.promptHint = override.promptHint.trim();
  return row;
}

// SEED → cards[]（基础卡；自定义卡由调用方另行追加，带 custom:true）。
export function buildCards({ seed, overrides } = {}) {
  if (!Array.isArray(seed)) throw new TypeError('buildCards: seed must be an array');
  const table = overrideTable(overrides);
  const cards = [];
  for (const raw of seed) {
    const w = applyContextOverride(raw, table);
    const chars = Array.from(w.ans);
    const pys = w.py.split(/\s+/);
    const meta = {
      rank: w.rank || CARD_DEFAULTS.rank, strokes: w.strokes || CARD_DEFAULTS.strokes, parts: w.parts || CARD_DEFAULTS.parts, topic: w.topic || CARD_DEFAULTS.topic,
      d: w.d || CARD_DEFAULTS.d, band: w.band || CARD_DEFAULTS.band, edu: w.edu || CARD_DEFAULTS.edu, common: w.common || CARD_DEFAULTS.common, norm: w.norm || CARD_DEFAULTS.norm,
      std: w.std || CARD_DEFAULTS.std, ctx: w.ctx || CARD_DEFAULTS.ctx, ...(w.promptHint ? { promptHint: w.promptHint } : {}),
    };
    if (Number.isInteger(w.ci)) {
      const ci = w.ci;
      cards.push({ word: w.ans, chars, ci, target: w.target || chars[ci], py: w.py, hint: w.hint, ...meta });
      continue;
    }
    // 旧数据形态（无 ci：整词逐字出卡）。现行 deck 每行都有整数 ci，此分支只为与旧 CARDS 构造等价。
    chars.forEach((ch, ci) => cards.push({ word: w.ans, chars, ci, target: ch, py: pys[ci] || w.py, hint: w.hint, ...meta }));
  }
  return cards;
}

// 持久身份：base:<字> / custom:<字>（不依赖数组下标）。
export function cardKey(card) {
  return (card.custom ? 'custom:' : 'base:') + card.target;
}

export function libraryIdsFor(card) {
  return LIBRARIES.filter(lib => lib.test(card)).map(lib => lib.id);
}

export function libraryById(id) {
  return LIBRARIES.find(lib => lib.id === id) || null;
}

function repeatCount(card) {
  return card.chars.filter(ch => ch === card.target).length;
}

// 题面模型（决定-D16 / R-W28）：按码点逐格；原目标位 blank 带拼音，其余同一目标字位 repeatBlank（□）。
// 回忆阶段答案字不进任何 segment 的 text/label。
export function promptModel(card, copy = PROMPT_COPY) {
  const segments = card.chars.map((ch, i) => {
    if (i === card.ci) return { kind: 'blank', text: card.py || copy.missingPinyin };
    if (ch === card.target) return { kind: 'repeatBlank', text: copy.repeatBlankGlyph, label: copy.repeatBlankLabel };
    return { kind: 'text', text: ch };
  });
  const contentHint = (card.custom
    ? card.hint
    : (card.ctx === 'gloss' && card.hint ? card.hint : (card.promptHint || (card.ctx === 'fallback' ? copy.fallbackHint : '')))) || '';
  const instruction = repeatCount(card) > 1 ? copy.repeatInstruction : '';
  const visibleHint = [contentHint, instruction].filter(Boolean).join(' ');
  return { segments, visibleHint, contentHint, instruction };
}

export function visibleHint(card, copy = PROMPT_COPY) {
  return promptModel(card, copy).visibleHint;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// 纯字符串题面（与 #175 index.html L2404 promptHTML 逐字同形；另对 HTML 特殊字符转义——题库内无此类字符，输出不变）。
// 供内容门禁比对与需要字符串的场合；UI 渲染用 promptModel + textContent。
export function promptHTML(card, copy = PROMPT_COPY) {
  return promptModel(card, copy).segments.map(segment => {
    if (segment.kind === 'blank') return `<span class="blank">${escapeHTML(segment.text)}</span>`;
    if (segment.kind === 'repeatBlank') {
      return `<span class="blank repeatBlank" role="img" aria-label="${escapeHTML(segment.label)}">${escapeHTML(segment.text)}</span>`;
    }
    return `<span class="given">${escapeHTML(segment.text)}</span>`;
  }).join('');
}
