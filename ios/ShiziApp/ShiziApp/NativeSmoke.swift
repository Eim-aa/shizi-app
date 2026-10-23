#if DEBUG
import Foundation
import UIKit
import UserNotifications
import WebKit

// DEBUG 原生冒烟（02 M5-3；01 §8.2、§11）。整份文件只在 Debug 编译，Release 产物不含这里的任何标记
// （verify-archive.sh 检查 __shiziNativeDev / nativeSmokeResult / nativeSmokeControl / shizi-native-smoke.json）。
//
// 启动参数：
//   -shizi-smoke                 冒烟：URL 追加 ?test=1、documentStart 注入 window.__shiziNativeDev=true，
//                                页面每次 postMessage pageReady 后注入下面的冒烟脚本（脚本自己用 sessionStorage 续跑刷新前后的步骤）。
//   -shizi-dev                   开发：?dev=1&test=1 + __shiziNativeDev（色板页 / 指针统计，不跑冒烟）。
//   -shizi-smoke-stage <name>    main（默认）| relaunch | deeplink | restore | restorecheck | measure | cleanup。
//                                restore / restorecheck：冷启动恢复（Q32），两次启动之间由 smoke-device.sh 用 SIGKILL 结束进程；
//                                measure：T1 非触控测量（rAF 间隔分布、媒体查询、笔锋细节判定、字号注入、原生 deviceInfo）。
//                                cleanup：移除 main 阶段真的排进系统的提醒（不碰 localStorage）。
//                                probe：外部探针（R3-K1，scripts/verify-webkit-ax.mjs）——pageReady 后读 Documents/shizi-smoke-probe.js
//                                （一个函数表达式，由门禁脚本放进数据容器），以 -shizi-probe-arg <字符串> 调用；探针自己经 nativeSmokeResult
//                                回结果（写 shizi-native-smoke.json）。探针逻辑在仓库 scripts/ 下，改它不用重新构建 App。
//   -shizi-reminder-target <k>   冷启动时把 k 当作「从提醒通知点进来」的目标（走 openReminderTarget，与 AppDelegate 同一路径）。
//
// 冒烟脚本只用公开测试钩子 window.__shiziTest、data-testid 与 bridge 公开接口，不依赖页面内部全局。
// 系统面板在冒烟里换成可断言的替身（其余全部走正式代码路径）：
//   shareBackup      → 写 Documents/shizi-smoke-backup.json 并当作「分享完成」回 markBackupExported()
//   pickBackup       → 按 nativeSmokeControl {action:'nextPick', file} 预先指定的测试文件走正式的 importBackup(from:) 预检
//   openAppSettings  → 只记事件（不离开 App）
// 原生侧事件（pageReady、shareBackup、pickBackup、backupDelivered、backupRejected、syncReminder、reminderDispatch、
// cardSaved、edgeBack、state）同步到页面的 window.__shiziSmokeEvents；结果写 Documents/shizi-native-smoke.json。

extension WebViewController {
    static var nativeSmokeEnabled: Bool {
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-shizi-smoke") || process.environment["SHIZI_SMOKE"] == "1"
    }

    static var nativeTestHostEnabled: Bool {
        let process = ProcessInfo.processInfo
        return nativeSmokeEnabled || process.arguments.contains("-shizi-dev") || process.environment["SHIZI_DEV"] == "1"
            // B2.0：测试宿主（XCTest 驱动写字会话 API）只要测试钩子，不跑冒烟、不进调试页
            || process.arguments.contains("-shizi-test-host") || process.environment["SHIZI_TEST_HOST"] == "1"
    }

    private static func argumentValue(after flag: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    static var nativeSmokeStage: String {
        argumentValue(after: "-shizi-smoke-stage") ?? ProcessInfo.processInfo.environment["SHIZI_SMOKE_STAGE"] ?? "main"
    }

    static var smokeResultURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("shizi-native-smoke.json")
    }

    static var smokeProbeURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("shizi-smoke-probe.js")
    }

    static var smokeBackupURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("shizi-smoke-backup.json")
    }

    func installNativeDevUserScriptIfNeeded(_ controller: WKUserContentController) {
        guard Self.nativeTestHostEnabled else { return }
        controller.addUserScript(WKUserScript(
            source: "window.__shiziNativeDev = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        // B2.9b：QA 注入钉过的时钟跨杀进程重开保持（QAClock；页面 env.js 模块求值时读）
        if let clock = QAClock.script {
            controller.addUserScript(WKUserScript(source: clock, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // B3.2：QA（逐屏取证 / 夹具注入 / 探针）里版本行钉住——BUILD 每次重生成清单都变，关于页与「我的」页底的版本行参考要可复现（about.js aboutBuild）
        if Self.qaEnabled {
            controller.addUserScript(WKUserScript(source: "window.__shiziQABuild = {version:'1.0.0', build:'20261001-000000000000'};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    func applySmokeLaunchArguments() {
        if let target = Self.argumentValue(after: "-shizi-reminder-target"), !target.isEmpty {
            // 与 AppDelegate 点开通知同一入口：页面还没发 pageReady，key 先存着（冷启动）。
            openReminderTarget(cardKey: target)
        }
    }

    // MARK: 事件

    func recordSmokeEvent(_ kind: String, _ detail: [String: Any]) {
        guard Self.nativeSmokeEnabled else { return }
        smokeEvents.append([
            "kind": kind,
            "seq": smokeEvents.count + 1,
            "at": Date().timeIntervalSince1970 * 1000,
            "detail": detail,
        ])
        syncSmokeEvents()
    }

    private func syncSmokeEvents() {
        guard
            let data = try? JSONSerialization.data(withJSONObject: smokeEvents),
            let literal = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript("window.__shiziSmokeEvents = \(literal); void 0;")
    }

    // MARK: 系统面板替身

    func smokeInterceptShareBackup(filename: String, payload: String) -> Bool {
        guard Self.nativeSmokeEnabled, let url = Self.smokeBackupURL else { return false }
        var detail: [String: Any] = ["name": filename, "bytes": payload.utf8.count]
        do {
            try Data(payload.utf8).write(to: url, options: .atomic)
            detail["written"] = true
        } catch {
            detail["written"] = false
            detail["error"] = error.localizedDescription
        }
        if let object = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] {
            detail["app"] = object["app"] as? String ?? ""
            detail["version"] = (object["version"] as? NSNumber)?.intValue ?? -1
            detail["dataKeys"] = ((object["data"] as? [String: Any]) ?? [:]).keys.sorted()
        }
        recordSmokeEvent("shareBackup", detail)
        if detail["written"] as? Bool == true {
            notifyBackupExported() // 等同系统分享面板 completed == true
        }
        return true
    }

    func smokeInterceptPickBackup() -> Bool {
        guard Self.nativeSmokeEnabled, let choice = smokeNextPick else { return false }
        smokeNextPick = nil
        recordSmokeEvent("pickBackup", ["file": choice])
        let manager = FileManager.default
        let tmp = temporaryShareURL(filename: "smoke-\(choice).json")
        do {
            switch choice {
            case "exported":
                guard let source = Self.smokeBackupURL, manager.fileExists(atPath: source.path) else {
                    deliverBackupRejection(.invalid)
                    return true
                }
                try manager.copyItem(at: source, to: tmp)
            case "invalid":
                try Data("this is not a shizi backup".utf8).write(to: tmp, options: .atomic)
            case "notShizi":
                try Data(#"{"app":"other","version":2,"data":{"other.key":"1"}}"#.utf8).write(to: tmp, options: .atomic)
            case "tooLarge":
                try Data(count: Self.backupMaxBytes + 1).write(to: tmp, options: .atomic)
            case "cancel":
                deliverBackupRejection(.cancelled)
                return true
            default:
                return false
            }
        } catch {
            recordSmokeEvent("pickBackupError", ["error": error.localizedDescription])
            deliverBackupRejection(.invalid)
            return true
        }
        importBackup(from: tmp) // 正式预检路径（tmp 里的副本用完即删）
        return true
    }

    func smokeRecordReminderSync(_ request: ReminderRequest) {
        guard Self.nativeSmokeEnabled else { return }
        let plan = Self.reminderPlan(request, now: Date())
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let authorization = Self.permissionName(settings.authorizationStatus)
            DispatchQueue.main.async {
                self?.recordSmokeEvent("syncReminder", [
                    "enabled": request.enabled,
                    "hour": request.hour,
                    "minute": request.minute,
                    "practicedToday": request.practicedToday,
                    "rawQuestions": request.rawQuestionCount,
                    "validQuestions": request.questions.count,
                    "plannedDays": plan.map(\.dayKey),
                    "plannedTargets": plan.map(\.question.targetCardKey),
                    "authorization": authorization,
                ])
            }
        }
    }

    // MARK: 控制消息

    func handleNativeSmokeControl(_ body: [String: Any]) {
        guard Self.nativeSmokeEnabled else { return }
        switch body["action"] as? String ?? "" {
        case "nextPick":
            smokeNextPick = body["file"] as? String
            recordSmokeEvent("nextPick", ["file": smokeNextPick ?? ""])
        case "edgeBack":
            // 手势识别本身（UIKit 触摸）不能从页面合成：这里走与真实识别器相同的门控（delegate）和派发函数。
            let allowed = gestureRecognizerShouldBegin(practiceBackGesture)
            var fired = false
            if allowed {
                let width = max(webView.bounds.width, 1)
                dispatchBackGesture(phase: "began", distance: 0, velocity: 0)
                dispatchBackGesture(phase: "changed", distance: width * 0.15, velocity: 300)
                fired = dispatchBackGesture(phase: "ended", distance: width * 0.6, velocity: 300)
            }
            recordSmokeEvent("edgeBack", ["allowed": allowed, "fired": fired, "gate": backGestureEnabled])
        case "state":
            recordSmokeEvent("state", [
                "pageReady": pageReady,
                "backGestureEnabled": backGestureEnabled,
                // P272：左缘识别器挂在 WKWebView 的容器视图上（不在 WKWebView 上），页边起手识别器要求系统边缘识别器先失败。
                "edgeGestureInstalled": view.gestureRecognizers?.contains(where: { $0 === practiceBackGesture }) == true
                    && webView.gestureRecognizers?.contains(where: { $0 === practiceBackGesture }) != true
                    && webView.superview === view,
                "edgeGestureDelegate": practiceBackGesture.delegate === self && marginBackGesture.delegate === self,
                "edgeGestureLeft": practiceBackGesture.edges == .left,
                "marginGestureInstalled": view.gestureRecognizers?.contains(where: { $0 === marginBackGesture }) == true,
                "backForwardGesturesDisabled": !webView.allowsBackForwardNavigationGestures,
                "pendingReminderCardKey": pendingReminderCardKey.map { $0 as Any } ?? NSNull(),
                "url": webView.url?.absoluteString ?? "",
            ])
        case "deviceInfo":
            // measure 阶段（T1 非触控部分）：页面拿不到的原生侧事实——屏幕最高刷新率、低电量模式（会把 rAF 钳到 30Hz）、温度、
            // 真实核数与内存（页面里的 hardwareConcurrency / deviceMemory 会被 WebKit 钳低）、系统字号档位。
            var systemInfo = utsname()
            uname(&systemInfo)
            let machine = withUnsafeBytes(of: &systemInfo.machine) { raw in
                String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
            }
            let screen = view.window?.windowScene?.screen ?? UIScreen.main
            let category = currentContentSizeCategory
            let thermal: String
            switch ProcessInfo.processInfo.thermalState {
            case .nominal: thermal = "nominal"
            case .fair: thermal = "fair"
            case .serious: thermal = "serious"
            case .critical: thermal = "critical"
            @unknown default: thermal = "unknown"
            }
            recordSmokeEvent("deviceInfo", [
                "machine": machine,
                "systemName": UIDevice.current.systemName,
                "systemVersion": UIDevice.current.systemVersion,
                "maximumFramesPerSecond": screen.maximumFramesPerSecond,
                "screenScale": screen.scale,
                "screenNativeScale": screen.nativeScale,
                "screenPoints": [screen.bounds.width, screen.bounds.height],
                "webViewPoints": [webView.bounds.width, webView.bounds.height],
                "activeProcessorCount": ProcessInfo.processInfo.activeProcessorCount,
                "physicalMemoryMB": Int(ProcessInfo.processInfo.physicalMemory / 1_048_576),
                "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
                "thermalState": thermal,
                "reduceMotion": UIAccessibility.isReduceMotionEnabled,
                "darkerSystemColors": UIAccessibility.isDarkerSystemColorsEnabled,
                "contentSizeCategoryRaw": category.rawValue,
                "contentSizeCategory": Self.contentSizeName(category),
                "contentSizeScale": Self.contentSizeScale(category),
                "initialContentSizeScript": Self.initialContentSizeScript(category) ?? NSNull(),
                "userInterfaceStyle": traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
            ])
        default:
            recordSmokeEvent("unknownControl", ["action": body["action"] as? String ?? ""])
        }
    }

    // MARK: 脚本与结果

    func writeNativeSmokeResult(_ payload: String) {
        guard let url = Self.smokeResultURL else { return }
        try? Data(payload.utf8).write(to: url, options: .atomic)
    }

    func runNativeSmokeIfNeeded() {
        guard Self.nativeSmokeEnabled else { return }
        syncSmokeEvents()
        if Self.nativeSmokeStage == "probe" {
            runSmokeProbe()
            return
        }
        guard let stage = Self.jsonLiteral(Self.nativeSmokeStage) else { return }
        webView.evaluateJavaScript(Self.nativeSmokeScript + "(\(stage)); void 0;") { [weak self] _, error in
            if let error {
                let message = Self.jsonLiteral(error.localizedDescription) ?? "\"script error\""
                self?.writeNativeSmokeResult(#"{"error":\#(message)}"#)
            }
        }
    }

    /// probe 阶段：执行门禁脚本放进 Documents 的探针（每次 pageReady 都调用；探针自己用 window 标记保证一次页面加载只跑一遍）。
    private func runSmokeProbe() {
        guard
            let url = Self.smokeProbeURL,
            let source = try? String(contentsOf: url, encoding: .utf8),
            !source.isEmpty
        else {
            writeNativeSmokeResult(#"{"error":"probe script missing"}"#)
            return
        }
        let arg = Self.jsonLiteral(Self.argumentValue(after: "-shizi-probe-arg") ?? "") ?? "\"\""
        webView.evaluateJavaScript("(\(source))(\(arg)); void 0;") { [weak self] _, error in
            if let error {
                let message = Self.jsonLiteral(error.localizedDescription) ?? "\"probe error\""
                self?.writeNativeSmokeResult(#"{"error":\#(message)}"#)
            }
        }
    }

    // 冒烟脚本：一个函数表达式，由 runNativeSmokeIfNeeded 以 stage 调用。
    private static let nativeSmokeScript = #"""
    (async function (STAGE) {
      if (window.__shiziSmokeRunning) return;
      window.__shiziSmokeRunning = true;
      const native = window.webkit.messageHandlers.shiziNative;
      const PROGRESS = 'shizi.nativeSmoke.progress';
      const SMOKE_KEY = 'shizi.nativeSmoke.v1';
      const NATIVE_GLOBALS = ['shiziOpenReminderTarget', 'shiziBackupPicked', 'shiziBackupRejected', 'markBackupExported', 'shiziCardSaved', 'shiziReminderStatus'];
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const readProgress = () => { try { return JSON.parse(sessionStorage.getItem(PROGRESS) || 'null'); } catch (e) { return null; } };
      const saveProgress = p => sessionStorage.setItem(PROGRESS, JSON.stringify(p));
      let progress = readProgress();
      if (!progress || progress.stage !== STAGE) progress = { stage: STAGE, phase: 'start', token: String(Math.random()), result: { stage: STAGE, steps: [] } };
      if (progress.phase === 'done') return;
      const result = progress.result;
      const step = name => { result.steps.push(name); result.lastStep = name; };
      const finish = () => {
        progress.phase = 'done';
        saveProgress(progress);
        native.postMessage({ type: 'nativeSmokeResult', payload: JSON.stringify(result) });
      };
      const control = (action, extra) => native.postMessage(Object.assign({ type: 'nativeSmokeControl', action }, extra || {}));
      async function waitFor(fn, label, ms = 12000) {
        const end = Date.now() + ms;
        let last = null;
        while (Date.now() < end) {
          try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
          await sleep(50);
        }
        throw new Error('timeout: ' + label + (last ? ' (' + (last.message || last) + ')' : ''));
      }
      const app = () => document.querySelector('.sz-app');
      const topScreen = () => (app() ? app().dataset.topScreen || null : null);
      const topLayer = () => document.querySelector('.sz-layer[data-top="true"]');
      const q = id => { const t = topLayer(); return t ? t.querySelector('[data-testid="' + id + '"]') : null; };
      const anyTid = id => document.querySelector('[data-testid="' + id + '"]');
      const writeWrap = () => (topLayer() ? topLayer().querySelector('.sz-write') : null);
      const T = () => window.__shiziTest;
      const events = () => window.__shiziSmokeEvents || [];
      const nativeEvent = (kind, after) => waitFor(() => events().slice(after).find(e => e.kind === kind), 'native event ' + kind);
      async function idle() {
        await waitFor(() => app() && app().dataset.navAnim === 'idle', 'nav idle');
        await sleep(480); // 新页面 / 新状态后 0.4s 按钮不响应（01 §6.6）
      }
      async function tap(id, root) {
        const el = await waitFor(() => { const e = root ? anyTid(id) : q(id); return e && !e.disabled ? e : null; }, 'tap ' + id);
        el.click();
      }
      const flatRecords = st => {
        const out = [];
        for (const m of Object.keys(st.records || {})) {
          const v = st.records[m];
          for (const r of Array.isArray(v) ? v : (v && v.kept) || []) out.push(r);
        }
        return out;
      };
      const judged = () => flatRecords(T().getState()).filter(r => r.kind === 'judged');
      const dataSnapshot = () => {
        const raw = T().getRawKeys('shizi.v2.');
        const out = {};
        for (const k of Object.keys(raw).sort()) if (/^shizi\.v2\.(records\.|ink\.|sched$)/.test(k)) out[k] = raw[k];
        return JSON.stringify(out);
      };
      const pad = n => (n < 10 ? '0' + n : String(n));
      const localDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
      async function booted() {
        await waitFor(() => app() && T() && window.__shiziBridge && window.__shiziBridge.isReady(), 'app boot');
      }
      async function stroke(points) {
        const canvas = await waitFor(() => q('write-grid-live'), 'write grid');
        const r = canvas.getBoundingClientRect();
        const at = (fx, fy) => ({ clientX: r.left + fx * r.width, clientY: r.top + fy * r.height });
        const base = { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, button: 0 };
        const fire = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, Object.assign({}, base, p, { buttons })));
        fire('pointerdown', at(points[0][0], points[0][1]), 1);
        for (let i = 1; i < points.length; i += 1) {
          for (let s = 1; s <= 10; s += 1) {
            const f = s / 10;
            fire('pointermove', at(points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f), 1);
            await sleep(16);
          }
        }
        const last = points[points.length - 1];
        fire('pointerup', at(last[0], last[1]), 0);
      }
      const H = [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]];
      const V = [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]];
      const strokeCount = () => (q('write-grid') ? Number(q('write-grid').dataset.strokeCount) : -1);
      const router = () => import('/src/ui/router.js');
      // F1 冷启动恢复：上一阶段若停在写字页，冷启动会恢复到那里；种好数据后先退回首页，各阶段都从首页开始。
      async function toHome() {
        if (topScreen() !== 'home') {
          const { nav } = await router();
          for (let i = 0; i < 6 && topScreen() !== 'home'; i += 1) {
            nav.back();
            await waitFor(() => app() && app().dataset.navAnim === 'idle', 'nav idle after back');
            await sleep(300);
          }
        }
        await waitFor(() => topScreen() === 'home' && q('write-test-entry'), 'home screen');
      }

      try {
        if (STAGE === 'main' && progress.phase === 'start') {
          step('boot');
          await booted();
          const res = await fetch('data/' + encodeURIComponent('永') + '.json');
          const strokeJson = res.ok ? await res.json() : null;
          await waitFor(() => document.documentElement.dataset.shiziReady, 'build ready marker', 5000).catch(() => null);
          let fontFaces = 0;
          try { fontFaces = (await document.fonts.load('400 32px "ShiziKai"', '永')).length; } catch (e) { fontFaces = -1; }
          result.boot = {
            href: location.href,
            testQuery: new URLSearchParams(location.search).get('test') === '1',
            nativeDev: window.__shiziNativeDev === true,
            testHooks: typeof T() === 'object',
            bridgeReady: window.__shiziBridge.isReady(),
            nativeGlobals: NATIVE_GLOBALS.every(n => typeof window[n] === 'function'),
            topScreen: topScreen(),
            seed: typeof SEED !== 'undefined' ? SEED.length : -1,
            groups: typeof GROUPS !== 'undefined' ? Object.keys(GROUPS).length : -1,
            contextOverrides: typeof CONTEXT_OVERRIDES !== 'undefined' ? Object.keys(CONTEXT_OVERRIDES).length : -1,
            coreStrokes: typeof SHIZI_CORE_STROKES !== 'undefined' ? SHIZI_CORE_STROKES.length : -1,
            hanziWriter: typeof HanziWriter === 'function',
            fetchOk: res.ok,
            fetchStatus: res.status,
            strokeCount: strokeJson && Array.isArray(strokeJson.strokes) ? strokeJson.strokes.length : 0,
            fontFaces,
            buildReady: document.documentElement.dataset.shiziReady || null,
            buildMeta: (document.querySelector('meta[name="shizi-asset-build"]') || {}).content || null,
            serviceWorkerController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          };

          step('storage');
          const before = localStorage.getItem(SMOKE_KEY);
          T().reset(); // 清全部 shizi.*（保留 nativeSmoke 键）
          const stamp = new Date().toISOString();
          localStorage.setItem(SMOKE_KEY, stamp); // 冒烟专用键，不进备份（schema 排除表）
          result.storage = {
            writable: localStorage.getItem(SMOKE_KEY) === stamp,
            smokeKeyBefore: before,
            stamp,
            storeAvailable: !!(T().getStatus() && T().getStatus().available),
          };

          step('write');
          const at = T().now();
          const session = {
            id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' },
            queue: ['base:永', 'base:和', 'base:春'], cursor: 0, items: [],
            current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
            lastLine: null, startedAt: at, startedDay: localDay(at), updatedAt: at,
          };
          const seeded = T().seed({ sessions: { A: session, B: null, lastEnded: {} } });
          if (!seeded || !seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded));
          await toHome();
          await idle();
          await tap('write-test-entry');
          await waitFor(() => topScreen() === 'write' && q('write-grid-live'), 'write screen');
          await idle();
          await stroke(H);
          await waitFor(() => strokeCount() === 1, 'first stroke drawn');
          await sleep(480);
          await tap('write-done');
          await waitFor(() => q('write-judge-correct'), 'judge page');
          await sleep(480);
          await tap('write-judge-correct');
          const rec = await waitFor(() => judged().find(r => r.char === '永'), 'judged record 永');
          await waitFor(() => writeWrap() && writeWrap().dataset.cursor === '1' && writeWrap().dataset.phase === 'recall', 'advanced to 和');
          result.write = { seeded: !!(seeded && seeded.ok), judgedChar: rec.char, judgment: rec.judgment, cardKey: rec.cardKey, advanced: true };

          step('reload');
          await idle();
          await stroke(V);
          await waitFor(() => { const s = T().getState().sessions.A; return s && s.current && s.current.strokes.length === 1; }, 'stroke persisted before reload');
          progress.phase = 'afterReload';
          saveProgress(progress);
          location.reload();
          return;
        }

        if (STAGE === 'main' && progress.phase === 'afterReload') {
          await booted();
          await waitFor(() => topScreen() === 'write' && q('write-grid'), 'write page restored after reload');
          await waitFor(() => strokeCount() === 1, 'stroke restored after reload');
          result.reload = {
            topScreen: topScreen(),
            cursor: writeWrap() ? writeWrap().dataset.cursor : null,
            phase: writeWrap() ? writeWrap().dataset.phase : null,
            strokes: strokeCount(),
          };

          // R4-G1（P270）：写字页与其它子页一样可以左缘返回（原 M0-7 整页门控 false 已取消）；笔画现场照常保留（write2 步骤核对）。
          step('edgeBackOnWrite');
          await idle();
          const writeGate = window.__shiziBridge.lastBackGestureSent();
          let n = events().length;
          control('edgeBack');
          const onWrite = await nativeEvent('edgeBack', n);
          await waitFor(() => topScreen() && topScreen() !== 'write', 'edge back left the write page');
          result.edgeBack = {
            writeAllowed: onWrite.detail.allowed,
            writeFired: onWrite.detail.fired,
            writeGateSent: writeGate,
            writeLeftTo: topScreen(),
          };
          const { nav } = await router();
          await idle();

          step('backupExport');
          nav.push('backup', {});
          await waitFor(() => topScreen() === 'backup' && q('backup-export'), 'backup screen');
          await idle();
          n = events().length;
          await tap('backup-export');
          const shared = await nativeEvent('shareBackup', n);
          const meta = await waitFor(() => { const m = T().getState().backupMeta; return m && m.lastExportAt > 0 ? m : null; }, 'lastExportAt recorded');
          const keys = shared.detail.dataKeys || [];
          result.backup = {
            written: shared.detail.written === true,
            app: shared.detail.app,
            version: shared.detail.version,
            bytes: shared.detail.bytes,
            keyCount: keys.length,
            hasRecords: keys.some(k => k.indexOf('shizi.v2.records.') === 0),
            excludesSmokeKey: keys.indexOf(SMOKE_KEY) < 0,
            excludesSafety: keys.indexOf('shizi.v2.safety') < 0,
            markedExported: meta.lastExportAt > 0,
          };
          const snapA = dataSnapshot();

          step('edgeBackOnSubpage');
          await idle();
          n = events().length;
          control('edgeBack');
          const allowed = await nativeEvent('edgeBack', n);
          await waitFor(() => topScreen() !== 'backup', 'edge back popped the backup page');
          result.edgeBack.subpageAllowed = allowed.detail.allowed;
          result.edgeBack.subpageFired = allowed.detail.fired;
          result.edgeBack.poppedTo = topScreen();
          await idle();

          step('write2');
          await tap('write-test-entry');
          await waitFor(() => topScreen() === 'write' && strokeCount() === 1, 'write resumed with the stroke');
          await idle();
          await tap('write-done');
          await waitFor(() => q('write-judge-wrong'), 'judge page 2');
          await sleep(480);
          await tap('write-judge-wrong');
          await waitFor(() => judged().some(r => r.char === '和'), 'judged record 和');
          await idle();
          nav.back();
          await waitFor(() => topScreen() && topScreen() !== 'write', 'left write page 2');
          await idle();
          const snapB = dataSnapshot();
          result.write.secondJudged = judged().map(r => r.char + ':' + r.judgment).sort();

          step('backupRestore');
          window.__shiziSmokeNoReload = progress.token;
          nav.push('backup', {});
          await waitFor(() => topScreen() === 'backup' && q('backup-restore'), 'backup screen 2');
          await idle();
          control('nextPick', { file: 'exported' });
          n = events().length;
          await tap('backup-restore');
          const delivered = await nativeEvent('backupDelivered', n);
          const confirm = await waitFor(() => anyTid('backup-restore-confirm'), 'restore confirm');
          const confirmMode = confirm.dataset.mode || null;
          const confirmTitle = anyTid('backup-restore-confirm-title') ? anyTid('backup-restore-confirm-title').textContent.trim() : null;
          await sleep(480);
          await tap('backup-restore-ok', true);
          await waitFor(() => dataSnapshot() === snapA, 'records replaced by the backup');
          const undoButton = await waitFor(() => {
            const bar = anyTid('backup-undo');
            const b = bar ? bar.querySelector('[data-testid="undo-button"]') : null;
            return b && !b.disabled ? b : null;
          }, 'undo bar');
          const judgedAfterReplace = judged().map(r => r.char).sort();
          await sleep(480);
          undoButton.click();
          await waitFor(() => dataSnapshot() === snapB, 'undo restored the previous records');
          result.restore = {
            delivered: delivered.detail.accepted,
            confirmMode,
            confirmTitle,
            replacedMatchesBackup: true,
            judgedAfterReplace,
            undone: true,
            noReload: window.__shiziSmokeNoReload === progress.token,
            stayedOnBackup: topScreen() === 'backup',
          };

          step('backupReject');
          const { t } = await import('/src/config/copy/index.js');
          result.reject = { copy: { notBackup: t('R-B06.notBackup'), cancelled: t('R-B06.cancelled') } };
          for (const [file, kind] of [['invalid', 'notBackup'], ['notShizi', 'notBackup'], ['tooLarge', 'notBackup'], ['cancel', 'cancelled']]) {
            await idle();
            control('nextPick', { file });
            n = events().length;
            await tap('backup-restore');
            const ev = await nativeEvent('backupRejected', n);
            const note = await waitFor(() => { const el = q('backup-note'); return el && el.dataset.kind === kind ? el : null; }, 'R-B06 note ' + file);
            result.reject[file] = { reason: ev.detail.reason, kind: note.dataset.kind, text: note.textContent.trim() };
          }
          result.reject.noReload = window.__shiziSmokeNoReload === progress.token;

          step('reminder');
          const settings = await import('/src/ui/screens/mine/prefs.js');
          n = events().length;
          const sent = settings.syncReminder({ enabled: true, hour: 20, minute: 30, permission: 'granted' });
          const synced = await nativeEvent('syncReminder', n);
          n = events().length;
          const bridgeMod = await import('/src/platform/bridge.js');
          bridgeMod.postNative('openAppSettings', {});
          const settingsEv = await nativeEvent('openAppSettings', n);
          result.reminder = Object.assign({ sent, openAppSettings: !!settingsEv }, synced.detail);

          step('imageSave');
          const canvas = document.createElement('canvas');
          canvas.width = 90;
          canvas.height = 120;
          const g = canvas.getContext('2d');
          g.fillStyle = '#FBF8F2';
          g.fillRect(0, 0, 90, 120);
          g.fillStyle = '#2A2622';
          g.fillRect(20, 55, 50, 8);
          const { saveImageFile } = await import('/src/ui/components/image-preview.js');
          const saved = await Promise.race([
            saveImageFile({ dataURL: canvas.toDataURL('image/jpeg', 0.92), name: 'shizi-smoke.jpg', kind: 'character' }),
            sleep(30000).then(() => ({ via: 'timeout', ok: false })),
          ]);
          const cardSaved = events().filter(e => e.kind === 'cardSaved').slice(-1)[0];
          result.image = { via: saved.via, ok: saved.ok, nativeSuccess: cardSaved ? cardSaved.detail.success : null };

          step('nativeState');
          n = events().length;
          control('state');
          result.native = (await nativeEvent('state', n)).detail;
          result.directWrites = T().getWriteLog().filter(e => e.via === 'direct' && e.key !== SMOKE_KEY).map(e => e.op + ':' + e.key);
          finish();
          return;
        }

        if (STAGE === 'relaunch') {
          step('relaunch');
          await booted();
          const st = T().getState();
          result.persist = {
            smokeKey: localStorage.getItem(SMOKE_KEY),
            judged: flatRecords(st).filter(r => r.kind === 'judged').map(r => r.char + ':' + r.judgment).sort(),
            sessionA: !!(st.sessions && st.sessions.A),
            lastExportAt: st.backupMeta ? st.backupMeta.lastExportAt || 0 : 0,
            topScreen: topScreen(),
          };
          finish();
          return;
        }

        if (STAGE === 'deeplink') {
          step('deeplink');
          await booted();
          const ev = await nativeEvent('reminderDispatch', 0);
          await sleep(1500);
          const pending = window.__shiziBridge.pending().filter(p => p.name === 'shiziOpenReminderTarget');
          const st = T().getState();
          const b = st.sessions ? st.sessions.B : null;
          result.deeplink = {
            cardKey: ev.detail.cardKey,
            accepted: ev.detail.accepted,
            cleared: ev.detail.cleared,
            handlerRegistered: pending.length === 0,
            pendingInBridge: pending.map(p => p.args[0]),
            topScreen: topScreen(),
            sessionB: b ? { kind: b.kind, queue: b.queue, cursor: b.cursor } : null,
            overlay: !!document.querySelector('[role="dialog"]'),
          };
          finish();
          return;
        }

        // 冷启动恢复（DEVICE_QA Q32 自动化部分；F1 shizi.v2.route）：restore 写到判断页、确认路由与会话都已落盘，
        // 由 smoke-device.sh 用 SIGKILL 结束进程（等同上滑杀掉：不跑 pagehide / visibilitychange），
        // 再以 restorecheck 冷启动，核对回到写字页判断阶段、笔画还在。
        const persistedRoute = () => {
          const raw = T().getRawKeys('shizi.v2.', { includeRoute: true });
          if (!raw['shizi.v2.route'] || !raw['shizi.v2.sessions']) return null;
          const route = JSON.parse(raw['shizi.v2.route']);
          const sessions = JSON.parse(raw['shizi.v2.sessions']);
          const cur = sessions && sessions.A && sessions.A.current;
          return {
            routeStack: (route.stack || []).map(e => e.n),
            routeAt: route.at,
            sessionPhase: cur ? cur.phase : null,
            sessionStrokes: cur && Array.isArray(cur.strokes) ? cur.strokes.length : -1,
            sessionCursor: sessions && sessions.A ? sessions.A.cursor : null,
          };
        };

        if (STAGE === 'restore') {
          step('restoreArm');
          await booted();
          T().reset();
          const at = T().now();
          const session = {
            id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' },
            queue: ['base:永', 'base:和', 'base:春'], cursor: 0, items: [],
            current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
            lastLine: null, startedAt: at, startedDay: localDay(at), updatedAt: at,
          };
          const seeded = T().seed({ sessions: { A: session, B: null, lastEnded: {} } });
          if (!seeded || !seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded));
          await toHome();
          await idle();
          await tap('write-test-entry');
          await waitFor(() => topScreen() === 'write' && q('write-grid-live'), 'write screen');
          await idle();
          await stroke(H);
          await waitFor(() => strokeCount() === 1, 'first stroke drawn');
          await sleep(480);
          await tap('write-done');
          await waitFor(() => q('write-judge-correct') && writeWrap() && writeWrap().dataset.phase === 'compare', 'judge page');
          const saved = await waitFor(() => {
            const p = persistedRoute();
            return p && p.routeStack.indexOf('write') >= 0 && p.sessionPhase === 'compare' ? p : null;
          }, 'route + session persisted');
          result.restore = Object.assign({
            armed: true,
            topScreen: topScreen(),
            phase: writeWrap().dataset.phase,
            cursor: writeWrap().dataset.cursor,
            strokes: strokeCount(),
          }, saved);
          finish();
          return;
        }

        if (STAGE === 'restorecheck') {
          step('restoreCheck');
          await booted();
          const started = Date.now();
          let landed = null;
          try {
            landed = await waitFor(() => (topScreen() === 'write' && writeWrap() && writeWrap().dataset.phase ? true : null), 'write page restored', 8000);
          } catch (e) { landed = false; }
          await sleep(600);
          result.restoreCheck = Object.assign({
            restored: !!landed,
            waitedMs: Date.now() - started,
            topScreen: topScreen(),
            phase: writeWrap() ? writeWrap().dataset.phase : null,
            cursor: writeWrap() ? writeWrap().dataset.cursor : null,
            strokes: strokeCount(),
            judgeButtons: !!(q('write-judge-correct') && q('write-judge-wrong')),
            historyDepth: history.length,
          }, persistedRoute() || {});
          finish();
          return;
        }

        // 非触控测量（T1 自动化部分）：5 秒 rAF 间隔分布（首页静置；写字页合成笔画持续书写），
        // 页面能读到的硬件 / 媒体查询 / 笔锋细节判定，原生侧事实，以及系统字号注入（P1-E6b）。
        if (STAGE === 'measure') {
          step('measure');
          await booted();
          await idle();
          // 前一阶段（restorecheck）留下的路由会让冷启动恢复到写字页：清数据、种一组，退回首页再测静置。
          T().reset();
          const at = T().now();
          const seeded = T().seed({ sessions: { A: {
            id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' },
            queue: ['base:永', 'base:和', 'base:春'], cursor: 0, items: [],
            current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
            lastLine: null, startedAt: at, startedDay: localDay(at), updatedAt: at,
          }, B: null, lastEnded: {} } });
          if (!seeded || !seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded));
          await toHome();
          await idle();
          await sleep(1000);
          const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
          const r2 = v => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
          function rafSample(ms) {
            return new Promise(resolve => {
              const stamps = [];
              let t0 = null;
              const frame = t => {
                if (t0 === null) t0 = t;
                stamps.push(t);
                if (t - t0 < ms) requestAnimationFrame(frame);
                else {
                  const iv = [];
                  for (let i = 1; i < stamps.length; i += 1) iv.push(stamps[i] - stamps[i - 1]);
                  const s = iv.slice().sort((a, b) => a - b);
                  const sum = iv.reduce((a, b) => a + b, 0);
                  const bucket = (lo, hi) => iv.filter(v => v >= lo && v < hi).length;
                  resolve({
                    frames: stamps.length,
                    intervals: iv.length,
                    durationMs: r2(stamps[stamps.length - 1] - t0),
                    medianMs: r2(pct(s, 0.5)),
                    p95Ms: r2(pct(s, 0.95)),
                    p99Ms: r2(pct(s, 0.99)),
                    maxMs: r2(s[s.length - 1]),
                    minMs: r2(s[0]),
                    meanMs: r2(sum / Math.max(1, iv.length)),
                    fps: r2(iv.length / (sum / 1000)),
                    histogram: {
                      'lt12': bucket(0, 12), '12-20': bucket(12, 20), '20-34': bucket(20, 34), '34-50': bucket(34, 50), 'ge50': bucket(50, Infinity),
                    },
                    over20ms: iv.filter(v => v > 20).length,
                    over34ms: iv.filter(v => v > 34).length,
                  });
                }
              };
              requestAnimationFrame(frame);
            });
          }

          result.rafIdleHome = Object.assign({ screen: topScreen() }, await rafSample(5000));

          step('measureDrawing');
          await tap('write-test-entry');
          await waitFor(() => topScreen() === 'write' && q('write-grid-live'), 'write screen');
          await idle();
          let drawing = true;
          let drawn = 0;
          const paths = [
            [[0.15, 0.2], [0.5, 0.35], [0.85, 0.2]], [[0.2, 0.15], [0.35, 0.5], [0.2, 0.85]],
            [[0.15, 0.8], [0.5, 0.6], [0.85, 0.8]], [[0.8, 0.15], [0.65, 0.5], [0.8, 0.85]],
          ];
          const drawer = (async () => {
            while (drawing) { await stroke(paths[drawn % paths.length]); drawn += 1; await sleep(40); }
          })();
          result.rafWriteDrawing = Object.assign({ screen: topScreen() }, await rafSample(5000));
          drawing = false;
          await drawer;
          result.rafWriteDrawing.syntheticStrokes = drawn;
          result.rafWriteDrawing.strokeCountOnGrid = strokeCount();
          result.rafWriteDrawing.note = 'synthetic PointerEvent at ~60Hz via setTimeout(16); not real touch latency';

          step('measureEnv');
          const mq = s => { try { return window.matchMedia(s).matches; } catch (e) { return null; } };
          const policyMod = await import('/src/config/policy.js');
          const brushMod = await import('/src/ui/canvas/brush.js');
          const reduced = mq('(prefers-reduced-motion: reduce)');
          const hc = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
          const dm = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
          result.env = {
            hardwareConcurrency: hc,
            deviceMemory: dm,
            devicePixelRatio: window.devicePixelRatio,
            screen: [screen.width, screen.height],
            inner: [window.innerWidth, window.innerHeight],
            prefersContrastMore: mq('(prefers-contrast: more)'),
            prefersReducedMotion: reduced,
            prefersReducedTransparency: mq('(prefers-reduced-transparency: reduce)'),
            prefersDark: mq('(prefers-color-scheme: dark)'),
            policyBrushDetail: policyMod.brushDetail,
            brushDetailEnabled: brushMod.brushDetailEnabled({ reducedMotion: !!reduced, enabled: policyMod.brushDetail }),
            legacyRuleWouldDisable: (hc !== null && hc <= 2) || (dm !== null && dm <= 2),
            userAgent: navigator.userAgent,
          };
          const root = document.documentElement;
          result.textSize = {
            initialContentSize: window.__shiziInitialContentSize || null,
            kComputed: getComputedStyle(root).getPropertyValue('--k').trim(),
            kInline: root.style.getPropertyValue('--k').trim() || null,
            dataTextSize: root.getAttribute('data-text-size'),
            dataAx: root.getAttribute('data-ax'),
            dataTextLarge: root.hasAttribute('data-text-large'),
            rootFontSize: getComputedStyle(root).fontSize,
            bodyFontSize: getComputedStyle(document.body).fontSize,
          };
          const n = events().length;
          control('deviceInfo');
          result.native = (await nativeEvent('deviceInfo', n)).detail;
          finish();
          return;
        }

        // 收尾（真机）：main 阶段的 syncReminder 会在系统里真的排下 7 天 20:30 的提醒（测试题目）。这里发一次 enabled:false，
        // 原生移除本 App 排下的全部提醒（下次正常启动时，若用户自己开着提醒，页面会按自己的设置重新排）。不碰 localStorage。
        if (STAGE === 'cleanup') {
          step('cleanup');
          await booted();
          const settings = await import('/src/ui/screens/mine/prefs.js');
          const n = events().length;
          const sent = settings.syncReminder({ enabled: false, hour: 20, minute: 30, permission: 'granted' });
          const synced = await nativeEvent('syncReminder', n);
          await sleep(1500); // 原生 getPending → removePending 是异步的
          result.cleanup = { sent, enabled: synced.detail.enabled, plannedDays: synced.detail.plannedDays };
          finish();
          return;
        }

        result.error = 'unknown stage ' + STAGE + ' / phase ' + progress.phase;
        finish();
      } catch (error) {
        result.error = String(error && error.message ? error.message : error);
        result.topScreenAtError = topScreen();
        finish();
      }
    })
    """#
}
#endif
