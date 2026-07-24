const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const approvedContexts = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "context-overrides-approved.json"), "utf8"));
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
assert(source.includes('id="libCard"') && source.includes('id="libSheet"') && source.includes("换库不丢任何东西") && !source.includes('id="prefBox"') && !source.includes("选字偏好") && !source.includes("libPaceText") && !source.includes('id="libBar"') && !source.includes('id="libTones"'), "Expected one reassuring library selector with no retired preference, progress-density, or pace UI");
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
    const tabs=Array.from(document.querySelectorAll(".foot .tab"));
    return { groups: children.length, removed: !!document.querySelector(".brandRow,.streakChip,.monthSignal,.homeSub,.quickAdd"), stamp: [stamp.width, stamp.height], axes: [greeting.left, title.left, recent.left], titleText: homeTitle.textContent.replace(/\s+/g, ""), greeting:homeGreeting.textContent.trim(), add: homeAdd.textContent.trim(), tabs:tabs.map(node=>node.textContent.trim()), tabLayers:tabs.reduce((sum,node)=>sum+node.children.length,0), solid };
  });
  assert(home.groups === 4 && !home.removed && home.stamp.every((value) => value >= 164) && Math.max(...home.axes) - Math.min(...home.axes) < 1 && home.add === "收字" && home.tabs.join() === "习字,字库,我的" && home.tabLayers === 0 && /· (晨|午|暮|夜)$/.test(home.greeting) && home.solid <= 1 && !/\d/.test(home.titleText), "Expected the reduced, aligned home with final single-layer navigation, one solid red, and Chinese title numerals", home);
  const mottoBreak = await page.evaluate(() => { setDailyMotto(homeMotto,{text:"翰不虚动，下必有由",author:"孙过庭",source:"书谱"}); const result=Array.from(homeMotto.children).map(node=>node.textContent); applyDailyMotto(); return result; });
  assert(mottoBreak.join("/") === "翰不虚动，/下必有由/——孙过庭《书谱》", "Expected the sourced vertical motto to break at punctuation", mottoBreak);
  await page.screenshot({ path: path.join(generatedDir, "home-light-375x667.png"), fullPage: true });

  await page.click("#tabBook");
  await page.waitForTimeout(300);
  const wall43 = await page.evaluate(() => ({ count: memoryWall.querySelectorAll(".memoryChar").length, columns: getComputedStyle(memoryWall).gridTemplateColumns.split(" ").length, labels: memoryWall.querySelectorAll(".dot,.outcomeMark").length, curator: bookCuratorData(profileIndexes()).kind, countText: boxCount.textContent.trim(), library: libName.textContent, libraryMeta: libMeta.textContent }));
  assert(wall43.count === 43 && wall43.columns === 6 && wall43.labels === 0 && wall43.curator === "action" && wall43.countText === "43 字" && wall43.library === "常用三千五" && /已拾 \d+ \/ 3500/.test(wall43.libraryMeta), "Expected a 43-character six-column memory wall with honest library progress and action curation", wall43);
  await page.screenshot({ path: path.join(generatedDir, "book-light-375x667.png"), fullPage: true });

  const etymologyDetail = await page.evaluate(async () => {
    await loadEtymology();
    const covered = CARDS.findIndex((card) => card.target === "一"), missing = CARDS.findIndex((card) => card.target === "的");
    openCharSheet(covered);
    const shown = { display: getComputedStyle(etymLine).display, gloss: etymGloss.textContent, source: etymSource.textContent, oneLine: getComputedStyle(etymLine).whiteSpace, overflow: etymLine.scrollWidth <= etymLine.clientWidth + 1 };
    closeCharSheet(); openCharSheet(missing);
    const hidden = getComputedStyle(etymLine).display;
    closeCharSheet();
    return { shown, hidden };
  });
  assert(etymologyDetail.shown.display === "block" && etymologyDetail.shown.gloss.length > 0 && etymologyDetail.shown.source === "——《说文解字》"
    && etymologyDetail.shown.oneLine === "nowrap" && etymologyDetail.shown.overflow && etymologyDetail.hidden === "none",
  "Expected one quiet sourced origin line and silent absence for an unverified character", etymologyDetail);

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
  assert(detail.open && detail.story.includes("收进字库") && detail.story.includes("练过") && detail.noInk.includes("写一遍") && detail.ink === "" && detail.compare === "none" && detail.practice === "再写一遍", "Expected an honest empty character detail with the final library language and no printed handwriting or comparison", detail);
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
  assert(await page.evaluate(() => addSheet.classList.contains("open") && addInput.value.length > 0 && addConfirm.textContent.trim() === "收进字库"), "Expected an unseen library character to enter the final collection flow");
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
  const realWildPhoto = await page.evaluate(async () => {
    const response = await fetch("icon-192.png");
    const blob = await response.blob();
    const dataURL = await cropWildPhoto(new File([blob], "wild-photo-fixture.png", { type: blob.type || "image/png" }));
    const image = new Image(); image.src = dataURL; await image.decode();
    return { dataURL, width: image.naturalWidth, height: image.naturalHeight, bytes: wildImageBytes(dataURL) };
  });
  assert(realWildPhoto.dataURL.startsWith("data:image/webp;base64,") && realWildPhoto.width > 0
    && realWildPhoto.width === realWildPhoto.height && realWildPhoto.bytes <= 64 * 1024,
  "Expected the visual fixtures to use a real decoded and bounded photographed-character image", realWildPhoto);

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
        if (screen === "book") {
          await page.evaluate(() => openLibSheet());
          const librarySheet = await page.evaluate(() => {
            const rect = libSheet.querySelector(".sheet").getBoundingClientRect(), rows = Array.from(libList.querySelectorAll(".libRow"));
            return {
              rows: rows.length, active: rows.filter((row) => row.classList.contains("active")).length,
              minTarget: Math.min(...rows.map((row) => row.getBoundingClientRect().height)),
              horizontalFit: rect.left >= -1 && rect.right <= innerWidth + 1,
              reachable: libSheet.scrollHeight <= libSheet.clientHeight + 1 || getComputedStyle(libSheet).overflowY === "auto",
              reassurance: libSheet.textContent.includes("换库不丢任何东西"),
              noUnapprovedProgress: !libCard.querySelector(".libBar,.libTones") && !libList.querySelector(".libBar") && !/拾完|手速|墨色进度/.test(libSheet.textContent + libCard.textContent),
            };
          });
          assert(librarySheet.rows === 6 && librarySheet.active === 1 && librarySheet.minTarget >= 44 && librarySheet.horizontalFit && librarySheet.reachable && librarySheet.reassurance && librarySheet.noUnapprovedProgress, "Expected the finalized six-library sheet without extra progress or pace UI to fit target iPhone viewports", { size, colorScheme, librarySheet });
          await page.screenshot({ path: path.join(generatedDir, `library-${colorScheme}-${size.width}x${size.height}.png`), fullPage: true });
          await page.evaluate(() => closeLibSheet());
        }
      }
    }
  }

  for (const size of [{ width: 375, height: 667 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      const detailLayout = await page.evaluate((dataURL) => {
        const index = CARDS.findIndex((card) => card.target === "水"), m = cardMemory(index);
        m.source = "wild"; m.wildDay = "2026-07-19"; wildState.captures["水"] = { day: m.wildDay, at: 1, dataURL };
        persistRecentInk(m, [
          [{ x: .35, y: .27, w: 1.15, v: .25 }, { x: .27, y: .38, w: .9, v: .75 }],
          [{ x: .51, y: .16, w: 1.2, v: .18 }, { x: .51, y: .62, w: .95, v: .7 }, { x: .44, y: .82, w: .7, v: 1.05 }],
          [{ x: .43, y: .46, w: 1.05, v: .3 }, { x: .3, y: .62, w: .85, v: .8 }, { x: .17, y: .73, w: .65, v: 1.15 }],
          [{ x: .58, y: .42, w: 1.05, v: .3 }, { x: .68, y: .58, w: .85, v: .75 }, { x: .83, y: .74, w: .65, v: 1.1 }],
        ], new Date("2026-07-19T08:00:00Z").getTime());
        let unknown = ""; for (let code = 0x4e00; code <= 0x9fff && !unknown; code += 1) { const char = String.fromCharCode(code); if (BASE_BY_CHAR[char] == null) unknown = char; }
        wildState.wishes[unknown] = { day: "2026-07-20", at: 2, dataURL }; renderBook(); openCharSheet(index);
        const panel = document.querySelector(".charSheet"), line = etymLine;
        return { visible: getComputedStyle(line).display, oneLine: getComputedStyle(line).whiteSpace, lineFits: line.scrollWidth <= line.clientWidth + 1, panelFits: panel.scrollWidth <= panel.clientWidth + 1, sheetFits: document.documentElement.scrollWidth <= innerWidth + 1, wildVisible: getComputedStyle(charDetailWild).display === "grid", wildStory: charDetailStory.textContent, wishVisible: getComputedStyle(wildWish).display, handCardVisible: getComputedStyle(charDetailCard).display };
      }, realWildPhoto.dataURL);
      assert(detailLayout.visible === "block" && detailLayout.oneLine === "nowrap" && detailLayout.lineFits && detailLayout.panelFits && detailLayout.sheetFits && detailLayout.wildVisible && detailLayout.wildStory.includes("7月19日 拾于生活") && detailLayout.wishVisible === "block" && detailLayout.handCardVisible === "block",
        "Expected origin and photographed-source details plus the unsupported-character wishlist to fit both target viewports and themes", { size, colorScheme, detailLayout });
      await page.screenshot({ path: path.join(generatedDir, `detail-etymology-${colorScheme}-${size.width}x${size.height}.png`), fullPage: true });
      await page.evaluate(() => closeCharSheet());

      const handCardLayout = await page.evaluate(async () => {
        const index = CARDS.findIndex((card) => card.target === "水"); openHandCard(index); await updateHandCardPreview();
        const sheet = document.querySelector("#handCardSheet .handCardSheet"), portrait = { width: handCardPreview.width, height: handCardPreview.height, source: handCardPreview.dataset.inkSource, paper: [...handCardPreview.getContext("2d").getImageData(0, 0, 1, 1).data] };
        setHandCardRatio("square"); await updateHandCardPreview();
        const square = { width: handCardPreview.width, height: handCardPreview.height, className: handCardPreview.className, pressed: document.querySelector('[data-hand-card-ratio="square"]').getAttribute("aria-pressed") };
        return { portrait, square, sheetFits: sheet.scrollWidth <= sheet.clientWidth + 1, pageFits: document.documentElement.scrollWidth <= innerWidth + 1, actions: [handCardCancel, handCardSave, handCardShare].every(button => button.getBoundingClientRect().height >= 44), future: document.querySelector(".handCardFuture").textContent };
      });
      assert(handCardLayout.portrait.width === 1080 && handCardLayout.portrait.height === 1440 && handCardLayout.portrait.source === "vector" && handCardLayout.portrait.paper.slice(0, 3).join() === "244,239,226"
        && handCardLayout.square.width === 1080 && handCardLayout.square.height === 1080 && handCardLayout.square.className.includes("square") && handCardLayout.square.pressed === "true" && handCardLayout.sheetFits && handCardLayout.pageFits && handCardLayout.actions && handCardLayout.future.includes("下一阶段"),
      "Expected fixed-paper 3:4 and 1:1 handwriting-card previews to fit both target viewports and themes", { size, colorScheme, handCardLayout });
      await page.screenshot({ path: path.join(generatedDir, `hand-card-${colorScheme}-${size.width}x${size.height}.png`), fullPage: true });
      await page.evaluate(() => closeHandCard());

      const captureLayout = await page.evaluate((dataURL) => {
        openAddSheet(); wildOCRRequest = 91; wildDraft = { version: 1, day: today(), at: Date.now(), dataURL, requestId: 91 };
        wildCapture.classList.add("hasPhoto"); wildCaptureThumb.src = wildDraft.dataURL; wildCaptureThumb.style.display = "block"; window.shiziOCRResult({ requestId: 91, candidates: ["水永冰"] });
        const sheet = document.querySelector("#addSheet .sheet"), candidates = [...wildCandidates.querySelectorAll("button")];
        return { candidates: candidates.length, inputEmpty: addInput.value === "", confirmDisabled: addConfirm.disabled, sheetFits: sheet.scrollWidth <= sheet.clientWidth + 1, pageFits: document.documentElement.scrollWidth <= innerWidth + 1, photoNote: wildCaptureNote.textContent };
      }, realWildPhoto.dataURL);
      assert(captureLayout.candidates === 3 && captureLayout.inputEmpty && captureLayout.confirmDisabled && captureLayout.sheetFits && captureLayout.pageFits && captureLayout.photoNote.includes("不会自动收字"),
        "Expected the photo candidate picker to remain explicit and overflow-free in both target viewports and themes", { size, colorScheme, captureLayout });
      await page.screenshot({ path: path.join(generatedDir, `capture-${colorScheme}-${size.width}x${size.height}.png`), fullPage: true });
      await page.evaluate(() => closeAddSheet());
    }
  }

  await page.setViewportSize({ width: 375, height: 667 }); await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => startFocus([profileIndexes()[0]], { returnView: "book" }));
  await page.waitForFunction(() => getComputedStyle(card).display !== "none" && !show.disabled);
  const practice = await page.evaluate(() => ({ progress: posLabel.textContent, tip: tip.textContent, visibleMain: [show, done].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.textContent), hiddenPeek: getComputedStyle(peekInk).display, undoOpacity: getComputedStyle(undoStroke).opacity, clearOpacity: getComputedStyle(clear).opacity, quota: /\d+\/5|不计/.test(card.textContent) }));
  assert(practice.progress === "" && practice.tip === "点拨" && practice.visibleMain.join() === "不会写,写好了" && practice.hiddenPeek === "none" && practice.undoOpacity === "0" && practice.clearOpacity === "0" && !practice.quota, "Expected the reduced transient single-character practice card with user-tested direct action names", practice);
  await page.screenshot({ path: path.join(generatedDir, "practice-light-375x667.png"), fullPage: true });
  await page.click("#exitPractice");

  await page.evaluate(() => startFocus([BASE_BY_CHAR["毓"]], { returnView: "book" }));
  await page.waitForFunction(() => getComputedStyle(card).display !== "none" && !show.disabled);
  const idiomContext = await page.evaluate(() => { const node=$("prompt"); return { copy: node.textContent, targetVisible: node.textContent.includes("毓"), fits: node.scrollWidth <= node.clientWidth + 1 }; });
  assert(idiomContext.copy.includes("钟") && idiomContext.copy.includes("灵") && idiomContext.copy.includes("秀") && idiomContext.copy.includes("yù") && !idiomContext.targetVisible && idiomContext.fits, "Expected a four-character idiom to fit while blanking only the target", idiomContext);
  await page.click("#exitPractice");
  const glossCases = Object.entries(approvedContexts.approvedGlosses);
  const glossCombinations = [
    { width: 375, height: 667 },
    { width: 375, height: 812 },
  ].flatMap((size) => ["light", "dark"].flatMap((colorScheme) => [false, true].map((largeText) => ({ size, colorScheme, largeText }))));
  assert(glossCases.length === 45 && glossCombinations.length === 8, "Expected the persistent gloss matrix to cover 45 entries across eight display combinations", { glosses: glossCases.length, combinations: glossCombinations.length });
  let glossMatrixChecks = 0;
  for (const combination of glossCombinations) {
    await page.setViewportSize(combination.size);
    await page.emulateMedia({ colorScheme: combination.colorScheme });
    for (const [target, expectedHint] of glossCases) {
      const layout = await page.evaluate(({ target, expectedHint, largeText }) => {
        fontScaleLarge = largeText; applyFontScale();
        startFocus([BASE_BY_CHAR[target]], { returnView: "book" });
        const promptNode = $("prompt"), hintNode = $("hint"), area = $("practiceArea"), canvas = area.querySelector(".practiceCanvas"), actionNode = $("actions");
        const rect = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
        const promptRect = rect(promptNode), hintRect = rect(hintNode), canvasRect = rect(canvas), actionRect = rect(actionNode), cardRect = rect(card);
        const labelled = (area.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        const described = (area.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        return {
          target, expectedHint, prompt: promptNode.textContent, hint: hintNode.textContent, py: CARDS[BASE_BY_CHAR[target]].py,
          promptRect, hintRect, canvasRect, actionRect, cardRect, labelled, described,
          role: area.getAttribute("role"), labelledBy: area.getAttribute("aria-labelledby"), describedBy: area.getAttribute("aria-describedby"),
          pageWidth: document.documentElement.scrollWidth, innerWidth, hintScrollWidth: hintNode.scrollWidth, hintClientWidth: hintNode.clientWidth,
          fontSize: parseFloat(getComputedStyle(hintNode).fontSize), largeClass: document.documentElement.classList.contains("largeText"),
        };
      }, { target, expectedHint, largeText: combination.largeText });
      const aria = await page.locator("#practiceArea").ariaSnapshot();
      const leak = layout.prompt.includes(target) || layout.hint.includes(target) || aria.includes(target);
      const horizontalFit = layout.pageWidth <= layout.innerWidth + 1 && layout.hintScrollWidth <= layout.hintClientWidth + 1
        && layout.hintRect.left >= layout.cardRect.left - 1 && layout.hintRect.right <= layout.cardRect.right + 1;
      const verticalFit = layout.promptRect.bottom <= layout.hintRect.top + 1 && layout.hintRect.bottom <= layout.canvasRect.top + 1
        && layout.canvasRect.bottom <= layout.actionRect.top + 1 && layout.actionRect.bottom <= layout.cardRect.bottom + 1;
      const semanticText = layout.role === "group" && layout.labelledBy === "prompt" && layout.describedBy === "hint"
        && layout.labelled.includes(layout.py) && layout.described === expectedHint && aria.includes(layout.py) && aria.includes(expectedHint);
      const scaled = combination.largeText ? layout.largeClass && layout.fontSize >= 13.4 : !layout.largeClass && layout.fontSize >= 11.9 && layout.fontSize <= 12.1;
      assert(!leak && layout.hint === expectedHint && horizontalFit && verticalFit && semanticText && scaled,
        "Expected every approved gloss to remain readable, accessible, non-overlapping, and answer-free across the full display matrix",
        { combination, layout, aria, leak, horizontalFit, verticalFit, semanticText, scaled });
      glossMatrixChecks++;
    }
  }
  assert(glossMatrixChecks === 360, "Expected all 360 gloss display combinations to run as a persistent regression gate", glossMatrixChecks);
  await page.setViewportSize({ width: 375, height: 667 }); await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => { fontScaleLarge = false; applyFontScale(); startFocus([BASE_BY_CHAR["谔"]], { returnView: "book" }); });
  await page.screenshot({ path: path.join(generatedDir, "context-gloss-light-375x667.png"), fullPage: true });
  await page.click("#exitPractice");

  assert(errors.length === 0, "Browser errors", errors);
  await browser.close(); browser = null;
  console.log("Verified interface redesign v4 and all 360 gloss layout/accessibility combinations.");
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
