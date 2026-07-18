const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appUrl = process.env.SHIZI_APP_URL || "http://127.0.0.1:8000/";
const screenshotPath = path.join(root, "generated", "verify_8105_app.png");
const SESSION_STORAGE_KEY = "shizi.session.v1";
const source = fs.readFileSync(path.join(root, "index.html"), "utf8");
const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const coreStrokeSource = fs.readFileSync(path.join(root, "core-strokes.js"), "utf8");
const appDelegateSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "AppDelegate.swift"), "utf8");
const webViewSource = fs.readFileSync(path.join(root, "ios", "ShiziApp", "ShiziApp", "WebViewController.swift"), "utf8");

if (/退出本组？|进度已保存，随时可继续这组|描一遍也算拾回|小时后再见|已收|拾到手|教学检查|本组通过|待巩固|差点|回炉|改一下|已稳/.test(source)) {
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

assert(swSource.includes("shizi-v9") && swSource.includes("Promise.allSettled") && swSource.includes("INSTALL_BATCH_SIZE = 40") && swSource.includes("cacheCoreStrokes"), "Expected versioned, batched, failure-tolerant core stroke installation");
assert(coreStrokeSource.includes("SHIZI_CORE_STROKES") && coreStrokeSource.includes("slice(0,600)"), "Expected a generated 600-character core stroke list");
assert(!source.includes("sendBeacon") && !/method\s*:\s*["']POST["']/.test(source), "Expected the local funnel to add no analytics beacon or POST request");
assert(!/rgba\(194,\s*69,\s*44/i.test(source) && source.includes("--accent-rgb:194,69,44") && source.includes("--accent-rgb:212,85,58"), "Expected every cinnabar alpha to follow the light/dark theme token");
assert(source.includes(".card.undoActive .chdr{ visibility:hidden; }") && !source.includes('$("tip").title='), "Expected the undo bar to replace the header and touch guidance to avoid invisible title copy");
assert(/funnelValue\s*:\s*cloneObj\(funnel\)/.test(source) && /funnel\s*=\s*cloneObj\(snap\.funnelValue\)/.test(source), "Expected the stamp undo snapshot to capture and restore the local funnel");
assert(source.includes("ROUND_DURATION_CAP_MS") && /durationMs\s*:\s*Math\.min\(/.test(source), "Expected the round duration to be capped client-side against background/idle inflation");
assert(source.includes("STAMP_HOLD_MS=1800") && source.includes("EDIT_STAMP_WINDOW_MS=1800") && source.includes("shortDueDay(m.dueDay)"), "Expected readable 1800ms stamp feedback and a compact due date");
assert(source.includes('navigator.vibrate(10)') && source.includes('animation="cardSwapIn .18s ease-out both"') && source.includes('classList.add("revealing")'), "Expected Web haptics and staggered card/reveal transitions");
assert(source.includes('OUTCOME_DOT={ fast:"transparent", hinted:"var(--gold)", slow:"var(--accent)"') && !/slow:\s*"var\(--blue\)"/.test(source), "Expected silent success, gold assistance, and cinnabar risk result semantics");
assert(source.includes('if(!sound.enabled') && source.includes('{type:"sound",kind}') && source.includes('if(tracing) soundFeedback("paper")') && source.includes('soundFeedback("stamp")'), "Expected two-site, opt-out paper sound feedback with no disabled audio initialization");
assert(webViewSource.includes("AVAudioSession.sharedInstance().setCategory(.ambient") && webViewSource.includes('case "sound"') && webViewSource.includes('content.userInfo = ["targetCardKey": question.targetCardKey]'), "Expected native ambient paper sounds and notification target metadata");
assert(appDelegateSource.includes("didReceive response: UNNotificationResponse") && appDelegateSource.includes("openReminderTarget(cardKey: targetCardKey)"), "Expected notification taps to reach the Web practice target on cold or warm launch");

function verifyBackupSummaryScript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shizi-funnel-"));
  const backup = (opens, funnel) => ({ app: "shizi", version: 1, date: "2026-07-16T08:00:00.000Z", data: { "shizi.opens.v1": JSON.stringify(opens), "shizi.funnel.v1": JSON.stringify(funnel) } });
  const events = (...names) => names.map((name, index) => ({ name, at: Date.UTC(2026, 6, index + 1), day: `2026-07-${String(index + 1).padStart(2, "0")}` }));
  const rows = [
    backup(["2026-07-01", "2026-07-02", "2026-07-08"], { version: 1, events: events("welcome_shown", "calib_card1_done", "calib_completed"), counts: { revealCompared: 10, revealDisagree: 2 }, rounds: [{ completedAt: 1, durationMs: 60000 }, { completedAt: 2, durationMs: 120000 }] }),
    backup(["2026-07-01", "2026-07-03", "2026-07-08"], { version: 1, events: events("welcome_shown", "calib_card1_done"), counts: { revealCompared: 5, revealDisagree: 1 }, rounds: [{ completedAt: 3, durationMs: 30000 }] }),
  ];
  const files = rows.map((row, index) => { const file = path.join(dir, `${index}.json`); fs.writeFileSync(file, JSON.stringify(row)); return file; });
  try {
    const output = execFileSync("python3", [path.join(root, "scripts", "summarize_backups.py"), "--json", ...files], { encoding: "utf8" });
    const summary = JSON.parse(output);
    assert(summary.retention.d1.returned === 1 && summary.retention.d1.eligible === 2 && summary.retention.d7.returned === 2 && summary.retention.d7.eligible === 2
      && summary.calibration.card1_rate === 1 && summary.calibration.completion_rate === 0.5
      && summary.system_comparison.disagreement_rate === 0.2 && summary.rounds.completed === 3 && summary.rounds.average_duration_seconds === 70,
    "Expected backup summary D1/D7, calibration, disagreement, and duration metrics", summary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

verifyBackupSummaryScript();

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
  let offlineProbe = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { const value = message.text(); if (message.type() === "error" && !(offlineProbe && /ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(value))) pageErrors.push(value); });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const firstRun = await page.evaluate(() => ({
    welcome: getComputedStyle(document.getElementById("welcome")).display !== "none",
    copy: document.getElementById("welcome").textContent.replace(/\s+/g, ""),
    footHidden: getComputedStyle(document.getElementById("foot")).display === "none",
    needsCalibration: needsCalibration(),
    restoreVisible: getComputedStyle(document.getElementById("welcomeRestore")).display !== "none" && typeof document.getElementById("welcomeRestore").onclick === "function",
    tabs: Array.from(document.querySelectorAll("#foot .tab")).map((node) => node.textContent.replace(/\s+/g, "")),
    welcomeEvents: funnel.events.filter((row) => row.name === "welcome_shown").length,
  }));
  assert(firstRun.welcome && firstRun.footHidden && firstRun.needsCalibration && firstRun.restoreVisible && firstRun.copy.includes("先拾15个字试试") && firstRun.copy.includes("记录只存在这台手机上") && firstRun.tabs.join() === "拾练习,盒字盒,我我的" && firstRun.welcomeEvents === 1, "Expected first-run calibration welcome, one-time funnel event, storage expectation, restore entry, and three-tab IA", firstRun);

  const p2Style = await page.evaluate(async () => {
    await document.fonts.ready;
    const nodes = { root: document.documentElement, heading: document.querySelector(".welcome h1"), actions: document.querySelector(".welcomeActions"), cta: document.getElementById("welcomeStart"), body: document.body, sheet: document.querySelector(".sheetCard"), toastGlyph: document.getElementById("toastChar") };
    const missing = Object.entries(nodes).filter(([, node]) => !(node instanceof Element)).map(([name]) => name); if (missing.length) throw new Error(`Missing style nodes: ${missing.join(",")}`);
    const root = getComputedStyle(nodes.root), heading = getComputedStyle(nodes.heading), actions = getComputedStyle(nodes.actions), cta = getComputedStyle(nodes.cta), body = getComputedStyle(nodes.body), sheet = getComputedStyle(nodes.sheet), toastGlyph = getComputedStyle(nodes.toastGlyph), source = document.querySelector("style").textContent;
    const fontMatch = source.match(/data:font\/woff2;base64,([^)]*)/);
    return { tokens: ["--fs-caption", "--fs-note", "--fs-body", "--fs-emph"].map((name) => root.getPropertyValue(name).trim()), spaces: ["--space-1", "--space-2", "--space-3", "--space-4"].map((name) => root.getPropertyValue(name).trim()), letter: [root.getPropertyValue("--ls-label").trim(), root.getPropertyValue("--ls-motto").trim()], faint: root.getPropertyValue("--faint").trim(), kai: root.getPropertyValue("--kai"),
      heading: { size: parseFloat(heading.fontSize), line: parseFloat(heading.lineHeight), spacing: heading.letterSpacing }, actionsMargin: parseFloat(actions.marginTop), ctaMargin: parseFloat(cta.marginTop), toastGlyph: parseFloat(toastGlyph.fontSize), bodyNoise: body.backgroundImage, sheetNoise: sheet.backgroundImage,
      fontLoaded: document.fonts.check('24px "Shizi Brand"', "拾字练习"), fontBytes: fontMatch ? atob(fontMatch[1]).length : 0, inlineWelcomeStyle: document.querySelector(".welcomeActions").hasAttribute("style"), nonzeroLetterSpacing: Array.from(source.matchAll(/letter-spacing:\s*([^;}]+)/g), (match) => match[1].trim()).some((value) => !["0", "var(--ls-label)", "var(--ls-motto)"].includes(value)) };
  });
  assert(p2Style.tokens.join() === "11px,12px,13px,15px" && p2Style.spaces.join() === "8px,12px,16px,24px" && p2Style.letter.join() === ".12em,.26em" && p2Style.faint === "#6a604f" && p2Style.kai.includes("DFKai-SB") && p2Style.kai.includes("AR PL UKai CN") && p2Style.kai.includes("TW-Kai")
    && p2Style.heading.size === 31 && Math.abs(p2Style.heading.line / p2Style.heading.size - 1.35) < 0.02 && ["normal", "0px"].includes(p2Style.heading.spacing) && p2Style.actionsMargin === 52 && p2Style.ctaMargin === 0 && !p2Style.inlineWelcomeStyle
    && p2Style.toastGlyph === 26 && p2Style.bodyNoise !== "none" && p2Style.sheetNoise !== "none" && p2Style.fontLoaded && p2Style.fontBytes > 0 && p2Style.fontBytes < 20000 && !p2Style.nonzeroLetterSpacing,
  "Expected converged type/spacing tokens, an offline Android-safe brand font, and paper texture", p2Style);

  const funnelBoundary = await page.evaluate(() => {
    const originalFunnel = JSON.parse(JSON.stringify(funnel)), originalOpens = opens.slice(), originalRound = { roundId, activeMode, baseTargets: baseTargets.slice(), attemptSeq };
    funnel = newFunnel(); saveFunnel(); renderHome(); renderHome();
    opens = [shiftDay(today(), -1), today()]; maybeRecordD2Return(); maybeRecordD2Return();
    recordFunnelComparison("verify-disagree", false, Date.now()); recordFunnelComparison("verify-disagree", false, Date.now()); recordFunnelComparison("verify-agree", true, Date.now());
    roundId = "verify-funnel-round"; activeMode = "new"; baseTargets = [0, 1]; attemptSeq = 3; recordFunnelRound(90000); recordFunnelRound(180000);
    dataLink.click(); const devCopy = dataBox.textContent; dataLink.click();
    const exportedAt = Date.now(), projected = JSON.parse(backupPayload({ preserveMeta: true, exportedAt, funnelExportAt: exportedAt })), projectedFunnel = JSON.parse(projected.data[FUNNEL_KEY]);
    const restored = normalizeFunnel(projectedFunnel), noDuplicateAfterRestore = !appendFunnelEvent(restored, "backup_exported", "backup_exported", exportedAt);
    const result = { events: Object.fromEntries(["welcome_shown", "d2_return", "reveal_disagree"].map((name) => [name, funnel.events.filter((row) => row.name === name).length])), counts: { ...funnel.counts }, rounds: funnel.rounds.slice(), devCopy, projectedBackup: projectedFunnel.events.filter((row) => row.name === "backup_exported").length, localBackup: funnel.events.filter((row) => row.name === "backup_exported").length, noDuplicateAfterRestore, hasFunnelKey: BACKUP_KEYS.includes(FUNNEL_KEY) };
    funnel = normalizeFunnel(originalFunnel); saveFunnel(); opens = originalOpens; save(OPEN_KEY, opens); roundId = originalRound.roundId; activeMode = originalRound.activeMode; baseTargets = originalRound.baseTargets; attemptSeq = originalRound.attemptSeq;
    return result;
  });
  assert(funnelBoundary.events.welcome_shown === 1 && funnelBoundary.events.d2_return === 1 && funnelBoundary.events.reveal_disagree === 1
    && funnelBoundary.counts.revealCompared === 2 && funnelBoundary.counts.revealDisagree === 1 && funnelBoundary.rounds.length === 1 && funnelBoundary.rounds[0].durationMs === 90000
    && funnelBoundary.devCopy.includes("本地漏斗") && funnelBoundary.devCopy.includes("平均 90 秒") && funnelBoundary.projectedBackup === 1 && funnelBoundary.localBackup === 0 && funnelBoundary.noDuplicateAfterRestore && funnelBoundary.hasFunnelKey,
  "Expected idempotent local funnel, projected successful-export event, and backup allowlist", funnelBoundary);

  const undoFunnel = await page.evaluate(() => {
    const original = JSON.parse(JSON.stringify(funnel));
    funnel = newFunnel(); saveFunnel();
    const preStamp = JSON.parse(JSON.stringify(funnel));           // 盖章前的 funnel，正是 takeStampSnapshot 通过 funnelValue:cloneObj(funnel) 捕获的
    recordFunnelComparison("verify-undo", false, Date.now());       // 误盖“没写出”，与系统“判定 ok”分歧
    const afterDisagree = { ...funnel.counts };
    funnel = JSON.parse(JSON.stringify(preStamp)); saveFunnel();    // 撤销：restoreStampSnapshot 用 funnelValue 回滚 funnel
    const afterUndo = { ...funnel.counts, seenHasKey: funnel.seen.includes("reveal:verify-undo") };
    recordFunnelComparison("verify-undo", true, Date.now());        // 改盖“秒过”，与系统一致——修正后不应仍算分歧
    const afterAgree = { ...funnel.counts };
    funnel = normalizeFunnel(original); saveFunnel();
    return { afterDisagree, afterUndo, afterAgree };
  });
  assert(undoFunnel.afterDisagree.revealCompared === 1 && undoFunnel.afterDisagree.revealDisagree === 1
    && undoFunnel.afterUndo.revealCompared === 0 && undoFunnel.afterUndo.revealDisagree === 0 && !undoFunnel.afterUndo.seenHasKey
    && undoFunnel.afterAgree.revealCompared === 1 && undoFunnel.afterAgree.revealDisagree === 0,
  "Expected undo to roll back the funnel comparison so a corrected re-stamp is not counted as a system disagreement", undoFunnel);

  const exportCommit = await page.evaluate(async () => {
    const originalFunnel = JSON.parse(JSON.stringify(funnel)), originalMeta = JSON.parse(JSON.stringify(backupMeta));
    const hadCanShare = Object.prototype.hasOwnProperty.call(navigator, "canShare"), hadShare = Object.prototype.hasOwnProperty.call(navigator, "share");
    const localExports = () => funnel.events.filter((row) => row.name === "backup_exported").length;
    try {
      funnel = newFunnel(); saveFunnel();
      const before = localExports();
      navigator.canShare = () => true; navigator.share = () => Promise.resolve();  // 系统分享成功
      await exportBackup();
      const afterSuccess = localExports();                                          // 成功后本机落账一次
      await exportBackup();
      const afterRepeat = localExports();                                           // 再次导出幂等，不重复落账
      funnel = newFunnel(); saveFunnel();
      navigator.share = () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));  // 用户取消分享
      await exportBackup();
      const afterCancel = localExports();                                           // 取消不落账
      return { before, afterSuccess, afterRepeat, afterCancel };
    } finally {
      if (!hadCanShare) delete navigator.canShare;
      if (!hadShare) delete navigator.share;
      funnel = normalizeFunnel(originalFunnel); saveFunnel(); backupMeta = originalMeta; save(BACKUP_META_KEY, backupMeta);
    }
  });
  assert(exportCommit.before === 0 && exportCommit.afterSuccess === 1 && exportCommit.afterRepeat === 1 && exportCommit.afterCancel === 0,
  "Expected a successful share to commit backup_exported locally once (idempotent) and a cancelled share to not commit", exportCommit);

  const restoreChooser = page.waitForEvent("filechooser");
  await page.click("#welcomeRestore");
  assert(!!(await restoreChooser), "Expected the first-run restore entry to open the backup picker");
  await page.evaluate(() => {
    const payload = JSON.parse(backupPayload()), idx = CARDS.findIndex((card) => card.target === "器"), key = cardKey(idx);
    payload.data[MEMORY_KEY] = JSON.stringify({ [key]: { seen: 1, last: Date.now(), target: "器", fast: 1 } });
    payload.data[TUNING_KEY] = JSON.stringify({ calibrated: true, offset: 0, contextStrict: 0, rounds: [] });
    restoreBackupPayload(payload, { skipConfirm: true, reload: false });
  });
  await page.reload({ waitUntil: "networkidle" });
  const firstRunRestore = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", welcome: getComputedStyle(welcome).display !== "none", count: memoryCount() }));
  assert(firstRunRestore.home && !firstRunRestore.welcome && firstRunRestore.count === 1, "Expected a valid first-run backup to enter the returning-user home", firstRunRestore);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const inheritedDays = await page.evaluate(() => {
    opens = [shiftDay(today(), -3), shiftDay(today(), -2), shiftDay(today(), -1), today()]; save(OPEN_KEY, opens);
    activity = newActivity();
    const inherited = activity.inheritedTotalDays;
    const before = totalPracticeDays();
    const idx = CARDS.findIndex((card) => card.target === "器");
    markPracticeStamp(idx);
    const stampedOnly = totalPracticeDays();
    const complete = (id) => {
      baseTargets = [idx]; batch = baseTargets; baseCursor = 1; unresolved = new Set(); practicePhase = "between";
      roundStats = [{ idx, target: "器", outcome: "fast" }]; roundId = id;
      return markRoundComplete();
    };
    const firstComplete = complete("verify-inherited-1");
    const afterFirst = totalPracticeDays();
    const secondComplete = complete("verify-inherited-2");
    const afterSecond = totalPracticeDays();
    return { inherited, before, stampedOnly, firstComplete, afterFirst, secondComplete, afterSecond };
  });
  assert(inheritedDays.inherited === 3 && inheritedDays.before === 3 && inheritedDays.stampedOnly === 3 && inheritedDays.firstComplete && inheritedDays.secondComplete && inheritedDays.afterFirst === 4 && inheritedDays.afterSecond === 4, "Expected inherited practice days and same-day completion idempotence", inheritedDays);

  const rhythmAndMilestones = await page.evaluate(() => {
    const monthStart = `${today().slice(0, 7)}-01`, thisMonth = [...new Set([monthStart, today()])], previousMonth = shiftDay(monthStart, -1);
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = [...thisMonth, previousMonth].sort();
    activity.practiceDays.forEach((key, i) => { activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`rhythm:${i}`], completedRoundIds: [], lastStampAt: Date.now() }; }); saveActivity(); renderMonthSignal();
    const monthly = { count: monthPracticeDays(), expected: thisMonth.length, copy: monthSignal.textContent };
    activity = newActivity(); activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
    reminder.milestonesShown = []; activity.inheritedTotalDays = 14; const day14 = celebrateMilestoneIfAny(), repeat14 = celebrateMilestoneIfAny(), shown14 = reminder.milestonesShown.slice();
    reminder.milestonesShown = []; activity.inheritedTotalDays = 250; const skipped250 = celebrateMilestoneIfAny(), shown250 = reminder.milestonesShown.slice();
    reminder.milestonesShown = [1, 7, 14, 30, 100, 200]; activity.inheritedTotalDays = 300; const day300 = celebrateMilestoneIfAny(), repeat300 = celebrateMilestoneIfAny(), copy300 = milestoneCopy(300);
    return { monthly, schedule: milestoneDaysThrough(350), day14, repeat14, shown14, skipped250, shown250, day300, repeat300, copy300 };
  });
  assert(rhythmAndMilestones.monthly.count === rhythmAndMilestones.monthly.expected && rhythmAndMilestones.monthly.copy === `本月拾了 ${rhythmAndMilestones.monthly.expected} 天`
    && rhythmAndMilestones.schedule.join() === "1,7,14,30,100,200,300" && rhythmAndMilestones.day14 === 14 && rhythmAndMilestones.repeat14 === null && rhythmAndMilestones.shown14.join() === "1,7,14"
    && rhythmAndMilestones.skipped250 === null && rhythmAndMilestones.shown250.join() === "1,7,14,30,100,200" && rhythmAndMilestones.day300 === 300 && rhythmAndMilestones.repeat300 === null && rhythmAndMilestones.copy300.includes("300"),
  "Expected penalty-free monthly rhythm, one-time day-14 celebration, silent inherited catch-up, and every-100 continuation", rhythmAndMilestones);

  const reminderBoundary = await page.evaluate(() => {
    const original = { memory: cloneObj(memory), status: cloneObj(status), reminder: cloneObj(reminder) };
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = [];
    const at = (hour, minute) => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date.getTime(); };
    for (let i = 0; i < 5; i += 1) {
      const key = shiftDay(today(), -i); activity.practiceDays.push(key);
      activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`verify:${i}`], completedRoundIds: [], lastStampAt: at(9, 24) };
    }
    activity.practiceDays.sort(); saveActivity();
    const median = medianPracticeTime();
    const allDays = activity.practiceDays.slice(); activity.practiceDays = allDays.slice(0, 2); const few = medianPracticeTime(); activity.practiceDays = allDays;
    activity.practiceDays.forEach((key) => { activity.daily[key].lastStampAt = at(23, 30); }); const late = medianPracticeTime();
    const missIdx = CARDS.findIndex((card) => card.target === "蘸"), otherIdx = CARDS.findIndex((card) => card.target === "器");
    memory = {}; status = {}; [missIdx, otherIdx].forEach((idx, order) => { memory[cardKey(idx)] = { seen: 1, dueDay: today(), pendingLearning: false, lastOutcome: order === 0 ? "miss" : "fast", misses: order === 0 ? 2 : 0, ease: order === 0 ? 25 : 70, last: Date.now() - order }; status[idx] = "rest"; });
    reminder = normalizeReminder({ enabled: true, permission: "granted" }); renderMe(); syncReminder(); const sync = cloneObj(reminderDebug.lastSync);
    memory = {}; status = {}; syncReminder(); const noTarget = cloneObj(reminderDebug.lastSync);
    memory = original.memory; status = original.status; reminder = normalizeReminder(original.reminder); saveMemory(); save(DECK_KEY, status); saveReminder();
    return {
      median, few, late,
      hiddenInBrowser: getComputedStyle(reminderSection).display === "none" && getComputedStyle(reminderInvite).display === "none",
      sync, noTarget, missKey: cardKey(missIdx), missWord: CARDS[missIdx].word, missPy: CARDS[missIdx].py,
    };
  });
  assert(reminderBoundary.median.hour === 9 && reminderBoundary.median.minute === 24 && reminderBoundary.few.hour === 20 && reminderBoundary.few.minute === 0 && reminderBoundary.late.hour === 22 && reminderBoundary.late.minute === 0 && reminderBoundary.hiddenInBrowser && reminderBoundary.sync.type === "syncReminder", "Expected reminder median, fallback, clamp, and browser fallback boundaries", reminderBoundary);
  assert(reminderBoundary.sync.enabled && reminderBoundary.sync.questions.length === 8 && reminderBoundary.sync.targetCardKey === reminderBoundary.missKey && reminderBoundary.sync.questions[0].targetCardKey === reminderBoundary.missKey
    && reminderBoundary.sync.title === `${reminderBoundary.missWord}的 ${reminderBoundary.missPy}` && reminderBoundary.sync.body === "还写得出吗，点开写写看"
    && reminderBoundary.sync.questions.every((question) => question.title && question.body && question.targetCardKey && /^\d{4}-\d{2}-\d{2}$/.test(question.day)) && !reminderBoundary.noTarget.enabled && reminderBoundary.noTarget.questions.length === 0,
  "Expected missed-due-first question payloads, stable card keys, fixed copy, and no notification without a target", reminderBoundary);

  const backupReminderBoundary = await page.evaluate(() => {
    const completed = (count) => {
      activity = newActivity(); activity.inheritedTotalDays = 0; activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
      for (let i = 0; i < count; i += 1) { const key = shiftDay(today(), -i); activity.practiceDays.push(key); activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`backup:${i}`], completedRoundIds: [`round:${i}`], lastStampAt: Date.now() - i * 86400000 }; }
      activity.practiceDays.sort(); saveActivity();
    };
    memory = {}; saveMemory(); backupMeta = normalizeBackupMeta({ lastExportAt: Date.now() - 8 * 86400000 }); save(BACKUP_META_KEY, backupMeta);
    completed(5); renderBackupUI(); const fiveDays = getComputedStyle(backupReminder).display === "flex";
    completed(0); memory = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`verify:${i}`, { seen: 1, last: Date.now() }])); saveMemory(); renderBackupUI(); const thirtyChars = getComputedStyle(backupReminder).display === "flex";
    backupMeta.lastExportAt = Date.now() - 6 * 86400000; save(BACKUP_META_KEY, backupMeta); renderBackupUI(); const recentHidden = getComputedStyle(backupReminder).display === "none";
    memory = {}; saveMemory(); completed(3); backupMeta = normalizeBackupMeta(null); summaryBackupHintVisible = false; save(BACKUP_META_KEY, backupMeta); renderSummaryBackupHint();
    const dayThree = getComputedStyle(summaryBackupHint).display === "flex" && backupMeta.summaryPromptShown; renderSummaryBackupHint(); const remainsVisible = getComputedStyle(summaryBackupHint).display === "flex";
    displayView("home"); displayView("summary"); renderSummaryBackupHint(); const nextSummaryHidden = getComputedStyle(summaryBackupHint).display === "none";
    return { fiveDays, thirtyChars, recentHidden, dayThree, remainsVisible, nextSummaryHidden };
  });
  assert(backupReminderBoundary.fiveDays && backupReminderBoundary.thirtyChars && backupReminderBoundary.recentHidden && backupReminderBoundary.dayThree && backupReminderBoundary.remainsVisible && backupReminderBoundary.nextSummaryHidden, "Expected weekly backup reminder thresholds and one-time third-day summary hint", backupReminderBoundary);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const baseline = await page.evaluate(() => ({
    seed: SEED.length,
    groups: Object.keys(GROUPS).length,
    cards: CARDS.length,
    fsrsVersion: FSRS.FSRSVersion,
    weights: FSRS.default_w.length,
    scheduler: FSRS_CONFIG,
    engineFuzz: fsrsEngine.parameters.enable_fuzz,
    decisionLabels: Array.from(document.querySelectorAll("#decisionRow button span")).map((node) => node.textContent),
    oldStampChoices: document.querySelectorAll("#stampRow .stampWrap").length,
    showLabel: document.getElementById("show").textContent,
    viewport: document.querySelector('meta[name="viewport"]').content,
  }));
  assert(baseline.seed === 6854 && baseline.groups === 6854 && baseline.cards >= 6854, "Expected the complete 6854-card corpus", baseline);
  assert(baseline.fsrsVersion.includes("FSRS-6.0") && baseline.weights === 21, "Expected fixed FSRS-6 runtime", baseline);
  assert(baseline.scheduler.desiredRetention === 0.9 && baseline.scheduler.maximumInterval === 365 && baseline.scheduler.enableFuzz && baseline.engineFuzz && baseline.scheduler.parameterVersion === "fsrs6-fuzz-365-v2", "Expected fuzzed scheduler with a one-year interval ceiling", baseline.scheduler);
  assert(baseline.decisionLabels.join("/") === "写对了/写错了" && baseline.oldStampChoices === 0 && baseline.showLabel === "不会写", "Expected concise two-decision result semantics", baseline);
  assert(baseline.viewport.includes("viewport-fit=cover") && !/user-scalable=no|maximum-scale=1/.test(baseline.viewport), "Expected scalable safe-area viewport", baseline.viewport);

  await page.emulateMedia({ colorScheme: "dark" });
  const darkTheme = await page.evaluate(() => {
    const bubble = getComputedStyle(teachBubble), after = getComputedStyle(teachBubble, "::after"), root = getComputedStyle(document.documentElement);
    return {
      bubble: bubble.backgroundColor, arrow: after.backgroundColor, card: root.getPropertyValue("--card").trim(), ink: root.getPropertyValue("--ink").trim(),
      strong: getComputedStyle(teachBubble.querySelector("b")).color, meTitle: getComputedStyle(document.querySelector(".meCardTop b")).color,
      boxShadow: getComputedStyle(document.querySelector(".box") || document.body).boxShadow,
    };
  });
  assert(darkTheme.bubble === darkTheme.arrow && darkTheme.bubble !== darkTheme.card && darkTheme.meTitle === "rgb(242, 234, 217)", "Expected a shaped inverse teaching bubble and readable analysis title in dark mode", darkTheme);
  await page.emulateMedia({ colorScheme: "light" });

  await page.addScriptTag({ path: path.join(root, "core-strokes.js") });
  const coreStrokes = await page.evaluate(() => ({ chars: self.SHIZI_CORE_STROKES.slice(), calibration: self.SHIZI_CORE_STROKES.slice(0, 15).join("") }));
  const missingCoreFiles = coreStrokes.chars.filter((char) => !fs.existsSync(path.join(root, "data", `${char}.json`)));
  const coreBytes = coreStrokes.chars.reduce((sum, char) => sum + fs.statSync(path.join(root, "data", `${char}.json`)).size, 0);
  assert(coreStrokes.chars.length === 600 && new Set(coreStrokes.chars).size === 600 && coreStrokes.calibration === "尴嚏狩晤飓痿俾跻徵瞰裘娩邃暧煲" && missingCoreFiles.length === 0 && coreBytes >= 1024 * 1024 && coreBytes <= 2 * 1024 * 1024,
  "Expected 600 unique core files including the exact first calibration group within the 1-2 MiB target", { count: coreStrokes.chars.length, calibration: coreStrokes.calibration, missingCoreFiles, coreBytes });
  await page.waitForFunction(async () => { const cache = await caches.open("shizi-v9"), keys = await cache.keys(); return keys.filter((request) => new URL(request.url).pathname.includes("/data/")).length >= 600; }, null, { timeout: 30000 });
  const coreCache = await page.evaluate(async () => { const cache = await caches.open("shizi-v9"), keys = await cache.keys(); return { core: keys.filter((request) => new URL(request.url).pathname.includes("/data/")).length, shell: !!(await cache.match("core-strokes.js")) }; });
  assert(coreCache.core === 600 && coreCache.shell, "Expected the service worker to install all available core strokes and its generated list", coreCache);

  const dailyRitual = await page.evaluate(() => {
    const original = { tuning: cloneObj(tuning), activity: cloneObj(activity), activeMode, focusQueue: focusQueue.slice(), sessionDone: [...sessionDone] };
    const key = today(), tomorrow = shiftDay(key, 1), idx = dailyCharacterIndex(key), nextIdx = dailyCharacterIndex(tomorrow), motto = dailyMotto(key), nextMotto = dailyMotto(tomorrow), candidate = CARDS[idx];
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    activity = { version: 1, migrationDate: key, inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [], daily: {} };
    clearSessionSnapshot(); saveTuning(); saveActivity(); renderHome();
    const button = yesterRow.querySelector("[data-daily-index]"), beforeClick = {
      label: yesterLbl.textContent, index: Number(button && button.dataset.dailyIndex), target: button && button.querySelector(".glyph").textContent,
      word: button && button.querySelector(".word").textContent, py: button && button.querySelector(".py").textContent,
      homeMotto: homeMotto.textContent, welcomeMotto: welcomeMotto.textContent,
    };
    const overflow = DAILY_MOTTOS.map((text) => { setDailyMotto(homeMotto, text); return { text, scroll: homeMotto.scrollHeight, client: homeMotto.clientHeight }; });
    applyDailyMotto(key); button.click();
    const clicked = { mode: activeMode, current: currentCardIndex(), cardVisible: getComputedStyle(card).display !== "none" };
    loadToken++; clearSessionSnapshot(); focusQueue = []; sessionDone = new Set();
    activity = { version: 1, migrationDate: key, inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [key], daily: { [key]: { stamps: 1, attempts: 1, targetKeys: [cardKey(idx)], completedRoundIds: [], lastStampAt: Date.now() } } };
    saveActivity(); renderHome(); const retired = !yesterRow.querySelector("[data-daily-index]");
    tuning = original.tuning; activity = normalizeActivity(original.activity); activeMode = original.activeMode; focusQueue = original.focusQueue; sessionDone = new Set(original.sessionDone); saveTuning(); saveActivity(); clearSessionSnapshot(); renderHome();
    return { key, tomorrow, idx, nextIdx, motto, nextMotto, repeatIdx: dailyCharacterIndex(key), repeatMotto: dailyMotto(key), candidate, beforeClick, overflow, clicked, retired, poolSize: dailyCharacterCandidates().length };
  });
  assert(dailyRitual.poolSize > 0 && dailyRitual.idx === dailyRitual.repeatIdx && dailyRitual.motto === dailyRitual.repeatMotto && dailyRitual.idx !== dailyRitual.nextIdx && dailyRitual.motto !== dailyRitual.nextMotto,
    "Expected deterministic same-day and changing next-day character/motto selections", dailyRitual);
  assert(["一级", "二级"].includes(dailyRitual.candidate.norm) && dailyRitual.candidate.common >= 1.5 && dailyRitual.candidate.d >= 55 && dailyRitual.candidate.d <= 85
    && dailyRitual.beforeClick.label === "今日一字" && dailyRitual.beforeClick.index === dailyRitual.idx && dailyRitual.beforeClick.target === dailyRitual.candidate.target
    && dailyRitual.beforeClick.word === dailyRitual.candidate.word && dailyRitual.beforeClick.py === dailyRitual.candidate.py && dailyRitual.beforeClick.homeMotto === dailyRitual.motto && dailyRitual.beforeClick.welcomeMotto === dailyRitual.motto,
  "Expected the daily card to expose one eligible character, context word, pinyin, and synchronized motto", dailyRitual);
  assert(dailyRitual.overflow.every((row) => row.scroll <= row.client + 1) && dailyRitual.clicked.mode === "focus" && dailyRitual.clicked.current === dailyRitual.idx && dailyRitual.clicked.cardVisible && dailyRitual.retired,
    "Expected every motto to fit, daily-character click to start focus practice, and the card to retire after today's first stamp", dailyRitual);
  const notificationDeepLink = await page.evaluate(() => {
    const original = { memory: cloneObj(memory), status: cloneObj(status), tuning: cloneObj(tuning), activeMode, focusQueue: focusQueue.slice(), sessionDone: [...sessionDone] };
    const idx = CARDS.findIndex((card) => card.target === "蘸"), key = cardKey(idx);
    memory = { [key]: { seen: 1, dueDay: today(), pendingLearning: false, lastOutcome: "miss", misses: 1, ease: 30, last: Date.now() } }; status = { [idx]: "rest" }; tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    clearSessionSnapshot(); saveMemory(); save(DECK_KEY, status); saveTuning(); const opened = shiziOpenReminderTarget(key);
    const result = { opened, mode: activeMode, current: currentCardIndex(), target: CARDS[currentCardIndex()].target, cardVisible: getComputedStyle(card).display !== "none", invalidRejected: shiziOpenReminderTarget("base:不存在") === false };
    loadToken++; clearSessionSnapshot(); memory = original.memory; status = original.status; tuning = original.tuning; activeMode = original.activeMode; focusQueue = original.focusQueue; sessionDone = new Set(original.sessionDone); saveMemory(); save(DECK_KEY, status); saveTuning();
    return result;
  });
  assert(notificationDeepLink.opened && notificationDeepLink.mode === "focus" && notificationDeepLink.target === "蘸" && notificationDeepLink.cardVisible && notificationDeepLink.invalidRejected,
    "Expected a valid notification card key to open that exact focus card and reject stale keys", notificationDeepLink);

  await page.reload({ waitUntil: "networkidle" });
  offlineProbe = true;
  await page.context().setOffline(true);
  await page.evaluate(() => { tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); const idx = CARDS.findIndex((card) => card.target === "玃"); startFocus([idx]); });
  await page.waitForFunction(() => !done.disabled && hint.textContent.includes("需要联网下载一次"));
  const honestOffline = await page.evaluate(() => ({ copy: hint.textContent, done: !done.disabled, show: !show.disabled, noWriter: !practiceCharData, offline: navigator.onLine === false }));
  assert(honestOffline.copy.includes("这个字的笔顺需要联网下载一次") && honestOffline.done && honestOffline.show && honestOffline.noWriter && honestOffline.offline,
  "Expected an uncached offline card to explain the one-time download and keep self-assessment usable", honestOffline);
  await page.context().setOffline(false);
  await page.waitForFunction(() => Array.isArray(curMedians) && curMedians.length > 0 && !strokeDataOffline);
  offlineProbe = false;
  const onlineRecovery = await page.evaluate(() => ({ target: cur.target, medians: curMedians.length, copy: hint.textContent }));
  assert(onlineRecovery.target === "玃" && onlineRecovery.medians > 0 && !onlineRecovery.copy.includes("需要联网下载一次"), "Expected reconnection to restore the current untouched card automatically", onlineRecovery);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

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

  const reviewBudget = await page.evaluate(() => {
    const saved = { memory: cloneObj(memory), status: cloneObj(status), quality: cloneObj(quality), activity: cloneObj(activity), tuning: cloneObj(tuning), sessionDone: [...sessionDone], activeMode, baseTargets: baseTargets.slice(), batch: batch.slice() };
    const originalRender = render, originalRenderHome = renderHome, originalToast = toast, originalWarm = warmStrokeCache, originalArm = armPracticeHistory;
    const dueIndexes = allIndexes().slice(0, 200); memory = {}; status = {}; quality = {}; activity = newActivity(); activity.inheritedTotalDays = 0; activity.daily = {}; sessionDone = new Set(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    dueIndexes.forEach((idx, order) => { memory[cardKey(idx)] = { seen: 1, dueDay: shiftDay(today(), -1), pendingLearning: false, lastOutcome: order % 4 === 0 ? "miss" : "fast", misses: order % 4 === 0 ? 1 : 0, ease: 50, streak: 1, last: Date.now() - order }; status[idx] = "rest"; });
    saveMemory(); save(DECK_KEY, status); saveActivity();
    const expectedTop = reviewPool(false).slice().sort(compareReviewPriority).slice(0, DAILY_REVIEW_BUDGET);
    render = () => {}; renderHome = () => {}; toast = () => {}; warmStrokeCache = () => {}; armPracticeHistory = () => {};
    activeMode = "review"; startRound(); const first = baseTargets.slice(), usedAfterFirst = reviewBudgetUsed(); first.forEach((idx) => { memory[cardKey(idx)].dueDay = shiftDay(today(), 1); }); sessionDone = new Set(); clearSessionSnapshot();
    startRound(); const second = baseTargets.slice(), usedAfterSecond = reviewBudgetUsed(); second.forEach((idx) => { memory[cardKey(idx)].dueDay = shiftDay(today(), 1); }); sessionDone = new Set(); clearSessionSnapshot();
    let exhaustedRedirect = false; renderHome = () => { exhaustedRedirect = true; }; startRound();
    render = originalRender; renderHome = originalRenderHome; toast = originalToast; warmStrokeCache = originalWarm; armPracticeHistory = originalArm;
    const selected = [...first, ...second], topPriority = selected.join() === expectedTop.join(), noDuplicates = new Set(selected).size === DAILY_REVIEW_BUDGET;
    renderHome(); const homeCopy = `${homeTitle.textContent} ${startCap.textContent} ${boxStat.textContent}`; const homeNoDebt = !startCap.textContent.includes("200 个到期") && !startCap.textContent.includes("还剩 170");
    const originalStartMode = startMode; let entry = ""; startMode = (mode) => { entry = mode; }; startBtn.onclick(); startMode = originalStartMode;
    const persisted = cloneObj(dailyActivity().reviewTargetKeys);
    memory = saved.memory; status = saved.status; quality = saved.quality; activity = normalizeActivity(saved.activity); tuning = saved.tuning; sessionDone = new Set(saved.sessionDone); activeMode = saved.activeMode; baseTargets = saved.baseTargets; batch = saved.batch;
    saveMemory(); save(DECK_KEY, status); saveQuality(); saveActivity(); saveTuning(); clearSessionSnapshot();
    return { first: first.length, second: second.length, usedAfterFirst, usedAfterSecond, selected: selected.length, topPriority, noDuplicates, exhaustedRedirect, remaining: reviewBudgetRemaining(), homeCopy, homeNoDebt, entry, persisted: persisted.length };
  });
  assert(reviewBudget.first === 15 && reviewBudget.second === 15 && reviewBudget.usedAfterFirst === 15 && reviewBudget.usedAfterSecond === 30 && reviewBudget.selected === 30
    && reviewBudget.topPriority && reviewBudget.noDuplicates && reviewBudget.exhaustedRedirect && reviewBudget.homeNoDebt && reviewBudget.entry === "new" && reviewBudget.persisted === 30,
  "Expected a persistent top-30 daily review budget and a new-card exit after exhaustion", reviewBudget);

  const queueEdges = await page.evaluate(() => {
    const saved = {
      activeMode, baseTargets: baseTargets.slice(), batch: batch.slice(), baseCursor, currentIndex,
      manualQueue: cloneObj(manualQueue), reinforcementQueue: cloneObj(reinforcementQueue), unresolved: [...unresolved], episodes: cloneObj(episodes),
      attemptSeq, practicePhase, memory: cloneObj(memory), quality: cloneObj(quality), activity: cloneObj(activity), sessionDone: [...sessionDone],
    };
    const indexes = ["器", "疑", "强", "赢", "衡", "辩", "警", "藏", "骤", "疆", "戴", "覆", "醒", "耀", "攀"].map((target) => CARDS.findIndex((card) => card.target === target));
    const resetQueue = (total, cursor) => {
      baseTargets = indexes.slice(0, total); batch = baseTargets; baseCursor = cursor; attemptSeq = cursor;
      currentIndex = baseTargets[Math.min(cursor, total - 1)]; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; practicePhase = "between";
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
    manualQueue = saved.manualQueue; reinforcementQueue = saved.reinforcementQueue; unresolved = new Set(saved.unresolved); episodes = saved.episodes; attemptSeq = saved.attemptSeq; practicePhase = saved.practicePhase;
    memory = saved.memory; quality = saved.quality; activity = normalizeActivity(saved.activity); sessionDone = new Set(saved.sessionDone); saveMemory(); saveQuality(); saveActivity();

    return { firstNext, firstSecond, firstReturn, fourteenthNext, fourteenthReturn, fifteenthReturn, onlyFirst, onlySecond, exclusion, modeCompletion, repeatedCount, indexes };
  });
  assert(queueEdges.firstNext.idx === queueEdges.indexes[1] && queueEdges.firstSecond.idx === queueEdges.indexes[2] && queueEdges.firstReturn.idx === queueEdges.indexes[0], "Expected first-position difficulty to wait behind two other attempts", queueEdges);
  assert(queueEdges.fourteenthNext.idx === queueEdges.indexes[14] && queueEdges.fourteenthReturn.idx === queueEdges.indexes[13] && queueEdges.fifteenthReturn.idx === queueEdges.indexes[14], "Expected positions 14 and 15 to fall back without deadlock", queueEdges);
  assert(queueEdges.onlyFirst.idx === queueEdges.indexes[0] && queueEdges.onlySecond.idx === queueEdges.indexes[0], "Expected one repeatedly difficult target to keep rotating", queueEdges);
  assert(queueEdges.exclusion.unresolved === 0 && queueEdges.exclusion.queued === 0 && queueEdges.exclusion.excluded && !queueEdges.exclusion.pending, "Expected explicit content exclusion to release the group without claiming mastery", queueEdges.exclusion);
  assert(queueEdges.modeCompletion.every((row) => row.complete && row.blocked) && queueEdges.repeatedCount.stamps === 1 && queueEdges.repeatedCount.attempts === 10 && queueEdges.repeatedCount.targets === 1, "Expected all modes to share completion rules and repeated attempts to count one target", queueEdges);

  const rhythmGuard = await page.evaluate(() => {
    const indexes = ["器", "疑", "强"].map((target) => CARDS.findIndex((card) => card.target === target));
    const originalRender = render, originalRenderHome = renderHome, originalToast = toast;
    render = () => {}; renderHome = () => {}; toast = () => {};
    const setup = ({ attempts = 20, elapsed = 0, includeManual = false } = {}) => {
      activeMode = "focus"; focusQueue = indexes.slice(); baseTargets = indexes.slice(); batch = baseTargets; baseCursor = indexes.length;
      currentIndex = indexes[2]; currentAttemptKind = "base"; currentAttemptId = "verify-rhythm"; practicePhase = "between";
      manualQueue = includeManual ? [{ idx: indexes[2], kind: "repeat" }] : [];
      reinforcementQueue = [{ idx: indexes[1], eligibleAfter: 0, order: 1 }, { idx: indexes[0], eligibleAfter: 0, order: 2 }];
      unresolved = new Set(indexes.slice(0, 2)); episodes = {}; attemptSeq = attempts; roundId = `verify-rhythm-${attempts}-${elapsed}`;
      roundStats = indexes.map((idx) => ({ idx, target: CARDS[idx].target, outcome: idx === indexes[2] ? "fast" : "slow" }));
      sessionDone = new Set(indexes); roundElapsedMs = elapsed; roundActiveStartedAt = Date.now(); roundBudgetPrompted = false;
      activity = newActivity(); activity.inheritedTotalDays = 0; activity.inheritedStreak = 0; activity.daily = {}; activity.practiceDays = [];
      indexes.slice(0, 2).forEach((idx) => { const m = cardMemory(idx); m.pendingLearning = true; m.dueDay = null; m.due = 0; setStatus(idx, "indeck"); });
      closeRoundBudgetSheet(); clearSessionSnapshot();
    };

    setup(); next();
    const attemptPrompt = roundBudgetSheet.classList.contains("open");
    continueAfterBudget();
    const continued = { prompted: roundBudgetPrompted, closed: !roundBudgetSheet.classList.contains("open"), current: currentIndex };
    practicePhase = "between"; attemptSeq = 21; next();
    const noSecondPrompt = !roundBudgetSheet.classList.contains("open");

    setup({ attempts: 3, elapsed: ROUND_TIME_BUDGET_MS }); next();
    const timePrompt = roundBudgetSheet.classList.contains("open"); closeRoundBudgetSheet();

    setup({ attempts: 21, includeManual: true }); next(); deferRoundToTomorrow();
    const queued = indexes.slice().sort((a, b) => cardMemory(a).queuedFrontAt - cardMemory(b).queuedFrontAt);
    const deferred = { queued, expected: [indexes[2], indexes[1], indexes[0]], completed: todayCompleted(), session: localStorage.getItem(SESSION_KEY) };
    sessionDone = new Set(); startRound();
    const nextRound = baseTargets.slice(0, 3);

    setup({ attempts: 21 }); baseCursor = 1; roundStats = roundStats.slice(0, 1); manualQueue = [];
    unresolved = new Set([indexes[0]]); reinforcementQueue = [{ idx: indexes[0], eligibleAfter: 0, order: 1 }];
    next(); deferRoundToTomorrow();
    const incomplete = { queued: indexes.slice().sort((a, b) => cardMemory(a).queuedFrontAt - cardMemory(b).queuedFrontAt), completed: todayCompleted() };

    setup({ attempts: 21 }); activeMode = "calibrate"; next();
    const calibrationUninterrupted = !roundBudgetSheet.classList.contains("open");

    render = originalRender; renderHome = originalRenderHome; toast = originalToast; closeRoundBudgetSheet();
    return { indexes, attemptPrompt, continued, noSecondPrompt, timePrompt, deferred, nextRound, incomplete, calibrationUninterrupted };
  });
  assert(rhythmGuard.attemptPrompt && rhythmGuard.timePrompt, "Expected attempt and active-time budgets to prompt only between cards", rhythmGuard);
  assert(rhythmGuard.continued.prompted && rhythmGuard.continued.closed && rhythmGuard.continued.current === rhythmGuard.indexes[1] && rhythmGuard.noSecondPrompt, "Expected continue to consume the next queued card without prompting again", rhythmGuard);
  assert(rhythmGuard.deferred.queued.join() === rhythmGuard.deferred.expected.join() && rhythmGuard.deferred.completed && rhythmGuard.deferred.session === null && rhythmGuard.nextRound.join() === rhythmGuard.deferred.expected.join(), "Expected early stop to preserve pending order, valid completion, and next-round priority", rhythmGuard);
  assert(rhythmGuard.incomplete.queued.join() === rhythmGuard.indexes.join() && !rhythmGuard.incomplete.completed && rhythmGuard.calibrationUninterrupted, "Expected incomplete base cards to carry forward without false completion while calibration stays uninterrupted", rhythmGuard);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.evaluate(() => {
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    renderHome();
  });

  await page.click("#homeAdd");
  const homeCapture = await page.evaluate(() => ({ open: addSheet.classList.contains("open"), label: homeAdd.textContent.replace(/\s+/g, ""), mainVisible: getComputedStyle(startBtn).display !== "none" }));
  assert(homeCapture.open && homeCapture.label === "＋刚才忘了个字" && homeCapture.mainVisible, "Expected a secondary home capture entry to open the existing add sheet", homeCapture);
  await page.click("#addCancel");

  await page.click("#tabMe");
  const me = await page.evaluate(() => ({ visible: getComputedStyle(mePanel).display !== "none", devHidden: getComputedStyle(devTools).display === "none", reminderHidden: getComputedStyle(reminderSection).display === "none" }));
  assert(me.visible && me.devHidden && me.reminderHidden, "Expected normal My page without development tools", me);
  const soundBefore = await page.evaluate(() => { const payload = JSON.parse(backupPayload()); return { pressed: soundRow.getAttribute("aria-pressed"), state: soundState.textContent, enabled: sound.enabled, backedUp: Object.prototype.hasOwnProperty.call(payload.data, SOUND_KEY) }; });
  await page.click("#soundRow");
  const soundOff = await page.evaluate(() => { const contexts = soundDebug.contextCreated, events = soundDebug.events.length, played = soundFeedback("stamp"), payload = JSON.parse(backupPayload()); return { pressed: soundRow.getAttribute("aria-pressed"), state: soundState.textContent, enabled: sound.enabled, played, contextsBefore: contexts, contextsAfter: soundDebug.contextCreated, eventsBefore: events, eventsAfter: soundDebug.events.length, stored: JSON.parse(payload.data[SOUND_KEY]) }; });
  assert(soundBefore.pressed === "true" && soundBefore.state === "开" && soundBefore.enabled && soundBefore.backedUp && soundOff.pressed === "false" && soundOff.state === "关" && !soundOff.enabled && !soundOff.played
    && soundOff.contextsAfter === soundOff.contextsBefore && soundOff.eventsAfter === soundOff.eventsBefore && soundOff.stored.enabled === false,
  "Expected an on-by-default backed-up sound setting and zero AudioContext/event work while disabled", { soundBefore, soundOff });
  await page.click("#soundRow");
  const typeBefore = await page.evaluate(() => ({ title: parseFloat(getComputedStyle(document.querySelector(".me h1")).fontSize), advice: parseFloat(getComputedStyle(meAdvice).fontSize), pressed: fontScaleRow.getAttribute("aria-pressed") }));
  await page.click("#fontScaleRow");
  const typeAfter = await page.evaluate(() => { const payload = JSON.parse(backupPayload()); return { title: parseFloat(getComputedStyle(document.querySelector(".me h1")).fontSize), advice: parseFloat(getComputedStyle(meAdvice).fontSize), pressed: fontScaleRow.getAttribute("aria-pressed"), state: fontScaleState.textContent, stored: load(FONT_SCALE_KEY, false), backedUp: Object.prototype.hasOwnProperty.call(payload.data, FONT_SCALE_KEY) }; });
  assert(typeAfter.title >= typeBefore.title * 1.1 && typeAfter.advice >= typeBefore.advice * 1.1 && typeAfter.pressed === "true" && typeAfter.state === "开" && typeAfter.stored && typeAfter.backedUp, "Expected the persisted large-type preference to scale fixed-pixel text and join backups", { typeBefore, typeAfter });
  await page.click("#fontScaleRow");
  await page.click("#addLink");
  await page.fill("#addInput", "蘸料");
  await page.click("#addConfirm");
  const add = await page.evaluate(() => ({ added: addedChars.includes("蘸") && addedChars.includes("料"), indexed: indexesForChars(["蘸", "料"]).length === 2, queued: indexesForChars(["蘸", "料"]).every((idx) => (memory[cardKey(idx)] || {}).queuedFront) }));
  assert(add.added && add.indexed && add.queued, "Expected add-character workflow to persist and queue new cards", add);

  await page.evaluate(() => {
    const idx = CARDS.findIndex((card) => card.target === "器");
    memory[cardKey(idx)] = { seen: 1, last: Date.now(), target: "器", misses: 2, hints: 1, slow: 1, ease: 28, streak: 0, lastOutcome: "miss", pendingLearning: true };
    saveMemory(); renderMe();
  });
  const meActions = await page.evaluate(() => {
    const practiced = profileIndexes(), stable = practiced.filter(isStable), risk = practiced.filter(isHighRisk), overlap = stable.filter((idx) => risk.includes(idx));
    return { seen: meSeen.textContent.replace(/\s+/g, ""), stable: meStable.textContent.replace(/\s+/g, ""), risk: meRisk.textContent.replace(/\s+/g, ""), practiced: practiced.length, stableCount: stable.length, riskCount: risk.length, overlap: overlap.length, displayed: [Number(seenStat.textContent), Number(stableStat.textContent), Number(riskStat.textContent)], clickable: [meSeen, meStable, meRisk].every((node) => node.classList.contains("action")) };
  });
  assert(meActions.seen.includes("练过") && meActions.seen.includes("看卡点") && meActions.stable.includes("已拾回") && meActions.stable.includes("去字盒") && meActions.risk.includes("待拾回") && meActions.risk.includes("去字盒") && meActions.clickable
    && meActions.overlap === 0 && meActions.practiced >= meActions.stableCount + meActions.riskCount && meActions.displayed.join() === [meActions.practiced, meActions.stableCount, meActions.riskCount].join(),
  "Expected honest, disjoint practiced/recovered/at-risk metrics with disclosed actions", meActions);
  await page.click("#meRisk");
  const riskBook = await page.evaluate(() => { const legend = document.querySelector(".legend"), legendStyle = getComputedStyle(legend); return { visible: getComputedStyle(studybook).display !== "none", expanded: boxAllToggle.getAttribute("aria-expanded"), active: document.querySelector('#boxFilters [data-filter="risk"]').classList.contains("active"), hero: bookHero.textContent.replace(/\s+/g, ""), legendSize: parseFloat(legendStyle.fontSize), legendColor: legendStyle.color, mutedColor: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(), marks: Array.from(legend.querySelectorAll(".outcomeMark")).map((node) => ({ label: node.textContent, shape: getComputedStyle(node).clipPath, size: node.getBoundingClientRect().width })) }; });
  assert(riskBook.visible && riskBook.expanded === "true" && riskBook.active && riskBook.hero.includes("已拾回") && riskBook.hero.includes("练过") && riskBook.hero.includes("最近拾得")
    && riskBook.legendSize >= 13 && riskBook.marks.map((item) => item.label).join("") === "补待再" && riskBook.marks.every((item) => item.size >= 16) && riskBook.marks.some((item) => item.shape !== "none"),
  "Expected My risk action to deep-link Book with a readable, shape-and-text redundant outcome legend", riskBook);
  await page.click("#stampLegend");
  const stampGuide = await page.evaluate(() => ({ open: stampGuideSheet.classList.contains("open"), rows: Array.from(document.querySelectorAll(".stampGuideRow")).map((row) => row.textContent.replace(/\s+/g, "")), marks: Array.from(document.querySelectorAll(".stampGuideRow .outcomeMark")).map((node) => node.textContent) }));
  assert(stampGuide.open && stampGuide.rows.length === 4 && stampGuide.rows.join("|").includes("拾到首答独立写对") && stampGuide.rows.join("|").includes("补拾看过提示后写出") && stampGuide.rows.join("|").includes("待补这次写错了") && stampGuide.rows.join("|").includes("再拾这次没写出") && stampGuide.marks.join("") === "拾补待再", "Expected the Book legend to open a complete four-stamp dictionary", stampGuide);
  await page.click("#stampGuideClose");
  await page.click("#tabMe");
  await page.click("#openProfile");
  const profileInsight = await page.evaluate(() => ({ visible: getComputedStyle(profilePanel).display !== "none", duplicateChars: !!document.getElementById("profileChars"), rows: profilePanel.querySelectorAll("[data-profile-kind]").length, actions: Array.from(profilePanel.querySelectorAll("[data-profile-kind] em")).map((node) => node.textContent) }));
  assert(profileInsight.visible && !profileInsight.duplicateChars && profileInsight.rows > 0 && profileInsight.actions.every((label) => label === "去字盒"), "Expected Profile to remain insight-only without a duplicate weak-character list", profileInsight);
  await page.click("#closeProfile");
  assert(await page.evaluate(() => getComputedStyle(mePanel).display !== "none"), "Expected a Profile opened from My to return to My");
  await page.click("#openProfile");
  await page.click("#profileTopics [data-profile-kind]");
  const insightRoute = await page.evaluate(() => ({ book: getComputedStyle(studybook).display !== "none", active: document.querySelector('#boxFilters [data-filter="risk"]').classList.contains("active"), card: getComputedStyle(document.getElementById("card")).display }));
  assert(insightRoute.book && insightRoute.active && insightRoute.card === "none", "Expected Profile insights to route to Book instead of silently starting practice", insightRoute);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { fontScaleLarge = true; save(FONT_SCALE_KEY, true); applyFontScale(); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  const compactRecall = await page.evaluate(() => ({
    box: S, mascot: getComputedStyle(document.querySelector("#practiceArea > .mascotRow")).display, mascotCopy: mascotLine.textContent,
    actionBottom: actions.getBoundingClientRect().bottom, viewportBottom: innerHeight, tools: Array.from(inkTools.querySelectorAll("button")).map((node) => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth })),
    tip: tip.textContent, promptSize: parseFloat(getComputedStyle(document.getElementById("prompt")).fontSize),
  }));
  assert(compactRecall.box >= 276 && compactRecall.mascot === "flex" && compactRecall.mascotCopy.length > 0 && compactRecall.actionBottom <= compactRecall.viewportBottom + 1
    && compactRecall.tools.every((item) => item.height >= 43.9 && item.scrollWidth <= item.width + 1) && compactRecall.tip.startsWith("提示 ") && compactRecall.promptSize >= 35,
  "Expected large type and 44pt compact tools to preserve the writing area and guidance on a 320x568 screen", compactRecall);
  await page.evaluate(() => { inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer(); });
  const compactReveal = await page.evaluate(() => ({ ask: getComputedStyle(askRow).display, askCopy: askLine.textContent, askBottom: askRow.getBoundingClientRect().bottom, client: reveal.clientHeight, scroll: reveal.scrollHeight, qualityTargets: Array.from(qualityBox.querySelectorAll("button")).map((node) => node.getBoundingClientRect().height) }));
  assert(compactReveal.ask === "flex" && compactReveal.askCopy.length > 0 && compactReveal.askBottom <= 568 && compactReveal.scroll > compactReveal.client && compactReveal.qualityTargets.every((height) => height >= 44),
  "Expected short-screen reveal advice to remain visible and lower 44pt actions to stay reachable by internal scrolling", compactReveal);
  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); fontScaleLarge = false; save(FONT_SCALE_KEY, false); applyFontScale(); });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.evaluate(() => {
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning(); clearSessionSnapshot();
    addWord("强"); addWord("器"); activeMode = "new"; startRound();
  });
  await waitForWriter(page);
  const queuedStart = await page.evaluate(() => ({
    targets: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    current: cur.target,
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
  }));
  assert(queuedStart.targets === "强器" && queuedStart.current === "强" && queuedStart.flags.every(Boolean), "Expected newly added characters to lead a real non-calibration round in entry order", queuedStart);

  await submitStandard(page);
  await page.evaluate(() => { soundDebug.events = []; soundDebug.last = null; sound.tipShown = false; saveSound(); });
  await chooseCorrect(page);
  const stampSound = await page.evaluate(() => ({ last: soundDebug.last, events: soundDebug.events.slice(), tipShown: sound.tipShown, tip: document.getElementById("toast").textContent, contextCreated: soundDebug.contextCreated }));
  assert(stampSound.last === "stamp" && stampSound.events.join() === "stamp" && stampSound.tipShown && stampSound.tip.includes("盖章有声音了") && stampSound.contextCreated >= 1,
    "Expected one restrained stamp sound in the same grading turn and a one-time settings hint", stampSound);
  await page.waitForTimeout(1900);
  const queuedSecond = await page.evaluate(() => ({ current: cur.target, firstConsumed: !(memory[cardKey(indexesForChars(["强"])[0])] || {}).queuedFront, secondQueued: !!(memory[cardKey(indexesForChars(["器"])[0])] || {}).queuedFront, undo: getComputedStyle(undoBar).display !== "none" }));
  assert(queuedSecond.current === "器" && queuedSecond.firstConsumed && queuedSecond.secondQueued && queuedSecond.undo, "Expected first queued card to be consumed only after its stamp and leave the second next", queuedSecond);

  await page.click("#undoLast");
  await page.waitForFunction(() => practicePhase === "revealDecision" && cur.target === "强");
  const queuedRollback = await page.evaluate(() => ({
    current: cur.target,
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    stats: roundStats.length,
    reviews: fsrsReviewLog.length,
    baseCursor,
  }));
  assert(queuedRollback.current === "强" && queuedRollback.flags.every(Boolean) && queuedRollback.stats === 0 && queuedRollback.reviews === 0 && queuedRollback.baseCursor === 0, "Expected cross-card undo to restore queue-front flags and the ungraded position", queuedRollback);

  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  assert(await page.evaluate(() => cur.target === "器"), "Expected the second queued card after regrading the first");
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
  const queuedConsumed = await page.evaluate(() => ({
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    targets: roundStats.slice(0, 2).map((row) => row.target).join(""),
  }));
  assert(queuedConsumed.flags.every((flag) => !flag) && queuedConsumed.targets === "强器", "Expected queued cards to be consumed exactly once through the real grading path", queuedConsumed);

  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); sessionDone = new Set(); activeMode = "new"; startRound(); });
  await waitForWriter(page);
  const noSecondForce = await page.evaluate(() => !["强", "器"].includes(cur.target) && queuedFrontPool().every((idx) => !["强", "器"].includes(CARDS[idx].target)));
  assert(noSecondForce, "Expected consumed additions not to be forced at the front of a later round");

  await page.setViewportSize({ width: 375, height: 667 });
  const calibrationImmediate = await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning();
    addWord("强"); addWord("器"); activeMode = "calibrate"; startRound();
    const label = posLabel.getBoundingClientRect();
    return { helpReady: !show.disabled && !show.classList.contains("tlock"), progressCenter: label.left + label.width / 2, viewportCenter: innerWidth / 2 };
  });
  assert(calibrationImmediate.helpReady && Math.abs(calibrationImmediate.progressCenter - calibrationImmediate.viewportCenter) <= 0.5, "Expected immediate first-card help and a truly centered compact progress label", calibrationImmediate);
  await waitForWriter(page);
  const calibrationQueue = await page.evaluate(() => ({
    front: baseTargets.slice(0, 2).map((idx) => CARDS[idx].target).join(""),
    tail: baseTargets.slice(-4).map((idx) => ({ target: CARDS[idx].target, difficulty: cardDifficulty(idx) })),
    flags: indexesForChars(["强", "器"]).map((idx) => !!(memory[cardKey(idx)] || {}).queuedFront),
    size: baseTargets.length,
    unique: new Set(baseTargets).size,
    adultOnly: baseTargets.every((idx) => cardLevel(idx) !== "小学" && contextSource(idx) !== "fallback"),
    labels: { show: show.textContent, done: done.textContent, noNext: !document.getElementById("nextBtn") },
    helpReady: !show.disabled && !show.classList.contains("tlock") && !tip.classList.contains("tlock"),
    helpCopy: mascotLine.textContent,
    touch: { done: getComputedStyle(done).touchAction, tab: getComputedStyle(tabPractice).touchAction },
  }));
  assert(calibrationQueue.front === "尴嚏" && calibrationQueue.tail.every((row) => row.difficulty <= 85) && calibrationQueue.flags.every(Boolean) && calibrationQueue.size === 15 && calibrationQueue.unique === 15 && calibrationQueue.adultOnly
    && calibrationQueue.helpReady && calibrationQueue.helpCopy.includes("写不出就点")
    && calibrationQueue.labels.show === "不会写" && calibrationQueue.labels.done === "写好了" && calibrationQueue.labels.noNext && calibrationQueue.touch.done === "manipulation" && calibrationQueue.touch.tab === "manipulation",
  "Expected calibration hooks, capped finish, and immediately available first-card help", calibrationQueue);

  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing");
  const calibrationHelp = await page.evaluate(() => ({ phase: practicePhase, comfort: calibrationComfortShown, copy: traceIntro.textContent, mascot: mascotLine.textContent, bubbleHidden: getComputedStyle(teachBubble).display === "none", actionBottom: traceActions.getBoundingClientRect().bottom, viewportBottom: innerHeight, secondComfort: takeCalibrationComfort("slow"), card1Events: funnelEventCount("calib_card1_done") }));
  assert(calibrationHelp.phase === "tracing" && calibrationHelp.comfort && calibrationHelp.copy.includes("忘了正常") && calibrationHelp.mascot.includes("沿着轮廓描") && calibrationHelp.bubbleHidden && calibrationHelp.actionBottom <= calibrationHelp.viewportBottom
    && !calibrationHelp.secondComfort && calibrationHelp.card1Events === 1,
  "Expected first-card don't-know to enter tracing immediately and show calibration comfort only once", calibrationHelp);

  await page.evaluate(() => { tracedThisCard = true; updateInkControls(); });
  await page.click("#traceDone");
  const postTraceLayout = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, hint: hint.textContent, mascot: mascotLine.textContent, actionBottom: actions.getBoundingClientRect().bottom, viewportBottom: innerHeight, show: show.textContent }));
  assert(postTraceLayout.phase === "postTraceRecall" && postTraceLayout.title.includes("2/2 自己写") && postTraceLayout.hint === "" && postTraceLayout.mascot === "凭刚才的手感写"
    && postTraceLayout.actionBottom <= postTraceLayout.viewportBottom && postTraceLayout.show === "再描一遍", "Expected the complete 375x667 post-trace controls without duplicate guidance", postTraceLayout);

  await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
    save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning(); activeMode = "calibrate"; startRound();
  });
  await waitForWriter(page);

  await page.evaluate(() => { inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer(); });
  const firstCalibrationReveal = await page.evaluate(async () => {
    const snapshot = submissionSnapshot, baseStyle = (node) => { const style = getComputedStyle(node); return { background: style.backgroundColor, border: style.border, shadow: style.boxShadow }; };
    const first = { bubble: getComputedStyle(teachBubbleGrade).display, ask: getComputedStyle(askRow).display, decisionBottom: decisionRow.getBoundingClientRect().bottom, viewportBottom: innerHeight };
    showRevealState({ ...snapshot, lastVerdict: null }); await new Promise((resolve) => setTimeout(resolve, 160)); const neutral = { correct: baseStyle(decisionCorrect), wrong: baseStyle(decisionWrong), suggested: decisionCorrect.classList.contains("suggest") || decisionWrong.classList.contains("suggest") };
    showRevealState({ ...snapshot, lastVerdict: { status: "bad", mode: "exact", failed: [0], missing: 0 } }); await new Promise((resolve) => setTimeout(resolve, 160)); const wrongSuggested = { correct: baseStyle(decisionCorrect), wrong: baseStyle(decisionWrong), suggested: decisionWrong.classList.contains("suggest") && !decisionCorrect.classList.contains("suggest") };
    showRevealState(snapshot);
    return { first, neutral, wrongSuggested };
  });
  assert(firstCalibrationReveal.first.bubble === "block" && firstCalibrationReveal.first.ask === "none" && firstCalibrationReveal.first.decisionBottom <= firstCalibrationReveal.first.viewportBottom,
    "Expected the first calibration reveal to explain honest self-assessment without duplicate mascot copy", firstCalibrationReveal.first);
  assert(!firstCalibrationReveal.neutral.suggested && firstCalibrationReveal.neutral.correct.background === firstCalibrationReveal.neutral.wrong.background
    && firstCalibrationReveal.neutral.correct.border === firstCalibrationReveal.neutral.wrong.border && firstCalibrationReveal.neutral.correct.shadow === firstCalibrationReveal.neutral.wrong.shadow
    && firstCalibrationReveal.wrongSuggested.suggested && firstCalibrationReveal.wrongSuggested.wrong.background !== firstCalibrationReveal.wrongSuggested.correct.background,
  "Expected neutral decisions to carry equal weight and an exact assistant suggestion to dominate on either side", firstCalibrationReveal);
  await page.click("#replayBtn"); await page.waitForTimeout(80);
  const compactReplay = await page.evaluate(() => { const box = document.querySelector(".cmpBox.std").getBoundingClientRect(), svg = rightHz.querySelector("svg").getBoundingClientRect(); return { box: [box.width, box.height], svg: [svg.width, svg.height], right: svg.right - box.right, bottom: svg.bottom - box.bottom }; });
  assert(compactReplay.box.join() === "138,138" && compactReplay.svg.join() === compactReplay.box.join() && compactReplay.right <= 0.5 && compactReplay.bottom <= 0.5, "Expected 375px reveal playback to use the rendered comparison-box size without clipping", compactReplay);
  await page.setViewportSize({ width: 390, height: 844 });

  const calibrationIsolation = await page.evaluate(() => {
    const original = calibrationTargets.slice(), originalSet = new Set(original);
    const extras = allIndexes().filter((idx) => !originalSet.has(idx) && qualityAvailable(idx)).slice(0, 3);
    insertIntoCurrentBatch(extras);
    const saved = load(SESSION_KEY, null);
    calibrationTargets = [];
    restoreSession(saved);
    const restored = calibrationTargets.slice();
    roundStats = [
      ...original.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", geometryStatus: "ok", geometryMode: "exact" })),
      ...extras.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "miss" })),
    ];
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; preference = "balanced";
    const allCounts = roundCounts(), sampleCounts = roundCounts(calibrationRoundStats());
    maybeFinishCalibration();
    return { original, extras, restored, total: baseTargets.length, allCounts, sampleCounts, calibration: cloneObj(tuning.calibration), preference, offset: tuning.offset, completedEvents: funnelEventCount("calib_completed") };
  });
  assert(calibrationIsolation.original.length === 15 && calibrationIsolation.extras.length === 3 && calibrationIsolation.total === 18
    && calibrationIsolation.restored.join() === calibrationIsolation.original.join() && calibrationIsolation.allCounts.fast === 15 && calibrationIsolation.allCounts.miss === 3
    && calibrationIsolation.sampleCounts.fast === 15 && calibrationIsolation.sampleCounts.miss === 0 && calibrationIsolation.calibration.sampleSize === 15
    && calibrationIsolation.calibration.counts.fast === 15 && calibrationIsolation.calibration.counts.miss === 0 && calibrationIsolation.preference === "challenge" && calibrationIsolation.offset === 10 && calibrationIsolation.completedEvents === 1,
  "Expected added calibration cards to persist and learn without changing the original 15-card calibration result", calibrationIsolation);

  const calibrationConsistency = await page.evaluate(() => {
    const sample = calibrationTargets.slice(0, 12);
    activeMode = "calibrate"; calibrationTargets = sample; tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; preference = "balanced";
    roundStats = sample.map((idx, order) => ({ idx, target: CARDS[idx].target, outcome: "fast", geometryStatus: order < 8 ? "ok" : "bad", geometryMode: "exact" }));
    maybeFinishCalibration();
    return { calibration: cloneObj(tuning.calibration), preference, offset: tuning.offset };
  });
  assert(calibrationConsistency.calibration.counts.fast === 12 && calibrationConsistency.calibration.consistentFast === 10
    && calibrationConsistency.preference === "balanced" && calibrationConsistency.offset === 2,
  "Expected geometry disagreement to keep twelve self-rated fast cards out of challenge calibration", calibrationConsistency);

  const calibrationWebReturn = await page.evaluate(() => {
    summary.style.display = "flex"; calibCard.style.display = "flex"; renderCalibrationReturnHook();
    return { visible: getComputedStyle(calibReturnHook).display === "flex", title: calibReturnTitle.textContent, date: calibReturnText.textContent, buttonHidden: getComputedStyle(calibReminderYes).display === "none", tomorrow: formatDueDay(shiftDay(today(), 1)) };
  });
  assert(calibrationWebReturn.visible && calibrationWebReturn.title.includes("明天再来") && calibrationWebReturn.date === calibrationWebReturn.tomorrow && calibrationWebReturn.buttonHidden,
  "Expected Web calibration result to show a concrete next-day return expectation", calibrationWebReturn);

  await page.evaluate(() => { clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer();
    lastVerdict = { status: "bad", mode: "exact", failed: [0], missing: 0 }; submissionSnapshot = Object.freeze({ ...submissionSnapshot, lastVerdict: cloneObj(lastVerdict) }); showRevealState(submissionSnapshot);
  });
  const revealFidelity = await page.evaluate(() => {
    const exactSnapshot = submissionSnapshot, mineBox = document.querySelector(".cmpBox.mine"), stdBox = document.querySelector(".cmpBox.std");
    const result = {
      grids: [mineBox, stdBox].map((box) => ["cx", "cy", "d1", "d2"].every((cls) => !!box.querySelector(`.${cls}`))),
      standardPaths: rightHz.querySelectorAll("svg path").length,
      overlayPaths: mineOverlay.querySelectorAll("svg path").length,
      sameViewBox: rightHz.querySelector("svg")?.getAttribute("viewBox") === mineOverlay.querySelector("svg")?.getAttribute("viewBox"),
      failedCount: Number(mineInk.dataset.failedCount),
      copy: askLine.textContent,
      exactSuggest: decisionWrong.classList.contains("suggest") && !decisionCorrect.classList.contains("suggest"),
    };
    showRevealState({ ...exactSnapshot, referenceStrokes: [] });
    result.fallback = rightGlyph.style.opacity === "1" && rightHz.querySelectorAll("svg path").length === 0 && mineOverlay.textContent === cur.target;
    showRevealState(exactSnapshot);
    return result;
  });
  assert(revealFidelity.grids.every(Boolean) && revealFidelity.standardPaths > 0 && revealFidelity.standardPaths === revealFidelity.overlayPaths && revealFidelity.sameViewBox
    && revealFidelity.failedCount === 1 && revealFidelity.copy.includes("这几笔再对一眼") && revealFidelity.exactSuggest && revealFidelity.fallback,
  "Expected coordinate-aligned skeleton comparison, exact-stroke highlighting, soft suggestion tint, and font fallback", revealFidelity);
  await page.click("#decisionCorrect");
  const softConfirmFirst = await page.evaluate(() => ({ shown: getComputedStyle(softConfirm).display !== "none", stamped, attempts: episodeFor(currentCardIndex()).attempts.length }));
  assert(softConfirmFirst.shown && !softConfirmFirst.stamped && softConfirmFirst.attempts === 0, "Expected exact-bad correct choice to pause before accounting", softConfirmFirst);
  await page.click("#compareAgain");
  await page.click("#decisionCorrect");
  const softConfirmOnce = await page.evaluate(() => ({ hidden: getComputedStyle(softConfirm).display === "none", stamped, outcome: roundStats[0] && roundStats[0].outcome }));
  assert(softConfirmOnce.hidden && softConfirmOnce.stamped && softConfirmOnce.outcome === "fast", "Expected compare-again to avoid repeating the soft confirmation on the same reveal", softConfirmOnce);
  await page.click("#editStamp");
  await page.click("#decisionCorrect");
  const softConfirmAfterUndo = await page.evaluate(() => ({ shown: getComputedStyle(softConfirm).display !== "none", stamped, attempts: episodeFor(currentCardIndex()).attempts.length }));
  assert(softConfirmAfterUndo.shown && !softConfirmAfterUndo.stamped && softConfirmAfterUndo.attempts === 0, "Expected edit rollback to reset the soft-confirm decision", softConfirmAfterUndo);
  await page.click("#confirmCorrect");
  const confirmedCorrect = await page.evaluate(() => ({ stamped, rating: fsrsReviewLog.slice(-1)[0] && fsrsReviewLog.slice(-1)[0].rating, outcome: roundStats[0] && roundStats[0].outcome }));
  assert(confirmedCorrect.stamped && confirmedCorrect.rating === "Good" && confirmedCorrect.outcome === "fast", "Expected explicit confirmation to keep the existing graduation path", confirmedCorrect);

  await page.evaluate(() => { clearTimeout(autoNextTimer); stamped = false; clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "疑")]); });
  await waitForWriter(page);
  await page.evaluate(() => {
    inkStrokes = mediansToCanvas(curMedians); redrawInk(); revealAnswer();
    lastVerdict = { status: "bad", mode: "holistic", failed: [0], missing: 1 }; submissionSnapshot = Object.freeze({ ...submissionSnapshot, lastVerdict: cloneObj(lastVerdict) }); showRevealState(submissionSnapshot);
  });
  const holisticRendering = await page.evaluate(() => ({ failedCount: Number(mineInk.dataset.failedCount), suggested: decisionCorrect.classList.contains("suggest") || decisionWrong.classList.contains("suggest") }));
  assert(holisticRendering.failedCount === 0 && !holisticRendering.suggested, "Expected holistic verdicts to avoid stroke coloring and preselection", holisticRendering);
  await page.click("#decisionCorrect");
  const holisticNoConfirm = await page.evaluate(() => ({ stamped, softHidden: getComputedStyle(softConfirm).display === "none", outcome: roundStats[0] && roundStats[0].outcome }));
  assert(holisticNoConfirm.stamped && holisticNoConfirm.softHidden && holisticNoConfirm.outcome === "fast", "Expected holistic disagreement to remain advisory without soft confirmation", holisticNoConfirm);

  const disagreementRate = await page.evaluate(() => {
    const original = memory;
    memory = { a: { lastSystemAgree: true }, b: { lastSystemAgree: false }, c: { lastSystemAgree: null }, d: {} };
    const result = systemAgreementStats(); memory = original; return result;
  });
  assert(disagreementRate.total === 2 && disagreementRate.disagree === 1 && disagreementRate.rate === 50, "Expected dev disagreement rate to ignore unavailable assistant verdicts", disagreementRate);

  await page.evaluate(() => { clearTimeout(autoNextTimer); stamped = false; clearSessionSnapshot(); activeMode = "focus"; startFocus([CARDS.findIndex((card) => card.target === "衡")]); });
  await waitForWriter(page);
  await submitStandard(page);
  const uncertainBefore = await page.evaluate(() => dailyActivity().attempts);
  await page.click("#decisionUncertain");
  const uncertain = await page.evaluate((before) => {
    const idx = currentCardIndex(), ep = episodeFor(idx), event = fsrsReviewLog.slice(-1)[0], stat = roundStats[0];
    const row = dailyActivity();
    return { before, after: row.attempts, targetOccurrences: row.targetKeys.filter((key) => key === cardKey(idx)).length, outcome: stat && stat.outcome, uncertain: stat && stat.uncertain, rating: event && event.rating, reason: event && event.reason,
      queued: unresolved.has(idx) && reinforcementQueue.some((item) => item.idx === idx), pendingLearning: !!(memory[cardKey(idx)] || {}).pendingLearning, attempts: ep.attempts.length, userCorrect: ep.attempts[0] && ep.attempts[0].userCorrect };
  }, uncertainBefore);
  assert(uncertain.outcome === "hinted" && uncertain.uncertain && uncertain.rating === "Again" && uncertain.reason === "hinted"
    && uncertain.queued && uncertain.pendingLearning && uncertain.attempts === 1 && !uncertain.userCorrect && uncertain.after === uncertain.before + 1 && uncertain.targetOccurrences === 1,
  "Expected uncertain self-assessment to use the hinted reinforcement path without graduation", uncertain);

  const inRoundAdd = await page.evaluate(() => {
    const pool = allIndexes().filter((idx) => qualityAvailable(idx)).slice(100, 120), original = pool.slice(0, 15), extras = pool.slice(15, 17);
    displayView("card"); baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-current";
    manualQueue = []; reinforcementQueue = [{ idx: extras[0], eligibleAfter: 0, order: 0 }]; unresolved = new Set([extras[0]]); episodes = {}; roundStats = []; sessionDone = new Set(); practicePhase = "recall";
    const appended = insertIntoCurrentBatch([extras[0], extras[1], extras[0]]); const afterAppend = { total: baseTargets.length, unique: new Set(baseTargets).size, queue: manualQueue.map((item) => item.idx), progress: practiceProgress() };
    baseCursor = 1; const first = nextQueuedTarget(); baseCursor += 1; const second = nextQueuedTarget();

    baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-move"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = []; sessionDone = new Set();
    const future = original[8], moved = insertIntoCurrentBatch([future]); baseCursor = 1; const movedNext = nextQueuedTarget();

    baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = "verify-add-repeat"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = { [String(original[0])]: { idx: original[0], firstOutcome: "fast", attempts: [{ attemptId: "old" }] } }; roundStats = [{ idx: original[0], target: CARDS[original[0]].target, outcome: "fast" }]; sessionDone = new Set([original[0]]);
    const repeated = insertIntoCurrentBatch([original[0]]); const repeatTotal = baseTargets.length; const saved = load(SESSION_KEY, null); manualQueue = []; restoreSession(saved); const restoredQueue = manualQueue.map((item) => ({ idx: item.idx, kind: item.kind }));
    const modes = ["new", "review", "focus", "calibrate"].map((mode) => {
      activeMode = mode; baseTargets = original.slice(); batch = baseTargets; baseCursor = 0; currentIndex = original[0]; currentAttemptKind = "base"; currentAttemptId = `verify-add-${mode}`; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = []; sessionDone = new Set();
      insertIntoCurrentBatch([extras[0]]); baseCursor = 1; const next = nextQueuedTarget(); return { mode, total: baseTargets.length, originalsKept: original.every((idx) => baseTargets.includes(idx)), next: next.idx };
    });
    return { original, extras, appended, afterAppend, first, second, moved, movedNext, repeated, repeatTotal, restoredQueue, modes };
  });
  assert(inRoundAdd.appended.queued.join() === inRoundAdd.extras.join() && inRoundAdd.afterAppend.total === 17 && inRoundAdd.afterAppend.unique === 17 && inRoundAdd.afterAppend.progress.done === 0 && inRoundAdd.afterAppend.progress.total === 17
    && inRoundAdd.first.idx === inRoundAdd.extras[0] && inRoundAdd.second.idx === inRoundAdd.extras[1], "Expected a full group to grow and preserve deduplicated FIFO manual priority", inRoundAdd);
  assert(inRoundAdd.moved.added.length === 0 && inRoundAdd.movedNext.idx === inRoundAdd.original[8] && inRoundAdd.repeatTotal === 15 && inRoundAdd.repeated.queued[0] === inRoundAdd.original[0]
    && inRoundAdd.restoredQueue.length === 1 && inRoundAdd.restoredQueue[0].kind === "repeat" && inRoundAdd.modes.every((row) => row.total === 16 && row.originalsKept && row.next === inRoundAdd.extras[0]), "Expected future/current targets to move or repeat without growing the denominator and all modes to preserve manual priority", inRoundAdd);

  await page.evaluate(() => {
    exitCurrentRound(); clearSessionSnapshot(); status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality(); saveTuning();
    startFocus([CARDS.findIndex((card) => card.target === "器")]);
  });
  await submitStandard(page);
  await chooseCorrect(page);
  const repeatTarget = await page.evaluate(() => cur.target);
  await page.click("#addInPractice");
  await page.fill("#addInput", repeatTarget);
  const repeatExit = await page.evaluate(() => {
    confirmAdd();
    const before = { baseCursor, total: baseTargets.length, queue: cloneObj(manualQueue), phase: practicePhase };
    exitCurrentRound(false);
    return { before, saved: load(SESSION_KEY, null), home: getComputedStyle(home).display !== "none" };
  });
  assert(repeatExit.home && repeatExit.before.baseCursor === repeatExit.before.total && repeatExit.before.phase === "feedback"
    && repeatExit.before.queue.length === 1 && repeatExit.before.queue[0].kind === "repeat" && repeatExit.saved.manualQueue.length === 1,
  "Expected a last-card feedback addition to save its pending repeat before returning home", repeatExit);
  await page.waitForFunction(() => history.state && history.state.shiziView === "home");
  await page.click("#startBtn");
  await page.waitForFunction(() => practiceHistoryArmed && getComputedStyle(card).display !== "none");
  const repeatRestore = await page.evaluate(() => ({ summary: getComputedStyle(summary).display, phase: practicePhase, queue: cloneObj(manualQueue), session: load(SESSION_KEY, null) }));
  assert(repeatRestore.summary === "none" && repeatRestore.phase === "feedback" && repeatRestore.queue.length === 1 && repeatRestore.session,
  "Expected restore to keep the final-card feedback and pending manual repeat instead of summarizing", repeatRestore);
  await page.waitForFunction((target) => currentAttemptKind === "manual" && cur.target === target && practicePhase === "recall", repeatTarget);
  const repeatedAfterRestore = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, queue: manualQueue.length, total: baseTargets.length, summary: getComputedStyle(summary).display, session: load(SESSION_KEY, null) }));
  assert(repeatedAfterRestore.target === repeatTarget && repeatedAfterRestore.kind === "manual" && repeatedAfterRestore.queue === 0 && repeatedAfterRestore.total === 1 && repeatedAfterRestore.summary === "none" && repeatedAfterRestore.session,
  "Expected the restored next card to consume the queued repeat without growing the group", repeatedAfterRestore);

  const completionHaptics = await page.evaluate(async () => {
    exitCurrentRound(); clearSessionSnapshot();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; saveActivity();
    reminder.milestonesShown = []; saveReminder(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); activeMode = "new";
    const indexes = indexesForChars(["强", "器", "疑"]);
    baseTargets = indexes.slice(0, 2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-milestone";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    const milestoneDelay = parseFloat(getComputedStyle(summaryBigSeal).animationDelay) * 1000, milestoneImmediate = hapticDebug.events.slice();
    await new Promise((resolve) => setTimeout(resolve, milestoneDelay + 100)); const milestone = hapticDebug.events.slice();
    baseTargets = indexes.slice(2); batch = baseTargets; baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = baseTargets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: false })); roundId = "verify-ordinary";
    baseTargets.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null; roundSummary(true);
    const ordinaryDelay = parseFloat(getComputedStyle(summaryBigSeal).animationDelay) * 1000, ordinaryImmediate = hapticDebug.events.slice();
    await new Promise((resolve) => setTimeout(resolve, ordinaryDelay + 100));
    return { milestoneImmediate, milestone, milestoneDelay, ordinaryImmediate, ordinary: hapticDebug.events.slice(), ordinaryDelay, groups: dailyActivity().completedGroups, totalDays: totalPracticeDays() };
  });
  assert(completionHaptics.milestoneImmediate.length === 0 && completionHaptics.ordinaryImmediate.length === 0 && completionHaptics.milestone.join() === "milestone" && completionHaptics.ordinary.join() === "action"
    && completionHaptics.milestoneDelay > completionHaptics.ordinaryDelay && completionHaptics.groups === 2 && completionHaptics.totalDays === 1,
  "Expected milestone and ordinary completion haptics to land with their delayed final seal", completionHaptics);

  const p1Ceremony = await page.evaluate(async () => {
    clearTimeout(summarySealTimer); clearTimeout(autoNextTimer); clearSessionSnapshot();
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; sessionDone = new Set();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; saveActivity();
    reminder = normalizeReminder({ milestonesShown: [1], characterMilestonesShown: [] }); saveReminder();
    tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] }; saveTuning(); activeMode = "calibrate";
    const indexes = ["器", "疑", "强", "料"].map((target) => CARDS.findIndex((card) => card.target === target));
    baseTargets = indexes.slice(); batch = baseTargets; calibrationTargets = baseTargets.slice(); baseCursor = baseTargets.length; manualQueue = []; unresolved = new Set(); practicePhase = "between";
    roundStats = [
      { idx: indexes[0], target: CARDS[indexes[0]].target, outcome: "fast", independentlyRecovered: false },
      { idx: indexes[1], target: CARDS[indexes[1]].target, outcome: "hinted", independentlyRecovered: true },
      { idx: indexes[2], target: CARDS[indexes[2]].target, outcome: "slow", independentlyRecovered: false },
      { idx: indexes[3], target: CARDS[indexes[3]].target, outcome: "miss", independentlyRecovered: true },
    ];
    roundId = "verify-p1-ceremony"; roundStartMemoryCount = memoryCount(); indexes.forEach((idx) => markPracticeStamp(idx)); hapticDebug.events = []; hapticDebug.last = null;
    roundSummary(true);
    const sealDelay = parseFloat(getComputedStyle(calibBigSeal).animationDelay) * 1000;
    const immediate = hapticDebug.events.slice(), tiles = Array.from(calibSumTiles.querySelectorAll(".sumTile"));
    const before = {
      calibration: getComputedStyle(calibCard).display, sheet: getComputedStyle(sumSheet).display, tiles: tiles.length, date: calibDateSeal.textContent,
      sealDelay, hint: getComputedStyle(calibPracticeHint).display, legend: calibCard.textContent.includes("无点 拾到"),
      marks: tiles.map((tile) => tile.querySelector(".outcomeMark")?.textContent || ""), recovered: tiles.map((tile) => tile.querySelector(".recover")?.textContent || ""),
      slowBorder: getComputedStyle(tiles[2]).borderColor, blue: getComputedStyle(document.documentElement).getPropertyValue("--blue").trim(), immediate,
    };
    await new Promise((resolve) => setTimeout(resolve, sealDelay + 100));

    const idx = indexes[1]; currentIndex = idx; cur = CARDS[idx]; currentAttemptId = "verify-recovered-stamp"; episodes = { [String(idx)]: { idx, firstOutcome: "hinted", attempts: [] } };
    memory[cardKey(idx)] = { seen: 1, dueDay: "2026-07-30" }; showStampedFeedback("fast");
    const recoveredStamp = { className: stampOnMine.className, shadow: getComputedStyle(stampOnMine.querySelector(".face")).boxShadow, copy: toastSubEl.textContent, mascot: feedbackBlob.className };
    showStampedFeedback("slow"); recoveredStamp.concernedMascot = feedbackBlob.className;

    reminder.characterMilestonesShown = []; reminder.characterMilestoneDay = ""; saveReminder();
    const hundred = celebrateCharacterMilestoneIfAny(99, 100), repeated = celebrateCharacterMilestoneIfAny(99, 100); renderSummaryMilestone({ kind: "characters", value: hundred });
    memory = Object.fromEntries(Array.from({ length: 100 }, (_, order) => [`milestone:${order}`, { seen: 1, last: Date.now() }])); saveMemory();
    activity.daily = {}; activity.practiceDays = []; for (let order = 0; order < 5; order += 1) { const key = shiftDay(today(), -order); activity.practiceDays.push(key); activity.daily[key] = { stamps: 1, attempts: 1, targetKeys: [`m:${order}`], completedRoundIds: [`m:${order}`] }; } saveActivity();
    backupMeta = normalizeBackupMeta(null); summaryBackupHintVisible = false; save(BACKUP_META_KEY, backupMeta); renderBackupUI(); renderSummaryBackupHint();
    const character = { hundred, repeated, badge: milestoneMiniSeal.textContent, copy: $("milestoneCopy").textContent, reminder: getComputedStyle(backupReminder).display, summaryReminder: getComputedStyle(summaryBackupHint).display };

    const vibrated = []; try { Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration) => { vibrated.push(duration); return true; } }); } catch (error) {}
    hapticFeedback("select"); hapticFeedback("stamp"); hapticFeedback("milestone");
    clearTimeout(summarySealTimer); clearTimeout(autoNextTimer);
    return { before, after: hapticDebug.events.slice(0, 1), recoveredStamp, character, vibrated };
  });
  assert(p1Ceremony.before.calibration === "flex" && p1Ceremony.before.sheet === "none" && p1Ceremony.before.tiles === 4 && p1Ceremony.before.date.length > 0
    && p1Ceremony.before.sealDelay >= 690 && p1Ceremony.before.hint === "block" && p1Ceremony.before.legend && p1Ceremony.before.marks.join("") === "补待再"
    && p1Ceremony.before.recovered.filter(Boolean).every((copy) => copy === "已独立") && p1Ceremony.before.slowBorder !== p1Ceremony.before.blue && p1Ceremony.before.immediate.length === 0 && p1Ceremony.after.join() === "action",
  "Expected the first calibration result to play the full, risk-readable tile/date/final-seal ceremony", p1Ceremony);
  assert(p1Ceremony.recoveredStamp.className.includes("recovered") && p1Ceremony.recoveredStamp.shadow !== "none" && p1Ceremony.recoveredStamp.copy.includes("7月30日") && !p1Ceremony.recoveredStamp.copy.includes("2026年") && p1Ceremony.recoveredStamp.mascot.includes("pleased") && p1Ceremony.recoveredStamp.concernedMascot.includes("concerned"),
  "Expected an independently recovered card to receive a distinct gold-edged seal, compact date, and responsive mascot state", p1Ceremony.recoveredStamp);
  assert(p1Ceremony.character.hundred === 100 && p1Ceremony.character.repeated === null && p1Ceremony.character.badge === "百" && p1Ceremony.character.copy.includes("100")
    && p1Ceremony.character.reminder === "none" && p1Ceremony.character.summaryReminder === "none" && p1Ceremony.vibrated.join() === "10,10",
  "Expected one-time hundred-character recognition to take priority over backup prompts with Web vibration fallback", p1Ceremony);

  const p1Discovery = await page.evaluate(() => {
    clearSessionSnapshot(); tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] }; saveTuning();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; activity.daily = {}; activity.practiceDays = []; memory = {}; status = {};
    const idx = CARDS.findIndex((card) => card.target === "器"); memory[cardKey(idx)] = { seen: 1, last: Date.now(), misses: 1, streak: 0, lastOutcome: "miss", dueDay: today(), due: dayStartMs(today()) }; saveMemory(); markPracticeStamp(idx); renderMe();
    const me = { day: meDayState.textContent, ready: profileSampleReady(), advice: meAdvice.textContent }; renderProfile(); const bars = profilePanel.querySelectorAll(".profileBar").length;
    memory = {}; saveMemory(); renderBook(); const ghosts = document.querySelectorAll(".ghostTile").length;
    memory[cardKey(idx)] = { seen: 1, last: Date.now(), streak: 2, lastOutcome: "fast", dueDay: today(), due: dayStartMs(today()) }; status = { [idx]: "rest" }; saveMemory(); save(DECK_KEY, status); activity = newActivity(); saveActivity(); renderHome(); const breathes = startBtn.classList.contains("dueBreathe");
    activeMode = "focus"; baseTargets = [idx]; batch = baseTargets; baseCursor = 0; currentIndex = idx; currentAttemptKind = "base"; currentAttemptId = "verify-auto-overlay"; episodes = {}; roundStats = []; unresolved = new Set(); manualQueue = []; practicePhase = "recall"; cur = CARDS[idx]; stamped = false; revealed = false; lastVerdict = null; hintEverUsed = false; hintsUsedThisCard = 0;
    submissionSnapshot = Object.freeze({ target: cur.target, idx, attemptId: currentAttemptId, createdAt: Date.now(), hintStrokeIds: [], hintCount: 0, hintStrokes: [], inkStrokes: [], referenceStrokes: [], compositeGeometry: [], compositeImage: null, hintEverUsed: false, enteredTracing: false, practicePhase: "recall", lastVerdict: null, userCorrect: null });
    showRevealState(submissionSnapshot); decideSubmission(false); const autoOverlay = { on: overlayOn, display: getComputedStyle(mineOverlay).display, toggle: overlayToggle.textContent }; clearTimeout(autoNextTimer); clearTimeout(editStampTimer);
    return { me, bars, ghosts, breathes, autoOverlay, homeAdd: !!homeAdd, qualityTargets: Array.from(qualityBox.querySelectorAll("button")).map((node) => parseFloat(getComputedStyle(node).minHeight)), compareTargets: Array.from(document.querySelectorAll(".cmpLinks button")).map((node) => parseFloat(getComputedStyle(node).minHeight)) };
  });
  assert(p1Discovery.me.day.includes("第 1 天") && p1Discovery.me.day.includes("进行中") && !p1Discovery.me.ready && p1Discovery.me.advice.includes("样本还少") && p1Discovery.bars === 0
    && p1Discovery.ghosts >= 5 && p1Discovery.breathes && p1Discovery.autoOverlay.on && p1Discovery.autoOverlay.display === "flex" && p1Discovery.autoOverlay.toggle === "分开看"
    && p1Discovery.homeAdd && p1Discovery.qualityTargets.every((height) => height >= 44) && p1Discovery.compareTargets.every((height) => height >= 40),
  "Expected honest first-day/sample states, discoverable controls, ghost tiles, and a due-card breathe cue", p1Discovery);

  await page.evaluate(() => {
    status = {}; memory = {}; fsrsReviewLog = []; quality = {}; save(DECK_KEY, status); saveMemory(); saveFSRSLog(); saveQuality();
    activity = newActivity(); activity.inheritedStreak = 0; activity.inheritedTotalDays = 0; saveActivity();
    reminder.milestonesShown = []; saveReminder();
    clearSessionSnapshot(); sessionDone = new Set();
    const indexes = ["器", "疑", "强"].map((target) => CARDS.findIndex((card) => card.target === target));
    startFocus(indexes);
  });
  await waitForWriter(page);

  const handwritingBoundaries = await page.evaluate(async () => {
    const originalWriter = writer;
    const addStroke = () => { curInkStroke = [{ x: 24, y: 28 }, { x: 72, y: 78 }]; inkEnd(); };
    tuning.peekHintUsed = false; tuning.strokeHintConsequenceShown = false; saveTuning();
    clearInk(); actionStack = []; seenGroups = new Set(); groups = [1, 1]; groupIdx = 0; shownStrokes = 0; hintsUsedThisCard = 0; hintEverUsed = false;
    writer = { animateStroke: async () => {} }; updateTip();
    addStroke(); await tip.onclick(); addStroke();
    const peekOffer = { copy: hint.textContent, consumed: !!tuning.peekHintUsed, consequenceShown: !!tuning.strokeHintConsequenceShown, title: tip.hasAttribute("title") };
    const stacked = actionStack.map((action) => action.type).join(",");
    await undoInkStroke(); const afterStroke = { ink: inkStrokes.length, stack: actionStack.map((action) => action.type).join(",") };
    await undoInkStroke(); const afterHint = { ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.map((action) => action.type).join(","), tipDisabled: tip.disabled };
    await undoInkStroke(); const empty = { ink: inkStrokes.length, stack: actionStack.length, undoDisabled: undoStroke.disabled };

    actionStack = []; seenGroups = new Set(); groups = [1, 1]; groupIdx = 0; shownStrokes = 0; hintsUsedThisCard = 0; hintEverUsed = false; clearInk(); updateTip();
    await tip.onclick(); const firstUse = hintsUsedThisCard;
    await rewriteCurrentCard();
    const rewritten = { ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.length, tipDisabled: tip.disabled, firstUse };
    writer = { animateStroke: async () => {} }; groups = [1, 1]; updateTip();
    await tip.onclick(); const replayUse = hintsUsedThisCard;
    await tip.onclick(); const newUse = hintsUsedThisCard;

    loadToken += 1; writer = { animateStroke: () => new Promise((resolve) => setTimeout(resolve, 70)) };
    groups = [1]; groupIdx = 0; shownStrokes = 0; actionStack = []; seenGroups = new Set(); hintEverUsed = false; hintsUsedThisCard = 0; animating = false; revealed = false; clearInk(); updateTip();
    const playback = tip.onclick(); await Promise.resolve();
    const duringPlayback = { animating, opacity: Number(inkCanvas.style.opacity), doneDisabled: done.disabled, showDisabled: show.disabled, revealRejected: revealAnswer() === false };
    await playback;
    const afterPlayback = { animating, opacity: Number(inkCanvas.style.opacity), stack: actionStack.map((action) => action.type).join(",") };

    loadToken += 1; writer = { animateStroke: () => new Promise((resolve) => setTimeout(resolve, 70)) };
    groups = [1]; groupIdx = 0; shownStrokes = 0; actionStack = []; seenGroups = new Set(); animating = false; revealed = false; updateTip();
    const interrupted = tip.onclick(); await Promise.resolve(); const rewriting = rewriteCurrentCard(); await Promise.all([interrupted, rewriting]);
    const afterInterrupt = { animating, opacity: Number(inkCanvas.style.opacity), ink: inkStrokes.length, groupIdx, shownStrokes, stack: actionStack.length };
    writer = originalWriter;
    return { stacked, peekOffer, afterStroke, afterHint, empty, rewritten, replayUse, newUse, duringPlayback, afterPlayback, afterInterrupt };
  });
  assert(handwritingBoundaries.stacked === "stroke,hint,stroke"
    && handwritingBoundaries.peekOffer.copy.includes("按住「看一眼」") && !handwritingBoundaries.peekOffer.consumed && handwritingBoundaries.peekOffer.consequenceShown && !handwritingBoundaries.peekOffer.title
    && handwritingBoundaries.afterStroke.ink === 1 && handwritingBoundaries.afterStroke.stack === "stroke,hint"
    && handwritingBoundaries.afterHint.ink === 1 && handwritingBoundaries.afterHint.groupIdx === 0 && handwritingBoundaries.afterHint.shownStrokes === 0 && handwritingBoundaries.afterHint.stack === "stroke" && !handwritingBoundaries.afterHint.tipDisabled
    && handwritingBoundaries.empty.ink === 0 && handwritingBoundaries.empty.stack === 0 && handwritingBoundaries.empty.undoDisabled,
  "Expected stroke/hint/stroke undo ordering and hint-layer rollback", handwritingBoundaries);
  assert(handwritingBoundaries.rewritten.ink === 0 && handwritingBoundaries.rewritten.groupIdx === 0 && handwritingBoundaries.rewritten.shownStrokes === 0 && handwritingBoundaries.rewritten.stack === 0 && !handwritingBoundaries.rewritten.tipDisabled
    && handwritingBoundaries.rewritten.firstUse === 1 && handwritingBoundaries.replayUse === 1 && handwritingBoundaries.newUse === 2,
  "Expected rewrite to reset visual state without double-counting replayed hint groups", handwritingBoundaries);
  assert(handwritingBoundaries.duringPlayback.animating && handwritingBoundaries.duringPlayback.opacity === 0.22 && handwritingBoundaries.duringPlayback.doneDisabled && handwritingBoundaries.duringPlayback.showDisabled && handwritingBoundaries.duringPlayback.revealRejected
    && !handwritingBoundaries.afterPlayback.animating && handwritingBoundaries.afterPlayback.opacity === 1 && handwritingBoundaries.afterPlayback.stack === "hint"
    && !handwritingBoundaries.afterInterrupt.animating && handwritingBoundaries.afterInterrupt.opacity === 1 && handwritingBoundaries.afterInterrupt.ink === 0 && handwritingBoundaries.afterInterrupt.groupIdx === 0 && handwritingBoundaries.afterInterrupt.shownStrokes === 0 && handwritingBoundaries.afterInterrupt.stack === 0,
  "Expected hint playback opacity/submission lock and rewrite cancellation", handwritingBoundaries);

  await page.evaluate(() => render());
  await waitForWriter(page);
  await page.waitForFunction(() => !peekInk.disabled && peekEl && peekEl.querySelector("path"));
  const peekBoundary = await page.evaluate(() => {
    const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const pointer = (type, id, primary, x, y, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: primary, button: 0, buttons, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y });
    const pixels = () => { const data = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1; return count; };
    clearInk(); activePointers.clear(); peekReleasePending = false; tracing = false; revealed = false; animating = false; tuning.peekHintUsed = false; saveTuning();
    const before = { ever: hintEverUsed, used: hintsUsedThisCard, group: groupIdx, shown: shownStrokes };
    const peekRect = peekInk.getBoundingClientRect();
    const controlPointer = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 81050, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: peekRect.left + 20, clientY: peekRect.top + 20 });
    peekInk.dispatchEvent(controlPointer("pointerdown", 1));
    const controlEntered = peeking && peekEl.classList.contains("active") && peekEl.querySelectorAll("path").length > 0 && Number(canvas.style.opacity) <= 0.06;
    const consumedOnUse = tuning.peekHintUsed === true;
    peekInk.dispatchEvent(controlPointer("pointerup", 0));
    const controlRestored = !peeking && !peekEl.classList.contains("active") && Number(canvas.style.opacity) === 1;
    const uncounted = before.ever === hintEverUsed && before.used === hintsUsedThisCard && before.group === groupIdx && before.shown === shownStrokes;
    canvas.dispatchEvent(pointer("pointerdown", 81051, true, 0.2, 0.25, 1));
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.45, 0.5, 1));
    const partial = pixels();
    canvas.dispatchEvent(pointer("pointerdown", 81052, false, 0.75, 0.7, 1));
    const entered = peeking && Number(canvas.style.opacity) <= 0.06 && hzEl.classList.contains("peekHint");
    const cancelled = partial > 0 && !drawing && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.65, 0.65, 1));
    canvas.dispatchEvent(pointer("pointermove", 81052, false, 0.8, 0.8, 1));
    const blocked = inkStrokes.length === 0 && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointerup", 81052, false, 0.8, 0.8, 0));
    const restoredOnAnyLift = !peeking && peekReleasePending && Number(canvas.style.opacity) === 1 && !hzEl.classList.contains("peekHint");
    canvas.dispatchEvent(pointer("pointermove", 81051, true, 0.72, 0.72, 1));
    const releaseBlocked = !drawing && inkStrokes.length === 0 && curInkStroke === null && pixels() === 0;
    canvas.dispatchEvent(pointer("pointerup", 81051, true, 0.72, 0.72, 0));
    const ended = !peekReleasePending && activePointers.size === 0;
    canvas.dispatchEvent(pointer("pointerdown", 81053, true, 0.25, 0.25, 1));
    canvas.dispatchEvent(pointer("pointermove", 81053, true, 0.55, 0.55, 1));
    canvas.dispatchEvent(pointer("pointerup", 81053, true, 0.55, 0.55, 0));
    const nextGestureWrites = inkStrokes.length === 1 && pixels() > 0;
    clearInk(); resetPeekHint(); actionCooldownUntil = 0;
    return { controlEntered, consumedOnUse, controlRestored, uncounted, entered, cancelled, blocked, restoredOnAnyLift, releaseBlocked, ended, nextGestureWrites };
  });
  assert(Object.values(peekBoundary).every(Boolean), "Expected complete two-finger peek lifecycle without leaked ink", peekBoundary);

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
  assert(hold.sameTarget === firstTarget && hold.feedback.includes("本组稍后再写") && hold.outcome === "hinted" && hold.ratings.join() === "Again" && hold.unresolved.length === 1, "Expected 1.4s hinted feedback with one Again", hold);

  await page.click("#editStamp");
  const rollback = await page.evaluate(() => ({ phase: practicePhase, events: fsrsReviewLog.length, stats: roundStats.length, attempts: dailyActivity().attempts, stamps: dailyActivity().stamps, queue: reinforcementQueue.length, unresolved: unresolved.size, image: submissionSnapshot.compositeImage }));
  assert(rollback.phase === "revealDecision" && rollback.events === 0 && rollback.stats === 0 && rollback.attempts === 0 && rollback.stamps === 0 && rollback.queue === 0 && rollback.unresolved === 0 && rollback.image, "Expected atomic edit rollback", rollback);

  await chooseCorrect(page);
  await page.evaluate(() => {
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await waitForWriter(page);
  const afterHint = await page.evaluate(() => ({ baseCursor, attemptSeq, unresolved: [...unresolved], queue: cloneObj(reinforcementQueue), target: cur.target }));
  assert(afterHint.baseCursor === 1 && afterHint.attemptSeq === 1 && afterHint.unresolved.length === 1 && afterHint.queue[0].eligibleAfter === 3 && afterHint.target !== firstTarget, "Expected feedback click to advance immediately while a double click cannot cross two cards", afterHint);

  const undoLayout = await page.evaluate(() => {
    renderUndoBar();
    const snapshot = lastStampSnapshot; const canvas = inkCanvas; const rect = canvas.getBoundingClientRect();
    const beforeTop = boxwrap.getBoundingClientRect().top; const style = getComputedStyle(undoBar), header = document.querySelector(".chdr");
    const headerReplaced = getComputedStyle(header).visibility === "hidden" && card.classList.contains("undoActive");
    const pointer = (type, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 82001, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: rect.left + 30, clientY: rect.top + 30 });
    canvas.dispatchEvent(pointer("pointerdown", 1)); canvas.dispatchEvent(pointer("pointerup", 0));
    const hiddenOnWrite = getComputedStyle(undoBar).display === "none" && getComputedStyle(header).visibility === "visible" && !card.classList.contains("undoActive");
    const afterTop = boxwrap.getBoundingClientRect().top;
    clearInk(); actionCooldownUntil = 0; lastStampSnapshot = snapshot; renderUndoBar();
    const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    const noOverlap = bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right;
    return { position: style.position, headerReplaced, hiddenOnWrite, shift: Math.abs(afterTop - beforeTop), restored: getComputedStyle(undoBar).display !== "none" && getComputedStyle(header).visibility === "hidden", noOverlap };
  });
  await page.setViewportSize({ width: 390, height: 620 });
  const undoShortLayout = await page.evaluate(() => {
    renderUndoBar(); const bar = undoBar.getBoundingClientRect(); const promptRect = document.getElementById("prompt").getBoundingClientRect();
    return { visible: getComputedStyle(undoBar).display !== "none", noOverlap: bar.bottom <= promptRect.top || bar.top >= promptRect.bottom || bar.right <= promptRect.left || bar.left >= promptRect.right, top: bar.top, bottom: bar.bottom };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(undoLayout.position === "absolute" && undoLayout.headerReplaced && undoLayout.hiddenOnWrite && undoLayout.shift <= 0.5 && undoLayout.restored && undoLayout.noOverlap && undoShortLayout.visible && undoShortLayout.noOverlap, "Expected cross-card undo bar to replace the header without shifting or overlapping short screens", { undoLayout, undoShortLayout });

  for (let i = 0; i < 2; i += 1) {
    await submitStandard(page);
    await chooseCorrect(page);
    await page.waitForTimeout(1900);
  }
  const reinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, baseCursor, attemptSeq, unresolved: [...unresolved], progress: posLabel.textContent, targets: baseTargets.slice(), stats: roundStats.map((row) => row.idx) }));
  assert(reinforcement.target === firstTarget && reinforcement.kind === "reinforcement" && reinforcement.baseCursor === 3 && reinforcement.attemptSeq === 3 && reinforcement.progress === "还要再练 1", "Expected two-card spacing and plain-language reinforcement progress", reinforcement);

  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await waitForWriter(page);
  const restoredReinforcement = await page.evaluate(() => ({ target: cur.target, kind: currentAttemptKind, phase: practicePhase, unresolved: unresolved.size }));
  assert(restoredReinforcement.target === firstTarget && restoredReinforcement.kind === "reinforcement" && restoredReinforcement.phase === "reinforcement" && restoredReinforcement.unresolved === 1, "Expected reinforcement state to survive session restore", restoredReinforcement);

  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
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
  assert(completed.summary && completed.stats.length === 3 && completed.stats[0].outcome === "hinted" && completed.stats[0].independentlyRecovered && completed.stats.some((row) => row.handwriting && row.handwriting.length) && completed.stats.flatMap((row) => row.handwriting || []).every((stroke) => stroke.length <= 48), "Expected one summary tile per base target with compact captured user ink", completed.stats);
  assert(completed.log.map((event) => event.rating).join() === "Again,Good,Good,Good" && completed.log.every((event) => !["Hard", "Easy"].includes(event.rating)), "Expected Again/Good-only FSRS events", completed.log);
  assert(completed.activity.stamps === 3 && completed.activity.attempts === 4 && completed.groups === 1 && completed.session === null, "Expected unique-day counts, attempt counts, and true completion", completed.activity);
  assert(Object.values(completed.memory).every((item) => !item.pendingLearning && item.dueDay >= completed.tomorrow && item.schedulerVersion.includes("FSRS-6.0")), "Expected graduated cards to expose next-day-or-later dueDay", completed.memory);

  const summaryEntry = await page.evaluate(() => ({ visible: getComputedStyle(summaryProfile).display !== "none", label: summaryProfile.textContent.trim() }));
  assert(summaryEntry.visible && summaryEntry.label.includes("看看你卡在哪"), "Expected a hard-result summary to expose Profile", summaryEntry);
  const sharePaths = await page.evaluate(async () => {
    const messages = [], downloads = [], shared = [];
    const canvas = renderPracticeCardCanvas(), native = await sharePracticeCard({ nativeBridge: { postMessage: (message) => messages.push(message) } });
    const web = await sharePracticeCard({ nativeBridge: null, navigator: { canShare: ({ files }) => files.length === 1 && files[0].type === "image/png", share: async (payload) => shared.push(payload) } });
    const download = await sharePracticeCard({ nativeBridge: null, navigator: {}, download: (blob, name) => downloads.push({ size: blob.size, name }) });
    const rendererSource = `${renderPracticeCardCanvas}\n${drawShareHandwriting}`;
    return { canvas: canvas && { width: canvas.width, height: canvas.height, png: canvas.toDataURL("image/png").startsWith("data:image/png;base64,"), pixels: canvas.toDataURL("image/png").length, inkStrokes: Number(canvas.dataset.inkStrokeCount) }, native, web, download, messageKeys: messages[0] && Object.keys(messages[0]).sort(), messageType: messages[0] && messages[0].type, messagePNG: messages[0] && messages[0].dataURL.startsWith("data:image/png;base64,"), shared: shared.length, downloaded: downloads[0], privateFree: !/localStorage|memory|activity|backup|seenStat|riskStat/.test(rendererSource), printedTargetFree: !/fillText\s*\(\s*stat\.target/.test(rendererSource), shareVisible: getComputedStyle(summaryShare).display !== "none", shareLabel: summaryShare.textContent.trim() };
  });
  assert(sharePaths.canvas.width === 1080 && sharePaths.canvas.height === 1440 && sharePaths.canvas.png && sharePaths.canvas.pixels > 10000 && sharePaths.canvas.inkStrokes > 0 && sharePaths.native.route === "native" && sharePaths.web.route === "share" && sharePaths.download.route === "download"
    && sharePaths.messageKeys.join() === "dataURL,name,type" && sharePaths.messageType === "sharePracticeCard" && sharePaths.messagePNG && sharePaths.shared === 1 && sharePaths.downloaded.size > 1000 && sharePaths.downloaded.name.endsWith(".png") && sharePaths.privateFree && sharePaths.printedTargetFree && sharePaths.shareVisible && sharePaths.shareLabel.includes("存为"),
  "Expected a private-free user-ink PNG card and native, Web Share, and download delivery paths", sharePaths);
  const expandedShareCard = await page.evaluate(() => {
    const savedStats = cloneObj(roundStats), originalFillText = CanvasRenderingContext2D.prototype.fillText, labels = [];
    try {
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { labels.push(String(text)); return originalFillText.call(this, text, ...args); };
      roundStats = Array.from({ length: 16 }, (_, idx) => ({ idx, target: CARDS[idx].target, outcome: idx % 3 === 0 ? "hinted" : "fast", independentlyRecovered: false,
        handwriting: [[{ x: .12 + idx * .002, y: .18 }, { x: .82, y: .78 - idx * .002 }]] }));
      const canvas = renderPracticeCardCanvas(), rendererSource = `${renderPracticeCardCanvas}`;
      return { width: canvas.width, height: canvas.height, items: Number(canvas.dataset.itemCount), inkStrokes: Number(canvas.dataset.inkStrokeCount), labels,
        png: canvas.toDataURL("image/png").startsWith("data:image/png;base64,"), noFifteenItemCutoff: !/slice\(0,\s*15\)/.test(rendererSource) };
    } finally {
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
      roundStats = savedStats;
    }
  });
  assert(expandedShareCard.width === 1080 && expandedShareCard.height === 1618 && expandedShareCard.items === 16 && expandedShareCard.inkStrokes === 16 && expandedShareCard.labels.includes("本组 16 个字") && expandedShareCard.png && expandedShareCard.noFifteenItemCutoff,
    "Expected an expanded practice card to render every item and handwriting stroke beyond the standard 15-character group", expandedShareCard);
  await page.click("#summaryProfile");
  await page.waitForFunction(() => getComputedStyle(profilePanel).display !== "none");
  await page.click("#closeProfile");
  assert(await page.evaluate(() => getComputedStyle(summary).display !== "none" && getComputedStyle(sumSheet).display !== "none"), "Expected Profile to return to its Summary source");

  const summaryLayer = await page.evaluate(() => ({
    targets: Array.from(document.querySelectorAll("#sumTiles .sumTile[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    tiles: document.querySelectorAll("#sumTiles .sumTile[data-idx]").length,
    lead: sumLead.textContent.replace(/\s+/g, ""),
    meanings: Array.from(document.querySelectorAll("#sumTiles .sumTile .meaning")).map((node) => ({ text: node.textContent, visible: getComputedStyle(node).display !== "none", size: parseFloat(getComputedStyle(node).fontSize) })),
    milestoneEvents: hapticDebug.events.slice(-3),
  }));
  await page.click("#stop");
  await page.waitForFunction(() => getComputedStyle(home).display !== "none");
  const homeLayer = await page.evaluate(() => ({
    title: homeTitle.textContent.replace(/\s+/g, ""),
    label: yesterLbl.textContent,
    targets: Array.from(document.querySelectorAll("#yesterRow .yTile:not(.more)")).map((node) => node.textContent.trim()).filter(Boolean).sort(),
    completed: todayCompleted(),
  }));
  await page.click("#tabBook");
  await page.waitForFunction(() => getComputedStyle(studybook).display !== "none");
  if (await page.evaluate(() => boxAllSection.offsetParent === null)) await page.click("#boxAllToggle");
  const bookLayer = await page.evaluate(() => ({
    count: boxCount.textContent.replace(/\s+/g, ""),
    targets: Array.from(document.querySelectorAll("#boxGrid .boxTile[data-idx]")).map((node) => CARDS[Number(node.dataset.idx)].target).sort(),
    active: tabBook.classList.contains("active"),
  }));
  assert(summaryLayer.tiles === 3 && summaryLayer.lead.includes("3") && summaryLayer.meanings.length === 3 && summaryLayer.meanings.every((item) => item.visible && item.text.length >= 2 && item.size >= 13) && homeLayer.title.includes("今日已拾3个字") && homeLayer.label === "今日拾得" && homeLayer.completed && bookLayer.count.includes("练过3字") && bookLayer.active
    && summaryLayer.targets.join() === homeLayer.targets.join() && summaryLayer.targets.every((target) => bookLayer.targets.includes(target)),
  "Expected the same completed targets across summary, home recent, and study-book layers", { summaryLayer, homeLayer, bookLayer });

  await page.evaluate(() => { displayView("summary"); renderPracticePocket(summaryFocusIndexes, false); });
  const pocketBefore = await page.evaluate(() => ({ visible: getComputedStyle(pocketCard).display === "flex", indexes: summaryFocusIndexes.slice(), chips: Array.from(pocketChips.children).map((node) => node.textContent), title: pocketTitle.textContent }));
  assert(pocketBefore.visible && pocketBefore.indexes.length === 1 && pocketBefore.chips.length === 1 && pocketBefore.title.includes("趁热再拾"), "Expected a difficult-result pocket with the weak target", pocketBefore);
  await page.click("#pocketBtn");
  await page.waitForFunction(() => activeMode === "focus" && getComputedStyle(card).display !== "none");
  const pocketPractice = await page.evaluate(() => ({ mode: activeMode, target: cur.target, expected: CARDS[summaryFocusIndexes[0]].target, batch: baseTargets.slice() }));
  assert(pocketPractice.mode === "focus" && pocketPractice.target === pocketPractice.expected && pocketPractice.batch.length === 1, "Expected the pocket action to enter focused practice for the weak target", pocketPractice);

  await page.evaluate(() => { exitCurrentRound(); clearSessionSnapshot(); traceTutorialShown = false; save(TRACE_TUTORIAL_KEY, false); startFocus([CARDS.findIndex((card) => card.target === "器")]); });
  await waitForWriter(page);
  await page.evaluate(() => { episodeFor(currentCardIndex()).teachingComplete = true; hapticDebug.events = []; hapticDebug.last = null; });
  await page.click("#show");
  await page.waitForFunction(() => practicePhase === "tracing");
  await page.waitForFunction(() => hzEl.classList.contains("traceFallback") || Array.from(hzEl.querySelectorAll("svg path")).some((node) => { const box=node.getBoundingClientRect(); return box.width>0 && box.height>0; }));
  const dontKnow = await page.evaluate(() => { declareDontKnow(); return ({
    phase: practicePhase, outcome: roundStats[0].outcome,
    ratings: fsrsReviewLog.slice(-1).map((event) => `${event.rating}:${event.reason}:${event.teaching}`),
    revealHidden: getComputedStyle(reveal).display === "none", stampHidden: getComputedStyle(stampedToast).display === "none",
    title: phaseTitle.textContent, intro: getComputedStyle(traceIntro).display !== "none", introCopy: traceIntro.textContent,
    traceTools: Array.from(document.querySelectorAll("#inkTools button, #traceActions button")).filter((node) => getComputedStyle(node).display !== "none").map((node) => node.textContent.replace(/\s+/g, "")),
    noRecallTools: getComputedStyle(tip).display === "none" && getComputedStyle(show).display === "none",
    outlinePaths: Array.from(hzEl.querySelectorAll("svg path")).filter((node) => { const box=node.getBoundingClientRect(), style=getComputedStyle(node); return box.width>0 && box.height>0 && style.display!=="none" && style.visibility!=="hidden"; }).length,
    outlineBox: (()=>{ const svg=hzEl.querySelector("svg"); if(!svg) return null; const box=svg.getBoundingClientRect(); return {width:Math.round(box.width),height:Math.round(box.height)}; })(),
    fallback: hzEl.classList.contains("traceFallback") && hzEl.textContent.trim() === cur.target,
    haptics: hapticDebug.events.slice(), shown: traceTutorialShown, attempts: episodeFor(currentCardIndex()).attempts.length, unresolved: unresolved.size,
  }); });
  assert(dontKnow.phase === "tracing" && dontKnow.outcome === "miss" && dontKnow.ratings.join() === "Again:dontKnow:true" && dontKnow.revealHidden && dontKnow.stampHidden
    && dontKnow.title.includes("1/2 描写") && dontKnow.intro && dontKnow.introCopy.includes("接着答案会隐藏") && dontKnow.noRecallTools
    && (dontKnow.outlinePaths>0 || dontKnow.fallback) && (!dontKnow.outlineBox || (dontKnow.outlineBox.width>200 && dontKnow.outlineBox.height>200))
    && dontKnow.haptics.join() === "select" && !dontKnow.shown && dontKnow.attempts === 1 && dontKnow.unresolved === 1,
  "Expected don't-know to enter non-blocking tracing immediately with one miss/Again", dontKnow);
  await page.evaluate(() => { soundDebug.events = []; soundDebug.last = null; lastPaperSoundAt = 0; inkBegin({ x: 20, y: 20 }); inkMove({ x: 80, y: 80 }); inkEnd(); });
  const traceStart = await page.evaluate(() => ({ title: phaseTitle.textContent, disabled: traceDone.disabled, introHidden: getComputedStyle(traceIntro).display === "none", shown: traceTutorialShown, stored: load(TRACE_TUTORIAL_KEY, false), sound: soundDebug.events.slice() }));
  assert(traceStart.title.includes("1/2 描写") && !traceStart.disabled && traceStart.introHidden && traceStart.shown && traceStart.stored && traceStart.sound.join() === "paper", "Expected first valid trace to dismiss the explanation and emit only the quiet paper-start sound", traceStart);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "tracing" && tracedThisCard && inkStrokes.length === 1);
  const restoredTracing = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, outline: hzEl.childNodes.length > 0 || hzEl.classList.contains("traceFallback"), ink: inkStrokes.length }));
  assert(restoredTracing.phase === "tracing" && restoredTracing.title.includes("1/2 描写") && restoredTracing.outline && restoredTracing.ink === 1, "Expected tracing ink and outline to survive session restore", restoredTracing);
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await page.click("#traceDone");
  const postTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled, tipDisplay: getComputedStyle(tip).display, show: show.textContent, clear: clear.textContent, haptics: hapticDebug.events.slice() }));
  assert(postTrace.phase === "postTraceRecall" && postTrace.title.includes("2/2 自己写") && postTrace.ink === 0 && !postTrace.hintLayer && !postTrace.fallback && postTrace.tipDisabled && postTrace.tipDisplay === "none" && postTrace.show === "再描一遍" && postTrace.clear === "重写" && postTrace.haptics.length === 0, "Expected outline-free step-two recall with only its own tools", postTrace);
  await page.evaluate(() => { saveSessionSnapshot(); restoreSession(load(SESSION_KEY, null)); });
  await page.waitForFunction(() => pendingSessionVisual === null && practicePhase === "postTraceRecall");
  const restoredPostTrace = await page.evaluate(() => ({ phase: practicePhase, title: phaseTitle.textContent, ink: inkStrokes.length, hintLayer: hzEl.textContent, fallback: hzEl.classList.contains("traceFallback"), tipDisabled: tip.disabled }));
  assert(restoredPostTrace.phase === "postTraceRecall" && restoredPostTrace.title.includes("2/2 自己写") && restoredPostTrace.ink === 0 && !restoredPostTrace.hintLayer && !restoredPostTrace.fallback && restoredPostTrace.tipDisabled, "Expected post-trace recall to restore without teaching geometry", restoredPostTrace);

  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await submitStandard(page);
  await page.click("#decisionWrong");
  await page.waitForFunction(() => practicePhase === "tracing");
  const teachingWrong = await page.evaluate(() => ({ events: fsrsReviewLog.filter((event) => event.attemptId === currentAttemptId).length, attempts: episodeFor(currentCardIndex()).attempts.length, haptics: hapticDebug.events.slice() }));
  assert(teachingWrong.events === 1 && teachingWrong.attempts === 1 && teachingWrong.haptics.join() === "action", "Expected teaching retry not to create another review or stamp haptic", teachingWrong);
  await page.evaluate(() => { inkStrokes = [mediansToCanvas(curMedians)[0]]; tracedThisCard = true; redrawInk(); updateInkControls(); });
  await page.click("#traceDone");
  await page.evaluate(() => { hapticDebug.events = []; hapticDebug.last = null; });
  await submitStandard(page);
  await page.click("#decisionCorrect");
  const teachingDecisionHaptics = await page.evaluate(() => hapticDebug.events.slice());
  assert(teachingDecisionHaptics.join() === "action", "Expected post-trace success to emit action only, never action plus stamp", teachingDecisionHaptics);
  await page.waitForTimeout(1900);
  const afterTeaching = await page.evaluate(() => ({ kind: currentAttemptKind, phase: practicePhase, ratings: fsrsReviewLog.slice(-1).map((event) => event.rating), teachingComplete: Object.values(episodes)[0].teachingComplete, unresolved: unresolved.size }));
  assert(afterTeaching.kind === "reinforcement" && afterTeaching.phase === "reinforcement" && afterTeaching.ratings.join() === "Again" && afterTeaching.teachingComplete && afterTeaching.unresolved === 1, "Expected post-trace success to remain unresolved without Good", afterTeaching);
  await submitStandard(page);
  await chooseCorrect(page);
  await page.waitForTimeout(1900);
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

  const historyStart = await page.evaluate(() => ({ length: history.length, state: history.state && history.state.shiziView }));
  await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value){ if(key === SESSION_KEY) throw new Error("verify quota"); return window.__originalSetItem.call(this, key, value); }; });
  await page.click("#exitPractice");
  const failedExit = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), message: document.getElementById("toast").textContent, armed: practiceHistoryArmed }));
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; delete window.__originalSetItem; });
  assert(failedExit.card && failedExit.phase === "revealDecision" && failedExit.frozen === frozenBefore && failedExit.message.includes("未能保存进度") && failedExit.armed, "Expected persistence failure to keep the exact practice state with a retry message", failedExit);

  await page.click("#addInPractice");
  await page.waitForFunction(() => addSheet.classList.contains("open"));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !addSheet.classList.contains("open") && history.state && history.state.shiziView === "practice");
  const panelBack = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", phase: practicePhase, frozen: JSON.stringify(submissionSnapshot), length: history.length }));
  assert(panelBack.card && panelBack.phase === "revealDecision" && panelBack.frozen === frozenBefore && panelBack.length === historyStart.length, "Expected back to close the add-character panel before leaving practice", panelBack);

  await page.evaluate(() => roundBudgetSheet.classList.add("open"));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !roundBudgetSheet.classList.contains("open") && history.state && history.state.shiziView === "practice");
  const budgetBack = await page.evaluate(() => ({ card: getComputedStyle(card).display !== "none", armed: practiceHistoryArmed, length: history.length }));
  assert(budgetBack.card && budgetBack.armed && budgetBack.length === historyStart.length, "Expected back to close the rhythm guard without disarming practice history", budgetBack);

  const directReturns = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate((nativeEvent) => nativeEvent ? window.dispatchEvent(new Event("shizi-native-back")) : history.back(), attempt === 0);
    await page.waitForFunction(() => getComputedStyle(home).display !== "none" && !practiceHistoryArmed && history.state && history.state.shiziView === "home");
    directReturns.push(await page.evaluate((nativeEvent) => ({ nativeEvent, session: load(SESSION_KEY, null), history: history.state && history.state.shiziView, length: history.length, toast: document.getElementById("toast").textContent }), attempt === 0));
    if (attempt < 2) {
      await page.click("#startBtn");
      await page.waitForFunction(() => getComputedStyle(reveal).display !== "none" && practiceHistoryArmed);
      const resumedAgain = await page.evaluate(() => ({ phase: practicePhase, frozen: JSON.stringify(submissionSnapshot) }));
      assert(resumedAgain.phase === "revealDecision" && resumedAgain.frozen === frozenBefore, "Expected direct return to resume the same reveal state", resumedAgain);
    }
  }
  const exited = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", session: load(SESSION_KEY, null), armed: practiceHistoryArmed, history: history.state && history.state.shiziView, length: history.length }));
  await page.evaluate(() => history.back());
  await page.waitForTimeout(100);
  const homeBack = await page.evaluate(() => ({ home: getComputedStyle(home).display !== "none", armed: practiceHistoryArmed, history: history.state && history.state.shiziView, length: history.length }));
  assert(directReturns[0].nativeEvent && directReturns.every((row) => row.session && row.session.version === 2 && row.history === "home" && row.length === historyStart.length && !row.toast.includes("进度已保存"))
    && exited.home && exited.session && exited.session.version === 2 && !exited.armed && exited.history === "home" && exited.length === historyStart.length
    && homeBack.home && !homeBack.armed && homeBack.history === "home" && homeBack.length === historyStart.length,
  "Expected repeated direct returns to save v2 state without dialogs, toasts, or history growth", { exited, directReturns, homeBack });

  const collections = await page.evaluate(async () => {
    const saved = {
      activity: cloneObj(activity), memory: cloneObj(memory), fsrs: cloneObj(fsrsReviewLog), session: localStorage.getItem(SESSION_KEY),
      activeMode, makeupTargetDay, baseTargets: baseTargets.slice(), baseCursor, currentIndex, currentAttemptKind, currentAttemptId, practicePhase,
      manualQueue: cloneObj(manualQueue), reinforcementQueue: cloneObj(reinforcementQueue), unresolved: [...unresolved], episodes: cloneObj(episodes), roundStats: cloneObj(roundStats), roundId,
    };
    clearSessionSnapshot();
    const targets = uniqueCardIndexes(allIndexes().filter((idx) => qualityAvailable(idx) && !CARDS[idx].custom)).slice(0, 5);
    const normalDay = shiftDay(today(), -1), makeupDay = shiftDay(today(), -2), untouchedDay = shiftDay(today(), -3), currentMonth = today().slice(0, 7);
    activity = normalizeActivity({ version: 1, migrationDate: today(), inheritedStreak: 0, inheritedTotalDays: 0, practiceDays: [normalDay, today()], daily: {} });
    const normal = dailyActivity(normalDay); normal.stamps = 1; normal.attempts = 1; normal.targetKeys = [cardKey(targets[0])]; normal.independentTargetKeys = [cardKey(targets[0])]; normal.lastStampAt = dayStartMs(normalDay) + 20 * 3600000;
    const current = dailyActivity(today()); current.stamps = targets.length; current.attempts = targets.length; current.targetKeys = targets.map(cardKey); current.independentTargetKeys = targets.slice(0, 3).map(cardKey); current.lastStampAt = Date.now(); saveActivity();

    calendarAnimatedMonths.clear(); openCalendar(currentMonth);
    const before = {
      normal: calendarGrid.querySelector(`[data-day="${normalDay}"]`)?.textContent || "",
      makeupBlank: !!calendarGrid.querySelector(`[data-day="${makeupDay}"][data-makeup]`),
      untouchedBlank: !!calendarGrid.querySelector(`[data-day="${untouchedDay}"][data-makeup]`),
      month: calendarMonthTitle.textContent, stat: calendarMonthStat.textContent, nextDisabled: calendarNext.disabled, gridHeight: calendarGrid.getBoundingClientRect().height,
    };

    activeMode = "makeup"; makeupTargetDay = makeupDay; focusQueue = targets.slice(); baseTargets = targets.slice(); batch = baseTargets; baseCursor = targets.length - 1; currentIndex = targets[targets.length - 1]; currentAttemptKind = "base"; currentAttemptId = "verify-makeup-incomplete"; practicePhase = "between"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = targets.slice(0, 4).map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true })); roundId = "verify-makeup-round";
    const incomplete = markRoundComplete(), blankStayedBlank = !activity.practiceDays.includes(makeupDay) && !dailyActivity(makeupDay).makeup;
    baseCursor = targets.length; roundStats = targets.map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true }));
    const completed = markRoundComplete(), completedAgain = markRoundComplete(), past = dailyActivity(makeupDay), makeupMarkers = past.completedRoundIds.filter((id) => id === "makeup:verify-makeup-round").length;

    calendarAnimatedMonths.delete(currentMonth); renderCalendar();
    const after = { makeup: calendarGrid.querySelector(`[data-day="${makeupDay}"]`)?.textContent || "", normal: calendarGrid.querySelector(`[data-day="${normalDay}"]`)?.textContent || "", practiceDays: monthPracticeDays(today()), markers: makeupMarkers };
    const originalMatchMedia = window.matchMedia; window.matchMedia = () => ({ matches: true }); calendarAnimatedMonths.delete(currentMonth); renderCalendar(); const reducedDirect = !calendarGrid.querySelector(".calendarStamp.land"); window.matchMedia = originalMatchMedia;
    calendarMonthKey = shiftMonth(currentMonth, -1); renderCalendar(); const previousMonth = { title: calendarMonthTitle.textContent, nextEnabled: !calendarNext.disabled }; calendarMonthKey = currentMonth;

    activeMode = "makeup"; makeupTargetDay = makeupDay; baseTargets = targets.slice(); batch = baseTargets; baseCursor = 2; currentIndex = targets[2]; currentAttemptKind = "base"; currentAttemptId = "verify-makeup-session"; practicePhase = "recall"; manualQueue = []; reinforcementQueue = []; unresolved = new Set(); episodes = {}; roundStats = targets.slice(0, 2).map((idx) => ({ idx, target: CARDS[idx].target, outcome: "fast", independentlyRecovered: true })); roundId = "verify-makeup-session-round"; attemptSeq = 2; sessionDone = new Set(targets.slice(0, 2)); saveSessionSnapshot();
    const resume = resumableSession(), sessionOK = resume && resume.activeMode === "makeup" && resume.makeupTargetDay === makeupDay && resume.baseTargets.length === 5; clearSessionSnapshot();

    memory = {}; targets.forEach((idx, i) => { const m = cardMemory(idx); m.seen = 1; m.last = Date.now() - i * 1000; m.fast = 1; m.target = CARDS[idx].target; m.word = CARDS[idx].word; });
    const inkStored = persistRecentInk(cardMemory(targets[0]), [[{ x: .2, y: .2 }, { x: .5, y: .75 }, { x: .8, y: .25 }]], Date.now() + 100000);
    for (let i = 0; i < 110; i += 1) memory[`verify:ink:${i}`] = { seen: 0, recentInk: { version: 1, day: today(), at: Date.now() - i, dataURL: `data:image/webp;base64,${"A".repeat(5000)}` } };
    const trimmed = trimRecentInk(), inkRows = recentInkRows(), cap = { kept: inkRows.length, bytes: inkRows.reduce((sum, row) => sum + row.bytes, 0), removed: trimmed.removed, realKept: !!cardMemory(targets[0]).recentInk };
    saveMemory();

    const monthly = monthReportData(currentMonth), canvas = await renderMonthlyPostCanvas(currentMonth); let nativeMessage = null; const share = await shareMonthlyPost({ month: currentMonth, nativeBridge: { postMessage: (message) => { nativeMessage = message; } } });
    const annual = yearReportData(new Date().getFullYear()); renderAnnualReport(new Date().getFullYear()); const firstAnnualSlide = annualSlides.querySelector(".annualSlide"), annualUI = { slides: annualSlides.querySelectorAll(".annualSlide").length, copy: annualSlides.textContent.replace(/\s+/g, ""), clientHeight: annualSlides.clientHeight, scrollHeight: annualSlides.scrollHeight, firstHeight: firstAnnualSlide?.getBoundingClientRect().height || 0 };
    const backupActivity = JSON.parse(JSON.parse(backupPayload({ preserveMeta: true })).data[ACTIVITY_KEY]);
    const report = {
      before, incomplete, blankStayedBlank, completed, completedAgain, after, reducedDirect, previousMonth, sessionOK,
      makeup: { flag: past.makeup, targets: past.targetKeys.length, independent: past.independentTargetKeys.length, backup: backupActivity.daily[makeupDay]?.makeup === true },
      inkStored, cap, monthly: { practiced: monthly.practiced, stable: monthly.stable, independent: monthly.independentCount, days: monthly.practiceDays, hardest: monthly.hardest, width: canvas.width, height: canvas.height, items: Number(canvas.dataset.itemCount), inkTiles: Number(canvas.dataset.inkTiles) },
      share: { ...share, type: nativeMessage?.type, kind: nativeMessage?.kind, hasPNG: /^data:image\/png;base64,/.test(nativeMessage?.dataURL || "") }, annual: { ...annual, ...annualUI },
    };

    activity = normalizeActivity(saved.activity); saveActivity(); memory = saved.memory; saveMemory(); fsrsReviewLog = saved.fsrs; saveFSRSLog();
    if (saved.session === null) clearSessionSnapshot(); else localStorage.setItem(SESSION_KEY, saved.session);
    activeMode = saved.activeMode; makeupTargetDay = saved.makeupTargetDay; baseTargets = saved.baseTargets; batch = baseTargets; baseCursor = saved.baseCursor; currentIndex = saved.currentIndex; currentAttemptKind = saved.currentAttemptKind; currentAttemptId = saved.currentAttemptId; practicePhase = saved.practicePhase; manualQueue = saved.manualQueue || []; reinforcementQueue = saved.reinforcementQueue || []; unresolved = new Set(saved.unresolved || []); episodes = saved.episodes || {}; roundStats = saved.roundStats || []; roundId = saved.roundId; renderHome();
    return report;
  });
  assert(collections.before.normal.includes("拾") && collections.before.makeupBlank && collections.before.untouchedBlank && collections.before.stat.includes("本月拾字 2 天") && collections.before.nextDisabled && collections.before.gridHeight < 360 && collections.previousMonth.nextEnabled,
    "Expected normal/blank calendar states and cross-month navigation", collections);
  assert(!collections.incomplete && collections.blankStayedBlank && collections.completed && collections.completedAgain && collections.makeup.flag && collections.makeup.targets === 5 && collections.makeup.independent === 5 && collections.after.makeup.includes("补") && collections.after.normal.includes("拾") && collections.after.markers === 1 && collections.reducedDirect && collections.sessionOK,
    "Expected a resumable five-character makeup round to stamp exactly once only after completion", collections);
  assert(collections.makeup.backup && collections.inkStored && collections.cap.kept <= 96 && collections.cap.bytes <= 420 * 1024 && collections.cap.removed > 0 && collections.cap.realKept,
    "Expected makeup records in backup and bounded recent independent ink with oldest-first fallback", collections);
  assert(collections.monthly.width === 1080 && collections.monthly.height === 1440 && collections.monthly.practiced === collections.monthly.items && collections.monthly.stable >= 0 && collections.monthly.stable <= collections.monthly.practiced && collections.monthly.independent >= 3 && collections.monthly.independent <= collections.monthly.practiced && collections.monthly.days >= 3 && Number.isInteger(collections.monthly.hardest) && collections.monthly.inkTiles >= 1
    && collections.share.route === "native" && collections.share.type === "sharePracticeCard" && collections.share.kind === "monthly" && collections.share.hasPNG,
  "Expected a private 1080x1440 monthly post through the existing native share route", collections);
  assert(collections.annual.slides === 4 && collections.annual.keys.length >= 5 && collections.annual.busiest && Number.isInteger(collections.annual.rarest) && Number.isInteger(collections.annual.first) && collections.annual.clientHeight > 400 && Math.abs(collections.annual.firstHeight - collections.annual.clientHeight) < 2 && collections.annual.scrollHeight >= collections.annual.clientHeight * 3.9 && !collections.annual.copy.includes("击败") && !collections.annual.copy.includes("中断"),
    "Expected a four-screen local annual report without comparisons or break-loss language", collections);

  const backup = await page.evaluate(() => {
    const original = JSON.parse(backupPayload({ preserveMeta: true })), originalMemory = cloneObj(memory);
    const currentMemory = { "verify:current-a": { seen: 1, last: new Date("2026-07-10T08:00:00Z").getTime() }, "verify:current-b": { seen: 1, last: new Date("2026-07-11T08:00:00Z").getTime() } };
    memory = currentMemory; saveMemory();
    const incoming = JSON.parse(JSON.stringify(original)); incoming.date = "2026-06-01T08:00:00.000Z"; incoming.data[MEMORY_KEY] = JSON.stringify({ "verify:incoming": { seen: 1, last: new Date("2026-05-31T08:00:00Z").getTime() } });
    let confirmCopy = ""; const nativeConfirm = window.confirm; window.confirm = (copy) => { confirmCopy = copy; return false; };
    const cancelled = restoreBackupPayload(incoming, { reload: false }); window.confirm = nativeConfirm;
    localStorage.setItem("shizi.unknown.verify", "keep-local");
    const restoredResult = restoreBackupPayload(incoming, { skipConfirm: true, reload: false });
    const safetyAfterRestore = safetySnapshot(), incomingApplied = String(localStorage.getItem(MEMORY_KEY)).includes("verify:incoming");
    const undoOffered = showSafetyUndo() && getComputedStyle(safetyUndo).display === "flex" && safetyUndoBtn.textContent === "撤销恢复";
    const undoResult = undoSafetyRestore({ reload: false }), currentRestored = String(localStorage.getItem(MEMORY_KEY)).includes("verify:current-b");

    memory = currentMemory; saveMemory(); resetAllData({ skipConfirm: true }); const resetSafety = safetySnapshot();
    memory = { "verify:before-second": { seen: 1, last: Date.now() } }; saveMemory();
    const secondIncoming = JSON.parse(JSON.stringify(incoming)); secondIncoming.data[MEMORY_KEY] = JSON.stringify({ "verify:second-incoming": { seen: 1, last: Date.now() } });
    restoreBackupPayload(secondIncoming, { skipConfirm: true, reload: false }); const overwrittenSafety = safetySnapshot();
    undoSafetyRestore({ reload: false }); const latestRestored = String(localStorage.getItem(MEMORY_KEY)).includes("verify:before-second");

    restoreBackupPayload(original, { skipConfirm: true, reload: false, skipSafety: true }); localStorage.removeItem(SAFETY_KEY); hideSafetyUndo(); memory = originalMemory;
    const result = { keys: Object.keys(original.data), sessionVersion: JSON.parse(original.data[SESSION_KEY]).version, fsrsLog: !!original.data[FSRS_LOG_KEY], tutorial: original.data[TRACE_TUTORIAL_KEY], funnelVersion: JSON.parse(original.data[FUNNEL_KEY]).version, sound: JSON.parse(original.data[SOUND_KEY]), restoredKeys: restoredResult.keys,
      unknown: localStorage.getItem("shizi.unknown.verify"), cancelled: !cancelled.applied, confirmCopy, incomingApplied, safetyReason: safetyAfterRestore && safetyAfterRestore.reason, undoOffered, undoApplied: undoResult.applied, currentRestored,
      resetReason: resetSafety && resetSafety.reason, overwrittenReason: overwrittenSafety && overwrittenSafety.reason, latestRestored, safetyExcluded: !Object.prototype.hasOwnProperty.call(original.data, SAFETY_KEY) };
    localStorage.removeItem("shizi.unknown.verify"); return result;
  });
  assert(backup.keys.includes(SESSION_STORAGE_KEY) && backup.sessionVersion === 2 && backup.fsrsLog && backup.tutorial === "true" && backup.funnelVersion === 1 && backup.sound.enabled === true && backup.restoredKeys.includes(SESSION_STORAGE_KEY) && backup.unknown === "keep-local", "Expected session/FSRS/tutorial/funnel/sound backup round trip with allowlist isolation", backup);
  assert(backup.cancelled && backup.confirmCopy.includes("当前 2 字（最后练习 2026-07-11）→ 备份 1 字（2026-06-01）") && backup.incomingApplied && backup.safetyReason === "restore" && backup.undoOffered && backup.undoApplied && backup.currentRestored, "Expected differential restore confirmation and one-tap safety undo", backup);
  assert(backup.resetReason === "reset" && backup.overwrittenReason === "restore" && backup.latestRestored && backup.safetyExcluded, "Expected reset safety copy, latest-operation replacement, and backup exclusion", backup);

  const backupCoverage = await page.evaluate(() => {
    const excluded = new Set(["shizi.nativeSmoke.v1", SAFETY_KEY]);
    return Object.keys(localStorage).filter((key) => key.startsWith("shizi.") && !BACKUP_KEYS.includes(key) && !excluded.has(key));
  });
  assert(backupCoverage.length === 0, "Expected every persistent shizi key to be backed up or explicitly excluded", backupCoverage);

  await page.setViewportSize({ width: 320, height: 620 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { const s = resumableSession(); if (s) restoreSession(s); });
  await page.waitForFunction(() => getComputedStyle(reveal).display !== "none");
  const compact = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".cmpBox")).map((node) => node.getBoundingClientRect());
    const cardRect = card.getBoundingClientRect(), back = exitPractice.getBoundingClientRect(), progress = posLabel.getBoundingClientRect(), add = addInPractice.getBoundingClientRect(), progressStyle = getComputedStyle(posLabel);
    return { widths: boxes.map((box) => box.width), within: boxes.every((box) => box.left >= cardRect.left && box.right <= cardRect.right), actions: decisionRow.getBoundingClientRect().bottom <= innerHeight + 1,
      header: { backSize: [back.width, back.height], noOverlap: back.right <= progress.left && progress.right <= add.left, nowrap: progressStyle.whiteSpace === "nowrap", oneLine: posLabel.scrollHeight <= posLabel.clientHeight + 1, noGraphicProgress: !document.querySelector(".beads,.bead,progress,[role=progressbar]") } };
  });
  assert(compact.widths.every((width) => width <= 138.5) && compact.within && compact.actions && compact.header.backSize.every((value) => value >= 44) && compact.header.noOverlap && compact.header.nowrap && compact.header.oneLine && compact.header.noGraphicProgress, "Expected dark small-screen comparison and text-only header to fit", compact);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  assert(pageErrors.length === 0, "Browser console/page errors", pageErrors);
  await browser.close();
  console.log(`Verified FSRS-6 dual-loop practice, migration, persistence, backup, history, and ${baseline.cards} cards.`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
