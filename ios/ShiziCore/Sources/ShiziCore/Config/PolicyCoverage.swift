import Foundation

// policy 的 P 编号登记检查（scripts/verify_copy.mjs checkPolicySource 的 Swift 对应）：每个导出与每个嵌套键都带一个已在 03 表登记的 P 编号。
// JS 一侧扫 policy.js 源码里的注释；Swift 一侧读生成的 policy-meta.json（同一次扫描的结果）再做同样的判定，
// 这样「检查本身会抓到坏数据」也能在 Swift 里测（把登记表改坏，应当报错）。

public enum PolicyCoverage {
    /// 返回错误列表（空 = 通过）。pMap = policy-meta.json 的 exports：{导出名: {p: [P…], keys: {键: [P…]}}}。
    public static func errors(pMap: JSObject, registered: Set<String>) -> [String] {
        var errors: [String] = []
        for e in pMap.entries {
            let name = e.key
            let refs = e.value["p"]?.arrayValue?.compactMap { $0.stringValue } ?? []
            if refs.isEmpty { errors.append("policy." + name + ": export has no P number in its comment") }
            for p in refs where !registered.contains(p) { errors.append("policy." + name + ": " + p + " is not registered") }
            for k in e.value["keys"]?.objectValue?.entries ?? [] {
                let keyRefs = k.value.arrayValue?.compactMap { $0.stringValue } ?? []
                if keyRefs.isEmpty { errors.append("policy." + name + "." + k.key + ": key has no P number in its comment") }
                for p in keyRefs where !registered.contains(p) { errors.append("policy." + name + "." + k.key + ": " + p + " is not registered") }
            }
        }
        return errors
    }

    public static var registered: Set<String> {
        Set(Config.policyMeta["registered"]?.arrayValue?.compactMap { $0.stringValue } ?? [])
    }

    public static var covered: Set<String> {
        Set(Config.policyMeta["covered"]?.arrayValue?.compactMap { $0.stringValue } ?? [])
    }

    public static var pMap: JSObject { Config.policyMeta["exports"]?.objectValue ?? JSObject() }
}
