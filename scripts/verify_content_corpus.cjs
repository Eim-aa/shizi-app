// Exercise the current app's pure card expansion without loading UI or storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadCorpus, reviewedOverrides, protectedCardData, sha256, identity, issues} = require('./content-corpus.cjs');

const root = path.resolve(__dirname, '..');
const approval = require('./fixtures/content-quality-approved.json');
const baseline = require('./fixtures/content-quality-baseline.json');
const legacy = require('./fixtures/context-overrides-approved.json');
const current = loadCorpus(root);
const byKey = new Map(current.cards.map(card => [card.cardKey, card]));

assert.equal(sha256(fs.readFileSync(path.join(root, 'deck-data.js'), 'utf8')), baseline.deckSha256,
  'Generated corpus changed; review its current governance baseline separately');
assert.equal(current.cards.length, baseline.cardCount);
assert.equal(byKey.size, current.cards.length);
assert.equal(new Set(current.cards.map(card => card.target)).size, current.cards.length);
assert.equal(sha256(identity(current.cards)), baseline.identitySha256,
  'Content corrections must retain the current governed target set, order and libraries');
assert.equal(sha256(protectedCardData(current.cards, approval)), baseline.protectedCardDataSha256,
  'Unapproved card fields, weights or card data changed');
assert.deepEqual(current.overrides, reviewedOverrides(legacy, approval),
  'Runtime overrides must exactly match the independently approved content');

const approvedKeys = new Set();
for (const entry of approval.entries) {
  assert.equal(entry.decision, 'approved');
  assert(!approvedKeys.has(entry.cardKey), `Duplicate approval: ${entry.cardKey}`);
  approvedKeys.add(entry.cardKey);
  const card = byKey.get(entry.cardKey);
  assert(card, `Approved target absent from the governed corpus: ${entry.target}`);
  assert.equal(card.target, entry.target);
  for (const [key, value] of Object.entries(entry.expected)) {
    assert.deepEqual(card[key], value, `Approved output mismatch: ${entry.target}.${key}`);
  }
  assert.equal(card.py, entry.override.py, 'Reviewed readings must be explicitly pinned');
  assert.equal(card.promptHint || '', entry.override.promptHint || '');
  if (entry.override.gloss) assert.equal(card.hint, entry.override.gloss);
}
assert.equal(approvedKeys.size, 340);

for (const card of current.cards) {
  assert.equal(card.chars.join(''), card.word);
  assert(Number.isInteger(card.ci) && card.ci >= 0 && card.ci < card.chars.length);
  assert.equal(card.chars[card.ci], card.target);
  assert(card.py && /^[a-z\u0300\u0301\u0302\u0304\u0308\u030c]+$/u.test(card.py.normalize('NFD')),
    `Invalid pinyin: ${card.target}`);
  const repeats = card.chars.filter(char => char === card.target).length;
  assert.equal(card.instruction, repeats > 1 ? '空格里是同一个字，只写一次。' : '');
  assert.equal(card.contentHint, card.ctx === 'gloss' ? card.hint : card.promptHint ||
    (card.ctx === 'fallback' ? '这个字暂时没有常用词，按拼音写就好' : ''));
  assert.equal(card.visibleHint, [card.contentHint, card.instruction].filter(Boolean).join(' '));
  assert.equal((card.promptHTML.match(/class="blank(?: repeatBlank)?"/g) || []).length, repeats);
  assert.equal((card.promptHTML.match(/class="blank"/g) || []).length, 1,
    'Only the original target position carries pinyin');
  assert(!card.promptHTML.includes(card.target), `Answer exposed in prompt text/attributes: ${card.target}`);
}
const found = issues(current.cards);
assert.equal(found.leaks.length, 0, 'Visible prompt/hint must not contain the target');
assert(found.collisions.every(group => group.cards.every(card => card.ctx === 'fallback')),
  'Exact prompt collisions are only permitted among the unchanged fallback cards');
const fallback = current.cards.filter(card => card.ctx === 'fallback').length;
assert.equal(fallback, baseline.issueCounts.fallback);

// Only modify inputs in a VM: approved words/readings/hints survive regeneration.
const sourcePatches = Object.fromEntries(approval.entries.map(entry =>
  [entry.target, {ans:entry.target + '字', ci:0, py:'x'}]));
const rebuilt = new Map(loadCorpus(root, {sourcePatches}).cards.map(card => [card.cardKey, card]));
for (const entry of approval.entries) {
  for (const key of ['word', 'ci', 'py', 'visibleHint']) {
    assert.deepEqual(rebuilt.get(entry.cardKey)[key], byKey.get(entry.cardKey)[key],
      `Reviewed content lost after generated-input drift: ${entry.target}.${key}`);
  }
}
const target = approval.entries[0].target;
const invalid = loadCorpus(root, {overrides:{[target]:{w:'不含目标', ci:99, py:'x', promptHint:'不应生效'}}});
const unchanged = invalid.cards.find(card => card.target === target);
const seed = current.seed.find(row => row.target === target);
assert.equal(unchanged.word, seed.ans); assert.equal(unchanged.py, seed.py);
assert.equal(unchanged.promptHint, undefined);
for (const flag of [true, false, undefined]) {
  const corpus = loadCorpus(root, {sourcePatches:{[target]:{common:0}},
    overrides:{[target]:{gloss:'权重测试', ...(flag === undefined ? {} : {preserveCommon:flag})}}});
  assert.equal(corpus.cards.find(card => card.target === target).common, flag === true ? 0 : 1);
}

console.log(JSON.stringify({status:'passed', cards:current.cards.length, approvedTargets:approvedKeys.size,
  before:baseline.issueCounts, remaining:{leaks:found.leaks.length, wordCollisionGroups:0,
    allCollisionGroups:found.collisions.length, fallback},
  governedMembershipUnchanged:true, protectedCardDataUnchanged:true, generatedDeckUnchanged:true,
  scope:'Exact visible-prompt regression; unchanged fallback collisions do not constitute language approval'}, null, 2));
