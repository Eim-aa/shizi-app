const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
execFileSync("python3", [path.join(root, "scripts", "verify_ui_copy.py")], { stdio: "inherit" });
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(root, "generated", "verify_8105_app.png");
const wildPhotoFixturePath = path.join(root, "icon-192.png");
const SESSION_STORAGE_KEY = "shizi.session.v1";
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const thirdPartyNotices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const legalChecklist = fs.readFileSync(path.join(root, "LEGAL_RELEASE_CHECKLIST.md"), "utf8");
const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const deckSource = fs.readFileSync(path.join(root, "deck-data.js"), "utf8");
const contextOverrideSource = fs.readFileSync(path.join(root, "data", "context-overrides.js"), "utf8");
const approvedContextFixture = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "context-overrides-approved.json"), "utf8"));
const coreStrokeSource = fs.readFileSync(path.join(root, "core-strokes.js"), "utf8");
const etymology = JSON.parse(fs.readFileSync(path.join(root, "data", "etymology.json"), "utf8"));
const etymologyCoverage = JSON.parse(fs.readFileSync(path.join(root, "generated", "etymology-coverage.json"), "utf8"));
const etymologyBuilderSource = fs.readFileSync(path.join(root, "scripts", "build_etymology.py"), "utf8");
const appDelegateSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "AppDelegate.swift"), "utf8");
const webViewSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "WebViewController.swift"), "utf8");
const schemeHandlerSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "LocalWebSchemeHandler.swift"), "utf8");
const mottoFixture = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "motto_classics.json"), "utf8"));
const etymologyAccuracyFixture = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "etymology_accuracy.json"), "utf8"));
const etymologyContextAudit = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "etymology_context_audit.json"), "utf8"));
const etymologyCopyReview = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "etymology_copy_review.json"), "utf8"));
const deckCharacters = new Set(JSON.parse(deckSource.match(/const SEED = (\[.*\]);/s)[1]).map((row) => row.target));
const openccOneToMany = new Set(fs.readFileSync(path.join(root, "sources", "opencc-st-characters.txt"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.includes("\t") && line.split("\t", 2)[1].trim().split(/\s+/).length > 1)
  .map((line) => line.split("\t", 1)[0]));
const wildPhotoFixture = fs.readFileSync(wildPhotoFixturePath);
assert(wildPhotoFixture.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "Expected the photographed-character fixture to be a real PNG image");

if (/退出本组？|进度已保存，随时可继续这组|描一遍也算拾回|小时后再见|已收|拾到手|教学检查|本组通过|待巩固|差点|回炉|改一下|已稳/.test(source)) {
  throw new Error("Deprecated practice vocabulary remains in index.html");
}

function chromeExecutable() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((candidate) => fs.existsSync(candidate));
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function hasCjkExtension(text) {
  return Array.from(String(text)).some((char) => {
    const codePoint = char.codePointAt(0);
    return (codePoint >= 0x3400 && codePoint <= 0x4dbf) || (codePoint >= 0x20000 && codePoint <= 0x323af);
  });
}

function isOpaqueAncientGloss(gloss) {
  const match = String(gloss).split("。", 1)[0].match(/^(.{1,2})(?:也|同)$/u);
  return !!match && Array.from(match[1]).some((char) => !deckCharacters.has(char));
}

function cssRgb(value) {
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert(channels?.length === 3 && channels.every(Number.isFinite), "Expected a computed RGB color", { value });
  return channels;
}

function relativeLuminance(channels) {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function computedContrast(foreground, background, opacity = 1) {
  const bg = cssRgb(background), fg = cssRgb(foreground), alpha = Number(opacity);
  const composite = fg.map((channel, index) => channel * alpha + bg[index] * (1 - alpha));
  const [high, low] = [relativeLuminance(composite), relativeLuminance(bg)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

assert(mottoFixture.entries.length === 52 && Object.keys(mottoFixture.references).length === 7,
  "Expected the reviewed 52-entry classics fixture and its seven primary references", mottoFixture);
assert(Object.keys(mottoFixture.references).every((sourceName) => readme.includes(`《${sourceName}》`)),
  "Expected README to list every reviewed motto source", Object.keys(mottoFixture.references));
assert(mottoFixture.entries.find((entry) => entry.text === "传不习乎")?.author === "曾子"
  && mottoFixture.entries.find((entry) => entry.text === "如切如磋，如琢如磨")?.source === "诗经·卫风·淇奥",
"Expected the reviewed fixture to preserve the corrected Zengzi and Classic of Poetry attributions");
assert(thirdPartyNotices.includes("Hanzi Writer 3.7.3") && thirdPartyNotices.includes("17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642")
  && fs.existsSync(path.join(root, "sources", "LICENSE-MIT-HANZI-WRITER.txt")) && fs.existsSync(path.join(root, "sources", "LICENSE-ARPHIC-PUBLIC.txt")),
  "Expected pinned Hanzi Writer code and data notices with complete local license texts");
assert(legalChecklist.includes("Project-authored code and content") && legalChecklist.includes("MOE/stroke-order supplement")
  && legalChecklist.includes("Human-generated supplement") && legalChecklist.includes("Stroke-order merged supplement") && legalChecklist.includes("BLOCKED"),
  "Expected unresolved ownership and supplemental-data rights to remain explicit release gates");

assert(swSource.includes("shizi-v13-") && swSource.includes("'data/etymology.json'") && swSource.includes("Promise.allSettled") && swSource.includes("INSTALL_BATCH_SIZE = 40") && swSource.includes("cacheFreshShell") && swSource.includes("cache.addAll(requests)") && swSource.includes("cache: 'reload'")
  && swSource.includes("STROKE_CACHE_LIMIT = 800") && swSource.includes("trimStrokeCache") && swSource.includes("cacheResponseBestEffort") && swSource.includes("updateCacheFromNetwork"),
"Expected atomic versioned offline installation plus a bounded stroke cache with background refresh");
assert(swSource.includes("data/context-overrides.js?v=") && source.includes('<script src="data/context-overrides.js?v=') && source.includes('<script src="deck-data.js?v=') && contextOverrideSource.includes("CONTEXT_OVERRIDES"), "Expected fingerprinted corpus/context assets in both online and offline shells");
assert(coreStrokeSource.includes("SHIZI_CORE_STROKES") && !coreStrokeSource.includes("SEED"), "Expected a self-contained generated core stroke list that the worker can load atomically");
assert(Array.isArray(etymology) && etymology.length === etymologyCoverage.totals.entries && new Set(etymology.map((row) => row.char)).size === etymology.length
  && etymology.every((row) => Object.keys(row).sort().join() === "char,gloss,source" && Array.from(row.char).length === 1 && row.gloss.length >= 1 && row.gloss.length <= 20 && ["《说文解字》", "Make Me a Hanzi"].includes(row.source)),
"Expected unique, compact and explicitly attributed etymology records", { count: etymology.length });
assert(etymologyCoverage.schemaVersion === 2 && etymologyCoverage.totals.topCharacters === 1000 && etymologyCoverage.totals.topCovered >= 900
  && etymologyCoverage.totals.radicalCovered + etymologyCoverage.missingRadicalCharacters.length === etymologyCoverage.totals.radicalCharacters
  && etymologyCoverage.missingRadicalCharacters.every((char) => etymologyCoverage.omissions[char])
  && etymologyCoverage.missingTopCharacters.every((char) => !etymology.some((row) => row.char === char)),
"Expected every top-frequency and radical coverage gap to be explicit", etymologyCoverage.totals);
assert(etymologyBuilderSource.includes("build_shuowen_indexes") && etymologyBuilderSource.includes("len(traditional) == 1") && !etymologyBuilderSource.includes("next((candidate for candidate in candidates"),
  "Expected exact headword indexing and one-to-one-only automatic OpenCC resolution");
assert(Object.entries(etymologyCoverage.detail).every(([char, row]) => {
  const baseKind = row.matchKind.replace("+reviewed-copy", "");
  return ["exact", "reviewed-alias", "reviewed-context", "opencc-one-to-one", "make-me-a-hanzi"].includes(baseKind)
    && (baseKind !== "exact" || row.sourceHeadword === char);
}),
  "Expected every published source match to disclose a safe resolution path");
assert(Object.entries(etymologyCoverage.detail).every(([char, row]) => !openccOneToMany.has(char) || row.matchKind.startsWith("reviewed-context")),
  "Expected every published OpenCC one-to-many character to require context review");
assert(etymologyContextAudit.entries.length === etymologyContextAudit.expectedCount && etymologyCoverage.contextAudit.count === etymologyContextAudit.expectedCount,
  "Expected the complete 69-character context audit to remain enforced");
assert(etymologyCopyReview.entries.length === etymologyCopyReview.expectedCount && etymologyCoverage.copyReview.count === etymologyCopyReview.expectedCount,
  "Expected every readability exception to have an explicit human decision");
assert(etymology.every((row) => !hasCjkExtension(row.gloss) && !isOpaqueAncientGloss(row.gloss)),
  "Expected published copy to reject CJK extensions and opaque ancient one-word definitions");
const etymologyByChar = new Map(etymology.map((row) => [row.char, row]));
assert(etymologyAccuracyFixture.entries.every((expected) => {
  const row = etymologyByChar.get(expected.char), detail = etymologyCoverage.detail[expected.char], omission = etymologyCoverage.omissions[expected.char];
  if (expected.status === "absent") return !row && !detail && omission?.reason === expected.strategy;
  return row?.source === expected.source && row?.gloss === expected.gloss && detail?.sourceHeadword === expected.sourceHeadword
    && detail?.matchKind === expected.matchKind && detail?.gloss === expected.gloss;
}), "Expected reviewed exact-headword and ambiguity fixtures to match generated output", etymologyAccuracyFixture);
assert(etymologyCopyReview.entries.every((expected) => {
  const row = etymologyByChar.get(expected.char), detail = etymologyCoverage.detail[expected.char], omission = etymologyCoverage.omissions[expected.char];
  if (expected.status === "absent") return !row && !detail && omission?.reason === "readability-review-omission" && omission?.candidate === expected.candidate;
  return row?.gloss === expected.copy && detail?.gloss === expected.copy && detail?.matchKind.endsWith("+reviewed-copy");
}), "Expected every approved plain-language copy or intentional omission to match its fixed candidate", etymologyCopyReview);
assert(!source.includes("sendBeacon") && !/method\s*:\s*["']POST["']/.test(source), "Expected the local funnel to add no analytics beacon or POST request");
assert(source.includes('http-equiv="Content-Security-Policy"') && source.includes("default-src 'self'") && source.includes("frame-src 'none'") && !source.includes("cdn.jsdelivr.net"),
  "Expected a self-contained CSP with no remote stroke-data fallback");
assert(schemeHandlerSource.includes('"Content-Security-Policy"') && schemeHandlerSource.includes('"X-Content-Type-Options": "nosniff"'),
  "Expected the custom scheme to emit CSP and nosniff headers");
assert(webViewSource.includes("message.frameInfo.isMainFrame") && webViewSource.includes('["http", "https", "mailto"].contains(scheme)')
  && webViewSource.includes("url.host == ShiziWebResource.host") && !/targetFrame\?\.isMainFrame != false[\s\S]{0,180}else\s*\{\s*decisionHandler\(\.allow\)/.test(webViewSource),
  "Expected the native bridge, local origin, external schemes, and subframe navigation to be explicitly constrained");
assert(webViewSource.includes("WeakScriptMessageHandler(delegate: self)") && webViewSource.includes('removeScriptMessageHandler(forName: "shiziNative")')
  && /#if DEBUG[\s\S]+__shizi_native_smoke_confirm__[\s\S]+#else[\s\S]+runNativeSmokeIfNeeded\(\) \{\}/.test(webViewSource)
  && webViewSource.includes("cleanupTemporaryShareFiles()") && webViewSource.includes("completionWithItemsHandler")
  && webViewSource.includes("shouldRemoveCopy") && webViewSource.includes("private func presentBackupPicker() {\n        guard presentedViewController == nil")
  && webViewSource.includes("private func presentError(message: String) {\n        guard presentedViewController == nil"),
"Expected a cycle-free bridge, Debug-only smoke, temporary-file cleanup, and consistent presentation guards");
assert(source.includes(":focus-visible") && source.includes("手写区。可用手指或触控笔书写；无法手写时请选择不会写。"),
  "Expected visible keyboard focus and a spoken alternative for the handwriting canvas");
assert(!/rgba\((?:190,\s*68,\s*43|217,\s*106,\s*83)/i.test(source) && source.includes("--accent-rgb:190,68,43") && source.includes("--accent-rgb:217,106,83"), "Expected every cinnabar alpha to follow the light/dark theme token");
assert(!source.includes(".card.undoActive .chdr{ visibility:hidden; }") && source.includes(".undoBar{ display:none; position:relative") && !source.includes('$("tip").title='), "Expected the undo bar to keep the return header visible and touch guidance to avoid invisible title copy");
assert(/funnelSeenLength\s*:\s*funnel\.seen\.length/.test(source) && /funnelEventsLength\s*:\s*funnel\.events\.length/.test(source)
  && /funnel\.seen\s*=\s*funnel\.seen\.slice/.test(source) && !/funnelValue\s*:\s*cloneObj\(funnel\)/.test(source),
"Expected stamp undo to persist only bounded funnel deltas instead of the full history");
assert(source.includes("FSRS_RAW_RETENTION_DAYS=120") && source.includes("ACTIVITY_RAW_RETENTION_DAYS=400")
  && source.includes("roundStats:sessionRoundStats()") && !/sessionPayload\(\)[\s\S]{0,700}lastStampSnapshot/.test(source),
"Expected bounded raw histories and a session payload without transient undo or handwriting data");
assert(source.includes("ROUND_DURATION_CAP_MS") && /const bounded\s*=\s*Math\.min\(/.test(source) && /durationMs\s*:\s*bounded/.test(source), "Expected the round duration to be capped client-side against background/idle inflation");
assert(source.includes("STAMP_HOLD_MS=1800") && source.includes("EDIT_STAMP_WINDOW_MS=1800") && !source.includes("shortDueDay(m.dueDay)"), "Expected readable 1800ms stamp feedback without exposing internal scheduling copy");
assert(source.includes('navigator.vibrate(10)') && source.includes('animation="cardSwapIn .18s ease-out both"') && source.includes('classList.add("revealing")'), "Expected Web haptics and staggered card/reveal transitions");
assert(source.includes('OUTCOME_DOT={ fast:"transparent", hinted:"var(--gold)", slow:"var(--accent)"') && !/slow:\s*"var\(--blue\)"/.test(source), "Expected silent success, gold assistance, and cinnabar risk result semantics");
assert(source.includes('if(!sound.enabled') && source.includes('{type:"sound",kind}') && source.includes('if(tracing) soundFeedback("paper")') && source.includes('soundFeedback("stamp")'), "Expected two-site, opt-out paper sound feedback with no disabled audio initialization");
assert(source.includes("brushWidthFor") && source.includes("paintBrushStroke") && source.includes("brushStrokeLayer") && source.includes("compositeBrushLayer") && source.includes('pointer==="pen"') && source.includes('"destination-out"') && source.includes('"source-over"') && source.includes("paintInkBloom") && !source.includes("dryColor"), "Expected one shared pressure, taper, isolated dry-brush, and ink-bloom renderer");
assert(source.includes("SOUNDSCAPE_SCENES") && source.includes("ambientNoiseBuffer") && source.includes("syncAmbientForView") && !/function startAmbient[^{]*\{[^}]*sound\.enabled/.test(source), "Expected an independent, procedural, practice-only soundscape");
assert(source.includes("enterWritingChrome") && source.includes("finishWritingChrome") && source.includes("setWritingChromeHidden") && source.includes("paperReveal") && source.includes("REST_LINES"), "Expected accessible stove-mode chrome, one-time paper reveal, and fixed closing microcopy");
assert(source.includes("loadEtymology") && source.includes("renderEtymLine") && source.includes('fetch("data/etymology.json")') && !source.includes("暂无释义"), "Expected a lazy, silent-absence etymology row");
assert(webViewSource.includes("AVAudioSession.sharedInstance().setCategory(.ambient") && webViewSource.includes('case "sound"') && webViewSource.includes('case "soundscape"') && webViewSource.includes('content.userInfo = ["targetCardKey": question.targetCardKey]'), "Expected native ambient audio-session setup, paper sounds, and notification target metadata");
assert(webViewSource.includes("VNImageRequestHandler(cgImage: cgImage, orientation: orientation")
  && webViewSource.includes("const fixtureFile = new File([fixtureBlob]")
  && webViewSource.includes("wildVisionRequestCompleted"),
"Expected native OCR to honor image orientation and its smoke to process a real decodable image through Vision");
assert(appDelegateSource.includes("didReceive response: UNNotificationResponse") && appDelegateSource.includes("openReminderTarget(cardKey: targetCardKey)"), "Expected notification taps to reach the Web practice target on cold or warm launch");

function verifyBackupSummaryScript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shizi-funnel-"));
  const backup = (opens, funnel) => ({ app: "shizi", version: 1, date: "2026-07-16T08:00:00.000Z", data: { "shizi.opens.v1": JSON.stringify(opens), "shizi.funnel.v1": JSON.stringify(funnel) } });
  const events = (...names) => names.map((name, index) => ({ name, at: Date.UTC(2026, 6, index + 1), day: `2026-07-${String(index + 1).padStart(2, "0")}` }));
  const rows = [
    backup(["2026-07-01", "2026-07-02", "2026-07-08"], { version: 1, events: events("welcome_shown", "calib_card1_done", "calib_completed"), counts: { revealCompared: 10, revealDisagree: 2 }, rounds: [{ completedAt: 1, durationMs: 60000 }, { completedAt: 2, durationMs: 120000 }] }),
    backup(["2026-07-01", "2026-07-03", "2026-07-08"], { version: 1, events: events("welcome_shown", "calib_card1_done"), counts: { revealCompared: 5, revealDisagree: 1 }, rounds: [{ completedAt: 3, durationMs: 30000 }] }),
  ];
  const files = rows.map((row, index) => { const file = path.join(dir, `${index}.json`); fs.writeFileSync(file, JSON.stringify(row)); return file; });
  try {
    const output = execFileSync("python3", [path.join(root, "scripts", "summarize_backups.py"), "--json", ...files], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert(summary.retention.d1.returned === 1 && summary.retention.d1.eligible === 2 && summary.retention.d7.returned === 2 && summary.retention.d7.eligible === 2
      && summary.calibration.card1_rate === 1 && summary.calibration.completion_rate === 0.5
      && summary.system_comparison.disagreement_rate === 0.2 && summary.rounds.completed === 3 && summary.rounds.average_duration_seconds === 70,
    "Expected backup summary D1/D7, calibration, disagreement, and duration metrics", summary);
    const v2File = path.join(dir, "v2.json");
    fs.writeFileSync(v2File, JSON.stringify(backup(["2026-07-01"], { version: 2, events: [], eventCounts: { welcome_shown: 1, calib_card1_done: 1, calib_completed: 1 }, counts: { revealCompared: 8, revealDisagree: 2 }, rounds: [{ completedAt: 4, mode: "calibrate", durationMs: 900000 }, { completedAt: 5, mode: "new", durationMs: 30000 }], roundTotals: { count: 11, durationMs: 1920000, byMode: { calibrate: { count: 5, durationMs: 1500000 }, new: { count: 4, durationMs: 240000 }, review: { count: 2, durationMs: 180000 } } } })));
    const v2Summary = JSON.parse(execFileSync("python3", [path.join(root, "scripts", "summarize_backups.py"), "--json", v2File], { encoding: "utf8" }));
    assert(v2Summary.files.with_funnel === 1 && v2Summary.calibration.completed === 1 && v2Summary.system_comparison.disagreement_rate === 0.25
      && v2Summary.rounds.completed === 6 && v2Summary.rounds.average_duration_seconds === 70 && v2Summary.rounds.median_duration_seconds === 30,
    "Expected bounded funnel v2 lifetime counters and mode totals to remain reportable without calibration inflation", v2Summary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

verifyBackupSummaryScript();

async function verifyServiceWorkerCacheFailureIsolation() {
  const listeners = {};
  const coreURL = "http://127.0.0.1:8000/data/%E6%B0%B4.json";
  const stored = new Map([[coreURL, "cached-core"]]);
  let deleteCalls = 0;
  const requestURL = request => request && request.url ? request.url : String(request);
  const cache = {
    addAll: async () => {},
    keys: async () => Array.from(stored.keys(), url => new Request(url)),
    delete: async request => { deleteCalls += 1; return stored.delete(requestURL(request)); },
    match: async request => stored.has(requestURL(request)) ? new Response(stored.get(requestURL(request))) : undefined,
    put: async () => { throw new DOMException("quota", "QuotaExceededError"); },
  };
  const context = {
    self: { SHIZI_CORE_STROKES: ["水"], location: { href: "http://127.0.0.1:8000/sw.js", origin: "http://127.0.0.1:8000" }, addEventListener: (name, handler) => { listeners[name] = handler; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, match: request => cache.match(request), keys: async () => [], delete: async () => true },
    fetch: async request => new Response(`fresh:${new URL(request.url).pathname}`, { status: 200 }),
    importScripts: () => {}, Request, Response, URL, DOMException, Promise, Set,
  };
  vm.runInNewContext(swSource, context, { filename: "sw.js" });
  async function dispatch(pathname, accept = "application/javascript") {
    let responsePromise; const waits = [];
    listeners.fetch({ request: new Request(`http://127.0.0.1:8000${pathname}`, { headers: { accept } }), respondWith: promise => { responsePromise = Promise.resolve(promise); }, waitUntil: promise => waits.push(Promise.resolve(promise)) });
    const response = await responsePromise; await Promise.all(waits); return response && response.text();
  }
  const results = {
    html: await dispatch("/", "text/html"),
    static: await dispatch("/deck-data.js"),
    stroke: await dispatch("/data/%E7%81%AB.json", "application/json"),
    core: await dispatch("/data/%E6%B0%B4.json", "application/json"),
  };
  assert(results.html === "fresh:/" && results.static === "fresh:/deck-data.js" && results.stroke === "fresh:/data/%E7%81%AB.json"
    && results.core === "cached-core" && stored.get(coreURL) === "cached-core" && deleteCalls === 0,
  "Expected cache quota failures to preserve successful responses and any existing offline core copy", { results, deleteCalls, stored: Array.from(stored.entries()) });
}

async function waitForWriter(page) {
  await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0 && !animating);
}

async function submitStandard(page, options = {}) {
  await waitForWriter(page);
  await page.evaluate(({ hintStrokes = 0 }) => {
    if (hintStrokes > 0) {
      shownStrokes = hintStrokes;
      groupIdx = 1;
      hintEverUsed = true;
      hintsUsedThisCard = 1;
    }
    inkStrokes = mediansToCanvas(curMedians.slice(hintStrokes));
    redrawInk();
    revealAnswer();
  }, options);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("reveal")).display !== "none");
}

async function chooseCorrect(page) {
  await page.click("#decisionCorrect");
  await page.waitForFunction(() => stamped && getComputedStyle(document.getElementById("stampedToast")).display !== "none");
}

let browser;
(async () => {
  await verifyServiceWorkerCacheFailureIsolation();
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const localChrome = chromeExecutable();
  browser = await chromium.launch({ headless: true, ...(localChrome ? { executablePath: localChrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  let offlineProbe = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { const value = message.text(); if (message.type() === "error" && !(offlineProbe && /ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(value))) pageErrors.push(value); });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const firstRun = await page.evaluate(() => ({
    welcome: getComputedStyle(document.getElementById("welcome")).display !== "none",
    copy: document.getElementById("welcome").textContent.replace(/\s+/g, ""),
    footHidden: getComputedStyle(document.getElementById("foot")).display === "none",
    needsCalibration: needsCalibration(),
    restoreVisible: getComputedStyle(document.getElementById("welcomeRestore")).display !== "none" && typeof document.getElementById("welcomeRestore").onclick === "function",
    tabs: Array.from(document.querySelectorAll("#foot .tab")).map((node) => node.textContent.replace(/\s+/g, "")),
    welcomeEvents: funnel.events.filter((row) => row.name === "welcome_shown").length,
  }));
  assert(firstRun.welcome && firstRun.footHidden && firstRun.needsCalibration && firstRun.restoreVisible && firstRun.copy.includes("先练15个字") && firstRun.copy.includes("记录默认保存在当前设备") && firstRun.tabs.join() === "习字,字库,我的" && firstRun.welcomeEvents === 1, "Expected first-run calibration welcome, one-time funnel event, storage expectation, restore entry, and final three-tab IA", firstRun);

  const p2Style = await page.evaluate(async () => {
    await document.fonts.ready;
    const nodes = { root: document.documentElement, heading: document.querySelector(".welcome h1"), actions: document.querySelector(".welcomeActions"), cta: document.getElementById("welcomeStart"), body: document.body, sheet: document.querySelector(".sheetCard"), toastGlyph: document.getElementById("toastChar") };
    const missing = Object.entries(nodes).filter(([, node]) => !(node instanceof Element)).map(([name]) => name); if (missing.length) throw new Error(`Missing style nodes: ${missing.join(",")}`);
    const root = getComputedStyle(nodes.root), heading = getComputedStyle(nodes.heading), actions = getComputedStyle(nodes.actions), cta = getComputedStyle(nodes.cta), body = getComputedStyle(nodes.body), sheet = getComputedStyle(nodes.sheet), toastGlyph = getComputedStyle(nodes.toastGlyph), source = document.querySelector("style").textContent;
    const fontMatch = source.match(/data:font\/woff2;base64,([^)]*)/);
    return { tokens: ["--fs-caption", "--fs-note", "--fs-body", "--fs-emph"].map((name) => root.getPropertyValue(name).trim()), spaces: ["--space-1", "--space-2", "--space-3", "--space-4"].map((name) => root.getPropertyValue(name).trim()), letter: [root.getPropertyValue("--ls-label").trim(), root.getPropertyValue("--ls-motto").trim()], faint: root.getPropertyValue("--faint").trim(), kai: root.getPropertyValue("--kai"),
      heading: { size: parseFloat(heading.fontSize), line: parseFloat(heading.lineHeight), spacing: heading.letterSpacing }, actionsMargin: parseFloat(actions.marginTop), ctaMargin: parseFloat(cta.marginTop), toastGlyph: parseFloat(toastGlyph.fontSize), bodyNoise: body.backgroundImage, sheetNoise: sheet.backgroundImage,
      fontLoaded: document.fonts.check('24px "Shizi Brand"', "拾字练习"), fontBytes: fontMatch ? atob(fontMatch[1]).length : 0, inlineWelcomeStyle: document.querySelector(".welcomeActions").hasAttribute("style"), nonzeroLetterSpacing: Array.from(source.matchAll(/letter-spacing:\s*([^;}]+)/g), (match) => match[1].trim()).some((value) => !["0", "var(--ls-label)", "var(--ls-motto)"].includes(value)) };
  });
  assert(p2Style.tokens.join() === "11px,12px,13px,15px" && p2Style.spaces.join() === "8px,12px,16px,24px" && p2Style.letter.join() === ".12em,.26em" && p2Style.faint === "#6a604f" && p2Style.kai.includes("DFKai-SB") && p2Style.kai.includes("AR PL UKai CN") && p2Style.kai.includes("TW-Kai")
    && p2Style.heading.size === 31 && Math.abs(p2Style.heading.line / p2Style.heading.size - 1.35) < 0.02 && ["normal", "0px"].includes(p2Style.heading.spacing) && p2Style.actionsMargin === 52 && p2Style.ctaMargin === 0 && !p2Style.inlineWelcomeStyle
    && p2Style.toastGlyph === 26 && p2Style.bodyNoise !== "none" && p2Style.sheetNoise !== "none" && p2Style.fontLoaded && p2Style.fontBytes > 0 && p2Style.fontBytes < 20000 && !p2Style.nonzeroLetterSpacing,
  "Expected converged type/spacing tokens, an offline Android-safe brand font, and paper texture", p2Style);

  const brushEngine = await page.evaluate(() => {
    const base = 20, previous = { x: 0, y: 0, t: 0 };
    const width = (point) => brushWidthFor({ ...point }, previous, { ema: 0 }, base);
    const widths = {
      slow: width({ x: 5, y: 0, t: 20, p: 0 }),
      fast: width({ x: 45, y: 0, t: 20, p: 0 }),
      pressureLow: width({ x: 20, y: 0, t: 20, p: .15 }),
      pressureHigh: width({ x: 20, y: 0, t: 20, p: .9 }),
    };
    const high = { hardwareConcurrency: 8, deviceMemory: 4 }, low = { hardwareConcurrency: 2, deviceMemory: 2 }, originalMatchMedia = window.matchMedia;
    const fullDetail = brushDetailEnabled(high), lowDetail = brushDetailEnabled(low);
    window.matchMedia = (query) => query.includes("prefers-reduced-motion") ? { matches: true } : originalMatchMedia(query);
    const reducedDetail = brushDetailEnabled(high);
    window.matchMedia = originalMatchMedia;

    const makeCanvas = () => { const canvas = document.createElement("canvas"); canvas.width = 220; canvas.height = 100; return canvas; };
    const points = Array.from({ length: 17 }, (_, i) => ({ x: 20 + i * 10, y: 50, t: i * 10, w: 1.2, v: i ? 1 : 0 }));
    const simple = makeCanvas(), simpleCtx = simple.getContext("2d");
    paintBrushStroke(simpleCtx, points, base, { color: "#000", detail: false });
    const spanAt = (ctx, x) => { const data = ctx.getImageData(x, 0, 1, 100).data; let first = -1, last = -1; for (let y = 0; y < 100; y += 1) if (data[y * 4 + 3] > 12) { if (first < 0) first = y; last = y; } return last >= first ? last - first + 1 : 0; };
    const taper = { head: spanAt(simpleCtx, 22), middle: spanAt(simpleCtx, 100), tail: spanAt(simpleCtx, 178) };

    const detailed = makeCanvas(), detailedCtx = detailed.getContext("2d");
    const fastPoints = points.map((point, i) => ({ ...point, v: i ? 1.7 : 0 }));
    paintBrushStroke(detailedCtx, fastPoints, base, { color: "#000", detail: true, capabilities: high });
    const alphaSum = (ctx, x1, x2) => { const data = ctx.getImageData(x1, 36, x2 - x1, 28).data; let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i]; return sum; };
    const texture = { simple: alphaSum(simpleCtx, 55, 165), detailed: alphaSum(detailedCtx, 55, 165), simpleHead: spanAt(simpleCtx, 20), detailedHead: spanAt(detailedCtx, 20) };

    const target = [[{ x: 35, y: 35 }, { x: 100, y: 35 }, { x: 165, y: 35 }], [{ x: 100, y: 35 }, { x: 100, y: 100 }, { x: 100, y: 165 }]];
    const enriched = target.map((stroke, row) => stroke.map((point, index) => ({ ...point, t: index * 14, w: .7 + index * .25, v: row + index * .4 })));
    const recognition = { plain: checkInk(target, target), enriched: checkInk(enriched, target) }, legacyWidth = brushStrokeGeometry(target[0], base).widths[1];
    const shared = shareInkFromSnapshot({ canvasSize: 200, inkStrokes: [enriched[0]] });

    const squareCanvas = () => { const canvas = document.createElement("canvas"); canvas.width = 220; canvas.height = 220; return canvas; };
    const vertical = Array.from({ length: 13 }, (_, i) => ({ x: 110, y: 20 + i * 15, w: 1.45, v: 0 }));
    const horizontal = Array.from({ length: 17 }, (_, i) => ({ x: 20 + i * 11.25, y: 110, w: 1.2, v: i ? 2.2 : 0 }));
    const crossing = squareCanvas(), crossingCtx = crossing.getContext("2d");
    paintBrushStroke(crossingCtx, vertical, base, { color: "#29241d", detail: false });
    const crossingBefore = crossingCtx.getImageData(0, 0, 220, 220).data;
    paintBrushStroke(crossingCtx, horizontal, base, { color: "#29241d", detail: true, capabilities: high });
    const crossingAfter = crossingCtx.getImageData(0, 0, 220, 220).data; let crossingAlphaLoss = 0;
    for (let i = 3; i < crossingBefore.length; i += 4) if (crossingBefore[i] === 255 && crossingAfter[i] < 255) crossingAlphaLoss += 1;

    const hint = squareCanvas(), hintCtx = hint.getContext("2d"); hintCtx.strokeStyle = "#d08b78"; hintCtx.lineWidth = 22; hintCtx.lineCap = "round"; hintCtx.beginPath(); hintCtx.moveTo(110, 20); hintCtx.lineTo(110, 200); hintCtx.stroke();
    const hintBefore = hintCtx.getImageData(0, 0, 220, 220).data;
    paintBrushStroke(hintCtx, horizontal, base, { color: "#29241d", detail: true, capabilities: high });
    const hintAfter = hintCtx.getImageData(0, 0, 220, 220).data; let hintAlphaLoss = 0;
    for (let i = 3; i < hintBefore.length; i += 4) if (hintBefore[i] === 255 && hintAfter[i] < 255) hintAlphaLoss += 1;

    const normalized = [vertical, horizontal].map(stroke => stroke.map(point => ({ x: point.x / 220, y: point.y / 220, w: point.w, v: point.v })));
    const share = squareCanvas(), shareCtx = share.getContext("2d"); shareCtx.fillStyle = "#fdfbf4"; shareCtx.fillRect(0, 0, 220, 220); drawShareHandwriting(shareCtx, normalized, 10, 10, 200, 0);
    const expected = squareCanvas(), expectedCtx = expected.getContext("2d"); expectedCtx.fillStyle = "#fdfbf4"; expectedCtx.fillRect(0, 0, 220, 220); expectedCtx.strokeStyle = "#c2452c38"; expectedCtx.lineWidth = 2; expectedCtx.setLineDash([7, 7]);
    [[110, 10, 110, 210], [10, 110, 210, 110], [10, 10, 210, 210], [210, 10, 10, 210]].forEach(line => { expectedCtx.beginPath(); expectedCtx.moveTo(line[0], line[1]); expectedCtx.lineTo(line[2], line[3]); expectedCtx.stroke(); }); expectedCtx.setLineDash([]);
    normalized.forEach(stroke => { const layerCanvas = squareCanvas(), layerCtx = layerCanvas.getContext("2d"), scaled = stroke.map(point => ({ x: 10 + point.x * 200, y: 10 + point.y * 200, w: point.w, v: point.v })); paintBrushStroke(layerCtx, scaled, 15, { color: "#29241d", detail: true }); expectedCtx.drawImage(layerCanvas, 0, 0); });
    const sharePixels = shareCtx.getImageData(0, 0, 220, 220).data, expectedPixels = expectedCtx.getImageData(0, 0, 220, 220).data; let shareMismatch = 0, shareMinAlpha = 255;
    for (let i = 0; i < sharePixels.length; i += 1) { if (sharePixels[i] !== expectedPixels[i]) shareMismatch += 1; if (i % 4 === 3) shareMinAlpha = Math.min(shareMinAlpha, sharePixels[i]); }

    const perfCanvas = document.createElement("canvas"); perfCanvas.width = 300; perfCanvas.height = 300; const perfCtx = perfCanvas.getContext("2d");
    const perfPoints = Array.from({ length: 96 }, (_, i) => ({ x: 15 + i * 2.75, y: 150 + Math.sin(i / 7) * 55, t: i * 3, w: .75 + (i % 9) / 18, v: 1.25 + (i % 5) * .12 }));
    const started = performance.now(); for (let i = 0; i < 90; i += 1) { perfCtx.clearRect(0, 0, 300, 300); paintBrushStroke(perfCtx, perfPoints, 14, { color: "#29241d", detail: true, capabilities: high }); } const averageMs = (performance.now() - started) / 90;
    return { widths, detail: { fullDetail, lowDetail, reducedDetail }, taper, texture, recognition, legacyWidth, shared, layering: { crossingAlphaLoss, hintAlphaLoss, shareMismatch, shareMinAlpha }, averageMs };
  });
  assert(brushEngine.widths.slow > brushEngine.widths.fast && brushEngine.widths.pressureHigh > brushEngine.widths.pressureLow && brushEngine.detail.fullDetail && !brushEngine.detail.lowDetail && !brushEngine.detail.reducedDetail,
    "Expected slower or harder Pencil input to draw wider and low-end/reduced-motion devices to simplify details", brushEngine);
  assert(brushEngine.taper.middle > brushEngine.taper.head && brushEngine.taper.head > brushEngine.taper.tail && brushEngine.texture.detailed < brushEngine.texture.simple && brushEngine.texture.detailedHead <= brushEngine.texture.simpleHead + 4,
    "Expected tapered endpoints, restrained dry-brush texture, and at most a two-pixel ink bloom per edge", brushEngine);
  assert(JSON.stringify(brushEngine.recognition.plain) === JSON.stringify(brushEngine.recognition.enriched) && brushEngine.legacyWidth === 20 && brushEngine.shared[0].every((point) => Number.isFinite(point.w) && Number.isFinite(point.v)) && brushEngine.averageMs < 16.7,
    "Expected brush metadata to leave recognition unchanged, preserve legacy ink width, survive sharing, and render within one 60fps frame", brushEngine);
  assert(brushEngine.layering.crossingAlphaLoss === 0 && brushEngine.layering.hintAlphaLoss === 0 && brushEngine.layering.shareMismatch === 0 && brushEngine.layering.shareMinAlpha === 255,
    "Expected each dry-brush stroke to preserve crossing ink and hints, match transparent-layer share composition, and keep PNG pixels opaque", brushEngine.layering);

  const funnelBoundary = await page.evaluate(() => {
    const originalFunnel = JSON.parse(JSON.stringify(funnel)), originalOpens = opens.slice(), originalRound = { roundId, activeMode, baseTargets: baseTargets.slice(), attemptSeq };
    funnel = newFunnel(); saveFunnel(); renderHome(); renderHome();
    opens = [shiftDay(today(), -1), today()]; maybeRecordD2Return(); maybeRecordD2Return();
    recordFunnelComparison("verify-disagree", false, Date.now()); recordFunnelComparison("verify-disagree", false, Date.now()); recordFunnelComparison("verify-agree", true, Date.now());
    roundId = "verify-funnel-round"; activeMode = "new"; baseTargets = [0, 1]; attemptSeq = 3; recordFunnelRound(90000); recordFunnelRound(180000);
    dataLink.click(); const devCopy = dataBox.textContent; dataLink.click();
    const exportedAt = Date.now(), projected = JSON.parse(backupPayload({ preserveMeta: true, exportedAt, funnelExportAt: exportedAt })), projectedFunnel = JSON.parse(projected.data[FUNNEL_KEY]);
    const restored = normalizeFunnel(projectedFunnel), noDuplicateAfterRestore = !appendFunnelEvent(restored, "backup_exported", "backup_exported", exportedAt);
    const result = { events: Object.fromEntries(["welcome_shown", "d2_return", "reveal_disagree"].map((name) => [name, funnel.events.filter((row) => row.name === name).length])), counts: { ...funnel.counts }, rounds: funnel.rounds.slice(), devCopy, projectedBackup: projectedFunnel.events.filter((row) => row.name === "backup_exported").length, localBackup: funnel.events.filter((row) => row.name === "backup_exported").length, noDuplicateAfterRestore, hasFunnelKey: BACKUP_KEYS.includes(FUNNEL_KEY) };
    funnel = normalizeFunnel(originalFunnel); saveFunnel(); opens = originalOpens; save(OPEN_KEY, opens); roundId = originalRound.roundId; activeMode = originalRound.activeMode; baseTargets = originalRound.baseTargets; attemptSeq = originalRound.attemptSeq;
    return result;
  });
  assert(funnelBoundary.events.welcome_shown === 1 && funnelBoundary.events.d2_return === 1 && funnelBoundary.events.reveal_disagree === 1
    && funnelBoundary.counts.revealCompared === 2 && funnelBoundary.counts.revealDisagree === 1 && funnelBoundary.rounds.length === 1 && funnelBoundary.rounds[0].durationMs === 90000
    && funnelBoundary.devCopy.includes("本地漏斗") && funnelBoundary.devCopy.includes("平均 90 秒") && funnelBoundary.projectedBackup === 1 && funnelBoundary.localBackup === 0 && funnelBoundary.noDuplicateAfterRestore && funnelBoundary.hasFunnelKey,
  "Expected idempotent local funnel, projected successful-export event, and backup allowlist", funnelBoundary);

  const undoFunnel = await page.evaluate(() => {
    const original = JSON.parse(JSON.stringify(funnel));
    funnel = newFunnel(); saveFunnel();
    const preStamp = { seen: funnel.seen.length, events: funnel.events.length, counts: { ...funnel.counts }, eventCounts: { ...funnel.eventCounts } };
    recordFunnelComparison("verify-undo", false, Date.now());       // 误盖“没写出”，与系统“判定 ok”分歧
    const afterDisagree = { ...funnel.counts };
    funnel.seen = funnel.seen.slice(0, preStamp.seen); funnel.events = funnel.events.slice(0, preStamp.events); funnel.counts = preStamp.counts; funnel.eventCounts = preStamp.eventCounts; saveFunnel();
    const afterUndo = { ...funnel.counts, seenHasKey: funnel.seen.includes("reveal:verify-undo") };
    recordFunnelComparison("verify-undo", true, Date.now());        // 改盖“秒过”，与系统一致——修正后不应仍算分歧
    const afterAgree = { ...funnel.counts };
    funnel = normalizeFunnel(original); saveFunnel();
    return { afterDisagree, afterUndo, afterAgree };
  });
  assert(undoFunnel.afterDisagree.revealCompared === 1 && undoFunnel.afterDisagree.revealDisagree === 1
    && undoFunnel.afterUndo.revealCompared === 0 && undoFunnel.afterUndo.revealDisagree === 0 && !undoFunnel.afterUndo.seenHasKey
    && undoFunnel.afterAgree.revealCompared === 1 && undoFunnel.afterAgree.revealDisagree === 0,
  "Expected undo to roll back the funnel comparison so a corrected re-stamp is not counted as a system disagreement", undoFunnel);

  const exportCommit = await page.evaluate(async () => {
    const originalFunnel = JSON.parse(JSON.stringify(funnel)), originalMeta = JSON.parse(JSON.stringify(backupMeta));
    const hadCanShare = Object.prototype.hasOwnProperty.call(navigator, "canShare"), hadShare = Object.prototype.hasOwnProperty.call(navigator, "share");
    const localExports = () => funnel.events.filter((row) => row.name === "backup_exported").length;
    try {
      funnel = newFunnel(); saveFunnel();
      const before = localExports();
      navigator.canShare = () => true; navigator.share = () => Promise.resolve();  // 系统分享成功
      await exportBackup();
      const afterSuccess = localExports();                                          // 成功后本机落账一次
      await exportBackup();
      const afterRepeat = localExports();                                           // 再次导出幂等，不重复落账
      funnel = newFunnel(); saveFunnel();
      navigator.share = () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));  // 用户取消分享
      await exportBackup();
      const afterCancel = localExports();                                           // 取消不落账
      return { before, afterSuccess, afterRepeat, afterCancel };
    } finally {
      if (!hadCanShare) delete navigator.canShare;
      if (!hadShare) delete navigator.share;
      funnel = normalizeFunnel(originalFunnel); saveFunnel(); backupMeta = originalMeta; save(BACKUP_META_KEY, backupMeta);
    }
  });
  assert(exportCommit.before === 0 && exportCommit.afterSuccess === 1 && exportCommit.afterRepeat === 1 && exportCommit.afterCancel === 0,
  "Expected a successful share to commit backup_exported locally once (idempotent) and a cancelled share to not commit", exportCommit);

  const restoreChooser = page.waitForEvent("filechooser");
  await page.click("#welcomeRestore");
  assert(!!(await restoreChooser), "Expected the first-run restore entry to open the backup picker");
  await page.evaluate(() => {
    const payload = JSON.parse(backupPayload()), idx = CARDS.findIndex((card) => card.target === "器"), key = cardKey(idx);
    payload.data[MEMORY_KEY] = JSON.stringify({ [key]: { seen: 1, last: Date.now(), target: "器", fast: 1 } });
    payload.data[TUNING_KEY] = JSON.stringify({ calibrated: true, offset: 0, contextStrict: 0, rounds: [] });
    restoreBackupPayload(payload, { skipConfirm: true, reload: false });
  });
  await page.reload({ waitUntil: "networkidle" });
  const firstRunRestore = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", welcome: getComputedStyle(welcome).display !== "none", count: memoryCount() }));
  assert(firstRunRestore.home && !firstRunRestore.welcome && firstRunRestore.count === 1, "Expected a valid first-run backup to enter the returning-user home", firstRunRestore);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const inheritedDays = await page.evaluate(() => {
    opens = [shiftDay(today(), -3), shiftDay(today(), -2), shiftDay(today(), -1), today()]; save(OPEN_KEY, opens);
    activity = newActivity();
    const inherited = activity.inheritedTotalDays;
    const before = totalPracticeDays();
    const idx = CARDS.findIndex((card) => card.target === "器");
    markPracticeStamp(idx);
    const stampedOnly = totalPracticeDays();
    calendarMonthKey = today().slice(0, 7); renderCalendar();
    const inheritedCopy = calendarMonthStat.textContent, inheritedAria = calendarMonthStat.getAttribute("aria-label");
    const complete = (id) => {
      baseTargets = [idx]; batch = baseTargets; baseCursor = 1; unresolved = new Set(); practicePhase = "between";
      roundStats = [{ idx, target: "器", outcome: "fast" }]; roundId = id;
      return markRoundComplete();
    };
    const firstComplete = complete("verify-inherited-1");
    const afterFirst = totalPracticeDays();
    const secondComplete = complete("verify-inherited-2");
    const afterSecond = totalPracticeDays();
    return { inherited, before, stampedOnly, inheritedCopy, inheritedAria, firstComplete, afterFirst, secondComplete, afterSecond };
  });
  assert(inheritedDays.inherited === 3 && inheritedDays.before === 3 && inheritedDays.stampedOnly === 3 && inheritedDays.inheritedCopy === "盖章 1天 · 累计 3天" && inheritedDays.inheritedAria === "盖章 1 天 · 累计练习 3 天" && inheritedDays.firstComplete && inheritedDays.secondComplete && inheritedDays.afterFirst === 4 && inheritedDays.afterSecond === 4, "Expected inherited practice days and same-day completion idempotence", inheritedDays);

  const rhythmAndMilestones = await page.evaluate(() => {
    const monthStart = `${today().slice(0, 7)}-01`, thisMonth = [...new Set([monthStart, today()])], previousMonth = shiftDay(monthStart, -1);
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = [...thisMonth, previousMonth].sort();
    activity.practiceDays.forEach((key, i) => { activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`rhythm:${i}`], completedRoundIds: [], lastStampAt: Date.now() }; }); saveActivity(); calendarMonthKey = today().slice(0, 7); renderCalendar();
    const monthly = { count: monthPracticeDays(), expected: thisMonth.length, copy: calendarMonthStat.textContent, aria: calendarMonthStat.getAttribute("aria-label") };
    activity = newActivity(); activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
    reminder.milestonesShown = []; activity.inheritedTotalDays = 14; const day14 = celebrateMilestoneIfAny(), repeat14 = celebrateMilestoneIfAny(), shown14 = reminder.milestonesShown.slice();
    reminder.milestonesShown = []; activity.inheritedTotalDays = 250; const skipped250 = celebrateMilestoneIfAny(), shown250 = reminder.milestonesShown.slice();
    reminder.milestonesShown = [1, 7, 14, 30, 100, 200]; activity.inheritedTotalDays = 300; const day300 = celebrateMilestoneIfAny(), repeat300 = celebrateMilestoneIfAny(), copy300 = milestoneCopy(300);
    return { monthly, schedule: milestoneDaysThrough(350), day14, repeat14, shown14, skipped250, shown250, day300, repeat300, copy300 };
  });
  assert(rhythmAndMilestones.monthly.count === rhythmAndMilestones.monthly.expected && rhythmAndMilestones.monthly.copy === `盖章 ${rhythmAndMilestones.monthly.expected}天 · 累计 0天` && rhythmAndMilestones.monthly.aria === `盖章 ${rhythmAndMilestones.monthly.expected} 天 · 累计练习 0 天`
    && rhythmAndMilestones.schedule.join() === "1,7,14,30,100,200,300" && rhythmAndMilestones.day14 === 14 && rhythmAndMilestones.repeat14 === null && rhythmAndMilestones.shown14.join() === "1,7,14"
    && rhythmAndMilestones.skipped250 === null && rhythmAndMilestones.shown250.join() === "1,7,14,30,100,200" && rhythmAndMilestones.day300 === 300 && rhythmAndMilestones.repeat300 === null && rhythmAndMilestones.copy300.includes("300"),
  "Expected penalty-free monthly rhythm, one-time day-14 celebration, silent inherited catch-up, and every-100 continuation", rhythmAndMilestones);

  const reminderBoundary = await page.evaluate(() => {
    const original = { memory: cloneObj(memory), status: cloneObj(status), reminder: cloneObj(reminder) };
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = [];
    const at = (hour, minute) => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date.getTime(); };
    for (let i = 0; i < 5; i += 1) {
      const key = shiftDay(today(), -i); activity.practiceDays.push(key);
      activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`verify:${i}`], completedRoundIds: [], lastStampAt: at(9, 24) };
    }
    activity.practiceDays.sort(); saveActivity();
    const median = medianPracticeTime();
    const allDays = activity.practiceDays.slice(); activity.practiceDays = allDays.slice(0, 2); const few = medianPracticeTime(); activity.practiceDays = allDays;
    activity.practiceDays.forEach((key) => { activity.daily[key].lastStampAt = at(23, 30); }); const late = medianPracticeTime();
    const missIdx = CARDS.findIndex((card) => card.target === "蘸"), otherIdx = CARDS.findIndex((card) => card.target === "器");
    memory = {}; status = {}; [missIdx, otherIdx].forEach((idx, order) => { memory[cardKey(idx)] = { seen: 1, dueDay: today(), pendingLearning: false, lastOutcome: order === 0 ? "miss" : "fast", misses: order === 0 ? 2 : 0, ease: order === 0 ? 25 : 70, last: Date.now() - order }; status[cardKey(idx)] = "rest"; });
    reminder = normalizeReminder({ enabled: true, permission: "granted" }); renderMe(); syncReminder(); const sync = cloneObj(reminderDebug.lastSync);
    const fallbackIdx = CARDS.findIndex((card) => card.target === "品"), fallbackKey = cardKey(fallbackIdx); memory = { [fallbackKey]: { seen: 1, dueDay: shiftDay(today(), 30), pendingLearning: false, lastOutcome: "slow", slow: 1, ease: 35, last: Date.now() } }; status = { [fallbackKey]: "rest" }; syncReminder(); const fallback = cloneObj(reminderDebug.lastSync);
    memory = {}; status = {}; syncReminder(); const noTarget = cloneObj(reminderDebug.lastSync);
    memory = original.memory; status = original.status; reminder = normalizeReminder(original.reminder); saveMemory(); save(DECK_KEY, status); saveReminder();
    return {
      median, few, late,
      hiddenInBrowser: getComputedStyle(reminderSection).display === "none" && getComputedStyle(reminderInvite).display === "none",
      sync, fallback, noTarget, missKey: cardKey(missIdx), missWord: CARDS[missIdx].word, missPy: CARDS[missIdx].py, fallbackKey: cardKey(fallbackIdx),
    };
  });
  assert(reminderBoundary.median.hour === 9 && reminderBoundary.median.minute === 24 && reminderBoundary.few.hour === 20 && reminderBoundary.few.minute === 0 && reminderBoundary.late.hour === 22 && reminderBoundary.late.minute === 0 && reminderBoundary.hiddenInBrowser && reminderBoundary.sync.type === "syncReminder", "Expected reminder median, fallback, clamp, and browser fallback boundaries", reminderBoundary);
  assert(reminderBoundary.sync.enabled && reminderBoundary.sync.questions.length === 8 && reminderBoundary.sync.targetCardKey === reminderBoundary.missKey && reminderBoundary.sync.questions[0].targetCardKey === reminderBoundary.missKey
    && reminderBoundary.sync.title === `${reminderBoundary.missWord}（${reminderBoundary.missPy}）` && reminderBoundary.sync.body === "还记得这个字怎么写吗？点开试试。"
    && reminderBoundary.sync.questions.every((question) => question.title && question.body && question.targetCardKey && /^\d{4}-\d{2}-\d{2}$/.test(question.day)) && reminderBoundary.fallback.enabled && reminderBoundary.fallback.targetCardKey === reminderBoundary.fallbackKey && !reminderBoundary.noTarget.enabled && reminderBoundary.noTarget.questions.length === 0,
  "Expected missed-due-first payloads, a later high-risk fallback, stable card keys, fixed copy, and no notification without a target", reminderBoundary);

  const backupReminderBoundary = await page.evaluate(() => {
    const completed = (count) => {
      activity = newActivity(); activity.inheritedTotalDays = 0; activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
      for (let i = 0; i < count; i += 1) { const key = shiftDay(today(), -i); activity.practiceDays.push(key); activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`backup:${i}`], completedRoundIds: [`round:${i}`], lastStampAt: Date.now() - i * 86400000 }; }
      activity.practiceDays.sort(); saveActivity();
    };
    memory = {}; saveMemory(); backupMeta = normalizeBackupMeta({ lastExportAt: Date.now() - 8 * 86400000 }); save(BACKUP_META_KEY, backupMeta);
    completed(5); renderBackupUI(); const fiveDays = getComputedStyle(backupReminder).display === "flex";
    completed(0); memory = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`verify:${i}`, { seen: 1, last: Date.now() }])); saveMemory(); renderBackupUI(); const thirtyChars = getComputedStyle(backupReminder).display === "flex";
    backupMeta.lastExportAt = Date.now() - 6 * 86400000; save(BACKUP_META_KEY, backupMeta); renderBackupUI(); const recentHidden = getComputedStyle(backupReminder).display === "none";
    memory = {}; saveMemory(); completed(0); activity.inheritedTotalDays = 20; saveActivity(); backupMeta = normalizeBackupMeta(null); save(BACKUP_META_KEY, backupMeta); renderBackupUI();
    const inheritedNeverUrgent = getComputedStyle(backupUrgency).display === "flex" && backupStatus.classList.contains("backupStatusUrgent") && mePanel.classList.contains("backupUrgent");
    activity.inheritedTotalDays = 13; saveActivity(); renderBackupUI(); const inheritedBelowHidden = getComputedStyle(backupUrgency).display === "none" && !backupStatus.classList.contains("backupStatusUrgent") && !mePanel.classList.contains("backupUrgent");
    activity.inheritedTotalDays = 0; saveActivity(); backupMeta = normalizeBackupMeta({ lastExportAt: Date.now() - 31 * 86400000 }); save(BACKUP_META_KEY, backupMeta); renderBackupUI();
    const staleBackupUrgent = getComputedStyle(backupUrgency).display === "flex" && backupStatus.classList.contains("backupStatusUrgent") && mePanel.classList.contains("backupUrgent");
    memory = {}; saveMemory(); completed(3); backupMeta = normalizeBackupMeta(null); summaryBackupHintVisible = false; save(BACKUP_META_KEY, backupMeta); renderSummaryBackupHint();
    const dayThree = getComputedStyle(summaryBackupHint).display === "flex" && backupMeta.summaryPromptShown; renderSummaryBackupHint(); const remainsVisible = getComputedStyle(summaryBackupHint).display === "flex";
    displayView("home"); displayView("summary"); renderSummaryBackupHint(); const nextSummaryHidden = getComputedStyle(summaryBackupHint).display === "none";
    return { fiveDays, thirtyChars, recentHidden, inheritedNeverUrgent, inheritedBelowHidden, staleBackupUrgent, dayThree, remainsVisible, nextSummaryHidden };
  });
  assert(backupReminderBoundary.fiveDays && backupReminderBoundary.thirtyChars && backupReminderBoundary.recentHidden && backupReminderBoundary.inheritedNeverUrgent && backupReminderBoundary.inheritedBelowHidden && backupReminderBoundary.staleBackupUrgent && backupReminderBoundary.dayThree && backupReminderBoundary.remainsVisible && backupReminderBoundary.nextSummaryHidden, "Expected inherited practice days, stale exports, weekly reminders, and the one-time third-day hint to use their intended backup thresholds", backupReminderBoundary);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const baseline = await page.evaluate(() => ({
    seed: SEED.length,
    groups: Object.keys(GROUPS).length,
    cards: CARDS.length,
    fsrsVersion: FSRS.FSRSVersion,
    weights: FSRS.default_w.length,
    scheduler: FSRS_CONFIG,
    engineFuzz: fsrsEngine.parameters.enable_fuzz,
    decisionLabels: Array.from(document.querySelectorAll("#decisionRow button span")).map((node) => node.textContent),
    oldStampChoices: document.querySelectorAll("#stampRow .stampWrap").length,
    showLabel: document.getElementById("show").textContent,
    showAria: document.getElementById("show").getAttribute("aria-label"),
    doneLabel: document.getElementById("done").textContent,
    doneAria: document.getElementById("done").getAttribute("aria-label"),
    viewport: document.querySelector('meta[name="viewport"]').content,
  }));
  assert(baseline.seed === 7294 && baseline.groups === 7294 && baseline.cards >= 7294, "Expected the complete 7294-card corpus", baseline);
  assert(baseline.fsrsVersion.includes("FSRS-6.0") && baseline.weights === 21, "Expected fixed FSRS-6 runtime", baseline);
  assert(baseline.scheduler.desiredRetention === 0.9 && baseline.scheduler.maximumInterval === 365 && baseline.scheduler.enableFuzz && baseline.engineFuzz && baseline.scheduler.parameterVersion === "fsrs6-fuzz-365-v2", "Expected fuzzed scheduler with a one-year interval ceiling", baseline.scheduler);
  assert(baseline.decisionLabels.join("/") === "写对了/写错了" && baseline.oldStampChoices === 0
    && baseline.showLabel === "不会写" && baseline.showAria.startsWith("不会写：") && baseline.doneLabel === "写好了" && baseline.doneAria === "写好了",
  "Expected concise two-decision semantics and user-tested direct recall actions", baseline);
  assert(baseline.viewport.includes("viewport-fit=cover") && !/user-scalable=no|maximum-scale=1/.test(baseline.viewport), "Expected scalable safe-area viewport", baseline.viewport);

  const contextOverrides = await page.evaluate(() => {
    const originalFor = (target) => SEED.find((row) => (row.target || Array.from(row.ans)[Number(row.ci) || 0]) === target);
    const rows = Object.entries(OVERRIDES).map(([target, override]) => {
      const index = BASE_BY_CHAR[target], card = CARDS[index], original = originalFor(target);
      return {
        target, index, originalWord: original && original.ans, word: card && card.word, py: card && card.py, originalPy: original && original.py,
        ctx: card && card.ctx, hint: card && card.hint, common: Number(card && card.common) || 0,
        key: Number.isInteger(index) ? cardKey(index) : "", targetAtIndex: override.w ? Array.from(override.w)[override.ci] : target,
        visible: card ? `${promptHTML(card).replace(/<[^>]+>/g, "")} ${card.hint || ""}` : "",
        kind: override.w ? "word" : override.gloss ? "gloss" : "boost",
        boosted: !!override.boost,
      };
    });
    const idiom = CARDS[BASE_BY_CHAR["毓"]], idiomPrompt = promptHTML(idiom);
    const gloss = CARDS[BASE_BY_CHAR["谔"]], glossPrompt = promptHTML(gloss);
    const legacyMemory = { seen: 3, last: Date.now() - 86400000, target: "毓" };
    memory["base:毓"] = legacyMemory;
    const compatibleMemory = cardMemory(BASE_BY_CHAR["毓"]) === legacyMemory;
    delete memory["base:毓"];
    return {
      raw: JSON.parse(JSON.stringify(OVERRIDES)), rows,
      idiom: { word: idiom.word, prompt: idiomPrompt, visible: idiomPrompt.replace(/<[^>]+>/g, ""), py: idiom.py },
      gloss: { word: gloss.word, prompt: glossPrompt, hint: gloss.hint, label: contextLabel(BASE_BY_CHAR["谔"]) },
      compatibleMemory,
    };
  });
  const approvedOverrides = {
    ...Object.fromEntries(approvedContextFixture.boostOnly.map((target) => [target, { boost: true }])),
    ...approvedContextFixture.approvedWords,
    ...Object.fromEntries(Object.entries(approvedContextFixture.approvedGlosses).map(([target, gloss]) => [target, {
      gloss, ...(approvedContextFixture.boostedGlosses.includes(target) ? { boost: true } : {}),
    }])),
  };
  const contextKinds = Object.fromEntries(["word", "gloss", "boost"].map((kind) => [kind, contextOverrides.rows.filter((row) => row.kind === kind).length]));
  const sortedJSON = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "zh-CN"))));
  const leaks = contextOverrides.rows.filter((row) => row.visible.includes(row.target));
  const rejectedPromptWords = contextOverrides.rows.filter((row) => approvedContextFixture.rejectedPromptWords.some((word) => row.word === word || row.hint?.includes(word)));
  assert(contextOverrides.rows.length === 56 && contextKinds.word === 1 && contextKinds.gloss === 45 && contextKinds.boost === 10 && contextOverrides.rows.filter((row) => row.boosted).length === 14,
    "Expected one manually approved common-word prompt, forty-five plain-language prompts, and ten boost-only corrections", { contextKinds });
  assert(sortedJSON(contextOverrides.raw) === sortedJSON(approvedOverrides),
    "Expected runtime context overrides to match the independent manually approved fixture", { actual: contextOverrides.raw, approved: approvedOverrides });
  assert(leaks.length === 0, "Expected no rendered context or gloss to contain its target character", leaks);
  assert(rejectedPromptWords.length === 0, "Expected rejected niche or answer-repeating expressions to remain absent from every practice prompt", rejectedPromptWords);
  assert(contextOverrides.rows.every((row) => Number.isInteger(row.index) && row.index >= 0 && row.py === row.originalPy && row.key === `base:${row.target}` && row.targetAtIndex === row.target && (row.kind !== "word" || row.ctx === "override") && (row.kind !== "gloss" || (row.ctx === "gloss" && row.word === row.target && row.hint)) && (!row.boosted || row.common >= 1.2)),
    "Expected every approved override to preserve target, pronunciation, memory key, and valid context metadata", contextOverrides.rows.filter((row) => !(Number.isInteger(row.index) && row.index >= 0 && row.py === row.originalPy && row.key === `base:${row.target}` && row.targetAtIndex === row.target)));
  assert(contextOverrides.idiom.word === "钟灵毓秀" && contextOverrides.idiom.visible.includes("钟灵") && contextOverrides.idiom.visible.includes("秀") && !contextOverrides.idiom.visible.includes("毓") && contextOverrides.idiom.visible.includes(contextOverrides.idiom.py),
    "Expected four-character idiom context to blank only the target while retaining its original pronunciation", contextOverrides.idiom);
  assert(contextOverrides.gloss.word === "谔" && contextOverrides.gloss.prompt.includes(contextOverrides.gloss.word) === false && contextOverrides.gloss.hint.includes("直言争辩") && contextOverrides.gloss.label === "释义模式" && contextOverrides.compatibleMemory,
    "Expected gloss mode to show pronunciation plus plain-language meaning without breaking legacy memory", contextOverrides.gloss);

  await page.emulateMedia({ colorScheme: "dark" });
  const darkTheme = await page.evaluate(() => {
    const bubble = getComputedStyle(teachBubble), after = getComputedStyle(teachBubble, "::after"), root = getComputedStyle(document.documentElement);
    return {
      bubble: bubble.backgroundColor, arrow: after.backgroundColor, card: root.getPropertyValue("--card").trim(), ink: root.getPropertyValue("--ink").trim(),
      strong: getComputedStyle(teachBubble.querySelector("b")).color, meTitle: getComputedStyle(document.querySelector(".meCardTop b")).color,
      boxShadow: getComputedStyle(document.querySelector(".box") || document.body).boxShadow,
    };
  });
  assert(darkTheme.bubble === darkTheme.arrow && darkTheme.bubble !== darkTheme.card && darkTheme.meTitle === "rgb(242, 234, 217)", "Expected a shaped inverse teaching bubble and readable analysis title in dark mode", darkTheme);
  await page.emulateMedia({ colorScheme: "light" });

  await page.addScriptTag({ path: path.join(root, "core-strokes.js") });
  const coreStrokes = await page.evaluate(() => ({ chars: self.SHIZI_CORE_STROKES.slice(), calibration: self.SHIZI_CORE_STROKES.slice(0, 15).join("") }));
  const missingCoreFiles = coreStrokes.chars.filter((char) => !fs.existsSync(path.join(root, "data", `${char}.json`)));
  const coreBytes = coreStrokes.chars.reduce((sum, char) => sum + fs.statSync(path.join(root, "data", `${char}.json`)).size, 0);
  assert(coreStrokes.chars.length === 600 && new Set(coreStrokes.chars).size === 600 && coreStrokes.calibration === "尴嚏狩晤飓痿俾跻徵瞰裘娩邃暧煲" && missingCoreFiles.length === 0 && coreBytes >= 1024 * 1024 && coreBytes <= 2 * 1024 * 1024,
  "Expected 600 unique core files including the exact first calibration group within the 1-2 MiB target", { count: coreStrokes.chars.length, calibration: coreStrokes.calibration, missingCoreFiles, coreBytes });
  await page.waitForFunction(async () => { const name=(await caches.keys()).find(key=>key.startsWith("shizi-v13-")); if(!name) return false; const cache = await caches.open(name), keys = await cache.keys(); return keys.filter((request) => new URL(request.url).pathname.includes("/data/")).length >= 602; }, null, { timeout: 30000 });
  const coreCache = await page.evaluate(async () => { const name=(await caches.keys()).find(key=>key.startsWith("shizi-v13-")), cache = await caches.open(name), keys = await cache.keys(); return { name, core: keys.filter((request) => new URL(request.url).pathname.includes("/data/") && !new URL(request.url).pathname.endsWith("context-overrides.js") && !new URL(request.url).pathname.endsWith("etymology.json")).length, shell: keys.some(request=>new URL(request.url).pathname.endsWith("/core-strokes.js")&&new URL(request.url).search), etymology: keys.some(request=>new URL(request.url).pathname.endsWith("/data/etymology.json")), contexts: keys.some(request=>new URL(request.url).pathname.endsWith("/data/context-overrides.js")&&new URL(request.url).search) }; });
  assert(coreCache.core >= 600 && coreCache.shell && coreCache.etymology && coreCache.contexts, "Expected the service worker to install all core strokes, etymology, context overrides, and retain runtime-fetched extras", coreCache);
  const boundedStrokeCache = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith("shizi-v13-")), cache = await caches.open(name), core = new Set(self.SHIZI_CORE_STROKES), runtime = CARDS.find(card => !core.has(card.target) && !card.custom && card.target);
    for (let index = 0; index < 230; index += 1) await cache.put(`data/__verify-cache-${index}.json`, new Response("{}", { headers: { "Content-Type": "application/json" } }));
    await fetch(`data/${encodeURIComponent(runtime.target)}.json?verify-cache-limit=1`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const keys = await cache.keys(), strokes = keys.filter(request => /\/data\/[^/]+\.json$/.test(new URL(request.url).pathname) && !new URL(request.url).pathname.endsWith("/data/etymology.json"));
    const corePresent = await Promise.all(self.SHIZI_CORE_STROKES.map(char => cache.match(`data/${encodeURIComponent(char)}.json`)));
    return { count: strokes.length, allCorePresent: corePresent.every(Boolean), runtime: runtime.target };
  });
  assert(boundedStrokeCache.count <= 800 && boundedStrokeCache.allCorePresent, "Expected stroke cache eviction to keep the core 600 while bounding runtime entries", boundedStrokeCache);

  const dailyRitual = await page.evaluate(() => {
    const original = { tuning: cloneObj(tuning), activity: cloneObj(activity), activeMode, focusQueue: focusQueue.slice(), sessionDone: [...sessionDone] };
    const key = today(), tomorrow = shiftDay(key, 1), idx = dailyCharacterIndex(key), nextIdx = dailyCharacterIndex(tomorrow), motto = dailyMotto(key), nextMotto = dailyMotto(tomorrow), candidate = CARDS[idx];
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    activity = { version: 1, migrationDate: key, inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [], daily: {} };
    clearSessionSnapshot(); saveTuning(); saveActivity(); renderHome();
    const button = yesterRow.querySelector("[data-daily-index]"), beforeClick = {
      label: yesterLbl.textContent, index: Number(button && button.dataset.dailyIndex), target: button && button.querySelector(".glyph").textContent,
      word: button && button.querySelector(".word").textContent, py: button && button.querySelector(".py").textContent,
      homeMotto: homeMotto.textContent, welcomeMotto: welcomeMotto.textContent, source: homeMotto.querySelector(".mSrc")?.textContent, expectedSource: mottoSource(motto),
    };
    const library = {
      count: DAILY_MOTTOS.length,
      structured: DAILY_MOTTOS.every((entry) => Object.keys(entry).sort().join() === "author,source,text" && typeof entry.text === "string" && typeof entry.author === "string" && typeof entry.source === "string" && entry.text && entry.source),
      unique: new Set(DAILY_MOTTOS.map((entry) => entry.text)).size,
      entries: DAILY_MOTTOS.map((entry) => ({ ...entry })),
    };
    const overflow = DAILY_MOTTOS.map((entry) => { setDailyMotto(homeMotto, entry); return { text: entry.text, source: homeMotto.querySelector(".mSrc")?.textContent, scroll: homeMotto.scrollHeight, client: homeMotto.clientHeight }; });
    applyDailyMotto(key); button.click();
    const clicked = { mode: activeMode, current: currentCardIndex(), cardVisible: getComputedStyle(card).display !== "none" };
    loadToken++; clearSessionSnapshot(); focusQueue = []; sessionDone = new Set();
    activity = { version: 1, migrationDate: key, inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [key], daily: { [key]: { stamps: 1, attempts: 1, targetKeys: [cardKey(idx)], completedRoundIds: [], lastStampAt: Date.now() } } };
    saveActivity(); renderHome(); const retired = !yesterRow.querySelector("[data-daily-index]");
    tuning = original.tuning; activity = normalizeActivity(original.activity); activeMode = original.activeMode; focusQueue = original.focusQueue; sessionDone = new Set(original.sessionDone); saveTuning(); saveActivity(); clearSessionSnapshot(); renderHome();
    return { key, tomorrow, idx, nextIdx, motto, nextMotto, repeatIdx: dailyCharacterIndex(key), repeatMotto: dailyMotto(key), candidate, beforeClick, overflow, clicked, retired, poolSize: dailyCharacterCandidates().length, library };
  });
  assert(dailyRitual.library.count >= 40 && dailyRitual.library.structured && dailyRitual.library.unique === dailyRitual.library.count,
    "Expected at least 40 unique, fully sourced motto records", dailyRitual.library);
  assert(JSON.stringify(dailyRitual.library.entries) === JSON.stringify(mottoFixture.entries)
    && [...new Set(mottoFixture.entries.map((entry) => entry.source))].every((sourceName) => mottoFixture.references[sourceName]),
  "Expected every runtime motto text, author, and source to match the reviewed primary-source fixture", dailyRitual.library.entries);
  assert(dailyRitual.poolSize > 0 && dailyRitual.idx === dailyRitual.repeatIdx && JSON.stringify(dailyRitual.motto) === JSON.stringify(dailyRitual.repeatMotto) && dailyRitual.idx !== dailyRitual.nextIdx && dailyRitual.motto.text !== dailyRitual.nextMotto.text,
    "Expected deterministic same-day and changing next-day character/motto selections", dailyRitual);
  assert(["一级", "二级"].includes(dailyRitual.candidate.norm) && dailyRitual.candidate.common >= 1.5 && dailyRitual.candidate.d >= 55 && dailyRitual.candidate.d <= 85
    && dailyRitual.beforeClick.label === "今日一字" && dailyRitual.beforeClick.index === dailyRitual.idx && dailyRitual.beforeClick.target === dailyRitual.candidate.target
    && dailyRitual.beforeClick.word === dailyRitual.candidate.word && dailyRitual.beforeClick.py === dailyRitual.candidate.py && dailyRitual.beforeClick.homeMotto.includes(dailyRitual.motto.text) && dailyRitual.beforeClick.welcomeMotto.includes(dailyRitual.motto.text)
    && dailyRitual.beforeClick.source === dailyRitual.beforeClick.expectedSource,
  "Expected the daily card to expose one eligible character, context word, pinyin, and synchronized sourced motto", dailyRitual);
  assert(dailyRitual.overflow.every((row) => row.scroll <= row.client + 1 && row.source) && dailyRitual.clicked.mode === "focus" && dailyRitual.clicked.current === dailyRitual.idx && dailyRitual.clicked.cardVisible && dailyRitual.retired,
    "Expected every sourced motto to fit, daily-character click to start focus practice, and the card to retire after today's first stamp", dailyRitual);
  const mottoContrast = {};
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    mottoContrast[colorScheme] = await page.evaluate(() => {
      applyDailyMotto();
      const node = homeMotto.querySelector(".mSrc"), style = getComputedStyle(node), background = getComputedStyle(document.body);
      return { color: style.color, opacity: style.opacity, background: background.backgroundColor };
    });
    mottoContrast[colorScheme].ratio = computedContrast(mottoContrast[colorScheme].color, mottoContrast[colorScheme].background, mottoContrast[colorScheme].opacity);
  }
  await page.emulateMedia({ colorScheme: "light" });
  assert(Object.values(mottoContrast).every((row) => Number(row.opacity) === 1 && row.ratio >= 4.5),
    "Expected computed 11px motto sources to meet 4.5:1 contrast in light and dark themes", mottoContrast);
  const notificationDeepLink = await page.evaluate(() => {
    const original = { memory: cloneObj(memory), status: cloneObj(status), tuning: cloneObj(tuning), activeMode, focusQueue: focusQueue.slice(), sessionDone: [...sessionDone] };
    const idx = CARDS.findIndex((card) => card.target === "蘸"), key = cardKey(idx);
    memory = { [key]: { seen: 1, dueDay: today(), pendingLearning: false, lastOutcome: "miss", misses: 1, ease: 30, last: Date.now() } }; status = { [key]: "rest" }; tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    clearSessionSnapshot(); saveMemory(); save(DECK_KEY, status); saveTuning(); const opened = shiziOpenReminderTarget(key);
    const result = { opened, mode: activeMode, current: currentCardIndex(), target: CARDS[currentCardIndex()].target, cardVisible: getComputedStyle(card).display !== "none", invalidRejected: shiziOpenReminderTarget("base:不存在") === false };
    loadToken++; clearSessionSnapshot(); memory = original.memory; status = original.status; tuning = original.tuning; activeMode = original.activeMode; focusQueue = original.focusQueue; sessionDone = new Set(original.sessionDone); saveMemory(); save(DECK_KEY, status); saveTuning();
    return result;
  });
  assert(notificationDeepLink.opened && notificationDeepLink.mode === "focus" && notificationDeepLink.target === "蘸" && notificationDeepLink.cardVisible && notificationDeepLink.invalidRejected,
    "Expected a valid notification card key to open that exact focus card and reject stale keys", notificationDeepLink);

  await page.reload({ waitUntil: "networkidle" });
  offlineProbe = true;
  await page.context().setOffline(true);
  await page.evaluate(() => { tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); removeStored(SESSION_KEY); focusPreservedSession=null; activeMode="new"; const idx = CARDS.findIndex((card) => card.target === "玃"); startFocus([idx]); });
  await page.waitForTimeout(3500);
  const honestOffline = await page.evaluate(() => { const blankDisabled=done.disabled; inkStrokes=[[{x:40,y:40,t:1,w:1,v:0},{x:120,y:120,t:2,w:1,v:0}]]; redrawInk(); updateInkControls(); return { copy: hint.textContent, blankDisabled, done: !done.disabled, show: !show.disabled, noWriter: !practiceCharData, offline: navigator.onLine === false }; });
  assert(honestOffline.copy.includes("这个字暂未收录笔顺") && honestOffline.blankDisabled && honestOffline.done && honestOffline.show && honestOffline.noWriter && honestOffline.offline,
  "Expected a character without bundled stroke data to explain its limitation, reject blank submission, and allow written self-assessment offline", honestOffline);
  await page.context().setOffline(false);
  offlineProbe = false;
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const migration = await page.evaluate(() => {
    const future = new Date(); future.setHours(18, 0, 0, 0); future.setDate(future.getDate() + 3);
    const sameDay = new Date(); sameDay.setHours(23, 0, 0, 0);
    const futureMemory = { seen: 1, due: future.getTime() };
    const sameDayMemory = { seen: 1, due: sameDay.getTime() };
    normalizeLegacySchedule(futureMemory); normalizeLegacySchedule(sameDayMemory);
    const saved = { customWords: customWords.slice(), memory: cloneObj(memory), quality: cloneObj(quality), status: cloneObj(status), fsrs: cloneObj(fsrsReviewLog), activity: cloneObj(activity), session: localStorage.getItem(SESSION_KEY), legacySessionDiscarded };
    const oldKey = "custom:6854:丂", oldInk = "data:image/png;base64,verify";
    customWords = ["丂"]; buildCustomCards();
    memory = { [oldKey]: { seen: 2, misses: 1, lastOutcome: "miss", last: 1234, recentInk: { at: 1234, dataURL: oldInk } } };
    quality = { [oldKey]: { rare: true } }; status = { "6854": "indeck" };
    fsrsReviewLog = [{ eventId: "legacy-custom", cardKey: oldKey, target: "丂" }];
    activity = normalizeActivity({ version: 1, migrationDate: today(), inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [today()], daily: { [today()]: { stamps: 1, attempts: 1, targetKeys: [oldKey], independentTargetKeys: [], reviewTargetKeys: [oldKey], completedRoundIds: [] } } });
    migrateStableCardIdentity();
    const customIdx = customIndexOf("丂"), stableKey = cardKey(customIdx);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 2, startedDate: shiftDay(today(), -1), activeMode: "new", baseTargets: [4103], currentIndex: 4103 }));
    const legacyResume = resumableSession(), quarantined = localStorage.getItem(`shizi.corrupt.${SESSION_KEY}`);
    const result = { futureDay: futureMemory.dueDay, expectedFuture: dayKey(future), sameDay: sameDayMemory.dueDay, today: today(),
      stableKey, customIdx, memory: cloneObj(memory[stableKey]), quality: cloneObj(quality[stableKey]), status: statusFor(customIdx), fsrsKey: fsrsReviewLog[0].cardKey,
      activityKey: dailyActivity().targetKeys[0], reminderIndex: indexForCardKey(oldKey), legacyResume, quarantined: !!quarantined, legacyNumericTargetNow: CARDS[4103].target };
    customWords = saved.customWords; buildCustomCards(); memory = saved.memory; quality = saved.quality; status = saved.status; fsrsReviewLog = saved.fsrs; activity = normalizeActivity(saved.activity); legacySessionDiscarded = saved.legacySessionDiscarded;
    save(CUSTOM_KEY, customWords); saveMemory(); saveQuality(); save(DECK_KEY, status); saveFSRSLog(); saveActivity(); localStorage.removeItem(`shizi.corrupt.${SESSION_KEY}`); if(saved.session===null) clearSessionSnapshot(); else localStorage.setItem(SESSION_KEY,saved.session);
    return result;
  });
  assert(migration.futureDay === migration.expectedFuture && migration.sameDay === migration.today, "Expected lossless legacy due migration", migration);
  assert(migration.stableKey === "custom:丂" && migration.customIdx === 7294 && migration.memory.seen === 2 && migration.memory.recentInk.dataURL
    && migration.quality.rare && migration.status === "indeck" && migration.fsrsKey === migration.stableKey && migration.activityKey === migration.stableKey
    && migration.reminderIndex === migration.customIdx, "Expected legacy custom identity and every dependent record to migrate to a stable key", migration);
  assert(migration.legacyResume === null && migration.quarantined && migration.legacyNumericTargetNow === "铿",
    "Expected an unsafe v2 numeric session to be quarantined instead of resuming as a different character", migration);

  const reviewBudget = await page.evaluate(() => {
    const saved = { memory: cloneObj(memory), status: cloneObj(status), quality: cloneObj(quality), activity: cloneObj(activity), tuning: cloneObj(tuning), sessionDone: [...sessionDone], activeMode, baseTargets: baseTargets.slice(), batch: batch.slice() };
    const originalRender = render, originalRenderHome = renderHome, originalToast = toast, originalWarm = warmStrokeCache, originalArm = armPracticeHistory;
    const dueIndexes = allIndexes().slice(0, 200); memory = {}; status = {}; quality = {}; activity = newActivity(); activity.inheritedTotalDays = 0; activity.daily = {}; sessionDone = new Set(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    dueIndexes.forEach((idx, order) => { memory[cardKey(idx)] = { seen: 1, dueDay: shiftDay(today(), -1), pendingLearning: false, lastOutcome: order % 4 === 0 ? "miss" : "fast", misses: order % 4 === 0 ? 1 : 0, ease: 50, streak: 1, last: Date.now() - order }; status[cardKey(idx)] = "rest"; });
    saveMemory(); save(DECK_KEY, status); saveActivity();
    const expectedTop = reviewPool(false).slice().sort(compareReviewPriority).slice(0, DAILY_REVIEW_BUDGET);
    render = () => {}; renderHome = () => {}; toast = () => {}; warmStrokeCache = () => {}; armPracticeHistory = () => {};
    activeMode = "review"; startRound(); const first = baseTargets.slice(), usedAfterFirst = reviewBudgetUsed(); first.forEach((idx) => { memory[cardKey(idx)].dueDay = shiftDay(today(), 1); }); sessionDone = new Set(); clearSessionSnapshot();
    startRound(); const second = baseTargets.slice(), usedAfterSecond = reviewBudgetUsed(); second.forEach((idx) => { memory[cardKey(idx)].dueDay = shiftDay(today(), 1); }); sessionDone = new Set(); clearSessionSnapshot();
    let exhaustedRedirect = false; renderHome = () => { exhaustedRedirect = true; }; startRound();
    render = originalRender; renderHome = originalRenderHome; toast = originalToast; warmStrokeCache = originalWarm; armPracticeHistory = originalArm;
    const selected = [...first, ...second], topPriority = selected.join() === expectedTop.join(), noDuplicates = new Set(selected).size === DAILY_REVIEW_BUDGET;
    renderHome(); const homeCopy = `${homeTitle.textContent} ${startCap.textContent} ${yesterLbl.textContent}`; const homeNoDebt = !startCap.textContent.includes("200 个到期") && !startCap.textContent.includes("还剩 170");
    const originalStartMode = startMode; let entry = ""; startMode = (mode) => { entry = mode; }; startBtn.onclick(); startMode = originalStartMode;
    const persisted = cloneObj(dailyActivity().reviewTargetKeys);
    memory = saved.memory; status = saved.status; quality = saved.quality; activity = normalizeActivity(saved.activity); tuning = saved.tuning; sessionDone = new Set(saved.sessionDone); activeMode = saved.activeMode; baseTargets = saved.baseTargets; batch = saved.batch;
    saveMemory(); save(DECK_KEY, status); saveQuality(); saveActivity(); saveTuning(); clearSessionSnapshot();
    return { first: first.length, second: second.length, usedAfterFirst, usedAfterSecond, selected: selected.length, topPriority, noDuplicates, exhaustedRedirect, remaining: reviewBudgetRemaining(), homeCopy, homeNoDebt, entry, persisted: persisted.length };
  });
  assert(reviewBudget.first === 15 && reviewBudget.second === 15 && reviewBudget.usedAfterFirst === 15 && reviewBudget.usedAfterSecond === 30 && reviewBudget.selected === 30
    && reviewBudget.topPriority && reviewBudget.noDuplicates && reviewBudget.exhaustedRedirect && reviewBudget.homeNoDebt && reviewBudget.entry === "new" && reviewBudget.persisted === 30,
  "Expected a persistent top-30 daily review budget and a new-card exit after exhaustion", reviewBudget);

  const queueEdges = await page.evaluate(() => {
    const saved = {
      activeMode, baseTargets: baseTargets.slice(), batch: batch.slice(), baseCursor, currentIndex,
      manualQueue: cloneObj(manualQueue), reinforcementQueue: cloneObj(reinforcementQueue), unresolved: [...unresolved], episodes: cloneObj(episodes),
      attemptSeq, practicePhase, memory: cloneObj(memory), quality: cloneObj(quality), activity: cloneObj(activity), sessionDone: [...sessionDone],
    };
    const indexes = ["器", "疑", "强", "赢", "衡", "辩", "警", "藏", "骤", "疆", "戴", "覆", "醒", "耀", "攀"].map((target) => CARDS.findIndex((card) => card.target === target));
    const resetQueue = (total, cursor) => {
      baseTargets = indexes.slice(0, total); batch = baseTargets; baseCursor = cursor; attemptSeq = cursor;
      currentIndex = baseTargets[Math.min(cursor, total - 1)]; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; practicePhase = "between";
    };

    resetQueue(15, 1); enqueueReinforcement(indexes[0]);
    const firstNext = nextQueuedTarget(); attemptSeq = 2; baseCursor = 2;
    const firstSecond = nextQueuedTarget(); attemptSeq = 3; baseCursor = 3;
    const firstReturn = nextQueuedTarget();

    resetQueue(15, 14); enqueueReinforcement(indexes[13]);
    const fourteenthNext = nextQueuedTarget(); attemptSeq = 15; baseCursor = 15;
    const fourteenthReturn = nextQueuedTarget();

    resetQueue(15, 15); enqueueReinforcement(indexes[14]);
    const fifteenthReturn = nextQueuedTarget();

    resetQueue(1, 1); enqueueReinforcement(indexes[0]);
    const onlyFirst = nextQueuedTarget(); attemptSeq = 2; enqueueReinforcement(indexes[0]);
    const onlySecond = nextQueuedTarget();

    resetQueue(1, 1); unresolved.add(indexes[0]); reinforcementQueue.push({ idx: indexes[0], eligibleAfter: 3, order: 1 });
    currentIndex = indexes[0]; quality = {}; recordQuality("hide", indexes[0]);
    const exclusion = { unresolved: unresolved.size, queued: reinforcementQueue.length, excluded: episodeFor(indexes[0]).excluded, pending: cardMemory(indexes[0]).pendingLearning };

    const modeCompletion = ["new", "review", "focus", "calibrate"].map((mode) => {
      activeMode = mode; baseTargets = indexes.slice(0, 1); batch = baseTargets; baseCursor = 1; unresolved = new Set(); practicePhase = "between";
      const complete = roundIsComplete(); unresolved.add(indexes[0]); const blocked = !roundIsComplete(); return { mode, complete, blocked };
    });

    activity = newActivity(); activity.inheritedTotalDays = 0; activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
    for (let i = 0; i < 10; i += 1) markPracticeStamp(indexes[0]);
    const repeatedCount = { stamps: dailyActivity().stamps, attempts: dailyActivity().attempts, targets: dailyActivity().targetKeys.length };

    activeMode = saved.activeMode; baseTargets = saved.baseTargets; batch = saved.batch; baseCursor = saved.baseCursor; currentIndex = saved.currentIndex;
    manualQueue = saved.manualQueue; reinforcementQueue = saved.reinforcementQueue; unresolved = new Set(saved.unresolved); episodes = saved.episodes; attemptSeq = saved.attemptSeq; practicePhase = saved.practicePhase;
    memory = saved.memory; quality = saved.quality; activity = normalizeActivity(saved.activity); sessionDone = new Set(saved.sessionDone); saveMemory(); saveQuality(); saveActivity();

    return { firstNext, firstSecond, firstReturn, fourteenthNext, fourteenthReturn, fifteenthReturn, onlyFirst, onlySecond, exclusion, modeCompletion, repeatedCount, indexes };
  });
  assert(queueEdges.firstNext.idx === queueEdges.indexes[1] && queueEdges.firstSecond.idx === queueEdges.indexes[2] && queueEdges.firstReturn.idx === queueEdges.indexes[0], "Expected first-position difficulty to wait behind two other attempts", queueEdges);
  assert(queueEdges.fourteenthNext.idx === queueEdges.indexes[14] && queueEdges.fourteenthReturn.idx === queueEdges.indexes[13] && queueEdges.fifteenthReturn.idx === queueEdges.indexes[14], "Expected positions 14 and 15 to fall back without deadlock", queueEdges);
  assert(queueEdges.onlyFirst.idx === queueEdges.indexes[0] && queueEdges.onlySecond.idx === queueEdges.indexes[0], "Expected one repeatedly difficult target to keep rotating", queueEdges);
  assert(queueEdges.exclusion.unresolved === 0 && queueEdges.exclusion.queued === 0 && queueEdges.exclusion.excluded && !queueEdges.exclusion.pending, "Expected explicit content exclusion to release the group without claiming mastery", queueEdges.exclusion);
  assert(queueEdges.modeCompletion.every((row) => row.complete && row.blocked) && queueEdges.repeatedCount.stamps === 1 && queueEdges.repeatedCount.attempts === 10 && queueEdges.repeatedCount.targets === 1, "Expected all modes to share completion rules and repeated attempts to count one target", queueEdges);

  const rhythmGuard = await page.evaluate(() => {
    const indexes = ["器", "疑", "强"].map((target) => CARDS.findIndex((card) => card.target === target));
    const originalRender = render, originalRenderHome = renderHome, originalToast = toast;
    render = () => {}; renderHome = () => {}; toast = () => {};
    const setup = ({ attempts = 20, elapsed = 0, includeManual = false } = {}) => {
      activeMode = "focus"; focusQueue = indexes.slice(); baseTargets = indexes.slice(); batch = baseTargets; baseCursor = indexes.length;
      currentIndex = indexes[2]; currentAttemptKind = "base"; currentAttemptId = "verify-rhythm"; practicePhase = "between";
      manualQueue = includeManual ? [{ idx: indexes[2], kind: "repeat" }] : [];
      reinforcementQueue = [{ idx: indexes[1], eligibleAfter: 0, order: 1 }, { idx: indexes[0], eligibleAfter: 0, order: 2 }];
      unresolved = new Set(indexes.slice(0, 2)); episodes = {}; attemptSeq = attempts; roundId = `verify-rhythm-${attempts}-${elapsed}`;
      roundStats = indexes.map((idx) => ({ idx, target: CARDS[idx].target, outcome: idx === indexes[2] ? "fast" : "slow" }));
      sessionDone = new Set(indexes); roundElapsedMs = elapsed; roundActiveStartedAt = Date.now(); roundBudgetPrompted = false;
      activity = newActivity(); activity.inheritedTotalDays = 0; activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
      indexes.slice(0, 2).forEach((idx) => { const m = cardMemory(idx); m.pendingLearning = true; m.dueDay = null; m.due = 0; setStatus(idx, "indeck"); });
      closeRoundBudgetSheet(); clearSessionSnapshot();
    };

    setup(); next();
    const attemptPrompt = roundBudgetSheet.classList.contains("open");
    continueAfterBudget();
    const continued = { prompted: roundBudgetPrompted, closed: !roundBudgetSheet.classList.contains("open"), current: currentIndex };
    practicePhase = "between"; attemptSeq = 21; next();
    const noSecondPrompt = !roundBudgetSheet.classList.contains("open");

    setup({ attempts: 3, elapsed: ROUND_TIME_BUDGET_MS }); next();
    const timePrompt = roundBudgetSheet.classList.contains("open"); closeRoundBudgetSheet();

    setup({ attempts: 21, includeManual: true }); next(); deferRoundToTomorrow();
    const queued = indexes.slice().sort((a, b) => cardMemory(a).queuedFrontAt - cardMemory(b).queuedFrontAt);
    const deferred = { queued, expected: [indexes[2], indexes[1], indexes[0]], completed: todayCompleted(), session: localStorage.getItem(SESSION_KEY) };
    activeMode = "review"; focusQueue = []; sessionDone = new Set(); startRound();
    const nextRound = baseTargets.slice(0, 3);

    setup({ attempts: 21 }); baseCursor = 1; roundStats = roundStats.slice(0, 1); manualQueue = [];
    unresolved = new Set([indexes[0]]); reinforcementQueue = [{ idx: indexes[0], eligibleAfter: 0, order: 1 }];
    next(); deferRoundToTomorrow();
    const incomplete = { queued: indexes.slice().sort((a, b) => cardMemory(a).queuedFrontAt - cardMemory(b).queuedFrontAt), completed: todayCompleted() };

    setup({ attempts: 21 }); activeMode = "calibrate"; next();
    const calibrationUninterrupted = !roundBudgetSheet.classList.contains("open");

    render = originalRender; renderHome = originalRenderHome; toast = originalToast; closeRoundBudgetSheet();
    return { indexes, attemptPrompt, continued, noSecondPrompt, timePrompt, deferred, nextRound, incomplete, calibrationUninterrupted };
  });
  assert(rhythmGuard.attemptPrompt && rhythmGuard.timePrompt, "Expected attempt and active-time budgets to prompt only between cards", rhythmGuard);
  assert(rhythmGuard.continued.prompted && rhythmGuard.continued.closed && rhythmGuard.continued.current === rhythmGuard.indexes[1] && rhythmGuard.noSecondPrompt, "Expected continue to consume the next queued card without prompting again", rhythmGuard);
  assert(rhythmGuard.deferred.queued.join() === rhythmGuard.deferred.expected.join() && !rhythmGuard.deferred.completed && rhythmGuard.deferred.session === null && rhythmGuard.nextRound.join() === rhythmGuard.deferred.expected.join(), "Expected focus-mode early stop to preserve pending order for the next ordinary round without claiming a completed day", rhythmGuard);
  assert(rhythmGuard.incomplete.queued.join() === rhythmGuard.indexes.join() && !rhythmGuard.incomplete.completed && rhythmGuard.calibrationUninterrupted, "Expected incomplete base cards to carry forward without false completion while calibration stays uninterrupted", rhythmGuard);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.evaluate(() => {
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    renderHome();
  });

  await page.click("#homeAdd");
  const homeCapture = await page.evaluate(() => ({ open: addSheet.classList.contains("open"), label: homeAdd.textContent.replace(/\s+/g, ""), mainVisible: getComputedStyle(startBtn).display !== "none" }));
  assert(homeCapture.open && homeCapture.label === "收字" && homeCapture.mainVisible, "Expected the compact home collection entry to open the existing add sheet", homeCapture);
  await page.click("#addCancel");

  await page.click("#tabMe");
  const me = await page.evaluate(() => ({ visible: getComputedStyle(mePanel).display !== "none", calendar: !!calendarGrid.querySelector(".calendarDay"), groups: [meCalendar, openProfile, document.querySelector(".meMonthCard"), document.querySelector(".mePrimaryRows"), annualReportLink].filter(Boolean).length, noStats: !document.querySelector(".meStats"), settingsHidden: getComputedStyle(settingsPanel).display === "none" }));
  assert(me.visible && me.calendar && me.groups === 5 && me.noStats && me.settingsHidden, "Expected My to contain calendar, weak words, monthly work, two rows, and annual footer without naked statistic cards", me);
  await page.click("#openSettings");
  const soundBefore = await page.evaluate(() => { const payload = JSON.parse(backupPayload()); return { pressed: soundRow.getAttribute("aria-pressed"), state: soundState.textContent, enabled: sound.enabled, scene: sound.scene, scenePressed: document.querySelector('#soundscapeBox [data-scene="off"]').getAttribute("aria-pressed"), backedUp: Object.prototype.hasOwnProperty.call(payload.data, SOUND_KEY) }; });
  await page.click("#soundRow");
  const soundOff = await page.evaluate(() => { const contexts = soundDebug.contextCreated, events = soundDebug.events.length, played = soundFeedback("stamp"), payload = JSON.parse(backupPayload()); return { pressed: soundRow.getAttribute("aria-pressed"), state: soundState.textContent, enabled: sound.enabled, played, contextsBefore: contexts, contextsAfter: soundDebug.contextCreated, eventsBefore: events, eventsAfter: soundDebug.events.length, stored: JSON.parse(payload.data[SOUND_KEY]) }; });
  assert(soundBefore.pressed === "true" && soundBefore.state === "开" && soundBefore.enabled && soundBefore.scene === "off" && soundBefore.scenePressed === "true" && soundBefore.backedUp && soundOff.pressed === "false" && soundOff.state === "关" && !soundOff.enabled && !soundOff.played
    && soundOff.contextsAfter === soundOff.contextsBefore && soundOff.eventsAfter === soundOff.eventsBefore && soundOff.stored.enabled === false && soundOff.stored.scene === "off",
  "Expected an on-by-default backed-up sound setting and zero AudioContext/event work while disabled", { soundBefore, soundOff });
  await page.click("#soundRow");
  const ambientStartsBeforeSetting = await page.evaluate(() => ambientDebug.starts);
  await page.click('#soundscapeBox [data-scene="rain"]');
  const soundscapeSetting = await page.evaluate(() => { const stored=JSON.parse(JSON.parse(backupPayload()).data[SOUND_KEY]); return { scene:sound.scene, paper:sound.enabled, rainPressed:document.querySelector('#soundscapeBox [data-scene="rain"]').getAttribute("aria-pressed"), starts:ambientDebug.starts, stored }; });
  assert(soundscapeSetting.scene === "rain" && soundscapeSetting.paper && soundscapeSetting.rainPressed === "true" && soundscapeSetting.starts === ambientStartsBeforeSetting && soundscapeSetting.stored.scene === "rain",
    "Expected the explicit rain setting to persist independently without starting outside practice", soundscapeSetting);
  await page.click('#soundscapeBox [data-scene="off"]');
  const typeBefore = await page.evaluate(() => ({ title: parseFloat(getComputedStyle(document.querySelector(".settingsPanel h2")).fontSize), advice: parseFloat(getComputedStyle(reminderStatus).fontSize), pressed: fontScaleRow.getAttribute("aria-pressed") }));
  await page.click("#fontScaleRow");
  const typeAfter = await page.evaluate(() => { const payload = JSON.parse(backupPayload()); return { title: parseFloat(getComputedStyle(document.querySelector(".settingsPanel h2")).fontSize), advice: parseFloat(getComputedStyle(reminderStatus).fontSize), pressed: fontScaleRow.getAttribute("aria-pressed"), state: fontScaleState.textContent, stored: load(FONT_SCALE_KEY, false), backedUp: Object.prototype.hasOwnProperty.call(payload.data, FONT_SCALE_KEY) }; });
  assert(typeAfter.title >= typeBefore.title * 1.1 && typeAfter.advice >= typeBefore.advice * 1.1 && typeAfter.pressed === "true" && typeAfter.state === "开" && typeAfter.stored && typeAfter.backedUp, "Expected the persisted large-type preference to scale fixed-pixel text and join backups", { typeBefore, typeAfter });
  await page.click("#fontScaleRow");
  await page.click("#closeSettings");
  const nonMissWeakPreview = await page.evaluate(() => {
    const saved = cloneObj(memory), hintIdx = CARDS.findIndex((card) => card.target === "器"), slowIdx = CARDS.findIndex((card) => card.target === "品");
    memory = {
      [cardKey(hintIdx)]: { seen: 1, last: Date.now(), target: CARDS[hintIdx].target, misses: 0, hints: 1, slow: 0 },
      [cardKey(slowIdx)]: { seen: 1, last: Date.now() - 1, target: CARDS[slowIdx].target, misses: 0, hints: 0, slow: 1 },
    };
    renderMe();
    const preview = Array.from(meWeakChars.querySelectorAll("[data-char-idx]")).map((node) => Number(node.dataset.charIdx)), advice = meAdvice.textContent;
    renderProfile();
    const profile = { indexes: profilePracticeIndexes.slice(), empty: document.getElementById("profileAdvice").textContent.includes("目前没有记录到没写出的字"), disabled: profilePractice.disabled };
    memory = saved; renderMe();
    return { hintIdx, slowIdx, preview, advice, profile };
  });
  assert(nonMissWeakPreview.preview.length === 0 && nonMissWeakPreview.advice === "目前没有记录到没写出的字。" && nonMissWeakPreview.profile.indexes.length === 0 && nonMissWeakPreview.profile.empty && nonMissWeakPreview.profile.disabled,
    "Expected hint-only and slow-only records to stay out of the miss-based preview and detail", nonMissWeakPreview);
  await page.click("#tabBook");
  await page.fill("#bookSearchInput", "蘸料");
  await page.click("#bookSearchResult [data-book-add]");
  await page.fill("#addInput", "蘸料");
  await page.click("#addConfirm");
  const add = await page.evaluate(() => ({ added: addedChars.includes("蘸") && addedChars.includes("料"), indexed: indexesForChars(["蘸", "料"]).length === 2, queued: indexesForChars(["蘸", "料"]).every((idx) => (memory[cardKey(idx)] || {}).queuedFront) }));
  assert(add.added && add.indexed && add.queued, "Expected add-character workflow to persist and queue new cards", add);

  await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "器");
    memory[cardKey(idx)] = { seen: 1, last: Date.now(), target: "器", misses: 2, hints: 1, slow: 1, ease: 28, streak: 0, lastOutcome: "miss", pendingLearning: true };
    saveMemory(); renderMe();
  });
  const meStory = await page.evaluate(() => ({ weak: Array.from(meWeakChars.querySelectorAll("[data-char-idx]")).map(node => node.textContent), advice: meAdvice.textContent, calendarStat: calendarMonthStat.textContent, month: meMonthMeta.textContent, settings: !!openSettings, backup: backupStatus.textContent }));
  assert(meStory.weak.includes("器") && meStory.advice === "这些字在练习中没写出来过" && meStory.calendarStat.includes("累计") && meStory.month.includes("个独立写出") && meStory.settings && meStory.backup.length > 0, "Expected My to place real weak words, calendar days, monthly work, settings, and backup in context", meStory);
  await page.click("#meWeakChars [data-char-idx]");
  const detail = await page.evaluate(() => ({ open: charSheet.classList.contains("open"), word: charDetailWord.textContent, story: charDetailStory.textContent, actions: [charDetailStrokeBtn.textContent, charDetailPractice.textContent] }));
  assert(detail.open && detail.word.length > 0 && detail.story.includes("练过") && detail.actions.join() === "看笔顺,再写一遍", "Expected a weak word to open its factual detail sheet", detail);
  await page.evaluate(() => closeCharSheet());
  await page.click("#openProfile");
  const profileInsight = await page.evaluate(() => ({ visible: getComputedStyle(profilePanel).display !== "none", title: profilePanel.querySelector("h2").textContent, forbidden: /掌握感|易忘度|卡点分析/.test(profilePanel.textContent), rows: profilePanel.querySelectorAll("[data-profile-kind],[data-char-idx]").length }));
  assert(profileInsight.visible && profileInsight.title === "写得不稳的字" && !profileInsight.forbidden && profileInsight.rows > 0, "Expected human profile language with no opaque algorithm score", profileInsight);
  await page.click("#closeProfile");
  assert(await page.evaluate(() => getComputedStyle(mePanel).display !== "none"), "Expected a Profile opened from My to return to My");
  await page.click("#tabBook");
  const wall = await page.evaluate(() => ({ count: memoryWall.querySelectorAll(".memoryChar").length, expected: collectionIndexes().length, practiced: profileIndexes().length, columns: getComputedStyle(memoryWall).gridTemplateColumns.split(" ").length, labels: memoryWall.querySelectorAll(".dot,.outcomeMark").length, colors: new Set(Array.from(memoryWall.querySelectorAll(".memoryChar")).map(node => getComputedStyle(node).color)).size, curator: bookCurator.textContent, search: bookSearchInput.placeholder }));
  assert(wall.count === wall.expected && wall.columns === 6 && wall.labels === 0 && wall.colors >= 1 && wall.curator.length > 0 && wall.search.includes("找一个字"), "Expected the complete six-column memory wall with ink-only state and unified search", wall);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { fontScaleLarge = true; save(FONT_SCALE_KEY, true); applyFontScale(); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  const compactRecall = await page.evaluate(() => ({
    box: S, mascot: getComputedStyle(document.querySelector("#practiceArea > .mascotRow")).display, mascotCopy: mascotLine.textContent,
    actionBottom: actions.getBoundingClientRect().bottom, viewportBottom: innerHeight, tools: Array.from(inkTools.querySelectorAll("button")).filter((node) => getComputedStyle(node).display !== "none").map((node) => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth })),
    tip: tip.textContent, promptSize: parseFloat(getComputedStyle(document.getElementById("prompt")).fontSize),
  }));
  assert(compactRecall.box >= 276 && compactRecall.mascot === "flex" && compactRecall.mascotCopy.length > 0 && compactRecall.actionBottom <= compactRecall.viewportBottom + 1
    && compactRecall.tools.every((item) => item.height >= 43.9 && item.scrollWidth <= item.width + 1) && compactRecall.tip === "点拨" && compactRecall.promptSize >= 35,
  "Expected large type and 44pt compact tools to preserve the writing area and guidance on a 320x568 screen", compactRecall);
  await page.evaluate(() => { inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer(); });
  const compactReveal = await page.evaluate(() => ({ ask: getComputedStyle(askRow).display, askCopy: askLine.textContent, askBottom: askRow.getBoundingClientRect().bottom, client: reveal.clientHeight, scroll: reveal.scrollHeight, qualityTargets: Array.from(qualityBox.querySelectorAll("button")).map((node) => node.getBoundingClientRect().height) }));
  assert(compactReveal.ask === "flex" && compactReveal.askCopy.length > 0 && compactReveal.askBottom <= 568 && compactReveal.scroll > compactReveal.client && compactReveal.qualityTargets.every((height) => height >= 44),
  "Expected short-screen reveal advice to remain visible and lower 44pt actions to stay reachable by internal scrolling", compactReveal);
  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); fontScaleLarge = false; save(FONT_SCALE_KEY, false); applyFontScale(); });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.evaluate(() => {
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning(); clearSessionSnapshot();
    sound.enabled = false; sound.scene = "rain"; saveSound(); ambientDebug.starts = 0; ambientDebug.stops = 0; ambientDebug.events = [];
    addWord("强"); addWord("器"); activeMode = "new"; roundOpeningPending = true; startRound(); window.__openingAtStart = practiceArea.classList.contains("opening");
  });
  await waitForWriter(page);
  const queuedStart = await page.evaluate(() => ({
    targets: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    current: cur.target,
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    opening: window.__openingAtStart, openingConsumed: !roundOpeningPending && playRoundOpening() === false,
    ambient: { scene: ambientScene, starts: ambientDebug.starts, paperEnabled: sound.enabled },
  }));
  assert(queuedStart.targets === "强器" && queuedStart.current === "强" && queuedStart.flags.every(Boolean) && queuedStart.opening && queuedStart.openingConsumed
    && queuedStart.ambient.scene === "rain" && queuedStart.ambient.starts === 1 && !queuedStart.ambient.paperEnabled,
  "Expected queued cards, a once-only opening reveal, and rain independent from paper sounds", queuedStart);

  const ambientLifecycle = await page.evaluate(async () => {
    stopAmbient(true); const originalContext=ambientAudioContext, sources=[];
    const mockContext={sampleRate:80,currentTime:0,state:"running",destination:{},resume(){},
      createBuffer(_channels,length){ const data=new Float32Array(length); return {getChannelData:()=>data}; },
      createBufferSource(){ const source={loop:false,started:0,stopCalls:0,connect(){},start(){ this.started++; },stop(){ this.stopCalls++; }}; sources.push(source); return source; },
      createGain(){ const gain={value:.04,cancelScheduledValues(){},setValueAtTime(value){ this.value=value; },linearRampToValueAtTime(value){ this.value=value; }}; return {gain,connect(){}}; },
      createBiquadFilter(){ return {type:"",frequency:{value:0},Q:{value:0},connect(){}}; }};
    ambientAudioContext=mockContext; startAmbient("rain"); stopAmbient(false); startAmbient("rain"); startAmbient("fire"); stopAmbient(false);
    await new Promise(resolve=>setTimeout(resolve,560)); startAmbient("rain");
    const result={sources:sources.map(source=>({started:source.started,stops:source.stopCalls})), pending:ambientStopTasks.size,
      active:sources.filter(source=>source.stopCalls===0).length, activeIsLatest:ambientSource===sources[sources.length-1], scene:ambientScene};
    stopAmbient(true); ambientAudioContext=originalContext; startAmbient(sound.scene); return result;
  });
  assert(ambientLifecycle.sources.length === 4 && ambientLifecycle.sources.slice(0,-1).every(source => source.started === 1 && source.stops === 1)
    && ambientLifecycle.sources.at(-1).started === 1 && ambientLifecycle.sources.at(-1).stops === 0 && ambientLifecycle.pending === 0 && ambientLifecycle.active === 1 && ambientLifecycle.activeIsLatest && ambientLifecycle.scene === "rain",
  "Expected rapid leave/return and scene changes to stop every old loop exactly once and retain only the latest source", ambientLifecycle);

  const stoveFirstDown = await page.evaluate(() => {
    tuning.chromeFadeSeen = false; saveTuning(); resetWritingChrome(); clearInk(); done.disabled=false; done.focus(); const focusedBefore=document.activeElement===done, rect=inkCanvas.getBoundingClientRect();
    const pointer=(type,x,y,buttons)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:72001,pointerType:"touch",isPrimary:true,button:0,buttons,clientX:rect.left+x,clientY:rect.top+y});
    inkCanvas.dispatchEvent(pointer("pointerdown",30,34,1)); const down={writing:card.classList.contains("writing"),header:getComputedStyle(document.querySelector(".chdr")).opacity};
    inkCanvas.dispatchEvent(pointer("pointermove",92,96,1)); inkCanvas.dispatchEvent(pointer("pointerup",92,96,0));
    done.focus(); const hiddenNodes=writingChromeNodes(), completed={writing:card.classList.contains("writing"),seen:tuning.chromeFadeSeen,stored:load(TUNING_KEY,{}).chromeFadeSeen,actionsPointer:getComputedStyle(actions).pointerEvents,toolOpacity:Number(getComputedStyle(tip).opacity),
      focusedBefore,focusBlocked:document.activeElement!==done,focusOutside:hiddenNodes.every(node=>node!==document.activeElement&&!node.contains(document.activeElement)),inert:hiddenNodes.every(node=>node.inert&&node.getAttribute("aria-hidden")==="true"),toolsAvailable:[tip,undoStroke,clear].every(node=>!node.inert&&node.getAttribute("aria-hidden")!=="true")};
    return {down,done:completed};
  });
  await page.waitForFunction(() => card.classList.contains("writing") && Number(getComputedStyle(document.querySelector(".chdr")).opacity) <= .01 && Number(getComputedStyle(actions).opacity) <= .01);
  await page.keyboard.press("Enter");
  const stoveFaded = await page.evaluate(() => ({ header:Number(getComputedStyle(document.querySelector(".chdr")).opacity), actions:Number(getComputedStyle(actions).opacity) }));
  assert(!stoveFirstDown.down.writing && Number(stoveFirstDown.down.header) === 1 && stoveFirstDown.done.writing && stoveFirstDown.done.seen && stoveFirstDown.done.stored
    && stoveFaded.header <= .01 && stoveFaded.actions <= .01 && stoveFirstDown.done.actionsPointer === "none" && stoveFirstDown.done.toolOpacity > 0.25 && stoveFirstDown.done.toolOpacity < 0.35
    && stoveFirstDown.done.focusedBefore && stoveFirstDown.done.focusBlocked && stoveFirstDown.done.focusOutside && stoveFirstDown.done.inert && stoveFirstDown.done.toolsAvailable && !await page.evaluate(() => revealed),
  "Expected the first-ever stroke to hide and inert chrome without exposing its actions or corner tools to the wrong accessibility state", { stoveFirstDown, stoveFaded });
  await page.waitForFunction(() => !card.classList.contains("writing") && Number(getComputedStyle(document.querySelector(".chdr")).opacity) >= .99 && Number(getComputedStyle(actions).opacity) >= .99, null, { timeout: 3000 });
  const stoveReturnAndSecond = await page.evaluate(() => {
    const returned=!card.classList.contains("writing") && Number(getComputedStyle(document.querySelector(".chdr")).opacity) >= .99 && writingChromeNodes().every(node=>!node.inert&&node.getAttribute("aria-hidden")!=="true"), rect=inkCanvas.getBoundingClientRect();
    const pointer=(type,x,y,buttons)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:72002,pointerType:"touch",isPrimary:true,button:0,buttons,clientX:rect.left+x,clientY:rect.top+y});
    inkCanvas.dispatchEvent(pointer("pointerdown",44,50,1)); const immediate=card.classList.contains("writing");
    inkCanvas.dispatchEvent(pointer("pointermove",98,103,1)); inkCanvas.dispatchEvent(pointer("pointerup",98,103,0)); clearInk();
    return {returned,immediate};
  });
  await page.waitForFunction(() => card.classList.contains("writing") && Number(getComputedStyle(document.querySelector(".chdr")).opacity) <= .01);
  const stoveSecondFaded = await page.evaluate(() => {
    const faded=Number(getComputedStyle(document.querySelector(".chdr")).opacity) <= .01; resetWritingChrome(); unlockGradeActions();
    const original=window.matchMedia; window.matchMedia=()=>({matches:true}); roundOpeningPending=true; const reducedOpening=playRoundOpening(); const direct=!practiceArea.classList.contains("opening"); window.matchMedia=original;
    return {faded,reducedOpening,direct};
  });
  assert(stoveReturnAndSecond.returned && stoveReturnAndSecond.immediate && stoveSecondFaded.faded && !stoveSecondFaded.reducedOpening && stoveSecondFaded.direct,
    "Expected two-second chrome return, immediate later-stroke fade, and direct reduced-motion opening", { stoveReturnAndSecond, stoveSecondFaded });

  await submitStandard(page);
  await page.evaluate(() => { sound.enabled = true; soundDebug.events = []; soundDebug.last = null; sound.tipShown = false; saveSound(); });
  await chooseCorrect(page);
  const stampSound = await page.evaluate(() => ({ last: soundDebug.last, events: soundDebug.events.slice(), tipShown: sound.tipShown, tip: document.getElementById("toast").textContent, contextCreated: soundDebug.contextCreated }));
  assert(stampSound.last === "stamp" && stampSound.events.join() === "stamp" && stampSound.tipShown && stampSound.tip.includes("盖章音效已开启") && stampSound.contextCreated >= 1,
    "Expected one restrained stamp sound in the same grading turn and a one-time settings hint", stampSound);
  await page.waitForTimeout(1900);
  const queuedSecond = await page.evaluate(() => ({ current: cur.target, firstConsumed: !(memory[cardKey(indexesForChars(["强"])[0])] || {}).queuedFront, secondQueued: !!(memory[cardKey(indexesForChars(["器"])[0])] || {}).queuedFront, undo: getComputedStyle(undoBar).display !== "none" }));
  assert(queuedSecond.current === "器" && queuedSecond.firstConsumed && queuedSecond.secondQueued && queuedSecond.undo, "Expected first queued card to be consumed only after its stamp and leave the second next", queuedSecond);

  await page.click("#undoLast");
  await page.waitForFunction(() => practicePhase === "revealDecision" && cur.target === "强");
  const queuedRollback = await page.evaluate(() => ({
    current: cur.target,
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    stats: roundStats.length,
    reviews: fsrsReviewLog.length,
    baseCursor,
  }));
  assert(queuedRollback.current === "强" && queuedRollback.flags.every(Boolean) && queuedRollback.stats === 0 && queuedRollback.reviews === 0 && queuedRollback.baseCursor === 0, "Expected cross-card undo to restore queue-front flags and the ungraded position", queuedRollback);

  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  assert(await page.evaluate(() => cur.target === "器"), "Expected the second queued card after regrading the first");
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  const queuedConsumed = await page.evaluate(() => ({
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    targets: roundStats.slice(0, 2).map((row) => row.target).join(""),
  }));
  assert(queuedConsumed.flags.every((flag) => !flag) && queuedConsumed.targets === "强器", "Expected queued cards to be consumed exactly once through the real grading path", queuedConsumed);

  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); sessionDone = new Set(); activeMode = "new"; startRound(); });
  await waitForWriter(page);
  const noSecondForce = await page.evaluate(() => !["强", "器"].includes(cur.target) && queuedFrontPool().every((idx) => !["强", "器"].includes(CARDS[idx].target)));
  assert(noSecondForce, "Expected consumed additions not to be forced at the front of a later round");

  await page.setViewportSize({ width: 375, height: 667 });
  const calibrationImmediate = await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning();
    addWord("强"); addWord("器"); activeMode = "calibrate"; startRound();
    const label = posLabel.getBoundingClientRect();
    return { helpReady: !show.disabled && !show.classList.contains("tlock"), progressCenter: label.left + label.width / 2, viewportCenter: innerWidth / 2 };
  });
  assert(calibrationImmediate.helpReady && Math.abs(calibrationImmediate.progressCenter - calibrationImmediate.viewportCenter) <= 0.5, "Expected immediate first-card help and a truly centered compact progress label", calibrationImmediate);
  await waitForWriter(page);
  const calibrationQueue = await page.evaluate(() => ({
    front: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    tail: baseTargets.slice(-4).map((idx) => ({ target: CARDS[idx].target, difficulty: cardDifficulty(idx) })),
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    size: baseTargets.length,
    unique: new Set(baseTargets).size,
    calibrationReady: baseTargets.every((idx) => cardDifficultyBand(idx) !== "入门" && contextSource(idx) !== "fallback"),
    labels: { show: show.textContent, done: done.textContent, noNext: !document.getElementById("nextBtn") },
    helpReady: !show.disabled && !show.classList.contains("tlock") && !tip.classList.contains("tlock"),
    helpCopy: mascotLine.textContent,
    touch: { done: getComputedStyle(done).touchAction, tab: getComputedStyle(tabPractice).touchAction },
  }));
  assert(calibrationQueue.front === "尴嚏" && calibrationQueue.tail.every((row) => row.difficulty <= 85) && calibrationQueue.flags.every(Boolean) && calibrationQueue.size === 15 && calibrationQueue.unique === 15 && calibrationQueue.calibrationReady
    && calibrationQueue.helpReady && calibrationQueue.helpCopy.includes("写不出就点")
    && calibrationQueue.labels.show === "不会写" && calibrationQueue.labels.done === "写好了" && calibrationQueue.labels.noNext && calibrationQueue.touch.done === "manipulation" && calibrationQueue.touch.tab === "manipulation",
  "Expected calibration hooks, capped finish, and immediately available first-card help", calibrationQueue);

  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing");
  const calibrationHelp = await page.evaluate(() => ({ phase: practicePhase, comfort: calibrationComfortShown, copy: traceIntro.textContent, mascot: mascotLine.textContent, bubbleHidden: getComputedStyle(teachBubble).display === "none", actionBottom: traceActions.getBoundingClientRect().bottom, viewportBottom: innerHeight, secondComfort: takeCalibrationComfort("slow"), card1Events: funnelEventCount("calib_card1_done") }));
  assert(calibrationHelp.phase === "tracing" && calibrationHelp.comfort && calibrationHelp.copy.includes("想不起来很正常") && calibrationHelp.mascot.includes("沿着轮廓写") && calibrationHelp.bubbleHidden && calibrationHelp.actionBottom <= calibrationHelp.viewportBottom
    && !calibrationHelp.secondComfort && calibrationHelp.card1Events === 1,
  "Expected first-card don't-know to enter tracing immediately and show calibration comfort only once", calibrationHelp);

  await page.evaluate(() => { tracedThisCard = true; updateInkControls(); });
  await page.click("#traceDone");
  const postTraceLayout = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, hint: hint.textContent, mascot: mascotLine.textContent, actionBottom: actions.getBoundingClientRect().bottom, viewportBottom: innerHeight, show: show.textContent }));
  assert(postTraceLayout.phase === "postTraceRecall" && postTraceLayout.title.includes("第 2 步：自己写") && postTraceLayout.hint === "" && postTraceLayout.mascot === "不看范字，再独立写一次"
    && postTraceLayout.actionBottom <= postTraceLayout.viewportBottom && postTraceLayout.show === "再描一遍", "Expected the complete 375x667 post-trace controls without duplicate guidance", postTraceLayout);

  await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning(); activeMode = "calibrate"; startRound();
  });
  await waitForWriter(page);

  await page.evaluate(() => { inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer(); });
  const firstCalibrationReveal = await page.evaluate(async () => {
    const snapshot = submissionSnapshot, baseStyle = (node) => { const style = getComputedStyle(node); return { background: style.backgroundColor, border: style.border, shadow: style.boxShadow }; };
    const first = { bubble: getComputedStyle(teachBubbleGrade).display, ask: getComputedStyle(askRow).display, decisionBottom: decisionRow.getBoundingClientRect().bottom, viewportBottom: innerHeight };
    showRevealState({ ...snapshot, lastVerdict: null }); await new Promise((resolve) => setTimeout(resolve, 160)); const neutral = { correct: baseStyle(decisionCorrect), wrong: baseStyle(decisionWrong), suggested: decisionCorrect.classList.contains("suggest") || decisionWrong.classList.contains("suggest") };
    showRevealState({ ...snapshot, lastVerdict: { status: "bad", mode: "exact", failed: [0], missing: 0 } }); await new Promise((resolve) => setTimeout(resolve, 160)); const wrongSuggested = { correct: baseStyle(decisionCorrect), wrong: baseStyle(decisionWrong), suggested: decisionWrong.classList.contains("suggest") && !decisionCorrect.classList.contains("suggest") };
    showRevealState(snapshot);
    return { first, neutral, wrongSuggested };
  });
  assert(firstCalibrationReveal.first.bubble === "block" && firstCalibrationReveal.first.ask === "none" && firstCalibrationReveal.first.decisionBottom <= firstCalibrationReveal.first.viewportBottom,
    "Expected the first calibration reveal to explain honest self-assessment without duplicate mascot copy", firstCalibrationReveal.first);
  assert(!firstCalibrationReveal.neutral.suggested && firstCalibrationReveal.neutral.correct.background === firstCalibrationReveal.neutral.wrong.background
    && firstCalibrationReveal.neutral.correct.border === firstCalibrationReveal.neutral.wrong.border && firstCalibrationReveal.neutral.correct.shadow === firstCalibrationReveal.neutral.wrong.shadow
    && firstCalibrationReveal.wrongSuggested.suggested && firstCalibrationReveal.wrongSuggested.wrong.background !== firstCalibrationReveal.wrongSuggested.correct.background,
  "Expected neutral decisions to carry equal weight and an exact assistant suggestion to dominate on either side", firstCalibrationReveal);
  await page.click("#replayBtn"); await page.waitForTimeout(80);
  const compactReplay = await page.evaluate(() => { const box = document.querySelector(".cmpBox.std").getBoundingClientRect(), svg = rightHz.querySelector("svg").getBoundingClientRect(); return { box: [box.width, box.height], svg: [svg.width, svg.height], right: svg.right - box.right, bottom: svg.bottom - box.bottom }; });
  assert(compactReplay.box.join() === "138,138" && compactReplay.svg.join() === compactReplay.box.join() && compactReplay.right <= 0.5 && compactReplay.bottom <= 0.5, "Expected 375px reveal playback to use the rendered comparison-box size without clipping", compactReplay);
  await page.setViewportSize({ width: 390, height: 844 });

  const calibrationIsolation = await page.evaluate(() => {
    const original = calibrationTargets.slice(), originalSet = new Set(original);
    const extras = allIndexes().filter((idx) => !originalSet.has(idx) && qualityAvailable(idx)).slice(0, 3);
    insertIntoCurrentBatch(extras);
    const saved = load(SESSION_KEY, null);
    calibrationTargets = [];
    restoreSession(saved);
    const restored = calibrationTargets.slice();
    roundStats = [
      ...original.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", geometryStatus: "ok", geometryMode: "exact" })),
      ...extras.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "miss" })),
    ];
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; preference = "balanced";
    const allCounts = roundCounts(), sampleCounts = roundCounts(calibrationRoundStats());
    maybeFinishCalibration();
    return { original, extras, restored, total: baseTargets.length, allCounts, sampleCounts, calibration: cloneObj(tuning.calibration), preference, offset: tuning.offset, completedEvents: funnelEventCount("calib_completed") };
  });
  assert(calibrationIsolation.original.length === 15 && calibrationIsolation.extras.length === 3 && calibrationIsolation.total === 18
    && calibrationIsolation.restored.join() === calibrationIsolation.original.join() && calibrationIsolation.allCounts.fast === 15 && calibrationIsolation.allCounts.miss === 3
    && calibrationIsolation.sampleCounts.fast === 15 && calibrationIsolation.sampleCounts.miss === 0 && calibrationIsolation.calibration.sampleSize === 15
    && calibrationIsolation.calibration.counts.fast === 15 && calibrationIsolation.calibration.counts.miss === 0 && calibrationIsolation.preference === "challenge" && calibrationIsolation.offset === 10 && calibrationIsolation.completedEvents === 1,
  "Expected added calibration cards to persist and learn without changing the original 15-card calibration result", calibrationIsolation);

  const calibrationConsistency = await page.evaluate(() => {
    const sample = calibrationTargets.slice(0, 12);
    activeMode = "calibrate"; calibrationTargets = sample; tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; preference = "balanced";
    roundStats = sample.map((idx, order) => ({ idx, target: CARDS[idx].target, outcome: "fast", geometryStatus: order < 8 ? "ok" : "bad", geometryMode: "exact" }));
    maybeFinishCalibration();
    return { calibration: cloneObj(tuning.calibration), preference, offset: tuning.offset };
  });
  assert(calibrationConsistency.calibration.counts.fast === 12 && calibrationConsistency.calibration.consistentFast === 10
    && calibrationConsistency.preference === "balanced" && calibrationConsistency.offset === 2,
  "Expected geometry disagreement to keep twelve self-rated fast cards out of challenge calibration", calibrationConsistency);

  const calibrationWebReturn = await page.evaluate(() => {
    summary.style.display = "flex"; calibCard.style.display = "flex"; renderCalibrationReturnHook();
    return { visible: getComputedStyle(calibReturnHook).display === "flex", title: calibReturnTitle.textContent, date: calibReturnText.textContent, buttonHidden: getComputedStyle(calibReminderYes).display === "none", tomorrow: formatDueDay(shiftDay(today(), 1)) };
  });
  assert(calibrationWebReturn.visible && calibrationWebReturn.title.includes("明天继续") && calibrationWebReturn.date === calibrationWebReturn.tomorrow && calibrationWebReturn.buttonHidden,
  "Expected Web calibration result to show a concrete next-day return expectation", calibrationWebReturn);

  await page.evaluate(() => { clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer();
    lastVerdict = { status: "bad", mode: "exact", failed: [0], missing: 0 }; submissionSnapshot = Object.freeze({ ...submissionSnapshot, lastVerdict: cloneObj(lastVerdict) }); showRevealState(submissionSnapshot);
  });
  const revealFidelity = await page.evaluate(() => {
    const exactSnapshot = submissionSnapshot, mineBox = document.querySelector(".cmpBox.mine"), stdBox = document.querySelector(".cmpBox.std");
    const result = {
      grids: [mineBox, stdBox].map((box) => ["cx", "cy", "d1", "d2"].every((cls) => !!box.querySelector(`.${cls}`))),
      standardPaths: rightHz.querySelectorAll("svg path").length,
      overlayPaths: mineOverlay.querySelectorAll("svg path").length,
      sameViewBox: rightHz.querySelector("svg")?.getAttribute("viewBox") === mineOverlay.querySelector("svg")?.getAttribute("viewBox"),
      failedCount: Number(mineInk.dataset.failedCount),
      copy: askLine.textContent,
      exactSuggest: decisionWrong.classList.contains("suggest") && !decisionCorrect.classList.contains("suggest"),
    };
    showRevealState({ ...exactSnapshot, referenceStrokes: [] });
    result.fallback = rightGlyph.style.opacity === "1" && rightHz.querySelectorAll("svg path").length === 0 && mineOverlay.textContent === cur.target;
    showRevealState(exactSnapshot);
    return result;
  });
  assert(revealFidelity.grids.every(Boolean) && revealFidelity.standardPaths > 0 && revealFidelity.standardPaths === revealFidelity.overlayPaths && revealFidelity.sameViewBox
    && revealFidelity.failedCount === 1 && revealFidelity.copy.includes("这几笔可以再和范字对照一下") && revealFidelity.exactSuggest && revealFidelity.fallback,
  "Expected coordinate-aligned skeleton comparison, exact-stroke highlighting, soft suggestion tint, and font fallback", revealFidelity);
  await page.click("#decisionCorrect");
  const softConfirmFirst = await page.evaluate(() => ({ shown: getComputedStyle(softConfirm).display !== "none", stamped, attempts: episodeFor(currentCardIndex()).attempts.length }));
  assert(softConfirmFirst.shown && !softConfirmFirst.stamped && softConfirmFirst.attempts === 0, "Expected exact-bad correct choice to pause before accounting", softConfirmFirst);
  await page.click("#compareAgain");
  await page.click("#decisionCorrect");
  const softConfirmOnce = await page.evaluate(() => ({ hidden: getComputedStyle(softConfirm).display === "none", stamped, outcome: roundStats[0] && roundStats[0].outcome }));
  assert(softConfirmOnce.hidden && softConfirmOnce.stamped && softConfirmOnce.outcome === "fast", "Expected compare-again to avoid repeating the soft confirmation on the same reveal", softConfirmOnce);
  await page.click("#editStamp");
  await page.click("#decisionCorrect");
  const softConfirmAfterUndo = await page.evaluate(() => ({ shown: getComputedStyle(softConfirm).display !== "none", stamped, attempts: episodeFor(currentCardIndex()).attempts.length }));
  assert(softConfirmAfterUndo.shown && !softConfirmAfterUndo.stamped && softConfirmAfterUndo.attempts === 0, "Expected edit rollback to reset the soft-confirm decision", softConfirmAfterUndo);
  await page.click("#confirmCorrect");
  const confirmedCorrect = await page.evaluate(() => ({ stamped, rating: fsrsReviewLog.slice(-1)[0] && fsrsReviewLog.slice(-1)[0].rating, outcome: roundStats[0] && roundStats[0].outcome }));
  assert(confirmedCorrect.stamped && confirmedCorrect.rating === "Good" && confirmedCorrect.outcome === "fast", "Expected explicit confirmation to keep the existing graduation path", confirmedCorrect);

  await page.evaluate(() => { clearTimeout(autoNextTimer); stamped = false; clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "疑")]); });
  await waitForWriter(page);
  await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer();
    lastVerdict = { status: "bad", mode: "holistic", failed: [0], missing: 1 }; submissionSnapshot = Object.freeze({ ...submissionSnapshot, lastVerdict: cloneObj(lastVerdict) }); showRevealState(submissionSnapshot);
  });
  const holisticRendering = await page.evaluate(() => ({ failedCount: Number(mineInk.dataset.failedCount), suggested: decisionCorrect.classList.contains("suggest") || decisionWrong.classList.contains("suggest") }));
  assert(holisticRendering.failedCount === 0 && !holisticRendering.suggested, "Expected holistic verdicts to avoid stroke coloring and preselection", holisticRendering);
  await page.click("#decisionCorrect");
  const holisticNoConfirm = await page.evaluate(() => ({ stamped, softHidden: getComputedStyle(softConfirm).display === "none", outcome: roundStats[0] && roundStats[0].outcome }));
  assert(holisticNoConfirm.stamped && holisticNoConfirm.softHidden && holisticNoConfirm.outcome === "fast", "Expected holistic disagreement to remain advisory without soft confirmation", holisticNoConfirm);

  const disagreementRate = await page.evaluate(() => {
    const original = memory;
    memory = { a: { lastSystemAgree: true }, b: { lastSystemAgree: false }, c: { lastSystemAgree: null }, d: {} };
    const result = systemAgreementStats(); memory = original; return result;
  });
  assert(disagreementRate.total === 2 && disagreementRate.disagree === 1 && disagreementRate.rate === 50, "Expected dev disagreement rate to ignore unavailable assistant verdicts", disagreementRate);

  await page.evaluate(() => { clearTimeout(autoNextTimer); stamped = false; clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "衡")]); });
  await waitForWriter(page);
  await submitStandard(page);
  const uncertainBefore = await page.evaluate(() => dailyActivity().attempts);
  await page.click("#decisionUncertain");
  const uncertain = await page.evaluate((before) => {
    const idx = currentCardIndex(), ep = episodeFor(idx), event = fsrsReviewLog.slice(-1)[0], stat = roundStats[0];
    const row = dailyActivity();
    return { before, after: row.attempts, targetOccurrences: row.targetKeys.filter((key) => key === cardKey(idx)).length, outcome: stat && stat.outcome, uncertain: stat && stat.uncertain, rating: event && event.rating, reason: event && event.reason,
      queued: unresolved.has(idx) && reinforcementQueue.some((item) => item.idx === idx), pendingLearning: !!(memory[cardKey(idx)] || {}).pendingLearning, attempts: ep.attempts.length, userCorrect: ep.attempts[0] && ep.attempts[0].userCorrect };
  }, uncertainBefore);
  assert(uncertain.outcome === "hinted" && uncertain.uncertain && uncertain.rating === "Again" && uncertain.reason === "hinted"
    && uncertain.queued && uncertain.pendingLearning && uncertain.attempts === 1 && !uncertain.userCorrect && uncertain.after === uncertain.before && uncertain.targetOccurrences === 0,
  "Expected uncertain focus self-assessment to reinforce memory without counting toward the daily practice log", uncertain);

  const inRoundAdd = await page.evaluate(() => {
    const pool = allIndexes().filter((idx) => qualityAvailable(idx)).slice(100, 120), original = pool.slice(0, 15), extras = pool.slice(15, 17);
    displayView("card"); baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-current";
    manualQueue = []; reinforcementQueue = [{ idx: extras[0], eligibleAfter: 0, order: 0 }]; unresolved = new Set([extras[0]]); episodes = {}; roundStats = []; sessionDone = new Set(); practicePhase = "recall";
    const appended = insertIntoCurrentBatch([extras[0], extras[1], extras[0]]); const afterAppend = { total: baseTargets.length, unique: new Set(baseTargets).size, queue: manualQueue.map((item) => item.idx), progress: practiceProgress() };
    baseCursor = 1; const first = nextQueuedTarget(); baseCursor += 1; const second = nextQueuedTarget();

    baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-move"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = []; sessionDone = new Set();
    const future = original[8], moved = insertIntoCurrentBatch([future]); baseCursor = 1; const movedNext = nextQueuedTarget();

    baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-repeat"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = { [String(original[0])]: { idx: original[0], firstOutcome: "fast", attempts: [{ attemptId: "old" }] } }; roundStats = [{ idx: original[0], target: CARDS[original[0]].target, outcome: "fast" }]; sessionDone = new Set([original[0]]);
    const repeated = insertIntoCurrentBatch([original[0]]); const repeatTotal = baseTargets.length; const saved = load(SESSION_KEY, null); manualQueue = []; restoreSession(saved); const restoredQueue = manualQueue.map((item) => ({ idx: item.idx, kind: item.kind }));
    const modes = ["new", "review", "focus", "calibrate"].map((mode) => {
      activeMode = mode; baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = `verify-add-${mode}`; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = []; sessionDone = new Set();
      insertIntoCurrentBatch([extras[0]]); baseCursor = 1; const next = nextQueuedTarget(); return { mode, total: baseTargets.length, originalsKept: original.every((idx) => baseTargets.includes(idx)), next: next.idx };
    });
    return { original, extras, appended, afterAppend, first, second, moved, movedNext, repeated, repeatTotal, restoredQueue, modes };
  });
  assert(inRoundAdd.appended.queued.join() === inRoundAdd.extras.join() && inRoundAdd.afterAppend.total === 17 && inRoundAdd.afterAppend.unique === 17 && inRoundAdd.afterAppend.progress.done === 0 && inRoundAdd.afterAppend.progress.total === 17
    && inRoundAdd.first.idx === inRoundAdd.extras[0] && inRoundAdd.second.idx === inRoundAdd.extras[1], "Expected a full group to grow and preserve deduplicated FIFO manual priority", inRoundAdd);
  assert(inRoundAdd.moved.added.length === 0 && inRoundAdd.movedNext.idx === inRoundAdd.original[8] && inRoundAdd.repeatTotal === 15 && inRoundAdd.repeated.queued[0] === inRoundAdd.original[0]
    && inRoundAdd.restoredQueue.length === 1 && inRoundAdd.restoredQueue[0].kind === "repeat" && inRoundAdd.modes.every((row) => row.total === 16 && row.originalsKept && row.next === inRoundAdd.extras[0]), "Expected future/current targets to move or repeat without growing the denominator and all modes to preserve manual priority", inRoundAdd);

  await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning();
    startFocus([CARDS.findIndex((card) => card.target === "器"), CARDS.findIndex((card) => card.target === "衡")]);
  });
  await submitStandard(page);
  await chooseCorrect(page);
  const repeatTarget = await page.evaluate(() => cur.target);
  await page.evaluate(() => openAddSheet());
  await page.fill("#addInput", repeatTarget);
  const repeatExit = await page.evaluate(() => {
    confirmAdd();
    const before = { baseCursor, total: baseTargets.length, queue: cloneObj(manualQueue), phase: practicePhase };
    exitCurrentRound(false);
    return { before, saved: load(SESSION_KEY, null), home: getComputedStyle(home).display !== "none" };
  });
  assert(repeatExit.home && repeatExit.before.baseCursor === 1 && repeatExit.before.total === 2 && repeatExit.before.phase === "feedback"
    && repeatExit.before.queue.length === 1 && repeatExit.before.queue[0].kind === "repeat" && repeatExit.saved.manualQueue.length === 1,
  "Expected a last-card feedback addition to save its pending repeat before returning home", repeatExit);
  await page.waitForFunction(() => history.state && history.state.shiziView === "home");
  await page.click("#startBtn");
  await page.waitForFunction(() => practiceHistoryArmed && getComputedStyle(card).display !== "none");
  const repeatRestore = await page.evaluate(() => ({ summary: getComputedStyle(summary).display, phase: practicePhase, queue: cloneObj(manualQueue), session: load(SESSION_KEY, null) }));
  assert(repeatRestore.summary === "none" && repeatRestore.phase === "feedback" && repeatRestore.queue.length === 1 && repeatRestore.session,
  "Expected restore to keep the final-card feedback and pending manual repeat instead of summarizing", repeatRestore);
  await page.waitForFunction((target) => currentAttemptKind === "manual" && cur.target === target && practicePhase === "recall", repeatTarget);
  const repeatedAfterRestore = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, queue: manualQueue.length, total: baseTargets.length, summary: getComputedStyle(summary).display, session: load(SESSION_KEY, null) }));
  assert(repeatedAfterRestore.target === repeatTarget && repeatedAfterRestore.kind === "manual" && repeatedAfterRestore.queue === 0 && repeatedAfterRestore.total === 2 && repeatedAfterRestore.summary === "none" && repeatedAfterRestore.session,
  "Expected the restored next card to consume the queued repeat without growing the group", repeatedAfterRestore);

  const completionHaptics = await page.evaluate(async () => {
    exitCurrentRound(); clearSessionSnapshot();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; saveActivity();
    reminder.milestonesShown = []; saveReminder(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); activeMode = "new";
    const indexes = indexesForChars(["强", "器", "疑"]);
    baseTargets = indexes.slice(0, 2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-milestone";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    const milestoneDelay = parseFloat(getComputedStyle(summaryBigSeal).animationDelay) * 1000, milestoneImmediate = hapticDebug.events.slice();
    await new Promise((resolve) => setTimeout(resolve, milestoneDelay + 100)); const milestone = hapticDebug.events.slice();
    baseTargets = indexes.slice(2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-ordinary";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    const ordinaryDelay = parseFloat(getComputedStyle(summaryBigSeal).animationDelay) * 1000, ordinaryImmediate = hapticDebug.events.slice();
    await new Promise((resolve) => setTimeout(resolve, ordinaryDelay + 100));
    return { milestoneImmediate, milestone, milestoneDelay, ordinaryImmediate, ordinary: hapticDebug.events.slice(), ordinaryDelay, groups: dailyActivity().completedGroups, totalDays: totalPracticeDays() };
  });
  assert(completionHaptics.milestoneImmediate.length === 0 && completionHaptics.ordinaryImmediate.length === 0 && completionHaptics.milestone.join() === "milestone" && completionHaptics.ordinary.join() === "action"
    && completionHaptics.milestoneDelay > completionHaptics.ordinaryDelay && completionHaptics.groups === 2 && completionHaptics.totalDays === 1,
  "Expected milestone and ordinary completion haptics to land with their delayed final seal", completionHaptics);

  const p1Ceremony = await page.evaluate(async () => {
    clearTimeout(summarySealTimer); clearTimeout(autoNextTimer); clearSessionSnapshot();
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; saveActivity();
    reminder = normalizeReminder({ milestonesShown: [1], characterMilestonesShown: [] }); saveReminder();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); activeMode = "calibrate";
    const indexes = ["器", "疑", "强", "料"].map((target) => CARDS.findIndex((card) => card.target === target));
    baseTargets = indexes.slice(); batch = baseTargets; calibrationTargets = baseTargets.slice(); baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = [
      { idx: indexes[0], target: CARDS[indexes[0]].target, outcome: "fast", independentlyRecovered: false },
      { idx: indexes[1], target: CARDS[indexes[1]].target, outcome: "hinted", uncertain: true, independentlyRecovered: true },
      { idx: indexes[2], target: CARDS[indexes[2]].target, outcome: "slow", independentlyRecovered: false },
      { idx: indexes[3], target: CARDS[indexes[3]].target, outcome: "miss", independentlyRecovered: true },
    ];
    roundId = "verify-p1-ceremony"; roundStartMemoryCount = memoryCount(); indexes.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null;
    roundSummary(true);
    const sealDelay = parseFloat(getComputedStyle(calibBigSeal).animationDelay) * 1000;
    const immediate = hapticDebug.events.slice(), tiles = Array.from(calibSumTiles.querySelectorAll(".sumTile")), ariaProbe = document.createElement("div");
    ariaProbe.innerHTML = sumTile({ idx: indexes[1], target: CARDS[indexes[1]].target, outcome: "hinted", uncertain: false, independentlyRecovered: false }, 0);
    const before = {
      calibration: getComputedStyle(calibCard).display, sheet: getComputedStyle(sumSheet).display, tiles: tiles.length, date: calibDateSeal.textContent,
      sealDelay, hint: getComputedStyle(calibPracticeHint).display, legend: calibCard.textContent.includes("首次结果：无标记 独立写对") && calibCard.textContent.includes("金菱 看过提示 / 不确定"),
      marks: tiles.map((tile) => tile.querySelector(".outcomeMark")?.textContent || ""), recovered: tiles.map((tile) => tile.querySelector(".recover")?.textContent || ""),
      arias: tiles.map((tile) => tile.getAttribute("aria-label")), hintedAria: ariaProbe.firstElementChild?.getAttribute("aria-label") || "",
      slowBorder: getComputedStyle(tiles[2]).borderColor, blue: getComputedStyle(document.documentElement).getPropertyValue("--blue").trim(), immediate,
    };
    await new Promise((resolve) => setTimeout(resolve, sealDelay + 100));

    const idx = indexes[1]; currentIndex = idx; cur = CARDS[idx]; currentAttemptId = "verify-recovered-stamp"; episodes = { [String(idx)]: { idx, firstOutcome: "hinted", attempts: [] } };
    memory[cardKey(idx)] = { seen: 1, dueDay: "2026-07-30" }; showStampedFeedback("fast");
    const recoveredStamp = { className: stampOnMine.className, shadow: getComputedStyle(stampOnMine.querySelector(".face")).boxShadow, copy: toastSubEl.textContent, mascot: feedbackBlob.className };
    showStampedFeedback("slow"); recoveredStamp.concernedMascot = feedbackBlob.className;

    reminder.characterMilestonesShown = []; reminder.characterMilestoneDay = ""; saveReminder();
    const hundred = celebrateCharacterMilestoneIfAny(99, 100), repeated = celebrateCharacterMilestoneIfAny(99, 100); renderSummaryMilestone({ kind: "characters", value: hundred });
    memory = Object.fromEntries(Array.from({ length: 100 }, (_, order) => [`milestone:${order}`, { seen: 1, last: Date.now() }])); saveMemory();
    activity.daily = {}; activity.practiceDays = []; for (let order = 0; order < 5; order += 1) { const key = shiftDay(today(), -order); activity.practiceDays.push(key); activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`m:${order}`], completedRoundIds: [`m:${order}`] }; } saveActivity();
    backupMeta = normalizeBackupMeta(null); summaryBackupHintVisible = false; save(BACKUP_META_KEY, backupMeta); renderBackupUI(); renderSummaryBackupHint();
    const character = { hundred, repeated, badge: milestoneMiniSeal.textContent, copy: $("milestoneCopy").textContent, reminder: getComputedStyle(backupReminder).display, summaryReminder: getComputedStyle(summaryBackupHint).display };

    const vibrated = []; try { Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration) => { vibrated.push(duration); return true; } }); } catch (error) {}
    hapticFeedback("select"); hapticFeedback("stamp"); hapticFeedback("milestone");
    clearTimeout(summarySealTimer); clearTimeout(autoNextTimer);
    return { before, after: hapticDebug.events.slice(0, 1), recoveredStamp, character, vibrated };
  });
  assert(p1Ceremony.before.calibration === "flex" && p1Ceremony.before.sheet === "none" && p1Ceremony.before.tiles === 4 && p1Ceremony.before.date.length > 0
    && p1Ceremony.before.sealDelay >= 690 && p1Ceremony.before.hint === "block" && p1Ceremony.before.legend && p1Ceremony.before.marks.join("") === "补待再"
    && p1Ceremony.before.recovered.filter(Boolean).every((copy) => copy === "已独立")
    && p1Ceremony.before.arias[0].includes("第一次独立写对") && p1Ceremony.before.arias[1].includes("第一次不太确定，之后已独立写出")
    && p1Ceremony.before.arias[2].includes("第一次写错") && p1Ceremony.before.arias[3].includes("第一次没写出") && p1Ceremony.before.hintedAria.includes("第一次看过提示后写出")
    && p1Ceremony.before.slowBorder !== p1Ceremony.before.blue && p1Ceremony.before.immediate.length === 0 && p1Ceremony.after.join() === "action",
  "Expected the first calibration result to play the full, risk-readable tile/date/final-seal ceremony", p1Ceremony);
  assert(p1Ceremony.recoveredStamp.className.includes("recovered") && p1Ceremony.recoveredStamp.shadow !== "none" && p1Ceremony.recoveredStamp.copy === "这个字今天写稳了" && p1Ceremony.recoveredStamp.mascot.includes("pleased") && p1Ceremony.recoveredStamp.concernedMascot.includes("concerned"),
  "Expected an independently recovered card to receive a distinct gold-edged seal, plain-language feedback, and responsive mascot state", p1Ceremony.recoveredStamp);
  assert(p1Ceremony.character.hundred === 100 && p1Ceremony.character.repeated === null && p1Ceremony.character.badge === "百" && p1Ceremony.character.copy.includes("100")
    && p1Ceremony.character.reminder === "none" && p1Ceremony.character.summaryReminder === "none" && p1Ceremony.vibrated.join() === "10,10",
  "Expected one-time hundred-character recognition to take priority over backup prompts with Web vibration fallback", p1Ceremony);

  const p1Discovery = await page.evaluate(() => {
    clearSessionSnapshot(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; memory = {}; status = {};
    const idx = CARDS.findIndex((card) => card.target === "器"); memory[cardKey(idx)] = { seen: 1, last: Date.now(), misses: 1, streak: 0, lastOutcome: "miss", dueDay: today(), due: dayStartMs(today()) }; saveMemory(); markPracticeStamp(idx); renderMe();
    const me = { calendar: getComputedStyle(meCalendar).display !== "none", stat: calendarMonthStat.textContent, ready: profileSampleReady(), advice: meAdvice.textContent, weak: meWeakChars.textContent }; renderProfile(); const bars = profilePanel.querySelectorAll(".profileBar").length;
    memory = {}; saveMemory(); renderBook(); const wallEmpty = !!document.querySelector(".memoryWallEmpty");
    memory[cardKey(idx)] = { seen: 1, last: Date.now(), streak: 2, lastOutcome: "fast", dueDay: today(), due: dayStartMs(today()) }; status = { [idx]: "rest" }; saveMemory(); save(DECK_KEY, status); activity = newActivity(); saveActivity(); renderHome(); const breathes = startBtn.classList.contains("dueBreathe");
    activeMode = "focus"; baseTargets = [idx]; batch = baseTargets; baseCursor = 0; currentIndex = idx; currentAttemptKind = "base"; currentAttemptId = "verify-auto-overlay"; episodes = {}; roundStats = []; unresolved = new Set(); manualQueue = []; practicePhase = "recall"; cur = CARDS[idx]; stamped = false; revealed = false; lastVerdict = null; hintEverUsed = false; hintsUsedThisCard = 0;
    submissionSnapshot = Object.freeze({ target: cur.target, idx, attemptId: currentAttemptId, createdAt: Date.now(), hintStrokeIds: [], hintCount: 0, hintStrokes: [], inkStrokes: [], referenceStrokes: [], compositeGeometry: [], compositeImage: null, hintEverUsed: false, enteredTracing: false, practicePhase: "recall", lastVerdict: null, userCorrect: null });
    showRevealState(submissionSnapshot); decideSubmission(false); const autoOverlay = { on: overlayOn, display: getComputedStyle(mineOverlay).display, toggle: overlayToggle.textContent }; clearTimeout(autoNextTimer); clearTimeout(editStampTimer);
    return { me, bars, wallEmpty, breathes, autoOverlay, homeAdd: !!homeAdd, qualityTargets: Array.from(qualityBox.querySelectorAll("button")).map((node) => parseFloat(getComputedStyle(node).minHeight)), compareTargets: Array.from(document.querySelectorAll(".cmpLinks button")).map((node) => parseFloat(getComputedStyle(node).minHeight)) };
  });
  assert(p1Discovery.me.calendar && p1Discovery.me.stat.includes("累计") && !p1Discovery.me.ready && p1Discovery.me.advice === "这些字在练习中没写出来过" && p1Discovery.me.weak.includes("器") && p1Discovery.bars === 0
    && p1Discovery.wallEmpty && p1Discovery.breathes && p1Discovery.autoOverlay.on && p1Discovery.autoOverlay.display === "flex" && p1Discovery.autoOverlay.toggle === "分开看"
    && p1Discovery.homeAdd && p1Discovery.qualityTargets.every((height) => height >= 44) && p1Discovery.compareTargets.every((height) => height >= 40),
  "Expected contextual My states, discoverable controls, an empty memory wall, and a due-card breathe cue", p1Discovery);

  await page.evaluate(() => {
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    reminder.milestonesShown = []; saveReminder();
    clearSessionSnapshot(); sessionDone = new Set();
    const indexes = ["器", "疑", "强"].map((target) => CARDS.findIndex((card) => card.target === target));
    startFocus(indexes);
  });
  await waitForWriter(page);

  const handwritingBoundaries = await page.evaluate(async () => {
    const originalWriter = writer;
    const addStroke = () => { curInkStroke = [{ x: 24, y: 28 }, { x: 72, y: 78 }]; inkEnd(); };
    tuning.peekHintUsed = false; tuning.strokeHintConsequenceShown = false; saveTuning();
    clearInk(); actionStack = []; seenGroups = new Set(); groups = [1, 1]; groupIdx = 0; shownStrokes = 0; hintsUsedThisCard = 0; hintEverUsed = false;
    writer = { animateStroke: async () => {} }; updateTip();
    addStroke(); await tip.onclick(); addStroke();
    const peekOffer = { copy: hint.textContent, consumed: !!tuning.peekHintUsed, consequenceShown: !!tuning.strokeHintConsequenceShown, title: tip.hasAttribute("title") };
    const stacked = actionStack.map((action) => action.type).join(",");
    await undoInkStroke(); const afterStroke = { ink: inkStrokes.length, stack: actionStack.map((action) => action.type).join(",") };
    await undoInkStroke(); const afterHint = { ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.map((action) => action.type).join(","), tipDisabled: tip.disabled };
    await undoInkStroke(); const empty = { ink: inkStrokes.length, stack: actionStack.length, undoDisabled: undoStroke.disabled };

    actionStack = []; seenGroups = new Set(); groups = [1, 1]; groupIdx = 0; shownStrokes = 0; hintsUsedThisCard = 0; hintEverUsed = false; clearInk(); updateTip();
    await tip.onclick(); const firstUse = hintsUsedThisCard;
    await rewriteCurrentCard();
    const rewritten = { ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.length, tipDisabled: tip.disabled, firstUse };
    writer = { animateStroke: async () => {} }; groups = [1, 1]; updateTip();
    await tip.onclick(); const replayUse = hintsUsedThisCard;
    await tip.onclick(); const newUse = hintsUsedThisCard;

    loadToken += 1; writer = { animateStroke: () => new Promise((resolve) => setTimeout(resolve, 70)) };
    groups = [1]; groupIdx = 0; shownStrokes = 0; actionStack = []; seenGroups = new Set(); hintEverUsed = false; hintsUsedThisCard = 0; animating = false; revealed = false; clearInk(); updateTip();
    const playback = tip.onclick(); await Promise.resolve();
    const duringPlayback = { animating, opacity: Number(inkCanvas.style.opacity), doneDisabled: done.disabled, showDisabled: show.disabled, revealRejected: revealAnswer() === false };
    await playback;
    const afterPlayback = { animating, opacity: Number(inkCanvas.style.opacity), stack: actionStack.map((action) => action.type).join(",") };

    loadToken += 1; writer = { animateStroke: () => new Promise((resolve) => setTimeout(resolve, 70)) };
    groups = [1]; groupIdx = 0; shownStrokes = 0; actionStack = []; seenGroups = new Set(); animating = false; revealed = false; updateTip();
    const interrupted = tip.onclick(); await Promise.resolve(); const rewriting = rewriteCurrentCard(); await Promise.all([interrupted, rewriting]);
    const afterInterrupt = { animating, opacity: Number(inkCanvas.style.opacity), ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.length };
    writer = originalWriter;
    return { stacked, peekOffer, afterStroke, afterHint, empty, rewritten, replayUse, newUse, duringPlayback, afterPlayback, afterInterrupt };
  });
  assert(handwritingBoundaries.stacked === "stroke,hint,stroke"
    && handwritingBoundaries.peekOffer.copy.includes("按住「点拨」") && !handwritingBoundaries.peekOffer.consumed && handwritingBoundaries.peekOffer.consequenceShown && !handwritingBoundaries.peekOffer.title
    && handwritingBoundaries.afterStroke.ink === 1 && handwritingBoundaries.afterStroke.stack === "stroke,hint"
    && handwritingBoundaries.afterHint.ink === 1 && handwritingBoundaries.afterHint.groupIdx === 0 && handwritingBoundaries.afterHint.shownStrokes === 0 && handwritingBoundaries.afterHint.stack === "stroke" && !handwritingBoundaries.afterHint.tipDisabled
    && handwritingBoundaries.empty.ink === 0 && handwritingBoundaries.empty.stack === 0 && handwritingBoundaries.empty.undoDisabled,
  "Expected stroke/hint/stroke undo ordering and hint-layer rollback", handwritingBoundaries);
  assert(handwritingBoundaries.rewritten.ink === 0 && handwritingBoundaries.rewritten.groupIdx === 0 && handwritingBoundaries.rewritten.shownStrokes === 0 && handwritingBoundaries.rewritten.stack === 0 && !handwritingBoundaries.rewritten.tipDisabled
    && handwritingBoundaries.rewritten.firstUse === 1 && handwritingBoundaries.replayUse === 1 && handwritingBoundaries.newUse === 2,
  "Expected rewrite to reset visual state without double-counting replayed hint groups", handwritingBoundaries);
  assert(handwritingBoundaries.duringPlayback.animating && handwritingBoundaries.duringPlayback.opacity === 0.22 && handwritingBoundaries.duringPlayback.doneDisabled && handwritingBoundaries.duringPlayback.showDisabled && handwritingBoundaries.duringPlayback.revealRejected
    && !handwritingBoundaries.afterPlayback.animating && handwritingBoundaries.afterPlayback.opacity === 1 && handwritingBoundaries.afterPlayback.stack === "hint"
    && !handwritingBoundaries.afterInterrupt.animating && handwritingBoundaries.afterInterrupt.opacity === 1 && handwritingBoundaries.afterInterrupt.ink === 0 && handwritingBoundaries.afterInterrupt.groupIdx === 0 && handwritingBoundaries.afterInterrupt.shownStrokes === 0 && handwritingBoundaries.afterInterrupt.stack === 0,
  "Expected hint playback opacity/submission lock and rewrite cancellation", handwritingBoundaries);

  await page.evaluate(() => render());
  await waitForWriter(page);
  await page.waitForFunction(() => !peekInk.disabled && peekEl && peekEl.querySelector("path"));
  const peekBoundary = await page.evaluate(() => {
    const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const pointer = (type, id, primary, x, y, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: primary, button: 0, buttons, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y });
    const pixels = () => { const data = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1; return count; };
    clearInk(); activePointers.clear(); peekReleasePending = false; tracing = false; revealed = false; animating = false; tuning.peekHintUsed = false; saveTuning();
    const before = { ever: hintEverUsed, used: hintsUsedThisCard, group: groupIdx, shown: shownStrokes };
    const peekRect = peekInk.getBoundingClientRect();
    const controlPointer = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 81050, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: peekRect.left + 20, clientY: peekRect.top + 20 });
    peekInk.dispatchEvent(controlPointer("pointerdown", 1));
    const controlEntered = peeking && peekEl.classList.contains("active") && peekEl.querySelectorAll("path").length > 0 && Number(canvas.style.opacity) <= 0.06;
    const consumedOnUse = tuning.peekHintUsed === true;
    peekInk.dispatchEvent(controlPointer("pointerup", 0));
    const controlRestored = !peeking && !peekEl.classList.contains("active") && Number(canvas.style.opacity) === 1;
    const uncounted = before.ever === hintEverUsed && before.used === hintsUsedThisCard && before.group === groupIdx && before.shown === shownStrokes;
    canvas.dispatchEvent(pointer("pointerdown", 81051, true, 0.2, 0.25, 1));
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.45, 0.5, 1));
    const partial = pixels();
    canvas.dispatchEvent(pointer("pointerdown", 81052, false, 0.75, 0.7, 1));
    const entered = peeking && Number(canvas.style.opacity) <= 0.06 && hzEl.classList.contains("peekHint");
    const cancelled = partial > 0 && !drawing && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.65, 0.65, 1));
    canvas.dispatchEvent(pointer("pointermove", 81052, false, 0.8, 0.8, 1));
    const blocked = inkStrokes.length === 0 && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointerup", 81052, false, 0.8, 0.8, 0));
    const restoredOnAnyLift = !peeking && peekReleasePending && Number(canvas.style.opacity) === 1 && !hzEl.classList.contains("peekHint");
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.72, 0.72, 1));
    const releaseBlocked = !drawing && inkStrokes.length === 0 && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointerup", 81051, true, 0.72, 0.72, 0));
    const ended = !peekReleasePending && activePointers.size === 0;
    canvas.dispatchEvent(pointer("pointerdown", 81053, true, 0.25, 0.25, 1));
    canvas.dispatchEvent(pointer("pointermove", 81053, true, 0.55, 0.55, 1));
    canvas.dispatchEvent(pointer("pointerup", 81053, true, 0.55, 0.55, 0));
    const nextGestureWrites = inkStrokes.length === 1 && pixels() > 0;
    clearInk(); resetPeekHint(); actionCooldownUntil = 0;
    return { controlEntered, consumedOnUse, controlRestored, uncounted, entered, cancelled, blocked, restoredOnAnyLift, releaseBlocked, ended, nextGestureWrites };
  });
  assert(Object.values(peekBoundary).every(Boolean), "Expected complete two-finger peek lifecycle without leaked ink", peekBoundary);

  const firstTarget = await page.evaluate(() => cur.target);

  await page.evaluate(async () => {
    shownStrokes = 1; groupIdx = 1; hintEverUsed = true; hintsUsedThisCard = 1;
    inkStrokes = [mediansToCanvas(curMedians)[1]]; redrawInk();
    await rebuildHintLayer(1); saveSessionSnapshot();
    restoreSession(load(SESSION_KEY, null));
  });
  await page.waitForFunction(() => pendingSessionVisual === null && Array.isArray(curMedians) && curMedians.length > 0 && !animating);
  const recalledVisual = await page.evaluate(() => ({ phase: practicePhase, hints: shownStrokes, hintNodes: hzEl.childNodes.length, ink: inkStrokes.length, history: hintEverUsed }));
  assert(recalledVisual.phase === "recall" && recalledVisual.hints === 1 && recalledVisual.hintNodes > 0 && recalledVisual.ink === 1 && recalledVisual.history, "Expected recall ink and visible hints to survive session restore", recalledVisual);

  await submitStandard(page, { hintStrokes: 1 });
  const snapshot = await page.evaluate(() => ({
    label: document.querySelector(".cmpLbl").textContent,
    hintIds: submissionSnapshot.hintStrokeIds.length,
    hintGeometry: submissionSnapshot.hintStrokes.length,
    ink: submissionSnapshot.inkStrokes.length,
    composite: submissionSnapshot.compositeGeometry.length,
    verdict: submissionSnapshot.lastVerdict && submissionSnapshot.lastVerdict.status,
    hintEverUsed: submissionSnapshot.hintEverUsed,
    image: submissionSnapshot.compositeImage && submissionSnapshot.compositeImage.startsWith("data:image/png"),
    effect: correctEffect.textContent,
  }));
  assert(snapshot.label === "你写的" && snapshot.hintIds === 1 && snapshot.hintGeometry === 1 && snapshot.composite === snapshot.hintGeometry + snapshot.ink && snapshot.verdict === "ok" && snapshot.hintEverUsed && snapshot.image, "Expected one immutable complete-grid submission snapshot", snapshot);
  assert(snapshot.effect.includes("已用提示"), "Expected correct action to explain reinforcement consequence", snapshot.effect);

  await chooseCorrect(page);
  await page.waitForTimeout(450);
  const hold = await page.evaluate(() => { const stored=load(SESSION_KEY,null); return { sameTarget: cur.target, feedback: stampedToast.textContent, outcome: roundStats[0] && roundStats[0].outcome, ratings: fsrsReviewLog.map((event) => event.rating), unresolved: [...unresolved], sessionHasUndo:Object.prototype.hasOwnProperty.call(stored||{},"lastStampSnapshot"),sessionHasHandwriting:(stored&&stored.roundStats||[]).some(row=>Object.prototype.hasOwnProperty.call(row,"handwriting")),stampSnapshotHasHandwriting:((stored&&stored.lastStampSnapshot&&stored.lastStampSnapshot.roundStatsValue)||[]).some(row=>Object.prototype.hasOwnProperty.call(row,"handwriting")) }; });
  assert(hold.sameTarget === firstTarget && hold.feedback.includes("本组稍后再写") && hold.outcome === "hinted" && hold.ratings.join() === "Again" && hold.unresolved.length === 1 && hold.sessionHasUndo && !hold.sessionHasHandwriting && !hold.stampSnapshotHasHandwriting, "Expected hinted feedback with one Again, a restorable undo, and no handwriting in the session payload", hold);

  await page.click("#editStamp");
  const rollback = await page.evaluate(() => ({ phase: practicePhase, events: fsrsReviewLog.length, stats: roundStats.length, attempts: dailyActivity().attempts, stamps: dailyActivity().stamps, queue: reinforcementQueue.length, unresolved: unresolved.size, image: submissionSnapshot.compositeImage }));
  assert(rollback.phase === "revealDecision" && rollback.events === 0 && rollback.stats === 0 && rollback.attempts === 0 && rollback.stamps === 0 && rollback.queue === 0 && rollback.unresolved === 0 && rollback.image, "Expected atomic edit rollback", rollback);

  await chooseCorrect(page);
  await page.evaluate(() => {
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await waitForWriter(page);
  const afterHint = await page.evaluate(() => ({ baseCursor, attemptSeq, unresolved: [...unresolved], queue: cloneObj(reinforcementQueue), target: cur.target }));
  assert(afterHint.baseCursor === 1 && afterHint.attemptSeq === 1 && afterHint.unresolved.length === 1 && afterHint.queue[0].eligibleAfter === 3 && afterHint.target !== firstTarget, "Expected feedback click to advance immediately while a double click cannot cross two cards", afterHint);

  const undoLayout = await page.evaluate(() => {
    resetWritingChrome(); renderUndoBar();
    const snapshot = lastStampSnapshot; const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const beforeTop = boxwrap.getBoundingClientRect().top; const style = getComputedStyle(undoBar), header = document.querySelector(".chdr");
    const headerVisible = getComputedStyle(header).visibility === "visible" && card.classList.contains("undoActive");
    const pointer = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 82001, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: rect.left + 30, clientY: rect.top + 30 });
    canvas.dispatchEvent(pointer("pointerdown", 1)); canvas.dispatchEvent(pointer("pointerup", 0));
    const hiddenOnWrite = getComputedStyle(undoBar).display === "none" && getComputedStyle(header).visibility === "visible" && !card.classList.contains("undoActive");
    const afterTop = boxwrap.getBoundingClientRect().top;
    clearInk(); resetWritingChrome(); actionCooldownUntil = 0; lastStampSnapshot = snapshot; renderUndoBar();
    const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    const noOverlap = bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right;
    return { position: style.position, headerVisible, hiddenOnWrite, shift: Math.abs(afterTop - beforeTop), restored: getComputedStyle(undoBar).display !== "none" && getComputedStyle(header).visibility === "visible", noOverlap };
  });
  await page.setViewportSize({ width: 390, height: 620 });
  const undoShortLayout = await page.evaluate(() => {
    renderUndoBar(); const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    return { visible: getComputedStyle(undoBar).display !== "none", noOverlap: bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right, top: bar.top, bottom: bar.bottom };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(undoLayout.position === "relative" && undoLayout.headerVisible && undoLayout.hiddenOnWrite && undoLayout.shift > 0 && undoLayout.restored && undoLayout.noOverlap && undoShortLayout.visible && undoShortLayout.noOverlap, "Expected the cross-card undo bar to keep the return header visible and avoid overlap on short screens", { undoLayout, undoShortLayout });

  for (let i = 0; i < 2; i += 1) {
    await submitStandard(page);
    await chooseCorrect(page);
    await page.waitForTimeout(1900);
  }
  const reinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, baseCursor, attemptSeq, unresolved: [...unresolved], progress: posLabel.textContent, targets: baseTargets.slice(), stats: roundStats.map((row) => row.idx) }));
  assert(reinforcement.target === firstTarget && reinforcement.kind === "reinforcement" && reinforcement.baseCursor === 3 && reinforcement.attemptSeq === 3 && reinforcement.progress === "另有 1 个字要再练", "Expected two-card spacing and plain-language reinforcement progress", reinforcement);

  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await waitForWriter(page);
  const restoredReinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, phase: practicePhase, unresolved: unresolved.size, noUndo:lastStampSnapshot===null&&getComputedStyle(undoBar).display==="none" }));
  assert(restoredReinforcement.target === firstTarget && restoredReinforcement.kind === "reinforcement" && restoredReinforcement.phase === "reinforcement" && restoredReinforcement.unresolved === 1 && restoredReinforcement.noUndo, "Expected reinforcement state, but not the five-second undo window, to survive session restore", restoredReinforcement);

  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  const completed = await page.evaluate(() => ({
    summary: getComputedStyle(summary).display !== "none",
    stats: cloneObj(roundStats),
    handwriting: cloneObj(roundHandwriting),
    log: cloneObj(fsrsReviewLog),
    activity: cloneObj(dailyActivity()),
    groups: dailyActivity().completedGroups,
    session: localStorage.getItem(SESSION_KEY),
    tomorrow: shiftDay(today(), 1),
    memory: cloneObj(memory),
    restLine: summaryRestLine.textContent,
    restKnown: REST_LINES.includes(summaryRestLine.textContent),
    ambient: { scene: ambientScene, stops: ambientDebug.stops },
  }));
  assert(completed.summary && completed.stats.length === 3 && completed.stats[0].outcome === "hinted" && completed.stats[0].independentlyRecovered && completed.stats.every((row) => !Object.prototype.hasOwnProperty.call(row,"handwriting")) && Object.values(completed.handwriting).some((strokes) => strokes.length) && Object.values(completed.handwriting).flat().every((stroke) => stroke.length <= 48), "Expected compact user ink to remain in memory without bloating persisted round stats", completed);
  assert(completed.log.map((event) => event.rating).join() === "Again,Good,Good,Good" && completed.log.every((event) => !["Hard", "Easy"].includes(event.rating)), "Expected Again/Good-only FSRS events", completed.log);
  assert(completed.activity.stamps === 0 && completed.activity.attempts === 0 && completed.groups === 0 && completed.session === null, "Expected a completed focus drill to update memory without counting as the day's completed group", completed.activity);
  assert(Object.values(completed.memory).every((item) => !item.pendingLearning && item.dueDay >= completed.tomorrow && item.schedulerVersion.includes("FSRS-6.0")), "Expected graduated cards to expose next-day-or-later dueDay", completed.memory);
  assert(completed.restKnown && completed.restLine.length > 0 && completed.ambient.scene === "off" && completed.ambient.stops >= 1, "Expected one fixed-library closing line and soundscape fade on summary", completed);

  const summaryEntry = await page.evaluate(() => ({ visible: getComputedStyle(summaryProfile).display !== "none", label: summaryProfile.textContent.trim() }));
  assert(summaryEntry.visible && summaryEntry.label.includes("看看写得不稳的字"), "Expected a hard-result summary to expose Profile", summaryEntry);
  const sharePaths = await page.evaluate(async () => {
    const messages = [], downloads = [], shared = [];
    const canvas = renderPracticeCardCanvas(), native = await sharePracticeCard({ nativeBridge: { postMessage: (message) => messages.push(message) } });
    const web = await sharePracticeCard({ nativeBridge: null, navigator: { canShare: ({ files }) => files.length === 1 && files[0].type === "image/png", share: async (payload) => shared.push(payload) } });
    const download = await sharePracticeCard({ nativeBridge: null, navigator: {}, download: (blob, name) => downloads.push({ size: blob.size, name }) });
    const rendererSource = `${renderPracticeCardCanvas}\n${drawShareHandwriting}`;
    const imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; let minAlpha = 255; for (let i = 3; i < imageData.length; i += 4) minAlpha = Math.min(minAlpha, imageData[i]);
    return { canvas: canvas && { width: canvas.width, height: canvas.height, png: canvas.toDataURL("image/png").startsWith("data:image/png;base64,"), pixels: canvas.toDataURL("image/png").length, inkStrokes: Number(canvas.dataset.inkStrokeCount), minAlpha }, native, web, download, messageKeys: messages[0] && Object.keys(messages[0]).sort(), messageType: messages[0] && messages[0].type, messageKind: messages[0] && messages[0].kind, messagePNG: messages[0] && messages[0].dataURL.startsWith("data:image/png;base64,"), shared: shared.length, downloaded: downloads[0], privateFree: !/localStorage|memory|activity|backup|seenStat|riskStat/.test(rendererSource), printedTargetFree: !/fillText\s*\(\s*stat\.target/.test(rendererSource), shareVisible: getComputedStyle(summaryShare).display !== "none", shareLabel: summaryShare.textContent.trim() };
  });
  assert(sharePaths.canvas.width === 1080 && sharePaths.canvas.height === 1440 && sharePaths.canvas.png && sharePaths.canvas.pixels > 10000 && sharePaths.canvas.inkStrokes > 0 && sharePaths.canvas.minAlpha === 255 && sharePaths.native.route === "native" && sharePaths.web.route === "share" && sharePaths.download.route === "download"
    && sharePaths.messageKeys.join() === "dataURL,kind,name,type" && sharePaths.messageType === "sharePracticeCard" && sharePaths.messageKind === "round" && sharePaths.messagePNG && sharePaths.shared === 1 && sharePaths.downloaded.size > 1000 && sharePaths.downloaded.name.endsWith(".png") && sharePaths.privateFree && sharePaths.printedTargetFree && sharePaths.shareVisible && sharePaths.shareLabel.includes("存为"),
  "Expected a private-free user-ink PNG card and native, Web Share, and download delivery paths", sharePaths);
  const expandedShareCard = await page.evaluate(() => {
    const savedStats = cloneObj(roundStats), savedHandwriting=cloneObj(roundHandwriting), originalFillText = CanvasRenderingContext2D.prototype.fillText, labels = [];
    try {
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { labels.push(String(text)); return originalFillText.call(this, text, ...args); };
      roundStats = Array.from({ length: 16 }, (_, idx) => ({ idx, target: CARDS[idx].target, outcome: idx % 3 === 0 ? "hinted" : "fast", independentlyRecovered: false }));
      roundHandwriting=Object.fromEntries(roundStats.map(({idx})=>[String(idx),[[{ x: .12 + idx * .002, y: .18 }, { x: .82, y: .78 - idx * .002 }]]]));
      const canvas = renderPracticeCardCanvas(), rendererSource = `${renderPracticeCardCanvas}`;
      return { width: canvas.width, height: canvas.height, items: Number(canvas.dataset.itemCount), inkStrokes: Number(canvas.dataset.inkStrokeCount), labels,
        png: canvas.toDataURL("image/png").startsWith("data:image/png;base64,"), noFifteenItemCutoff: !/slice\(0,\s*15\)/.test(rendererSource) };
    } finally {
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
      roundStats = savedStats; roundHandwriting=savedHandwriting;
    }
  });
  assert(expandedShareCard.width === 1080 && expandedShareCard.height === 1618 && expandedShareCard.items === 16 && expandedShareCard.inkStrokes === 16 && expandedShareCard.labels.includes("本组 16 个字") && expandedShareCard.png && expandedShareCard.noFifteenItemCutoff,
    "Expected an expanded practice card to render every item and handwriting stroke beyond the standard 15-character group", expandedShareCard);
  await page.click("#summaryProfile");
  await page.waitForFunction(() => getComputedStyle(profilePanel).display !== "none");
  await page.click("#closeProfile");
  assert(await page.evaluate(() => getComputedStyle(summary).display !== "none" && getComputedStyle(sumSheet).display !== "none"), "Expected Profile to return to its Summary source");

  const summaryLayer = await page.evaluate(() => ({
    targets: Array.from(document.querySelectorAll("#sumTiles .sumTile[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    tiles: document.querySelectorAll("#sumTiles .sumTile[data-idx]").length,
    lead: sumLead.textContent.replace(/\s+/g, ""),
    meanings: Array.from(document.querySelectorAll("#sumTiles .sumTile .meaning")).map((node) => ({ text: node.textContent, visible: getComputedStyle(node).display !== "none", size: parseFloat(getComputedStyle(node).fontSize) })),
    milestoneEvents: hapticDebug.events.slice(-3),
  }));
  await page.click("#stop");
  await page.waitForFunction(() => getComputedStyle(home).display !== "none");
  const homeLayer = await page.evaluate(() => ({
    title: homeTitle.textContent.replace(/\s+/g, ""),
    label: yesterLbl.textContent,
    targets: Array.from(document.querySelectorAll("#yesterRow .yTile:not(.more)")).map((node) => node.textContent.trim()).filter(Boolean).sort(),
    completed: todayCompleted(),
  }));
  await page.click("#tabBook");
  await page.waitForFunction(() => getComputedStyle(studybook).display !== "none");
  const bookLayer = await page.evaluate(() => ({
    count: boxCount.textContent.replace(/\s+/g, ""),
    targets: Array.from(document.querySelectorAll("#memoryWall .memoryChar[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    active: tabBook.classList.contains("active"),
  }));
  assert(summaryLayer.tiles === 3 && summaryLayer.lead.includes("3") && summaryLayer.meanings.length === 3 && summaryLayer.meanings.every((item) => item.visible && item.text.length >= 2 && item.size >= 13)
    && homeLayer.title.includes("今天拾十五个字") && homeLayer.label === "今日一字" && !homeLayer.completed && homeLayer.targets.length === 0 && bookLayer.count === "3字" && bookLayer.active
    && summaryLayer.targets.every((target) => bookLayer.targets.includes(target)),
  "Expected focus results in Summary and the study book without claiming the day's completed group on Home", { summaryLayer, homeLayer, bookLayer });

  await page.evaluate(() => { displayView("summary"); renderPracticePocket(summaryFocusIndexes, false); });
  const pocketBefore = await page.evaluate(() => ({ visible: getComputedStyle(pocketCard).display === "flex", indexes: summaryFocusIndexes.slice(), chips: Array.from(pocketChips.children).map((node) => node.textContent), title: pocketTitle.textContent, note: pocketCard.querySelector(".ptxt span").textContent, action: pocketBtn.textContent }));
  assert(pocketBefore.visible && pocketBefore.indexes.length === 1 && pocketBefore.chips.length === 1 && pocketBefore.title.includes("第一次没写稳") && pocketBefore.note.includes("想巩固一下") && pocketBefore.action === "再写一遍" && !pocketBefore.title.includes("还要再练"), "Expected an optional, historically worded practice pocket with the weak target", pocketBefore);
  await page.click("#pocketBtn");
  await page.waitForFunction(() => activeMode === "focus" && getComputedStyle(card).display !== "none");
  const pocketPractice = await page.evaluate(() => ({ mode: activeMode, target: cur.target, expected: CARDS[summaryFocusIndexes[0]].target, batch: baseTargets.slice() }));
  assert(pocketPractice.mode === "focus" && pocketPractice.target === pocketPractice.expected && pocketPractice.batch.length === 1, "Expected the pocket action to enter focused practice for the weak target", pocketPractice);

  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); traceTutorialShown = false; save(TRACE_TUTORIAL_KEY, false); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  await page.evaluate(() => { episodeFor(currentCardIndex()).teachingComplete = true; hapticDebug.events = []; hapticDebug.last = null; });
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing");
  await page.waitForFunction(() => hzEl.classList.contains("traceFallback") || Array.from(hzEl.querySelectorAll("svg path")).some((node) => { const box=node.getBoundingClientRect(); return box.width>0 && box.height>0; }));
  const dontKnow = await page.evaluate(() => { declareDontKnow(); return ({
    phase: practicePhase, outcome: roundStats[0].outcome,
    ratings: fsrsReviewLog.slice(-1).map((event) => `${event.rating}:${event.reason}:${event.teaching}`),
    revealHidden: getComputedStyle(reveal).display === "none", stampHidden: getComputedStyle(stampedToast).display === "none",
    title: phaseTitle.textContent, intro: getComputedStyle(traceIntro).display !== "none", introCopy: traceIntro.textContent,
    traceTools: Array.from(document.querySelectorAll("#inkTools button, #traceActions button")).filter((node) => getComputedStyle(node).display !== "none").map((node) => node.textContent.replace(/\s+/g, "")),
    noRecallTools: getComputedStyle(tip).display === "none" && getComputedStyle(show).display === "none",
    outlinePaths: Array.from(hzEl.querySelectorAll("svg path")).filter((node) => { const box=node.getBoundingClientRect(), style=getComputedStyle(node); return box.width>0 && box.height>0 && style.display!=="none" && style.visibility!=="hidden"; }).length,
    outlineBox: (()=>{ const svg=hzEl.querySelector("svg"); if(!svg) return null; const box=svg.getBoundingClientRect(); return {width:Math.round(box.width),height:Math.round(box.height)}; })(),
    fallback: hzEl.classList.contains("traceFallback") && hzEl.textContent.trim() === cur.target,
    haptics: hapticDebug.events.slice(), shown: traceTutorialShown, attempts: episodeFor(currentCardIndex()).attempts.length, unresolved: unresolved.size,
  }); });
  assert(dontKnow.phase === "tracing" && dontKnow.outcome === "miss" && dontKnow.ratings.join() === "Again:dontKnow:true" && dontKnow.revealHidden && dontKnow.stampHidden
    && dontKnow.title.includes("第 1 步：描红") && dontKnow.intro && dontKnow.introCopy.includes("轮廓隐藏后") && dontKnow.noRecallTools
    && (dontKnow.outlinePaths>0 || dontKnow.fallback) && (!dontKnow.outlineBox || (dontKnow.outlineBox.width>200 && dontKnow.outlineBox.height>200))
    && dontKnow.haptics.join() === "select" && !dontKnow.shown && dontKnow.attempts === 1 && dontKnow.unresolved === 1,
  "Expected don't-know to enter non-blocking tracing immediately with one miss/Again", dontKnow);
  await page.evaluate(() => { soundDebug.events = []; soundDebug.last = null; lastPaperSoundAt = 0; inkBegin({ x: 20, y: 20 }); inkMove({ x: 80, y: 80 }); inkEnd(); });
  await page.waitForTimeout(230);
  const traceStart = await page.evaluate(() => ({ title: phaseTitle.textContent, disabled: traceDone.disabled, introHidden: getComputedStyle(traceIntro).display === "none", shown: traceTutorialShown, stored: load(TRACE_TUTORIAL_KEY, false), sound: soundDebug.events.slice(), writing:card.classList.contains("writing"), chrome:Number(getComputedStyle(phaseTitle).opacity) }));
  assert(traceStart.title.includes("第 1 步：描红") && !traceStart.disabled && traceStart.introHidden && traceStart.shown && traceStart.stored && traceStart.sound.join() === "paper" && traceStart.writing && traceStart.chrome === 0,
    "Expected tracing to share stove mode while dismissing the explanation and emitting only the quiet paper-start sound", traceStart);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "tracing" && tracedThisCard && inkStrokes.length === 1);
  const restoredTracing = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, outline: hzEl.childNodes.length > 0 || hzEl.classList.contains("traceFallback"), ink: inkStrokes.length }));
  assert(restoredTracing.phase === "tracing" && restoredTracing.title.includes("第 1 步：描红") && restoredTracing.outline && restoredTracing.ink === 1, "Expected tracing ink and outline to survive session restore", restoredTracing);
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await page.click("#traceDone");
  const postTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled, tipDisplay: getComputedStyle(tip).display, show: show.textContent, clear: clear.textContent, haptics: hapticDebug.events.slice() }));
  assert(postTrace.phase === "postTraceRecall" && postTrace.title.includes("第 2 步：自己写") && postTrace.ink === 0 && !postTrace.hintLayer && !postTrace.fallback && postTrace.tipDisabled && postTrace.tipDisplay === "none" && postTrace.show === "再描一遍" && postTrace.clear === "重写" && postTrace.haptics.length === 0, "Expected outline-free step-two recall with only its own final-named tools", postTrace);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "postTraceRecall");
  const restoredPostTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled }));
  assert(restoredPostTrace.phase === "postTraceRecall" && restoredPostTrace.title.includes("第 2 步：自己写") && restoredPostTrace.ink === 0 && !restoredPostTrace.hintLayer && !restoredPostTrace.fallback && restoredPostTrace.tipDisabled, "Expected post-trace recall to restore without teaching geometry", restoredPostTrace);

  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await submitStandard(page);
  await page.click("#decisionWrong");
  await page.waitForFunction(() => practicePhase === "tracing");
  const teachingWrong = await page.evaluate(() => ({ events: fsrsReviewLog.filter((event) => event.attemptId === currentAttemptId).length, attempts: episodeFor(currentCardIndex()).attempts.length, haptics: hapticDebug.events.slice() }));
  assert(teachingWrong.events === 1 && teachingWrong.attempts === 1 && teachingWrong.haptics.join() === "action", "Expected teaching retry not to create another review or stamp haptic", teachingWrong);
  await page.evaluate(() => { inkStrokes = [mediansToCanvas(curMedians)[0]]; tracedThisCard = true; redrawInk(); updateInkControls(); });
  await page.click("#traceDone");
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await submitStandard(page);
  await page.click("#decisionCorrect");
  const teachingDecisionHaptics = await page.evaluate(() => hapticDebug.events.slice());
  assert(teachingDecisionHaptics.join() === "action", "Expected post-trace success to emit action only, never action plus stamp", teachingDecisionHaptics);
  await page.waitForTimeout(1900);
  const afterTeaching = await page.evaluate(() => ({ kind: currentAttemptKind, phase: practicePhase, ratings: fsrsReviewLog.slice(-1).map((event) => event.rating), teachingComplete: Object.values(episodes)[0].teachingComplete, unresolved: unresolved.size }));
  assert(afterTeaching.kind === "reinforcement" && afterTeaching.phase === "reinforcement" && afterTeaching.ratings.join() === "Again" && afterTeaching.teachingComplete && afterTeaching.unresolved === 1, "Expected post-trace success to remain unresolved without Good", afterTeaching);
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  const teachingDone = await page.evaluate(() => ({ ratings: fsrsReviewLog.slice(-2).map((event) => event.rating), stat: roundStats[0], tutorialStored: load(TRACE_TUTORIAL_KEY, false), summary: getComputedStyle(summary).display !== "none" }));
  assert(teachingDone.ratings.join() === "Again,Good" && teachingDone.stat.outcome === "miss" && teachingDone.stat.traced && teachingDone.stat.independentlyRecovered && teachingDone.tutorialStored && teachingDone.summary, "Expected later independent recovery to graduate the don't-know episode", teachingDone);

  await page.evaluate(() => { clearSessionSnapshot(); startFocus([CARDS.findIndex((card) => card.target === "疑"), CARDS.findIndex((card) => card.target === "衡")]); });
  await waitForWriter(page);
  await page.evaluate(() => { shownStrokes = 1; groupIdx = 1; hintEverUsed = true; hintsUsedThisCard = 1; inkStrokes = mediansToCanvas(curMedians.slice(1)); redrawInk(); revealAnswer(); const s = load(SESSION_KEY, null); s.startedDate = shiftDay(today(), -1); save(SESSION_KEY, s); });
  const frozenBefore = await page.evaluate(() => JSON.stringify(submissionSnapshot));
  const stableSession = await page.evaluate(() => { const s=load(SESSION_KEY,null); return { version:s.version,baseTargetKeys:s.baseTargetKeys,currentCardKey:s.currentCardKey,numericTargets:"baseTargets" in s||"currentIndex" in s,visualNumeric:!!(s.visual&&("currentIndex" in s.visual||(s.visual.submissionSnapshot&&"idx" in s.visual.submissionSnapshot))),visualKey:s.visual&&s.visual.submissionSnapshot&&s.visual.submissionSnapshot.cardKey }; });
  assert(stableSession.version === 3 && stableSession.baseTargetKeys.every((key) => typeof key === "string") && stableSession.currentCardKey === stableSession.baseTargetKeys[0] && !stableSession.numericTargets && !stableSession.visualNumeric && stableSession.visualKey === stableSession.currentCardKey,
    "Expected session v3 to persist only stable card keys, including the visual snapshot", stableSession);
  await page.reload({ waitUntil: "networkidle" });
  const resumable = await page.evaluate(() => resumableSession());
  assert(resumable && resumable.version === 3 && resumable.startedDate !== await page.evaluate(() => today()), "Expected cross-midnight stable-key session to remain resumable", resumable);
  await page.evaluate((session) => restoreSession(session), resumable);
  await page.waitForFunction(() => getComputedStyle(reveal).display !== "none" && submissionSnapshot);
  const restored = await page.evaluate(() => ({ frozen: JSON.stringify(submissionSnapshot), phase: practicePhase, hintEverUsed, eventCount: fsrsReviewLog.length, history: history.state && history.state.shiziView }));
  assert(restored.frozen === frozenBefore && restored.phase === "revealDecision" && restored.hintEverUsed && restored.history === "practice", "Expected exact reveal snapshot and practice history restoration", restored);

  const historyStart = await page.evaluate(() => ({ length: history.length, state: history.state && history.state.shiziView }));
  await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value){ if(key === SESSION_KEY) throw new Error("verify quota"); return window.__originalSetItem.call(this, key, value); }; });
  await page.click("#exitPractice");
  const failedExit = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), message: document.getElementById("toast").textContent, armed: practiceHistoryArmed }));
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; delete window.__originalSetItem; });
  assert(failedExit.card && failedExit.phase === "revealDecision" && failedExit.frozen === frozenBefore && failedExit.message.includes("进度暂时无法保存") && failedExit.armed, "Expected persistence failure to keep the exact practice state with a retry message", failedExit);

  await page.evaluate(() => openAddSheet());
  await page.waitForFunction(() => addSheet.classList.contains("open"));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !addSheet.classList.contains("open") && history.state && history.state.shiziView === "practice");
  const panelBack = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), length: history.length }));
  assert(panelBack.card && panelBack.phase === "revealDecision" && panelBack.frozen === frozenBefore && panelBack.length === historyStart.length, "Expected back to close the add-character panel before leaving practice", panelBack);

  await page.evaluate(() => roundBudgetSheet.classList.add("open"));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !roundBudgetSheet.classList.contains("open") && history.state && history.state.shiziView === "practice");
  const budgetBack = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", armed: practiceHistoryArmed, length: history.length }));
  assert(budgetBack.card && budgetBack.armed && budgetBack.length === historyStart.length, "Expected back to close the rhythm guard without disarming practice history", budgetBack);

  const directReturns = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate((nativeEvent) => nativeEvent ? window.dispatchEvent(new Event("shizi-native-back")) : history.back(), attempt === 0);
    await page.waitForFunction(() => getComputedStyle(home).display !== "none" && !practiceHistoryArmed && history.state && history.state.shiziView === "home");
    directReturns.push(await page.evaluate((nativeEvent) => ({ nativeEvent, session: load(SESSION_KEY, null), history: history.state && history.state.shiziView, length: history.length, toast: document.getElementById("toast").textContent }), attempt === 0));
    if (attempt < 2) {
      await page.click("#startBtn");
      await page.waitForFunction(() => getComputedStyle(reveal).display !== "none" && practiceHistoryArmed);
      const resumedAgain = await page.evaluate(() => ({ phase: practicePhase, frozen: JSON.stringify(submissionSnapshot) }));
      assert(resumedAgain.phase === "revealDecision" && resumedAgain.frozen === frozenBefore, "Expected direct return to resume the same reveal state", resumedAgain);
    }
  }
  const exited = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", session: load(SESSION_KEY, null), armed: practiceHistoryArmed, history: history.state && history.state.shiziView, length: history.length }));
  await page.evaluate(() => history.back());
  await page.waitForTimeout(100);
  const homeBack = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", armed: practiceHistoryArmed, history: history.state && history.state.shiziView, length: history.length }));
  assert(directReturns[0].nativeEvent && directReturns.every((row) => row.session && row.session.version === 3 && row.history === "home" && row.length === historyStart.length && !row.toast.includes("进度已保存"))
    && exited.home && exited.session && exited.session.version === 3 && !exited.armed && exited.history === "home" && exited.length === historyStart.length
    && homeBack.home && !homeBack.armed && homeBack.history === "home" && homeBack.length === historyStart.length,
  "Expected repeated direct returns to save v3 stable-key state without dialogs, toasts, or history growth", { exited, directReturns, homeBack });

  const collections = await page.evaluate(async () => {
    const saved = {
      activity: cloneObj(activity), memory: cloneObj(memory), fsrs: cloneObj(fsrsReviewLog), session: localStorage.getItem(SESSION_KEY),
      activeMode, makeupTargetDay, baseTargets: baseTargets.slice(), baseCursor, currentIndex, currentAttemptKind, currentAttemptId, practicePhase,
      manualQueue: cloneObj(manualQueue), reinforcementQueue: cloneObj(reinforcementQueue), unresolved: [...unresolved], episodes: cloneObj(episodes), roundStats: cloneObj(roundStats), roundId,
    };
    clearSessionSnapshot();
    const targets = uniqueCardIndexes(allIndexes().filter((idx) => qualityAvailable(idx) && !CARDS[idx].custom)).slice(0, 5);
    const normalDay = shiftDay(today(), -1), makeupDay = shiftDay(today(), -2), untouchedDay = shiftDay(today(), -3), annualDayA = shiftDay(today(), -40), annualDayB = shiftDay(today(), -41), currentMonth = today().slice(0, 7);
    activity = normalizeActivity({ version: 1, migrationDate: today(), inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [annualDayB, annualDayA, normalDay, today()], daily: {} });
    [annualDayA, annualDayB].forEach((day, order) => { const row = dailyActivity(day); row.stamps = 1; row.attempts = 1; row.targetKeys = [cardKey(targets[order + 1])]; row.independentTargetKeys = row.targetKeys.slice(); row.lastStampAt = dayStartMs(day) + 20 * 3600000; });
    const normal = dailyActivity(normalDay); normal.stamps = 1; normal.attempts = 1; normal.targetKeys = [cardKey(targets[0])]; normal.independentTargetKeys = [cardKey(targets[0])]; normal.lastStampAt = dayStartMs(normalDay) + 20 * 3600000;
    const current = dailyActivity(today()); current.stamps = targets.length; current.attempts = targets.length; current.targetKeys = targets.map(cardKey); current.independentTargetKeys = targets.slice(0, 3).map(cardKey); current.lastStampAt = Date.now(); saveActivity();

    calendarAnimatedMonths.clear(); openCalendar(currentMonth);
    const before = {
      normal: calendarGrid.querySelector(`[data-day="${normalDay}"]`)?.textContent || "",
      makeupBlank: !!calendarGrid.querySelector(`[data-day="${makeupDay}"][data-makeup]`),
      untouchedBlank: !!calendarGrid.querySelector(`[data-day="${untouchedDay}"][data-makeup]`),
      month: calendarMonthTitle.textContent, stat: calendarMonthStat.textContent, nextDisabled: calendarNext.disabled, gridHeight: calendarGrid.getBoundingClientRect().height,
    };

    activeMode = "makeup"; makeupTargetDay = makeupDay; focusQueue = targets.slice(); baseTargets = targets.slice(); batch = baseTargets; baseCursor = targets.length - 1; currentIndex = targets[targets.length - 1]; currentAttemptKind = "base"; currentAttemptId = "verify-makeup-incomplete"; practicePhase = "between"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = targets.slice(0, 4).map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true })); roundId = "verify-makeup-round";
    const incomplete = markRoundComplete(), blankStayedBlank = !activity.practiceDays.includes(makeupDay) && !dailyActivity(makeupDay).makeup;
    baseCursor = targets.length; roundStats = targets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true }));
    const completed = markRoundComplete(), completedAgain = markRoundComplete(), past = dailyActivity(makeupDay), makeupMarkers = past.completedRoundIds.filter((id) => id === "makeup:verify-makeup-round").length;

    calendarAnimatedMonths.delete(currentMonth); renderCalendar();
    const after = { makeup: calendarGrid.querySelector(`[data-day="${makeupDay}"]`)?.textContent || "", normal: calendarGrid.querySelector(`[data-day="${normalDay}"]`)?.textContent || "", practiceDays: monthPracticeDays(today()), markers: makeupMarkers };
    const originalMatchMedia = window.matchMedia; window.matchMedia = () => ({ matches: true }); calendarAnimatedMonths.delete(currentMonth); renderCalendar(); const reducedDirect = !calendarGrid.querySelector(".calendarStamp.land"); window.matchMedia = originalMatchMedia;
    calendarMonthKey = shiftMonth(currentMonth, -1); renderCalendar(); const previousMonth = { title: calendarMonthTitle.textContent, nextEnabled: !calendarNext.disabled }; calendarMonthKey = currentMonth;

    activeMode = "makeup"; makeupTargetDay = makeupDay; baseTargets = targets.slice(); batch = baseTargets; baseCursor = 2; currentIndex = targets[2]; currentAttemptKind = "base"; currentAttemptId = "verify-makeup-session"; practicePhase = "recall"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = targets.slice(0, 2).map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true })); roundId = "verify-makeup-session-round"; attemptSeq = 2; sessionDone = new Set(targets.slice(0, 2)); saveSessionSnapshot();
    const resume = resumableSession(), sessionOK = resume && resume.activeMode === "makeup" && resume.makeupTargetDay === makeupDay && resume.baseTargets.length === 5; clearSessionSnapshot();

    memory = {}; targets.forEach((idx, i) => { const m = cardMemory(idx); m.seen = 1; m.last = Date.now() - i * 1000; m.fast = 1; m.target = CARDS[idx].target; m.word = CARDS[idx].word; });
    const inkStored = persistRecentInk(cardMemory(targets[0]), [[{ x: .2, y: .2 }, { x: .5, y: .75 }, { x: .8, y: .25 }]], Date.now() + 100000);
    for (let i = 0; i < 110; i += 1) memory[`verify:ink:${i}`] = { seen: 0, recentInk: { version: 1, day: today(), at: Date.now() - i, dataURL: `data:image/webp;base64,${"A".repeat(5000)}` } };
    const trimmed = trimRecentInk(), inkRows = recentInkRows(), cap = { kept: inkRows.length, bytes: inkRows.reduce((sum, row) => sum + row.bytes, 0), removed: trimmed.removed, realKept: !!cardMemory(targets[0]).recentInk };
    saveMemory();

    const monthly = monthReportData(currentMonth), canvas = await renderMonthlyPostCanvas(currentMonth); let nativeMessage = null; const share = await shareMonthlyPost({ month: currentMonth, nativeBridge: { postMessage: (message) => { nativeMessage = message; } } });
    const annual = yearReportData(new Date().getFullYear()); renderAnnualReport(new Date().getFullYear()); const firstAnnualSlide = annualSlides.querySelector(".annualSlide"), annualUI = { slides: annualSlides.querySelectorAll(".annualSlide").length, copy: annualSlides.textContent.replace(/\s+/g, ""), clientHeight: annualSlides.clientHeight, scrollHeight: annualSlides.scrollHeight, firstHeight: firstAnnualSlide?.getBoundingClientRect().height || 0 };
    const backupActivity = JSON.parse(JSON.parse(backupPayload({ preserveMeta: true })).data[ACTIVITY_KEY]);
    const report = {
      before, incomplete, blankStayedBlank, completed, completedAgain, after, reducedDirect, previousMonth, sessionOK,
      makeup: { flag: past.makeup, targets: past.targetKeys.length, independent: past.independentTargetKeys.length, backup: backupActivity.daily[makeupDay]?.makeup === true },
      inkStored, cap, monthly: { practiced: monthly.practiced, stable: monthly.stable, independent: monthly.independentCount, days: monthly.practiceDays, hardest: monthly.hardest, width: canvas.width, height: canvas.height, items: Number(canvas.dataset.itemCount), inkTiles: Number(canvas.dataset.inkTiles) },
      share: { ...share, type: nativeMessage?.type, kind: nativeMessage?.kind, hasPNG: /^data:image\/png;base64,/.test(nativeMessage?.dataURL || "") }, annual: { ...annual, ...annualUI },
    };

    activity = normalizeActivity(saved.activity); saveActivity(); memory = saved.memory; saveMemory(); fsrsReviewLog = saved.fsrs; saveFSRSLog();
    if (saved.session === null) clearSessionSnapshot(); else localStorage.setItem(SESSION_KEY, saved.session);
    activeMode = saved.activeMode; makeupTargetDay = saved.makeupTargetDay; baseTargets = saved.baseTargets; batch = baseTargets; baseCursor = saved.baseCursor; currentIndex = saved.currentIndex; currentAttemptKind = saved.currentAttemptKind; currentAttemptId = saved.currentAttemptId; practicePhase = saved.practicePhase; manualQueue = saved.manualQueue || []; reinforcementQueue = saved.reinforcementQueue || []; unresolved = new Set(saved.unresolved || []); episodes = saved.episodes || {}; roundStats = saved.roundStats || []; roundId = saved.roundId; renderHome();
    return report;
  });
  assert(collections.before.normal.includes("拾") && collections.before.makeupBlank && collections.before.untouchedBlank && collections.before.stat.includes("盖章 2天 · 累计") && collections.before.nextDisabled && collections.before.gridHeight < 360 && collections.previousMonth.nextEnabled,
    "Expected normal/blank calendar states and cross-month navigation", collections);
  assert(!collections.incomplete && collections.blankStayedBlank && collections.completed && collections.completedAgain && collections.makeup.flag && collections.makeup.targets === 5 && collections.makeup.independent === 5 && collections.after.makeup.includes("补") && collections.after.normal.includes("拾") && collections.after.markers === 1 && collections.reducedDirect && collections.sessionOK,
    "Expected a resumable five-character makeup round to stamp exactly once only after completion", collections);
  assert(collections.makeup.backup && collections.inkStored && collections.cap.kept <= 96 && collections.cap.bytes <= 420 * 1024 && collections.cap.removed > 0 && collections.cap.realKept,
    "Expected makeup records in backup and bounded recent independent ink with oldest-first fallback", collections);
  assert(collections.monthly.width === 1080 && collections.monthly.height === 1440 && collections.monthly.practiced === collections.monthly.items && collections.monthly.stable >= 0 && collections.monthly.stable <= collections.monthly.practiced && collections.monthly.independent >= 3 && collections.monthly.independent <= collections.monthly.practiced && collections.monthly.days >= 3 && Number.isInteger(collections.monthly.hardest) && collections.monthly.inkTiles >= 1
    && collections.share.route === "native" && collections.share.type === "sharePracticeCard" && collections.share.kind === "monthly" && collections.share.hasPNG,
  "Expected a private 1080x1440 monthly post through the existing native share route", collections);
  assert(collections.annual.slides === 4 && collections.annual.keys.length >= 5 && collections.annual.busiest && Number.isInteger(collections.annual.rarest) && Number.isInteger(collections.annual.first) && collections.annual.clientHeight > 400 && Math.abs(collections.annual.firstHeight - collections.annual.clientHeight) < 2 && collections.annual.scrollHeight >= collections.annual.clientHeight * 3.9 && collections.annual.copy.includes("盖章天数最多的月份") && collections.annual.copy.includes("这个月盖章") && !collections.annual.copy.includes("练习天数最多的月份") && !collections.annual.copy.includes("击败") && !collections.annual.copy.includes("中断"),
    "Expected a four-screen local annual report without comparisons or break-loss language", collections);

  await page.setViewportSize({ width: 320, height: 568 });
  const compactCalendarStat = await page.evaluate(() => {
    const saved = { activity: cloneObj(activity), fontScaleLarge, month: calendarMonthKey };
    const days = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    activity = normalizeActivity({ version: 1, migrationDate: "2026-02-01", inheritedStreak: 0, inheritedTotalDays: 365, practiceDays: days, daily: Object.fromEntries(days.map((day, i) => [day, { stamps: 1, attempts: 1, targetKeys: [`compact:${i}`], completedRoundIds: [], lastStampAt: Date.now() }])) });
    calendarMonthKey = "2026-01";
    const inspect = () => {
      const range = document.createRange(); range.selectNodeContents(calendarMonthStat);
      const rect = calendarMonthStat.getBoundingClientRect(), head = calendarMonthStat.parentElement.getBoundingClientRect();
      return { copy: calendarMonthStat.textContent, aria: calendarMonthStat.getAttribute("aria-label"), lines: range.getClientRects().length, within: rect.left >= head.left && rect.right <= head.right };
    };
    fontScaleLarge = false; applyFontScale(); renderMe(); const standard = inspect();
    fontScaleLarge = true; applyFontScale(); renderCalendar(); const large = inspect();
    activity = normalizeActivity(saved.activity); calendarMonthKey = saved.month; fontScaleLarge = saved.fontScaleLarge; applyFontScale(); renderMe();
    return { standard, large, restoredAria: calendarMonthStat.getAttribute("aria-label") };
  });
  const accessibleCalendarStat = await page.getByRole("group", { name: compactCalendarStat.restoredAria, exact: true }).count();
  assert([compactCalendarStat.standard, compactCalendarStat.large].every((row) => row.copy === "盖章 31天 · 累计 365天" && row.aria === "盖章 31 天 · 累计练习 365 天" && row.lines === 1 && row.within) && accessibleCalendarStat === 1,
    "Expected compact visible calendar stats and complete accessible labels to fit one line at 320px in default and large text", compactCalendarStat);
  await page.evaluate(() => renderHome());
  await page.setViewportSize({ width: 390, height: 844 });

  await page.evaluate(() => {
    window.__wildVerifySaved = {
      memory: cloneObj(memory), status: cloneObj(status), wild: cloneObj(wildState),
      added: addedChars.slice(), custom: customWords.slice(), wildRaw: localStorage.getItem(WILD_KEY),
      webkit: window.webkit,
    };
    window.__wildBridgeMessages = [];
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { shiziNative: { postMessage: (message) => window.__wildBridgeMessages.push(cloneObj(message)) } } },
    });
    wildState = normalizeWildState(null);
    renderHome();
    openAddSheet();
  });
  await page.setInputFiles("#wildPhotoInput", wildPhotoFixturePath);
  await page.waitForFunction(() => wildDraft?.dataURL?.startsWith("data:image/webp;base64,")
    && wildCaptureThumb.complete && wildCaptureThumb.naturalWidth > 0
    && window.__wildBridgeMessages.some((message) => message.type === "recognizeChars"));
  const processedPhoto = await page.evaluate(async () => {
    await wildCaptureThumb.decode();
    const message = window.__wildBridgeMessages.find((row) => row.type === "recognizeChars");
    return {
      sourceType: message?.dataURL?.slice(0, 23), requestId: message?.requestId,
      draftRequestId: wildDraft?.requestId, bytes: wildImageBytes(wildDraft?.dataURL),
      thumbWidth: wildCaptureThumb.naturalWidth, thumbHeight: wildCaptureThumb.naturalHeight,
      inputCleared: wildPhotoInput.value === "", note: wildCaptureNote.textContent,
    };
  });
  assert(processedPhoto.sourceType === "data:image/webp;base64," && processedPhoto.requestId === processedPhoto.draftRequestId
    && processedPhoto.bytes > 0 && processedPhoto.bytes <= 64 * 1024
    && processedPhoto.thumbWidth > 0 && processedPhoto.thumbWidth === processedPhoto.thumbHeight
    && processedPhoto.inputCleared && processedPhoto.note.includes("正在当前设备上识别"),
  "Expected a real PNG file input to decode, center-crop, compress to bounded WebP, render, and cross the native OCR bridge", processedPhoto);

  const candidateState = await page.evaluate(() => {
    const requestId = wildDraft.requestId;
    window.shiziOCRResult({ requestId, candidates: ["拾时拾"] });
    const buttons = [...wildCandidates.querySelectorAll("[data-wild-candidate]")];
    const noAutoSelection = addInput.value === "" && addConfirm.disabled;
    window.shiziOCRResult({ requestId: requestId - 1, candidates: ["水"] });
    const staleIgnored = [...wildCandidates.querySelectorAll("[data-wild-candidate]")].map((button) => button.textContent).join("") === "拾时";
    return { labels: buttons.map((button) => button.textContent), noAutoSelection, staleIgnored };
  });
  await page.click('#wildCandidates [data-wild-candidate="拾"]');
  const explicitSelection = await page.evaluate(() => addInput.value === "拾" && !addConfirm.disabled
    && wildCandidates.querySelector('[data-wild-candidate="拾"]').classList.contains("selected"));
  await page.click("#addConfirm");
  await page.waitForFunction(() => !addSheet.classList.contains("open"));

  const wildCapture = await page.evaluate(async () => {
    const known = "拾", knownIndex = BASE_BY_CHAR[known], knownMemory = cloneObj(memory[cardKey(knownIndex)]), capture = wildCaptureFor(known);
    openCharSheet(knownIndex);
    await charDetailWildImage.decode();
    charDetailWild.click();
    await wildPhotoFull.decode();
    const detail = {
      story: charDetailStory.textContent,
      photoVisible: getComputedStyle(charDetailWild).display === "grid",
      photoBytes: wildImageBytes(capture.dataURL),
      thumbDecoded: charDetailWildImage.naturalWidth > 0 && charDetailWildImage.naturalHeight > 0,
      fullVisible: wildPhotoSheet.classList.contains("open"),
      fullDecoded: wildPhotoFull.naturalWidth > 0 && wildPhotoFull.naturalHeight > 0,
    };
    closeWildPhoto(); closeCharSheet();

    let unknown = "";
    for (let code = 0x4e00; code <= 0x9fff && !unknown; code += 1) {
      const char = String.fromCharCode(code);
      if (BASE_BY_CHAR[char] == null) unknown = char;
    }
    const cardsBeforeCollect = CARDS.length, customBeforeCollect = customWords.length;
    const collectResult = collectWildCharacter(unknown, { day: "2026-07-20", at: 2000, dataURL: capture.dataURL });
    const unknownMemory = cloneObj(memory[cardKey(collectResult.idx)]), unknownCapture = wildCaptureFor(unknown);
    renderBook();
    const customCard = {
      listed: !!memoryWall.querySelector(`[data-idx="${collectResult.idx}"]`),
      cardAdded: CARDS.length === cardsBeforeCollect + 1,
      customAdded: customWords.length === customBeforeCollect + 1,
      collected: isCollected(collectResult.idx), practiced: profileIndexes().includes(collectResult.idx),
      seen: Number(unknownMemory.seen)||0, misses: Number(unknownMemory.misses)||0,
      lastOutcome: unknownMemory.lastOutcome || "", realWorldMisses: unknownMemory.realWorldMisses,
      photoDay: unknownCapture && unknownCapture.day,
    };
    const backup = JSON.parse(backupPayload({ preserveMeta: true }));
    const backedUp = Object.prototype.hasOwnProperty.call(backup.data, WILD_KEY)
      && JSON.parse(backup.data[WILD_KEY]).captures[unknown].day === "2026-07-20"
      && JSON.parse(backup.data[CUSTOM_KEY]).some((word) => word.includes(unknown));
    const oversized = `data:image/webp;base64,${"A".repeat(90000)}`;
    wildState.wishes[unknown] = normalizeWildEntry({ day: today(), at: 3000, dataURL: oversized });
    const singleLimit = !wildState.wishes[unknown].dataURL;

    wildState = normalizeWildState(null);
    const budgetChars = [];
    for (let code = 0x4e00; budgetChars.length < 35; code += 1) budgetChars.push(String.fromCharCode(code));
    budgetChars.forEach((char, index) => {
      wildState.wishes[char] = { day: today(), at: index + 1, dataURL: capture.dataURL };
    });
    const trimmed = trimWildPhotos(), rows = wildPhotoRows();
    const bounded = rows.length <= WILD_PHOTO_MAX
      && rows.reduce((sum, row) => sum + row.bytes, 0) <= WILD_PHOTO_BUDGET
      && !wildState.wishes[budgetChars[0]].dataURL
      && !!wildState.wishes[budgetChars.at(-1)].dataURL;
    return {
      known: true, source: knownMemory.source, wildDay: knownMemory.wildDay, expectedDay: today(),
      collectKnown: collectResult.known, collectCreated: collectResult.created, unknown, detail, customCard, backedUp, singleLimit,
      cap: { kept: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), removed: trimmed.removed }, bounded,
    };
  });

  await page.evaluate(() => openAddSheet());
  await page.setInputFiles("#wildPhotoInput", { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not-an-image") });
  await page.waitForFunction(() => wildCaptureNote.textContent.includes("照片没能读出来"));
  const failureFallback = await page.evaluate(() => ({
    noDraft: wildDraft === null, manualEnabled: !addInput.disabled,
    confirmDisabled: addConfirm.disabled, note: wildCaptureNote.textContent,
  }));
  await page.evaluate(() => {
    closeAddSheet();
    const saved = window.__wildVerifySaved;
    memory = saved.memory; status = saved.status; wildState = normalizeWildState(saved.wild);
    addedChars = saved.added; customWords = saved.custom; buildCustomCards();
    save(DECK_KEY, status); saveMemory(); save(ADDED_KEY, addedChars); save(CUSTOM_KEY, customWords);
    if (saved.wildRaw === null) localStorage.removeItem(WILD_KEY); else localStorage.setItem(WILD_KEY, saved.wildRaw);
    if (saved.webkit === undefined) delete window.webkit;
    else Object.defineProperty(window, "webkit", { configurable: true, value: saved.webkit });
    delete window.__wildBridgeMessages; delete window.__wildVerifySaved;
    renderHome();
  });

  assert(wildCapture.known && wildCapture.source === "wild" && wildCapture.wildDay === wildCapture.expectedDay
    && wildCapture.detail.story.includes("拾于生活") && wildCapture.detail.photoVisible
    && wildCapture.detail.photoBytes <= 64 * 1024 && wildCapture.detail.thumbDecoded
    && wildCapture.detail.fullVisible && wildCapture.detail.fullDecoded,
  "Expected a photographed in-library character to retain local source metadata and decodable thumbnail/full-photo views", wildCapture);
  assert(wildCapture.collectKnown && wildCapture.collectCreated && wildCapture.customCard.listed && wildCapture.customCard.cardAdded && wildCapture.customCard.customAdded && wildCapture.customCard.collected && !wildCapture.customCard.practiced
    && wildCapture.customCard.seen === 0 && wildCapture.customCard.misses === 0 && !wildCapture.customCard.lastOutcome && wildCapture.customCard.realWorldMisses === 1 && wildCapture.customCard.photoDay === "2026-07-20",
    "Expected an unsupported photographed character to become a custom collected card without fabricating a practice result", wildCapture);
  assert(candidateState.labels.join("") === "拾时" && candidateState.noAutoSelection && explicitSelection && candidateState.staleIgnored,
    "Expected native OCR candidates to require explicit selection and ignore stale callbacks", candidateState);
  assert(failureFallback.noDraft && failureFallback.manualEnabled && failureFallback.confirmDisabled && failureFallback.note.includes("手动输入"),
    "Expected an undecodable selected image to fail silently back to manual input", failureFallback);
  assert(wildCapture.backedUp && wildCapture.singleLimit && wildCapture.bounded && wildCapture.cap.kept <= 30 && wildCapture.cap.bytes <= 420 * 1024 && wildCapture.cap.removed > 0,
    "Expected photographed-character state in backup with 64KiB per-photo and oldest-first aggregate bounds", wildCapture);

  const handCards = await page.evaluate(async () => {
    const saved = {
      memory: cloneObj(memory), handCardPref: cloneObj(handCardPref),
      handCardRaw: localStorage.getItem(HAND_CARD_KEY), mode: document.documentElement.style.colorScheme,
    };
    const index = CARDS.findIndex((card) => card.target === "水"), emptyIndex = CARDS.findIndex((card) => card.target === "火"), m = cardMemory(index);
    const strokes = [
      [{ x: .48, y: .1, w: 1.2, v: .2 }, { x: .48, y: .3, w: 1.15, v: .4 }, { x: .5, y: .55, w: 1, v: .8 }, { x: .48, y: .88, w: .75, v: 1.4 }],
      [{ x: .18, y: .43, w: 1.1, v: .3 }, { x: .35, y: .5, w: 1, v: .6 }, { x: .2, y: .73, w: .7, v: 1.2 }],
      [{ x: .82, y: .4, w: 1.1, v: .3 }, { x: .65, y: .52, w: 1, v: .7 }, { x: .83, y: .78, w: .7, v: 1.3 }],
    ];
    m.seen = 1; m.firstSeenAt = new Date("2026-07-19T08:00:00Z").getTime(); m.target = "水"; m.word = CARDS[index].word;
    const stored = persistRecentInk(m, strokes, new Date("2026-07-19T08:00:00Z").getTime());
    saveMemory();

    openCharSheet(index);
    const detailEntry = getComputedStyle(charDetailCard).display === "block" && charDetailCard.textContent.includes("做张字卡");
    closeCharSheet(); openCharSheet(emptyIndex);
    const emptyHidden = getComputedStyle(charDetailCard).display === "none";
    closeCharSheet();
    openHandCard(index); await updateHandCardPreview();
    const historicalHint = handCardHint.textContent;
    closeHandCard();

    const portrait = await renderHandCardCanvas(index, "portrait"), square = await renderHandCardCanvas(index, "square");
    const inspect = (canvas, ratio) => {
      const ctx = canvas.getContext("2d"), pixels = ctx.getImageData(100, 80, canvas.width - 200, Math.min(820, canvas.height - 160)).data;
      const inkSize = ratio === "square" ? 650 : 720, inkX = (canvas.width - inkSize) / 2, inkY = ratio === "square" ? 90 : 150;
      const inkPixels = ctx.getImageData(inkX, inkY, inkSize, inkSize).data;
      let dark = 0, redGrid = 0, legacyPaper = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 90) dark += 1;
      for (let i = 0; i < inkPixels.length; i += 4) {
        const r = inkPixels[i], g = inkPixels[i + 1], b = inkPixels[i + 2];
        if (r > 135 && r > g + 24 && r > b + 24) redGrid += 1;
        if (Math.abs(r - 253) <= 1 && Math.abs(g - 251) <= 1 && Math.abs(b - 244) <= 1) legacyPaper += 1;
      }
      const paper = [...ctx.getImageData(0, 0, 1, 1).data];
      return { width: canvas.width, height: canvas.height, source: canvas.dataset.inkSource, strokes: Number(canvas.dataset.inkStrokeCount), signature: Number(canvas.dataset.signatureSize), date: Number(canvas.dataset.dateSize), dark, redGrid, legacyPaper, paper };
    };
    const cards = { portrait: inspect(portrait, "portrait"), square: inspect(square, "square") };
    const rendererSource = `${renderHandCardCanvas}\n${drawHandCardInk}`;

    handCardPref = normalizeHandCardPref({ promptEnabled: true, lastPromptDay: "" });
    const firstPrompt = maybeOfferHandCard(index, "fast"), promptVisible = getComputedStyle(handCardPrompt).display === "flex", secondPrompt = maybeOfferHandCard(index, "fast"), wrongPrompt = maybeOfferHandCard(index, "slow");
    handCardPromptOpen.click(); const promptOpened = handCardSheet.classList.contains("open") && handCardIndex === index; closeHandCard();
    handCardPref.lastPromptDay = ""; handCardPref.promptEnabled = false; save(HAND_CARD_KEY, handCardPref);
    const disabledPrompt = maybeOfferHandCard(index, "fast"); renderHandCardPref();
    const settingOff = handCardPromptRow.getAttribute("aria-pressed") === "false" && handCardPromptState.textContent === "关";

    const nativeMessages = [], nativeBridge = { postMessage: (message) => nativeMessages.push(message) };
    const nativeSave = await exportHandCard("save", { index, ratio: "portrait", nativeBridge });
    const nativeShare = await exportHandCard("share", { index, ratio: "square", nativeBridge });
    const downloads = [], webSave = await exportHandCard("save", { index, ratio: "square", nativeBridge: null, download: (blob, name) => downloads.push({ size: blob.size, name }) });
    const shares = [], webShare = await exportHandCard("share", { index, ratio: "portrait", nativeBridge: null, navigator: { canShare: () => true, share: async (payload) => shares.push(payload) } });
    const backup = JSON.parse(backupPayload({ preserveMeta: true })), backupMemory = JSON.parse(backup.data[MEMORY_KEY]), backedUp = Object.prototype.hasOwnProperty.call(backup.data, HAND_CARD_KEY) && Array.isArray(backupMemory[cardKey(index)].recentInk.strokes);
    const inkRow = recentInkRows().find((row) => row.key === cardKey(index));

    m.recentInk = { version: 1, day: m.recentInk.day, at: m.recentInk.at, dataURL: m.recentInk.dataURL };
    saveMemory();
    const legacyBackup = backupPayload({ preserveMeta: true });
    memory = {}; saveMemory();
    const legacyRestore = restoreBackupPayload(legacyBackup, { skipConfirm: true, reload: false });
    memory = load(MEMORY_KEY, {});
    openCharSheet(index);
    const legacyDetail = {
      entryHidden: getComputedStyle(charDetailCard).display === "none",
      promptVisible: getComputedStyle(charDetailCardLegacy).display === "block" && charDetailCardLegacy.textContent.includes("重新独立写一次"),
    };
    closeCharSheet();
    const legacyPortrait = await renderHandCardCanvas(index, "portrait"), legacySquare = await renderHandCardCanvas(index, "square");
    const legacyExport = await exportHandCard("share", { index, ratio: "square", nativeBridge });

    memory = saved.memory; handCardPref = normalizeHandCardPref(saved.handCardPref); saveMemory();
    if (saved.handCardRaw === null) localStorage.removeItem(HAND_CARD_KEY); else localStorage.setItem(HAND_CARD_KEY, saved.handCardRaw);
    document.documentElement.style.colorScheme = saved.mode; hideHandCardPrompt(); renderHome();
    return {
      stored, detailEntry, emptyHidden, historicalHint, cards,
      noPrintedTargetFallback: !/fillText\s*\(\s*(?:data|card)\.target/.test(rendererSource),
      noMarketing: !/二维码|下载引导|扫码|slogan/i.test(rendererSource),
      firstPrompt, promptVisible, secondPrompt, wrongPrompt, promptOpened, disabledPrompt, settingOff,
      nativeSave, nativeShare, nativeMessages: nativeMessages.map((message) => ({ type: message.type, kind: message.kind, png: message.dataURL.startsWith("data:image/png;base64,") })),
      webSave, webShare, downloads, shares: shares.length, backedUp, inkBytes: inkRow && inkRow.bytes,
      legacy: { restored: legacyRestore && legacyRestore.applied, detail: legacyDetail, portraitBlocked: legacyPortrait === null, squareBlocked: legacySquare === null, exportRoute: legacyExport.route },
    };
  });
  assert(handCards.stored && handCards.detailEntry && handCards.emptyHidden && handCards.historicalHint === "用这份笔迹做一张字卡。" && handCards.cards.portrait.width === 1080 && handCards.cards.portrait.height === 1440 && handCards.cards.square.width === 1080 && handCards.cards.square.height === 1080,
    "Expected a recent-ink-only detail entry and clear 2x portrait/square canvases", handCards);
  assert(handCards.cards.portrait.source === "vector" && handCards.cards.square.source === "vector" && handCards.cards.portrait.strokes === 3 && handCards.cards.portrait.dark > 100 && handCards.cards.square.dark > 100
    && handCards.cards.portrait.redGrid === 0 && handCards.cards.square.redGrid === 0 && handCards.cards.portrait.legacyPaper === 0 && handCards.cards.square.legacyPaper === 0
    && handCards.cards.portrait.paper[0] === 244 && handCards.cards.portrait.paper[1] === 239 && handCards.cards.portrait.paper[2] === 226 && handCards.cards.portrait.signature < handCards.cards.portrait.date && handCards.noPrintedTargetFallback && handCards.noMarketing,
  "Expected fixed raw-paper cards whose main glyph comes only from brush-engine handwriting with restrained attribution", handCards);
  assert(handCards.legacy.restored && handCards.legacy.detail.entryHidden && handCards.legacy.detail.promptVisible && handCards.legacy.portraitBlocked && handCards.legacy.squareBlocked && handCards.legacy.exportRoute === "empty",
    "Expected restored v1 raster-only handwriting to stay viewable but never become a gridded or printed handwriting card", handCards.legacy);
  assert(handCards.firstPrompt && handCards.promptVisible && !handCards.secondPrompt && !handCards.wrongPrompt && handCards.promptOpened && !handCards.disabledPrompt && handCards.settingOff,
    "Expected one non-blocking good-stroke prompt per day with a persistent off switch", handCards);
  assert(handCards.nativeSave.route === "native-save" && handCards.nativeShare.route === "native-share" && handCards.nativeMessages[0].type === "savePracticeCard" && handCards.nativeMessages[1].type === "sharePracticeCard" && handCards.nativeMessages.every((message) => message.kind === "character" && message.png)
    && handCards.webSave.route === "download" && handCards.downloads.length === 1 && handCards.webShare.route === "share" && handCards.shares === 1 && handCards.backedUp && handCards.inkBytes > 0,
  "Expected photo-library, system-share, Web Share/download, backup, and bounded recent-ink routes", handCards);
  const libraries = await page.evaluate(() => {
    const originalPayload = backupPayload({ preserveMeta: true });
    const saved = {
      memory: cloneObj(memory), status: cloneObj(status), quality: cloneObj(quality), tuning: cloneObj(tuning),
      preference, library: cloneObj(libraryState), sessionDone: [...sessionDone], activeMode,
      calibrationTargets: calibrationTargets.slice(), roundStats: cloneObj(roundStats),
    };
    memory = {}; status = {}; quality = {}; sessionDone = new Set();
    preference = "balanced";
    tuning = { ...tuning, calibrated: true, contextStrict: 4 };
    const expected = {
      core3500: { available: 3500, official: 3500 },
      adv3000: { available: 2976, official: 3000 },
      rare: { available: 818, official: 1605 },
      curriculum2500: { available: 2500, official: 2500 },
    };
    const rows = LIBRARIES.map((lib) => {
      setLibrary(lib.id);
      tuning.contextStrict = 4;
      const strict4 = newPool(false);
      tuning.contextStrict = 0;
      const strict0 = newPool(false);
      const counts = libraryCounts(lib);
      return {
        id: lib.id, name: lib.name, total: counts.total, officialTotal: counts.officialTotal, expected: expected[lib.id],
        strict0: strict0.length, strict4: strict4.length,
        unique: new Set(strict4.map((idx) => CARDS[idx].target)).size,
        belongs: strict4.every((idx) => lib.test(CARDS[idx])),
        fallbacks: strict4.filter((idx) => contextSource(idx) === "fallback").length,
      };
    });

    const coreIndex = allIndexes().find((idx) => LIBRARIES[0].test(CARDS[idx]));
    const advancedIndex = allIndexes().find((idx) => LIBRARIES[1].test(CARDS[idx]));
    [coreIndex, advancedIndex].forEach((idx) => {
      const row = cardMemory(idx);
      row.seen = 1; row.pendingLearning = false; row.dueDay = today(); row.last = Date.now();
      status[cardKey(idx)] = "rest";
    });
    setLibrary("rare");
    const crossLibraryReview = [coreIndex, advancedIndex].every((idx) => reviewPool(false).includes(idx));
    const rareNewOnly = newPool(false).every((idx) => currentLibrary().test(CARDS[idx]));
    const searchAcrossLibrary = BASE_BY_CHAR[CARDS[coreIndex].target] === coreIndex;

    preference = "balanced";
    const balancedMigration = normalizeLibrary(null).id;
    preference = "practical";
    const practicalMigration = normalizeLibrary(null).id;
    preference = "challenge";
    const challengeMigration = normalizeLibrary(null).id;
    const legacyObjects = Object.fromEntries(["primary", "junior", "senior"].map((id) => [id, normalizeLibrary({ id, userSelected: true })]));
    const legacyStrings = Object.fromEntries(["primary", "junior", "senior"].map((id) => [id, normalizeLibrary(id)]));

    const calibrationIndexes = allIndexes().slice(0, 15);
    const completeChallengeCalibration = (manualLibrary = "") => {
      preference = "balanced";
      tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
      libraryState = normalizeLibrary(null); save(LIB_KEY, libraryState);
      if (manualLibrary) setLibrary(manualLibrary);
      activeMode = "calibrate"; calibrationTargets = calibrationIndexes.slice();
      roundStats = calibrationIndexes.map((idx) => ({ idx, outcome: "fast", geometryStatus: "ok" }));
      const before = { id: libraryState.id, userSelected: libraryState.userSelected, stored: load(LIB_KEY, null) };
      maybeFinishCalibration();
      return { before, preference, id: libraryState.id, userSelected: libraryState.userSelected, stored: load(LIB_KEY, null) };
    };
    const freshCalibration = completeChallengeCalibration();
    const manualCalibration = completeChallengeCalibration("curriculum2500");

    setLibrary("curriculum2500");
    renderBook();
    openLibSheet();
    const ui = {
      card: libName.textContent,
      rows: libList.querySelectorAll("[data-lib]").length,
      active: libList.querySelectorAll(".active").length,
      reassurance: libSheet.textContent.includes("切换字库不会影响已有练习记录") && libSheet.textContent.includes("复习仍包含所有字库"),
      transparentCoverage: libSheet.textContent.includes("官方 3000") && libSheet.textContent.includes("官方 1605"),
      noSchoolClaims: !/小学|初中|高中/.test(libSheet.textContent),
      noUnapprovedProgress: !document.getElementById("libCard").querySelector(".libBar,.libTones") && !libList.querySelector(".libBar") && !/拾完|手速|墨色进度/.test(libSheet.textContent + libCard.textContent),
      settings: (() => { closeLibSheet(); renderSettings(false); return settingsLibName.textContent; })(),
    };
    const libraryBackup = JSON.parse(backupPayload({ preserveMeta: true }));
    setLibrary("rare");
    restoreBackupPayload(libraryBackup, { skipConfirm: true, reload: false, skipSafety: true });
    const restoredLibrary = normalizeLibrary(load(LIB_KEY, null)).id;

    restoreBackupPayload(originalPayload, { skipConfirm: true, reload: false, skipSafety: true });
    memory = saved.memory; status = saved.status; quality = saved.quality; tuning = saved.tuning;
    preference = saved.preference; libraryState = normalizeLibrary(saved.library); sessionDone = new Set(saved.sessionDone);
    activeMode = saved.activeMode; calibrationTargets = saved.calibrationTargets; roundStats = saved.roundStats;
    saveMemory(); save(DECK_KEY, status); saveQuality(); saveTuning(); save(PREF_KEY, preference); save(LIB_KEY, libraryState);
    closeLibSheet(); renderHome();
    return {
      rows, crossLibraryReview, rareNewOnly, searchAcrossLibrary,
      migration: { balancedMigration, practicalMigration, challengeMigration, legacyObjects, legacyStrings },
      calibration: { fresh: freshCalibration, manual: manualCalibration }, ui, restoredLibrary,
    };
  });
  assert(libraries.rows.length === 4 && libraries.rows.every((row) => row.total === row.expected.available && row.officialTotal === row.expected.official && row.strict0 === row.total && row.strict4 === row.total && row.unique === row.total && row.belongs) && libraries.rows.some((row) => row.fallbacks > 0),
    "Expected four source-backed library totals to remain fully reachable while distinguishing practice availability from official totals", libraries);
  assert(libraries.crossLibraryReview && libraries.rareNewOnly && libraries.searchAcrossLibrary,
    "Expected the selected library to scope only new characters while review and search remain cross-library", libraries);
  assert(libraries.migration.balancedMigration === "core3500" && libraries.migration.practicalMigration === "core3500" && libraries.migration.challengeMigration === "adv3000" && libraries.restoredLibrary === "curriculum2500"
    && libraries.migration.legacyObjects.primary.id === "curriculum2500" && libraries.migration.legacyObjects.junior.id === "core3500" && libraries.migration.legacyObjects.senior.id === "adv3000"
    && libraries.migration.legacyStrings.primary.id === "curriculum2500" && libraries.migration.legacyStrings.junior.id === "core3500" && libraries.migration.legacyStrings.senior.id === "adv3000"
    && Object.values(libraries.migration.legacyObjects).every((row) => row.userSelected)
    && Object.values(libraries.migration.legacyStrings).every((row) => row.userSelected)
    && new Set(Object.values(libraries.migration.legacyObjects).map((row) => row.id)).size === 3,
    "Expected object and string forms of the retired school libraries to preserve an explicit, distinct source-backed choice", libraries);
  assert(libraries.calibration.fresh.before.id === "core3500" && !libraries.calibration.fresh.before.userSelected && libraries.calibration.fresh.preference === "challenge" && libraries.calibration.fresh.id === "adv3000" && !libraries.calibration.fresh.userSelected && libraries.calibration.fresh.stored.id === "adv3000"
    && libraries.calibration.manual.before.id === "curriculum2500" && libraries.calibration.manual.before.userSelected && libraries.calibration.manual.preference === "challenge" && libraries.calibration.manual.id === "curriculum2500" && libraries.calibration.manual.userSelected,
    "Expected a real first-install challenge calibration to advance only the untouched default library while preserving a manual choice", libraries.calibration);
  assert(libraries.ui.card === "义教基础字" && libraries.ui.settings === "义教基础字" && libraries.ui.rows === 4 && libraries.ui.active === 1 && libraries.ui.reassurance && libraries.ui.transparentCoverage && libraries.ui.noSchoolClaims && libraries.ui.noUnapprovedProgress,
    "Expected one source-backed selector with transparent official/practice counts and no unsupported school-stage claims", libraries);

  const backup = await page.evaluate(() => {
    const original = JSON.parse(backupPayload({ preserveMeta: true })), originalMemory = cloneObj(memory);
    const currentMemory = { "verify:current-a": { seen: 1, last: new Date("2026-07-10T08:00:00Z").getTime() }, "verify:current-b": { seen: 1, last: new Date("2026-07-11T08:00:00Z").getTime() } };
    memory = currentMemory; saveMemory();
    const incoming = JSON.parse(JSON.stringify(original)); incoming.date = "2026-06-01T08:00:00.000Z"; incoming.data[MEMORY_KEY] = JSON.stringify({ "verify:incoming": { seen: 1, last: new Date("2026-05-31T08:00:00Z").getTime() } });
    let systemConfirmCalled = false; const nativeConfirm = window.confirm; window.confirm = () => { systemConfirmCalled = true; return false; };
    const cancelled = restoreBackupPayload(incoming, { reload: false }), confirmCopy = restoreConfirmCopy.textContent, confirmOpen = restoreConfirmSheet.classList.contains("open"), confirmButtons = [restoreConfirmCancel.textContent, restoreConfirmDo.textContent]; closeRestoreConfirm(); window.confirm = nativeConfirm;
    localStorage.setItem("shizi.unknown.verify", "keep-local");
    const restoredResult = restoreBackupPayload(incoming, { skipConfirm: true, reload: false });
    const safetyAfterRestore = safetySnapshot(), incomingApplied = String(localStorage.getItem(MEMORY_KEY)).includes("verify:incoming");
    const undoOffered = showSafetyUndo() && getComputedStyle(safetyUndo).display === "flex" && safetyUndoBtn.textContent === "撤销恢复";
    const restoreUndoCopy = safetyUndoCopy.textContent;
    const undoResult = undoSafetyRestore({ reload: false }), currentRestored = String(localStorage.getItem(MEMORY_KEY)).includes("verify:current-b");

    memory = currentMemory; saveMemory();
    let resetConfirmCopy = ""; window.confirm = (copy) => { resetConfirmCopy = copy; return false; };
    const resetCancelled = resetAllData() === false;
    window.confirm = nativeConfirm;
    const resetCancelledIntact = String(localStorage.getItem(MEMORY_KEY)).includes("verify:current-b");
    resetAllData({ skipConfirm: true }); const resetSafety = safetySnapshot(), resetUndoCopy = safetyUndoCopy.textContent;
    hideSafetyUndo(); const resetSafetyAfterPrompt = safetySnapshot();
    memory = { "verify:before-second": { seen: 1, last: Date.now() } }; saveMemory();
    const secondIncoming = JSON.parse(JSON.stringify(incoming)); secondIncoming.data[MEMORY_KEY] = JSON.stringify({ "verify:second-incoming": { seen: 1, last: Date.now() } });
    restoreBackupPayload(secondIncoming, { skipConfirm: true, reload: false }); const overwrittenSafety = safetySnapshot();
    undoSafetyRestore({ reload: false }); const latestRestored = String(localStorage.getItem(MEMORY_KEY)).includes("verify:before-second");

    const malicious = JSON.parse(JSON.stringify(original)), maliciousIndex = CARDS.findIndex(card => card.target === "水"), maliciousKey = cardKey(maliciousIndex);
    malicious.data[MEMORY_KEY] = JSON.stringify({ [maliciousKey]: { seen: 1, recentInk: { version: 2, dataURL: `x\" onerror=\"window.__recentInkXss=1` } } });
    restoreBackupPayload(malicious, { skipConfirm: true, reload: false, skipSafety: true }); memory = load(MEMORY_KEY, {}); window.__recentInkXss = 0; openCharSheet(maliciousIndex);
    const maliciousInkRejected = window.__recentInkXss === 0 && charDetailGlyph.textContent === "水" && !charDetailGlyph.querySelector("img") && !charDetailInk.querySelector("img"); closeCharSheet();
    const activityAttack = JSON.parse(JSON.stringify(original)), attackYear = new Date().getFullYear(), attackDay = `${attackYear}-01-01`, attackMonth = attackDay.slice(0, 7), attackMarkup = `<img src=x onerror="window.__activityXss=1">`;
    const attackDays = Array.from({ length: 5 }, (_, offset) => `${attackYear}-01-0${offset + 1}`);
    const rawAttackActivity = { version: 2, migrationDate: attackDay, inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: attackDays, daily: {}, monthly: { [attackMonth]: { days: 5, completedDays: 5, stamps: 5, attempts: 5, completedGroups: 5, targetKeys: [maliciousKey], independentTargetKeys: [], reviewTargetKeys: [], makeupDays: [], firstDay: attackMarkup, firstTargetKey: maliciousKey, lastStampAt: 1 } } };
    activityAttack.data[ACTIVITY_KEY] = JSON.stringify(rawAttackActivity); restoreBackupPayload(activityAttack, { skipConfirm: true, reload: false, skipSafety: true });
    const storedAttackActivity = JSON.parse(localStorage.getItem(ACTIVITY_KEY)), maliciousActivitySanitized = storedAttackActivity.monthly[attackMonth].firstDay === "";
    activity = rawAttackActivity; window.__activityXss = 0; renderAnnualReport(attackYear); const maliciousActivityEscaped = window.__activityXss === 0 && !annualSlides.querySelector("img") && annualSlides.querySelectorAll(".annualSlide").length === 4;
    restoreBackupPayload(original, { skipConfirm: true, reload: false, skipSafety: true }); localStorage.removeItem(SAFETY_KEY); hideSafetyUndo(); memory = originalMemory; activity = normalizeActivity(JSON.parse(original.data[ACTIVITY_KEY]));
    const customStart = CARDS.length; CARDS.push({ custom: true, target: "春" }); const customKeyBefore = cardKey(customStart);
    CARDS.splice(BASE_N, 0, { custom: false, target: "验" }); const customKeyAfter = cardKey(customStart + 1); CARDS.splice(BASE_N, 1); CARDS.pop();
    const legacyCustomKey = "custom:120:春", legacyCustomMemory = { [legacyCustomKey]: { seen: 1, last: 200, dueDay: "2026-09-01", fsrsCard: { stability: 3 } }, "custom:春": { seen: 1, last: 100, dueDay: "2026-08-01" } }, migratedCustom = migrateCustomKeyedRows(legacyCustomMemory), migratedAgain = migrateCustomKeyedRows(migratedCustom.value);
    const migratedFSRS = normalizeFSRSStored([{ eventId: "legacy-custom", attemptId: "legacy", cardKey: legacyCustomKey, target: "春", reviewedAt: new Date().toISOString(), localDay: today(), rating: "Good" }]);
    const migratedActivity = normalizeActivity({ version: 2, migrationDate: today(), inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [today()], daily: { [today()]: { stamps: 1, attempts: 1, targetKeys: [legacyCustomKey], independentTargetKeys: [legacyCustomKey], reviewTargetKeys: [legacyCustomKey], completedRoundIds: [] } }, monthly: {} });
    const customMigration = { changed: migratedCustom.changed, keys: Object.keys(migratedCustom.value), memory: migratedCustom.value["base:春"], idempotent: !migratedAgain.changed && JSON.stringify(migratedAgain.value) === JSON.stringify(migratedCustom.value), fsrsKey: migratedFSRS.events[0] && migratedFSRS.events[0].cardKey, activityKeys: migratedActivity.daily[today()].targetKeys };
    const beforeFailure = Object.fromEntries(BACKUP_KEYS.map(k => [k, localStorage.getItem(k)]));
    const failingIncoming = JSON.parse(JSON.stringify(original)); failingIncoming.data[MEMORY_KEY] = JSON.stringify({ "verify:atomic-incoming": { seen: 1 } }); failingIncoming.data[QUALITY_KEY] = JSON.stringify({ "verify:atomic-quality": { easy: 1 } });
    const nativeSetItem = Storage.prototype.setItem; let injectedFailure = false, atomicRejected = false;
    Storage.prototype.setItem = function(key, value){ if(key===QUALITY_KEY && !injectedFailure){ injectedFailure=true; throw new DOMException("quota", "QuotaExceededError"); } return nativeSetItem.call(this,key,value); };
    try{ restoreBackupPayload(failingIncoming,{skipConfirm:true,reload:false,skipSafety:true}); }catch(e){ atomicRejected=e&&e.name==="QuotaExceededError"; } finally{ Storage.prototype.setItem=nativeSetItem; }
    const afterFailure = Object.fromEntries(BACKUP_KEYS.map(k => [k, localStorage.getItem(k)]));
    const result = { keys: Object.keys(original.data), sessionVersion: JSON.parse(original.data[SESSION_KEY]).version, fsrsLog: !!original.data[FSRS_LOG_KEY], tutorial: original.data[TRACE_TUTORIAL_KEY], funnelVersion: JSON.parse(original.data[FUNNEL_KEY]).version, sound: JSON.parse(original.data[SOUND_KEY]), restoredKeys: restoredResult.keys,
      unknown: localStorage.getItem("shizi.unknown.verify"), cancelled: !cancelled.applied, pending: cancelled.pending, confirmCopy, confirmOpen, confirmButtons, systemConfirmCalled, incomingApplied, safetyReason: safetyAfterRestore && safetyAfterRestore.reason, undoOffered, undoApplied: undoResult.applied, currentRestored,
      restoreUndoCopy, resetCancelled, resetConfirmCopy, resetCancelledIntact, resetUndoCopy, resetAfterPromptReason: resetSafetyAfterPrompt && resetSafetyAfterPrompt.reason,
      resetReason: resetSafety && resetSafety.reason, overwrittenReason: overwrittenSafety && overwrittenSafety.reason, latestRestored, safetyExcluded: !Object.prototype.hasOwnProperty.call(original.data, SAFETY_KEY),
      customKeyBefore, customKeyAfter, customMigration, maliciousInkRejected, maliciousActivitySanitized, maliciousActivityEscaped, atomicRejected, atomicRestored: JSON.stringify(afterFailure)===JSON.stringify(beforeFailure) };
    localStorage.removeItem("shizi.unknown.verify"); return result;
  });
  assert(backup.keys.includes(SESSION_STORAGE_KEY) && backup.keys.includes("shizi.library.v1") && backup.sessionVersion === 3 && backup.fsrsLog && backup.tutorial === "true" && backup.funnelVersion === 2 && backup.sound.enabled === true && backup.sound.scene === "rain" && backup.restoredKeys.includes(SESSION_STORAGE_KEY) && backup.unknown === "keep-local", "Expected session/FSRS/tutorial/funnel/soundscape/library backup round trip with allowlist isolation", backup);
  assert(backup.cancelled && backup.pending && backup.confirmOpen && !backup.systemConfirmCalled && backup.confirmCopy.includes("当前：2 个字，最后练习 2026-07-11") && backup.confirmCopy.includes("备份：1 个字，备份时间 2026-06-01")
    && backup.confirmCopy.includes("覆盖前的数据会作为一份安全副本留在当前设备") && backup.confirmCopy.includes("下次恢复或清空会覆盖这份副本")
    && backup.restoreUndoCopy.includes("覆盖前的数据仍留在本设备")
    && backup.confirmButtons.join("/") === "保留当前记录/确认覆盖" && backup.incomingApplied && backup.safetyReason === "restore" && backup.undoOffered && backup.undoApplied && backup.currentRestored,
    "Expected an in-app differential restore confirmation and one-tap safety undo", backup);
  assert(backup.resetReason === "reset" && backup.overwrittenReason === "restore" && backup.latestRestored && backup.safetyExcluded, "Expected reset safety copy, latest-operation replacement, and backup exclusion", backup);
  assert(backup.customKeyBefore === "custom:春" && backup.customKeyAfter === backup.customKeyBefore, "Expected custom card keys to remain stable when the base deck size changes", backup);
  assert(backup.customMigration.changed && backup.customMigration.keys.length === 1 && backup.customMigration.keys[0] === "base:春" && backup.customMigration.memory.last === 200 && backup.customMigration.memory.dueDay === "2026-09-01" && backup.customMigration.memory.fsrsCard.stability === 3
    && backup.customMigration.idempotent && backup.customMigration.fsrsKey === "base:春" && backup.customMigration.activityKeys[0] === "base:春",
    "Expected legacy indexed custom keys to migrate once across memory, FSRS history, and activity while keeping the newest schedule", backup.customMigration);
  assert(backup.maliciousInkRejected, "Expected restored recent-ink markup to be rejected before DOM rendering", backup);
  assert(backup.maliciousActivitySanitized && backup.maliciousActivityEscaped, "Expected restored activity fields to be schema-normalized and annual-report text to remain escaped", backup);
  assert(backup.atomicRejected && backup.atomicRestored, "Expected a failed backup write to restore every previous allowlisted value", backup);
  const boundedPersistence = await page.evaluate(() => {
    const saved = {
      fsrsReviewLog: cloneObj(fsrsReviewLog), fsrsReviewMonthly: cloneObj(fsrsReviewMonthly),
      activity: cloneObj(activity), funnel: cloneObj(funnel), storageWriteFailed,
      storageNoticeDisplay: storageNotice.style.display, storageNoticeText: storageNotice.textContent,
    };
    try {
      const oldReviewDay = `${new Date().getFullYear() - 1}-${today().slice(5)}`;
      fsrsReviewLog = [{ eventId: "verify-old-review", cardKey: cardKey(0), localDay: oldReviewDay,
        reviewedAt: new Date(dayStartMs(oldReviewDay) + 8 * 3600 * 1000).toISOString(), rating: "Good", hintCount: 1, traced: true },
      { eventId: "verify-old-review-latest", cardKey: cardKey(1), localDay: oldReviewDay,
        reviewedAt: new Date(dayStartMs(oldReviewDay) + 9 * 3600 * 1000).toISOString(), rating: "Again", hintCount: 0, traced: false }];
      fsrsReviewMonthly = {}; saveFSRSLog();
      const reviewMonth = oldReviewDay.slice(0, 7), reviewArchive = cloneObj(fsrsReviewMonthly[reviewMonth]), curatorArchive = bookCuratorData([]);
      const oldActivityDay = shiftDay(today(), -(ACTIVITY_RAW_RETENTION_DAYS + 1)), activityMonth = oldActivityDay.slice(0, 7), targetKey = cardKey(0);
      activity = normalizeActivity({ version: 2, migrationDate: today(), inheritedStreak: 0, inheritedTotalDays: 0,
        practiceDays: [oldActivityDay], daily: { [oldActivityDay]: { stamps: 1, attempts: 2, targetKeys: [targetKey], independentTargetKeys: [targetKey], reviewTargetKeys: [], completedRoundIds: ["verify-old-round"], lastStampAt: dayStartMs(oldActivityDay) + 9 * 3600 * 1000 } }, monthly: {} });
      saveActivity(); const activityArchive = cloneObj(activity.monthly[activityMonth]), monthlyReport = monthReportData(activityMonth);
      funnel = newFunnel();
      funnel.seen = Array.from({ length: 600 }, (_, index) => `verify-seen-${index}`);
      funnel.events = Array.from({ length: 600 }, (_, index) => ({ name: "verify_event", at: Date.now() + index, day: today() }));
      funnel.eventCounts = { verify_event: 600 };
      funnel.rounds = Array.from({ length: 220 }, (_, index) => ({ completedAt: Date.now() + index, day: today(), mode: "new", durationMs: 1000, targetCount: 1, attemptCount: 1 }));
      funnel.roundTotals = { count: 220, durationMs: 220000, byMode: { new: { count: 220, durationMs: 220000 } } }; saveFunnel(true);
      const funnelState = { seen: funnel.seen.length, events: funnel.events.length, rounds: funnel.rounds.length, eventTotal: funnel.eventCounts.verify_event, roundTotal: cloneObj(funnel.roundTotals) };
      storageNotice.style.display = "none"; storageWriteFailed = false;
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value){ if(key === "shizi.verify.quota") throw new DOMException("quota", "QuotaExceededError"); return nativeSetItem.call(this, key, value); };
      let quotaSaved;
      try { quotaSaved = save("shizi.verify.quota", { value: 1 }); } finally { Storage.prototype.setItem = nativeSetItem; }
      const quota = { saved: quotaSaved, flagged: storageWriteFailed, visible: getComputedStyle(storageNotice).display !== "none", copy: storageNotice.textContent };
      const pressure = storagePressure({ usage: 90, quota: 100 });
      return {
        fsrs: { raw: fsrsReviewLog.length, archive: reviewArchive, curator: curatorArchive },
        activity: { raw: Object.prototype.hasOwnProperty.call(activity.daily, oldActivityDay), archive: activityArchive, reportKeys: monthlyReport.keys, reportDays: monthlyReport.practiceDays },
        funnel: funnelState, quota, pressure,
      };
    } finally {
      fsrsReviewLog = saved.fsrsReviewLog; fsrsReviewMonthly = saved.fsrsReviewMonthly; saveFSRSLog();
      activity = normalizeActivity(saved.activity); save(ACTIVITY_KEY, activity);
      funnel = normalizeFunnel(saved.funnel); save(FUNNEL_KEY, funnel);
      storageWriteFailed = saved.storageWriteFailed; storageNotice.style.display = saved.storageNoticeDisplay; storageNotice.textContent = saved.storageNoticeText;
    }
  });
  assert(boundedPersistence.fsrs.raw === 0 && boundedPersistence.fsrs.archive.reviews === 2 && boundedPersistence.fsrs.archive.good === 1 && boundedPersistence.fsrs.archive.again === 1 && boundedPersistence.fsrs.archive.hinted === 1 && boundedPersistence.fsrs.archive.traced === 1
    && Object.values(boundedPersistence.fsrs.archive.lastReviewByDay)[0]?.cardKey
    && boundedPersistence.fsrs.curator.kind === "recall" && boundedPersistence.fsrs.curator.indexes[0] === 1,
    "Expected old FSRS detail to compact into durable counters while preserving last-year-today recall", boundedPersistence.fsrs);
  assert(!boundedPersistence.activity.raw && boundedPersistence.activity.archive.days === 1 && boundedPersistence.activity.archive.completedDays === 1 && boundedPersistence.activity.reportKeys.length === 1 && boundedPersistence.activity.reportDays === 1,
    "Expected old activity detail to compact without disappearing from monthly reports", boundedPersistence.activity);
  assert(boundedPersistence.funnel.seen === 512 && boundedPersistence.funnel.events === 256 && boundedPersistence.funnel.rounds === 180 && boundedPersistence.funnel.eventTotal === 600 && boundedPersistence.funnel.roundTotal.count === 220 && boundedPersistence.funnel.roundTotal.durationMs === 220000 && boundedPersistence.funnel.roundTotal.byMode.new.count === 220,
    "Expected bounded funnel detail with lifetime counters preserved", boundedPersistence.funnel);
  assert(!boundedPersistence.quota.saved && boundedPersistence.quota.flagged && boundedPersistence.quota.visible && boundedPersistence.quota.copy.includes("没有保存") && boundedPersistence.pressure.high,
    "Expected quota failures and high storage pressure to be visible instead of silent", boundedPersistence);

  const backupCoverage = await page.evaluate(() => {
    const excluded = new Set(["shizi.nativeSmoke.v1", SAFETY_KEY]);
    return Object.keys(localStorage).filter((key) => key.startsWith("shizi.") && !key.startsWith("shizi.corrupt.") && !BACKUP_KEYS.includes(key) && !excluded.has(key));
  });
  assert(backupCoverage.length === 0, "Expected every persistent shizi key to be backed up or explicitly excluded", backupCoverage);

  await page.setViewportSize({ width: 320, height: 620 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { const s = resumableSession(); if (s) restoreSession(s); });
  await page.waitForFunction(() => getComputedStyle(reveal).display !== "none");
  const compact = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".cmpBox")).map((node) => node.getBoundingClientRect());
    const cardRect = card.getBoundingClientRect(), back = exitPractice.getBoundingClientRect(), progress = posLabel.getBoundingClientRect(), end = document.querySelector(".chdr > span").getBoundingClientRect(), progressStyle = getComputedStyle(posLabel);
    return { widths: boxes.map((box) => box.width), within: boxes.every((box) => box.left >= cardRect.left && box.right <= cardRect.right), actions: decisionRow.getBoundingClientRect().bottom <= innerHeight + 1,
      header: { backSize: [back.width, back.height], noOverlap: back.right <= progress.left && progress.right <= end.left, nowrap: progressStyle.whiteSpace === "nowrap", oneLine: posLabel.scrollHeight <= posLabel.clientHeight + 1, noGraphicProgress: !document.querySelector(".beads,.bead,progress,[role=progressbar]") } };
  });
  assert(compact.widths.every((width) => width <= 138.5) && compact.within && compact.actions && compact.header.backSize.every((value) => value >= 44) && compact.header.noOverlap && compact.header.nowrap && compact.header.oneLine && compact.header.noGraphicProgress, "Expected dark small-screen comparison and text-only header to fit", compact);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const blockedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await blockedContext.addInitScript(() => {
    Storage.prototype.getItem = function(){ throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = function(){ throw new DOMException("blocked", "SecurityError"); };
  });
  const blockedPage = await blockedContext.newPage(), blockedErrors = [];
  blockedPage.on("pageerror", (error) => blockedErrors.push(error.message));
  await blockedPage.goto(appUrl, { waitUntil: "networkidle" });
  await blockedPage.waitForFunction(() => document.getElementById("storageGate")?.classList.contains("open"));
  const blockedStorage = await blockedPage.evaluate(() => ({
    open: storageGate.classList.contains("open"), title: storageGateTitle.textContent,
    copy: storageGate.textContent.replace(/\s+/g, ""), reload: storageReload.textContent,
  }));
  await blockedContext.close();
  assert(blockedErrors.length === 0 && blockedStorage.open && blockedStorage.title === "暂时无法保存练习" && blockedStorage.copy.includes("系统没有开放本地存储") && blockedStorage.reload === "重新检查",
    "Expected a readable blocking page when storage access is disabled at boot", { blockedErrors, blockedStorage });

  assert(pageErrors.length === 0, "Browser console/page errors", pageErrors);
  await browser.close();
  console.log(`Verified FSRS-6 dual-loop practice, migration, persistence, backup, history, and ${baseline.cards} cards.`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
