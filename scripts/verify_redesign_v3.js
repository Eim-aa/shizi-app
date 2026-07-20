const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const generatedDir = path.join(root, "generated", "redesign-v4");
fs.mkdirSync(generatedDir, { recursive: true });

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
assert(!/id="bookBadge"|id="addInPractice"|id="bookSearchGo"|id="backupNow"|高频易忘/.test(source), "Expected no red tab debt badge, redundant search/backup button, in-practice add distraction, or retired preference wording");
assert(changelog.includes("一屏至多一个实心朱红") && changelog.includes("印章语义只许两种"), "Expected the permanent red-budget and seal-semantics laws in the changelog");
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
      memory[cardKey(idx)] = { seen: index + 1, firstSeenAt: dayStartMs(day) + index, last: dayStartMs(day) + index, streak: index % 5, ease: 40 + index % 50, misses: index % 7 === 0 ? 1 : 0, lastOutcome: index % 7 === 0 ? "miss" : "fast", pendingLearning: false, dueDay: index < 2 ? today() : shiftDay(today(), 5), fsrsCard: { stability: [0.4, 1.5, 4, 8, 18][index % 5] } };
      status[idx] = "rest";
    });
    saveMemory(); save(DECK_KEY, status); renderHome();
  });

  const home = await page.evaluate(() => {
    const children = Array.from(document.getElementById("home").children).filter((node) => getComputedStyle(node).display !== "none");
    const greeting = homeGreeting.getBoundingClientRect(), title = homeTitle.getBoundingClientRect(), recent = yesterBlock.getBoundingClientRect(), stamp = startBtn.getBoundingClientRect();
    const accent=getComputedStyle(startBtn).backgroundColor, solid=Array.from(home.querySelectorAll("*")).filter(node=>{ const r=node.getBoundingClientRect(); return r.width&&r.height&&getComputedStyle(node).backgroundColor===accent; }).length;
    return { groups: children.length, removed: !!document.querySelector(".brandRow,.streakChip,.monthSignal,.homeSub,.quickAdd"), stamp: [stamp.width, stamp.height], axes: [greeting.left, title.left, recent.left], titleText: homeTitle.textContent.replace(/\s+/g, ""), add: homeAdd.textContent.trim(), solid };
  });
  assert(home.groups === 4 && !home.removed && home.stamp.every((value) => value >= 164) && Math.max(...home.axes) - Math.min(...home.axes) < 1 && home.add === "＋加字" && home.solid <= 1 && !/\d/.test(home.titleText), "Expected the reduced, aligned home with one enlarged seal, one solid red, and Chinese title numerals", home);
  const mottoBreak = await page.evaluate(() => { setDailyMotto(homeMotto,"写过的字，都会回来"); const result=Array.from(homeMotto.children).map(node=>node.textContent); applyDailyMotto(); return result; });
  assert(mottoBreak.join("/") === "写过的字，/都会回来", "Expected the long vertical motto to break at punctuation", mottoBreak);
  await page.screenshot({ path: path.join(generatedDir, "home-light-375x667.png"), fullPage: true });

  await page.click("#tabBook");
  await page.waitForTimeout(300);
  const wall43 = await page.evaluate(() => ({ count: memoryWall.querySelectorAll(".memoryChar").length, columns: getComputedStyle(memoryWall).gridTemplateColumns.split(" ").length, labels: memoryWall.querySelectorAll(".dot,.outcomeMark").length, curator: bookCuratorData(profileIndexes()).kind, countText: boxCount.textContent.trim() }));
  assert(wall43.count === 43 && wall43.columns === 6 && wall43.labels === 0 && wall43.curator === "action" && wall43.countText === "43 字", "Expected a 43-character six-column memory wall with action curation", wall43);
  await page.screenshot({ path: path.join(generatedDir, "book-light-375x667.png"), fullPage: true });

  const legacyPage = await browser.newPage({ viewport: { width: 375, height: 667 }, colorScheme: "light" });
  await legacyPage.goto(appUrl, { waitUntil: "networkidle" });
  const legacySeed = await legacyPage.evaluate(() => {
    const [newer, older] = allIndexes().slice(0, 2), year = Number(today().slice(0, 4)), olderDay = `${year - 1}-01-15`, newerDay = `${year}-06-10`;
    const legacyMemory = {
      [cardKey(newer)]: { seen: 1, last: dayStartMs(newerDay), streak: 2, lastOutcome: "fast", dueDay: shiftDay(today(), 5), fsrsCard: { stability: 8 } },
      [cardKey(older)]: { seen: 3, last: dayStartMs(olderDay), streak: 2, lastOutcome: "fast", dueDay: shiftDay(today(), 5), fsrsCard: { stability: 8 } }
    };
    localStorage.setItem(MEMORY_KEY, JSON.stringify(legacyMemory)); localStorage.setItem(FSRS_LOG_KEY, "[]");
    return { newer, older, olderDay };
  });
  await legacyPage.reload({ waitUntil: "networkidle" }); await legacyPage.click("#tabBook");
  const chronologySnapshot = async () => legacyPage.evaluate(({ older }) => ({
    order: Array.from(memoryWall.querySelectorAll(".memoryChar")).map((node) => Number(node.dataset.idx)),
    monthTicks: memoryWall.querySelectorAll(".monthTick").length,
    olderDay: firstSeenDay(older),
    firstSeenAt: memory[cardKey(older)].firstSeenAt,
    noReviewLog: fsrsReviewLog.length === 0
  }), legacySeed);
  const chronologyBefore = await chronologySnapshot();
  await legacyPage.evaluate(({ older }) => { const m=memory[cardKey(older)]; markFirstSeen(m,Date.now()); m.seen++; m.last=Date.now(); saveMemory(); }, legacySeed);
  await legacyPage.reload({ waitUntil: "networkidle" }); await legacyPage.click("#tabBook");
  const chronologyAfter = await chronologySnapshot(); await legacyPage.close();
  const chronology = { before: chronologyBefore, after: chronologyAfter, expectedOlderDay: legacySeed.olderDay };
  assert(chronology.before.noReviewLog && chronology.after.noReviewLog && chronology.before.firstSeenAt === chronology.after.firstSeenAt && JSON.stringify(chronology.before.order) === JSON.stringify(chronology.after.order) && chronology.before.monthTicks === 0 && chronology.after.monthTicks === 0 && chronology.before.olderDay === chronology.expectedOlderDay && chronology.after.olderDay === chronology.expectedOlderDay, "Expected an app-reloaded no-log legacy character review to preserve persisted collection order without floating month labels", chronology);

  const corruptPage = await browser.newPage({ viewport: { width: 375, height: 667 }, colorScheme: "light" });
  await corruptPage.goto(appUrl, { waitUntil: "networkidle" });
  await corruptPage.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("shizi.tuning.v1", JSON.stringify({ calibrated: true, offset: 0, contextStrict: 0, rounds: [] }));
    localStorage.setItem("shizi.opens.v1", JSON.stringify({ broken: true }));
    localStorage.setItem("shizi.pref.v1", "{");
    localStorage.setItem("shizi.memory.v1", JSON.stringify({ "base:坏": "not-a-memory-row" }));
    localStorage.setItem("shizi.custom.v1", JSON.stringify([42]));
    localStorage.setItem("shizi.topic.v1", JSON.stringify({ not: "a string" }));
    localStorage.setItem("shizi.safety.v1", JSON.stringify([]));
    localStorage.setItem("shizi.session.v1", JSON.stringify({ version: 2 }));
  });
  await corruptPage.reload({ waitUntil: "networkidle" });
  const selfHeal = await corruptPage.evaluate(() => {
    const quarantined = [OPEN_KEY, PREF_KEY, MEMORY_KEY, CUSTOM_KEY, TOPIC_KEY, SAFETY_KEY, SESSION_KEY].map((key) => [key, localStorage.getItem(`shizi.corrupt.${key}`)]);
    return { home: ["flex", "block"].includes(getComputedStyle(home).display), notice: getComputedStyle(bootNotice).display, opens: Array.isArray(opens), memoryRoot: typeof memory === "object" && !Array.isArray(memory), custom: Array.isArray(customWords), quarantined };
  });
  assert(selfHeal.home && selfHeal.notice === "block" && selfHeal.opens && selfHeal.memoryRoot && selfHeal.custom && selfHeal.quarantined.every(([, raw]) => raw !== null), "Expected malformed startup keys and an invalid session to be quarantined independently while the app reaches Home", selfHeal);
  await corruptPage.close();

  await page.click("#memoryWall .memoryChar");
  const detail = await page.evaluate(() => ({ open: charSheet.classList.contains("open"), story: charDetailStory.textContent, noInk: charDetailEmpty.textContent, ink: charDetailInk.textContent, compare: getComputedStyle(charDetailCompareToggle).display, practice: charDetailPractice.textContent }));
  assert(detail.open && detail.story.includes("练过") && detail.noInk.includes("写一遍") && detail.ink === "" && detail.compare === "none" && detail.practice === "再写一遍", "Expected an honest empty character detail without printed handwriting or comparison", detail);
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
  assert(await page.evaluate(() => memoryWall.querySelectorAll(".searchHit").length === 1 && memoryWall.querySelectorAll(".searchDim").length > 0), "Expected a collected search result to highlight immediately");
  await page.waitForTimeout(850);
  assert(await page.evaluate(() => charSheet.classList.contains("open")), "Expected a collected search result to open its detail sheet");
  await page.evaluate(() => closeCharSheet());
  await page.fill("#bookSearchInput", searchTargets[1]);
  await page.click("#bookSearchResult [data-book-add]");
  assert(await page.evaluate(() => addSheet.classList.contains("open") && addInput.value.length > 0), "Expected an unseen library character to enter the add flow");
  await page.evaluate(() => closeAddSheet());
  await page.fill("#bookSearchInput", "龘");
  assert(await page.evaluate(() => bookSearchResult.textContent === "没有这个字"), "Expected an unknown character to show an immediate no-match response");

  await page.evaluate(() => { renderBook(); openCharSheet(profileIndexes()[0]); });
  await page.click("#charDetailPractice");
  await page.waitForFunction(() => getComputedStyle(card).display !== "none");
  const singleFocus = await page.evaluate(() => ({ progress:posLabel.textContent, session:localStorage.getItem(SESSION_KEY), add:!!document.getElementById("addInPractice"), tools:Array.from(inkTools.querySelectorAll("button")).filter(node=>getComputedStyle(node).display!=="none").map(node=>node.id) }));
  assert(singleFocus.progress === "" && singleFocus.session === null && !singleFocus.add && singleFocus.tools.join() === "tip,undoStroke,clear", "Expected a transient single-character session with no numeric progress or in-practice add entry", singleFocus);
  await page.click("#exitPractice");
  await page.waitForFunction(() => getComputedStyle(studybook).display !== "none");
  assert(await page.evaluate(() => localStorage.getItem(SESSION_KEY) === null), "Expected a single-character session to disperse and return to the book without hijacking Home resume");

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
  await page.waitForTimeout(320);
  const me = await page.evaluate(() => ({ groups: [meCalendar, openProfile, document.querySelector(".meMonthCard"), document.querySelector(".mePrimaryRows"), annualReportLink].filter(Boolean).length, noStats: !document.querySelector(".meStats"), calendar: calendarGrid.querySelectorAll(".calendarDay").length, thumb: meMonthPreview.getAttribute("src") || "", backup: backupStatus.textContent }));
  assert(me.groups === 5 && me.noStats && me.calendar >= 28 && me.thumb.startsWith("data:image/") && me.backup.length > 0, "Expected the five-group study My page with a live monthly thumbnail", me);
  await page.screenshot({ path: path.join(generatedDir, "me-light-375x667.png"), fullPage: true });
  const backupUrgency = await page.evaluate(() => { const savedActivity=cloneObj(activity), savedMeta=cloneObj(backupMeta); activity=newActivity(); activity.inheritedStreak=0; activity.inheritedTotalDays=0; activity.daily={}; activity.practiceDays=[]; for(let n=0;n<14;n++){ const day=shiftDay(today(),-n); activity.practiceDays.push(day); activity.daily[day]={stamps:1,attempts:1,targetKeys:[`verify:${n}`],completedRoundIds:[`round:${n}`]}; } backupMeta=normalizeBackupMeta(null); saveActivity(); save(BACKUP_META_KEY,backupMeta); renderMe(); const accent=getComputedStyle(backupUrgency).backgroundColor, solid=Array.from(mePanel.querySelectorAll("*")).filter(node=>{ const r=node.getBoundingClientRect(); return r.width&&r.height&&getComputedStyle(node).backgroundColor===accent; }).length, result={status:backupStatus.textContent,color:getComputedStyle(backupStatus).color,muted:getComputedStyle(calendarMonthStat).color,urgent:getComputedStyle(document.getElementById("backupUrgency")).display,todayBg:getComputedStyle(calendarGrid.querySelector(".todayStamp")).backgroundColor,accent,solid}; activity=normalizeActivity(savedActivity); backupMeta=normalizeBackupMeta(savedMeta); saveActivity(); save(BACKUP_META_KEY,backupMeta); renderMe(); return result; });
  assert(backupUrgency.status === "从未备份" && backupUrgency.urgent === "flex" && backupUrgency.color !== backupUrgency.muted, "Expected the overdue backup status to become visibly urgent on My", backupUrgency);
  assert(backupUrgency.solid <= 1 && backupUrgency.todayBg !== backupUrgency.accent, "Expected My to carry the sole urgent backup seal while downgrading today's calendar seal", backupUrgency);
  const profile = await page.evaluate(() => { const indexes=profileIndexes(); indexes.slice(0,12).forEach((idx,index)=>{ memory[cardKey(idx)].misses=index<6?3:1; }); memory[cardKey(indexes[0])].misses=1; memory[cardKey(indexes[0])].hints=9; memory[cardKey(indexes[0])].slow=7; saveMemory(); renderProfile(); const accent=getComputedStyle(profilePractice).backgroundColor, solid=Array.from(profilePanel.querySelectorAll("*")).filter(node=>{ const r=node.getBoundingClientRect(); return r.width&&r.height&&getComputedStyle(node).backgroundColor===accent; }).length; const factual=document.getElementById("profileAdvice").querySelector(`[data-char-idx="${indexes[0]}"] small`)?.textContent; return { weak:profilePanel.querySelectorAll(".weakChar").length, metrics:profilePanel.querySelectorAll(".profileMetrics,.profileHero").length, action:profilePractice.textContent.trim(), solid, factual }; });
  assert(profile.weak >= 6 && profile.metrics === 0 && profile.action === "把这几个写一遍" && profile.solid <= 1 && profile.factual === "忘过 1 次", "Expected real weak characters with miss-only facts, no diagnosis/stat cards, one direct practice action, and one solid red", profile);
  await page.waitForTimeout(320);
  await page.screenshot({ path: path.join(generatedDir, "profile-light-375x667.png"), fullPage: true });
  await page.evaluate(() => renderMe());
  const insight = await page.evaluate(() => {
    const indexes = profileIndexes(), savedMemory = cloneObj(memory);
    indexes.slice(0, 12).forEach((idx, index) => { memory[cardKey(idx)].misses = index < 4 ? 3 : 0; });
    const weak=indexes.filter((idx)=>missCount(idx)>0); renderProfile(); const primary = primaryProfileInsight(weak), topic = profileGroups(weak, cardTopic)[0], structure = profileGroups(weak, structureLabel)[0], level = profileGroups(weak, abilityLevel)[0], copy = profileSummary.textContent;
    const secondaryLabels = [structure && structure.label, level && level.label].filter((label) => label && label !== primary.label);
    memory = savedMemory; renderMe();
    return { kind: primary.kind, primary: primary.label, includesPrimary: copy.includes(primary.label), secondaryLabels, includedSecondary: secondaryLabels.filter((label) => copy.includes(label)), copy, topic: topic && topic.label };
  });
  assert(insight.kind === "topic" && insight.primary === insight.topic && insight.includesPrimary && insight.includedSecondary.length === 0, "Expected profile guidance to mention only the fixed-priority primary insight", insight);
  await page.click("#openSettings");
  await page.waitForTimeout(300);
  const settings = await page.evaluate(() => ({ visible: getComputedStyle(settingsPanel).display !== "none", groups: Array.from(settingsPanel.querySelectorAll(".meLabel")).map((node) => node.textContent), dangerous: getComputedStyle(resetLink).color, normal: getComputedStyle(exportLink).color, dev: getComputedStyle(devTools).display }));
  assert(settings.visible && settings.groups.includes("练习") && settings.groups.includes("显示") && settings.groups.includes("数据") && settings.dangerous !== settings.normal && settings.dev === "none", "Expected functional grouped settings with a distinct destructive action", settings);
  await page.screenshot({ path: path.join(generatedDir, "settings-light-375x667.png"), fullPage: true });

  const screens = ["home", "book", "me", "profile", "settings"];
  for (const size of [{ width: 375, height: 667 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      for (const screen of screens) {
        await page.evaluate((name) => ({ home: renderHome, book: renderBook, me: renderMe, profile: renderProfile, settings: () => renderSettings(false) })[name](), screen);
        await page.waitForTimeout(80);
        const layout = await page.evaluate((name) => {
          const roots = { home, book: studybook, me: mePanel, profile: profilePanel, settings: settingsPanel }, root = roots[name], probe = document.createElement("i");
          probe.style.background = "var(--accent)"; document.body.appendChild(probe); const accent = getComputedStyle(probe).backgroundColor; probe.remove();
          const solid = [root, ...root.querySelectorAll("*")].filter((node) => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.backgroundColor === accent; }).length;
          return { visible: getComputedStyle(root).display !== "none", scrollWidth: document.documentElement.scrollWidth, innerWidth, solid, accent, bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() };
        }, screen);
        assert(layout.visible && layout.scrollWidth <= layout.innerWidth + 1 && layout.solid <= 1, "Expected every v4 screen to fit both target iPhone viewports and respect the one-solid-red budget", { screen, size, colorScheme, layout });
        await page.screenshot({ path: path.join(generatedDir, `${screen}-${colorScheme}-${size.width}x${size.height}.png`), fullPage: true });
      }
    }
  }

  await page.setViewportSize({ width: 375, height: 667 }); await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => startFocus([profileIndexes()[0]], { returnView: "book" }));
  await page.waitForFunction(() => getComputedStyle(card).display !== "none" && !show.disabled);
  const practice = await page.evaluate(() => ({ progress: posLabel.textContent, tip: tip.textContent, visibleMain: [show, done].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.textContent), hiddenPeek: getComputedStyle(peekInk).display, undoOpacity: getComputedStyle(undoStroke).opacity, clearOpacity: getComputedStyle(clear).opacity, quota: /\d+\/5|不计/.test(card.textContent) }));
  assert(practice.progress === "" && practice.tip === "提示" && practice.visibleMain.join() === "不会写,写好了" && practice.hiddenPeek === "none" && practice.undoOpacity === "0" && practice.clearOpacity === "0" && !practice.quota, "Expected the reduced transient single-character practice card", practice);
  await page.screenshot({ path: path.join(generatedDir, "practice-light-375x667.png"), fullPage: true });
  await page.click("#exitPractice");

  assert(errors.length === 0, "Browser errors", errors);
  await browser.close(); browser = null;
  console.log("Verified interface redesign v4 palette, home, honest detail sheet, instant memory wall search, My, settings, and responsive layouts.");
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
