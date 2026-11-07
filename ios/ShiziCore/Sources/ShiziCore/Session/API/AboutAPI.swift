import Foundation

extension PageAPI {
    static func about(_ op: String, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        let view: JSValue
        switch op {
        case "view.about":
            let build = try hooks?.build?() ?? JS.obj([("version", .string("")), ("build", .string(""))])
            if build.isNull { throw CoreError.error("Cannot destructure property 'version' of 'object null' as it is null.") }
            view = try AboutView.aboutModel(build.objectValue ?? JSObject())
        case "view.about-privacy": view = AboutView.privacyModel(.bool(hooks?.native == true))
        case "view.about-credits": view = AboutView.creditsModel(Config.credits["CREDITS"]!.arrayValue!, texts: Config.credits["LICENSE_TEXTS"]!)
        default: view = AboutView.letterModel()
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
    }
}
