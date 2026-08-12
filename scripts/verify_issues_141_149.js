const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const webViewSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "WebViewController.swift"), "utf8");
const deckSource = fs.readFileSync(path.join(root, "deck-data.js"), "utf8");
const qualitySource = fs.readFileSync(path.join(root, "data", "context-quality.js"), "utf8");
const overrideSource = fs.readFileSync(path.join(root, "data", "context-overrides.js"), "utf8");
const deck = JSON.parse(deckSource.match(/const SEED = (\[.*\]);/s)[1]);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function loadConst(sourceText, name) {
  const sandbox = {};
  vm.runInNewContext(`${sourceText}\nthis.__value = ${name};`, sandbox);
  return JSON.parse(JSON.stringify(sandbox.__value));
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const rejected = loadConst(qualitySource, "CONTEXT_REJECTED");
const qualitySummary = loadConst(qualitySource, "CONTEXT_QUALITY_SUMMARY");
const overrides = loadConst(overrideSource, "CONTEXT_OVERRIDES");
const placeholders = deck.filter((card) => card.ans === `${card.target}字`);
const manualOverlap = Object.keys(overrides).filter((target) => rejected[target]);

assert(qualitySummary.deckCards === 7294 && qualitySummary.rejectedCards === 1988
  && qualitySummary.reasons.placeholder === 954 && placeholders.length === 954
  && placeholders.every((card) => rejected[card.target] === "placeholder"),
"#148 context quality gate must reject every generated placeholder", qualitySummary);
assert(manualOverlap.length > 0 && source.indexOf('data/context-quality.js') < source.indexOf('data/context-overrides.js')
  && source.includes('if(!override && REJECTED_CONTEXTS[target])')
  && swSource.includes("'data/context-quality.js'") && swSource.includes("'data/context-overrides.js'")
  && readme.includes("人工批准的常用词与白话释义优先") && readme.includes("人工覆盖不受误伤"),
"#148 reviewed context overrides must take precedence online and offline", { manualOverlap: manualOverlap.length });
assert(contrast("#be442b", "#fdfbf4") >= 4.5 && contrast("#8a6720", "#fdfbf4") >= 4.5
  && contrast("#d96a53", "#29241b") >= 4.5 && contrast("#d6ad5d", "#29241b") >= 4.5
  && contrast("#fdfbf4", "#be442b") >= 4.5 && contrast("#29241b", "#d96a53") >= 4.5
  && contrast("#1d1a15", "#a67c26") >= 4.5 && contrast("#1d1a15", "#c89b45") >= 4.5,
"#145 accent and gold text tokens must meet 4.5:1 in both themes");
assert(!/box-shadow:[^;}]*rgba\((?:20,18,14|30,24,16|43,38,32|60,48,30)/.test(source)
  && source.includes("--shadow-color:") && source.includes("--shadow-soft:") && source.includes("--shadow-outline:"),
"#147 elevated layers must use theme-aware shadow tokens");
assert(!source.includes(">存月帖<") && !source.includes(">存图 ›<") && !source.includes('toast("月帖')
  && source.includes(">存本月拾字帖<") && source.includes(">存本月拾字帖 ›<"),
"#148 the monthly share action must use one product name everywhere");
assert(!source.includes("shortDueDay(m.dueDay)") && source.includes('id="resetConfirmSheet"')
  && source.includes('window.shiziCardShared') && webViewSource.includes("sendPracticeCardShareResult"),
"#148/#149 must keep scheduling out of feedback, use a custom destructive dialog, and close the native share callback");

function chromeExecutable() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((candidate) => fs.existsSync(candidate));
}

async function resetState(page) {
  await page.evaluate(() => {
    clearTimeout(autoNextTimer); clearTimeout(editStampTimer); clearTimeout(summarySealTimer); clearTimeout(undoFollowTimer);
    localStorage.clear();
    status = {}; memory = {}; quality = {}; fsrsReviewLog = []; fsrsReviewMonthly = {};
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0;
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    wildState = normalizeWildState(null); customWords = []; addedChars = []; buildCustomCards();
    focusPreservedSession = null; pendingFocusRequest = null; makeupPendingDay = ""; makeupTargetDay = "";
    activeMode = "new"; focusQueue = []; baseTargets = []; batch = []; baseCursor = 0; currentIndex = null;
    manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = []; roundHandwriting = {};
    sessionDone = new Set(); attemptSeq = 0; practicePhase = "between"; roundId = 0; lastStampSnapshot = null;
    roundElapsedMs = 0; roundActiveStartedAt = 0; roundBudgetPrompted = false; roundBudgetAttemptBase = 0; roundBudgetDate = today();
    save(DECK_KEY, status); saveMemory(); saveQuality(); saveFSRSLog(); saveActivity(); saveTuning(); save(CUSTOM_KEY, customWords); save(ADDED_KEY, addedChars); saveWildState();
    ["addSheet", "makeupSheet", "focusChoiceSheet", "roundBudgetSheet", "charSheet", "handCardSheet", "resetConfirmSheet"].forEach((id) => $(id).classList.remove("open"));
    hideUndoBar(true); unlockGradeActions(); renderHome();
  });
}

let browser;
(async () => {
  const executablePath = chromeExecutable();
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, colorScheme: "light" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(appUrl, { waitUntil: "networkidle" });

  await resetState(page);
  const makeupDay = await page.evaluate(() => shiftDay(today(), -1));
  await page.evaluate((day) => { activity.migrationDate = shiftDay(today(), -30); saveActivity(); openMakeupSheet(day); }, makeupDay);
  assert(await page.locator("#makeupSheet").evaluate((node) => node.classList.contains("open")), "#141 makeup confirmation sheet must open");
  await page.click("#makeupConfirm");
  await page.waitForFunction(() => activeMode === "makeup" && getComputedStyle(card).display !== "none");
  const issue141 = await page.evaluate(() => ({ mode: activeMode, targetDay: makeupTargetDay, targets: baseTargets.length, sheetClosed: !makeupSheet.classList.contains("open") }));
  assert(issue141.mode === "makeup" && issue141.targetDay === makeupDay && issue141.targets === 5 && issue141.sheetClosed && pageErrors.length === 0,
    "#141 real makeup click must enter a five-character round without a ReferenceError", { issue141, pageErrors });

  await resetState(page);
  const issue143 = await page.evaluate(() => {
    const focusIndex = BASE_BY_CHAR["水"], makeupIndexes = allIndexes().slice(0, 5), targetDay = shiftDay(today(), -2);
    activeMode = "focus"; focusQueue = [focusIndex]; baseTargets = [focusIndex]; batch = baseTargets; baseCursor = 1; currentIndex = focusIndex;
    currentAttemptKind = "base"; currentAttemptId = "issue-143-focus"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = [{ idx: focusIndex, target: CARDS[focusIndex].target, outcome: "fast", independentlyRecovered: true }]; roundId = "issue-143-focus";
    const focusStamp = markPracticeStamp(focusIndex, "fast"), focusComplete = markRoundComplete();
    const focus = { focusStamp, focusComplete, today: cloneObj(dailyActivity()), practiceDays: activity.practiceDays.slice() };

    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    activeMode = "makeup"; makeupTargetDay = targetDay; focusQueue = makeupIndexes.slice(); baseTargets = makeupIndexes.slice(); batch = baseTargets; baseCursor = baseTargets.length;
    currentIndex = baseTargets.at(-1); currentAttemptKind = "base"; currentAttemptId = "issue-143-makeup"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true })); roundId = "issue-143-makeup";
    baseTargets.forEach((idx) => markPracticeStamp(idx, "fast")); const makeupComplete = markRoundComplete();
    const makeup = { makeupComplete, target: cloneObj(dailyActivity(targetDay)), today: cloneObj(dailyActivity()), practiceDays: activity.practiceDays.slice() };

    removeStored(SESSION_KEY); activeMode = "new"; makeupTargetDay = ""; focusQueue = []; startRound();
    const previousDay = shiftDay(today(), -1), session = sessionPayload();
    session.startedDate = previousDay; session.roundBudgetDate = previousDay; session.roundElapsedMs = ROUND_TIME_BUDGET_MS + 1000;
    session.roundBudgetPrompted = true; session.attemptSeq = ROUND_ATTEMPT_BUDGET + 1; session.roundBudgetAttemptBase = 0;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session)); restoreSession(session);
    const restored = { elapsed: Math.round(roundElapsedMs), prompted: roundBudgetPrompted, attempts: currentBudgetAttempts(), reached: roundBudgetReached(), budgetDate: roundBudgetDate };
    renderHome();
    const home = { title: homeTitle.textContent.replace(/\s+/g, ""), cap: startCap.textContent.replace(/\s+/g, "") };
    openRoundBudgetSheet();
    const ctas = { continueClass: continueRound.className, deferClass: deferRound.className };
    closeRoundBudgetSheet();
    return { focus, makeup, targetDay, restored, home, ctas };
  });
  assert(!issue143.focus.focusStamp && issue143.focus.focusComplete && issue143.focus.today.stamps === 0 && issue143.focus.today.completedGroups === 0 && issue143.focus.practiceDays.length === 0,
    "#143 focus practice must not create a completed/practice day", issue143.focus);
  assert(issue143.makeup.makeupComplete && issue143.makeup.target.makeup && issue143.makeup.target.completedGroups === 1
    && issue143.makeup.today.stamps === 0 && issue143.makeup.today.completedGroups === 0
    && issue143.makeup.practiceDays.join() === issue143.targetDay,
    "#143 makeup must write only the selected historical day", issue143.makeup);
  assert(issue143.restored.elapsed === 0 && !issue143.restored.prompted && issue143.restored.attempts === 0 && !issue143.restored.reached
    && issue143.home.title.includes("接着写上次那组") && issue143.ctas.continueClass.includes("ghostAct") && issue143.ctas.deferClass.includes("primaryAct"),
    "#143 a cross-day resume must reset the budget and use the cross-day Home copy", issue143);

  await resetState(page);
  const issue144Seed = await page.evaluate(() => {
    startMode("new"); const raw = localStorage.getItem(SESSION_KEY), session = JSON.parse(raw);
    const focusIndex = allIndexes().find((idx) => !session.baseTargets.includes(idx));
    window.__issue144 = { raw, session: cloneObj(session), focusIndex };
    const started = startFocus([focusIndex], { returnView: "home" });
    return { started, sheetOpen: focusChoiceSheet.classList.contains("open"), originalMode: session.activeMode, originalIndex: session.currentIndex };
  });
  assert(!issue144Seed.started && issue144Seed.sheetOpen, "#144 an ordinary resumable group must offer a choice before focus practice", issue144Seed);
  await page.click("#focusChoiceSingle");
  await page.waitForFunction(() => activeMode === "focus" && baseTargets.length === 1 && getComputedStyle(card).display !== "none");
  const focusPreserved = await page.evaluate(() => ({ sameStored: JSON.stringify(JSON.parse(localStorage.getItem(SESSION_KEY))) === JSON.stringify(window.__issue144.session), target: currentCardIndex(), expected: window.__issue144.focusIndex }));
  await page.click("#exitPractice");
  await page.waitForFunction(() => getComputedStyle(home).display !== "none");
  const afterFocusExit = await page.evaluate(() => { const session = resumableSession(); return { sameStored: JSON.stringify(session) === JSON.stringify(window.__issue144.session), mode: session && session.activeMode, index: session && session.currentIndex, title: homeTitle.textContent.replace(/\s+/g, "") }; });
  await page.evaluate(() => startFocus([window.__issue144.focusIndex], { returnView: "home" }));
  await page.click("#focusChoiceResume");
  await page.waitForFunction(() => activeMode === window.__issue144.session.activeMode && currentCardIndex() === window.__issue144.session.currentIndex);
  const resumedOriginal = await page.evaluate(() => ({ mode: activeMode, index: currentCardIndex(), expectedMode: window.__issue144.session.activeMode, expectedIndex: window.__issue144.session.currentIndex }));
  assert(focusPreserved.sameStored && focusPreserved.target === focusPreserved.expected && afterFocusExit.sameStored
    && afterFocusExit.mode === issue144Seed.originalMode && afterFocusExit.index === issue144Seed.originalIndex && afterFocusExit.title.includes("接着写这一组")
    && resumedOriginal.mode === resumedOriginal.expectedMode && resumedOriginal.index === resumedOriginal.expectedIndex,
    "#144 one-character focus must preserve and resume the exact ordinary group", { focusPreserved, afterFocusExit, resumedOriginal });

  const summaryLayouts = [];
  for (const size of [{ width: 375, height: 667 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    for (const largeText of [false, true]) {
      const layout = await page.evaluate(({ largeText }) => {
        fontScaleLarge = largeText; applyFontScale(); clearTimeout(summarySealTimer); removeStored(SESSION_KEY);
        activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
        const indexes = allIndexes().slice(0, 15); activeMode = "new"; baseTargets = indexes.slice(); batch = baseTargets; baseCursor = baseTargets.length;
        currentIndex = indexes.at(-1); manualQueue = []; reinforcementQueue = []; unresolved = new Set(); practicePhase = "between"; roundId = `issue-145-${largeText}`;
        roundStats = indexes.map((idx, order) => ({ idx, target: CARDS[idx].target, outcome: ["fast", "hinted", "slow", "miss"][order % 4], independentlyRecovered: order % 3 === 0 }));
        roundElapsedMs = 1000; roundActiveStartedAt = 0; roundSummary(); clearTimeout(summarySealTimer);
        const tiles = [...sumTiles.querySelectorAll(".sumTile")], rect = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
        const rows = tiles.map((tile) => { const tileRect = rect(tile), glyph = rect(tile.querySelector(".glyphText")), meaning = rect(tile.querySelector(".meaning")); return { tile: tileRect, glyph, meaning, separated: glyph.bottom <= meaning.top + 0.5 }; });
        const overflowNodes = [...document.querySelectorAll("body *")].flatMap((node) => {
          const style = getComputedStyle(node), box = node.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.right <= innerWidth + 1) return [];
          return [{ tag: node.tagName, id: node.id, className: String(node.className), left: box.left, right: box.right, width: box.width, transform: style.transform }];
        }).slice(0, 20);
        return { count: tiles.length, columns: getComputedStyle(sumTiles).gridTemplateColumns.split(" ").length, rows, pageWidth: document.documentElement.scrollWidth, innerWidth, sheet: rect(sumSheet), fontScale: getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim(), overflowNodes };
      }, { largeText });
      summaryLayouts.push({ size, largeText, layout });
    }
  }
  assert(summaryLayouts.every(({ size, largeText, layout }) => layout.count === 15 && layout.columns === 4 && layout.rows.every((row) => row.separated && row.tile.width >= 60)
    && layout.pageWidth <= layout.innerWidth + 1 && layout.sheet.left >= -1 && layout.sheet.right <= size.width + 1 && layout.fontScale === (largeText ? "1.12" : "1")),
    "#145 summary tiles must not overlap at either target height or text scale", summaryLayouts);
  const issue145Canvas = await page.evaluate(() => {
    const hintedInk = shareOutcomeInk("hinted"), slowInk = shareOutcomeInk("slow"), canvas = renderPracticeCardCanvas();
    return { hintedInk, slowInk, rendered: !!canvas, items: canvas && Number(canvas.dataset.itemCount), rendererUsesPalette: String(renderPracticeCardCanvas).includes("shareOutcomeInk(stat.outcome)") };
  });
  assert(issue145Canvas.rendered && issue145Canvas.items === 15 && issue145Canvas.rendererUsesPalette
    && contrast(issue145Canvas.hintedInk, "#a67c26") >= 4.5 && contrast(issue145Canvas.slowInk, "#c2452c") >= 4.5,
    "#145 exported result marks must use accessible ink on their actual canvas colors", issue145Canvas);

  await resetState(page); await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => {
    window.__issue146Writer = window.HanziWriter;
    window.HanziWriter = { create: () => ({ animateStroke: () => Promise.resolve(), animateCharacter: () => {} }) };
    startFocus([BASE_BY_CHAR["水"]]);
  });
  await page.waitForTimeout(2700);
  const weakNetwork = await page.evaluate(() => ({ hint: hint.textContent, showEnabled: !show.disabled, doneDisabled: done.disabled, actionsDisabled: actions.getAttribute("aria-disabled") }));
  assert(weakNetwork.hint.includes("加载较慢") && weakNetwork.showEnabled && weakNetwork.doneDisabled && weakNetwork.actionsDisabled === "false",
    "#146 a hanging stroke loader must fall back within three seconds without trapping actions", weakNetwork);
  await page.evaluate(() => { window.HanziWriter = window.__issue146Writer; delete window.__issue146Writer; removeStored(SESSION_KEY); focusPreservedSession = null; activeMode = "new"; renderHome(); });
  await page.evaluate(() => startFocus([BASE_BY_CHAR["器"]]));
  await page.waitForFunction(() => !show.disabled);
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing" && getComputedStyle(undoBar).display !== "none");
  const missBeforeUndo = await page.evaluate(() => ({ stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length, header: getComputedStyle(document.querySelector(".chdr")).visibility, undo: undoBar.textContent }));
  await page.click("#undoLast");
  await page.waitForFunction(() => practicePhase === "recall" && pendingSessionVisual === null);
  const missAfterUndo = await page.evaluate(() => {
    lockGradeActions(); const locked = { group: actions.getAttribute("aria-disabled"), buttons: [...actions.querySelectorAll("button")].map((button) => button.getAttribute("aria-disabled")) };
    unlockGradeActions(); const unlocked = { group: actions.getAttribute("aria-disabled"), buttons: [...actions.querySelectorAll("button")].map((button) => button.getAttribute("aria-disabled")) };
    return { stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length, phase: practicePhase, locked, unlocked };
  });
  assert(missBeforeUndo.stats === 1 && missBeforeUndo.events === 1 && missBeforeUndo.attempts === 1 && missBeforeUndo.header === "visible" && missBeforeUndo.undo.includes("重盖")
    && missAfterUndo.stats === 0 && missAfterUndo.events === 0 && missAfterUndo.attempts === 0 && missAfterUndo.phase === "recall"
    && missAfterUndo.locked.group === "true" && missAfterUndo.locked.buttons.every((value) => value === "true")
    && missAfterUndo.unlocked.group === "false" && missAfterUndo.unlocked.buttons.every((value) => value === "false"),
    "#146 don't-know must be undoable while the visible and accessibility lock states stay synchronized", { missBeforeUndo, missAfterUndo });
  await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0);
  const doubleDecision = await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); actionCooldownUntil = 0; revealAnswer();
    decisionCorrect.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    decisionCorrect.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { stamped, stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length };
  });
  assert(doubleDecision.stamped && doubleDecision.stats === 1 && doubleDecision.events === 1 && doubleDecision.attempts === 1,
    "#146 a double tap must record exactly one decision", doubleDecision);

  await resetState(page);
  const inkIndex = await page.evaluate(() => {
    const idx = BASE_BY_CHAR["水"], m = cardMemory(idx); m.seen = 1; m.target = "水"; m.word = CARDS[idx].word; m.lastAttemptHadInk = true;
    persistRecentInk(m, [[{ x: .2, y: .2, w: 1 }, { x: .5, y: .8, w: .8 }, { x: .8, y: .3, w: .7 }]], Date.now()); saveMemory(); return idx;
  });
  const themeInk = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    const pixels = await page.evaluate(async (idx) => {
      openCharSheet(idx); const preview = charDetailGlyph.querySelector("canvas"), ui = [...preview.getContext("2d").getImageData(0, 0, 1, 1).data];
      const recent = memory[cardKey(idx)].recentInk, image = await loadInkImage(recent.dataURL), fixed = document.createElement("canvas"); fixed.width = 120; fixed.height = 120; fixed.getContext("2d").drawImage(image, 0, 0); const stored = [...fixed.getContext("2d").getImageData(0, 0, 1, 1).data];
      const cardCanvas = await renderHandCardCanvas(idx, "portrait"), cardPaper = [...cardCanvas.getContext("2d").getImageData(0, 0, 1, 1).data]; closeCharSheet();
      return { ui, stored, cardPaper };
    }, inkIndex);
    themeInk.push({ colorScheme, pixels });
  }
  const lightInk = themeInk[0].pixels, darkInk = themeInk[1].pixels;
  assert(Math.min(...lightInk.ui.slice(0, 3)) > 240 && Math.max(...darkInk.ui.slice(0, 3)) < 60
    && lightInk.ui.slice(0, 3).join() !== darkInk.ui.slice(0, 3).join()
    && lightInk.stored.slice(0, 3).join() === darkInk.stored.slice(0, 3).join()
    && lightInk.cardPaper.slice(0, 3).join() === darkInk.cardPaper.slice(0, 3).join()
    && Math.min(...lightInk.stored.slice(0, 3), ...lightInk.cardPaper.slice(0, 3)) > 220,
    "#147 UI ink must follow the theme while stored and exported images stay fixed light", themeInk);

  await page.emulateMedia({ colorScheme: "light" });
  const issue149 = await page.evaluate(async () => {
    const idx = BASE_BY_CHAR["水"], m = cardMemory(idx), blank = { snapshot: snapshotImage([], []), reveal: revealInkImage({ inkStrokes: [] }) };
    m.lastAttemptHadInk = false; openCharSheet(idx); const stale = { story: charDetailStory.textContent, hasCanvas: !!charDetailInk.querySelector("canvas") };
    toggleCharDetailCompare(); toggleCharDetailOverlay(); const overlayOpen = { active: charDetailStandard.parentElement.classList.contains("overlay"), label: charDetailOverlayToggle.textContent };
    toggleCharDetailCompare(); const overlayClosed = { active: charDetailStandard.parentElement.classList.contains("overlay"), label: charDetailOverlayToggle.textContent };
    toggleCharDetailCompare(); const overlayReopened = { active: charDetailStandard.parentElement.classList.contains("overlay"), label: charDetailOverlayToggle.textContent }; closeCharSheet();
    delete m.recentInk; m.recentInkEvictedAt = Date.now(); openCharSheet(idx); const evicted = { copy: charDetailEmpty.textContent, visible: getComputedStyle(charDetailEmpty).display !== "none" }; closeCharSheet();

    const originalWebkit = window.webkit; window.webkit = undefined; openAddSheet(); const webPhotoNote = wildCaptureNote.textContent; window.webkit = originalWebkit;
    wildDraft = { version: 1, day: today(), at: Date.now(), dataURL: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", requestId: ++wildOCRRequest };
    showWildCandidates(["水", "永"], wildOCRRequest); const before = [...wildCandidates.querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed"));
    wildCandidates.querySelector('[data-wild-candidate="水"]').click(); const selected = { value: addInput.value, pressed: wildCandidates.querySelector('[data-wild-candidate="水"]').getAttribute("aria-pressed") };
    wildCandidates.querySelector('[data-wild-candidate="水"]').click(); const deselected = { value: addInput.value, pressed: wildCandidates.querySelector('[data-wild-candidate="水"]').getAttribute("aria-pressed") }; closeAddSheet();

    const previousYear = new Date().getFullYear() - 1, days = Array.from({ length: 5 }, (_, offset) => `${previousYear}-01-0${offset + 1}`);
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.practiceDays = days.slice();
    days.forEach((day, order) => { const row = dailyActivity(day); row.stamps = 1; row.attempts = 1; row.targetKeys = [cardKey(order)]; row.independentTargetKeys = row.targetKeys.slice(); row.completedRoundIds = [`annual-${order}`]; }); saveActivity();
    renderMe(); const meCopy = annualFootText.textContent; const reportOpened = renderAnnualReport(previousYear), options = [...annualYearSelect.options].map((option) => Number(option.value));
    const annual = { reportOpened, options, slides: annualSlides.querySelectorAll(".annualSlide").length, dots: annualDots.querySelectorAll("button").length, meCopy };
    window.shiziCardShared({ status: "shared", kind: "character" }); const shared = $("toast").textContent;
    window.shiziCardShared({ status: "cancelled", kind: "character" }); const cancelled = $("toast").textContent;
    window.shiziCardShared({ status: "failed", kind: "character" }); const failed = $("toast").textContent;
    const uncertainHTML = sumTile({ idx, target: "水", outcome: "hinted", uncertain: true, independentlyRecovered: false }, 0), holder = document.createElement("div"); holder.innerHTML = uncertainHTML;
    return { blank, stale, overlay: { open: overlayOpen, closed: overlayClosed, reopened: overlayReopened }, evicted, webPhotoNote, candidates: { before, selected, deselected }, annual, callbacks: { shared, cancelled, failed }, uncertainAria: holder.firstElementChild.getAttribute("aria-label"), canvas: { role: handCardPreview.getAttribute("role"), label: handCardPreview.getAttribute("aria-label"), fallback: handCardPreview.textContent.trim() } };
  });
  assert(issue149.blank.snapshot === null && issue149.blank.reveal === null, "#149 blank ink must not create a submission image", issue149.blank);
  assert(issue149.stale.story.includes("最近一次练习未留下手写") && issue149.stale.hasCanvas && issue149.evicted.visible && issue149.evicted.copy.includes("节省空间清理"),
    "#149 detail history must distinguish an older sample from an evicted sample", issue149);
  assert(issue149.candidates.before.every((value) => value === "false") && issue149.candidates.selected.value === "水" && issue149.candidates.selected.pressed === "true"
    && issue149.candidates.deselected.value === "" && issue149.candidates.deselected.pressed === "false",
    "#149 OCR candidates must be explicitly selectable and removable", issue149.candidates);
  assert(issue149.overlay.open.active && issue149.overlay.open.label === "并排" && !issue149.overlay.closed.active && issue149.overlay.closed.label === "叠"
    && !issue149.overlay.reopened.active && issue149.overlay.reopened.label === "叠",
    "#149 compare controls must reset their label and state after closing", issue149.overlay);
  assert(issue149.webPhotoNote.includes("手动确认文字") && !issue149.webPhotoNote.includes("本机识别")
    && issue149.uncertainAria.includes("补拾") && issue149.uncertainAria.includes("拿不准") && !issue149.uncertainAria.includes("看提示"),
    "#148/#149 Web photo and uncertain-result accessibility copy must describe the real behavior", { webPhotoNote: issue149.webPhotoNote, uncertainAria: issue149.uncertainAria });
  assert(issue149.annual.reportOpened && issue149.annual.slides === 4 && issue149.annual.dots === 4 && issue149.annual.options.length === 1
    && !issue149.annual.meCopy.includes("年末") && issue149.callbacks.shared === "字卡已分享" && issue149.callbacks.cancelled === "已取消字卡分享" && issue149.callbacks.failed === "字卡分享失败，请再试一次"
    && issue149.canvas.role === "img" && issue149.canvas.label === "手写字卡预览" && issue149.canvas.fallback.length > 0,
    "#149 historical annual reports, native share callbacks, and canvas accessibility must remain complete", issue149);

  const persistence = await page.evaluate(() => {
    const saved = { memory: cloneObj(memory), activity: cloneObj(activity), fsrs: cloneObj(fsrsReviewLog), monthly: cloneObj(fsrsReviewMonthly), funnel: cloneObj(funnel) };
    try {
      const indexes = allIndexes().slice(0, 600), start = new Date(); start.setHours(12, 0, 0, 0);
      activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; fsrsReviewLog = []; fsrsReviewMonthly = {}; memory = {};
      for (let offset = 399; offset >= 0; offset -= 1) {
        const date = new Date(start); date.setDate(date.getDate() - offset); const day = dayKey(date), row = dailyActivity(day); activity.practiceDays.push(day);
        for (let order = 0; order < 15; order += 1) {
          const idx = indexes[(offset * 15 + order) % indexes.length], key = cardKey(idx), reviewedAt = new Date(dayStartMs(day) + (8 * 60 + order) * 60000).toISOString();
          if (!row.targetKeys.includes(key)) row.targetKeys.push(key); if (order < 10) row.independentTargetKeys.push(key); row.stamps++; row.attempts++;
          const attemptId = `long-${offset}-${order}`, rating = order % 5 ? "Good" : "Again";
          fsrsReviewLog.push(makeFSRSEvent({ eventId: fsrsEventId(attemptId), attemptId, cardKey: key, target: CARDS[idx].target, reviewedAt, localDay: day, rating, reason: rating === "Good" ? "independent" : "dontKnow", hintCount: order % 7 === 0 ? 1 : 0, traced: order % 11 === 0, teaching: order % 13 === 0, plannedDue: shiftDay(day, order % 20 + 1), actualIntervalDays: order ? order / 2 : null, scheduledDays: order % 20 + 1 }));
          memory[key] = { seen: (memory[key]?.seen || 0) + 1, last: Date.parse(reviewedAt), lastOutcome: order % 5 ? "fast" : "miss", dueDay: day, pendingLearning: false, target: CARDS[idx].target, word: CARDS[idx].word, fsrsCard: { stability: 8, difficulty: 5, due: reviewedAt, last_review: reviewedAt, state: 2, reps: 10, lapses: 1 } };
        }
        row.completedRoundIds = [`long-round-${offset}`]; row.lastStampAt = dayStartMs(day) + 20 * 3600000;
      }
      const productionFieldCount = Object.keys(fsrsReviewLog.at(-1)).length; saveActivity(); saveFSRSLog(); saveMemory();
      activeMode = "new"; focusQueue = []; removeStored(SESSION_KEY); startRound(); saveSessionSnapshot();
      const session = JSON.parse(localStorage.getItem(SESSION_KEY)), storedFSRS = JSON.parse(localStorage.getItem(FSRS_LOG_KEY)), roundTrip = normalizeFSRSStored(storedFSRS), keys = Object.keys(localStorage).filter((key) => key.startsWith("shizi.") && !key.startsWith("shizi.nativeSmoke"));
      const bytes = keys.reduce((sum, key) => sum + key.length * 2 + String(localStorage.getItem(key) || "").length * 2, 0);
      const storedBytes = String(localStorage.getItem(FSRS_LOG_KEY) || "").length * 2, sample = fsrsReviewLog.at(-1), decoded = roundTrip.events.at(-1);
      return { bytes, storedBytes, version: storedFSRS.version, packedRows: storedFSRS.events.every(Array.isArray), productionFieldCount, roundTripCount: roundTrip.events.length, roundTripSample: sample && decoded && Object.keys(sample).every((key) => JSON.stringify(sample[key]) === JSON.stringify(decoded[key])), rawReviews: fsrsReviewLog.length, archivedMonths: Object.keys(fsrsReviewMonthly).length, rawDays: Object.keys(activity.daily).length, archivedActivityMonths: Object.keys(activity.monthly).length,
        sessionKeys: Object.keys(session), sessionBytes: JSON.stringify(session).length * 2, sessionHasFSRS: JSON.stringify(session).includes("fsrsReviewLog"), sessionHasHandwriting: JSON.stringify(session).includes("handwriting") || JSON.stringify(session).includes("recentInk"), storageLimit: 2 * 1024 * 1024 };
    } finally {
      memory = saved.memory; activity = normalizeActivity(saved.activity); fsrsReviewLog = saved.fsrs; fsrsReviewMonthly = saved.monthly; funnel = normalizeFunnel(saved.funnel);
      saveMemory(); saveActivity(); saveFSRSLog(); saveFunnel(true); removeStored(SESSION_KEY);
    }
  });
  assert(persistence.bytes < persistence.storageLimit && persistence.version === 3 && persistence.packedRows && persistence.productionFieldCount === 19
    && persistence.roundTripCount === persistence.rawReviews && persistence.roundTripSample && persistence.storedBytes < 700 * 1024
    && persistence.rawReviews <= 120 * 15 + 15 && persistence.archivedMonths > 0
    && persistence.rawDays <= 400 && !persistence.sessionHasFSRS && !persistence.sessionHasHandwriting && persistence.sessionBytes < 100 * 1024,
    "#142 a realistic 400-day history must stay below 2 MiB with a compact session", persistence);

  assert(pageErrors.length === 0, "#141-#149 browser errors", pageErrors);
  await browser.close();
  console.log(`Verified issues #141-#149: behavior, layout, accessibility, context quality, and 400-day persistence (${persistence.bytes} total bytes; ${persistence.storedBytes} FSRS bytes).`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exit(1);
});
