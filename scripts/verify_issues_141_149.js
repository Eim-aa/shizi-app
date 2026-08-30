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
const approvedContextQuality = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "context-quality-approved.json"), "utf8"));
const contextQualityExpectations = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "context-quality-expectations.json"), "utf8"));
const jiebaSource = fs.readFileSync(path.join(root, "sources", "jieba_dict.txt"), "utf8");
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

// 候选生成器把 i 和 l 都当熟语，质量门必须用同一套口径
const idiomWords = new Set(jiebaSource.split(/\r?\n/).flatMap((line) => { const parts = line.match(/^(.*) (\d+) (\S+)$/); return parts && (parts[3] === "i" || parts[3] === "l") ? [parts[1]] : []; }));
const rejectedIdioms = deck.filter((card) => idiomWords.has(card.ans) && rejected[card.target]);
const approvedContexts = (approvedContextQuality.approvedContexts || []).map((row) => ({ target: String(row.target), word: String(row.word) }));
const deckByTarget = new Map(deck.map((card) => [card.target, card.ans]));
// 批准项必须绑定到目标字+候选，并且恰好命中一张生产卡
const approvedUnbound = approvedContexts.filter((row) => deckByTarget.get(row.target) !== row.word);
const rejectedApproved = approvedContexts.filter((row) => rejected[row.target]);
const expectKeep = contextQualityExpectations.mustKeep.filter((row) => deckByTarget.get(row.target) !== row.word || rejected[row.target]);
const expectReject = contextQualityExpectations.mustReject.filter((row) => deckByTarget.get(row.target) !== row.word || !rejected[row.target]);
assert(qualitySummary.deckCards === 7294 && qualitySummary.rejectedCards === 1751
  && qualitySummary.reasons.placeholder === 954 && qualitySummary.reasons.low_frequency_long_context === 317
  && qualitySummary.reasons.low_frequency_proper_noun === 480
  && JSON.stringify(qualitySummary.rules.idiomTagsExempted) === JSON.stringify(["i", "l"])
  && qualitySummary.rules.reviewedSafeContexts === approvedContexts.length && placeholders.length === 954
  && placeholders.every((card) => rejected[card.target] === "placeholder"),
"#148 context quality gate must reject every generated placeholder", qualitySummary);
assert(rejectedIdioms.length === 0 && rejectedApproved.length === 0 && approvedUnbound.length === 0
  && ["新陈代谢", "根深蒂固", "千钧一发", "琳琅满目"].every((word) => idiomWords.has(word))
  && ["毋庸置疑", "蔚为壮观", "生拉硬拽", "上蹿下跳", "一颦一笑", "衣衫褴褛"].every((word) => idiomWords.has(word))
  && approvedContexts.some((row) => row.target === "勒" && row.word === "勾勒")
  && approvedContexts.some((row) => row.target === "墨" && row.word === "墨水"),
"#148 context quality gate must preserve tagged idioms and target-bound human approvals", { rejectedIdioms, rejectedApproved, approvedUnbound });
assert(contextQualityExpectations.mustKeep.length === 32 && contextQualityExpectations.mustReject.length === 6
  && expectKeep.length === 0 && expectReject.length === 0,
"#148 the reviewed keep/reject set must be locked item by item, not only by total count", { expectKeep, expectReject });
assert(manualOverlap.length > 0 && source.indexOf('data/context-quality.js') < source.indexOf('data/context-overrides.js')
  && source.includes('if(!override && REJECTED_CONTEXTS[target])')
  && swSource.includes("'data/context-quality.js'") && swSource.includes("'data/context-overrides.js?v=")
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
assert(!source.includes("shortDueDay(m.dueDay)") && source.includes('id="resetConfirmSheet"') && source.includes('id="restoreConfirmSheet"')
  && !source.includes("凭刚才的手感写") && !/\bconfirm\s*\(/.test(source)
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
    resetAccessibleModals(); pendingRestoreRequest = null;
    hideUndoBar(true); unlockGradeActions(); renderHome();
  });
}

async function drawInkStroke(page, start = { x: 0.28, y: 0.3 }, end = { x: 0.72, y: 0.68 }) {
  const before = await page.evaluate(() => inkStrokes.length);
  let lastState = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForFunction(() => {
      if (!inkCanvas || !inkCanvas.isConnected || getComputedStyle(card).display === "none") return false;
      const box = inkCanvas.getBoundingClientRect(), top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width > 100 && box.height > 100 && top === inkCanvas && !drawing;
    });
    const canvas = page.locator(".inkc");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    assert(box, "Expected a visible handwriting canvas");
    await page.mouse.move(box.x + box.width * start.x, box.y + box.height * start.y);
    await page.evaluate(() => {
      const canvasNode = inkCanvas, events = { pointerId: null, down: 0, dragMove: 0, up: 0, cancel: 0, leave: 0, order: [] };
      const samePointer = (event) => events.pointerId === event.pointerId;
      const handlers = {
        pointerdown: (event) => { if (events.pointerId === null) events.pointerId = event.pointerId; if (samePointer(event)) { events.down += 1; events.order.push("down"); } },
        pointermove: (event) => { if (samePointer(event) && (event.buttons & 1)) { events.dragMove += 1; events.order.push("move"); } },
        pointerup: (event) => { if (samePointer(event)) { events.up += 1; events.order.push("up"); } },
        pointercancel: (event) => { if (samePointer(event)) { events.cancel += 1; events.order.push("cancel"); } },
        pointerleave: (event) => { if (samePointer(event)) { events.leave += 1; events.order.push("leave"); } },
      };
      Object.entries(handlers).forEach(([type, handler]) => canvasNode.addEventListener(type, handler, true));
      window.__issueInkPointerProbe = { canvasNode, events, handlers };
    });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * end.x, box.y + box.height * end.y, { steps: 8 });
    await page.mouse.up();
    const attemptState = await page.evaluate((count) => {
      const probe = window.__issueInkPointerProbe;
      if (probe) Object.entries(probe.handlers).forEach(([type, handler]) => probe.canvasNode.removeEventListener(type, handler, true));
      delete window.__issueInkPointerProbe;
      return { inkCount: inkStrokes.length, drawing, connected: !!inkCanvas?.isConnected, sameCanvas: !!probe && probe.canvasNode === inkCanvas && probe.canvasNode.isConnected, events: probe ? { ...probe.events } : {}, cardVisible: getComputedStyle(card).display !== "none", increased: inkStrokes.length > count };
    }, before);
    if (attemptState.increased) {
      await page.waitForTimeout(360);
      return;
    }
    lastState = attemptState;
    const downAt = attemptState.events.order?.indexOf("down") ?? -1, moveAt = attemptState.events.order?.indexOf("move") ?? -1, upAt = attemptState.events.order?.indexOf("up") ?? -1;
    const completeDelivery = attemptState.sameCanvas && attemptState.events.down > 0 && attemptState.events.dragMove > 0 && attemptState.events.up > 0 && downAt >= 0 && moveAt > downAt && upAt > moveAt;
    assert(!completeDelivery, "A complete pointer stroke reached the current canvas but the product discarded it", attemptState);
    await page.evaluate(() => { if (drawing || curInkStroke) cancelCurrentStroke(false); activePointers.clear(); });
    await page.waitForTimeout(120);
  }
  assert(false, "Expected a real pointer stroke to reach the handwriting canvas", lastState);
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
  const liveDayRollover = await page.evaluate(() => {
    startMode("new"); attemptSeq = ROUND_ATTEMPT_BUDGET + 3; roundBudgetAttemptBase = 0; roundElapsedMs = ROUND_TIME_BUDGET_MS + 1000;
    roundActiveStartedAt = Date.now() - 5000; roundBudgetPrompted = true; roundBudgetDate = shiftDay(today(), -1);
    const reached = roundBudgetReached();
    return { reached, elapsed: currentRoundElapsed(), attempts: currentBudgetAttempts(), prompted: roundBudgetPrompted, budgetDate: roundBudgetDate, attemptSeq };
  });
  assert(!liveDayRollover.reached && liveDayRollover.elapsed < 1000 && liveDayRollover.attempts === 0 && !liveDayRollover.prompted
    && liveDayRollover.budgetDate === await page.evaluate(() => today()) && liveDayRollover.attemptSeq === 23,
    "#143 a foreground session crossing midnight must reset its budget without reload or restore", liveDayRollover);

  await resetState(page);
  // 走真实路径：addWord() 收字 → makeupCandidates() 选补帖候选 → 真实 startMakeupDay()。
  // 之前这里手工构造 pendingLearning 并直接灌 focusQueue，绕开了会出问题的三个函数。
  const queueIsolation = await page.evaluate(() => {
    const chars = addWord("强"), queuedIndex = BASE_BY_CHAR["强"], m = cardMemory(queuedIndex);
    const collected = { chars, queuedFront: !!m.queuedFront, pendingLearning: !!m.pendingLearning, dueToday: m.dueDay === today() };
    const candidates = makeupCandidates();
    const pastDay = shiftDay(today(), -2);
    const started = startMakeupDay(pastDay);
    const makeup = { targets: baseTargets.slice(), mode: activeMode, day: makeupTargetDay };
    // 即使这个字因别的原因进了补帖组，写完也不该把置顶兑现掉
    activeMode = "makeup"; recordOutcome(queuedIndex, "fast");
    const afterMakeupOutcome = !!cardMemory(queuedIndex).queuedFront;
    exitCurrentRound(); clearSessionSnapshot(); activeMode = "new"; sessionDone = new Set(); startRound();
    const ordinary = { first: baseTargets[0], queuedIndex, pool: queuedFrontPool().includes(queuedIndex) };
    recordOutcome(queuedIndex, "fast");
    const afterOrdinaryOutcome = !!cardMemory(queuedIndex).queuedFront;
    return { collected, queuedIndex, candidateHit: candidates.includes(queuedIndex), candidateCount: candidates.length,
      started, makeup, makeupHit: makeup.targets.includes(queuedIndex), afterMakeupOutcome, ordinary, afterOrdinaryOutcome };
  });
  assert(queueIsolation.collected.queuedFront && queueIsolation.collected.dueToday && !queueIsolation.collected.pendingLearning
    && !queueIsolation.candidateHit && queueIsolation.candidateCount === 5
    && queueIsolation.started && queueIsolation.makeup.mode === "makeup" && !queueIsolation.makeupHit && queueIsolation.makeup.targets.length === 5
    && queueIsolation.afterMakeupOutcome
    && queueIsolation.ordinary.pool && queueIsolation.ordinary.first === queueIsolation.queuedIndex
    && !queueIsolation.afterOrdinaryOutcome,
    "#141 a really collected character must survive makeup and still lead the next ordinary group", queueIsolation);

  await resetState(page);
  const issue144Seed = await page.evaluate(() => {
    startMode("new"); const raw = localStorage.getItem(SESSION_KEY), session = decodeSessionV3(JSON.parse(raw));
    const focusIndexes = allIndexes().filter((idx) => !session.baseTargets.includes(idx)).slice(0, 3);
    window.__issue144 = { raw, session: cloneObj(session), focusIndexes };
    const started = startFocus(focusIndexes, { returnView: "home" });
    return { started, sheetOpen: focusChoiceSheet.classList.contains("open"), originalMode: session.activeMode, originalIndex: session.currentIndex, focusIndexes, session };
  });
  assert(!issue144Seed.started && issue144Seed.sheetOpen, "#144 an ordinary resumable group must offer a choice before focus practice", issue144Seed);
  await page.click("#focusChoiceSingle");
  await page.waitForFunction(() => activeMode === "focus" && baseTargets.length === 3 && getComputedStyle(card).display !== "none");
  const focusPreserved = await page.evaluate(() => ({ sameStored: JSON.stringify(decodeSessionV3(JSON.parse(localStorage.getItem(SESSION_KEY)))) === JSON.stringify(window.__issue144.session), targets: baseTargets.slice(), expected: window.__issue144.focusIndexes.slice() }));
  await page.click("#exitPractice");
  await page.waitForFunction(() => getComputedStyle(home).display !== "none");
  const afterFocusExit = await page.evaluate(() => { const session = resumableSession(); return { sameStored: JSON.stringify(session) === JSON.stringify(window.__issue144.session), mode: session && session.activeMode, index: session && session.currentIndex, title: homeTitle.textContent.replace(/\s+/g, "") }; });
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.evaluate((expected) => { const session = resumableSession(); return { sameStored: JSON.stringify(session) === JSON.stringify(expected), mode: session && session.activeMode, index: session && session.currentIndex }; }, issue144Seed.session);
  await page.evaluate((indexes) => startFocus(indexes, { returnView: "home" }), issue144Seed.focusIndexes);
  await page.click("#focusChoiceResume");
  await page.waitForFunction((expected) => activeMode === expected.activeMode && currentCardIndex() === expected.currentIndex, issue144Seed.session);
  const resumedOriginal = await page.evaluate((expected) => ({ mode: activeMode, index: currentCardIndex(), expectedMode: expected.activeMode, expectedIndex: expected.currentIndex }), issue144Seed.session);
  assert(focusPreserved.sameStored && JSON.stringify(focusPreserved.targets.slice().sort((a, b) => a - b)) === JSON.stringify(focusPreserved.expected.slice().sort((a, b) => a - b)) && afterFocusExit.sameStored && afterReload.sameStored
    && afterReload.mode === issue144Seed.originalMode && afterReload.index === issue144Seed.originalIndex
    && afterFocusExit.mode === issue144Seed.originalMode && afterFocusExit.index === issue144Seed.originalIndex && afterFocusExit.title.includes("接着写这一组")
    && resumedOriginal.mode === resumedOriginal.expectedMode && resumedOriginal.index === resumedOriginal.expectedIndex,
    "#144 multi-character focus must preserve and resume the exact ordinary group across exit and reload", { focusPreserved, afterFocusExit, afterReload, resumedOriginal });

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
  await drawInkStroke(page);
  await page.waitForTimeout(2700);
  const weakNetwork = await page.evaluate(() => ({ hint: hint.textContent, showEnabled: !show.disabled, doneEnabled: !done.disabled, inkCount: inkStrokes.length, actionsDisabled: actions.getAttribute("aria-disabled") }));
  assert(weakNetwork.hint.includes("加载较慢") && weakNetwork.showEnabled && weakNetwork.doneEnabled && weakNetwork.inkCount === 1 && weakNetwork.actionsDisabled === "false",
    "#146 a hanging stroke loader must explain fallback after the user writes without losing ink or trapping submission", weakNetwork);
  await page.evaluate(() => { window.HanziWriter = window.__issue146Writer; delete window.__issue146Writer; removeStored(SESSION_KEY); focusPreservedSession = null; activeMode = "new"; renderHome(); });
  await page.evaluate(() => startFocus([BASE_BY_CHAR["器"]]));
  await page.waitForFunction(() => !tip.disabled && Array.isArray(curMedians) && curMedians.length > 0);
  await page.click("#tip");
  await page.waitForFunction(() => !animating && actionStack.length === 1 && actionStack[0].type === "hint");
  await drawInkStroke(page, { x: 0.25, y: 0.68 }, { x: 0.72, y: 0.32 });
  const missVisualBefore = await page.evaluate(() => ({ shownStrokes, groupIdx, seenGroups: [...seenGroups], hintsUsedThisCard, inkStrokes: cloneObj(inkStrokes), actions: actionStack.map((item) => item.type) }));
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing" && getComputedStyle(undoBar).display !== "none");
  const missBeforeUndo = await page.evaluate(() => ({ stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length, header: getComputedStyle(document.querySelector(".chdr")).visibility, undo: undoBar.textContent }));
  await page.click("#undoLast");
  await page.waitForFunction(() => practicePhase === "recall" && pendingSessionVisual === null && !animating && actionStack.length === 2 && inkStrokes.length === 1);
  const missAfterUndo = await page.evaluate(async () => {
    lockGradeActions(); const locked = { group: actions.getAttribute("aria-disabled"), buttons: [...actions.querySelectorAll("button")].map((button) => button.getAttribute("aria-disabled")) };
    unlockGradeActions(); const unlocked = { group: actions.getAttribute("aria-disabled"), buttons: [...actions.querySelectorAll("button")].map((button) => button.getAttribute("aria-disabled")) };
    const restored = { shownStrokes, groupIdx, seenGroups: [...seenGroups], hintsUsedThisCard, inkStrokes: cloneObj(inkStrokes), actions: actionStack.map((item) => item.type) };
    const undone = await undoInkStroke();
    const afterStrokeUndo = { undone, shownStrokes, groupIdx, seenGroups: [...seenGroups], hintsUsedThisCard, inkCount: inkStrokes.length, actions: actionStack.map((item) => item.type) };
    return { stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length, phase: practicePhase, locked, unlocked, restored, afterStrokeUndo };
  });
  assert(missBeforeUndo.stats === 1 && missBeforeUndo.events === 1 && missBeforeUndo.attempts === 1 && missBeforeUndo.header === "visible" && missBeforeUndo.undo.includes("重盖")
    && missAfterUndo.stats === 0 && missAfterUndo.events === 0 && missAfterUndo.attempts === 0 && missAfterUndo.phase === "recall"
    && JSON.stringify(missAfterUndo.restored) === JSON.stringify(missVisualBefore)
    && missAfterUndo.afterStrokeUndo.undone && missAfterUndo.afterStrokeUndo.inkCount === 0
    && missAfterUndo.afterStrokeUndo.actions.join() === "hint" && missAfterUndo.afterStrokeUndo.shownStrokes === missVisualBefore.shownStrokes
    && missAfterUndo.afterStrokeUndo.groupIdx === 1 && missAfterUndo.afterStrokeUndo.seenGroups.join() === "0" && missAfterUndo.afterStrokeUndo.hintsUsedThisCard === 1
    && missAfterUndo.locked.group === "true" && missAfterUndo.locked.buttons.every((value) => value === "true")
    && missAfterUndo.unlocked.group === "false" && missAfterUndo.unlocked.buttons.every((value) => value === "false"),
    "#146 don't-know undo must restore the exact hint/ink/action state and keep the next stroke undoable", { missVisualBefore, missBeforeUndo, missAfterUndo });

  // 复核发现：重盖后的视觉是异步 render 才落回来的。用户在这中间返回/刷新/切后台时，
  // 保存下去的是当时的空状态，点拨、墨迹和撤销栈会被写没。这里刻意不等恢复完成。
  // 用多字组，单字专项退出时本来就会清掉快照，测不到这条。
  await page.evaluate(() => { removeStored(SESSION_KEY); focusPreservedSession = null; activeMode = "new"; renderHome(); });
  await page.evaluate(() => startFocus([BASE_BY_CHAR["器"], BASE_BY_CHAR["强"], BASE_BY_CHAR["疑"]], { skipSessionCheck: true }));
  await page.waitForFunction(() => !tip.disabled && Array.isArray(curMedians) && curMedians.length > 0);
  await page.click("#tip");
  await page.waitForFunction(() => !animating && actionStack.length === 1 && actionStack[0].type === "hint");
  await drawInkStroke(page, { x: 0.25, y: 0.68 }, { x: 0.72, y: 0.32 });
  const raceBefore = await page.evaluate(() => ({ shownStrokes, groupIdx, seen: [...seenGroups].length, ink: inkStrokes.length, actions: actionStack.length, targets: baseTargets.length }));
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing" && getComputedStyle(undoBar).display !== "none");
  const undoExitRace = await page.evaluate(() => {
    reopenStampChoices();
    const pendingSet = !!pendingSessionVisual;
    const exited = exitCurrentRound();
    const stored = decodeSessionV3(JSON.parse(localStorage.getItem(SESSION_KEY) || "null"));
    const v = stored && stored.visual;
    return { pendingSet, exited, visual: v ? { shownStrokes: v.shownStrokes, groupIdx: v.groupIdx,
      seen: (v.seenGroups || []).length, ink: (v.inkStrokes || []).length, actions: (v.actionStack || []).length } : null };
  });
  assert(raceBefore.targets === 3 && undoExitRace.pendingSet && undoExitRace.exited && undoExitRace.visual
    && undoExitRace.visual.shownStrokes === raceBefore.shownStrokes && undoExitRace.visual.groupIdx === raceBefore.groupIdx
    && undoExitRace.visual.seen === raceBefore.seen && undoExitRace.visual.ink === raceBefore.ink
    && undoExitRace.visual.actions === raceBefore.actions,
    "#146 returning right after 重盖 must persist the restored visual, not the not-yet-applied empty one", { raceBefore, undoExitRace });
  await resetState(page);
  await page.evaluate(() => startFocus([BASE_BY_CHAR["器"]]));
  await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0);
  const doubleDecision = await page.evaluate(() => {
    const originalSaveSessionSnapshot = saveSessionSnapshot;
    try {
      saveSessionSnapshot = () => { const until = performance.now() + 360; while (performance.now() < until) {} return true; };
      inkStrokes = mediansToCanvas(curMedians); redrawInk(); actionCooldownUntil = 0; revealAnswer();
      decisionCorrect.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      decisionCorrect.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { stamped, stats: roundStats.length, events: fsrsReviewLog.length, attempts: episodeFor(currentCardIndex()).attempts.length };
    } finally { saveSessionSnapshot = originalSaveSessionSnapshot; }
  });
  assert(doubleDecision.stamped && doubleDecision.stats === 1 && doubleDecision.events === 1 && doubleDecision.attempts === 1,
    "#146 a double tap must record exactly one decision", doubleDecision);

  // 上面那组是在同一个同步块里对同一个节点连发两次事件，第二次不经过 hit-test。
  // 这里用真实坐标双击：第一击的同步活阻塞约 360ms，第二击排队后落在当时光标下的元素上。
  await resetState(page);
  await page.evaluate(() => startFocus([BASE_BY_CHAR["器"]]));
  await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0);
  await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); actionCooldownUntil = 0; stamped = false; revealAnswer();
    window.__hits = [];
    document.addEventListener("click", (e) => { const node = e.target.closest("[id]");
      window.__hits.push({ id: node ? node.id : "(none)", cooldownLeft: Math.round(actionCooldownUntil - Date.now()), stamped, phase: practicePhase }); }, true);
  });
  await page.waitForFunction(() => practicePhase === "revealDecision" && getComputedStyle(decisionCorrect).display !== "none");
  const decisionBox = await page.evaluate(() => {
    window.__origSave = saveSessionSnapshot;
    saveSessionSnapshot = () => { const until = performance.now() + 360; while (performance.now() < until) {} return true; };
    const r = decisionCorrect.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const firstTap = page.mouse.click(decisionBox.x, decisionBox.y);
  await page.waitForTimeout(100);
  await page.mouse.click(decisionBox.x, decisionBox.y);
  await firstTap;
  const realDoubleTap = await page.evaluate(() => {
    saveSessionSnapshot = window.__origSave;
    return { stamped, phase: practicePhase, summaryVisible: getComputedStyle(summary).display !== "none",
      stats: roundStats.length, events: fsrsReviewLog.length, hits: window.__hits.slice(0, 4) };
  });
  assert(realDoubleTap.stamped && realDoubleTap.phase === "feedback" && !realDoubleTap.summaryVisible
    && realDoubleTap.stats === 1 && realDoubleTap.events === 1,
    "#146 a real two-finger-speed double tap must not skip the feedback page", realDoubleTap);

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

  await page.evaluate((idx) => { const recent = memory[cardKey(idx)].recentInk; recent.version = 1; delete recent.strokes; saveMemory(); }, inkIndex);
  const legacyThemeInk = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate((idx) => openCharSheet(idx), inkIndex);
    await page.waitForFunction(() => charDetailGlyph.querySelector("canvas")?.dataset.rendered === "true");
    const pixels = await page.evaluate(() => {
      const canvas = charDetailGlyph.querySelector("canvas"), data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, values = [];
      for (let i = 0; i < data.length; i += 4) values.push((data[i] + data[i + 1] + data[i + 2]) / 3);
      return { background: values[0], darkest: Math.min(...values), lightest: Math.max(...values), legacy: canvas.dataset.legacy };
    });
    legacyThemeInk.push({ colorScheme, pixels });
    await page.evaluate(() => closeCharSheet());
  }
  assert(legacyThemeInk[0].pixels.background > 240 && legacyThemeInk[0].pixels.darkest < 100
    && legacyThemeInk[1].pixels.background < 70 && legacyThemeInk[1].pixels.lightest > 150
    && legacyThemeInk.every((row) => row.pixels.legacy === "true"),
    "#147 legacy v1 bitmap ink must be recolored for both light and dark UI themes", legacyThemeInk);

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
    const dotNodes = [...annualDots.querySelectorAll("button")], dotTargets = dotNodes.map((node) => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height }; }); dotNodes[0].focus(); const focusedDot = dotNodes[0]; renderAnnualPager(1);
    const annual = { reportOpened, options, slides: annualSlides.querySelectorAll(".annualSlide").length, dots: annualDots.querySelectorAll("button").length, meCopy, dotTargets, focusPreserved: document.activeElement === focusedDot, current: focusedDot.getAttribute("aria-current") };
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
    && issue149.uncertainAria.includes("补拾") && issue149.uncertainAria.includes("不太确定") && !issue149.uncertainAria.includes("看提示"),
    "#148/#149 Web photo and uncertain-result accessibility copy must describe the real behavior", { webPhotoNote: issue149.webPhotoNote, uncertainAria: issue149.uncertainAria });
  assert(issue149.annual.reportOpened && issue149.annual.slides === 4 && issue149.annual.dots === 4 && issue149.annual.options.length === 1
    && issue149.annual.dotTargets.every((box) => box.width >= 44 && box.height >= 44) && issue149.annual.focusPreserved && issue149.annual.current === "false"
    && !issue149.annual.meCopy.includes("年末") && issue149.callbacks.shared === "字卡已分享" && issue149.callbacks.cancelled === "已取消字卡分享" && issue149.callbacks.failed === "字卡分享失败，请再试一次"
    && issue149.canvas.role === "img" && issue149.canvas.label === "手写字卡预览" && issue149.canvas.fallback.length > 0,
    "#149 historical annual reports, native share callbacks, and canvas accessibility must remain complete", issue149);

  await resetState(page); await page.emulateMedia({ colorScheme: "light" });
  const uncertainDetail = await page.evaluate(() => {
    const idx = BASE_BY_CHAR["水"]; startFocus([idx]); hintEverUsed = true; hintsUsedThisCard = 1; lastVerdict = null;
    recordOutcome("hinted", { uncertain: true, now: Date.now() }); const stored = cloneObj(memory[cardKey(idx)]);
    openCharSheet(idx); const story = charDetailStory.textContent; closeCharSheet();
    const backedUp = JSON.parse(JSON.parse(backupPayload({ preserveMeta: true })).data[MEMORY_KEY])[cardKey(idx)];
    return { lastUncertain: stored.lastUncertain, outcome: stored.lastOutcome, story, backedUp: backedUp.lastUncertain };
  });
  assert(uncertainDetail.lastUncertain && uncertainDetail.backedUp && uncertainDetail.outcome === "hinted"
    && uncertainDetail.story.includes("上次拿不准，记不清") && !uncertainDetail.story.includes("上次看提示写出"),
    "#149 uncertain decisions must keep their own persisted detail language", uncertainDetail);

  await resetState(page);
  const modalIndex = await page.evaluate(() => {
    const idx = BASE_BY_CHAR["水"], m = cardMemory(idx); m.seen = 1; m.target = "水"; m.word = CARDS[idx].word;
    persistRecentInk(m, [[{ x: .2, y: .2, w: 1 }, { x: .5, y: .8, w: .8 }, { x: .8, y: .3, w: .7 }]], Date.now()); saveMemory(); renderBook(); return idx;
  });
  const memoryTrigger = page.locator(`.memoryChar[data-idx="${modalIndex}"]`);
  await memoryTrigger.click();
  await page.waitForFunction(() => document.activeElement === closeCharDetail);
  const charModal = await page.evaluate(() => ({ backgroundInert: document.querySelector(".wrap").inert, backgroundHidden: document.querySelector(".wrap").getAttribute("aria-hidden"), dialogOpen: charSheet.classList.contains("open"), active: document.activeElement.id }));
  await page.click("#charDetailCard");
  await page.waitForFunction(() => handCardSheet.classList.contains("open") && document.activeElement === handCardSave);
  const handCardModal = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".handCardActions button")], boxes = nodes.map((node) => { const box = node.getBoundingClientRect(); return { id: node.id, top: box.top, left: box.left }; });
    return { ids: nodes.map((node) => node.id), boxes, charInert: charSheet.inert, active: document.activeElement.id };
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !handCardSheet.classList.contains("open") && charSheet.classList.contains("open") && document.activeElement === charDetailCard && !charSheet.inert);
  const afterNestedEscape = await page.evaluate(() => ({ charOpen: charSheet.classList.contains("open"), handCardOpen: handCardSheet.classList.contains("open"), active: document.activeElement.id }));
  await page.evaluate((idx) => openWildPhoto(memory[cardKey(idx)].recentInk.dataURL, "水 · 拾于生活"), modalIndex);
  await page.waitForFunction(() => wildPhotoSheet.classList.contains("open") && document.activeElement === wildPhotoClose);
  await page.evaluate(() => window.dispatchEvent(new Event("shizi-native-back")));
  await page.waitForFunction(() => !wildPhotoSheet.classList.contains("open") && charSheet.classList.contains("open") && document.activeElement === charDetailCard && !charSheet.inert);
  const afterNativeBack = await page.evaluate(() => ({ charOpen: charSheet.classList.contains("open"), wildOpen: wildPhotoSheet.classList.contains("open"), stack: accessibleModalStack.map(node => node.id), active: document.activeElement.id }));
  await page.click("#closeCharDetail");
  await page.waitForFunction((idx) => document.activeElement?.matches(`.memoryChar[data-idx="${idx}"]`) && !document.querySelector(".wrap").inert, modalIndex);
  const modalClosed = await page.evaluate(() => ({ backgroundInert: document.querySelector(".wrap").inert, backgroundHidden: document.querySelector(".wrap").hasAttribute("aria-hidden"), activeIndex: document.activeElement.dataset.idx }));
  await page.evaluate(() => { window.__issueArrayAt = Array.prototype.at; Array.prototype.at = undefined; });
  await memoryTrigger.click();
  await page.waitForFunction(() => charSheet.classList.contains("open") && document.activeElement === closeCharDetail && document.querySelector(".wrap").inert);
  const legacyWebKitOpen = await page.evaluate(() => ({ backgroundHidden: document.querySelector(".wrap").getAttribute("aria-hidden"), active: document.activeElement.id }));
  await page.evaluate(() => window.dispatchEvent(new Event("shizi-native-back")));
  await page.waitForFunction((idx) => !charSheet.classList.contains("open") && !document.querySelector(".wrap").inert && document.activeElement?.matches(`.memoryChar[data-idx="${idx}"]`), modalIndex);
  const legacyWebKitModal = await page.evaluate(() => {
    const result = { closed: !charSheet.classList.contains("open"), stack: accessibleModalStack.map(node => node.id), backgroundHidden: document.querySelector(".wrap").hasAttribute("aria-hidden"), activeIndex: document.activeElement.dataset.idx };
    Array.prototype.at = window.__issueArrayAt; delete window.__issueArrayAt; return result;
  });
  assert(charModal.backgroundInert && charModal.backgroundHidden === "true" && charModal.dialogOpen && charModal.active === "closeCharDetail"
    && handCardModal.ids.join() === "handCardSave,handCardShare,handCardCancel" && handCardModal.charInert && handCardModal.active === "handCardSave"
    && handCardModal.boxes[0].top === handCardModal.boxes[1].top && handCardModal.boxes[2].top > handCardModal.boxes[0].top
    && afterNestedEscape.charOpen && !afterNestedEscape.handCardOpen && afterNestedEscape.active === "charDetailCard"
    && afterNativeBack.charOpen && !afterNativeBack.wildOpen && afterNativeBack.stack.join() === "charSheet" && afterNativeBack.active === "charDetailCard"
    && !modalClosed.backgroundInert && !modalClosed.backgroundHidden && Number(modalClosed.activeIndex) === modalIndex
    && legacyWebKitOpen.backgroundHidden === "true" && legacyWebKitOpen.active === "closeCharDetail"
    && legacyWebKitModal.closed && legacyWebKitModal.stack.length === 0 && !legacyWebKitModal.backgroundHidden && Number(legacyWebKitModal.activeIndex) === modalIndex,
    "#149 dialogs must isolate background, close only the top keyboard/native-back layer, preserve iOS 15.0 compatibility, match visual keyboard order, and restore focus", { charModal, handCardModal, afterNestedEscape, afterNativeBack, modalClosed, legacyWebKitOpen, legacyWebKitModal });

  // ── 五个此前只改 class 的弹层：逐个用真实入口验证模态语义 ──────────────────
  // 上面那句总括断言只覆盖了 char/handCard/wildPhoto/restore/reset，却声称
  // "dialogs 均已隔离"，于是 makeup / focus / lib / budget / add 一直假绿——
  // 其中 focusChoiceSheet 正是 #144 的核心新流程。这里逐个弹层从真实入口打开，
  // 各验五件事：焦点进入、Tab 闭环、背景隔离、Esc / 原生返回、关闭后回焦。
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  // 触发器用 data 标记而不是 id 认领：字库行、印历日格都是没有 id 的按钮，
  // 比 id 会两边都是空串，断言等于没写。
  const probeSheet = (sheetId) => page.evaluate(({ id, selector }) => {
    const sheet = document.getElementById(id), wrap = document.querySelector(".wrap"), nodes = [...sheet.querySelectorAll(selector)];
    return { open: sheet.classList.contains("open"), role: sheet.getAttribute("role"), ariaModal: sheet.getAttribute("aria-modal"),
      labelled: !!sheet.getAttribute("aria-labelledby") && !!document.getElementById(sheet.getAttribute("aria-labelledby")),
      stackTop: accessibleModalStack.length ? accessibleModalStack[accessibleModalStack.length - 1].id : null,
      wrapInert: wrap.inert, wrapHidden: wrap.getAttribute("aria-hidden"),
      focusInside: sheet.contains(document.activeElement), focusableCount: nodes.length,
      activeIsTrigger: document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-verify-trigger") };
  }, { id: sheetId, selector: FOCUSABLE });

  const sheetCases = [
    { id: "addSheet", trigger: "#homeAdd", dismiss: "escape",
      setup: () => page.evaluate(() => { clearSessionSnapshot(); renderHome(); displayView("home"); }) },
    { id: "libSheet", trigger: "#settingsLibRow", dismiss: "native",
      setup: () => page.evaluate(() => { renderMe(); renderSettings(false); }) },
    { id: "makeupSheet", trigger: "#calendarGrid [data-makeup]", dismiss: "escape",
      setup: () => page.evaluate(() => { clearSessionSnapshot(); activity.practiceDays = []; saveActivity(); renderMe(); renderCalendar(); }) },
    // #144 的核心流程：手上已有普通组时从「待拾回」发起专项，弹层问原组还是专项。
    // 入口选画像页而不是字详情——字详情那条会先 closeCharSheet()，触发器随之进入
    // inert 的已关闭弹层，App 正确地不会把焦点还回去，那样就测不出回焦这一项。
    { id: "focusChoiceSheet", trigger: "#profilePractice", dismiss: "native",
      setup: () => page.evaluate(() => { clearSessionSnapshot();
        ["水", "永", "的", "一", "人"].forEach((ch) => { const m = cardMemory(BASE_BY_CHAR[ch]); m.seen = 3; m.misses = 2; m.target = ch; });
        saveMemory(); startRound("new"); saveSessionSnapshot(); openProfile(); }) },
    // 出题预算由 attemptSeq - roundBudgetAttemptBase 决定；推到阈值后由 next() 真实唤起，
    // 不直接调 openRoundBudgetSheet，否则测的就不是真实入口。
    { id: "roundBudgetSheet", trigger: "#exitPractice", dismiss: "escape", viaNext: true,
      setup: () => page.evaluate(() => { startRound("new"); roundBudgetPrompted = false; attemptSeq = roundBudgetAttemptBase + ROUND_ATTEMPT_BUDGET; }) },
  ];

  const sheetResults = [];
  for (const item of sheetCases) {
    await item.setup();
    await page.evaluate((sel) => { document.querySelectorAll("[data-verify-trigger]").forEach((n) => n.removeAttribute("data-verify-trigger"));
      document.querySelector(sel).setAttribute("data-verify-trigger", "1"); }, item.trigger);
    if (item.viaNext) await page.evaluate((sel) => { document.querySelector(sel).focus(); next(); }, item.trigger);
    else await page.click(item.trigger);
    await page.waitForFunction((id) => document.getElementById(id).classList.contains("open") && document.getElementById(id).contains(document.activeElement), item.id, { timeout: 4000 });
    const opened = await probeSheet(item.id);
    // Tab 闭环：停在最后一个可聚焦元素上按 Tab，应回到第一个（按序号比，不按 id）
    await page.evaluate(({ id, selector }) => { const nodes = [...document.getElementById(id).querySelectorAll(selector)]; nodes[nodes.length - 1].focus(); }, { id: item.id, selector: FOCUSABLE });
    await page.keyboard.press("Tab");
    const wrapped = await page.evaluate(({ id, selector }) => {
      const nodes = [...document.getElementById(id).querySelectorAll(selector)];
      return { activeIndex: nodes.indexOf(document.activeElement), count: nodes.length };
    }, { id: item.id, selector: FOCUSABLE });
    if (item.dismiss === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("shizi-native-back")));
    await page.waitForFunction((id) => !document.getElementById(id).classList.contains("open"), item.id, { timeout: 4000 });
    // 回焦发生在 requestAnimationFrame 里，而 closeAddSheet 之类会先 blur()，
    // 焦点会短暂落在 body 上——只等"离开弹层"会在回焦之前就把状态读走。
    // 这里等触发器真的拿回焦点；超时不抛，留给下面的断言报出可读的失败。
    await page.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-verify-trigger"),
      null, { timeout: 3000 }).catch(() => {});
    const closed = await probeSheet(item.id);
    sheetResults.push({ id: item.id, dismiss: item.dismiss, trigger: item.trigger, opened, wrapped, closed });
  }

  for (const row of sheetResults) {
    assert(row.opened.open && row.opened.role === "dialog" && row.opened.ariaModal === "true" && row.opened.labelled,
      `#144/#149 ${row.id} must declare itself a labelled modal dialog`, row);
    assert(row.opened.stackTop === row.id && row.opened.wrapInert && row.opened.wrapHidden === "true",
      `#144/#149 ${row.id} must sit on the accessible modal stack and isolate the background`, row);
    assert(row.opened.focusInside && row.opened.focusableCount > 0,
      `#144/#149 ${row.id} must move focus into the dialog on open`, row);
    assert(row.wrapped.count > 1 && row.wrapped.activeIndex === 0,
      `#144/#149 ${row.id} must trap Tab inside the dialog`, row);
    assert(!row.closed.open && !row.closed.wrapInert && row.closed.wrapHidden === null && row.closed.stackTop === null,
      `#144/#149 ${row.id} must release the background after ${row.dismiss}`, row);
    assert(!row.closed.focusInside && row.closed.activeIsTrigger,
      `#144/#149 ${row.id} must return focus to its real trigger after ${row.dismiss}`, row);
  }

  // ── #146 双击防重：两条替代决策分支的真实坐标 hit-test ────────────────────
  // 之前只有普通 pickStamp 一条覆盖，所以 postTrace 与 softConfirm 稳定全绿。
  const doubleTapBranch = async (patch) => {
    await resetState(page);
    await page.evaluate(() => startFocus([BASE_BY_CHAR["器"]]));
    await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0);
    await page.evaluate(() => { inkStrokes = mediansToCanvas(curMedians); redrawInk(); actionCooldownUntil = 0; stamped = false; revealAnswer(); });
    await page.waitForFunction(() => practicePhase === "revealDecision" && getComputedStyle(decisionCorrect).display !== "none");
    const box = await page.evaluate((extra) => {
      submissionSnapshot = Object.freeze({ ...submissionSnapshot, ...extra });
      // 这个探针会被调用多次，监听器必须先摘再挂，否则每次点击会被记多条，
      // 「第二击」的下标就不再稳定。
      if (window.__branchListener) document.removeEventListener("click", window.__branchListener, true);
      window.__branchHits = [];
      window.__branchListener = (e) => { const node = e.target.closest("[id]");
        window.__branchHits.push({ id: node ? node.id : "(none)", cooldownLeft: Math.round(actionCooldownUntil - Date.now()) }); };
      document.addEventListener("click", window.__branchListener, true);
      window.__origSave = saveSessionSnapshot;
      saveSessionSnapshot = () => { const until = performance.now() + 360; while (performance.now() < until) {} return true; };
      const r = decisionCorrect.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, patch);
    const first = page.mouse.click(box.x, box.y);
    await page.waitForTimeout(100);
    await page.mouse.click(box.x, box.y);
    await first;
    // 只证明第二击被挡住是不够的：lockGradeActions() 单独就能挡（冷却是 Infinity），
    // 那样按钮会永远锁死。等冷却窗口过去，再确认评分区真的重新可用，
    // armGradeActions() 才算被这条回归钉住。
    await page.waitForTimeout(400);
    return page.evaluate(() => { saveSessionSnapshot = window.__origSave;
      return { phase: practicePhase, feedbackKind, stamped, softConfirmShown: getComputedStyle(softConfirm).display !== "none",
        cooldownAfterSettle: Math.round(actionCooldownUntil - Date.now()),
        layersUnlocked: GRADE_ACTION_LAYERS.every((id) => { const node = document.getElementById(id); return !node || getComputedStyle(node).pointerEvents !== "none"; }),
        softConfirmBox: (() => { const node = document.querySelector(".softConfirmActions button"); if (!node) return null;
          const box = node.getBoundingClientRect(); return { w: Math.round(box.width), h: Math.round(box.height) }; })(),
        decisionShown: getComputedStyle(decisionRow).display !== "none", hits: window.__branchHits.slice(0, 4) }; });
  };

  const postTraceDouble = await doubleTapBranch({ practicePhase: "postTraceRecall" });
  assert(postTraceDouble.stamped && postTraceDouble.phase === "feedback" && postTraceDouble.feedbackKind === "teachingComplete"
    && postTraceDouble.hits.length >= 2 && postTraceDouble.hits[1].cooldownLeft > 0
    && postTraceDouble.cooldownAfterSettle <= 0 && postTraceDouble.layersUnlocked,
    "#146 the post-trace branch must lock before switching state so a 100ms second tap cannot skip the teaching-complete feedback", postTraceDouble);

  const softConfirmDouble = await doubleTapBranch({ hintEverUsed: false, softConfirmHandled: false,
    lastVerdict: { status: "bad", mode: "exact", failed: [0], u: 0, t: 0, missing: 0 } });
  assert(!softConfirmDouble.stamped && softConfirmDouble.softConfirmShown && !softConfirmDouble.decisionShown
    && softConfirmDouble.hits.length >= 2 && softConfirmDouble.hits[1].cooldownLeft > 0
    && softConfirmDouble.cooldownAfterSettle <= 0 && softConfirmDouble.layersUnlocked,
    "#146 the soft-confirm branch must lock before switching state so a 100ms second tap cannot dismiss the confirmation layer", softConfirmDouble);
  // 软确认按钮只在这一刻真正可见，尺寸就在这里量，不去别处造一个假的可见态。
  assert(softConfirmDouble.softConfirmBox && softConfirmDouble.softConfirmBox.h >= 44 && softConfirmDouble.softConfirmBox.w >= 44,
    '#149 touch target "软确认按钮" must be at least 44x44pt', softConfirmDouble.softConfirmBox);

  // ── #149 年报第四屏日期用中文口径（DEVICE_QA：年度报告日期使用中文） ──────
  await resetState(page);
  const annualDate = await page.evaluate(() => {
    const day = `${new Date().getFullYear()}-01-01`;
    activity.practiceDays = [day]; activity.daily[day] = normalizeActivityDay({ stamps: 1, targetKeys: [cardKey(BASE_BY_CHAR["水"])], completedRoundIds: ["verify"] });
    saveActivity(); renderAnnualReport();
    const slides = document.getElementById("annualSlides");
    return { text: slides.textContent, hasISO: /\d{4}-\d{2}-\d{2}/.test(slides.textContent) };
  });
  assert(!annualDate.hasISO && /\d+年\d+月\d+日/.test(annualDate.text),
    "#149 the annual report must render its first-character date in Chinese, not ISO", annualDate);

  // ── #149 关键触控区不小于 44×44pt（DEVICE_QA 验收项） ────────────────────
  const touchTargets = await page.evaluate(() => {
    const out = [];
    const measure = (selector, label) => { const node = document.querySelector(selector);
      if (!node) { out.push({ label, missing: true }); return; }
      const box = node.getBoundingClientRect(); out.push({ label, w: Math.round(box.width), h: Math.round(box.height) }); };
    renderMe(); measure(".meCalendarHead button", "印历前后月");
    const idx = BASE_BY_CHAR["水"], m = cardMemory(idx); m.seen = 1; m.target = "水";
    persistRecentInk(m, [[{ x: .2, y: .2, w: 1 }, { x: .8, y: .8, w: 1 }]], Date.now()); saveMemory();
    openCharSheet(idx); measure(".charDetailCompareHead button", "字详情 对范字");
    toggleCharDetailCompare(); measure(".charDetailOverlayToggle", "字详情 叠"); closeCharSheet();
    document.getElementById("handCardPrompt").style.display = "flex"; measure(".handCardPrompt button", "字卡 制作"); hideHandCardPrompt();
    return out;
  });
  for (const target of touchTargets) {
    assert(!target.missing && target.h >= 44 && target.w >= 44,
      `#149 touch target "${target.label}" must be at least 44x44pt`, { target, all: touchTargets });
  }

  const restoreSeed = await page.evaluate(() => {
    const current = { "verify:restore-current": { seen: 1, last: Date.now() } }; memory = current; saveMemory();
    const payload = JSON.parse(backupPayload({ preserveMeta: true })); payload.data[MEMORY_KEY] = JSON.stringify({ "verify:restore-incoming": { seen: 1, last: Date.now() - 1000 } });
    document.activeElement.focus(); const staged = restoreBackupPayload(payload, { reload: false }); window.__issueRestorePayload = payload;
    return { staged, copy: restoreConfirmCopy.textContent, active: document.activeElement.id, backgroundInert: document.querySelector(".wrap").inert, currentStored: localStorage.getItem(MEMORY_KEY) };
  });
  await page.waitForFunction(() => document.activeElement === restoreConfirmCancel);
  await page.evaluate(() => window.dispatchEvent(new Event("shizi-native-back")));
  await page.waitForFunction(() => !restoreConfirmSheet.classList.contains("open") && !document.querySelector(".wrap").inert);
  const restoreCancelled = await page.evaluate(() => ({ currentKept: localStorage.getItem(MEMORY_KEY).includes("restore-current"), pending: pendingRestoreRequest }));
  await page.evaluate(() => restoreBackupPayload(window.__issueRestorePayload, { reload: false }));
  await page.waitForFunction(() => document.activeElement === restoreConfirmCancel);
  await page.click("#restoreConfirmDo");
  const restoreConfirmed = await page.evaluate(() => ({ incomingApplied: localStorage.getItem(MEMORY_KEY).includes("restore-incoming"), closed: !restoreConfirmSheet.classList.contains("open"), pending: pendingRestoreRequest }));
  await page.evaluate(() => openResetConfirm());
  await page.waitForFunction(() => resetConfirmSheet.classList.contains("open") && document.activeElement === resetConfirmCancel);
  await page.evaluate(() => window.dispatchEvent(new Event("shizi-native-back")));
  const resetCancelled = await page.evaluate(() => ({ closed: !resetConfirmSheet.classList.contains("open"), incomingKept: localStorage.getItem(MEMORY_KEY).includes("restore-incoming"), stack: accessibleModalStack.map(node => node.id) }));
  assert(restoreSeed.staged.pending && !restoreSeed.staged.applied && restoreSeed.copy.includes("覆盖当前设备上的数据") && restoreSeed.backgroundInert
    && restoreCancelled.currentKept && restoreCancelled.pending === null && restoreConfirmed.incomingApplied && restoreConfirmed.closed && restoreConfirmed.pending === null
    && resetCancelled.closed && resetCancelled.incomingKept && resetCancelled.stack.length === 0,
    "#149 backup restore/reset must use cancellable in-app dialogs that native back closes safely", { restoreSeed, restoreCancelled, restoreConfirmed, resetCancelled });

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
