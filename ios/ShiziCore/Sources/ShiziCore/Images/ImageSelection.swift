import Foundation

/// Image work and pick selection rules, ported from the former JS modules. All record objects are preserved, including unknown fields.
public enum ImageSelection {
  public typealias InkOf = (JSValue) throws -> JSValue?
  static func obj(_ p: [(String, JSValue)]) -> JSValue { .object(JSObject(p)) }
  static func str(_ v: JSValue?) -> String { v?.stringValue ?? "" }
  static func char(_ r: JSValue) -> String {
    let c = str(r["char"])
    return c.isEmpty ? Records.charOfCardKey(r["cardKey"]) ?? "" : c
  }
  static func truth(_ v: JSValue?) -> Bool { JSX.truthy(v) }
  public static func addedOf(_ session: JSValue?) -> [String] {
    (session?["added"]?.arrayValue ?? []).compactMap(\.stringValue)
  }
  public static func toggleAdded(_ session: JSValue?, recordId: String, on: Bool? = nil) -> [String]
  {
    let cur = addedOf(session)
    let has = cur.contains(recordId)
    let want = on ?? !has
    if want == has { return cur }
    return want ? cur + [recordId] : cur.filter { $0 != recordId }
  }
  public static func buildWork(
    items: [JSValue], records: [JSValue], hasInk: InkPick.HasInk, added: [String] = []
  ) -> JSValue {
    let ids = WorkMembers.Added(added)
    let entries = items.enumerated().map { i, item -> JSValue in
      let record = records.last { $0["id"] == item["recordId"] }
      let kind = record?["kind"] ?? item["kind"] ?? .null
      let ch =
        record.flatMap { truth($0["char"]) ? $0["char"] : nil }
        ?? .string(Records.charOfCardKey(item["cardKey"]) ?? "")
      let judgment = JSX.eq(kind, "judged") ? record?["judgment"] ?? .null : .null
      let paper = Records.isPaperRecord(record)
      let ink =
        record != nil && !paper && !JSX.eq(kind, "skipped")
        ? ((try? hasInk(record!)) ?? false) : false
      let member = WorkMembers.isWorkMember(record, hasInk: { _ in ink }, added: ids)
      let state: String
      if JSX.eq(kind, "skipped") {
        state = "skipped"
      } else if paper {
        state = "paper"
      } else if JSX.eq(kind, "answer-seen") {
        state = member ? "in" : "seen"
      } else if JSX.eq(judgment, "wrong") {
        state = !ink ? "noInk" : member ? "added" : "addable"
      } else {
        state = member && ink ? "in" : "noInk"
      }
      var o = JSObject([("index", .number(Double(i)))])
      if let key = item["cardKey"] { o["cardKey"] = key }
      o["recordId"] = record?["id"] ?? item["recordId"] ?? .null
      o["record"] = record ?? .null
      o["char"] = ch
      o["kind"] = kind
      o["judgment"] = judgment
      o["state"] = .string(state)
      o["hasInk"] = .bool(ink)
      o["paper"] = .bool(paper)
      o["tag"] = .string(JSX.eq(kind, "answer-seen") && ink ? "afterSeen" : "")
      o["dot"] = .bool(state == "added")
      return .object(o)
    }
    let cells = entries.filter { ["in", "added"].contains(str($0["state"])) }
    return obj([
      ("entries", .array(entries)), ("cells", .array(cells)),
      ("rows", .array(entries.filter { str($0["state"]) != "in" })),
      ("addable", .array(entries.filter { ["addable", "added"].contains(str($0["state"])) })),
      ("empty", .bool(cells.isEmpty)),
    ])
  }
  public static func flattenRecords(_ records: JSValue?) -> [JSValue] {
    let rows = (records?.objectValue?.keys ?? []).flatMap { key -> [JSValue] in
      let v = records?[key]
      return v?.arrayValue ?? v?["kept"]?.arrayValue ?? []
    }
    return JSX.stableSort(rows.filter { $0["id"]?.stringValue != nil }) {
      Records.compareRecordIds($0["id"], $1["id"])
    }
  }
  public static func findSession(_ state: JSValue, slot: String? = nil, sessionId: JSValue)
    -> JSValue?
  {
    let s = state["sessions"]
    let slots = slot.map { [$0] } ?? ["A", "B"]
    for k in slots { if let v = s?["lastEnded"]?[k], v["id"] == sessionId { return v } }
    for k in slots { if let v = s?[k], v["id"] == sessionId { return v } }
    return nil
  }
  public static func sessionDay(_ session: JSValue?, records: [JSValue] = [], dates: Dates) throws
    -> JSValue
  {
    if let s = session {
      let ended = s["endedAt"]?.numberValue
      let at = ended?.isFinite == true ? ended : s["updatedAt"]?.numberValue
      if let at = at, at.isFinite { return .string(try dates.localDay(.number(at))) }
      if dates.isValidDay(s["startedDay"] ?? .null) { return s["startedDay"]! }
    }
    let d = records.last?["localDay"] ?? .null
    return dates.isValidDay(d) ? d : .null
  }
  static func folded(_ state: JSValue, _ month: String) -> JSValue? {
    let v = state["records"]?[month]
    return v?.arrayValue == nil && truth(v?["folded"]) ? v : nil
  }
  public static func dayMembers(
    _ state: JSValue, day: String, hasInk: InkPick.HasInk? = nil, added: [String]? = nil,
    dates: Dates
  ) throws -> JSValue {
    guard dates.isValidDay(.string(day)) else { throw CoreError.badArgs("INVALID_DAY") }
    let has: InkPick.HasInk =
      hasInk ?? { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }
    // 原写法：flattenRecords（全部记录按 id 稳定排序）→ workMemberRecords（过成员规则、再按 id 稳定排序）→ 筛这一天。
    // 与 monthMembers 同一推法（见那里的注释）：按 id 序号的比较是严格弱序，稳定排序的结果唯一；筛选只看每条自己的字段，筛前排与筛后排是同一串。
    // 于是先筛出这一天的成员记录、再按 id 稳定排一次（sortById），排序与 hasInk（看后自写要问墨迹）只落在这一天的记录上，不再是全部历史。
    let ids = WorkMembers.Added(added)
    let inDay = Records.sortById(
      monthRows(state).filter {
        $0["id"]?.stringValue != nil && str($0["localDay"]) == day
          && WorkMembers.isWorkMember($0, hasInk: has, added: ids)
      })
    let pick: WorkMembers.PickInk = hasInk.map { .test($0) } ?? .none
    var members: [JSValue]
    if let fold = folded(state, String(day.prefix(7))) {
      members = (Records.foldWorkByDay(fold)[day]?.arrayValue ?? []).map { ch in
        let list = inDay.filter { char($0) == str(ch) }
        if let m = WorkMembers.workMembers(
          list, prefer: .string("last"), hasInk: has, pickInk: pick, added: .init(added)
        ).first {
          var o = m.js.objectValue!
          o["firstDay"] = .string(day)
          return .object(o)
        }
        return obj([
          ("char", ch), ("cardKey", .string("base:" + str(ch))), ("record", .null),
          ("firstDay", .string(day)), ("dot", .bool(false)),
        ])
      }
    } else {
      members = WorkMembers.workMembers(
        inDay, prefer: .string("last"), order: .string("first"), hasInk: has, pickInk: pick,
        added: .init(added)
      ).map(\.js)
    }
    return obj([("members", .array(members)), ("day", .string(day))])
  }
  /// monthMembers 开头的那一步：state.records 每个月键下的记录（数组月本身 / 折叠月的 kept），按键序平铺，不排序、不过滤。
  /// 只取决于 state，所以同一次回答里多次 monthMembers（年报每月数成员、每月的格）可以共用一份（rows 参数），结果与各自现平铺相同。
  package static func monthRows(_ state: JSValue) -> [JSValue] {
    (state["records"]?.objectValue?.keys ?? []).flatMap { key -> [JSValue] in
      let v = state["records"]?[key]
      return v?.arrayValue ?? v?["kept"]?.arrayValue ?? []
    }
  }
  public static func monthMembers(
    _ state: JSValue, month: String, pick: String = "first", hasInk: InkPick.HasInk? = nil,
    added: [String]? = nil, dates: Dates
  ) throws -> JSValue {
    try monthMembers(state, month: month, pick: pick, hasInk: hasInk, added: added, rows: nil, dates: dates)
  }
  /// rows：调用方已用同一 state 算好的 monthRows(state)，nil 时现平铺。
  package static func monthMembers(
    _ state: JSValue, month: String, pick: String, hasInk: InkPick.HasInk?,
    added: [String]?, rows prebuilt: [JSValue]?, dates: Dates
  ) throws -> JSValue {
    guard dates.isValidMonth(.string(month)) else { throw CoreError.badArgs("INVALID_MONTH") }
    let has: InkPick.HasInk =
      hasInk ?? { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }
    // 原写法：flattenRecords（全部记录按 id 稳定排序）→ workMemberRecords（过成员规则、再稳定排序）→ 筛这个月。
    // 比较只看 id 序号（不合法 -1；两个 +∞ 比较得 NaN 当相等），是一个严格弱序，所以稳定排序的结果唯一：按序号升序、序号相同的保持
    // 平铺时的先后。筛选只按每条自己的字段（谓词无副作用），筛前排与筛后排得到的是同一串；排过的再排也不变。
    // 于是先把这个月的成员记录筛出来、再按 id 稳定排一次（sortById：同一个归并、同一个差值），与原来逐条相同，排序只在一个月的记录上做。
    let prefix = month + "-", ids = WorkMembers.Added(added)
    let rows = prebuilt ?? monthRows(state)
    let records = Records.sortById(
      rows.filter {
        $0["id"]?.stringValue != nil && str($0["localDay"]).hasPrefix(prefix)
          && WorkMembers.isWorkMember($0, hasInk: has, added: ids)
      })
    let picker: WorkMembers.PickInk = hasInk.map { .test($0) } ?? .none
    let prefer: JSValue = .string(pick == "first" ? "first" : "last")
    var days: [String] = []
    var members: [JSValue] = []
    if let fold = folded(state, month) {
      let byDay = Records.foldWorkByDay(fold)
      days = byDay.keys.filter { $0.hasPrefix(month + "-") }.sorted()
      // 每字的记录：按 char(r) 分桶一次（Swift String 的字典，判等与原来的 `char($0) == str(ch)` 同为 String ==），桶内保持 records 的先后
      var byChar: [String: [JSValue]] = [:]
      for r in records { byChar[char(r), default: []].append(r) }
      // 见过的字：字串按逐码点（JSKey，与 JSValue 的 == 相同）放进集合；非字串（旧版折叠里可能有）仍按 == 线性比，字串与非字串从不相等
      var seenStrings = Set<JSKey>()
      var seenOther: [JSValue] = []
      for d in days {
        for ch in byDay[d]?.arrayValue ?? [] {
          if case .string(let s) = ch {
            if !seenStrings.insert(JSKey(s: s)).inserted { continue }
          } else {
            if seenOther.contains(ch) { continue }
            seenOther.append(ch)
          }
          let list = byChar[str(ch)] ?? []
          let m = WorkMembers.workMembers(
            list, prefer: prefer, hasInk: has, pickInk: picker, added: .init(added)
          ).first
          members.append(
            obj([
              ("char", ch), ("cardKey", m?.record["cardKey"] ?? .string("base:" + str(ch))),
              ("record", m?.record ?? .null), ("firstDay", .string(d)),
              ("dot", .bool(m?.dot ?? false)),
            ]))
        }
      }
    } else {
      var seenDays = Set<String>()  // 与原来的 days.contains（String ==）同一判等
      for r in records {
        let d = str(r["localDay"])
        if seenDays.insert(d).inserted { days.append(d) }
      }
      days.sort()
      members = WorkMembers.workMembers(
        records, prefer: prefer, order: .string("first"), hasInk: has, pickInk: picker,
        added: .init(added)
      ).map(\.js)
    }
    return obj([
      ("members", .array(members)), ("days", .number(Double(days.count))),
      ("dayList", .array(days.map(JSValue.string))), ("month", .string(month)),
      ("pick", .string(pick)),
    ])
  }
  public static func glyphMember(_ state: JSValue, char wanted: String) -> JSValue {
    let rows = flattenRecords(state["records"]).filter {
      Records.isWorkRecord($0) && char($0) == wanted
    }
    guard let r = rows.last else { return .null }
    return obj([
      ("char", .string(wanted)), ("cardKey", r["cardKey"] ?? .null), ("record", r),
      ("firstDay", rows.first?["localDay"] ?? .null),
    ])
  }
  static func points(_ record: JSValue?, _ inkOf: InkOf) -> JSValue? {
    guard let record = record, !record.isNull, let p = try? inkOf(record),
      p.arrayValue?.contains(where: { !($0.arrayValue ?? []).isEmpty }) == true
    else { return nil }
    return p
  }
  public static func cellOfMember(_ m: JSValue, inkOf: InkOf, under: Bool = false) -> JSValue? {
    let ink = points(m["record"], inkOf)
    if ink == nil && !under { return nil }
    let day = truth(m["firstDay"]) ? m["firstDay"]! : m["record"]?["localDay"] ?? .null
    return obj([
      ("ch", m["char"] ?? .null), ("ink", ink ?? .null),
      ("mode", .string(ink == nil ? "under" : "hand")),
      ("dot", .bool(ink != nil && truth(m["dot"]))), ("tag", .string("")), ("day", day),
      ("record", m["record"] ?? .null),
    ])
  }
  /// = imagePlan(state, scope: {kind: "month", month}, inkOf:, hasInk:, monthPick:) 的 cells 与 days（与 maxChars 无关），
  /// 不分页、不拼 drawn / recordIds / members：月报 / 记录 / 年报的页与年报导出图只读这两项。抛错与 imagePlan 的月报一支相同
  /// （那一支只有 monthMembers 会抛：不合法的月）。rows 见 monthRows。
  package static func monthPlanCells(
    _ state: JSValue, month: String, inkOf: @escaping InkOf, hasInk: InkPick.HasInk? = nil,
    monthPick: String = "first", rows: [JSValue]? = nil, dates: Dates
  ) throws -> (cells: [JSValue], days: JSValue) {
    let has: InkPick.HasInk = hasInk ?? { points($0, inkOf) != nil }
    let r = try monthMembers(state, month: month, pick: monthPick, hasInk: has, added: nil, rows: rows, dates: dates)
    let members = r["members"]?.arrayValue ?? []
    let cells = ImageLayout.withDayTags(members.compactMap { cellOfMember($0, inkOf: inkOf, under: true) })
    return (cells, r["days"] ?? .null)
  }
  /// = cellOfMember(m, inkOf:, under: true)，只是 ink 记 .null：给只读 ch / mode / dot / tag / day / record 的调用方（我的页的月报格），
  /// 免得为一个 mode 把每格墨迹解成回放点。hasPoints 须等于 points(m["record"], inkOf) != nil。
  static func cellOfMemberWithoutInk(_ m: JSValue, hasPoints: Bool) -> JSValue {
    let day = truth(m["firstDay"]) ? m["firstDay"]! : m["record"]?["localDay"] ?? .null
    return obj([
      ("ch", m["char"] ?? .null), ("ink", .null),
      ("mode", .string(hasPoints ? "hand" : "under")),
      ("dot", .bool(hasPoints && truth(m["dot"]))), ("tag", .string("")), ("day", day),
      ("record", m["record"] ?? .null),
    ])
  }
  public static func imagePlan(
    _ state: JSValue, scope: JSValue, inkOf: @escaping InkOf, hasInk: InkPick.HasInk? = nil,
    maxChars: Int = 80, monthPick: String = "first", dates: Dates
  ) throws -> JSValue {
    let kind = str(scope["kind"])
    guard ["session", "day", "month", "glyph"].contains(kind) else {
      throw CoreError.badArgs("INVALID_KIND")
    }
    let has: InkPick.HasInk = hasInk ?? { points($0, inkOf) != nil }
    var members: [JSValue] = []
    var cells: [JSValue] = []
    var missing: [JSValue] = []
    var day: JSValue = .null
    var month: JSValue = .null
    var days: JSValue = .null
    var work: JSValue = .null
    var key: JSValue = .null
    if kind == "session" {
      key = scope["sessionId"] ?? .null
      let all = flattenRecords(state["records"]).filter { $0["sessionId"] == key }
      let s = findSession(state, slot: scope["slot"]?.stringValue, sessionId: key)
      let items =
        s?["items"]?.arrayValue
        ?? all.filter { JSX.eq($0["kind"], "judged") }.map {
          obj([
            ("cardKey", $0["cardKey"] ?? .null), ("recordId", $0["id"] ?? .null),
            ("kind", $0["kind"] ?? .null),
          ])
        }
      work = buildWork(items: items, records: all, hasInk: has, added: addedOf(s))
      day = try sessionDay(s, records: all, dates: dates)
      members = work["cells"]?.arrayValue ?? []
      cells = members.map { m in
        obj([
          ("ch", m["char"] ?? .null), ("ink", points(m["record"], inkOf) ?? .null),
          ("mode", .string("hand")), ("dot", m["dot"] ?? .bool(false)), ("tag", .string("")),
          ("day", day), ("record", m["record"] ?? .null),
        ])
      }
      missing = (work["entries"]?.arrayValue ?? []).filter {
        !["in", "added", "addable"].contains(str($0["state"]))
      }.map { $0["char"] ?? .null }
    } else if kind == "day" {
      day = scope["day"] ?? .null
      key = day
      members =
        try dayMembers(state, day: str(day), hasInk: has, dates: dates)["members"]?.arrayValue ?? []
      for m in members {
        if let c = cellOfMember(m, inkOf: inkOf) {
          cells.append(c)
        } else {
          missing.append(m["char"] ?? .null)
        }
      }
    } else if kind == "month" {
      month = scope["month"] ?? .null
      key = month
      let r = try monthMembers(state, month: str(month), pick: monthPick, hasInk: has, dates: dates)
      days = r["days"] ?? .null
      members = r["members"]?.arrayValue ?? []
      cells = ImageLayout.withDayTags(
        members.compactMap { cellOfMember($0, inkOf: inkOf, under: true) })
    } else {
      key = scope["char"] ?? .null
      let m = glyphMember(state, char: str(key))
      members = m.isNull ? [] : [m]
      day = m["record"]?["localDay"] ?? .null
      if !m.isNull {
        if let c = cellOfMember(m, inkOf: inkOf) {
          cells = [c]
        } else {
          missing = [m["char"] ?? .null]
        }
      }
    }
    let drawn = cells.filter { JSX.eq($0["mode"], "hand") }.map {
      obj([
        ("char", $0["ch"] ?? .null), ("record", $0["record"] ?? .null),
        ("points", $0["ink"] ?? .null), ("tag", $0["tag"] ?? .null),
      ])
    }
    let status =
      kind == "glyph" ? (drawn.isEmpty ? "noInk" : "ready") : (cells.isEmpty ? "empty" : "ready")
    var pages =
      kind == "glyph" ? (cells.isEmpty ? [] : [cells]) : ImageLayout.paginate(cells, max: maxChars)
    if kind == "month" { pages = pages.map(ImageLayout.withDayTags) }
    return obj([
      ("kind", .string(kind)), ("key", key), ("status", .string(status)), ("day", day),
      ("month", month), ("days", days), ("maxChars", .number(Double(maxChars))),
      ("members", .array(members)), ("cells", .array(cells)), ("drawn", .array(drawn)),
      ("missing", .array(missing)), ("n", .number(Double(cells.count))),
      ("pages", .array(pages.map(JSValue.array))), ("work", work),
      ("recordIds", .array(cells.compactMap { $0["record"]?["id"] })),
    ])
  }
}
