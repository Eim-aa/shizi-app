const { chromium } = require("playwright");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(projectRoot, "generated", "verify_3500_app.png");

const expectedCount = 3500;
const sampleTargets = ["的", "一", "强", "器", "随", "察", "群", "疑", "藏", "避", "熟", "翼", "啰"];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("shizi.deck.v3500.context1");
    localStorage.removeItem("shizi.topic.v1");
    localStorage.removeItem("shizi.memory.v1");
    localStorage.removeItem("shizi.quality.v1");
    localStorage.removeItem("shizi.pref.v1");
  });
  await page.reload({ waitUntil: "networkidle" });

  const homeOverview = await page.evaluate(() => ({
    homeVisible: getComputedStyle(document.getElementById("home")).display !== "none",
    cardVisible: getComputedStyle(document.getElementById("card")).display !== "none",
    dueStat: document.getElementById("dueStat").textContent,
    riskStat: document.getElementById("riskStat").textContent,
    seenStat: document.getElementById("seenStat").textContent,
    startReviewDisabled: document.getElementById("startReview").disabled,
    startNewDisabled: document.getElementById("startNew").disabled,
    activePref: document.querySelector("#prefBox button.active")?.dataset.pref,
  }));
  if (!homeOverview.homeVisible || homeOverview.cardVisible || homeOverview.startNewDisabled) {
    throw new Error(`Expected home entry panel before practice, got ${JSON.stringify(homeOverview)}`);
  }
  if (homeOverview.activePref !== "balanced") {
    throw new Error(`Expected balanced preference by default, got ${JSON.stringify(homeOverview)}`);
  }

  await page.click("#profileLink");
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
  await page.click("#closeProfile");

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
  if (!auditCheck.visible || auditCheck.activePref !== "balanced" || auditCheck.metricTexts.length !== 3 || auditCheck.batchRows !== 15 || auditCheck.sampleRows < 20 || auditCheck.bandTexts.length !== 2) {
    throw new Error(`Expected audit panel with metrics, batch preview, and sample rows, got ${JSON.stringify(auditCheck)}`);
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
    renderHome();
    const result = {
      reviewCount: reviewCount(),
      dueStat: document.getElementById("dueStat").textContent,
      riskStat: document.getElementById("riskStat").textContent,
      riskText: document.getElementById("riskList").textContent,
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

  await page.click("#startNew");
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
  if (Math.max(...overview.initialDifficulties) < 84) {
    throw new Error(`Expected opening batch to include professional-level cards, got ${overview.initialTargets.join(", ")}`);
  }
  if (overview.feedbackButtons.join(",") !== "fast,slow,hinted,miss") {
    throw new Error(`Expected four feedback buttons, got ${overview.feedbackButtons.join(",")}`);
  }

  await page.waitForFunction(() => !document.getElementById("show").disabled);
  await page.click("#show");
  await page.click("#miss");
  const feedbackCheck = await page.evaluate(() => {
    renderHome();
    const entries = Object.values(JSON.parse(localStorage.getItem("shizi.memory.v1") || "{}"));
    return {
      memoryEntries: entries.length,
      firstMemory: entries[0],
      statusValues: Object.values(JSON.parse(localStorage.getItem("shizi.deck.v3500.context1") || "{}")),
      reviewCount: typeof reviewCount === "function" ? reviewCount() : null,
      dueStat: document.getElementById("dueStat").textContent,
      riskText: document.getElementById("riskList").textContent,
      startReviewDisabled: document.getElementById("startReview").disabled,
    };
  });
  if (feedbackCheck.memoryEntries !== 1 || feedbackCheck.firstMemory.lastOutcome !== "miss") {
    throw new Error(`Expected miss feedback to write memory, got ${JSON.stringify(feedbackCheck)}`);
  }
  if (!feedbackCheck.statusValues.includes("indeck")) {
    throw new Error(`Expected missed card to enter review deck, got ${JSON.stringify(feedbackCheck)}`);
  }
  if (feedbackCheck.startReviewDisabled || feedbackCheck.dueStat !== "1" || !feedbackCheck.riskText.includes(feedbackCheck.firstMemory.target)) {
    throw new Error(`Expected missed card to appear on the home review panel, got ${JSON.stringify(feedbackCheck)}`);
  }

  await page.click("#openProfile");
  const profileCheck = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("profilePanel")).display !== "none",
    metrics: Array.from(document.querySelectorAll("#profileSummary .profileMetric")).map((node) => node.textContent),
    advice: document.getElementById("profileAdvice").textContent,
    topicRows: document.querySelectorAll("#profileTopics .profileRow").length,
    levelRows: document.querySelectorAll("#profileLevels .profileRow").length,
    charsText: document.getElementById("profileChars").textContent,
    pos: document.getElementById("pos").textContent,
  }));
  if (!profileCheck.visible || profileCheck.metrics.length !== 4 || profileCheck.topicRows < 1 || profileCheck.levelRows < 2 || !profileCheck.charsText.includes(feedbackCheck.firstMemory.target) || !profileCheck.advice.includes("重点字")) {
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
  await page.evaluate(() => renderHome());

  await page.click("#riskList [data-idx]");
  await page.waitForFunction(() => batch.length > 0 && activeMode === "focus");
  const riskClickCheck = await page.evaluate(() => ({
    activeMode,
    batchSize: batch.length,
    firstTarget: CARDS[batch[0]].target,
    firstWord: CARDS[batch[0]].word,
  }));
  if (riskClickCheck.firstTarget !== feedbackCheck.firstMemory.target) {
    throw new Error(`Expected clicking a risk chip to start focused practice, got ${JSON.stringify(riskClickCheck)}`);
  }
  await page.evaluate(() => renderHome());

  await page.click("#startReview");
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
    roundStats = [
      { idx: fastIdx, target: CARDS[fastIdx].target, word: CARDS[fastIdx].word, outcome: "fast", level: CARDS[fastIdx].level, topic: CARDS[fastIdx].topic, due: now + 14 * 86400000 },
      { idx: missIdx, target: CARDS[missIdx].target, word: CARDS[missIdx].word, outcome: "miss", level: CARDS[missIdx].level, topic: CARDS[missIdx].topic, due: now },
    ];
    activeMode = "new";
    roundSummary();
    return {
      visible: getComputedStyle(document.getElementById("summary")).display !== "none",
      groups: Array.from(document.querySelectorAll(".resultGroup")).map((node) => node.textContent),
      itemCount: document.querySelectorAll("#sumList .resultItem").length,
      missItemText: document.querySelector("#sumList .resultItem.miss")?.textContent || "",
      note: document.getElementById("sumNote").textContent,
      reviewRiskVisible: getComputedStyle(document.getElementById("reviewRisk")).display !== "none",
      stopText: document.getElementById("stop").textContent,
    };
  });
  if (!summaryCheck.visible || summaryCheck.groups.length !== 4 || summaryCheck.itemCount !== 2 || !summaryCheck.missItemText.includes("今天再练") || !summaryCheck.reviewRiskVisible) {
    throw new Error(`Expected result page 2.0 with grouped rows and review action, got ${JSON.stringify(summaryCheck)}`);
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
  console.log(JSON.stringify({ homeOverview, profileEmptyCheck, auditCheck, auditPrefCheck, auditQualityCheck, futureDueCheck, strategyCheck, overview, feedbackCheck, profileCheck, profileCharClickCheck, profileGroupClickCheck, riskClickCheck, reviewModeCheck, bookCheck, bookClickCheck, summaryCheck, summaryClickCheck, samples }, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
