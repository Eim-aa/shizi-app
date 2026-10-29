import Foundation

// src/session/api/about.js.
extension PageAPI {
    static func about(_ op: String, _ a: JSObject) throws -> JSValue {
        let view: JSValue
        switch op {
        case "view.about": view = try AboutView.aboutModel(a["build"]?.objectValue ?? JSObject([("version", .string("")), ("build", .string(""))]))
        case "view.about-privacy": view = AboutView.privacyModel(a["native"] ?? .bool(false))
        case "view.about-credits": view = AboutView.creditsModel(Config.credits["CREDITS"]!.arrayValue!, texts: Config.credits["LICENSE_TEXTS"]!)
        default: view = AboutView.letterModel()
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
    }
}
