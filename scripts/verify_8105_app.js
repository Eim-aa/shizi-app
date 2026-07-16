const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(root, "generated", "verify_8105_app.png");
const SESSION_STORAGE_KEY = "shizi.session.v1";
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");

if (/退出本组？|进度已保存，随时可继续这组|这次写对了|这次写错了|描一遍也算拾回|小时后再见/.test(source)) {
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
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const firstRun = await page.evaluate(() => ({
    welcome: getComputedStyle(document.getElementById("welcome")).display !== "none",
    copy: document.getElementById("welcome").textContent.replace(/\s+/g, ""),
    footHidden: getComputedStyle(document.getElementById("foot")).display === "none",
    needsCalibration: needsCalibration(),
    tabs: Array.from(document.querySelectorAll("#foot .tab")).map((node) => node.textContent.replace(/\s+/g, "")),
  }));
  assert(firstRun.welcome && firstRun.footHidden && firstRun.needsCalibration && firstRun.copy.includes("先拾15个字试试") && firstRun.tabs.join() === "拾练习,盒字盒,我我的", "Expected first-run calibration welcome and three-tab IA", firstRun);

  const inheritedDays = await page.evaluate(() => {
    opens = [shiftDay(today(), -3), shiftDay(today(), -2), shiftDay(today(), -1), today()]; save(OPEN_KEY, opens);
    activity = newActivity();
    const inherited = activity.inheritedTotalDays;
    const before = totalPracticeDays();
    const idx = CARDS.findIndex((card) => card.target === "器");
    markPracticeStamp(idx);
    const stampedOnly = totalPracticeDays();
    const complete = (id) => {
      baseTargets = [idx]; batch = baseTargets; baseCursor = 1; unresolved = new Set(); practicePhase = "between";
      roundStats = [{ idx, target: "器", outcome: "fast" }]; roundId = id;
      return markRoundComplete();
    };
    const firstComplete = complete("verify-inherited-1");
    const afterFirst = totalPracticeDays();
    const secondComplete = complete("verify-inherited-2");
    const afterSecond = totalPracticeDays();
    return { inherited, before, stampedOnly, firstComplete, afterFirst, secondComplete, afterSecond };
  });
  assert(inheritedDays.inherited === 3 && inheritedDays.before === 3 && inheritedDays.stampedOnly === 3 && inheritedDays.firstComplete && inheritedDays.secondComplete && inheritedDays.afterFirst === 4 && inheritedDays.afterSecond === 4, "Expected inherited practice days and same-day completion idempotence", inheritedDays);

  const reminderBoundary = await page.evaluate(() => {
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
    renderMe(); syncReminder();
    return {
      median, few, late,
      hiddenInBrowser: getComputedStyle(reminderSection).display === "none" && getComputedStyle(reminderInvite).display === "none",
      sync: cloneObj(reminderDebug.lastSync),
    };
  });
  assert(reminderBoundary.median.hour === 9 && reminderBoundary.median.minute === 24 && reminderBoundary.few.hour === 20 && reminderBoundary.few.minute === 0 && reminderBoundary.late.hour === 22 && reminderBoundary.late.minute === 0 && reminderBoundary.hiddenInBrowser && reminderBoundary.sync.type === "syncReminder", "Expected reminder median, fallback, clamp, and browser fallback boundaries", reminderBoundary);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const baseline = await page.evaluate(() => ({
    seed: SEED.length,
    groups: Object.keys(GROUPS).length,
    cards: CARDS.length,
    fsrsVersion: FSRS.FSRSVersion,
    weights: FSRS.default_w.length,
    scheduler: FSRS_CONFIG,
    decisionLabels: Array.from(document.querySelectorAll("#decisionRow button span")).map((node) => node.textContent),
    oldStampChoices: document.querySelectorAll("#stampRow .stampWrap").length,
    showLabel: document.getElementById("show").textContent,
    viewport: document.querySelector('meta[name="viewport"]').content,
  }));
  assert(baseline.seed === 6854 && baseline.groups === 6854 && baseline.cards >= 6854, "Expected the complete 6854-card corpus", baseline);
  assert(baseline.fsrsVersion.includes("FSRS-6.0") && baseline.weights === 21, "Expected fixed FSRS-6 runtime", baseline);
  assert(baseline.scheduler.desiredRetention === 0.9 && baseline.scheduler.maximumInterval === 150 && baseline.scheduler.parameterVersion === "fsrs6-default-21-v1", "Expected versioned scheduler configuration", baseline.scheduler);
  assert(baseline.decisionLabels.join("/") === "写对了/写错了" && baseline.oldStampChoices === 0 && baseline.showLabel === "不会写", "Expected concise two-decision result semantics", baseline);
  assert(baseline.viewport.includes("viewport-fit=cover") && !/user-scalable=no|maximum-scale=1/.test(baseline.viewport), "Expected scalable safe-area viewport", baseline.viewport);

  const migration = await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "器");
    const future = new Date(); future.setHours(18, 0, 0, 0); future.setDate(future.getDate() + 3);
    const sameDay = new Date(); sameDay.setHours(23, 0, 0, 0);
    const futureMemory = { seen: 1, due: future.getTime() };
    const sameDayMemory = { seen: 1, due: sameDay.getTime() };
    normalizeLegacySchedule(futureMemory); normalizeLegacySchedule(sameDayMemory);
    const v1 = migrateV1Session({ version: 1, date: shiftDay(today(), -1), activeMode: "focus", batch: [idx], pos: 0, roundStats: [], sessionDone: [], roundId: "legacy-v1" });
    return { futureDay: futureMemory.dueDay, expectedFuture: dayKey(future), sameDay: sameDayMemory.dueDay, today: today(), version: v1.version, startedDate: v1.startedDate, currentIndex: v1.currentIndex };
  });
  assert(migration.futureDay === migration.expectedFuture && migration.sameDay === migration.today, "Expected lossless legacy due migration", migration);
  assert(migration.version === 2 && migration.startedDate !== migration.today && Number.isInteger(migration.currentIndex), "Expected cross-midnight v1 session migration", migration);

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

  await page.evaluate(() => {
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    renderHome();
  });

  await page.click("#tabMe");
  const me = await page.evaluate(() => ({ visible: getComputedStyle(mePanel).display !== "none", devHidden: getComputedStyle(devTools).display === "none", reminderHidden: getComputedStyle(reminderSection).display === "none" }));
  assert(me.visible && me.devHidden && me.reminderHidden, "Expected normal My page without development tools", me);
  await page.click("#addLink");
  await page.fill("#addInput", "蘸料");
  await page.click("#addConfirm");
  const add = await page.evaluate(() => ({ added: addedChars.includes("蘸") && addedChars.includes("料"), indexed: indexesForChars(["蘸", "料"]).length === 2, queued: indexesForChars(["蘸", "料"]).every((idx) => (memory[cardKey(idx)] || {}).queuedFront) }));
  assert(add.added && add.indexed && add.queued, "Expected add-character workflow to persist and queue new cards", add);

  await page.evaluate(() => {
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning(); clearSessionSnapshot();
    addWord("强"); addWord("器"); activeMode = "new"; startRound();
  });
  await waitForWriter(page);
  const queuedStart = await page.evaluate(() => ({
    targets: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    current: cur.target,
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
  }));
  assert(queuedStart.targets === "强器" && queuedStart.current === "强" && queuedStart.flags.every(Boolean), "Expected newly added characters to lead a real non-calibration round in entry order", queuedStart);

  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1500);
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
  await page.waitForTimeout(1500);
  assert(await page.evaluate(() => cur.target === "器"), "Expected the second queued card after regrading the first");
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1500);
  const queuedConsumed = await page.evaluate(() => ({
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    targets: roundStats.slice(0, 2).map((row) => row.target).join(""),
  }));
  assert(queuedConsumed.flags.every((flag) => !flag) && queuedConsumed.targets === "强器", "Expected queued cards to be consumed exactly once through the real grading path", queuedConsumed);

  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); sessionDone = new Set(); activeMode = "new"; startRound(); });
  await waitForWriter(page);
  const noSecondForce = await page.evaluate(() => !["强", "器"].includes(cur.target) && queuedFrontPool().every((idx) => !["强", "器"].includes(CARDS[idx].target)));
  assert(noSecondForce, "Expected consumed additions not to be forced at the front of a later round");

  await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning();
    addWord("强"); addWord("器"); activeMode = "calibrate"; startRound();
  });
  await waitForWriter(page);
  const calibrationQueue = await page.evaluate(() => ({
    front: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    size: baseTargets.length,
    unique: new Set(baseTargets).size,
    adultOnly: baseTargets.every((idx) => cardLevel(idx) !== "小学" && contextSource(idx) !== "fallback"),
    ascending: baseTargets.every((idx, order) => order === 0 || cardDifficulty(baseTargets[order - 1]) <= cardDifficulty(idx)),
    labels: { show: show.textContent, done: done.textContent, noNext: !document.getElementById("nextBtn") },
    touch: { done: getComputedStyle(done).touchAction, tab: getComputedStyle(tabPractice).touchAction },
  }));
  assert(calibrationQueue.front !== "强器" && calibrationQueue.flags.every(Boolean) && calibrationQueue.size === 15 && calibrationQueue.unique === 15 && calibrationQueue.adultOnly && calibrationQueue.ascending
    && calibrationQueue.labels.show === "不会写" && calibrationQueue.labels.done === "写好了" && calibrationQueue.labels.noNext && calibrationQueue.touch.done === "manipulation" && calibrationQueue.touch.tab === "manipulation",
  "Expected calibration to keep its adult difficulty ramp while ignoring queued additions without consuming them", calibrationQueue);

  const calibrationIsolation = await page.evaluate(() => {
    const original = calibrationTargets.slice(), originalSet = new Set(original);
    const extras = allIndexes().filter((idx) => !originalSet.has(idx) && qualityAvailable(idx)).slice(0, 3);
    insertIntoCurrentBatch(extras);
    const saved = load(SESSION_KEY, null);
    calibrationTargets = [];
    restoreSession(saved);
    const restored = calibrationTargets.slice();
    roundStats = [
      ...original.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast" })),
      ...extras.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "miss" })),
    ];
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; preference = "balanced";
    const allCounts = roundCounts(), sampleCounts = roundCounts(calibrationRoundStats());
    maybeFinishCalibration();
    return { original, extras, restored, total: baseTargets.length, allCounts, sampleCounts, calibration: cloneObj(tuning.calibration), preference, offset: tuning.offset };
  });
  assert(calibrationIsolation.original.length === 15 && calibrationIsolation.extras.length === 3 && calibrationIsolation.total === 18
    && calibrationIsolation.restored.join() === calibrationIsolation.original.join() && calibrationIsolation.allCounts.fast === 15 && calibrationIsolation.allCounts.miss === 3
    && calibrationIsolation.sampleCounts.fast === 15 && calibrationIsolation.sampleCounts.miss === 0 && calibrationIsolation.calibration.sampleSize === 15
    && calibrationIsolation.calibration.counts.fast === 15 && calibrationIsolation.calibration.counts.miss === 0 && calibrationIsolation.preference === "challenge" && calibrationIsolation.offset === 10,
  "Expected added calibration cards to persist and learn without changing the original 15-card calibration result", calibrationIsolation);

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
    startFocus([CARDS.findIndex((card) => card.target === "器")]);
  });
  await submitStandard(page);
  await chooseCorrect(page);
  const repeatTarget = await page.evaluate(() => cur.target);
  await page.click("#addInPractice");
  await page.fill("#addInput", repeatTarget);
  const repeatExit = await page.evaluate(() => {
    confirmAdd();
    const before = { baseCursor, total: baseTargets.length, queue: cloneObj(manualQueue), phase: practicePhase };
    exitCurrentRound(false);
    return { before, saved: load(SESSION_KEY, null), home: getComputedStyle(home).display !== "none" };
  });
  assert(repeatExit.home && repeatExit.before.baseCursor === repeatExit.before.total && repeatExit.before.phase === "feedback"
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
  assert(repeatedAfterRestore.target === repeatTarget && repeatedAfterRestore.kind === "manual" && repeatedAfterRestore.queue === 0 && repeatedAfterRestore.total === 1 && repeatedAfterRestore.summary === "none" && repeatedAfterRestore.session,
  "Expected the restored next card to consume the queued repeat without growing the group", repeatedAfterRestore);

  const completionHaptics = await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; saveActivity();
    reminder.milestonesShown = []; saveReminder(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); activeMode = "new";
    const indexes = indexesForChars(["强", "器", "疑"]);
    baseTargets = indexes.slice(0, 2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-milestone";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    const milestone = hapticDebug.events.slice();
    baseTargets = indexes.slice(2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-ordinary";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    return { milestone, ordinary: hapticDebug.events.slice(), groups: dailyActivity().completedGroups, totalDays: totalPracticeDays() };
  });
  assert(completionHaptics.milestone.join() === "milestone" && completionHaptics.ordinary.join() === "action" && completionHaptics.groups === 2 && completionHaptics.totalDays === 1, "Expected milestone and ordinary completion haptics to be mutually exclusive", completionHaptics);

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
    clearInk(); actionStack = []; seenGroups = new Set(); groups = [1, 1]; groupIdx = 0; shownStrokes = 0; hintsUsedThisCard = 0; hintEverUsed = false;
    writer = { animateStroke: async () => {} }; updateTip();
    addStroke(); await tip.onclick(); addStroke();
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
    return { stacked, afterStroke, afterHint, empty, rewritten, replayUse, newUse, duringPlayback, afterPlayback, afterInterrupt };
  });
  assert(handwritingBoundaries.stacked === "stroke,hint,stroke"
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
  const peekBoundary = await page.evaluate(() => {
    const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const pointer = (type, id, primary, x, y, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: primary, button: 0, buttons, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y });
    const pixels = () => { const data = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1; return count; };
    clearInk(); activePointers.clear(); peekReleasePending = false; tracing = false; revealed = false; animating = false;
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
    return { entered, cancelled, blocked, restoredOnAnyLift, releaseBlocked, ended, nextGestureWrites };
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
  assert(snapshot.label === "提交字格" && snapshot.hintIds === 1 && snapshot.hintGeometry === 1 && snapshot.composite === snapshot.hintGeometry + snapshot.ink && snapshot.verdict === "ok" && snapshot.hintEverUsed && snapshot.image, "Expected one immutable complete-grid submission snapshot", snapshot);
  assert(snapshot.effect.includes("已用提示"), "Expected correct action to explain reinforcement consequence", snapshot.effect);

  await chooseCorrect(page);
  await page.waitForTimeout(450);
  const hold = await page.evaluate(() => ({ sameTarget: cur.target, feedback: stampedToast.textContent, outcome: roundStats[0] && roundStats[0].outcome, ratings: fsrsReviewLog.map((event) => event.rating), unresolved: [...unresolved] }));
  assert(hold.sameTarget === firstTarget && hold.feedback.includes("已加入本组巩固") && hold.outcome === "hinted" && hold.ratings.join() === "Again" && hold.unresolved.length === 1, "Expected 1.4s hinted feedback with one Again", hold);

  await page.click("#editStamp");
  const rollback = await page.evaluate(() => ({ phase: practicePhase, events: fsrsReviewLog.length, stats: roundStats.length, attempts: dailyActivity().attempts, stamps: dailyActivity().stamps, queue: reinforcementQueue.length, unresolved: unresolved.size, image: submissionSnapshot.compositeImage }));
  assert(rollback.phase === "revealDecision" && rollback.events === 0 && rollback.stats === 0 && rollback.attempts === 0 && rollback.stamps === 0 && rollback.queue === 0 && rollback.unresolved === 0 && rollback.image, "Expected atomic edit rollback", rollback);

  await chooseCorrect(page);
  await page.waitForTimeout(1500);
  const afterHint = await page.evaluate(() => ({ baseCursor, attemptSeq, unresolved: [...unresolved], queue: cloneObj(reinforcementQueue), target: cur.target }));
  assert(afterHint.baseCursor === 1 && afterHint.attemptSeq === 1 && afterHint.unresolved.length === 1 && afterHint.queue[0].eligibleAfter === 3 && afterHint.target !== firstTarget, "Expected hinted target to wait behind two other attempts", afterHint);

  const undoLayout = await page.evaluate(() => {
    renderUndoBar();
    const snapshot = lastStampSnapshot; const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const beforeTop = boxwrap.getBoundingClientRect().top; const style = getComputedStyle(undoBar);
    const pointer = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 82001, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: rect.left + 30, clientY: rect.top + 30 });
    canvas.dispatchEvent(pointer("pointerdown", 1)); canvas.dispatchEvent(pointer("pointerup", 0));
    const hiddenOnWrite = getComputedStyle(undoBar).display === "none";
    const afterTop = boxwrap.getBoundingClientRect().top;
    clearInk(); actionCooldownUntil = 0; lastStampSnapshot = snapshot; renderUndoBar();
    const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    const noOverlap = bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right;
    return { position: style.position, hiddenOnWrite, shift: Math.abs(afterTop - beforeTop), restored: getComputedStyle(undoBar).display !== "none", noOverlap };
  });
  await page.setViewportSize({ width: 390, height: 620 });
  const undoShortLayout = await page.evaluate(() => {
    renderUndoBar(); const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    return { visible: getComputedStyle(undoBar).display !== "none", noOverlap: bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right, top: bar.top, bottom: bar.bottom };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(undoLayout.position === "absolute" && undoLayout.hiddenOnWrite && undoLayout.shift <= 0.5 && undoLayout.restored && undoLayout.noOverlap && undoShortLayout.visible && undoShortLayout.noOverlap, "Expected cross-card undo bar to float without shifting or overlapping short screens", { undoLayout, undoShortLayout });

  for (let i = 0; i < 2; i += 1) {
    await submitStandard(page);
    await chooseCorrect(page);
    await page.waitForTimeout(1500);
  }
  const reinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, baseCursor, attemptSeq, unresolved: [...unresolved], progress: posLabel.textContent, targets: baseTargets.slice(), stats: roundStats.map((row) => row.idx) }));
  assert(reinforcement.target === firstTarget && reinforcement.kind === "reinforcement" && reinforcement.baseCursor === 3 && reinforcement.attemptSeq === 3 && reinforcement.progress === "待巩固 1", "Expected two-card spacing and simplified reinforcement progress", reinforcement);

  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await waitForWriter(page);
  const restoredReinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, phase: practicePhase, unresolved: unresolved.size }));
  assert(restoredReinforcement.target === firstTarget && restoredReinforcement.kind === "reinforcement" && restoredReinforcement.phase === "reinforcement" && restoredReinforcement.unresolved === 1, "Expected reinforcement state to survive session restore", restoredReinforcement);

  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1500);
  const completed = await page.evaluate(() => ({
    summary: getComputedStyle(summary).display !== "none",
    stats: cloneObj(roundStats),
    log: cloneObj(fsrsReviewLog),
    activity: cloneObj(dailyActivity()),
    groups: dailyActivity().completedGroups,
    session: localStorage.getItem(SESSION_KEY),
    tomorrow: shiftDay(today(), 1),
    memory: cloneObj(memory),
  }));
  assert(completed.summary && completed.stats.length === 3 && completed.stats[0].outcome === "hinted" && completed.stats[0].independentlyRecovered, "Expected one summary tile per base target with recovery state", completed.stats);
  assert(completed.log.map((event) => event.rating).join() === "Again,Good,Good,Good" && completed.log.every((event) => !["Hard", "Easy"].includes(event.rating)), "Expected Again/Good-only FSRS events", completed.log);
  assert(completed.activity.stamps === 3 && completed.activity.attempts === 4 && completed.groups === 1 && completed.session === null, "Expected unique-day counts, attempt counts, and true completion", completed.activity);
  assert(Object.values(completed.memory).every((item) => !item.pendingLearning && item.dueDay >= completed.tomorrow && item.schedulerVersion.includes("FSRS-6.0")), "Expected graduated cards to expose next-day-or-later dueDay", completed.memory);

  const summaryLayer = await page.evaluate(() => ({
    targets: Array.from(document.querySelectorAll("#sumTiles .sumTile[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    tiles: document.querySelectorAll("#sumTiles .sumTile[data-idx]").length,
    lead: sumLead.textContent.replace(/\s+/g, ""),
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
  if (await page.evaluate(() => boxAllSection.offsetParent === null)) await page.click("#boxAllToggle");
  const bookLayer = await page.evaluate(() => ({
    count: boxCount.textContent,
    targets: Array.from(document.querySelectorAll("#boxGrid .boxTile[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    active: tabBook.classList.contains("active"),
  }));
  assert(summaryLayer.tiles === 3 && summaryLayer.lead.includes("3") && homeLayer.title.includes("今日已拾3个字") && homeLayer.label === "今日拾得" && homeLayer.completed && bookLayer.count.includes("3") && bookLayer.active
    && summaryLayer.targets.join() === homeLayer.targets.join() && summaryLayer.targets.every((target) => bookLayer.targets.includes(target)),
  "Expected the same completed targets across summary, home recent, and study-book layers", { summaryLayer, homeLayer, bookLayer });

  await page.evaluate(() => { clearSessionSnapshot(); traceTutorialShown = false; save(TRACE_TUTORIAL_KEY, false); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
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
    && dontKnow.title.includes("1/2 描写") && dontKnow.intro && dontKnow.introCopy.includes("接着答案会隐藏") && dontKnow.noRecallTools
    && (dontKnow.outlinePaths>0 || dontKnow.fallback) && (!dontKnow.outlineBox || (dontKnow.outlineBox.width>200 && dontKnow.outlineBox.height>200))
    && dontKnow.haptics.join() === "select" && !dontKnow.shown && dontKnow.attempts === 1 && dontKnow.unresolved === 1,
  "Expected don't-know to enter non-blocking tracing immediately with one miss/Again", dontKnow);
  await page.evaluate(() => { inkBegin({ x: 20, y: 20 }); inkMove({ x: 80, y: 80 }); inkEnd(); });
  const traceStart = await page.evaluate(() => ({ title: phaseTitle.textContent, disabled: traceDone.disabled, introHidden: getComputedStyle(traceIntro).display === "none", shown: traceTutorialShown, stored: load(TRACE_TUTORIAL_KEY, false) }));
  assert(traceStart.title.includes("1/2 描写") && !traceStart.disabled && traceStart.introHidden && traceStart.shown && traceStart.stored, "Expected first valid trace to dismiss and persist the inline explanation", traceStart);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "tracing" && tracedThisCard && inkStrokes.length === 1);
  const restoredTracing = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, outline: hzEl.childNodes.length > 0 || hzEl.classList.contains("traceFallback"), ink: inkStrokes.length }));
  assert(restoredTracing.phase === "tracing" && restoredTracing.title.includes("1/2 描写") && restoredTracing.outline && restoredTracing.ink === 1, "Expected tracing ink and outline to survive session restore", restoredTracing);
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await page.click("#traceDone");
  const postTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled, tipDisplay: getComputedStyle(tip).display, show: show.textContent, clear: clear.textContent, haptics: hapticDebug.events.slice() }));
  assert(postTrace.phase === "postTraceRecall" && postTrace.title.includes("2/2 自己写") && postTrace.ink === 0 && !postTrace.hintLayer && !postTrace.fallback && postTrace.tipDisabled && postTrace.tipDisplay === "none" && postTrace.show === "再描一遍" && postTrace.clear === "重写" && postTrace.haptics.length === 0, "Expected outline-free step-two recall with only its own tools", postTrace);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "postTraceRecall");
  const restoredPostTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled }));
  assert(restoredPostTrace.phase === "postTraceRecall" && restoredPostTrace.title.includes("2/2 自己写") && restoredPostTrace.ink === 0 && !restoredPostTrace.hintLayer && !restoredPostTrace.fallback && restoredPostTrace.tipDisabled, "Expected post-trace recall to restore without teaching geometry", restoredPostTrace);

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
  await page.waitForTimeout(1500);
  const afterTeaching = await page.evaluate(() => ({ kind: currentAttemptKind, phase: practicePhase, ratings: fsrsReviewLog.slice(-1).map((event) => event.rating), teachingComplete: Object.values(episodes)[0].teachingComplete, unresolved: unresolved.size }));
  assert(afterTeaching.kind === "reinforcement" && afterTeaching.phase === "reinforcement" && afterTeaching.ratings.join() === "Again" && afterTeaching.teachingComplete && afterTeaching.unresolved === 1, "Expected post-trace success to remain unresolved without Good", afterTeaching);
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1500);
  const teachingDone = await page.evaluate(() => ({ ratings: fsrsReviewLog.slice(-2).map((event) => event.rating), stat: roundStats[0], tutorialStored: load(TRACE_TUTORIAL_KEY, false), summary: getComputedStyle(summary).display !== "none" }));
  assert(teachingDone.ratings.join() === "Again,Good" && teachingDone.stat.outcome === "miss" && teachingDone.stat.traced && teachingDone.stat.independentlyRecovered && teachingDone.tutorialStored && teachingDone.summary, "Expected later independent recovery to graduate the don't-know episode", teachingDone);

  await page.evaluate(() => { clearSessionSnapshot(); startFocus([CARDS.findIndex((card) => card.target === "疑")]); });
  await waitForWriter(page);
  await page.evaluate(() => { shownStrokes = 1; groupIdx = 1; hintEverUsed = true; hintsUsedThisCard = 1; inkStrokes = mediansToCanvas(curMedians.slice(1)); redrawInk(); revealAnswer(); const s = load(SESSION_KEY, null); s.startedDate = shiftDay(today(), -1); save(SESSION_KEY, s); });
  const frozenBefore = await page.evaluate(() => JSON.stringify(submissionSnapshot));
  await page.reload({ waitUntil: "networkidle" });
  const resumable = await page.evaluate(() => resumableSession());
  assert(resumable && resumable.version === 2 && resumable.startedDate !== await page.evaluate(() => today()), "Expected cross-midnight session to remain resumable", resumable);
  await page.evaluate((session) => restoreSession(session), resumable);
  await page.waitForFunction(() => getComputedStyle(reveal).display !== "none" && submissionSnapshot);
  const restored = await page.evaluate(() => ({ frozen: JSON.stringify(submissionSnapshot), phase: practicePhase, hintEverUsed, eventCount: fsrsReviewLog.length, history: history.state && history.state.shiziView }));
  assert(restored.frozen === frozenBefore && restored.phase === "revealDecision" && restored.hintEverUsed && restored.history === "practice", "Expected exact reveal snapshot and practice history restoration", restored);

  const historyStart = await page.evaluate(() => ({ length: history.length, state: history.state && history.state.shiziView }));
  await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value){ if(key === SESSION_KEY) throw new Error("verify quota"); return window.__originalSetItem.call(this, key, value); }; });
  await page.click("#exitPractice");
  const failedExit = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), message: document.getElementById("toast").textContent, armed: practiceHistoryArmed }));
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; delete window.__originalSetItem; });
  assert(failedExit.card && failedExit.phase === "revealDecision" && failedExit.frozen === frozenBefore && failedExit.message.includes("未能保存进度") && failedExit.armed, "Expected persistence failure to keep the exact practice state with a retry message", failedExit);

  await page.click("#addInPractice");
  await page.waitForFunction(() => addSheet.classList.contains("open"));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !addSheet.classList.contains("open") && history.state && history.state.shiziView === "practice");
  const panelBack = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), length: history.length }));
  assert(panelBack.card && panelBack.phase === "revealDecision" && panelBack.frozen === frozenBefore && panelBack.length === historyStart.length, "Expected back to close the add-character panel before leaving practice", panelBack);

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
  assert(directReturns[0].nativeEvent && directReturns.every((row) => row.session && row.session.version === 2 && row.history === "home" && row.length === historyStart.length && !row.toast.includes("进度已保存"))
    && exited.home && exited.session && exited.session.version === 2 && !exited.armed && exited.history === "home" && exited.length === historyStart.length
    && homeBack.home && !homeBack.armed && homeBack.history === "home" && homeBack.length === historyStart.length,
  "Expected repeated direct returns to save v2 state without dialogs, toasts, or history growth", { exited, directReturns, homeBack });

  const backup = await page.evaluate(() => {
    const payload = JSON.parse(backupPayload());
    localStorage.setItem("shizi.unknown.verify", "keep-local");
    const restoredResult = restoreBackupPayload(payload, { skipConfirm: true, reload: false });
    const result = { keys: Object.keys(payload.data), sessionVersion: JSON.parse(payload.data[SESSION_KEY]).version, fsrsLog: !!payload.data[FSRS_LOG_KEY], tutorial: payload.data[TRACE_TUTORIAL_KEY], restoredKeys: restoredResult.keys, unknown: localStorage.getItem("shizi.unknown.verify") };
    localStorage.removeItem("shizi.unknown.verify"); return result;
  });
  assert(backup.keys.includes(SESSION_STORAGE_KEY) && backup.sessionVersion === 2 && backup.fsrsLog && backup.tutorial === "true" && backup.restoredKeys.includes(SESSION_STORAGE_KEY) && backup.unknown === "keep-local", "Expected session/FSRS/tutorial backup round trip with allowlist isolation", backup);

  const backupCoverage = await page.evaluate(() => {
    const excluded = new Set(["shizi.nativeSmoke.v1"]);
    return Object.keys(localStorage).filter((key) => key.startsWith("shizi.") && !BACKUP_KEYS.includes(key) && !excluded.has(key));
  });
  assert(backupCoverage.length === 0, "Expected every persistent shizi key to be backed up or explicitly excluded", backupCoverage);

  await page.setViewportSize({ width: 320, height: 620 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { const s = resumableSession(); if (s) restoreSession(s); });
  await page.waitForFunction(() => getComputedStyle(reveal).display !== "none");
  const compact = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".cmpBox")).map((node) => node.getBoundingClientRect());
    const cardRect = card.getBoundingClientRect(), back = exitPractice.getBoundingClientRect(), progress = posLabel.getBoundingClientRect(), add = addInPractice.getBoundingClientRect(), progressStyle = getComputedStyle(posLabel);
    return { widths: boxes.map((box) => box.width), within: boxes.every((box) => box.left >= cardRect.left && box.right <= cardRect.right), actions: decisionRow.getBoundingClientRect().bottom <= innerHeight + 1,
      header: { backSize: [back.width, back.height], noOverlap: back.right <= progress.left && progress.right <= add.left, nowrap: progressStyle.whiteSpace === "nowrap", oneLine: posLabel.scrollHeight <= posLabel.clientHeight + 1, noGraphicProgress: !document.querySelector(".beads,.bead,progress,[role=progressbar]") } };
  });
  assert(compact.widths.every((width) => width <= 138.5) && compact.within && compact.actions && compact.header.backSize.every((value) => value >= 44) && compact.header.noOverlap && compact.header.nowrap && compact.header.oneLine && compact.header.noGraphicProgress, "Expected dark small-screen comparison and text-only header to fit", compact);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  assert(pageErrors.length === 0, "Browser console/page errors", pageErrors);
  await browser.close();
  console.log(`Verified FSRS-6 dual-loop practice, migration, persistence, backup, history, and ${baseline.cards} cards.`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
