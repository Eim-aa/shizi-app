const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(projectRoot, "generated", "verify_8105_app.png");
const expectedCount = 6854;
const indexSource = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
if (/手感|口袋/.test(indexSource)) {
  throw new Error("Deprecated user-facing vocabulary remains in index.html");
}

function appUrlWith(params) {
  const url = new URL(appUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function chromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function expectVisible(page, selector, label) {
  const visible = await page.locator(selector).evaluate((node) => getComputedStyle(node).display !== "none");
  if (!visible) throw new Error(`Expected ${label || selector} to be visible`);
}

async function expectHidden(page, selector, label) {
  const hidden = await page.locator(selector).evaluate((node) => getComputedStyle(node).display === "none");
  if (!hidden) throw new Error(`Expected ${label || selector} to be hidden`);
}

(async () => {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    [
      "shizi.deck.v8105.context1",
      "shizi.deck.v3500.context1",
      "shizi.topic.v1",
      "shizi.opens.v1",
      "shizi.memory.v1",
      "shizi.quality.v1",
      "shizi.pref.v1",
      "shizi.tuning.v1",
      "shizi.activity.v1",
      "shizi.session.v1",
      "shizi.backupMeta.v1",
      "shizi.custom.v1",
      "shizi.added.v1",
    ].forEach((key) => localStorage.removeItem(key));
  });
  await page.reload({ waitUntil: "networkidle" });

  const initial = await page.evaluate(() => ({
    seed: SEED.length,
    cards: CARDS.length,
    groups: Object.keys(GROUPS).length,
    title: document.title,
    welcomeText: document.getElementById("welcome").textContent.replace(/\s+/g, ""),
    tabs: Array.from(document.querySelectorAll("#foot .tab")).map((node) => node.textContent.replace(/\s+/g, "")),
    needsCalibration: needsCalibration(),
    activeView: getComputedStyle(document.getElementById("welcome")).display !== "none" ? "welcome" : "other",
  }));
  if (initial.seed !== expectedCount || initial.cards !== expectedCount || initial.groups !== expectedCount) {
    throw new Error(`Expected ${expectedCount} deck entries, got ${JSON.stringify(initial)}`);
  }
  if (initial.activeView !== "welcome" || !initial.needsCalibration || !initial.welcomeText.includes("先拾15个字试试") || initial.tabs.join(",") !== "拾练习,盒字盒,我我的") {
    throw new Error(`Expected designer welcome + 3-tab IA, got ${JSON.stringify(initial)}`);
  }
  await expectHidden(page, "#foot", "bottom nav on welcome");

  await page.evaluate(() => {
    save(OPEN_KEY, [shiftDay(today(), -3), shiftDay(today(), -2), shiftDay(today(), -1), today()]);
    localStorage.removeItem(ACTIVITY_KEY);
    localStorage.removeItem(REMINDER_KEY);
  });
  await page.reload({ waitUntil: "networkidle" });
  // 累计口径迁移：迁移日前的 opens 全额继承；盖章不加天、完成一组 +1；同日第二组不重复计
  const streakMigration = await page.evaluate(() => {
    const inherited = activity.inheritedTotalDays;
    const beforeComplete = totalPracticeDays();
    markPracticeStamp();
    const stampedOnly = totalPracticeDays();
    const runFakeRound = (id, from, to) => {
      batch = allIndexes().slice(from, to);
      roundStats = batch.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast" }));
      roundId = id;
      roundStats.forEach(() => markPracticeStamp());
      markRoundComplete();
    };
    runFakeRound("verify-migration-round-1", 0, 3);
    const afterComplete = totalPracticeDays();
    runFakeRound("verify-migration-round-2", 3, 6);
    const afterSecondSameDay = totalPracticeDays();
    return { inherited, beforeComplete, stampedOnly, afterComplete, afterSecondSameDay };
  });
  if (streakMigration.inherited !== 3 || streakMigration.beforeComplete !== 3 || streakMigration.stampedOnly !== 3
    || streakMigration.afterComplete !== 4 || streakMigration.afterSecondSameDay !== 4) {
    throw new Error(`Expected cumulative practice-day migration, got ${JSON.stringify(streakMigration)}`);
  }
  // medianPracticeTime 边界 + 浏览器（无桥）下提醒 UI 隐藏
  const reminderChecks = await page.evaluate(() => {
    activity = newActivity();
    activity.daily = {}; activity.practiceDays = [];
    const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
    for (let i = 0; i < 5; i++) {
      const key = shiftDay(today(), -i);
      activity.practiceDays.push(key);
      activity.daily[key] = { stamps: 1, completedRoundIds: [], lastStampAt: at(9, 24) };
    }
    activity.practiceDays.sort(); saveActivity();
    const median = medianPracticeTime();
    const fewSamples = (() => { const days = activity.practiceDays; activity.practiceDays = days.slice(0, 2); const m = medianPracticeTime(); activity.practiceDays = days; return m.hour === 20 && m.minute === 0; })();
    const clampLate = (() => { activity.practiceDays.forEach((k) => { activity.daily[k].lastStampAt = at(23, 30); }); const m = medianPracticeTime(); return m.hour === 22 && m.minute === 0; })();
    if (typeof renderMe === "function") renderMe();
    const reminderHiddenInBrowser = getComputedStyle(document.getElementById("reminderSection")).display === "none"
      && getComputedStyle(document.getElementById("reminderInvite")).display === "none";
    const syncPayload = (() => { syncReminder(); const p = reminderDebug.lastSync; return !!p && p.type === "syncReminder" && p.enabled === false && p.practicedToday === true; })();
    return { medianHour: median.hour, medianMinute: median.minute, fewSamples, clampLate, reminderHiddenInBrowser, syncPayload };
  });
  if (reminderChecks.medianHour !== 9 || reminderChecks.medianMinute !== 24 || !reminderChecks.fewSamples || !reminderChecks.clampLate
    || !reminderChecks.reminderHiddenInBrowser || !reminderChecks.syncPayload) {
    throw new Error(`Expected median practice time + browser reminder fallback, got ${JSON.stringify(reminderChecks)}`);
  }
  await page.evaluate(() => {
    localStorage.removeItem(OPEN_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
    localStorage.removeItem(REMINDER_KEY);
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.click("#welcomeStart");
  await page.waitForFunction(() => batch.length === 15 && getComputedStyle(document.getElementById("card")).display !== "none");
  await page.waitForFunction(() => !document.getElementById("show").disabled && !document.getElementById("done").disabled);

  const practice = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    topics: [...new Set(batch.map((idx) => CARDS[idx].topic))],
    difficulties: batch.map((idx) => cardDifficulty(idx)),
    levels: batch.map((idx) => cardLevel(idx)),
    hasElementary: batch.some((idx) => cardLevel(idx) === "小学"),
    hasFallback: batch.some((idx) => contextSource(idx) === "fallback"),
    prompt: document.getElementById("prompt").textContent.replace(/\s+/g, ""),
    hint: document.getElementById("hint").textContent,
    beadCount: document.querySelectorAll("#beads .bead").length,
    posLabel: document.getElementById("posLabel").textContent,
    tipText: document.getElementById("tip").textContent,
    showText: document.getElementById("show").textContent,
    doneText: document.getElementById("done").textContent,
    doneTouchAction: getComputedStyle(document.getElementById("done")).touchAction,
    tabTouchAction: getComputedStyle(document.getElementById("tabPractice")).touchAction,
    hasModebar: !!document.getElementById("modebar"),
  }));
  if (practice.activeMode !== "calibrate" || practice.batchSize !== 15 || practice.beadCount !== 15 || practice.hasElementary || practice.hasFallback) {
    throw new Error(`Expected first run to be a 15-card adult calibration batch, got ${JSON.stringify(practice)}`);
  }
  if (!practice.hint.includes("摸个底") || !practice.posLabel.includes("1/15") || practice.tipText.indexOf("笔顺提示") < 0 || practice.showText !== "看答案" || practice.doneText !== "写好了" || practice.doneTouchAction !== "manipulation" || practice.tabTouchAction !== "manipulation") {
    throw new Error(`Expected new practice copy and controls, got ${JSON.stringify(practice)}`);
  }
  if (practice.hasModebar) {
    throw new Error(`Expected App-facing practice page to remove desktop continuous mode, got ${JSON.stringify(practice)}`);
  }
  if (practice.difficulties[practice.difficulties.length - 1] < practice.difficulties[0]) {
    throw new Error(`Expected calibration difficulty to trend upward, got ${practice.difficulties.join(",")}`);
  }

  await page.evaluate(() => revealAnswer(false));
  await expectVisible(page, "#reveal", "calibration reveal");
  const newbieStamp = await page.evaluate(() => ({
    funcFirst: document.getElementById("stampRow").classList.contains("funcFirst"),
    labels: Array.from(document.querySelectorAll("#stampRow .stampWrap")).map((node) => ({
      seal: node.querySelector(".seal").innerText.replace(/\s+/g, ""),
      sub: node.querySelector("small").textContent.replace(/\s+/g, ""),
    })),
    qualityVisible: getComputedStyle(document.getElementById("qualityBox")).display !== "none",
    teachVisible: getComputedStyle(document.getElementById("teachBubbleGrade")).display !== "none",
  }));
  if (!newbieStamp.funcFirst || newbieStamp.labels.map((x) => `${x.seal}/${x.sub}`).join(",") !== "会写/拾到,看提示写出/补拾,写错了/差点,不会写/回炉" || newbieStamp.qualityVisible || !newbieStamp.teachVisible) {
    throw new Error(`Expected first calibration reveal to make function labels primary, got ${JSON.stringify(newbieStamp)}`);
  }
  await page.click("#fast");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("stampedToast")).display !== "none");
  const newbieToast = await page.evaluate(() => ({
    memoryCount: Object.values(memory).length,
    outcome: Object.values(memory)[0]?.lastOutcome,
    todayStamps: todayStampCount(),
    toast: document.getElementById("stampedToast").textContent.replace(/\s+/g, ""),
    editDisabled: document.getElementById("editStamp").disabled,
    stampHidden: getComputedStyle(document.getElementById("stampRow")).display === "none",
  }));
  if (newbieToast.memoryCount !== 1 || newbieToast.outcome !== "fast" || newbieToast.todayStamps !== 1 || !newbieToast.toast.includes("已记为会写") || !newbieToast.toast.includes("改一下") || newbieToast.editDisabled || !newbieToast.stampHidden) {
    throw new Error(`Expected stamped toast to explain the system interpretation and expose edit, got ${JSON.stringify(newbieToast)}`);
  }
  await page.click("#editStamp");
  const editCheck = await page.evaluate(() => ({
    memoryCount: Object.values(memory).length,
    statusCount: Object.keys(status).length,
    roundStats: roundStats.length,
    todayStamps: todayStampCount(),
    stamped,
    stampVisible: getComputedStyle(document.getElementById("stampRow")).display !== "none",
    editDisabled: document.getElementById("editStamp").disabled,
  }));
  if (editCheck.memoryCount !== 0 || editCheck.statusCount !== 0 || editCheck.roundStats !== 0 || editCheck.todayStamps !== 0 || editCheck.stamped || !editCheck.stampVisible || !editCheck.editDisabled) {
    throw new Error(`Expected edit stamp to undo the memory write and reopen choices, got ${JSON.stringify(editCheck)}`);
  }

  const adaptive = await page.evaluate(() => {
    status = {};
    memory = {};
    quality = {};
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    preference = "balanced";
    activeMode = "new";
    focusQueue = [];
    sessionDone = new Set();
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    saveTuning();
    save(PREF_KEY, preference);
    localStorage.removeItem(TOPIC_KEY);
    startRound();
    const before = {
      target: sessionTarget,
      secondPersonal: personalDifficulty(batch[1]),
      batchSize: batch.length,
      unique: new Set(batch).size,
    };
    recordOutcome("fast");
    const afterFast = {
      target: sessionTarget,
      fastStreak: sessionFastStreak,
      pos,
      nextPersonal: personalDifficulty(batch[1]),
      unique: new Set(batch).size,
      batchSize: batch.length,
    };
    sessionTarget = 80;
    sessionFastStreak = 0;
    sessionMissStreak = 0;
    adjustSessionTarget("miss");
    const missOne = { target: sessionTarget, missStreak: sessionMissStreak };
    adjustSessionTarget("miss");
    const missTwo = { target: sessionTarget, missStreak: sessionMissStreak };
    return { before, afterFast, missOne, missTwo };
  });
  const beforeDistance = Math.abs(adaptive.before.secondPersonal - adaptive.afterFast.target);
  const afterDistance = Math.abs(adaptive.afterFast.nextPersonal - adaptive.afterFast.target);
  if (adaptive.afterFast.target <= adaptive.before.target || adaptive.afterFast.fastStreak !== 1 || adaptive.afterFast.pos !== 0 || afterDistance > beforeDistance || adaptive.afterFast.unique !== adaptive.afterFast.batchSize || adaptive.missOne.target !== 80 || adaptive.missTwo.target >= adaptive.missOne.target) {
    throw new Error(`Expected adaptive difficulty to rise after fast answers and lower only after repeated misses, got ${JSON.stringify(adaptive)}`);
  }

  const sameDayRecovery = await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "器");
    status = {}; memory = {}; quality = {}; batch = [idx]; pos = 0; roundStats = []; missedThisRound = [];
    activeMode = "focus"; sessionDone = new Set(); hintsUsedThisCard = 0; tracedThisCard = false; lastVerdict = null;
    save(DECK_KEY, status); saveMemory(); saveQuality();
    recordOutcome("miss");
    const afterMiss = cloneObj(memory[cardKey(idx)]);
    lastVerdict = { status: "bad", mode: "holistic", failed: [0], missing: 1 };
    recordOutcome("fast");
    const afterRecovery = cloneObj(memory[cardKey(idx)]);
    const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
    const realNow = Date.now;
    Date.now = () => tomorrow.getTime() + 1000;
    const dueNextDay = reviewReady(idx);
    Date.now = realNow;
    return { missedOn: afterMiss.missedOn, due: afterRecovery.due, tomorrow: tomorrow.getTime(), dueNextDay,
      systemSuggestion: afterRecovery.lastSystemSuggestion, systemStatus: afterRecovery.lastSystemStatus, systemAgree: afterRecovery.lastSystemAgree };
  });
  if (!sameDayRecovery.missedOn || sameDayRecovery.due > sameDayRecovery.tomorrow || !sameDayRecovery.dueNextDay
    || sameDayRecovery.systemSuggestion !== "slow" || sameDayRecovery.systemStatus !== "bad" || sameDayRecovery.systemAgree !== false) {
    throw new Error(`Expected same-day miss recovery to remain due by next midnight, got ${JSON.stringify(sameDayRecovery)}`);
  }

  await page.evaluate(() => {
    status = {};
    memory = {};
    quality = {};
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    preference = "balanced";
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    saveTuning();
    save(PREF_KEY, preference);
    localStorage.removeItem(TOPIC_KEY);
    clearSessionSnapshot();
    activity = newActivity();
    activity.inheritedStreak = 0;
    saveActivity(); reminder.milestonesShown = []; saveReminder();
    renderHome();
  });
  await expectVisible(page, "#home", "home");
  await expectVisible(page, "#foot", "bottom nav on home");

  const home = await page.evaluate(() => ({
    title: document.getElementById("homeTitle").textContent.replace(/\s+/g, ""),
    startCap: document.getElementById("startCap").textContent,
    boxStat: document.getElementById("boxStat").textContent,
    startDisabled: document.getElementById("startBtn").disabled,
    activeTab: document.querySelector(".foot .tab.active")?.id,
    chip: document.getElementById("streakChip").textContent,
  }));
  if (!home.title.includes("今天拾十五个字") || !home.startCap.includes("15 字") || home.startDisabled || home.activeTab !== "tabPractice" || home.chip !== "今天开始拾字") {
    throw new Error(`Expected launcher home state, got ${JSON.stringify(home)}`);
  }

  const queueFront = await page.evaluate(() => {
    const resetModel = (calibrated = true) => {
      status = {}; memory = {}; quality = {}; sessionDone = new Set(); batch = []; pos = 0; roundStats = [];
      tuning = { calibrated, offset: 0, contextStrict: 0, rounds: [] };
      save(DECK_KEY, status); saveMemory(); saveQuality(); saveTuning(); clearSessionSnapshot();
    };
    resetModel(true);
    addWord("强"); addWord("器");
    const queuedIndexes = indexesForChars(["强", "器"]);
    activeMode = "new"; startRound();
    const newFront = batch.slice(0, 2).map((idx) => CARDS[idx].target).join("");
    queuedIndexes.forEach((idx, order) => { batch = [idx]; pos = 0; roundStats = []; recordOutcome(order ? "hinted" : "fast"); });
    const consumed = queuedIndexes.every((idx) => !(memory[cardKey(idx)] || {}).queuedFront);
    clearSessionSnapshot(); sessionDone = new Set(); activeMode = "new"; startRound();
    const absentAfterUse = !batch.slice(0, 2).some((idx) => queuedIndexes.includes(idx));

    resetModel(true);
    addWord("强"); addWord("器"); activeMode = "review"; startRound();
    const reviewFront = batch.slice(0, 2).map((idx) => CARDS[idx].target).join("");

    resetModel(false);
    addWord("强"); addWord("器"); activeMode = "calibrate"; startRound();
    const calibrationFront = batch.slice(0, 2).map((idx) => CARDS[idx].target).join("");
    const calibrationKeepsFlags = indexesForChars(["强", "器"]).every((idx) => (memory[cardKey(idx)] || {}).queuedFront === true);

    renderHome(); tuning.calibrated = true; saveTuning(); document.getElementById("addInput").value = "器"; confirmAdd();
    const calibratedToast = document.getElementById("toast").textContent;
    renderHome(); tuning.calibrated = false; saveTuning(); document.getElementById("addInput").value = "疑"; confirmAdd();
    const calibrationToast = document.getElementById("toast").textContent;
    resetModel(true); renderHome();
    return { newFront, reviewFront, consumed, absentAfterUse, calibrationFront, calibrationKeepsFlags, calibratedToast, calibrationToast };
  });
  if (queueFront.newFront !== "强器" || queueFront.reviewFront !== "强器" || !queueFront.consumed || !queueFront.absentAfterUse
    || queueFront.calibrationFront === "强器" || !queueFront.calibrationKeepsFlags
    || !queueFront.calibratedToast.includes("下次开练，第一个就是它") || !queueFront.calibrationToast.includes("校准这组结束后")) {
    throw new Error(`Expected newly added characters to lead the next non-calibration round once, got ${JSON.stringify(queueFront)}`);
  }

  const homeRecent = await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "器"), key = cardKey(idx), now = Date.now();
    status = { [idx]: "indeck" };
    memory = { [key]: { seen: 1, streak: 0, ease: 30, misses: 1, due: now, last: now, lastOutcome: "miss", target: "器", word: CARDS[idx].word } };
    save(DECK_KEY, status); saveMemory(); renderHome();
    const todayState = { label: document.getElementById("yesterLbl").textContent, text: document.getElementById("yesterRow").textContent.trim(), miss: !!document.querySelector("#yesterRow .yTile.miss") };
    memory[key].last = now - 86400000; saveMemory(); renderHome();
    const priorState = { label: document.getElementById("yesterLbl").textContent, text: document.getElementById("yesterRow").textContent.trim() };
    memory = {}; status = {}; saveMemory(); save(DECK_KEY, status); renderHome();
    const emptyState = document.getElementById("yesterRow").textContent.trim();
    return { todayState, priorState, emptyState };
  });
  if (homeRecent.todayState.label !== "今日拾得" || homeRecent.todayState.text !== "器" || !homeRecent.todayState.miss
    || homeRecent.priorState.label !== "昨日拾得" || homeRecent.priorState.text !== "器" || !homeRecent.emptyState.includes("今天拾的字会出现在这里")) {
    throw new Error(`Expected home recent characters to prefer today and style misses quietly, got ${JSON.stringify(homeRecent)}`);
  }

  const shortRound = await page.evaluate(() => {
    activity = newActivity();
    activity.inheritedStreak = 0;
    batch = allIndexes().slice(0, 5);
    roundStats = batch.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast" }));
    roundId = "verify-short-round";
    roundStats.forEach(() => markPracticeStamp());
    const completed = markRoundComplete();
    renderHome();
    return {
      completed,
      groups: dailyActivity().completedGroups,
      stamps: todayStampCount(),
      title: document.getElementById("homeTitle").textContent.replace(/\s+/g, ""),
      chip: document.getElementById("streakChip").textContent,
    };
  });
  if (!shortRound.completed || shortRound.groups !== 1 || shortRound.stamps !== 5 || !shortRound.title.includes("今日已拾5个字") || !shortRound.chip.includes("拾字第 1 天")) {
    throw new Error(`Expected a completed short group to establish today's completion state, got ${JSON.stringify(shortRound)}`);
  }
  const calibrationFocus = await page.evaluate(() => {
    const indexes = ["强", "器", "疑"].map((target) => CARDS.findIndex((card) => card.target === target));
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    activeMode = "calibrate"; batch = indexes; roundId = "verify-calibration-focus";
    roundStats = [
      { idx: indexes[0], target: "强", outcome: "fast" },
      { idx: indexes[1], target: "器", outcome: "miss" },
      { idx: indexes[2], target: "疑", outcome: "hinted" },
    ];
    saveTuning(); roundSummary();
    return {
      visible: getComputedStyle(document.getElementById("calibPocketCard")).display !== "none",
      title: document.getElementById("calibPocketTitle").textContent,
      line: document.getElementById("calibPocketLine").textContent,
      action: document.getElementById("calibPocketBtn").textContent,
    };
  });
  if (!calibrationFocus.visible || !calibrationFocus.title.includes("2") || !calibrationFocus.line.includes("也可以现在就再拾一次") || calibrationFocus.action !== "马上再拾") {
    throw new Error(`Expected calibration summary to offer immediate focused retry, got ${JSON.stringify(calibrationFocus)}`);
  }
  await page.click("#calibPocketBtn");
  await page.waitForFunction(() => activeMode === "focus" && batch.length === 2 && getComputedStyle(document.getElementById("card")).display !== "none");
  await page.evaluate(() => {
    status = {}; memory = {}; quality = {};
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    preference = "balanced"; sessionDone = new Set(); clearSessionSnapshot();
    save(DECK_KEY, status); saveMemory(); saveQuality(); saveTuning(); save(PREF_KEY, preference);
    activity = newActivity();
    activity.inheritedStreak = 0;
    saveActivity(); reminder.milestonesShown = []; saveReminder();
    batch = [];
    roundStats = [];
    renderHome();
  });

  await page.click("#startBtn");
  await page.waitForFunction(() => batch.length === 15 && getComputedStyle(document.getElementById("card")).display !== "none");
  await page.waitForFunction(() => !document.getElementById("show").disabled);
  const firstTarget = await page.evaluate(() => cur.target);
  const actionStates = await page.evaluate(async () => {
    writer = { animateStroke: async () => {} };
    groups = [1, 1]; groupIdx = 0; shownStrokes = 0; totalStrokes = 2; hintsUsedThisCard = 0; revealed = false; animating = false;
    document.getElementById("tip").disabled = false; updateTip();
    const read = () => ({ show: document.getElementById("show").textContent, done: document.getElementById("done").textContent });
    const a = read();
    await document.getElementById("tip").onclick(); const b = read();
    const peekGuide = tuning.peekHintShown === true && document.getElementById("mascotLine").textContent.includes("双指按住格子");
    await document.getElementById("tip").onclick(); const c = read();
    writer = null; groups = []; groupIdx = 0; hintsUsedThisCard = 0; updateActionLabels(); const noData = read();
    render(); const reset = read();
    return { a, b, c, noData, reset, tipHaptic: hapticDebug.events.filter((kind) => kind === "select").length >= 2, peekGuide };
  });
  await page.waitForFunction(() => !document.getElementById("show").disabled);
  if (actionStates.a.show !== "看答案" || actionStates.a.done !== "写好了"
    || actionStates.b.show !== "看答案" || actionStates.b.done !== "写完了"
    || actionStates.c.show !== "描一遍" || actionStates.c.done !== "写完了"
    || actionStates.noData.show !== "看答案" || actionStates.noData.done !== "写好了"
    || actionStates.reset.show !== "看答案" || actionStates.reset.done !== "写好了" || !actionStates.tipHaptic || !actionStates.peekGuide) {
    throw new Error(`Expected three-state practice labels and reset behavior, got ${JSON.stringify(actionStates)}`);
  }
  const peekAndRevealHaptics = await page.evaluate(() => {
    const canvas = inkCanvas, rect = canvas.getBoundingClientRect();
    const pointer = (type, id, primary, x, y, buttons) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: primary,
      button: 0, buttons, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y,
    });
    const pixels = () => { const data = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data; let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n; };
    clearInk(); activePointers.clear(); tracing = false; revealed = false; animating = false;
    canvas.dispatchEvent(pointer("pointerdown", 81051, true, .2, .25, 1));
    canvas.dispatchEvent(pointer("pointermove", 81051, true, .45, .5, 1));
    const partial = pixels();
    canvas.dispatchEvent(pointer("pointerdown", 81052, false, .75, .7, 1));
    const entered = peeking && Number(canvas.style.opacity) <= .06 && hzEl.classList.contains("peekHint");
    const cancelled = partial > 0 && !drawing && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointermove", 81051, true, .65, .65, 1));
    canvas.dispatchEvent(pointer("pointermove", 81052, false, .8, .8, 1));
    const blockedInk = inkStrokes.length === 0 && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointerup", 81052, false, .8, .8, 0));
    const restored = !peeking && Number(canvas.style.opacity) === 1 && !hzEl.classList.contains("peekHint");
    canvas.dispatchEvent(pointer("pointerup", 81051, true, .65, .65, 0));
    activePointers.add(1); activePointers.add(2); animating = true; enterPeekHint(); activePointers.delete(2); exitPeekHint();
    const animationRestore = Number(canvas.style.opacity) === .22;
    resetPeekHint(); animating = false;
    activePointers.add(1); activePointers.add(2); tracing = true; const tracingBlocked = !enterPeekHint(); resetPeekHint(); tracing = false;
    activePointers.add(1); activePointers.add(2); revealed = true; const revealBlocked = !enterPeekHint(); resetPeekHint(); revealed = false;
    actionCooldownUntil = 0; hapticDebug.events = []; hapticDebug.last = null; const revealedNow = revealAnswer(true);
    const revealAction = revealedNow && hapticDebug.last === "action" && hapticDebug.events.join(",") === "action";
    render();
    return { entered, cancelled, blockedInk, restored, animationRestore, tracingBlocked, revealBlocked, revealAction };
  });
  await page.waitForFunction(() => !document.getElementById("show").disabled);
  if (!Object.values(peekAndRevealHaptics).every(Boolean)) {
    throw new Error(`Expected two-finger peek and reveal haptic hierarchy, got ${JSON.stringify(peekAndRevealHaptics)}`);
  }
  await page.click("#show");
  await expectVisible(page, "#traceActions", "trace actions after showing answer");
  await expectVisible(page, "#practiceArea", "practice area while tracing");
  await expectHidden(page, "#reveal", "comparison reveal while tracing");
  const traceBefore = await page.evaluate(() => ({
    tracing,
    tracedThisCard,
    traceDoneDisabled: document.getElementById("traceDone").disabled,
    missDisabled: document.getElementById("traceMiss").disabled,
    outlineVisible: getComputedStyle(document.getElementById("hzEl") || document.querySelector(".hz")).display !== "none",
    missLabel: document.getElementById("traceMiss").textContent.replace(/\s+/g, ""),
    doneLabel: document.getElementById("traceDone").textContent.replace(/\s+/g, ""),
    missAria: document.getElementById("traceMiss").getAttribute("aria-label"),
    doneAria: document.getElementById("traceDone").getAttribute("aria-label"),
    hint: document.getElementById("hint").textContent,
    haptic: hapticDebug.last,
  }));
  if (!traceBefore.tracing || traceBefore.tracedThisCard || !traceBefore.traceDoneDisabled || traceBefore.missDisabled
    || traceBefore.missLabel !== "不会写印章：回炉" || traceBefore.doneLabel !== "描好了印章：补拾"
    || !traceBefore.missAria.includes("不会写") || !traceBefore.missAria.includes("回炉")
    || !traceBefore.doneAria.includes("描好了") || !traceBefore.doneAria.includes("补拾")
    || !traceBefore.hint.includes("实在不想描") || traceBefore.haptic !== "select") {
    throw new Error(`Expected tracing to require a real stroke before hinted, got ${JSON.stringify(traceBefore)}`);
  }
  const inkBox = await page.locator(".inkc").boundingBox();
  if (!inkBox) throw new Error("Expected tracing canvas bounds");
  await page.mouse.move(inkBox.x + inkBox.width * 0.25, inkBox.y + inkBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(inkBox.x + inkBox.width * 0.5, inkBox.y + inkBox.height * 0.5, { steps: 4 });
  await page.mouse.move(inkBox.x + inkBox.width * 0.72, inkBox.y + inkBox.height * 0.66, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(320);
  const traceReady = await page.evaluate(() => ({ tracedThisCard, disabled: document.getElementById("traceDone").disabled }));
  if (!traceReady.tracedThisCard || traceReady.disabled) {
    throw new Error(`Expected tracing stroke to enable hinted, got ${JSON.stringify(traceReady)}`);
  }
  const nextKeyBefore = await page.evaluate(() => cardKey(batch[1]));
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  const holdStartedAt = Date.now();
  await page.click("#traceDone");
  await page.waitForTimeout(1020);
  const stampHold = await page.evaluate(() => ({ pos, stamped, visible: getComputedStyle(document.getElementById("stampOnMine")).display !== "none", hold: STAMP_HOLD_MS, calibrationHold: CALIBRATION_FIRST_HOLD_MS, editWindow: EDIT_STAMP_WINDOW_MS }));
  if (stampHold.pos !== 0 || !stampHold.stamped || !stampHold.visible || stampHold.hold !== 1100 || stampHold.calibrationHold !== 1800 || stampHold.editWindow !== 1500) {
    throw new Error(`Expected stamp feedback to remain visible for at least one second, got ${JSON.stringify(stampHold)}`);
  }
  await page.waitForFunction(() => pos === 1 && !revealed && getComputedStyle(document.getElementById("practiceArea")).display !== "none");
  const stampHoldElapsed = Date.now() - holdStartedAt;
  if (stampHoldElapsed < 1000) throw new Error(`Expected stamp hold >= 1000ms, got ${stampHoldElapsed}ms`);
  const traced = await page.evaluate(() => ({
    outcome: roundStats[0]?.outcome,
    traced: roundStats[0]?.traced,
    memoryTraced: memory[cardKey(roundStats[0]?.idx)]?.traced,
    systemSuggestion: memory[cardKey(roundStats[0]?.idx)]?.lastSystemSuggestion,
    systemStatus: memory[cardKey(roundStats[0]?.idx)]?.lastSystemStatus,
    systemAgree: memory[cardKey(roundStats[0]?.idx)]?.lastSystemAgree,
    todayStamps: todayStampCount(),
    undoVisible: getComputedStyle(document.getElementById("undoBar")).display !== "none",
    session: load(SESSION_KEY, null),
    haptic: hapticDebug.last,
    hapticEvents: hapticDebug.events.slice(),
  }));
  if (traced.outcome !== "hinted" || !traced.traced || !traced.memoryTraced || traced.systemSuggestion !== "" || traced.systemStatus !== "none" || traced.systemAgree !== null || traced.todayStamps !== 1 || !traced.undoVisible || traced.session?.pos !== 1 || traced.haptic !== "stamp" || traced.hapticEvents.join(",") !== "stamp") {
    throw new Error(`Expected traced marker, activity and session snapshot, got ${JSON.stringify(traced)}`);
  }
  const undoLayout = await page.evaluate(() => {
    const snap = lastStampSnapshot, canvas = inkCanvas, rect = canvas.getBoundingClientRect();
    const before = document.getElementById("boxwrap").getBoundingClientRect().top;
    const style = getComputedStyle(document.getElementById("undoBar"));
    const event = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 82001, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: rect.left + 30, clientY: rect.top + 30 });
    canvas.dispatchEvent(event("pointerdown", 1)); canvas.dispatchEvent(event("pointerup", 0));
    const hiddenOnWrite = getComputedStyle(document.getElementById("undoBar")).display === "none";
    const after = document.getElementById("boxwrap").getBoundingClientRect().top;
    clearInk(); lastStampSnapshot = snap; renderUndoBar();
    return { position: style.position, hiddenOnWrite, shift: Math.abs(after - before), restored: getComputedStyle(document.getElementById("undoBar")).display !== "none" };
  });
  if (undoLayout.position !== "absolute" || !undoLayout.hiddenOnWrite || undoLayout.shift > .5 || !undoLayout.restored) {
    throw new Error(`Expected undo bar to float without moving the writing layout, got ${JSON.stringify(undoLayout)}`);
  }
  await page.click("#undoLast");
  await page.waitForFunction(() => pos === 0 && revealed && getComputedStyle(document.getElementById("reveal")).display !== "none");
  const reveal = await page.evaluate((nextKey) => ({
    revealWord: document.getElementById("revealWord").textContent,
    funcFirst: document.getElementById("stampRow").classList.contains("funcFirst"),
    stampLabels: Array.from(document.querySelectorAll("#stampRow .stampWrap")).map((node) => `${node.querySelector(".seal").innerText.replace(/\s+/g, "")}/${node.querySelector("small").textContent.replace(/\s+/g, "")}`),
    note: document.getElementById("stampNote").textContent,
    qualityVisible: getComputedStyle(document.getElementById("qualityBox")).display !== "none",
    rollback: { memory: Object.keys(memory).length, stats: roundStats.length, todayStamps: todayStampCount(), nextUntouched: memory[nextKey] == null },
    haptic: hapticDebug.last,
  }), nextKeyBefore);
  if (!reveal.revealWord.includes(firstTarget) || !reveal.funcFirst || reveal.stampLabels.join(",") !== "会写/拾到,看提示写出/补拾,写错了/差点,不会写/回炉" || !reveal.note.includes("不会写") || !reveal.qualityVisible || reveal.rollback.memory !== 0 || reveal.rollback.stats !== 0 || reveal.rollback.todayStamps !== 0 || !reveal.rollback.nextUntouched || reveal.haptic !== "undo") {
    throw new Error(`Expected designer reveal and stamp self-assessment, got ${JSON.stringify(reveal)}`);
  }

  await page.click("#miss");
  await page.waitForFunction(() => stamped && getComputedStyle(document.getElementById("stampOnMine")).display !== "none");
  const skipStampHold = await page.evaluate(() => {
    const before = pos, target = document.getElementById("reveal");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { before, after: pos, stamped };
  });
  if (skipStampHold.after !== skipStampHold.before + 1 || skipStampHold.stamped) {
    throw new Error(`Expected result tap to skip hold exactly once, got ${JSON.stringify(skipStampHold)}`);
  }
  await page.waitForFunction(() => pos === 1 && !revealed && getComputedStyle(document.getElementById("practiceArea")).display !== "none");
  const stamped = await page.evaluate(() => {
    const entries = Object.values(memory);
    return {
      entries: entries.length,
      outcome: entries[0]?.lastOutcome,
      target: entries[0]?.target,
      statusValues: Object.values(status),
      undo: document.getElementById("undoCopy").textContent,
      pos,
      noNextButton: !document.getElementById("nextBtn"),
    };
  });
  if (stamped.entries !== 1 || stamped.outcome !== "miss" || stamped.target !== firstTarget || !stamped.statusValues.includes("indeck") || !stamped.undo.includes("回炉") || stamped.pos !== 1 || !stamped.noNextButton) {
    throw new Error(`Expected miss stamp to update memory and review deck, got ${JSON.stringify(stamped)}`);
  }

  const addBefore = await page.evaluate(() => ({ length: batch.length, pos }));
  await page.click("#addInPractice");
  await page.fill("#addInput", "蘸料");
  await page.click("#addConfirm");
  const add = await page.evaluate(() => ({
    length: batch.length,
    inserted: batch.slice(pos + 1, pos + 3).map((idx) => CARDS[idx].target).join(""),
    toast: document.getElementById("toast").textContent,
  }));
  if (add.length < addBefore.length + 2 || add.inserted !== "蘸料" || !add.toast.includes("本次练习")) {
    throw new Error(`Expected added word to enter current queue with feedback, got ${JSON.stringify(add)}`);
  }

  const backupPolicy = await page.evaluate(() => {
    saveSessionSnapshot();
    localStorage.setItem("shizi.transient.verify", "keep-local");
    const payload = JSON.parse(backupPayload());
    const legacyPayload = cloneObj(payload);
    legacyPayload.data[SESSION_KEY] = JSON.stringify({ version: 1, date: today(), batch: [0], pos: 0, roundStats: [] });
    legacyPayload.data["shizi.unknown.v1"] = "legacy-unknown";
    localStorage.setItem(SESSION_KEY, JSON.stringify({ current: true }));
    const restored = restoreBackupPayload(legacyPayload, { skipConfirm: true, reload: false });
    const transientAfterRestore = localStorage.getItem("shizi.transient.verify");
    localStorage.removeItem("shizi.transient.verify");
    return {
      exportedKeys: Object.keys(payload.data),
      sessionExported: Object.prototype.hasOwnProperty.call(payload.data, SESSION_KEY),
      transientExported: Object.prototype.hasOwnProperty.call(payload.data, "shizi.transient.verify"),
      sessionAfterRestore: localStorage.getItem(SESSION_KEY),
      transientAfterRestore,
      unknownAfterRestore: localStorage.getItem("shizi.unknown.v1"),
      restoredKeys: restored.keys,
    };
  });
  if (backupPolicy.sessionExported || backupPolicy.transientExported || backupPolicy.sessionAfterRestore !== null || backupPolicy.transientAfterRestore !== "keep-local" || backupPolicy.unknownAfterRestore !== null || backupPolicy.restoredKeys.includes("shizi.unknown.v1") || !backupPolicy.exportedKeys.includes("shizi.memory.v1") || !backupPolicy.exportedKeys.includes("shizi.reminder.v1")) {
    throw new Error(`Expected backup allowlist to exclude sessions and transient keys, got ${JSON.stringify(backupPolicy)}`);
  }

  await page.evaluate(() => {
    const fastIdx = CARDS.findIndex((card) => card.target === "强");
    const missIdx = CARDS.findIndex((card) => card.target === "器");
    const hintedIdx = CARDS.findIndex((card) => card.target === "疑");
    const reviewingIdx = CARDS.findIndex((card) => card.target === "词");
    const now = Date.now();
    status = {};
    memory = {};
    quality = {};
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    [
      { idx: fastIdx, outcome: "fast", ease: 85, streak: 2, fast: 2, due: now + 7 * 86400000 },
      { idx: missIdx, outcome: "miss", ease: 32, streak: 0, misses: 1, due: now },
      { idx: hintedIdx, outcome: "hinted", ease: 40, streak: 0, hints: 1, due: now },
      { idx: reviewingIdx, outcome: "fast", ease: 72, streak: 1, fast: 1, due: now + 3 * 86400000 },
    ].forEach((item) => {
      const c = CARDS[item.idx];
      status[item.idx] = item.outcome === "fast" ? "rest" : "indeck";
      memory[cardKey(item.idx)] = {
        seen: 1,
        streak: item.streak,
        ease: item.ease,
        fast: item.fast || 0,
        slow: 0,
        hints: item.hints || 0,
        misses: item.misses || 0,
        due: item.due,
        last: now,
        lastOutcome: item.outcome,
        target: c.target,
        word: c.word,
        level: c.level,
        topic: c.topic,
      };
    });
    save(DECK_KEY, status);
    saveMemory();
    clearSessionSnapshot();
    renderBook();
  });
  const book = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("studybook")).display !== "none",
    count: document.getElementById("boxCount").textContent,
    dueVisible: getComputedStyle(document.getElementById("dueCard")).display !== "none",
    dueTitle: document.getElementById("dueTitle").textContent,
    tiles: document.querySelectorAll("#boxGrid .boxTile").length,
    riskTiles: document.querySelectorAll("#boxGrid .boxTile.risk").length,
    reviewingTiles: document.querySelectorAll("#boxGrid .boxTile.reviewing").length,
    stableTiles: document.querySelectorAll("#boxGrid .boxTile.stable").length,
    reviewingDot: getComputedStyle(document.querySelector("#boxGrid .boxTile.reviewing .dot")).width,
    stableDot: getComputedStyle(document.querySelector("#boxGrid .boxTile.stable .dot")).width,
    legend: document.querySelector(".legend").textContent.replace(/\s+/g, ""),
    activeTab: document.querySelector(".foot .tab.active")?.id,
  }));
  if (!book.visible || !book.count.includes("4") || !book.dueVisible || !book.dueTitle.includes("2") || book.tiles < 4
    || book.riskTiles !== 2 || book.reviewingTiles !== 1 || book.stableTiles !== 1 || book.reviewingDot !== "11px" || book.stableDot !== "6px"
    || !book.legend.includes("大角标") || !book.legend.includes("灰小点=已稳") || book.activeTab !== "tabBook") {
    throw new Error(`Expected study book to expose due/risk cards, got ${JSON.stringify(book)}`);
  }
  await page.click("#practiceDue");
  await page.waitForFunction(() => activeMode === "review" && batch.length > 0 && getComputedStyle(document.getElementById("card")).display !== "none");
  const review = await page.evaluate(() => ({ activeMode, first: cur.target, reviewCount: reviewCount() }));
  if (review.activeMode !== "review" || !["器", "疑"].includes(review.first)) {
    throw new Error(`Expected due button to enter review mode, got ${JSON.stringify(review)}`);
  }

  const summary = await page.evaluate(() => {
    const fastIdx = CARDS.findIndex((card) => card.target === "强");
    const missIdx = CARDS.findIndex((card) => card.target === "器");
    const hintedIdx = CARDS.findIndex((card) => card.target === "疑");
    const now = Date.now();
    roundStats = [
      { idx: fastIdx, target: CARDS[fastIdx].target, word: CARDS[fastIdx].word, outcome: "fast", level: abilityLevel(fastIdx), topic: CARDS[fastIdx].topic, due: now + 7 * 86400000 },
      { idx: missIdx, target: CARDS[missIdx].target, word: CARDS[missIdx].word, outcome: "miss", level: abilityLevel(missIdx), topic: CARDS[missIdx].topic, due: now },
      { idx: hintedIdx, target: CARDS[hintedIdx].target, word: CARDS[hintedIdx].word, outcome: "hinted", level: abilityLevel(hintedIdx), topic: CARDS[hintedIdx].topic, due: now + 3600000 },
    ];
    activeMode = "new";
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    roundFeedbackGiven = false;
    roundId = "verify-summary";
    batch = roundStats.map((s) => s.idx); // 对齐完成门槛：roundStats >= batch 才记完成
    saveTuning();
    hapticDebug.events = []; hapticDebug.last = null; roundSummary();
    const milestoneHaptic = hapticDebug.last;
    const milestoneVisible = getComputedStyle(document.getElementById("milestoneLine")).display !== "none";
    const milestoneText = document.getElementById("milestoneLine").textContent;
    roundSummary(true);
    const completedRoundHaptic = hapticDebug.last;
    return {
      milestoneHaptic,
      completedRoundHaptic,
      milestoneVisible,
      milestoneText,
      totalDays: totalPracticeDays(),
      milestonesShown: reminder.milestonesShown.slice(),
      visible: getComputedStyle(document.getElementById("summary")).display !== "none",
      sheetVisible: getComputedStyle(document.getElementById("sumSheet")).display !== "none",
      lead: document.getElementById("sumLead").textContent.replace(/\s+/g, ""),
      tiles: Array.from(document.querySelectorAll("#sumTiles .sumTile")).map((node) => node.textContent),
      pocketVisible: getComputedStyle(document.getElementById("pocketCard")).display !== "none",
      pocketTitle: document.getElementById("pocketTitle").textContent,
      tuneButtons: Array.from(document.querySelectorAll("#roundTune [data-round-feedback]")).map((node) => node.textContent),
      stop: document.getElementById("stop").textContent,
      more: document.getElementById("more").textContent,
    };
  });
  if (!summary.visible || !summary.sheetVisible || !summary.lead.includes("还没拾到") || summary.tiles.length !== 3 || !summary.pocketVisible || !summary.pocketTitle.includes("2") || summary.tuneButtons.length !== 4 || summary.stop !== "回首页") {
    throw new Error(`Expected result sheet with pocket review and round feedback, got ${JSON.stringify(summary)}`);
  }
  // 首个完成日 = 累计第 1 天里程碑：结算页出现「见字如晤」庆祝行，且只记录一次
  if (!summary.milestoneVisible || !summary.milestoneText.includes("见字如晤") || summary.totalDays !== 1 || summary.milestonesShown.join(",") !== "1"
    || summary.milestoneHaptic !== "milestone" || summary.completedRoundHaptic !== "action") {
    throw new Error(`Expected day-1 milestone celebration on first completed day, got ${JSON.stringify(summary)}`);
  }
  await page.click('#roundTune [data-round-feedback="easy"]');
  const tuningCheck = await page.evaluate(() => ({
    offset: tuning.offset,
    last: tuning.lastRoundFeedback,
    active: document.querySelector('#roundTune [data-round-feedback="easy"]').classList.contains("active"),
    disabled: Array.from(document.querySelectorAll("#roundTune [data-round-feedback]")).every((node) => node.disabled),
  }));
  if (tuningCheck.offset <= 0 || tuningCheck.last !== "easy" || !tuningCheck.active || !tuningCheck.disabled) {
    throw new Error(`Expected round-level feedback to tune future difficulty, got ${JSON.stringify(tuningCheck)}`);
  }
  await page.click("#sumTiles .sumTile.miss");
  await page.waitForFunction(() => activeMode === "focus" && batch.length > 0 && getComputedStyle(document.getElementById("card")).display !== "none");
  const focus = await page.evaluate(() => ({ activeMode, first: cur.target }));
  if (focus.activeMode !== "focus" || focus.first !== "器") {
    throw new Error(`Expected tapping weak result character to start focused practice, got ${JSON.stringify(focus)}`);
  }

  await page.evaluate(() => renderMe());
  const me = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("mePanel")).display !== "none",
    seen: document.getElementById("seenStat").textContent,
    risk: document.getElementById("riskStat").textContent,
    advice: document.getElementById("meAdvice").textContent,
    diagnosisEntry: document.getElementById("openProfile").textContent.replace(/\s+/g, ""),
    prefButtons: Array.from(document.querySelectorAll("#prefBox button")).map((node) => node.textContent),
    internalHidden: getComputedStyle(document.getElementById("internalTools")).display === "none",
    toolsState: document.getElementById("toolsState").textContent,
    devHidden: getComputedStyle(document.getElementById("devTools")).display === "none",
    devTextVisible: document.body.innerText.includes("题库质检") || document.body.innerText.includes("实验数据"),
    activeTab: document.querySelector(".foot .tab.active")?.id,
  }));
  if (!me.visible || Number(me.seen) < 3 || Number(me.risk) < 2 || !me.advice || !me.diagnosisEntry.includes("卡点分析") || me.prefButtons.length !== 3 || !me.internalHidden || me.toolsState !== "展开" || !me.devHidden || me.devTextVisible || me.activeTab !== "tabMe") {
    throw new Error(`Expected My page to summarize memory model, got ${JSON.stringify(me)}`);
  }
  await page.click("#toolsToggle");
  const toolsCheck = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("internalTools")).display !== "none",
    state: document.getElementById("toolsState").textContent,
    rows: Array.from(document.querySelectorAll("#internalTools .meRow")).map((node) => node.textContent.replace(/\s+/g, "")),
  }));
  if (!toolsCheck.visible || toolsCheck.state !== "收起" || toolsCheck.rows.length !== 3 || !toolsCheck.rows[0].includes("导出备份") || toolsCheck.rows.some((row) => row.includes("题库质检") || row.includes("实验数据"))) {
    throw new Error(`Expected data management to hide developer-only tools, got ${JSON.stringify(toolsCheck)}`);
  }
  await page.click("#openProfile");
  const profile = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("profilePanel")).display !== "none",
    footHidden: getComputedStyle(document.getElementById("foot")).display === "none",
    metrics: document.querySelectorAll("#profileSummary .profileMetric").length,
    hero: document.querySelector("#profileSummary .profileHero")?.textContent.replace(/\s+/g, ""),
    topics: document.querySelectorAll("#profileTopics .profileRow").length,
    levels: document.querySelectorAll("#profileLevels .profileRow").length,
    chars: document.querySelectorAll("#profileChars [data-profile-char]").length,
  }));
  if (!profile.visible || !profile.footHidden || profile.metrics !== 4 || !profile.hero.includes("今日状态") || !profile.hero.includes("马上再拾") || profile.topics < 1 || profile.levels < 1 || profile.chars < 1) {
    throw new Error(`Expected profile drilldown to be reachable from My page, got ${JSON.stringify(profile)}`);
  }

  await page.goto(appUrlWith({ dev: "1" }), { waitUntil: "networkidle" });
  await page.evaluate(() => renderMe());
  const devTools = await page.evaluate(() => ({
    devVisible: getComputedStyle(document.getElementById("devTools")).display !== "none",
    rows: Array.from(document.querySelectorAll("#devTools .meRow")).map((node) => node.textContent.replace(/\s+/g, "")),
  }));
  if (!devTools.devVisible || devTools.rows.length !== 2 || !devTools.rows[0].includes("题库质检") || !devTools.rows[1].includes("实验数据")) {
    throw new Error(`Expected ?dev=1 to expose developer tools only, got ${JSON.stringify(devTools)}`);
  }
  await page.click("#dataLink");
  const devData = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("dataBox")).display !== "none",
    text: document.getElementById("dataBox").textContent.replace(/\s+/g, ""),
  }));
  if (!devData.visible || !devData.text.includes("实验用") || !devData.text.includes("难度校准")) {
    throw new Error(`Expected dev experiment data panel to work, got ${JSON.stringify(devData)}`);
  }
  await page.click("#auditLink");
  const devAudit = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("auditPanel")).display !== "none",
    title: document.querySelector("#auditPanel h2")?.textContent,
    metrics: document.querySelectorAll("#auditSummary .auditMetric").length,
    batchRows: document.querySelectorAll("#auditBatch .auditRow").length,
    sampleRows: document.querySelectorAll("#auditSample .auditRow").length,
  }));
  if (!devAudit.visible || devAudit.title !== "题库质检" || devAudit.metrics !== 3 || devAudit.batchRows < 1 || devAudit.sampleRows < 1) {
    throw new Error(`Expected dev audit panel to render, got ${JSON.stringify(devAudit)}`);
  }
  await page.click("#closeAudit");

  const algorithm = await page.evaluate(() => {
    const delays = {
      missFirst: delayFor("miss", 0, 34),
      missRepeat: delayFor("miss", 1, 34),
      hintedFirst: delayFor("hinted", 0, 42),
      slowFirst: delayFor("slow", 1, 54),
      fastMature: delayFor("fast", 3, 82),
    };
    const balancedPool = withTemporaryPreference("balanced", () => newPool(false));
    const challengePool = withTemporaryPreference("challenge", () => newPool(false));
    batch = [0]; pos = 0; cur = CARDS[0]; hintsUsedThisCard = 0;
    showRevealState({ status: "bad", mode: "holistic", failed: [0], missing: 1 }, null);
    const badReveal = {
      copy: document.getElementById("askLine").textContent,
      suggestions: document.querySelectorAll("#stampRow .suggest").length,
    };
    showRevealState({ status: "ok", mode: "exact", failed: [], missing: 0 }, null);
    const okReveal = {
      copy: document.getElementById("askLine").textContent,
      suggestions: document.querySelectorAll("#stampRow .suggest").length,
    };
    return {
      delays,
      balancedFallback: balancedPool.filter((idx) => contextSource(idx) === "fallback").length,
      balancedTertiary: balancedPool.filter((idx) => normLevel(idx) === "三级").length,
      challengeTertiary: challengePool.filter((idx) => normLevel(idx) === "三级").length,
      verdictCopy: {
        none: verdictShort(null),
        ok: verdictShort({ status: "ok", mode: "exact", failed: [], missing: 0 }),
        missing: verdictShort({ status: "bad", mode: "holistic", failed: [], missing: 1 }),
      },
      verdictSuggestion: {
        none: suggestedOutcomeForVerdict(null),
        ok: suggestedOutcomeForVerdict({ status: "ok" }),
        bad: suggestedOutcomeForVerdict({ status: "bad", failed: [0], missing: 0 }),
      },
      revealPresentation: { bad: badReveal, ok: okReveal, paintsFailedInk: revealAnswer.toString().includes("paintInkStrokes") },
      abilityLabels: [...new Set([48, 62, 83].map((d) => {
        const idx = CARDS.findIndex((card) => card.d >= d);
        return idx >= 0 ? abilityLevel(idx) : "";
      }))],
    };
  });
  if (algorithm.delays.missFirst !== 0 || !(algorithm.delays.missRepeat > algorithm.delays.missFirst) || !(algorithm.delays.hintedFirst < algorithm.delays.slowFirst) || !(algorithm.delays.slowFirst < algorithm.delays.fastMature) || algorithm.balancedFallback !== 0 || algorithm.balancedTertiary !== 0 || algorithm.challengeTertiary <= 0) {
    throw new Error(`Expected review scheduling and pool filters to remain intact, got ${JSON.stringify(algorithm)}`);
  }
  if (!algorithm.verdictCopy.ok.includes("系统建议") || algorithm.verdictCopy.ok.includes("机器") || !algorithm.verdictCopy.none.includes("不替你判") || algorithm.verdictSuggestion.ok !== "fast" || algorithm.verdictSuggestion.bad !== "slow") {
    throw new Error(`Expected auto-check copy to behave as assistant suggestion, got ${JSON.stringify(algorithm.verdictCopy)}`);
  }
  if (algorithm.verdictCopy.missing !== "系统建议：和右边对照一下，以你自己的判断为准。"
    || algorithm.revealPresentation.bad.suggestions !== 0 || !algorithm.revealPresentation.bad.copy.includes("自己的判断")
    || algorithm.revealPresentation.ok.suggestions !== 1 || !algorithm.revealPresentation.ok.copy.includes("笔画大致对上")
    || algorithm.revealPresentation.paintsFailedInk) {
    throw new Error(`Expected auto-check UI to praise only and never mark negative strokes, got ${JSON.stringify(algorithm.revealPresentation)}`);
  }

  const backupCoverage = await page.evaluate(() => {
    const excluded = new Set([SESSION_KEY, "shizi.nativeSmoke.v1"]);
    const storedKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(Boolean);
    return storedKeys.filter((key) => key.startsWith("shizi.") && !BACKUP_KEYS.includes(key) && !excluded.has(key));
  });
  if (backupCoverage.length) {
    throw new Error(`Unregistered shizi.* keys (add to BACKUP_KEYS or exclusions): ${backupCoverage.join(", ")}`);
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  if (pageErrors.length) {
    throw new Error(`Browser reported errors: ${pageErrors.join(" | ")}`);
  }
  console.log(JSON.stringify({ initial, streakMigration, practice, adaptive, sameDayRecovery, home, shortRound, calibrationFocus, actionStates, traceBefore, traceReady, stampHold, stampHoldElapsed, traced, reveal, skipStampHold, stamped, add, backupPolicy, backupCoverage, book, review, summary, tuningCheck, focus, me, profile, devTools, devData, devAudit, algorithm, screenshotPath }, null, 2));
  await browser.close();
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
