// Pure, read-only execution of the app's real card expansion and initial prompt.
//
// D84: the card expansion is the native one. The deck (seed + context overrides) is read from
// ShiziCore's Bundled/deck.json — the file the app ships — and expanded by `shizi-core-cli cards-dump`
// (ShiziCore Cards.swift: buildCards / cardKey / promptModel / promptHTML / libraryIdsFor). Before the
// switch the Swift output was proven byte-identical to the former src/core/cards.js expansion over the
// whole deck and over the drift variants below. The sourcePatches / overrides injection points are kept
// for drift tests: the patched deck goes to the CLI on stdin, nothing is written to disk.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const sha256 = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const DECK_JSON = path.join("ios", "ShiziCore", "Sources", "ShiziCore", "Bundled", "deck.json");
// Hand-edited truth of the context overrides (private: not under data/, so not published to shizi-open).
// build_8105_chars.py copies it verbatim into deck.json's "overrides".
const CONTEXT_OVERRIDES_JSON = path.join("scripts", "content", "context-overrides.json");
const CORE_PACKAGE = path.join("ios", "ShiziCore");

// Build (incrementally) and locate shizi-core-cli once per process; SHIZI_CORE_CLI overrides the binary.
const clis = new Map();
function coreCli(root) {
  if (process.env.SHIZI_CORE_CLI) return process.env.SHIZI_CORE_CLI;
  const pkg = path.resolve(root, CORE_PACKAGE);
  if (!clis.has(pkg)) {
    const build = spawnSync("swift", ["build", "--package-path", pkg, "--product", "shizi-core-cli"], {encoding:"utf8", maxBuffer:64 * 1024 * 1024});
    if (build.status !== 0) throw new Error(`swift build shizi-core-cli failed:\n${build.stdout}\n${build.stderr}`);
    clis.set(pkg, path.join(pkg, ".build", "debug", "shizi-core-cli"));
  }
  return clis.get(pkg);
}

function readDeck(root) {
  return JSON.parse(fs.readFileSync(path.join(root, DECK_JSON), "utf8"));
}

function readContextOverrides(root) {
  return JSON.parse(fs.readFileSync(path.join(root, CONTEXT_OVERRIDES_JSON), "utf8"));
}

// Text of the retired deck-data.js for the same seed/groups (build_8105_chars.py wrote it from the same
// values until D84). content-quality-baseline.json pins its SHA-256 (deckSha256); rebuilding the text
// keeps that pin meaningful without a JS data file.
function legacyDeckDataText(deck) {
  return "// 拾字题库数据（由 scripts/build_8105_chars.py 生成，勿手改）\n"
    + "// SEED：候选字词卡（拼音/语境词/难度/主题/规范等级）\n"
    + "const SEED = " + JSON.stringify(deck.seed) + ";\n"
    + `// 每个字的部件分组（自动生成：${Object.keys(deck.groups).length} 个通用规范汉字候选，按 Make Me a Hanzi matches 递归部件分组）\n`
    + "const GROUPS=" + JSON.stringify(deck.groups) + ";\n";
}

// Native expansion: one JSON line per card from shizi-core-cli cards-dump.
function nativeCards(root, seed, overrides) {
  const run = spawnSync(coreCli(root), ["cards-dump"], {input:JSON.stringify({seed, overrides}), encoding:"utf8", maxBuffer:1 << 30});
  if (run.status !== 0) throw new Error(`shizi-core-cli cards-dump failed: ${run.stderr}`);
  return run.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
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

// Plain (freshly parsed) SEED / CONTEXT_OVERRIDES from deck.json, with the optional injections applied.
function loadSources(root, options = {}) {
  const deck = readDeck(root);
  const seed = deck.seed;
  const overrides = options.overrides ? JSON.parse(JSON.stringify(options.overrides)) : (deck.overrides || {});
  if (options.sourcePatches) {
    const sourcePatches = options.sourcePatches;
    seed.forEach(row => { if (sourcePatches[row.target]) Object.assign(row, sourcePatches[row.target]); });
  }
  return {seed, overrides};
}

async function loadCorpus(root, options = {}) {
  const {seed, overrides} = loadSources(root, options);
  const cards = nativeCards(root, seed, overrides).map((row, index) => {
    const card = row.card;
    return {...card, index, cardKey:row.cardKey, promptHTML:row.promptHTML, visibleHint:row.visibleHint,
      blankPrompt:card.chars.map((ch, i) => i === card.ci || ch === card.target ? "□" : ch).join(""),
      libraries:row.libraries, contentHint:row.contentHint, instruction:row.instruction};
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

module.exports = {loadCorpus, loadSources, readDeck, readContextOverrides, legacyDeckDataText, DECK_JSON, CONTEXT_OVERRIDES_JSON, originalOverrides, reviewedOverrides, protectedCardData, sha256, identity, issues, promptSignature,
  blocklistWords, blockedWordHits};
