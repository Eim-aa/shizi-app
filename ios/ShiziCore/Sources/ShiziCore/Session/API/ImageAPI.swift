import Foundation

// src/session/api/image.js. The task builder/renderer/persistence are injected by B4.6/host.
// This is the complete action-dispatch envelope; it never draws or saves an image.
extension PageAPI {
    static func image(_ op: String, _ a: JSObject, hooks: SessionActionHooks?) throws -> JSValue {
        guard let result = try hooks?.invoke(op, a) else { return SessionWrites.failure("unavailable") }
        if result["ok"] == .bool(false) { return reply(result) }
        if result.objectValue == nil && result.arrayValue == nil { return SessionWrites.failure("invalid-reply") }
        return result
    }
}
