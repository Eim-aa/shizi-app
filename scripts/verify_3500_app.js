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
  });
  await page.reload({ waitUntil: "networkidle" });

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
    const entries = Object.values(JSON.parse(localStorage.getItem("shizi.memory.v1") || "{}"));
    return {
      memoryEntries: entries.length,
      firstMemory: entries[0],
      statusValues: Object.values(JSON.parse(localStorage.getItem("shizi.deck.v3500.context1") || "{}")),
      reviewCount: typeof reviewCount === "function" ? reviewCount() : null,
    };
  });
  if (feedbackCheck.memoryEntries !== 1 || feedbackCheck.firstMemory.lastOutcome !== "miss") {
    throw new Error(`Expected miss feedback to write memory, got ${JSON.stringify(feedbackCheck)}`);
  }
  if (!feedbackCheck.statusValues.includes("indeck")) {
    throw new Error(`Expected missed card to enter review deck, got ${JSON.stringify(feedbackCheck)}`);
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
  console.log(JSON.stringify({ overview, feedbackCheck, samples }, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
