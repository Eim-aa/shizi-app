import Foundation

public enum AboutView {
    static let kinds = ["code", "data", "font"]
    public static func buildDay(_ build: JSValue?) -> String {
        let s = JS.string(build), u = Array(s.utf8)
        if u.count >= 9 && u[8] == 45 && u.prefix(8).allSatisfy({ $0 >= 48 && $0 <= 57 }) {
            return String(decoding: u.prefix(8), as: UTF8.self)
        }
        return s
    }
    public static func stripArrow(_ text: JSValue?) -> String {
        let s = ViewSupport.trimEnd(JS.string(text))
        return s.hasSuffix("›") ? ViewSupport.trimEnd(String(s.dropLast())) : JS.string(text)
    }
    public static func versionRefs(_ version: JSValue?, _ build: JSValue?) -> JSValue {
        var vars = JSObject()
        vars["version"] = version
        vars["day"] = .string(buildDay(build))
        var full = JSObject(); full["build"] = build
        return ViewSupport.obj([("line", ViewSupport.ref("X-ABOUT.version", .object(vars))), ("aria", ViewSupport.ref("X-ABOUT.versionAria", .object(vars))), ("full", ViewSupport.ref("X-ABOUT.buildFull", .object(full)))])
    }
    public static func aboutRowRefs() -> JSValue {
        .array([
            ViewSupport.obj([("key", .string("privacy")), ("label", ViewSupport.ref("X-ABOUT.privacy")), ("value", ViewSupport.ref("R-AB01.privacyRow")), ("to", .string("about-privacy"))]),
            ViewSupport.obj([("key", .string("credits")), ("label", ViewSupport.ref("R-AB01.openSourceRow")), ("value", .null), ("to", .string("about-credits"))]),
            ViewSupport.obj([("key", .string("letter")), ("label", ViewSupport.ref("R-AB01.letterTitle")), ("value", .null), ("to", .string("about-letter"))]),
        ])
    }
    public static func aboutModel(_ args: JSObject) throws -> JSValue {
        ViewSupport.obj([("title", ViewSupport.ref("X-ABOUT.title")), ("name", ViewSupport.ref("X-ABOUT.appName")), ("version", versionRefs(args["version"], args["build"])), ("motto", ViewSupport.ref("X-ABOUT.motto")), ("rows", aboutRowRefs()), ("seal", try CoreResources.load("view-seal"))])
    }
    public static func privacyModel(_ native: JSValue?) -> JSValue {
        ViewSupport.obj([("title", ViewSupport.ref("X-ABOUT.privacy")), ("paragraphs", .array(["X-ABOUT.privacy1", "X-ABOUT.privacy2", JS.truthy(native) ? "X-ABOUT.privacy3Native" : "X-ABOUT.privacy3Web", "X-ABOUT.privacy4"].map { ViewSupport.ref($0) }))])
    }
    public static func creditName(_ credit: JSValue) -> JSValue? {
        JS.truthy(credit["version"]) ? .string(JS.string(credit["name"]) + " " + JS.string(credit["version"])) : credit["name"]
    }
    public static func creditFullText(_ credit: JSValue, texts: JSValue = Config.credits["LICENSE_TEXTS"]!) -> String {
        var parts = [credit["notice"]].compactMap { $0 }
        for p in credit["licenseFiles"]?.arrayValue ?? [] {
            let key = JS.string(p)
            if let text = texts[key], JS.truthy(text) {
                parts.append(.string("— " + key + " —\n\n" + ViewSupport.trimEnd(JS.string(text))))
            }
        }
        return parts.filter { JS.truthy($0) }.map { JS.string($0) }.joined(separator: "\n\n")
    }
    public static func creditGroupRefs(_ credits: [JSValue] = Config.credits["CREDITS"]!.arrayValue!) -> [JSValue] {
        kinds.compactMap { kind in
            let items = credits.filter { JS.isString($0["kind"], kind) }
            guard !items.isEmpty else { return nil }
            return ViewSupport.obj([("kind", .string(kind)), ("title", ViewSupport.ref("X-ABOUT.group" + kind.prefix(1).uppercased() + kind.dropFirst())), ("items", .array(items))])
        }
    }
    public static func creditsModel(_ credits: [JSValue] = Config.credits["CREDITS"]!.arrayValue!, texts: JSValue = Config.credits["LICENSE_TEXTS"]!) -> JSValue {
        let groups = creditGroupRefs(credits).map { group -> JSValue in
            let items = group["items"]!.arrayValue!.map { c -> JSValue in
                var o = JSObject(); o["id"] = c["id"]; o["kind"] = c["kind"]; o["name"] = creditName(c)
                o["license"] = JS.truthy(c["license"]) ? c["license"] : .string("")
                o["url"] = JS.truthy(c["url"]) ? c["url"] : .string("")
                o["text"] = .string(creditFullText(c, texts: texts))
                return .object(o)
            }
            return ViewSupport.obj([("kind", group["kind"]!), ("title", group["title"]!), ("items", .array(items))])
        }
        return ViewSupport.obj([("title", ViewSupport.ref("X-ABOUT.creditsTitle")), ("intro", ViewSupport.ref("X-ABOUT.creditsIntro")), ("toggle", ViewSupport.ref("X-ABOUT.licenseMore")), ("groups", .array(groups))])
    }
    public static func letterModel() -> JSValue {
        ViewSupport.obj([("title", ViewSupport.ref("R-AB01.letterTitle")), ("address", ViewSupport.ref("R-AB01.letterAddressPending"))])
    }
}
