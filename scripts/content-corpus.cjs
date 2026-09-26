// Pure, read-only execution of the app's real card expansion and initial prompt.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const sha256 = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function originalOverrides(fixture) {
  return {
    ...Object.fromEntries(fixture.boostOnly.map(target => [target, {boost:true}])),
    ...fixture.approvedWords,
    ...Object.fromEntries(Object.entries(fixture.approvedGlosses).map(([target, gloss]) => [target, {
      gloss, ...(fixture.boostedGlosses.includes(target) ? {boost:true} : {}),
    }])),
  };
}

function loadCorpus(root, options = {}) {
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const html = read("index.html");
  const start = html.indexOf("const CARDS=[];");
  const end = html.indexOf("// ---- 本地存储 ----", start);
  if (start < 0 || end <= start) throw new Error("Card expansion boundaries changed");
  const expansion = html.slice(start, end);
  if (/localStorage|sessionStorage|document\.|window\.|fetch\(|XMLHttpRequest|require\(/.test(expansion)) throw new Error("Non-pure operation in card expansion");
  const prompt = html.match(/^function promptHTML\(c\)\{[^\n]+$/m)?.[0];
  const key = html.match(/^function cardKey\(i\)\{[^\n]+$/m)?.[0];
  const hint = html.match(/^\s*\$\("hint"\)\.textContent=(\[?cur\.custom\?[^\n]+);$/m)?.[1];
  const libraryStart = html.indexOf("const LIBRARIES=[");
  const libraryEnd = html.indexOf("function defaultLibraryId()", libraryStart);
  if (!prompt || !key || !hint || libraryStart < 0 || libraryEnd <= libraryStart) throw new Error("Prompt or library extraction boundaries changed");
  const context = vm.createContext(Object.create(null), {codeGeneration:{strings:false, wasm:false}});
  const run = (text, name) => new vm.Script(text, {filename:name}).runInContext(context, {timeout:3000});
  run(read("deck-data.js"), "deck-data.js");
  if (options.sourcePatches) run(`const sourcePatches=${JSON.stringify(options.sourcePatches)}; SEED.forEach(row=>{if(sourcePatches[row.target]) Object.assign(row,sourcePatches[row.target]);});`, "synthetic-rebuild-input");
  run(options.overrides ? `const CONTEXT_OVERRIDES=${JSON.stringify(options.overrides)};` : read("data/context-overrides.js"), "data/context-overrides.js");
  run(`${expansion}\n${prompt}\n${key}\n${html.slice(libraryStart, libraryEnd)}\nfunction visibleHint(cur,activeMode="new"){return ${hint};}`, "index.html:pure-card-and-prompt-fragments");
  return JSON.parse(run(`JSON.stringify({cards:CARDS.map((card,index)=>{
    const visible=visibleHint(card),instruction=card.chars.filter(ch=>ch===card.target).length>1?"空格里是同一个字，只写一次。":"";
    return {...card,index,cardKey:cardKey(index),promptHTML:promptHTML(card),visibleHint:visible,
      blankPrompt:card.chars.map((ch,i)=>i===card.ci||ch===card.target?"□":ch).join(""),
      libraries:LIBRARIES.filter(lib=>lib.test(card)).map(lib=>lib.id),
      contentHint:instruction&&visible.endsWith(instruction)?visible.slice(0,-instruction.length).trimEnd():visible,instruction};
  }),seed:SEED,overrides:CONTEXT_OVERRIDES})`, "corpus-export"));
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

module.exports = {loadCorpus, originalOverrides, reviewedOverrides, protectedCardData, sha256, identity, issues, promptSignature};
