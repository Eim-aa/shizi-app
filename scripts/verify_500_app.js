const { chromium } = require("playwright");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(projectRoot, "generated", "verify_500_app.png");

const sampleTargets = ["强", "器", "随", "察", "群", "疑", "藏", "避", "熟", "翼"];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("shizi.deck.v500.context1"));
  await page.reload({ waitUntil: "networkidle" });

  const overview = await page.evaluate(() => ({
    seed: SEED.length,
    cards: CARDS.length,
    groups: Object.keys(GROUPS).length,
    first: CARDS[0],
    tipText: document.getElementById("tip").textContent,
    contextDeckKey: typeof DECK_KEY !== "undefined" ? DECK_KEY : null,
  }));

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
    await page.waitForFunction(() => !document.getElementById("tip").disabled && groups.length >= 2);
    samples.push(await page.evaluate(() => ({
      target: cur.target,
      word: cur.word,
      py: cur.py,
      prompt: document.getElementById("prompt").textContent,
      groups: groups.slice(),
      totalStrokes,
      tipText: document.getElementById("tip").textContent,
    })));
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ overview, samples }, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
