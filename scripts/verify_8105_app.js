const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(projectRoot, "generated", "verify_8105_app.png");
const expectedCount = 6854;

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
      "shizi.memory.v1",
      "shizi.quality.v1",
      "shizi.pref.v1",
      "shizi.tuning.v1",
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
    hasModebar: !!document.getElementById("modebar"),
  }));
  if (practice.activeMode !== "calibrate" || practice.batchSize !== 15 || practice.beadCount !== 15 || practice.hasElementary || practice.hasFallback) {
    throw new Error(`Expected first run to be a 15-card adult calibration batch, got ${JSON.stringify(practice)}`);
  }
  if (!practice.hint.includes("起始难度") || !practice.posLabel.includes("1/15") || practice.tipText.indexOf("笔顺提示") < 0 || practice.showText !== "看答案" || practice.doneText !== "写好了") {
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
    toast: document.getElementById("stampedToast").textContent.replace(/\s+/g, ""),
    editDisabled: document.getElementById("editStamp").disabled,
    stampHidden: getComputedStyle(document.getElementById("stampRow")).display === "none",
  }));
  if (newbieToast.memoryCount !== 1 || newbieToast.outcome !== "fast" || !newbieToast.toast.includes("已记为会写") || !newbieToast.toast.includes("改一下") || newbieToast.editDisabled || !newbieToast.stampHidden) {
    throw new Error(`Expected stamped toast to explain the system interpretation and expose edit, got ${JSON.stringify(newbieToast)}`);
  }
  await page.click("#editStamp");
  const editCheck = await page.evaluate(() => ({
    memoryCount: Object.values(memory).length,
    statusCount: Object.keys(status).length,
    roundStats: roundStats.length,
    stamped,
    stampVisible: getComputedStyle(document.getElementById("stampRow")).display !== "none",
    editDisabled: document.getElementById("editStamp").disabled,
  }));
  if (editCheck.memoryCount !== 0 || editCheck.statusCount !== 0 || editCheck.roundStats !== 0 || editCheck.stamped || !editCheck.stampVisible || !editCheck.editDisabled) {
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
  }));
  if (!home.title.includes("今天拾十五个字") || !home.startCap.includes("15 字") || home.startDisabled || home.activeTab !== "tabPractice") {
    throw new Error(`Expected launcher home state, got ${JSON.stringify(home)}`);
  }

  await page.click("#startBtn");
  await page.waitForFunction(() => batch.length === 15 && getComputedStyle(document.getElementById("card")).display !== "none");
  await page.waitForFunction(() => !document.getElementById("show").disabled);
  const firstTarget = await page.evaluate(() => cur.target);
  await page.click("#show");
  await expectVisible(page, "#reveal", "answer reveal");
  await expectHidden(page, "#practiceArea", "practice area after reveal");
  const reveal = await page.evaluate(() => ({
    revealWord: document.getElementById("revealWord").textContent,
    empty: document.getElementById("mineEmpty").textContent,
    funcFirst: document.getElementById("stampRow").classList.contains("funcFirst"),
    stampLabels: Array.from(document.querySelectorAll("#stampRow .stampWrap")).map((node) => `${node.querySelector(".seal").innerText.replace(/\s+/g, "")}/${node.querySelector("small").textContent.replace(/\s+/g, "")}`),
    note: document.getElementById("stampNote").textContent,
    qualityVisible: getComputedStyle(document.getElementById("qualityBox")).display !== "none",
  }));
  if (!reveal.revealWord.includes(firstTarget) || reveal.empty !== "这次没写" || reveal.funcFirst || reveal.stampLabels.join(",") !== "拾到/会写,补拾/看提示写出,差点/写错了,回炉/不会写" || !reveal.note.includes("回炉") || !reveal.qualityVisible) {
    throw new Error(`Expected designer reveal and stamp self-assessment, got ${JSON.stringify(reveal)}`);
  }

  await page.click("#miss");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("stampedToast")).display !== "none");
  const stamped = await page.evaluate(() => {
    const entries = Object.values(memory);
    return {
      entries: entries.length,
      outcome: entries[0]?.lastOutcome,
      target: entries[0]?.target,
      statusValues: Object.values(status),
      toast: document.getElementById("stampedToast").textContent.replace(/\s+/g, ""),
      nextText: document.getElementById("nextBtn").textContent,
    };
  });
  if (stamped.entries !== 1 || stamped.outcome !== "miss" || stamped.target !== firstTarget || !stamped.statusValues.includes("indeck") || !stamped.toast.includes("已记为不会写") || !stamped.toast.includes("放回口袋")) {
    throw new Error(`Expected miss stamp to update memory and review deck, got ${JSON.stringify(stamped)}`);
  }
  await page.click("#nextBtn");
  await page.waitForFunction(() => !revealed && getComputedStyle(document.getElementById("practiceArea")).display !== "none");

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

  await page.evaluate(() => {
    const fastIdx = CARDS.findIndex((card) => card.target === "强");
    const missIdx = CARDS.findIndex((card) => card.target === "器");
    const hintedIdx = CARDS.findIndex((card) => card.target === "疑");
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
    renderBook();
  });
  const book = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById("studybook")).display !== "none",
    count: document.getElementById("boxCount").textContent,
    dueVisible: getComputedStyle(document.getElementById("dueCard")).display !== "none",
    dueTitle: document.getElementById("dueTitle").textContent,
    tiles: document.querySelectorAll("#boxGrid .boxTile").length,
    activeTab: document.querySelector(".foot .tab.active")?.id,
  }));
  if (!book.visible || !book.count.includes("3") || !book.dueVisible || !book.dueTitle.includes("2") || book.tiles < 3 || book.activeTab !== "tabBook") {
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
    saveTuning();
    roundSummary();
    return {
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
  if (!summary.visible || !summary.sheetVisible || !summary.lead.includes("放回口袋") || summary.tiles.length !== 3 || !summary.pocketVisible || !summary.pocketTitle.includes("2") || summary.tuneButtons.length !== 4 || summary.stop !== "回首页") {
    throw new Error(`Expected result sheet with pocket review and round feedback, got ${JSON.stringify(summary)}`);
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
    activeTab: document.querySelector(".foot .tab.active")?.id,
  }));
  if (!me.visible || Number(me.seen) < 3 || Number(me.risk) < 2 || !me.advice || !me.diagnosisEntry.includes("手感诊断") || me.prefButtons.length !== 3 || !me.internalHidden || me.toolsState !== "展开" || me.activeTab !== "tabMe") {
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
  if (!profile.visible || !profile.footHidden || profile.metrics !== 4 || !profile.hero.includes("今日手感") || !profile.hero.includes("练回炉字") || profile.topics < 1 || profile.levels < 1 || profile.chars < 1) {
    throw new Error(`Expected profile drilldown to be reachable from My page, got ${JSON.stringify(profile)}`);
  }

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

  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  if (pageErrors.length) {
    throw new Error(`Browser reported errors: ${pageErrors.join(" | ")}`);
  }
  console.log(JSON.stringify({ initial, practice, adaptive, home, reveal, stamped, add, book, review, summary, tuningCheck, focus, me, profile, algorithm, screenshotPath }, null, 2));
  await browser.close();
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
