import Foundation

public enum WriteWire {
    public static func nativeWriteEnabled(_ win: JSValue?, native: Bool = false) -> Bool {
        win?["__shiziNativeWrite"] == .bool(true) && (win?["__shiziNativeWriteForce"] == .bool(true) || native)
    }
    public static func helper(_ a: JSObject) -> JSValue {
        if a["name"] == .string("enabled") { return .bool(nativeWriteEnabled(a["win"])) }
        let raw = a["raw"]?.arrayValue ?? []
        let toWire = JSValue.array(raw.map { s in .array((s.arrayValue ?? []).map { p in .array([p["x"] ?? .null,p["y"] ?? .null,p["t"] ?? .null] + (p["p"]?.numberValue?.isFinite == true ? [p["p"]!] : [])) }) })
        return JS.obj([("toWire",toWire),("fromWire",CoreEngine.strokesJS(WriteModels.fromWire(a["wire"])))])
    }
}
