// Pure, read-only execution of the app's real card expansion and initial prompt.
//
// v10 (M0-2): the card expansion no longer lives in index.html. deck-data.js and
// data/context-overrides.js are evaluated in an isolated VM context (exactly the
// classic-script globals the page gets), then the shared pure module
// src/core/cards.js builds the cards and prompts — the same code the UI imports.
// The sourcePatches / overrides injection points are kept for drift tests.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const sha256 = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const CARDS_MODULE = path.join("src", "core", "cards.js");
// cards.js must stay a pure module (01-架构设计 §2: core has no browser/storage/network access).
const IMPURE = /\blocalStorage\b|\bsessionStorage\b|\bdocument\.|\bwindow\.|\bfetch\(|\bXMLHttpRequest\b|\brequire\(|\bindexedDB\b|\bnavigator\./;

const modules = new Map();
async function cardsModule(root) {
  const file = path.resolve(root, CARDS_MODULE);
  if (!modules.has(file)) {
    const source = fs.readFileSync(file, "utf8");
    if (IMPURE.test(source)) throw new Error(`Non-pure operation in ${CARDS_MODULE}`);
    modules.set(file, import(pathToFileURL(file).href));
  }
  return modules.get(file);
}

function originalOverrides(fixture) {
  return {
    ...Object.fromEntries(fixture.boostOnly.map(target => [target, {boost:true}])),
    ...fixture.approvedWords,
    ...Object.fromEntries(Object.entries(fixture.approvedGlosses).map(([target, gloss]) => [target, {
      gloss, ...(fixture.boostedGlosses.includes(target) ? {boost:true} : {}),
    }])),
  };
}

// Evaluate the classic data scripts the way the page does and hand back plain
// (main-realm, JSON round-tripped) SEED / CONTEXT_OVERRIDES.
function loadSources(root, options = {}) {
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const context = vm.createContext(Object.create(null), {codeGeneration:{strings:false, wasm:false}});
  const run = (text, name) => new vm.Script(text, {filename:name}).runInContext(context, {timeout:3000});
  run(read("deck-data.js"), "deck-data.js");
  run(options.overrides ? `const CONTEXT_OVERRIDES=${JSON.stringify(options.overrides)};` : read("data/context-overrides.js"), "data/context-overrides.js");
  const seed = JSON.parse(run("JSON.stringify(SEED)", "export-seed"));
  const overrides = JSON.parse(run("JSON.stringify(typeof CONTEXT_OVERRIDES===\"object\"&&CONTEXT_OVERRIDES?CONTEXT_OVERRIDES:{})", "export-overrides"));
  if (options.sourcePatches) {
    const sourcePatches = options.sourcePatches;
    seed.forEach(row => { if (sourcePatches[row.target]) Object.assign(row, sourcePatches[row.target]); });
  }
  return {seed, overrides};
}

async function loadCorpus(root, options = {}) {
  const {buildCards, cardKey, promptHTML, promptModel, libraryIdsFor} = await cardsModule(root);
  const {seed, overrides} = loadSources(root, options);
  const cards = buildCards({seed, overrides}).map((card, index) => {
    const model = promptModel(card);
    return {...card, index, cardKey:cardKey(card), promptHTML:promptHTML(card), visibleHint:model.visibleHint,
      blankPrompt:card.chars.map((ch, i) => i === card.ci || ch === card.target ? "□" : ch).join(""),
      libraries:libraryIdsFor(card), contentHint:model.contentHint, instruction:model.instruction};
  });
  // Freshly parsed copies: callers compare seed/overrides with deepStrictEqual.
  return JSON.parse(JSON.stringify({cards, seed, overrides}));
}

function reviewedOverrides(legacy, approval) {
  const overrides=originalOverrides(legacy);
  for(const entry of approval.entries){
    const row=overrides[entry.target]={...overrides[entry.target],...entry.override};
    if(entry.override.w){delete row.gloss;delete row.preserveCommon;}
    if(entry.override.gloss){delete row.w;delete row.ci;delete row.promptHint;}
  }
  return overrides;
}

function protectedCardData(cards, approval) {
  const reviewed=new Map(approval.entries.map(entry=>[entry.cardKey,entry]));
  return cards.map(card=>{
    const entry=reviewed.get(card.cardKey);
    const omit=new Set(["promptHTML","blankPrompt","visibleHint","contentHint","instruction"]);
    if(entry){for(const key of ["word","chars","ci","py","ctx","promptHint"])omit.add(key);if(entry.override.gloss)omit.add("hint");}
    return Object.fromEntries(Object.entries(card).filter(([key])=>!omit.has(key)));
  });
}

function identity(cards) {
  return cards.map(c => [c.index, c.cardKey, c.target, c.norm, c.edu, c.std, c.libraries]);
}

function promptSignature(c) {
  // Use the actual visible text: when several positions are blank, the location
  // of the sole pronunciation-bearing blank is part of the prompt too.
  return [c.promptHTML.replace(/<[^>]*>/g,"").normalize("NFC"), c.visibleHint];
}

function issues(cards) {
  const leaks = cards.filter(c => promptSignature(c).some(text=>text.includes(c.target)))
    .map(c => ({cardKey:c.cardKey, index:c.index, target:c.target, prompt:promptSignature(c)}));
  const groups = new Map();
  for (const c of cards) {
    const signature = JSON.stringify(promptSignature(c));
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(c);
  }
  const collisions = [...groups.entries()].filter(([, rows]) => new Set(rows.map(c => c.target)).size > 1)
    .map(([signature, rows]) => ({prompt:JSON.parse(signature), cards:rows.map(c => ({index:c.index, cardKey:c.cardKey, target:c.target, ctx:c.ctx}))}));
  const pairs = collisions.flatMap(group => group.cards.flatMap((left, i) => group.cards.slice(i + 1)
    .filter(right => left.target !== right.target)
    .map(right => ({prompt:group.prompt, cardKeys:[left.cardKey, right.cardKey].sort()}))));
  return {leaks, collisions, pairs};
}

// D50 ③（C1）：题面可见文字（语境词、题面提示、释义）里出现禁用词表（scripts/fixtures/content-blocklist.json）的词 → 命中列表。
function visibleText(card) {
  return [card.word, card.promptHint || '', card.ctx === 'gloss' ? card.hint || '' : '', card.visibleHint || ''].join('\n');
}
function blocklistWords(blocklist) {
  return Object.values((blocklist && blocklist.categories) || {}).flatMap(row => row.words || []);
}
function blockedWordHits(cards, words) {
  const hits = [];
  for (const card of cards) {
    const text = visibleText(card);
    for (const word of words) if (word && text.includes(word)) hits.push({target:card.target, cardKey:card.cardKey, word});
  }
  return hits;
}

module.exports = {loadCorpus, loadSources, originalOverrides, reviewedOverrides, protectedCardData, sha256, identity, issues, promptSignature,
  blocklistWords, blockedWordHits};
