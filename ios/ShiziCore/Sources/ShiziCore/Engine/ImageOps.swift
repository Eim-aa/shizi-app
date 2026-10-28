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
        "images.sheetGrid": { _, a in
            try ImageLayout.sheetGrid(
                int(a, "n", 1_000_000), width: numberArg(a, "width"), unit: a["unit"]?.numberValue ?? 1,
                maxHeight: a["maxHeight"]?.numberValue ?? .infinity, cols: Int(a["cols"]?.numberValue ?? 0))
        },
        "images.glyphLayout": { _, a in
            try ImageLayout.glyphLayout(
                a["bounds"] ?? .null, ratio: a["ratio"]?.stringValue ?? "portrait")
        },
        "images.inkBounds": { _, a in ImageLayout.inkBounds(a["points"] ?? .array([])) },
        "images.paginate": { _, a in
            .array(
                ImageLayout.paginate(try array(a, "cells"), max: Int(a["max"]?.numberValue ?? 80)).map(
                    JSValue.array))
        },
        "images.withDayTags": { _, a in .array(ImageLayout.withDayTags(try array(a, "cells"))) },
        "images.sheetTags": { _, a in .array(ImageLayout.sheetTags(try array(a, "cells"))) },
    ]
}
