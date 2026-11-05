import UIKit

// ShiziKit（B3.1；计划 B3B4-原生化架构与计划.md §3.2）：令牌、文案、动效的单一来源 = 构建期生成的资源
// （ShiziKit/Generated/ShiziKitTokens.json、ShiziKitCopy.json 是手改的唯一真相源，D84 起不再由脚本生成；
//  生成物与来源不同步时 test/ios-shizikit.test.mjs 失败）。原生源码不写颜色、字号、时长与汉字。
//
// B2 的写字 / 判断 / 结果 / 重写错字页原来从写字会话 API 的 open 回包读颜色、字阶、文案与动效（页面现算）；B3.1 起这些键一律取生成值
// （ShiziLook.resolve），回包只提供每次会话才有的东西：快照、页面主题（theme：「我的 › 外观」可以强制浅 / 深，原生跟页面走）、AX 档逐元素量值（type.ax / type.roles）、
// 版式 / 墨 / 描红 / 撤销条寿命（policy 规则参数，B4 随 ShiziCore 进 Swift）。DEBUG 下回包里同名键的值仍拿来与生成值逐项核对（不一致记日志与 ShiziLook.mismatches）。

/// 包里的生成资源（JSON）。
enum ShiziKitResource {
    static func load(_ name: String) -> Any? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"), let data = try? Data(contentsOf: url) else {
            ShiziProbe.log("ShiziKit: missing \(name).json")
            return nil
        }
        return try? JSONSerialization.jsonObject(with: data)
    }
}

/// 设计令牌（颜色浅 / 深、字阶按系统字号档位、间距 / 圆角 / 线 / 触控、动效）。
enum ShiziTokens {
    static let root: [String: Any] = ShiziKitResource.load("ShiziKitTokens") as? [String: Any] ?? [:]

    enum Theme: String {
        case light, dark

        /// 页面给的主题（open 回包 theme）；没有时跟系统。
        static func of(_ raw: Any?, trait: UITraitCollection = .current) -> Theme {
            if let s = raw as? String, let t = Theme(rawValue: s) { return t }
            return trait.userInterfaceStyle == .dark ? .dark : .light
        }
    }

    // MARK: 颜色

    /// 颜色令牌原文（"#RRGGBB" / "rgba(…)" / box-shadow 串；与页面 getComputedStyle(--名) 同一串）。
    static func colorStrings(_ theme: Theme) -> [String: String] {
        ((root["colors"] as? [String: Any])?[theme.rawValue] as? [String: String]) ?? [:]
    }

    static func color(_ name: String, _ theme: Theme) -> UIColor? {
        colorLock.lock()
        defer { colorLock.unlock() }
        return parsedColor(name, theme)
    }

    /// 随浅 / 深自动切换的颜色（B3 页面用；B2 页面按页面主题取定值）。
    /// 令牌表（root）是包里的只读资源，同名同主题的解析结果永远相同 → 每个名字只解析一次、同一个对象反复给
    /// （以前每次调用都把 33 项的颜色表桥接成 Swift 字典再解析两遍十六进制；字库页每格 6 次左右）。
    static func dynamicColor(_ name: String) -> UIColor? {
        colorLock.lock()
        defer { colorLock.unlock() }
        if let hit = dynamicColors[name] { return hit }
        var made: UIColor?
        if let light = parsedColor(name, .light), let dark = parsedColor(name, .dark) {
            made = UIColor { $0.userInterfaceStyle == .dark ? dark : light }
        }
        dynamicColors.updateValue(made, forKey: name) // 没有的名字也记下（nil）
        return made
    }

    /// 解析过的颜色（名字 → 颜色；没有这个令牌 / 解析不了 = nil，也记下）。读写都在 colorLock 里。
    private static let colorLock = NSLock()
    private static var lightColors: [String: UIColor?] = [:]
    private static var darkColors: [String: UIColor?] = [:]
    private static var dynamicColors: [String: UIColor?] = [:]

    /// 调用方已持有 colorLock。
    private static func parsedColor(_ name: String, _ theme: Theme) -> UIColor? {
        switch theme {
        case .light: if let hit = lightColors[name] { return hit }
        case .dark: if let hit = darkColors[name] { return hit }
        }
        let made = NativeInkWire.uiColor(colorStrings(theme)[name])
        switch theme {
        case .light: lightColors.updateValue(made, forKey: name)
        case .dark: darkColors.updateValue(made, forKey: name)
        }
        return made
    }

    // MARK: 字阶

    /// 系统字号档位名（xS … XXXL、AX1 … AX5；与 JS 参考版同名，RootViewController.contentSizeName）。
    static func categoryName(_ category: UIContentSizeCategory) -> String { RootViewController.contentSizeName(category) }

    /// 该档位的长度令牌（pt：fs13 / lh13 … / btn-h / r-box / gutter …）= 页面 --名 在该档位的计算值（WebKit 1/64 截断）。表里没有的档位 → nil。
    static func lengths(_ category: UIContentSizeCategory) -> [String: CGFloat]? {
        let cats = (root["type"] as? [String: Any])?["categories"] as? [String: Any]
        guard let row = (cats?[categoryName(category)] as? [String: Any])?["values"] as? [String: NSNumber] else { return nil }
        return row.mapValues { CGFloat($0.doubleValue) }
    }

    /// 某个长度令牌（当前系统字号档位）。
    static func length(_ name: String, _ category: UIContentSizeCategory = UIApplication.shared.preferredContentSizeCategory) -> CGFloat? {
        lengths(category)?[name]
    }

    // MARK: 动效

    /// 写字页 / 结果页回包形状的动效与时刻（writeMotion / resultMotion / writeTiming 同一份值）。
    static func pageMotion(_ page: ShiziLook.Page) -> [String: Any] { ((root[page.rawValue] as? [String: Any])?["motion"] as? [String: Any]) ?? [:] }
    static func pageTiming(_ page: ShiziLook.Page) -> [String: Any] { ((root[page.rawValue] as? [String: Any])?["timing"] as? [String: Any]) ?? [:] }

    /// 全部数据导出（duration / role / moment / easing / bezier / scale / distance / gesture / timing / haptic …），给 B3 页面。
    static var motion: [String: Any] { root["motion"] as? [String: Any] ?? [:] }
}

/// 文案（合并后的 COPY；占位符 {n} {char} … 由 t 的参数填，缺值原样保留——与页面 format() 同一规则）。
enum ShiziCopy {
    static let table: [String: Any] = ShiziKitResource.load("ShiziKitCopy") as? [String: Any] ?? [:]

    /// 全部单串文案（数组值的多行文案用 lines）。
    static let strings: [String: String] = table.compactMapValues { $0 as? String }

    static func t(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        fill(strings[key] ?? "", vars)
    }

    static func lines(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> [String] {
        if let a = table[key] as? [String] { return a.map { fill($0, vars) } }
        return strings[key].map { [fill($0, vars)] } ?? []
    }

    private static func fill(_ s: String, _ vars: [String: CustomStringConvertible]) -> String {
        var out = s
        for (k, v) in vars { out = out.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return out
    }
}

/// B2 页面的外观来源（B3.1）：open / redoOpen 回包、结果页 resultLook → 颜色、字阶、文案、动效、时刻换成生成值，其余键原样。
enum ShiziLook {
    enum Page: String {
        case write, result
    }

    /// 已换过的标记（同一份回包再经过一次不重复核对）。
    private static let resolvedKey = "shiziKit"

    static func resolve(_ payload: [String: Any], page: Page) -> [String: Any] {
        guard payload[resolvedKey] == nil else { return payload }
        var out = payload
        out[resolvedKey] = true
        let theme = ShiziTokens.Theme.of(payload["theme"])
        out["copy"] = ShiziCopy.strings
        out["colors"] = ShiziTokens.colorStrings(theme)
        let category = UIApplication.shared.preferredContentSizeCategory
        if let lengths = ShiziTokens.lengths(category) {
            // AX 档位与逐元素版式：原生常量（D81 ①，NativeAXLayout）；回包里页面给的 ax / roles 不再采用
            var type: [String: Any] = lengths.filter { $0.value > 0 }.mapValues { NSNumber(value: Double($0)) }
            let level = NativeAXLayout.level(category)
            if level > 0 {
                type["ax"] = NSNumber(value: level)
                type["roles"] = NativeAXLayout.roles(level)
            }
            out["type"] = type
        }
        out["motion"] = ShiziTokens.pageMotion(page)
        out["timing"] = ShiziTokens.pageTiming(page)
        #if DEBUG
        check(payload, out, theme: theme)
        #endif
        return out
    }

    #if DEBUG
    /// 回包同名键与生成值不一致的地方（「键路径: 回包值 ≠ 生成值」）；XCTest / 手动核对读它。
    private(set) static var mismatches: [String] = []

    private static func check(_ payload: [String: Any], _ out: [String: Any], theme: ShiziTokens.Theme) {
        var bad: [String] = []
        func cmp(_ path: String, _ a: Any?, _ b: Any?, onlyLeft: Bool) {
            if let da = a as? [String: Any] {
                guard let db = b as? [String: Any] else { bad.append("\(path): \(da) ≠ \(b ?? "nil")"); return }
                for (k, v) in da { cmp("\(path).\(k)", v, db[k], onlyLeft: onlyLeft) }
                if !onlyLeft { for k in db.keys where da[k] == nil { bad.append("\(path).\(k): missing in payload") } }
                return
            }
            if let na = a as? NSNumber, let nb = b as? NSNumber {
                if abs(na.doubleValue - nb.doubleValue) > 1e-6 { bad.append("\(path): \(na) ≠ \(nb)") }
                return
            }
            if let aa = a as? [Any], let ab = b as? [Any] {
                if aa.count != ab.count { bad.append("\(path): count \(aa.count) ≠ \(ab.count)"); return }
                for (i, x) in aa.enumerated() { cmp("\(path)[\(i)]", x, ab[i], onlyLeft: onlyLeft) }
                return
            }
            if let sa = a as? String, let sb = b as? String {
                if sa != sb { bad.append("\(path): \(sa) ≠ \(sb)") }
                return
            }
            bad.append("\(path): \(a ?? "nil") ≠ \(b ?? "nil")")
        }
        // 文案 / 颜色：回包只带这一页要的键（生成值是全集）；字阶：回包的数值键；动效与时刻：两边整份相同
        if let c = payload["copy"] { cmp("copy", c, out["copy"], onlyLeft: true) }
        if let c = payload["colors"] { cmp("colors[\(theme.rawValue)]", c, out["colors"], onlyLeft: true) }
        if let t = payload["type"] as? [String: Any] {
            cmp("type", t.filter { $0.key != "ax" && $0.key != "roles" }, out["type"], onlyLeft: true)
        }
        if let m = payload["motion"] { cmp("motion", m, out["motion"], onlyLeft: false) }
        if let t = payload["timing"] { cmp("timing", t, out["timing"], onlyLeft: false) }
        guard !bad.isEmpty else { return }
        mismatches.append(contentsOf: bad)
        if mismatches.count > 200 { mismatches.removeFirst(mismatches.count - 200) }
        for b in bad { ShiziProbe.log("ShiziKit mismatch \(b)") }
    }
    #endif
}
