#if DEBUG
import UIKit
import WebKit

// QA-H1 数据驱动（B3.3）：一个状态 = 一个夹具文件 ios/ShiziApp/ShiziUITests/States/<状态>.json。
// 网页参考、原生取证、XCUITest（-shizi-qa-seed <状态>）读同一份；加一个状态只加文件，不改任何共享枚举 / switch / 脚本。
// 夹具文件在 Debug 构建时由 scripts/sync-web-assets.sh 拷进 App 包的 QAStates/（Release 不含；verify-archive 同样靠「没有 NativeQAHarness / -shizi-qa」断言）。
//
// 夹具字段（全部可省，除 state）：
//   state       状态名（= 文件名）；下划线开头的是内部夹具（只给 base 引用，不是状态）
//   name        给人看的名字（报告里用）
//   screen      所属屏名（registerScreen 的名字，或阻断页 block；覆盖门禁按它归类）；overlay 另标 "overlay": "<弹层名>"
//   native      true = 原生页已实现，逐屏对比跑；缺省 / false = 只有网页参考（页面卡原生化合并时改成 true）
//   parity      false = 只作流程起点（不取证、不进对比）；缺省 true
//   ax          true = 另取 AX3 / AX5 两档（主要状态）
//   template    _templates/<名>.json：默认的 ready / settleBefore / settle（逐键合并，字典逐层合并）
//   base        先整条跑另一个夹具（数据与导航），再跑本夹具的 setup / steps；只有顶层夹具收拾现有原生页
//   clock       {"pin": "2026-10-22T09:00:00"}：造数据期间把页面时钟钉在这个时刻（每次读数 +5ms，顺序确定），造完（unpinClock 或 setup 结束）从那一刻起照常流逝；
//               全 App 的钟随之平移（QAClock，B2.9b）。缺省 = 用真实时间
//   setup       页面里依次执行的操作：[{op, …}]，op = States/_ops/<op>.js（加新 op 只加文件）；ctx 与 a 见 qaRunJS 前导
//   ready       等页面出现：{rootsOnly?: true（tab 根页：原生版只在 -shizi-native-roots 时等原生，没开按网页等）, web: <顶层图层里的 data-testid>, webSelector?: <css>, native: "write"|"result"|"redo"|"id:<accessibilityIdentifier>", timeout: 秒}
//   settleBefore 页面出现后先等几毫秒（0.4s 防误点等）
//   steps       界面上的操作：{tap:{web:<css>, webTestid:<id>, native:<id>, nativeSelector?:<选择器名>}, times, gap?} | {wait:ms} | {ready:{…}}
//               | {strokes:"redo"} | {js:"<函数体>"}（只网页）| {repeat:n, steps:[…]}
//   settle      操作完再等几毫秒（动画落定）
//   failNext    接下来 n 次写入失败（D07 三段式；也可用启动参数 -shizi-qa-fail-next）

struct QAFixture {
    let name: String
    let json: [String: Any]

    static var dir: URL? { Bundle.main.resourceURL?.appendingPathComponent("QAStates", isDirectory: true) }

    private static func read(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func merge(_ base: [String: Any], _ over: [String: Any]) -> [String: Any] {
        var out = base
        for (k, v) in over {
            if let a = out[k] as? [String: Any], let b = v as? [String: Any] { out[k] = merge(a, b) } else { out[k] = v }
        }
        return out
    }

    static func load(_ name: String) -> QAFixture? {
        guard let dir, var obj = read(dir.appendingPathComponent("\(name).json")) else { return nil }
        if let t = obj["template"] as? String, let tpl = read(dir.appendingPathComponent("_templates/\(t).json")) { obj = merge(tpl, obj) }
        return QAFixture(name: name, json: obj)
    }

    /// 参与逐屏取证的状态名（parity != false、不是内部夹具；原生模式再要求 native == true），按文件名排序。
    static func parityNames(native: Bool) -> [String] {
        guard let dir, let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        // 顺序：夹具的 order（小的在前，缺省最后），再按名字——与 scripts/native-ui/registry.mjs 同一规则
        let all = files.filter { $0.hasSuffix(".json") && !$0.hasPrefix("_") }.map { String($0.dropLast(5)) }.compactMap { load($0) }
        return all.filter { $0.bool("parity") != false && (!native || $0.bool("native") == true) }
            .sorted { a, b in
                let (oa, ob) = ((a.json["order"] as? NSNumber)?.doubleValue ?? 1e6, (b.json["order"] as? NSNumber)?.doubleValue ?? 1e6)
                return oa != ob ? oa < ob : a.name < b.name
            }.map(\.name)
    }

    /// States/_runtime/<名>.js 的全文（缺文件返回空串，注入会报脚本错）。
    static func runtimeFile(_ name: String) -> String {
        guard let dir = dir?.appendingPathComponent("_runtime/\(name).js") else { return "" }
        return (try? String(contentsOf: dir, encoding: .utf8)) ?? ""
    }

    /// 全部 op：States/_ops/*.js，每个文件是 async (ctx, a) 的函数体，文件名 = op 名。
    static let opsSource: String = {
        guard let dir = dir?.appendingPathComponent("_ops"), let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return "" }
        return files.filter { $0.hasSuffix(".js") }.sorted().compactMap { f -> String? in
            guard let body = try? String(contentsOf: dir.appendingPathComponent(f), encoding: .utf8) else { return nil }
            let async = body.contains("await ") ? "async " : "" // 没有 await 的 op 是同步函数（见 _runtime/epilogue.js）
            return "OPS[\(WebViewController.jsonLiteral(String(f.dropLast(3))) ?? "''")] = \(async)(ctx, a) => {\n\(body)\n};\n"
        }.joined()
    }()

    func string(_ k: String) -> String? { json[k] as? String }
    func bool(_ k: String) -> Bool? { json[k] as? Bool }
    func dict(_ k: String) -> [String: Any]? { json[k] as? [String: Any] }
    func array(_ k: String) -> [[String: Any]] { json[k] as? [[String: Any]] ?? [] }
    func ms(_ k: String) -> UInt64 { UInt64(max(0, (json[k] as? NSNumber)?.doubleValue ?? 0)) * 1_000_000 }
}

extension WebViewController {
    // MARK: 状态注入（夹具驱动）

    /// 把 App 带到 state（夹具名）。返回 nil = 成功，否则是错误说明。
    func qaPrepare(_ state: String, ui: String) async -> String? {
        guard let fx = QAFixture.load(state) else { return "no fixture '\(state)' (QAStates/\(state).json)" }
        return await qaRun(fx, ui: ui, top: true)
    }

    private func qaRun(_ fx: QAFixture, ui: String, top: Bool) async -> String? {
        // 1. 收掉现有原生页（只顶层夹具做；base 链里后一个夹具接着前一个的现场）
        if top { await qaDismissNativePages() }
        let hasBase = fx.string("base") != nil
        if let b = fx.string("base") {
            guard let bf = QAFixture.load(b) else { return "no base fixture '\(b)'" }
            if let err = await qaRun(bf, ui: ui, top: false) { return err }
        }
        // 2. 数据与导航（页面里）
        let setup = fx.array("setup")
        if !hasBase || !setup.isEmpty {
            do {
                let pin = (fx.dict("clock")?["pin"] as? String) ?? ""
                let v = try await webView.callAsyncJavaScript(Self.qaRunJS(),
                    arguments: ["setup": setup, "pin": pin, "chars": Self.qaChars, "clock": Self.qaClock, "reset": !hasBase], in: nil, contentWorld: .page)
                if let d = v as? [String: Any], (d["ok"] as? Bool) != true { return "prepare: \(d["error"] ?? "?")" }
            } catch {
                return "prepare js: \(error)"
            }
            await qaRememberClock()
            let failN = Self.qaArg("-shizi-qa-fail-next").flatMap(Int.init) ?? (fx.json["failNext"] as? Int) ?? 0
            if failN > 0 {
                // D07 三段式：接下来 n 次写入失败（页面测试钩子 failNextWrite，与 e2e / ShiziWriteTests 同一个）
                _ = await qaJS("return window.__shiziTest.failNextWrite(\(failN), {kind:'generic'});")
            }
        }
        // 3. 等页面出现、转场结束
        if let ready = fx.dict("ready"), let err = await qaWaitReady(ready, ui: ui) { return err }
        try? await Task.sleep(nanoseconds: fx.ms("settleBefore"))
        // 4. 界面上的操作（与真人同一个按钮动作）
        if let err = await qaRunSteps(fx.array("steps"), ui: ui) { return err }
        // 5. 落定：提示淡入 / 弹层 / 撤销条 / 笔顺快放
        try? await Task.sleep(nanoseconds: fx.ms("settle"))
        return nil
    }

    /// 收掉现有原生页（写字 / 结果 / 其它原生宿主）。
    private func qaDismissNativePages() async {
        await stage.resetScreensForTesting() // B3.2：通用原生页（关于等）先交出，收起时不发 nav.back
        if let top = nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        if let top = nativeResultTop {
            top.exitHandled = true
            top.dismiss(animated: false)
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        if let p = presentedViewController {
            p.dismiss(animated: false)
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
    }

    // MARK: 等页面

    private func qaWaitReady(_ r: [String: Any], ui: String) async -> String? {
        let timeout = (r["timeout"] as? NSNumber)?.doubleValue ?? 5
        // rootsOnly（B3.5c）：tab 根页的原生版只在根页开关打开时才有（-shizi-native-roots）；没开时这个状态的起点还是网页根页，按网页等
        let rootsOn = ProcessInfo.processInfo.arguments.contains("-shizi-native-roots") || ProcessInfo.processInfo.environment["SHIZI_NATIVE_ROOTS"] == "1"
        if ui == "native", (r["rootsOnly"] as? Bool) != true || rootsOn {
            guard let spec = r["native"] as? String else { return nil }
            guard await qaWait(timeout, { self.qaNativeReady(spec) }) else { return "native page did not appear (\(spec)) top=\(stage.topScreen?.screen ?? "nil") presented=\(String(describing: presentedViewController.map { String(describing: type(of: $0)) })) being=\(String(describing: presentedViewController?.isBeingPresented)) running=\(NativeWriteTransitions.running)" }
        } else {
            var sel = r["webSelector"] as? String
            if sel == nil, let tid = r["web"] as? String { sel = ".sz-layer[data-top=\"true\"] [data-testid=\"\(tid)\"]" }
            guard let sel else { return nil }
            let js = "const a=document.querySelector('.sz-app');const l=document.querySelector(\(Self.jsonLiteral(sel) ?? "''"));return !!a && a.dataset.navAnim==='idle' && !!l;"
            guard await qaWait(timeout, { await self.qaJS(js) as? Bool == true }) else { return "web page did not appear (\(sel))" }
        }
        return nil
    }

    private func qaNativeReady(_ spec: String) -> Bool {
        let settled = presentedViewController?.isBeingPresented == false
        switch spec {
        case "write": return nativeWriteTop != nil && settled && NativeWriteTransitions.running == 0
        case "result": return nativeResultTop != nil && settled && NativeWriteTransitions.running == 0
        case "redo": return nativeRedoTop != nil && settled
        default:
            // "id:<accessibilityIdentifier>"：页面里有这个元素，且转场结束（页面卡的原生页用这个，不必改这里）
            guard spec.hasPrefix("id:"), let root = stage.topScreen?.view ?? presentedViewController?.view else { return false } // B3.2：通用原生栈取顶层页
            return settled && NativeWriteTransitions.running == 0 && qaFindView(in: root, id: String(spec.dropFirst(3))) != nil
        }
    }

    // MARK: 操作步骤

    private func qaRunSteps(_ steps: [[String: Any]], ui: String) async -> String? {
        for step in steps {
            if let w = (step["wait"] as? NSNumber)?.doubleValue {
                try? await Task.sleep(nanoseconds: UInt64(max(0, w)) * 1_000_000)
            } else if let t = step["tap"] as? [String: Any] {
                await qaTap(ui, t, times: (step["times"] as? Int) ?? 1, gap: (step["gap"] as? NSNumber)?.doubleValue ?? 550)
            } else if let r = step["ready"] as? [String: Any] {
                if let err = await qaWaitReady(r, ui: ui) { return err }
            } else if (step["strokes"] as? String) != nil {
                await qaDrawStrokes(ui)
            } else if let js = step["js"] as? String {
                if ui == "web" { _ = await qaJS(js) }
            } else if let n = step["repeat"] as? Int, let sub = step["steps"] as? [[String: Any]] {
                for _ in 0..<n { if let err = await qaRunSteps(sub, ui: ui) { return err } }
            }
        }
        return nil
    }

    private func qaTap(_ ui: String, _ spec: [String: Any], times: Int, gap: Double) async {
        for i in 0..<times {
            if i > 0 { try? await Task.sleep(nanoseconds: UInt64(gap) * 1_000_000) } // 同一按钮两次按下隔 0.4s
            if ui == "native" {
                guard let host = stage.topScreen ?? presentedViewController else { return } // B3.2：通用原生栈取顶层页
                // id 可带 #N（同名的第 N 个，从 0 起）；原生页自己呈现的弹层（B3.5c 选择弹层）在页面的 presentedViewController 里，先找它
                let raw = spec["native"] as? String ?? ""
                let parts = raw.split(separator: "#", maxSplits: 1).map(String.init)
                let id = parts.first ?? ""
                let nth = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
                var found: [UIView] = []
                if let sheet = host.presentedViewController?.view { qaFindViews(in: sheet, id: id, into: &found) }
                if found.isEmpty { qaFindViews(in: host.view, id: id, into: &found) }
                // 走按钮自己的 action（含 0.4s 防误点），没有就直接调动作函数
                if nth < found.count, let b = found[nth] as? UIButton, b.isEnabled, !b.isHidden {
                    b.sendActions(for: .touchUpInside)
                } else if let sel = spec["nativeSelector"] as? String, let vc = nativeWriteTop {
                    vc.perform(Selector((sel)))
                }
            } else {
                var sel = spec["web"] as? String
                if sel == nil, let tid = spec["webTestid"] as? String { sel = ".sz-layer[data-top=\"true\"] [data-testid=\"\(tid)\"]" }
                guard let sel else { return }
                _ = await qaJS("const el=document.querySelector(\(Self.jsonLiteral(sel) ?? "''"));if(!el||el.disabled)return false;el.click();return true;")
            }
        }
    }

    func qaFindViews(in root: UIView, id: String, into out: inout [UIView]) {
        if root.accessibilityIdentifier == id { out.append(root) }
        for s in root.subviews { qaFindViews(in: s, id: id, into: &out) }
    }

    func qaFindView(in root: UIView, id: String) -> UIView? {
        if root.accessibilityIdentifier == id { return root }
        for s in root.subviews { if let v = qaFindView(in: s, id: id) { return v } }
        return nil
    }

    private func qaFindInk(in root: UIView) -> NativeInkView? {
        if let v = root as? NativeInkView { return v }
        for s in root.subviews { if let v = qaFindInk(in: s) { return v } }
        return nil
    }

    // MARK: 写笔画（重写错字页）

    /// 两边同一组笔画（345 单位，与写字页 recall-ink 注入的两笔同形：一横一竖，每 16ms 一点）。
    static let qaRedoLines: [[(Double, Double)]] = [
        (0..<14).map { (i: Int) -> (Double, Double) in let d = Double(i); return (70 + 15 * d, 150 + d) },
        (0..<14).map { (i: Int) -> (Double, Double) in let d = Double(i); return (172 + 0.5 * d, 60 + 17 * d) },
    ]

    /// 原生：交给书写面同一个抬笔回调（与真笔写完一笔同一路径）；网页：在书写格的 live 画布上按 16ms 间隔派发指针事件（InkGrid 同一个 onDown / onMove / onUp）。
    private func qaDrawStrokes(_ ui: String) async {
        if ui == "native" {
            guard let host = presentedViewController, let ink = qaFindInk(in: host.view) else { return }
            for (k, line) in Self.qaRedoLines.enumerated() {
                let t0 = CACurrentMediaTime() * 1000 + Double(k) * 1000
                ink.delegate?.nativeInkDidEndStroke(ink, raw: line.enumerated().map { InkRawPoint(x: $0.element.0, y: $0.element.1, t: t0 + Double($0.offset) * 16) })
            }
            return
        }
        let lines = Self.qaRedoLines.map { $0.map { [$0.0, $0.1] } }
        _ = try? await webView.callAsyncJavaScript(Self.qaWebStrokesJS, arguments: ["lines": lines], in: nil, contentWorld: .page)
    }

    static var qaWebStrokesJS: String { QAFixture.runtimeFile("strokes") }

    // MARK: 读屏名称表（网页）

    /// 网页读屏名称表：顶层图层与弹层 / 确认框 / 撤销条里读屏会读到的元素（aria-hidden 子树不算）：
    /// {tag, role, name, live?, id?, disabled?, text?}。name = aria-label → aria-labelledby → 可见文字。取证成 JSON（B3B4 §5.4），原生页逐项比 accessibilityLabel。
    static let qaWebAxJS = #"""
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const roots = [top, ...document.querySelectorAll('.sz-sheet, .sz-confirm, .sz-undobar, .sz-toast, .sz-corrupt, [role="dialog"], [role="alertdialog"]')].filter(Boolean);
    const W = window.innerWidth, H = window.innerHeight;
    const seen = new Set();
    const out = [];
    const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const hidden = (el, root) => {
      for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || e.getAttribute('aria-hidden') === 'true') return true;
      }
      return false;
    };
    const implicit = { BUTTON: 'button', A: 'link', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', IMG: 'img' };
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('button, a, input, select, textarea, h1, h2, h3, img, [role], [aria-label], [aria-labelledby], [aria-live], [tabindex]')]) {
        if (seen.has(el) || hidden(el, root)) continue;
        const rc = el.getBoundingClientRect();
        const live = el.getAttribute('aria-live');
        const sr = rc.width <= 2 && rc.height <= 2;
        if (!live && (rc.width < 0.5 || rc.height < 0.5) && !sr) continue;
        if (!live && (rc.right < 0 || rc.bottom < 0 || rc.left > W || rc.top > H)) continue;
        seen.add(el);
        let name = el.getAttribute('aria-label');
        if (!name && el.getAttribute('aria-labelledby')) name = el.getAttribute('aria-labelledby').split(/\s+/).map(i => { const n = document.getElementById(i); return n ? text(n) : ''; }).join(' ').trim();
        if (!name && ['BUTTON', 'A', 'H1', 'H2', 'H3'].includes(el.tagName)) name = text(el);
        if (!name && el.tagName === 'IMG') name = el.getAttribute('alt') || '';
        const role = el.getAttribute('role') || implicit[el.tagName] || '';
        if (!name && !live && !role) continue;
        const e = { tag: el.tagName.toLowerCase(), role, name: name || '' };
        if (live) { e.live = live; e.text = text(el); }
        if (el.dataset && el.dataset.testid) e.id = el.dataset.testid;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') e.disabled = true;
        if (sr) e.srOnly = true;
        out.push(e);
      }
    }
    return out;
    """#

    // MARK: 页面脚本

    /// 造数据脚本 = 前导（States/_runtime/prologue.js：清空 → 可选钉时钟 → ctx）+ 全部 op（States/_ops/*.js）+ 收尾（逐条执行 setup）。
    /// 参数：setup（[{op,…}]）、pin（ISO 本地时间或空）、chars（固定 5 字）、clock（-shizi-qa-clock）、reset（顶层夹具 true；base 链接着前一个的现场）。
    /// 同一份文件也由开发工具 scripts/native-ui/fixture-dev.mjs（Chromium）使用。
    static func qaRunJS() -> String {
        QAFixture.runtimeFile("prologue") + QAFixture.opsSource + QAFixture.runtimeFile("epilogue")
    }
}
#endif
