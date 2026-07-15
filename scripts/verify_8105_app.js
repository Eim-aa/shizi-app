const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(root, "generated", "verify_8105_app.png");
const SESSION_STORAGE_KEY = "shizi.session.v1";
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");

if (/看答案|描一遍也算拾回|小时后再见/.test(source)) {
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
  assert(baseline.decisionLabels.join("/") === "这次写对了/这次写错了" && baseline.oldStampChoices === 0 && baseline.showLabel === "不会写", "Expected two-decision result semantics", baseline);
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
      reinforcementQueue: cloneObj(reinforcementQueue), unresolved: [...unresolved], episodes: cloneObj(episodes),
      attemptSeq, practicePhase, memory: cloneObj(memory), quality: cloneObj(quality), activity: cloneObj(activity), sessionDone: [...sessionDone],
    };
    const indexes = ["器", "疑", "强", "赢", "衡", "辩", "警", "藏", "骤", "疆", "戴", "覆", "醒", "耀", "攀"].map((target) => CARDS.findIndex((card) => card.target === target));
    const resetQueue = (total, cursor) => {
      baseTargets = indexes.slice(0, total); batch = baseTargets; baseCursor = cursor; attemptSeq = cursor;
      currentIndex = baseTargets[Math.min(cursor, total - 1)]; reinforcementQueue = []; unresolved = new Set(); episodes = {}; practicePhase = "between";
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
    reinforcementQueue = saved.reinforcementQueue; unresolved = new Set(saved.unresolved); episodes = saved.episodes; attemptSeq = saved.attemptSeq; practicePhase = saved.practicePhase;
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
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    clearSessionSnapshot(); sessionDone = new Set();
    const indexes = ["器", "疑", "强"].map((target) => CARDS.findIndex((card) => card.target === target));
    startFocus(indexes);
  });
  await waitForWriter(page);
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

  for (let i = 0; i < 2; i += 1) {
    await submitStandard(page);
    await chooseCorrect(page);
    await page.waitForTimeout(1500);
  }
  const reinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, baseCursor, attemptSeq, unresolved: [...unresolved], progress: posLabel.textContent }));
  assert(reinforcement.target === firstTarget && reinforcement.kind === "reinforcement" && reinforcement.baseCursor === 3 && reinforcement.attemptSeq === 3 && reinforcement.progress.includes("3 个字已完成") && reinforcement.progress.includes("还差 1 个"), "Expected two-card spacing and reinforcement progress", reinforcement);

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

  await page.evaluate(() => { clearSessionSnapshot(); traceTutorialShown = false; save(TRACE_TUTORIAL_KEY, false); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "feedback");
  const dontKnow = await page.evaluate(() => ({ outcome: roundStats[0].outcome, ratings: fsrsReviewLog.slice(-1).map((event) => `${event.rating}:${event.reason}:${event.teaching}`), feedback: stampedToast.textContent }));
  assert(dontKnow.outcome === "miss" && dontKnow.ratings.join() === "Again:dontKnow:true" && dontKnow.feedback.includes("先描一遍，再自己写"), "Expected don't-know to record one miss/Again before teaching", dontKnow);
  await page.waitForTimeout(1500);
  const tutorial = await page.evaluate(() => ({ phase: practicePhase, visible: getComputedStyle(traceTutorial).display !== "none", shown: traceTutorialShown, copy: traceTutorial.textContent.replace(/\s+/g, "") }));
  assert(tutorial.phase === "traceTutorial" && tutorial.visible && !tutorial.shown && tutorial.copy.includes("先照着轮廓描一遍") && tutorial.copy.includes("必须自己再写一次"), "Expected one-time trace tutorial", tutorial);
  await page.click("#traceTutorialStart");
  await page.waitForFunction(() => practicePhase === "tracing");
  const traceStart = await page.evaluate(() => ({ title: phaseTitle.textContent, disabled: traceDone.disabled, shown: traceTutorialShown, stored: load(TRACE_TUTORIAL_KEY, false) }));
  assert(traceStart.title.includes("第 1 步") && traceStart.disabled && traceStart.shown && traceStart.stored, "Expected persisted step-one tracing gate", traceStart);
  await page.evaluate(() => { inkStrokes = [mediansToCanvas(curMedians)[0]]; tracedThisCard = true; redrawInk(); updateInkControls(); });
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "tracing" && tracedThisCard && inkStrokes.length === 1);
  const restoredTracing = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, outline: hzEl.childNodes.length > 0 || hzEl.classList.contains("traceFallback"), ink: inkStrokes.length }));
  assert(restoredTracing.phase === "tracing" && restoredTracing.title.includes("第 1 步") && restoredTracing.outline && restoredTracing.ink === 1, "Expected tracing ink and outline to survive session restore", restoredTracing);
  await page.click("#traceDone");
  const postTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled, tipVisible: getComputedStyle(tip).visibility, show: show.textContent }));
  assert(postTrace.phase === "postTraceRecall" && postTrace.title.includes("第 2 步") && postTrace.ink === 0 && !postTrace.hintLayer && !postTrace.fallback && postTrace.tipDisabled && postTrace.tipVisible === "hidden" && postTrace.show === "再描一遍", "Expected outline-free step-two recall", postTrace);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "postTraceRecall");
  const restoredPostTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled }));
  assert(restoredPostTrace.phase === "postTraceRecall" && restoredPostTrace.title.includes("第 2 步") && restoredPostTrace.ink === 0 && !restoredPostTrace.hintLayer && !restoredPostTrace.fallback && restoredPostTrace.tipDisabled, "Expected post-trace recall to restore without teaching geometry", restoredPostTrace);

  await submitStandard(page);
  await page.click("#decisionWrong");
  await page.waitForFunction(() => practicePhase === "tracing");
  const teachingWrong = await page.evaluate(() => ({ events: fsrsReviewLog.filter((event) => event.attemptId === currentAttemptId).length, attempts: episodeFor(currentCardIndex()).attempts.length }));
  assert(teachingWrong.events === 1 && teachingWrong.attempts === 1, "Expected teaching retry not to create another review", teachingWrong);
  await page.evaluate(() => { inkStrokes = [mediansToCanvas(curMedians)[0]]; tracedThisCard = true; redrawInk(); updateInkControls(); });
  await page.click("#traceDone");
  await submitStandard(page);
  await page.click("#decisionCorrect");
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

  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.getElementById("exitSheet").classList.contains("open"));
  const swipeOpen = await page.evaluate(() => ({ history: history.state && history.state.shiziView, phase: practicePhase, frozen: JSON.stringify(submissionSnapshot) }));
  assert(swipeOpen.history === "practice" && swipeOpen.phase === "revealDecision" && swipeOpen.frozen === frozenBefore, "Expected swipe guard to preserve practice state", swipeOpen);
  await page.click("#exitCancel");
  const cancelled = await page.evaluate(() => ({ open: exitSheet.classList.contains("open"), history: history.state && history.state.shiziView, frozen: JSON.stringify(submissionSnapshot) }));
  assert(!cancelled.open && cancelled.history === "practice" && cancelled.frozen === frozenBefore, "Expected swipe cancellation without another history layer", cancelled);
  await page.click("#exitPractice");
  await page.click("#exitConfirm");
  const exited = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", session: load(SESSION_KEY, null), armed: practiceHistoryArmed }));
  assert(exited.home && exited.session && exited.session.version === 2 && !exited.armed, "Expected X exit to save v2 session and return home", exited);

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
    const cardRect = card.getBoundingClientRect(); return { widths: boxes.map((box) => box.width), within: boxes.every((box) => box.left >= cardRect.left && box.right <= cardRect.right), actions: decisionRow.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  assert(compact.widths.every((width) => width <= 138.5) && compact.within && compact.actions, "Expected dark small-screen comparison layout to fit", compact);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  assert(pageErrors.length === 0, "Browser console/page errors", pageErrors);
  await browser.close();
  console.log(`Verified FSRS-6 dual-loop practice, migration, persistence, backup, history, and ${baseline.cards} cards.`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
