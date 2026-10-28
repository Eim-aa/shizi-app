import Foundation

/// Field-exact image geometry from core/images/layout.js and glyph-layout.js.
/// Coordinates are logical pixels; export applies 4/3 once at the bitmap boundary.
public enum ImageLayout {
  static func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
  static func nums(_ pairs: [(String, Double)]) -> JSValue {
    obj(pairs.map { ($0.0, .number($0.1)) })
  }
  static func round(_ n: Double) -> Double { floor(n + 0.5) }
  static func height(_ ratio: String) throws -> Double {
    guard ratio == "3:4" || ratio == "1:1" else { throw CoreError.badArgs("INVALID_RATIO") }
    return ratio == "3:4" ? 1440 : 1080
  }
  static func count(_ n: Int) throws {
    guard n >= 0 && n <= 1_000_000 else { throw CoreError.badArgs("INVALID_COUNT") }
  }
  public static func gridOf(_ n: Int, ratio: String = "3:4") throws -> JSValue {
    let h = try height(ratio)
    if n < 1 { return nums([("cols", 0), ("rows", 0), ("c", 0)]) }
    if n == 1 {
      return nums([("cols", 1), ("rows", 1), ("c", round(min(669.6, 0.62 * (h - 194 - 72))))])
    }
    var best = -Double.infinity
    var cols = 0.0
    var rows = 0.0
    var side = 0.0
    for k in 2...min(n, 10) {
      let kd = Double(k)
      let r = ceil(Double(n) / kd)
      if r > kd * h / 1080 + 0.01 { continue }
      let c = min(886 / kd, (h - 194 - 72) / r, r == 1 ? .infinity : 0.34 * 1080)
      let score = c * (1 - 0.8 * (r * kd - Double(n)) / Double(n))
      if score > best {
        best = score
        cols = kd
        rows = r
        side = c
      }
    }
    guard cols > 0 else { throw CoreError.badArgs("LAYOUT_DOES_NOT_FIT") }
    return nums([("cols", cols), ("rows", rows), ("c", floor(side))])
  }
  public static func layout(_ n: Int, ratio: String = "3:4", sheet: Bool = false) throws -> JSValue
  {
    try count(n)
    let h = try height(ratio)
    let u = 2.69
    let gap = sheet ? round(10 * u) : 38.0
    let tag = nums([("size", 30), ("left", round(3 * u))])
    if n == 0 {
      var o = JSObject([("W", .number(1080)), ("H", .number(h)), ("n", .number(0))])
      if sheet {
        o["grid"] = try sheetGrid(0, width: 0)
      } else {
        for k in ["cols", "rows", "c"] { o[k] = .number(0) }
      }
      for k in ["left", "top"] { o[k] = .number(0) }
      o["cells"] = .array([])
      if !sheet { o["frame"] = .array([]) }
      o["seal"] = .null
      o["kuan"] = .null
      o["below"] = .bool(false)
      if sheet { o["tag"] = tag }
      return .object(o)
    }
    let g =
      sheet
      ? try sheetGrid(n, width: 886, unit: u, maxHeight: h - 194 - gap - 64 - 17)
      : try gridOf(n, ratio: ratio)
    let cols = g["cols"]!.numberValue!
    let rows = g["rows"]!.numberValue!
    let c = g["c"]!.numberValue!
    let gw = cols * c
    let gh = rows * c
    let last = Double((n - 1) % Int(cols))
    let below = last == cols - 1
    let block = gh + gap + 64
    let top = round(rows == 1 && h > 1080 ? (h - block) * 0.4 : (h - block) / 2 - h * 0.025)
    let left = round((1080 - gw) / 2)
    let cells = (0..<n).map { i in
      nums([("x", left + Double(i % Int(cols)) * c), ("y", top + floor(Double(i) / cols) * c)])
    }
    let sx: Double
    let sy: Double
    let kr: Double
    let kt: Double
    if below {
      sx = left + (last + 1) * c - 64
      sy = top + gh + gap
      kr = sx - 22
      kt = sy + 32 - 36 * 0.7
    } else {
      sx = left + (last + 1) * c + (sheet ? round(8 * u) : round(c * 0.12))
      sy = top + gh - 64 - (sheet ? 0 : round(c * 0.06))
      kr = left + gw
      kt = top + gh + gap
    }
    var o = JSObject([("W", .number(1080)), ("H", .number(h)), ("n", .number(Double(n)))])
    if sheet { o["grid"] = g } else { for k in ["cols", "rows", "c"] { o[k] = g[k] } }
    o["left"] = .number(left)
    o["top"] = .number(top)
    o["cells"] = .array(cells)
    if !sheet {
      o["frame"] = .array(
        rows > 1 && !below
          ? [
            nums([("x", left), ("y", top), ("w", gw), ("h", (rows - 1) * c + 2)]),
            nums([("x", left), ("y", top + (rows - 1) * c), ("w", (last + 1) * c), ("h", c)]),
          ] : [nums([("x", left), ("y", top), ("w", gw), ("h", gh)])])
    }
    o["seal"] = nums([("x", sx), ("y", sy), ("size", 64), ("rotate", 0)])
    o["kuan"] = nums([("right", kr), ("top", kt), ("size", 36), ("lineHeight", 36 * 1.4)])
    o["below"] = .bool(below)
    if sheet { o["tag"] = tag }
    return .object(o)
  }
  public static func sheetColumns(_ n: Int) -> Int {
    n < 1 ? 0 : n <= 4 ? n : n <= 12 ? 4 : n <= 24 ? 6 : 8
  }
  public static func sheetGrid(
    _ n: Int, width: Double, unit: Double = 1, maxHeight: Double = .infinity, cols fixed: Int = 0
  ) throws -> JSValue {
    try count(n)
    if n == 0 {
      return obj([
        ("n", .number(0)), ("cols", .number(0)), ("rows", .number(0)), ("c", .number(0)),
        ("lastN", .number(0)), ("W", .number(0)), ("H", .number(0)), ("lastW", .number(0)),
        ("full", .bool(true)), ("cells", .array([])), ("outline", .string("")),
        ("inner", .string("")),
      ])
    }
    let cols = fixed >= 1 ? fixed : sheetColumns(n)
    let rows = Int(ceil(Double(n) / Double(cols)))
    var c = min(110 * unit, width / Double(cols))
    if maxHeight.isFinite && maxHeight > 0 { c = min(c, maxHeight / Double(rows)) }
    c = floor(c)
    let last = n - (rows - 1) * cols
    let w = Double(cols) * c
    let h = Double(rows) * c
    let lw = Double(last) * c
    let full = last == cols
    func s(_ v: Double) -> String { JSONWriter.stringify(.number(v)) }
    var inner = ""
    for r in 0..<rows {
      let rn = r < rows - 1 ? cols : last
      if rn > 1 {
        for k in 1..<rn { inner += "M\(s(Double(k)*c)) \(s(Double(r)*c))V\(s(Double(r+1)*c))" }
      }
    }
    if rows > 1 {
      for r in 1..<rows { inner += "M0 \(s(Double(r)*c))H\(s(Double(r==rows-1 ? last:cols)*c))" }
    }
    let outline =
      full ? "M0 0H\(s(w))V\(s(h))H0Z" : "M0 0H\(s(w))V\(s(Double(rows-1)*c))H\(s(lw))V\(s(h))H0Z"
    var o = nums([
      ("n", Double(n)), ("cols", Double(cols)), ("rows", Double(rows)), ("c", c),
      ("lastN", Double(last)), ("W", w), ("H", h), ("lastW", lw),
    ]).objectValue!
    o["full"] = .bool(full)
    o["cells"] = .array(
      (0..<n).map { i in
        nums([
          ("x", Double(i % cols) * c), ("y", Double(i / cols) * c), ("col", Double(i % cols)),
          ("row", Double(i / cols)),
        ])
      })
    o["outline"] = .string(outline)
    o["inner"] = .string(inner)
    return .object(o)
  }
  public static func inkBounds(_ points: JSValue) -> JSValue {
    var x0 = Double.infinity
    var y0 = Double.infinity
    var x1 = -Double.infinity
    var y1 = -Double.infinity
    for stroke in points.arrayValue ?? [] {
      for p in stroke.arrayValue ?? [] {
        guard let x = p["x"]?.numberValue, let y = p["y"]?.numberValue, x.isFinite, y.isFinite
        else { continue }
        let w = p["w"]?.numberValue ?? 0
        let r = w.isFinite && w > 0 ? w / 2 : 0
        x0 = min(x0, x - r)
        y0 = min(y0, y - r)
        x1 = max(x1, x + r)
        y1 = max(y1, y + r)
      }
    }
    return x1 > x0 && y1 > y0
      ? nums([("x", x0), ("y", y0), ("width", x1 - x0), ("height", y1 - y0)]) : .null
  }
  public static func glyphLayout(_ bounds: JSValue, ratio: String = "portrait") throws -> JSValue {
    guard ratio == "portrait" || ratio == "square" else { throw CoreError.badArgs("INVALID_RATIO") }
    let h = ratio == "portrait" ? 1440.0 : 1080.0
    var o = JSObject([
      ("status", .string("noInk")), ("ratio", .string(ratio)), ("width", .number(1080)),
      ("height", .number(h)), ("margin", .number(72)),
    ])
    guard let bw = bounds["width"]?.numberValue, let bh = bounds["height"]?.numberValue, bw > 0,
      bh > 0
    else { return .object(o) }
    let k = min(648 / bw, (h - 72 - 78 - 48 - 72 - 48 - 39) / bh)
    let w = bw * k
    let gh = bh * k
    let top = 72 + (h - 72 - 78 - 48 - 72 - (gh + 48 + 39)) / 2
    let left = (1080 - w) / 2
    let sx = 930.0
    let sy = h - 150
    o["status"] = .string("ready")
    o["k"] = .number(k)
    o["ox"] = .number(left - (bounds["x"]?.numberValue ?? 0) * k)
    o["oy"] = .number(top - (bounds["y"]?.numberValue ?? 0) * k)
    o["glyph"] = nums([("x", left), ("y", top), ("width", w), ("height", gh)])
    o["info"] = nums([("top", top + gh + 48), ("line", 39), ("font", 33), ("centerX", 540)])
    o["seal"] = nums([("x", sx), ("y", sy), ("size", 78), ("rotate", 0)])
    o["signature"] = nums([
      ("right", sx - 36), ("baseline", sy + 78 - 6), ("font", 26), ("tracking", 0.16),
    ])
    return .object(o)
  }
  public static func dayTag(_ day: String) -> String {
    let a = Array(day.utf8)
    guard a.count == 10, a[4] == 45, a[7] == 45,
      a.enumerated().allSatisfy({
        $0.offset == 4 || $0.offset == 7 || (48...57).contains($0.element)
      })
    else { return "" }
    return String(Int(day.suffix(2)) ?? 0)
  }
  public static func withDayTags(_ cells: [JSValue]) -> [JSValue] {
    var prev: JSValue? = nil
    return cells.map { c in
      var o = c.objectValue ?? JSObject()
      let d = c["day"].flatMap { JSX.truthy($0) ? $0 : nil }
      o["tag"] = .string(d != nil && d != prev ? dayTag(d!.stringValue ?? "") : "")
      if let d = d { prev = d }
      return .object(o)
    }
  }
  public static func sheetTags(_ cells: [JSValue]) -> [JSValue] {
    var days: [JSValue] = []
    for c in cells { if let d = c["day"], JSX.truthy(d), !days.contains(d) { days.append(d) } }
    return cells.map {
      days.count <= 1
        ? .string("") : ($0["tag"].flatMap { JSX.truthy($0) ? $0 : nil } ?? .string(""))
    }
  }
  public static func paginate(_ cells: [JSValue], max capArg: Int = 80) -> [[JSValue]] {
    let cap = capArg > 0 ? capArg : 80
    var groups: [(JSValue, [JSValue])] = []
    for c in cells {
      let day = c["day"].flatMap { JSX.truthy($0) ? $0 : nil } ?? .string("")
      if groups.last?.0 == day {
        groups[groups.count - 1].1.append(c)
      } else {
        groups.append((day, [c]))
      }
    }
    var pages: [[JSValue]] = []
    var cur: [JSValue] = []
    for (_, g) in groups {
      if g.count > cap {
        if !cur.isEmpty { pages.append(cur) }
        cur = []
        for i in stride(from: 0, to: g.count, by: cap) {
          let part = Array(g[i..<min(i + cap, g.count)])
          if i + cap < g.count { pages.append(part) } else { cur = part }
        }
      } else if cur.count + g.count <= cap {
        cur += g
      } else {
        pages.append(cur)
        cur = g
      }
      if cur.count == cap {
        pages.append(cur)
        cur = []
      }
    }
    if !cur.isEmpty { pages.append(cur) }
    return pages
  }
  public static func defaultRatio(_ n: Int) -> String { n >= 1 && n <= 3 ? "1:1" : "3:4" }
  public static func resultGrid(_ n: Int, screenWidth: Double) throws -> JSValue {
    let g = try gridOf(n)
    let cols = g["cols"]!.numberValue!
    let rows = g["rows"]!.numberValue!
    if cols == 0 { return g }
    let b = screenWidth - 40
    return nums([
      ("cols", cols), ("rows", rows),
      ("c", min(floor(b / cols), floor(0.5 * b), rows >= 2 ? floor(0.4 * b) : .infinity)),
    ])
  }
  public static func monthColumns(_ width: Double, ax: Bool = false) -> Int {
    ax ? 4 : width >= 430 ? 7 : 6
  }
  public static func monthCell(_ width: Double, cols: Int) -> Double {
    floor((width - 40) / Double(cols))
  }
  public static func cellInkBox(_ c: Double, pad: Double = 0.12) -> JSValue {
    let size = c * (1 - 2 * pad)
    return nums([("ox", c * pad), ("oy", c * pad), ("size", size), ("k", size / 345)])
  }
  public static func minInkScale(_ boxPt: Double, innerRatio: Double = 1) -> Double {
    if !(boxPt > 0) { return 1 }
    let physical = 11.5 * boxPt * innerRatio / 345
    return physical >= 1.2 ? 1 : 1.2 / physical
  }
  public static func inkWidthScale(_ cellPt: Double) -> Double {
    minInkScale(cellPt, innerRatio: 0.76)
  }
  public static func dotDiameterPt(_ cellPt: Double) -> Double { min(8, max(5, cellPt * 0.07)) }
  public static func dotLayout(
    _ c: Double, unit: Double, bounds: JSValue = .null, pad: Double = 0.12
  ) -> JSValue {
    let d = dotDiameterPt(c / unit) * unit
    let inner = cellInkBox(c, pad: pad)
    let k = inner["k"]!.numberValue!
    var cx = c - d
    var cy = d
    if !bounds.isNull {
      cx =
        inner["ox"]!.numberValue!
        + ((bounds["x"]?.numberValue ?? 0) + (bounds["width"]?.numberValue ?? 0)) * k + 2 * unit + d
        / 2
      cy = inner["oy"]!.numberValue! + (bounds["y"]?.numberValue ?? 0) * k - 2 * unit - d / 2
    }
    cx = min(max(cx, d / 2 + unit), c - d / 2 - unit)
    cy = min(max(cy, d / 2 + unit), c - d / 2 - unit)
    return nums([("cx", cx), ("cy", cy), ("d", d)])
  }
}
