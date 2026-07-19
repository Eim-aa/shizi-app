const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function luminance(hex) {
  const values = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

assert(source.includes("--bg:#f4efe2") && source.includes("--card:#fdfbf4") && source.includes("--shade:#ede7d6") && source.includes("--gold:#a67c26"), "Expected the approved raw-paper palette");
assert(!/--soft\s*:|--tile\s*:|var\(--soft\)|var\(--tile\)/.test(source), "Expected the five cream surfaces to collapse to three");
assert(!/#efe7d3|#f7f1e3|#fbf6ea|#f3ead7|#e3d9c4|#2b2620|#b3892f/i.test(source), "Expected no legacy light-palette values");
assert(!/卡点分析|掌握感|易忘度|出题偏好/.test(source), "Expected no PM terms or dimensionless scores in the app UI");
assert(contrast("#756b5a", "#f4efe2") >= 4.5, "Expected the palest memory ink to meet 4.5:1 contrast", { ratio: contrast("#756b5a", "#f4efe2") });

let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, colorScheme: "light" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 8; activity.practiceDays = [shiftDay(today(), -2), shiftDay(today(), -1), today()];
    activity.practiceDays.forEach((day, index) => { activity.daily[day] = { stamps: 1, attempts: 1, targetKeys: [`base:${CARDS[index].target}`], independentTargetKeys: [`base:${CARDS[index].target}`], completedRoundIds: index === 2 ? ["today"] : [String(index)], lastStampAt: Date.now() - index * 1000 }; }); saveActivity();
    memory = {}; status = {};
    allIndexes().slice(0, 43).forEach((idx, index) => {
      const day = shiftDay(today(), -Math.floor(index / 12));
      memory[cardKey(idx)] = { seen: index + 1, last: dayStartMs(day) + index, streak: index % 5, ease: 40 + index % 50, misses: index % 7 === 0 ? 1 : 0, lastOutcome: index % 7 === 0 ? "miss" : "fast", pendingLearning: false, dueDay: index < 2 ? today() : shiftDay(today(), 5), fsrsCard: { stability: [0.4, 1.5, 4, 8, 18][index % 5] } };
      status[idx] = "rest";
    });
    saveMemory(); save(DECK_KEY, status); renderHome();
  });

  const home = await page.evaluate(() => {
    const children = Array.from(document.getElementById("home").children).filter((node) => getComputedStyle(node).display !== "none");
    const greeting = homeGreeting.getBoundingClientRect(), title = homeTitle.getBoundingClientRect(), recent = yesterBlock.getBoundingClientRect(), stamp = startBtn.getBoundingClientRect();
    return { groups: children.length, removed: !!document.querySelector(".brandRow,.streakChip,.monthSignal,.homeSub,.quickAdd"), stamp: [stamp.width, stamp.height], axes: [greeting.left, title.left, recent.left], titleText: homeTitle.textContent.replace(/\s+/g, ""), add: homeAdd.textContent.trim() };
  });
  assert(home.groups === 4 && !home.removed && home.stamp.every((value) => value >= 164) && Math.max(...home.axes) - Math.min(...home.axes) < 1 && home.add === "＋加字", "Expected the reduced, aligned home with one enlarged seal", home);

  await page.click("#tabBook");
  const wall43 = await page.evaluate(() => ({ count: memoryWall.querySelectorAll(".memoryChar").length, columns: getComputedStyle(memoryWall).gridTemplateColumns.split(" ").length, labels: memoryWall.querySelectorAll(".dot,.outcomeMark").length, curator: bookCuratorData(profileIndexes()).kind, countText: boxCount.textContent.trim() }));
  assert(wall43.count === 43 && wall43.columns === 6 && wall43.labels === 0 && wall43.curator === "action" && wall43.countText === "43 字", "Expected a 43-character six-column memory wall with action curation", wall43);

  const chronology = await page.evaluate(() => {
    const savedMemory = cloneObj(memory), savedStatus = cloneObj(status), savedLog = cloneObj(fsrsReviewLog);
    const [newer, older] = allIndexes().slice(0, 2), year = Number(today().slice(0, 4)), olderDay = `${year - 1}-01-15`, newerDay = `${year}-06-10`;
    memory = {
      [cardKey(newer)]: { seen: 1, last: dayStartMs(newerDay), streak: 2, lastOutcome: "fast", dueDay: shiftDay(today(), 5), fsrsCard: { stability: 8 } },
      [cardKey(older)]: { seen: 3, last: Date.now(), streak: 2, lastOutcome: "fast", dueDay: shiftDay(today(), 5), fsrsCard: { stability: 8 } }
    };
    status = { [newer]: "rest", [older]: "rest" };
    fsrsReviewLog = [
      { cardKey: cardKey(older), localDay: olderDay, reviewedAt: `${olderDay}T08:00:00.000Z` },
      { cardKey: cardKey(older), localDay: today(), reviewedAt: `${today()}T08:00:00.000Z` },
      { cardKey: cardKey(newer), localDay: newerDay, reviewedAt: `${newerDay}T08:00:00.000Z` }
    ];
    const snapshot = () => ({
      order: Array.from(memoryWall.querySelectorAll(".memoryChar")).map((node) => Number(node.dataset.idx)),
      olderMonth: memoryWall.querySelector(`[data-idx="${older}"] .monthTick`)?.textContent || "",
      olderDay: firstSeenDay(older)
    });
    renderBook(); const before = snapshot();
    memory[cardKey(older)].last = Date.now() + 100000;
    fsrsReviewLog.push({ cardKey: cardKey(older), localDay: today(), reviewedAt: `${today()}T12:00:00.000Z` });
    renderBook(); const after = snapshot();
    memory = savedMemory; status = savedStatus; fsrsReviewLog = savedLog; renderBook();
    return { before, after, expectedOlderDay: olderDay };
  });
  assert(JSON.stringify(chronology.before.order) === JSON.stringify(chronology.after.order) && chronology.before.olderMonth === "1月" && chronology.after.olderMonth === "1月" && chronology.before.olderDay === chronology.expectedOlderDay && chronology.after.olderDay === chronology.expectedOlderDay, "Expected an old character review to preserve collection order and month", chronology);

  await page.click("#memoryWall .memoryChar");
  const detail = await page.evaluate(() => ({ open: charSheet.classList.contains("open"), story: charDetailStory.textContent, noInk: charDetailEmpty.textContent, practice: charDetailPractice.textContent }));
  assert(detail.open && detail.story.includes("练过") && detail.noInk.includes("写一遍") && detail.practice === "再写一遍", "Expected the factual character detail fallback", detail);
  await page.click("#charDetailCompareToggle");
  assert(await page.evaluate(() => getComputedStyle(charDetailStandard).display === "flex"), "Expected standard-character comparison in the detail sheet");
  const swipe = await page.evaluate(() => {
    const panel = document.querySelector("#charSheet .charSheet"), handle = panel.querySelector(".sheetHandle"), head = panel.querySelector(".charDetailHead"), ink = panel.querySelector(".charDetailInk");
    const fire = (target, type, y) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, type === "touchstart" ? "touches" : "changedTouches", { value: [{ clientY: y }] }); target.dispatchEvent(event); };
    panel.style.maxHeight = "180px"; panel.scrollTop = 40;
    fire(head, "touchstart", 100); fire(head, "touchend", 190); const scrolledContentStayed = charSheet.classList.contains("open");
    panel.scrollTop = 0;
    fire(ink, "touchstart", 100); fire(ink, "touchend", 190); const contentStayed = charSheet.classList.contains("open");
    fire(handle, "touchstart", 100); fire(handle, "touchend", 190); const handleClosed = !charSheet.classList.contains("open");
    panel.style.maxHeight = ""; return { scrolledContentStayed, contentStayed, handleClosed };
  });
  assert(swipe.scrolledContentStayed && swipe.contentStayed && swipe.handleClosed, "Expected detail-sheet dismissal only from its top drag zone at scrollTop zero", swipe);

  const searchTargets = await page.evaluate(() => [CARDS[0].target, CARDS[100].target]);
  await page.fill("#bookSearchInput", searchTargets[0]);
  await page.click("#bookSearchGo");
  assert(await page.evaluate(() => charSheet.classList.contains("open")), "Expected a collected search result to open its detail sheet");
  await page.evaluate(() => closeCharSheet());
  await page.fill("#bookSearchInput", searchTargets[1]);
  await page.click("#bookSearchGo");
  assert(await page.evaluate(() => addSheet.classList.contains("open") && addInput.value.length > 0), "Expected an unseen library character to enter the add flow");
  await page.evaluate(() => closeAddSheet());
  await page.fill("#bookSearchInput", "龘");
  await page.click("#bookSearchGo");
  assert(await page.evaluate(() => addSheet.classList.contains("open") && addInput.value === "龘"), "Expected a rare custom character to enter the add flow");
  await page.evaluate(() => closeAddSheet());

  const curators = await page.evaluate(() => {
    const seen = profileIndexes();
    seen.forEach((idx) => { memory[cardKey(idx)].dueDay = shiftDay(today(), 5); });
    fsrsReviewLog = [{ cardKey: cardKey(seen[3]), localDay: `${Number(today().slice(0, 4)) - 1}-${today().slice(5)}`, reviewedAt: `${Number(today().slice(0, 4)) - 1}-${today().slice(5)}T08:00:00.000Z` }];
    const recall = bookCuratorData(seen); fsrsReviewLog = []; const discovery = bookCuratorData(seen);
    memory[cardKey(seen[0])].dueDay = today(); const action = bookCuratorData(seen);
    return [recall.kind, discovery.kind, action.kind];
  });
  assert(curators.join() === "recall,discovery,action", "Expected recall, discovery, and action curator rules", curators);

  const wall300 = await page.evaluate(() => {
    memory = {}; status = {}; const started = performance.now();
    allIndexes().slice(0, 300).forEach((idx, index) => { memory[cardKey(idx)] = { seen: 1, last: Date.now() - index, streak: index % 4, lastOutcome: "fast", dueDay: shiftDay(today(), 5), fsrsCard: { stability: 1 + index % 20 } }; status[idx] = "rest"; });
    renderBook(); return { count: memoryWall.querySelectorAll(".memoryChar").length, ms: performance.now() - started, scrollWidth: document.documentElement.scrollWidth, innerWidth };
  });
  assert(wall300.count === 300 && wall300.ms < 500 && wall300.scrollWidth <= wall300.innerWidth + 1, "Expected the 300-character wall to render quickly without horizontal overflow", wall300);

  await page.click("#tabMe");
  await page.waitForTimeout(120);
  const me = await page.evaluate(() => ({ groups: [meCalendar, openProfile, document.querySelector(".meMonthCard"), document.querySelector(".mePrimaryRows"), annualReportLink].filter(Boolean).length, noStats: !document.querySelector(".meStats"), calendar: calendarGrid.querySelectorAll(".calendarDay").length, thumb: meMonthPreview.getAttribute("src") || "", backup: backupStatus.textContent }));
  assert(me.groups === 5 && me.noStats && me.calendar >= 28 && me.thumb.startsWith("data:image/") && me.backup.length > 0, "Expected the five-group study My page with a live monthly thumbnail", me);
  const insight = await page.evaluate(() => {
    const indexes = profileIndexes(), savedMemory = cloneObj(memory);
    indexes.slice(0, 12).forEach((idx, index) => { memory[cardKey(idx)].misses = index < 4 ? 3 : 0; });
    renderProfile(); const primary = primaryProfileInsight(indexes), topic = profileGroups(indexes, cardTopic)[0], structure = profileGroups(indexes, structureLabel)[0], level = profileGroups(indexes, abilityLevel)[0], copy = `${profileAdvice.textContent} ${profilePanel.querySelector(".profileHero p").textContent}`;
    const secondaryLabels = [structure && structure.label, level && level.label].filter((label) => label && label !== primary.label);
    memory = savedMemory; renderMe();
    return { kind: primary.kind, primary: primary.label, includesPrimary: copy.includes(primary.label), secondaryLabels, includedSecondary: secondaryLabels.filter((label) => copy.includes(label)), copy, topic: topic && topic.label };
  });
  assert(insight.kind === "topic" && insight.primary === insight.topic && insight.includesPrimary && insight.includedSecondary.length === 0, "Expected profile guidance to mention only the fixed-priority primary insight", insight);
  await page.click("#openSettings");
  const settings = await page.evaluate(() => ({ visible: getComputedStyle(settingsPanel).display !== "none", groups: Array.from(settingsPanel.querySelectorAll(".meLabel")).map((node) => node.textContent), dangerous: getComputedStyle(resetLink).color, normal: getComputedStyle(exportLink).color, dev: getComputedStyle(devTools).display }));
  assert(settings.visible && settings.groups.includes("练习") && settings.groups.includes("显示") && settings.groups.includes("数据") && settings.dangerous !== settings.normal && settings.dev === "none", "Expected functional grouped settings with a distinct destructive action", settings);

  for (const size of [{ width: 375, height: 667 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => renderMe());
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, footBottom: foot.getBoundingClientRect().bottom, height: innerHeight, bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }));
      assert(layout.scrollWidth <= layout.innerWidth + 1 && layout.footBottom <= layout.height + 1, "Expected My to fit both target iPhone viewports", { size, colorScheme, layout });
    }
  }

  assert(errors.length === 0, "Browser errors", errors);
  await browser.close(); browser = null;
  console.log("Verified interface redesign v3 palette, home, detail sheet, memory wall, My, settings, and responsive layouts.");
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
