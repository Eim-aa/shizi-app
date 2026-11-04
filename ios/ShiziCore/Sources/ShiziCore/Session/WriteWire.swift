import Foundation

public enum WriteWire {
    /// 笔画点阵 → JSON（[[{x,y,t,p?}…]…]）。原在 CoreEngine（B43Ops）里，写字 / 结果页 / 图片动作也用，故放在 ShiziCore；package 供 ShiziCoreEngine 的 ink.* op 用。
    package static func strokesJS(_ s: [[InkPoint]]) -> JSValue { .array(s.map { .array($0.map { $0.js }) }) }
    public static func nativeWriteEnabled(_ win: JSValue?, native: Bool = false) -> Bool {
        win?["__shiziNativeWrite"] == .bool(true) && (win?["__shiziNativeWriteForce"] == .bool(true) || native)
    }
    public static func helper(_ a: JSObject) -> JSValue {
        if a["name"] == .string("enabled") { return .bool(nativeWriteEnabled(a["win"])) }
        let raw = a["raw"]?.arrayValue ?? []
        let toWire = JSValue.array(raw.map { s in .array((s.arrayValue ?? []).map { p in .array([p["x"] ?? .null,p["y"] ?? .null,p["t"] ?? .null] + (p["p"]?.numberValue?.isFinite == true ? [p["p"]!] : [])) }) })
        return JS.obj([("toWire",toWire),("fromWire",strokesJS(WriteModels.fromWire(a["wire"])))])
    }
}
