import Foundation

extension CoreEngine {
    static let imageOps: [String: Op] = [
        "images.plan": { e, a in
            let ink = a["ink"] ?? .null
            return try ImageSelection.imagePlan(
                a["state"] ?? .null, scope: a["scope"] ?? .null,
                inkOf: { ink[$0["id"]?.stringValue ?? ""] },
                maxChars: Int(a["maxChars"]?.numberValue ?? 80),
                monthPick: a["monthPick"]?.stringValue ?? "first", dates: e.dates)
        },
        "images.work": { _, a in
            let ids = a["inkIds"]?.arrayValue ?? []
            return ImageSelection.buildWork(
                items: a["items"]?.arrayValue ?? [], records: a["records"]?.arrayValue ?? [],
                hasInk: { ids.contains($0["id"] ?? .null) },
                added: (a["added"]?.arrayValue ?? []).compactMap(\.stringValue))
        },
        "images.layout": { _, a in
            try ImageLayout.layout(
                int(a, "n", 1_000_000), ratio: a["ratio"]?.stringValue ?? "3:4",
                sheet: a["sheet"]?.boolValue ?? false)
        },
    ]
}
