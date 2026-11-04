import Foundation

extension CoreEngine {
    static let apiOps: [String: Op] = [
        "api.call": { e,a in
            let op = try string(a, "op"), args = a["args"]?.objectValue ?? JSObject()
            let store = try e.session().store!; e.storeSession?.notices = []
            return PageAPI.call(op, store: store, args: args)
        },
    ]
}
