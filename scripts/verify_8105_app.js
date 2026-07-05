const { chromium } = require("playwright");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(projectRoot, "generated", "verify_8105_app.png");

const expectedCount = 6854;
const sampleTargets = ["的", "一", "强", "器", "随", "察", "群", "疑", "藏", "避", "熟", "翼", "啰"];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("shizi.deck.v8105.context1");
    localStorage.removeItem("shizi.deck.v3500.context1");
    localStorage.removeItem("shizi.topic.v1");
    localStorage.removeItem("shizi.memory.v1");
    localStorage.removeItem("shizi.quality.v1");
    localStorage.removeItem("shizi.pref.v1");
    localStorage.removeItem("shizi.tuning.v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  const homeOverview = await page.evaluate(() => {
    renderMe();
    const activePref = document.querySelector("#prefBox button.active")?.dataset.pref;
    const dueStat = document.getElementById("dueStat").textContent;
    const riskStat = document.getElementById("riskStat").textContent;
    const seenStat = document.getElementById("seenStat").textContent;
    renderHome();
    return {
      homeVisible: getComputedStyle(document.getElementById("home")).display !== "none",
      cardVisible: getComputedStyle(document.getElementById("card")).display !== "none",
      dueStat, riskStat, seenStat,
      startDisabled: document.getElementById("startBtn").disabled,
      startBig: document.getElementById("startBig").textContent,
      startSub: document.getElementById("startSub").textContent,
      homeStatus: document.getElementById("homeStatus").textContent,
      tabs: Array.from(document.querySelectorAll("#foot .tab")).map((node) => node.textContent.replace(/\s/g, "")),
      activePref,
      needsCalibration: typeof needsCalibration === "function" ? needsCalibration() : null,
    };
  });
  if (!homeOverview.homeVisible || homeOverview.cardVisible || homeOverview.startDisabled) {
    throw new Error(`Expected home launcher before practice, got ${JSON.stringify(homeOverview)}`);
  }
  if (homeOverview.activePref !== "balanced" || !homeOverview.needsCalibration || !homeOverview.startSub.includes("15 字") || !homeOverview.homeStatus.includes("估") || homeOverview.tabs.join(",") !== "练习,错题,我的") {
    throw new Error(`Expected balanced preference and 3-tab nav by default, got ${JSON.stringify(homeOverview)}`);
  }

  const calibrationCheck = await page.evaluate(() => {
    status = {};
    memory = {};
    quality = {};
    preference = "balanced";
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    save(PREF_KEY, preference);
    saveTuning();
    localStorage.removeItem(TOPIC_KEY);
    startMode("new");
    const before = {
      activeMode,
      batchSize: batch.length,
      topics: [...new Set(batch.map((idx) => CARDS[idx].topic))],
      difficulties: batch.map((idx) => cardDifficulty(idx)),
      hasElementary: batch.some((idx) => cardLevel(idx) === "小学"),
      hasFallback: batch.some((idx) => contextSource(idx) === "fallback"),
    };
    roundStats = batch.map((idx) => ({
      idx,
      target: CARDS[idx].target,
      word: CARDS[idx].word,
      outcome: "fast",
      level: abilityLevel(idx),
      topic: CARDS[idx].topic,
      due: Date.now() + 86400000,
    }));
    roundSummary();
    const after = {
      activeMode,
      calibrated: tuning.calibrated,
      preference,
      offset: tuning.offset,
      title: document.getElementById("sumTitle").textContent,
      note: document.getElementById("sumNote").textContent,
      tuneVisible: getComputedStyle(document.getElementById("roundTune")).display !== "none",
    };
    status = {};
    memory = {};
    quality = {};
    preference = "balanced";
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    save(PREF_KEY, preference);
    saveTuning();
    localStorage.removeItem(TOPIC_KEY);
    renderHome();
    return { before, after };
  });
  if (calibrationCheck.before.activeMode !== "calibrate" || calibrationCheck.before.batchSize !== 15 || calibrationCheck.before.topics.length < 6 || calibrationCheck.before.hasElementary || calibrationCheck.before.hasFallback || !calibrationCheck.after.calibrated || calibrationCheck.after.activeMode !== "new" || calibrationCheck.after.preference !== "challenge" || calibrationCheck.after.offset < 8 || !calibrationCheck.after.title.includes("试练") || !calibrationCheck.after.note.includes("估难度") || !calibrationCheck.after.tuneVisible) {
    throw new Error(`Expected first new-user round to calibrate and persist a starting difficulty, got ${JSON.stringify(calibrationCheck)}`);
  }

  await page.evaluate(() => renderProfile());
  const profileEmptyCheck = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("profilePanel")).display !== "none",
    metrics: Array.from(document.querySelectorAll("#profileSummary .profileMetric")).map((node) => node.textContent),
    advice: document.getElementById("profileAdvice").textContent,
    topicsText: document.getElementById("profileTopics").textContent,
    charsText: document.getElementById("profileChars").textContent,
  }));
  if (!profileEmptyCheck.visible || profileEmptyCheck.metrics.length !== 4 || !profileEmptyCheck.advice.includes("先完成一组") || !profileEmptyCheck.topicsText.includes("还没有足够记录")) {
    throw new Error(`Expected empty profile panel before practice, got ${JSON.stringify(profileEmptyCheck)}`);
  }
  await page.evaluate(() => renderMe());

  const prefBefore = await page.evaluate(() => ({ preference, target: targetDifficulty(), label: prefLabel() }));
  await page.click('#prefBox [data-pref="challenge"]');
  const prefCheck = await page.evaluate(() => ({
    preference,
    activePref: document.querySelector("#prefBox button.active")?.dataset.pref,
    target: targetDifficulty(),
    saved: JSON.parse(localStorage.getItem("shizi.pref.v1") || "null"),
    pos: document.getElementById("pos").textContent,
  }));
  if (prefCheck.preference !== "challenge" || prefCheck.activePref !== "challenge" || prefCheck.saved !== "challenge" || prefCheck.target <= prefBefore.target) {
    throw new Error(`Expected challenge preference to raise target difficulty, got ${JSON.stringify({ prefBefore, prefCheck })}`);
  }
  await page.click('#prefBox [data-pref="balanced"]');

  await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "强");
    batch = [idx];
    pos = 0;
    sessionDone = new Set();
    render();
  });
  await page.waitForFunction(() => !document.getElementById("done").disabled);
  await page.click("#done");
  const revealCheck = await page.evaluate(() => ({
    qualityVisible: getComputedStyle(document.getElementById("qualityBox")).display !== "none",
    qualityHiddenBeforeReveal: false,
    hintedHidden: document.getElementById("hinted").style.display === "none",
    missLabel: document.getElementById("miss").textContent,
    markCue: document.getElementById("markCue").textContent,
    doneText: document.getElementById("done").textContent,
    showText: document.getElementById("show").textContent,
    askText: document.querySelector(".ask").textContent,
    blankFilled: document.querySelector("#prompt .blank").classList.contains("filled"),
    inkToolsHidden: getComputedStyle(document.getElementById("inkTools")).display === "none",
  }));
  if (!revealCheck.qualityVisible || revealCheck.hintedHidden || revealCheck.missLabel !== "不会写" || revealCheck.doneText !== "写好了" || !revealCheck.showText.includes("揭晓答案") || !revealCheck.askText.includes("词语和语境") || !revealCheck.markCue.includes("写对了吗") || !revealCheck.blankFilled || !revealCheck.inkToolsHidden) {
    throw new Error(`Expected completed-path reveal to show trimmed self-assessment, got ${JSON.stringify(revealCheck)}`);
  }
  await page.click('#qualityBox [data-quality="easy"]');
  const qualityCheck = await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "强");
    const stored = quality[cardKey(idx)] || {};
    return {
      stored,
      active: document.querySelector('#qualityBox [data-quality="easy"]').classList.contains("active"),
      note: document.getElementById("qualityNote").textContent,
      newPoolHasStrong: newPool(false).includes(idx),
      qualityCount: qualityCount(),
    };
  });
  if (!qualityCheck.stored.easy || !qualityCheck.active || !qualityCheck.note.includes("已降难") || qualityCheck.newPoolHasStrong || qualityCheck.qualityCount !== 1) {
    throw new Error(`Expected quality feedback to store and suppress easy card, got ${JSON.stringify(qualityCheck)}`);
  }
  await page.evaluate(() => {
    quality = {};
    status = {};
    preference = "balanced";
    saveQuality();
    save(DECK_KEY, status);
    save(PREF_KEY, preference);
    renderHome();
  });

  await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "强");
    batch = [idx];
    pos = 0;
    activeMode = "new";
    sessionDone = new Set();
    render();
  });
  await page.waitForFunction(() => getComputedStyle(document.getElementById("card")).display !== "none");
  await page.click("#exitPractice");
  const exitCancelCheck = await page.evaluate(() => ({
    open: document.getElementById("exitSheet").classList.contains("open"),
    title: document.querySelector("#exitSheet h3").textContent,
    hint: document.querySelector("#exitSheet .sheetHint").textContent,
  }));
  if (!exitCancelCheck.open || !exitCancelCheck.title.includes("退出") || !exitCancelCheck.hint.includes("当前这张不会记录")) {
    throw new Error(`Expected exit confirmation sheet, got ${JSON.stringify(exitCancelCheck)}`);
  }
  await page.click("#exitCancel");
  const exitKeepCheck = await page.evaluate(() => ({
    sheetOpen: document.getElementById("exitSheet").classList.contains("open"),
    cardVisible: getComputedStyle(document.getElementById("card")).display !== "none",
  }));
  if (exitKeepCheck.sheetOpen || !exitKeepCheck.cardVisible) {
    throw new Error(`Expected canceling exit to keep practice card, got ${JSON.stringify(exitKeepCheck)}`);
  }
  await page.click("#exitPractice");
  await page.click("#exitConfirm");
  const exitConfirmCheck = await page.evaluate(() => ({
    homeVisible: getComputedStyle(document.getElementById("home")).display !== "none",
    cardVisible: getComputedStyle(document.getElementById("card")).display !== "none",
    memoryCount: memoryCount(),
  }));
  if (!exitConfirmCheck.homeVisible || exitConfirmCheck.cardVisible || exitConfirmCheck.memoryCount !== 0) {
    throw new Error(`Expected confirming exit to return home without recording current card, got ${JSON.stringify(exitConfirmCheck)}`);
  }

  await page.evaluate(() => {
    status = {};
    memory = {};
    quality = {};
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    const idx = CARDS.findIndex((card) => card.target === "强");
    batch = [idx];
    pos = 0;
    activeMode = "new";
    sessionDone = new Set();
    render();
  });
  const addQueueBefore = await page.evaluate(() => ({ length: batch.length, pos, first: CARDS[batch[0]].target }));
  await page.click("#addInPractice");
  await page.fill("#addInput", "蘸料");
  await page.click("#addConfirm");
  const addQueueCheck = await page.evaluate(() => ({
    length: batch.length,
    inserted: batch.slice(pos + 1, pos + 3).map((idx) => CARDS[idx].target),
    toast: document.getElementById("toast").textContent,
  }));
  if (addQueueCheck.length < addQueueBefore.length + 2 || addQueueCheck.inserted.join("") !== "蘸料" || !addQueueCheck.toast.includes("本次练习")) {
    throw new Error(`Expected added word to enter the current practice queue, got ${JSON.stringify(addQueueCheck)}`);
  }
  await page.evaluate(() => {
    status = {};
    memory = {};
    quality = {};
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    renderHome();
  });

  await page.evaluate(() => renderMe());
  await page.click("#auditLink");
  const auditCheck = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("auditPanel")).display !== "none",
    activePref: document.querySelector("#auditPrefs button.active")?.dataset.pref,
    metricTexts: Array.from(document.querySelectorAll("#auditSummary .auditMetric")).map((node) => node.textContent),
    batchRows: document.querySelectorAll("#auditBatch .auditRow").length,
    sampleRows: document.querySelectorAll("#auditSample .auditRow").length,
    bandTexts: Array.from(document.querySelectorAll("#auditBands .auditBand")).map((node) => node.textContent),
    batchNote: document.getElementById("auditBatchNote").textContent,
  }));
  if (!auditCheck.visible || auditCheck.activePref !== "balanced" || auditCheck.metricTexts.length !== 3 || auditCheck.batchRows !== 15 || auditCheck.sampleRows < 20 || auditCheck.bandTexts.length !== 3 || !auditCheck.bandTexts[0].includes("规范")) {
    throw new Error(`Expected audit panel with metrics, batch preview, and sample rows, got ${JSON.stringify(auditCheck)}`);
  }

  const poolNormCheck = await page.evaluate(() => {
    const oldPreference = preference;
    preference = "balanced";
    const balancedPool = newPool(false);
    const balancedNorms = countBy(balancedPool, normLevel);
    const balancedFallback = balancedPool.filter((idx) => contextSource(idx) === "fallback").length;
    preference = "challenge";
    const challengePool = newPool(false);
    const challengeNorms = countBy(challengePool, normLevel);
    const challengeFallback = challengePool.filter((idx) => contextSource(idx) === "fallback").length;
    preference = oldPreference;
    return { balancedCount: balancedPool.length, balancedNorms, balancedFallback, challengeCount: challengePool.length, challengeNorms, challengeFallback };
  });
  if (poolNormCheck.balancedFallback !== 0 || poolNormCheck.challengeFallback !== 0 || (poolNormCheck.balancedNorms["三级"] || 0) !== 0 || !(poolNormCheck.challengeNorms["三级"] > 0)) {
    throw new Error(`Expected default pool to exclude tertiary/fallback cards and challenge pool to include vetted tertiary cards, got ${JSON.stringify(poolNormCheck)}`);
  }

  await page.click('#auditPrefs [data-pref="challenge"]');
  const auditPrefCheck = await page.evaluate(() => ({
    activePref: document.querySelector("#auditPrefs button.active")?.dataset.pref,
    pos: document.getElementById("pos").textContent,
    batchDifficulties: Array.from(document.querySelectorAll("#auditBatch .auditRow .main small")).map((node) => node.textContent),
  }));
  if (auditPrefCheck.activePref !== "challenge" || !auditPrefCheck.pos.includes("偏挑战") || auditPrefCheck.batchDifficulties.length !== 15) {
    throw new Error(`Expected audit preference switch to redraw challenge sample, got ${JSON.stringify(auditPrefCheck)}`);
  }

  const auditFirstIdx = await page.evaluate(() => Number(document.querySelector("#auditBatch .auditRow").dataset.idx));
  await page.click(`#auditBatch .auditRow[data-idx="${auditFirstIdx}"] [data-audit-quality="badWord"]`);
  const auditQualityCheck = await page.evaluate((idx) => {
    const stored = quality[cardKey(idx)] || {};
    return {
      stored,
      blockedFromPool: !newPool(false).includes(idx),
      qualityCount: qualityCount(),
      stillVisible: !!document.querySelector(`#auditBatch .auditRow[data-idx="${idx}"]`),
    };
  }, auditFirstIdx);
  if (!auditQualityCheck.stored.badWord || !auditQualityCheck.blockedFromPool || auditQualityCheck.qualityCount !== 1) {
    throw new Error(`Expected audit quality action to mark and suppress row, got ${JSON.stringify(auditQualityCheck)}`);
  }

  await page.evaluate(() => {
    quality = {};
    status = {};
    preference = "balanced";
    auditPref = "balanced";
    saveQuality();
    save(DECK_KEY, status);
    save(PREF_KEY, preference);
    renderHome();
  });

  const futureDueCheck = await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "强");
    const key = cardKey(idx);
    status[idx] = "indeck";
    memory[key] = {
      seen: 1,
      streak: 0,
      ease: 50,
      fast: 0,
      slow: 0,
      hints: 1,
      misses: 0,
      due: Date.now() + 86400000,
      last: Date.now(),
      target: CARDS[idx].target,
      word: CARDS[idx].word,
    };
    save(DECK_KEY, status);
    saveMemory();
    renderMe();
    const result = {
      reviewCount: reviewCount(),
      dueStat: document.getElementById("dueStat").textContent,
      riskStat: document.getElementById("riskStat").textContent,
      riskChar: (highRiskIndexes()[0] != null ? CARDS[highRiskIndexes()[0]].target : ""),
    };
    delete status[idx];
    delete memory[key];
    save(DECK_KEY, status);
    saveMemory();
    renderHome();
    return result;
  });
  if (futureDueCheck.reviewCount !== 0 || futureDueCheck.dueStat !== "0" || futureDueCheck.riskStat !== "1") {
    throw new Error(`Expected future-due risk card to stay out of today's review, got ${JSON.stringify(futureDueCheck)}`);
  }

  const strategyCheck = await page.evaluate(() => {
    status = {};
    memory = {};
    const now = Date.now();
    const cases = [
      { target: "强", outcome: "fast", ease: 90, streak: 3, fast: 3, due: now - 7 * 86400000 },
      { target: "器", outcome: "miss", ease: 20, streak: 0, misses: 2, due: now },
      { target: "疑", outcome: "hinted", ease: 40, streak: 0, hints: 1, due: now - 86400000 },
    ];
    const indexes = cases.map((item) => {
      const idx = CARDS.findIndex((card) => card.target === item.target);
      status[idx] = "indeck";
      memory[cardKey(idx)] = {
        seen: 3,
        streak: item.streak,
        ease: item.ease,
        fast: item.fast || 0,
        slow: 0,
        hints: item.hints || 0,
        misses: item.misses || 0,
        due: item.due,
        last: now,
        lastOutcome: item.outcome,
        target: CARDS[idx].target,
        word: CARDS[idx].word,
        level: CARDS[idx].level,
        topic: CARDS[idx].topic,
      };
      return idx;
    });
    save(DECK_KEY, status);
    saveMemory();
    const delays = {
      missFirst: delayFor("miss", 0, 34),
      missRepeat: delayFor("miss", 1, 34),
      hintedFirst: delayFor("hinted", 0, 42),
      slowFirst: delayFor("slow", 1, 54),
      fastMature: delayFor("fast", 3, 82),
    };
    const ordered = chooseReviewBatch(indexes).map((idx) => CARDS[idx].target);
    const labels = {
      hinted: dueText(now + delays.hintedFirst),
      slow: dueText(now + delays.slowFirst),
    };
    const priorities = Object.fromEntries(indexes.map((idx) => [CARDS[idx].target, Math.round(reviewPriority(idx))]));
    status = {};
    memory = {};
    save(DECK_KEY, status);
    saveMemory();
    renderHome();
    return { delays, ordered, labels, priorities, reviewCount: reviewCount() };
  });
  if (strategyCheck.delays.missFirst !== 0 || !(strategyCheck.delays.missRepeat > strategyCheck.delays.missFirst) || !(strategyCheck.delays.hintedFirst < strategyCheck.delays.slowFirst) || !(strategyCheck.delays.slowFirst < strategyCheck.delays.fastMature) || strategyCheck.ordered[0] !== "器" || strategyCheck.reviewCount !== 0) {
    throw new Error(`Expected tuned review strategy to prioritize hard due cards with graduated delays, got ${JSON.stringify(strategyCheck)}`);
  }

  const adaptiveCheck = await page.evaluate(() => {
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
      first: batch[0],
      second: batch[1],
      firstDifficulty: cardDifficulty(batch[0]),
      secondDifficulty: cardDifficulty(batch[1]),
      secondPersonal: personalDifficulty(batch[1]),
      batchSize: batch.length,
    };
    recordOutcome("fast");
    const afterFast = {
      target: sessionTarget,
      fastStreak: sessionFastStreak,
      pos,
      next: batch[1],
      nextDifficulty: cardDifficulty(batch[1]),
      nextPersonal: personalDifficulty(batch[1]),
      uniqueSize: new Set(batch).size,
      batchSize: batch.length,
    };
    sessionTarget = 80;
    sessionFastStreak = 0;
    sessionMissStreak = 0;
    adjustSessionTarget("miss");
    const afterMissOne = { target: sessionTarget, missStreak: sessionMissStreak };
    adjustSessionTarget("miss");
    const afterMissTwo = { target: sessionTarget, missStreak: sessionMissStreak };
    sessionTarget = 76;
    sessionFastStreak = 2;
    sessionMissStreak = 0;
    adjustSessionTarget("hinted");
    const afterHinted = { target: sessionTarget, fastStreak: sessionFastStreak, missStreak: sessionMissStreak };
    status = {};
    memory = {};
    quality = {};
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    preference = "balanced";
    sessionTarget = 0;
    sessionFastStreak = 0;
    sessionMissStreak = 0;
    sessionDone = new Set();
    save(DECK_KEY, status);
    saveMemory();
    saveQuality();
    saveTuning();
    save(PREF_KEY, preference);
    localStorage.removeItem(TOPIC_KEY);
    renderHome();
    return { before, afterFast, afterMissOne, afterMissTwo, afterHinted };
  });
  const beforeFastDistance = Math.abs(adaptiveCheck.before.secondPersonal - adaptiveCheck.afterFast.target);
  const afterFastDistance = Math.abs(adaptiveCheck.afterFast.nextPersonal - adaptiveCheck.afterFast.target);
  if (adaptiveCheck.afterFast.target <= adaptiveCheck.before.target || adaptiveCheck.afterFast.fastStreak !== 1 || adaptiveCheck.afterFast.pos !== 1 || afterFastDistance > beforeFastDistance || adaptiveCheck.afterFast.uniqueSize !== adaptiveCheck.afterFast.batchSize || adaptiveCheck.afterMissOne.target !== 80 || adaptiveCheck.afterMissTwo.target >= adaptiveCheck.afterMissOne.target || adaptiveCheck.afterHinted.target !== 74 || adaptiveCheck.afterHinted.fastStreak !== 0) {
    throw new Error(`Expected adaptive session difficulty to raise after fast answers and only lower after repeated misses, got ${JSON.stringify(adaptiveCheck)}`);
  }

  await page.click("#startBtn");
  await page.waitForFunction(() => batch.length > 0 && getComputedStyle(document.getElementById("card")).display !== "none");

  const overview = await page.evaluate(() => ({
    seed: SEED.length,
    cards: CARDS.length,
    groups: Object.keys(GROUPS).length,
    first: CARDS[0],
    initialBatchSize: batch.length,
    initialTopics: [...new Set(batch.map((idx) => CARDS[idx].topic))],
    initialDifficulties: batch.map((idx) => CARDS[idx].d),
    initialLevels: batch.map((idx) => CARDS[idx].level),
    initialNorms: batch.map((idx) => CARDS[idx].norm),
    initialContextSources: batch.map((idx) => CARDS[idx].ctx),
    initialTargets: batch.map((idx) => `${CARDS[idx].target}/${CARDS[idx].word}/${CARDS[idx].level}/${CARDS[idx].d}`),
    feedbackButtons: Array.from(document.querySelectorAll("#mark button")).map((button) => button.id),
    tipText: document.getElementById("tip").textContent,
    contextDeckKey: typeof DECK_KEY !== "undefined" ? DECK_KEY : null,
  }));
  if (overview.seed !== expectedCount || overview.cards !== expectedCount || overview.groups !== expectedCount) {
    throw new Error(`Expected ${expectedCount} entries, got ${JSON.stringify(overview)}`);
  }
  if (overview.initialBatchSize !== 15) {
    throw new Error(`Expected a 15-card opening batch, got ${overview.initialBatchSize}`);
  }
  if (overview.initialTopics.length > 1) {
    throw new Error(`Expected opening batch to stay in one topic, got ${overview.initialTopics.join(", ")}`);
  }
  if (!overview.initialDifficulties.every((value, index, array) => index === 0 || value >= array[index - 1])) {
    throw new Error(`Expected opening batch difficulty to be sorted, got ${overview.initialDifficulties.join(", ")}`);
  }
  if (overview.initialLevels.includes("小学")) {
    throw new Error(`Expected opening batch to skip elementary cards, got ${overview.initialTargets.join(", ")}`);
  }
  if (overview.initialNorms.includes("三级") || overview.initialContextSources.includes("fallback")) {
    throw new Error(`Expected balanced opening batch to avoid tertiary and fallback cards, got ${overview.initialTargets.join(", ")}`);
  }
  if (Math.max(...overview.initialDifficulties) < 84) {
    throw new Error(`Expected opening batch to include professional-level cards, got ${overview.initialTargets.join(", ")}`);
  }
  if (overview.feedbackButtons.join(",") !== "fast,hinted,miss,slow") {
    throw new Error(`Expected four feedback buttons, got ${overview.feedbackButtons.join(",")}`);
  }

  await page.waitForFunction(() => !document.getElementById("show").disabled);
  await page.click("#show");
  await page.click("#miss");
  const feedbackCheck = await page.evaluate(() => {
    renderHome();
    renderMe();
    const entries = Object.values(JSON.parse(localStorage.getItem("shizi.memory.v1") || "{}"));
    return {
      memoryEntries: entries.length,
      firstMemory: entries[0],
      statusValues: Object.values(JSON.parse(localStorage.getItem("shizi.deck.v8105.context1") || "{}")),
      reviewCount: typeof reviewCount === "function" ? reviewCount() : null,
      dueStat: document.getElementById("dueStat").textContent,
      riskChar: (highRiskIndexes()[0] != null ? CARDS[highRiskIndexes()[0]].target : ""),
      startDisabled: document.getElementById("startBtn").disabled,
    };
  });
  if (feedbackCheck.memoryEntries !== 1 || feedbackCheck.firstMemory.lastOutcome !== "miss") {
    throw new Error(`Expected miss feedback to write memory, got ${JSON.stringify(feedbackCheck)}`);
  }
  if (!feedbackCheck.statusValues.includes("indeck")) {
    throw new Error(`Expected missed card to enter review deck, got ${JSON.stringify(feedbackCheck)}`);
  }
  if (feedbackCheck.startDisabled || feedbackCheck.dueStat !== "1" || feedbackCheck.riskChar !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected missed card to appear as review/risk, got ${JSON.stringify(feedbackCheck)}`);
  }

  await page.evaluate(() => renderProfile());
  const profileCheck = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("profilePanel")).display !== "none",
    metrics: Array.from(document.querySelectorAll("#profileSummary .profileMetric")).map((node) => node.textContent),
    advice: document.getElementById("profileAdvice").textContent,
    topicRows: document.querySelectorAll("#profileTopics .profileRow").length,
    levelRows: document.querySelectorAll("#profileLevels .profileRow").length,
    charsText: document.getElementById("profileChars").textContent,
    pos: document.getElementById("pos").textContent,
  }));
  if (!profileCheck.visible || profileCheck.metrics.length !== 4 || profileCheck.topicRows < 1 || profileCheck.levelRows < 2 || !profileCheck.charsText.includes(feedbackCheck.firstMemory.target) || !profileCheck.advice.includes("错题")) {
    throw new Error(`Expected profile panel to summarize the missed card, got ${JSON.stringify(profileCheck)}`);
  }

  await page.click("#profileChars [data-profile-char]");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const profileCharClickCheck = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (profileCharClickCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected profile character chip to start focused practice, got ${JSON.stringify(profileCharClickCheck)}`);
  }

  await page.evaluate(() => renderProfile());
  await page.click("#profileTopics .profileRow");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const profileGroupClickCheck = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    firstTarget: CARDS[batch[0]].target,
    firstTopic: CARDS[batch[0]].topic,
  }));
  if (profileGroupClickCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected profile topic row to start topic-focused practice, got ${JSON.stringify(profileGroupClickCheck)}`);
  }
  await page.evaluate(() => renderMe());

  await page.click("#meRisk");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const riskClickCheck = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (riskClickCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected tapping the 我的 error stat to start focused practice, got ${JSON.stringify(riskClickCheck)}`);
  }
  await page.evaluate(() => renderMe());

  await page.click("#meDue");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "review");
  const reviewModeCheck = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (reviewModeCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected review mode to start with due card, got ${JSON.stringify(reviewModeCheck)}`);
  }

  const bookCheck = await page.evaluate(() => {
    renderBook();
    return {
      visible: getComputedStyle(document.getElementById("studybook")).display !== "none",
      rows: document.querySelectorAll("#bookList .bookRow").length,
      practiceDueText: document.getElementById("practiceDue").textContent,
      practiceRiskText: document.getElementById("practiceRisk").textContent,
      firstRowText: document.querySelector("#bookList .bookRow")?.textContent || "",
    };
  });
  if (!bookCheck.visible || bookCheck.rows < 1 || !bookCheck.firstRowText.includes(feedbackCheck.firstMemory.target)) {
    throw new Error(`Expected study book to list risk cards, got ${JSON.stringify(bookCheck)}`);
  }

  await page.click("#bookList .bookRow");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const bookClickCheck = await page.evaluate(() => ({
    activeMode,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (bookClickCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected clicking a study book row to focus that card, got ${JSON.stringify(bookClickCheck)}`);
  }

  const summaryCheck = await page.evaluate(() => {
    const fastIdx = CARDS.findIndex((card) => card.target === "强");
    const missIdx = CARDS.findIndex((card) => card.target === "器");
    const now = Date.now();
    status[missIdx] = "indeck";
    memory[cardKey(missIdx)] = {
      seen: 1,
      streak: 0,
      ease: 34,
      fast: 0,
      slow: 0,
      hints: 0,
      misses: 1,
      due: now,
      last: now,
      target: CARDS[missIdx].target,
      word: CARDS[missIdx].word,
      level: CARDS[missIdx].level,
      topic: CARDS[missIdx].topic,
    };
    save(DECK_KEY, status);
    saveMemory();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    saveTuning();
    roundFeedbackGiven = false;
    roundId = "verify-summary";
    roundStats = [
      { idx: fastIdx, target: CARDS[fastIdx].target, word: CARDS[fastIdx].word, outcome: "fast", level: abilityLevel(fastIdx), topic: CARDS[fastIdx].topic, due: now + 14 * 86400000 },
      { idx: missIdx, target: CARDS[missIdx].target, word: CARDS[missIdx].word, outcome: "miss", level: abilityLevel(missIdx), topic: CARDS[missIdx].topic, due: now },
    ];
    activeMode = "new";
    roundSummary();
    return {
      visible: getComputedStyle(document.getElementById("summary")).display !== "none",
      groups: Array.from(document.querySelectorAll(".resultGroup")).map((node) => node.textContent),
      itemCount: document.querySelectorAll("#sumList .resultItem").length,
      missItemText: document.querySelector("#sumList .resultItem.miss")?.textContent || "",
      heroText: document.getElementById("summaryHero").textContent,
      note: document.getElementById("sumNote").textContent,
      tuneVisible: getComputedStyle(document.getElementById("roundTune")).display !== "none",
      tuneButtons: Array.from(document.querySelectorAll("#roundTune [data-round-feedback]")).map((button) => button.textContent),
      reviewRiskVisible: getComputedStyle(document.getElementById("reviewRisk")).display !== "none",
      moreVisible: getComputedStyle(document.getElementById("more")).display !== "none",
      stopText: document.getElementById("stop").textContent,
    };
  });
  if (!summaryCheck.visible || summaryCheck.groups.length !== 4 || summaryCheck.itemCount !== 2 || !summaryCheck.missItemText.includes("今天再练") || !summaryCheck.heroText.includes("进入错题复习") || summaryCheck.heroText.includes("明天起") || !summaryCheck.reviewRiskVisible || summaryCheck.moreVisible || !summaryCheck.tuneVisible || summaryCheck.tuneButtons.length !== 4 || summaryCheck.stopText !== "返回首页") {
    throw new Error(`Expected result page 2.0 with grouped rows and review action, got ${JSON.stringify(summaryCheck)}`);
  }

  await page.click('#roundTune [data-round-feedback="easy"]');
  const summaryTuneCheck = await page.evaluate(() => ({
    offset: tuning.offset,
    rounds: (tuning.rounds || []).length,
    last: tuning.lastRoundFeedback,
    stored: JSON.parse(localStorage.getItem("shizi.tuning.v1") || "{}"),
    active: document.querySelector('#roundTune [data-round-feedback="easy"]').classList.contains("active"),
    disabledCount: Array.from(document.querySelectorAll("#roundTune [data-round-feedback]")).filter((button) => button.disabled).length,
  }));
  if (summaryTuneCheck.offset <= 0 || summaryTuneCheck.rounds !== 1 || summaryTuneCheck.last !== "easy" || summaryTuneCheck.stored.offset !== summaryTuneCheck.offset || !summaryTuneCheck.active || summaryTuneCheck.disabledCount !== 4) {
    throw new Error(`Expected round-level feedback to persist difficulty tuning, got ${JSON.stringify(summaryTuneCheck)}`);
  }

  await page.click("#sumList .resultItem.miss");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const summaryClickCheck = await page.evaluate(() => ({
    activeMode,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (summaryClickCheck.firstTarget !== "器") {
    throw new Error(`Expected clicking a summary row to focus that card, got ${JSON.stringify(summaryClickCheck)}`);
  }

  const samples = [];
  for (const target of sampleTargets) {
    await page.evaluate((ch) => {
      const idx = CARDS.findIndex((card) => card.target === ch);
      if (idx < 0) throw new Error(`Missing ${ch}`);
      batch = [idx];
      pos = 0;
      sessionDone = new Set();
      render();
    }, target);
    await page.waitForFunction(() => !document.getElementById("tip").disabled && groups.length >= 1 && totalStrokes > 0);
    samples.push(await page.evaluate(() => ({
      target: cur.target,
      word: cur.word,
      py: cur.py,
      topic: cur.topic,
      difficulty: cur.d,
      level: cur.level,
      prompt: document.getElementById("prompt").textContent,
      groups: groups.slice(),
      totalStrokes,
      tipText: document.getElementById("tip").textContent,
    })));
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ homeOverview, calibrationCheck, profileEmptyCheck, auditCheck, poolNormCheck, auditPrefCheck, auditQualityCheck, futureDueCheck, strategyCheck, adaptiveCheck, overview, feedbackCheck, profileCheck, profileCharClickCheck, profileGroupClickCheck, riskClickCheck, reviewModeCheck, bookCheck, bookClickCheck, summaryCheck, summaryTuneCheck, summaryClickCheck, samples }, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
