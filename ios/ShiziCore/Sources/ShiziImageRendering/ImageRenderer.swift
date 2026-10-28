import CoreGraphics
import CoreText
import Foundation
import ImageIO
import ShiziCore

/// The raster boundary only. Selection, pagination and geometry are independent of graphics APIs.
/// Inputs contain decoded/resampled ink, never raw stored ink. Export paper is flat (D51 §6).
public final class ImageRenderer {
  public enum Failure: Error {
    case invalidSpec, bitmap
    case font(String)
    case path(String)
  }
  public let assets: URL
  private var fonts: [String: CTFontDescriptor] = [:]
  private var glyphs: [String: [CGPath]] = [:]
  public init(assets: URL) { self.assets = assets }
  public typealias O = [String: Any]
  static func n(_ o: O, _ k: String, _ fallback: Double = 0) -> Double {
    (o[k] as? NSNumber)?.doubleValue ?? fallback
  }
  static func s(_ o: O, _ k: String) -> String { o[k] as? String ?? "" }
  static func o(_ o: O, _ k: String) -> O { o[k] as? O ?? [:] }
  static func js(_ value: Any) throws -> JSValue {
    try JSONParser.parse(
      String(
        data: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
        encoding: .utf8)!)
  }
  static func dict(_ value: JSValue) throws -> O {
    try JSONSerialization.jsonObject(
      with: Data(JSONWriter.stringify(value).utf8), options: [.fragmentsAllowed]) as? O ?? [:]
  }
  func font(_ family: String, _ size: Double, _ weight: Int = 400) throws -> CTFont {
    if family == "label" {
      let base = CTFontCreateUIFontForLanguage(.system, size, "zh-Hans" as CFString)!
      if weight < 500 { return base }
      let descriptor = CTFontDescriptorCreateWithAttributes([
        kCTFontTraitsAttribute: [kCTFontWeightTrait: 0.23]
      ] as CFDictionary)
      return CTFontCreateCopyWithAttributes(base, size, nil, descriptor)
    }
    let name =
      family == "kai"
      ? "ShiziKai-Regular" : weight >= 500 ? "ShiziSerifSC-Medium" : "ShiziSerifSC-Regular"
    if fonts[name] == nil {
      guard let data = try? Data(contentsOf: assets.appendingPathComponent("fonts/\(name).woff2")),
        let d = CTFontManagerCreateFontDescriptorFromData(data as CFData)
      else { throw Failure.font(name) }
      fonts[name] = d
    }
    let cascade = ["Kaiti SC", "STKaiti", "KaiTi", "Songti SC"].map {
      CTFontDescriptorCreateWithNameAndSize($0 as CFString, size)
    }
    let d = CTFontDescriptorCreateCopyWithAttributes(
      fonts[name]!, [kCTFontCascadeListAttribute: cascade] as CFDictionary)
    return CTFontCreateWithFontDescriptor(d, size, nil)
  }
  func color(_ value: Any?) throws -> CGColor {
    guard let s = value as? String else { throw Failure.invalidSpec }
    if s.hasPrefix("#") {
      let h = String(s.dropFirst())
      let v = UInt64(h, radix: 16) ?? 0
      if h.count == 6 {
        return CGColor(
          srgbRed: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255,
          blue: Double(v & 255) / 255, alpha: 1)
      }
    }
    let values = s.split(whereSeparator: { !("0123456789.-".contains($0)) }).compactMap {
      Double($0)
    }
    guard values.count >= 3 else { throw Failure.invalidSpec }
    return CGColor(
      srgbRed: values[0] / 255, green: values[1] / 255, blue: values[2] / 255,
      alpha: values.count > 3 ? values[3] : 1)
  }
  func text(
    _ ctx: CGContext, _ str: String, _ x: Double, _ y: Double, _ size: Double, _ col: CGColor,
    family: String = "song", align: String = "left", middle: Bool = true, weight: Int = 400,
    tracking: Double? = nil
  ) throws {
    let f = try font(family, size, weight)
    func line(_ str: String) -> CTLine {
      CTLineCreateWithAttributedString(
        NSAttributedString(
          string: str,
          attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): f,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): col,
          ]))
    }
    let chars = tracking == nil ? [str] : str.unicodeScalars.map(String.init)
    let lines = chars.map(line)
    let widths = lines.map { CTLineGetTypographicBounds($0, nil, nil, nil) }
    let spacing = (tracking ?? 0) * size
    let width = widths.reduce(0, +) + Double(max(0, chars.count - 1)) * spacing
    var tx = x - (align == "right" ? width : align == "center" ? width / 2 : 0)
    // Canvas middle baseline uses the font ascent/descent midpoint (not the ink bounds).
    let base = y + (middle ? (CTFontGetAscent(f) - CTFontGetDescent(f)) / 2 : 0)
    ctx.saveGState()
    ctx.textMatrix = .identity
    for (i, l) in lines.enumerated() {
      ctx.saveGState()
      ctx.translateBy(x: tx, y: base)
      ctx.scaleBy(x: 1, y: -1)
      ctx.textPosition = .zero
      CTLineDraw(l, ctx)
      ctx.restoreGState()
      tx += widths[i] + spacing
    }
    ctx.restoreGState()
  }
  func measure(_ str: String, _ size: Double, family: String = "label", weight: Int = 500) throws
    -> Double
  {
    let f = try font(family, size, weight)
    let l = CTLineCreateWithAttributedString(
      NSAttributedString(
        string: str, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): f]))
    return CTLineGetTypographicBounds(l, nil, nil, nil)
  }
  /// SVG parser shared by bundled hanzi outlines and brand seal. Handles compact numeric syntax.
  func path(_ svg: String) throws -> CGPath {
    let re = try NSRegularExpression(
      pattern: "[A-Za-z]|[-+]?(?:[0-9]*\\.[0-9]+|[0-9]+\\.?[0-9]*)(?:[eE][-+]?[0-9]+)?")
    let ns = svg as NSString
    let tokens = re.matches(in: svg, range: NSRange(location: 0, length: ns.length)).map {
      ns.substring(with: $0.range)
    }
    let p = CGMutablePath()
    var i = 0
    var cmd = ""
    func num() throws -> Double {
      guard i < tokens.count, let n = Double(tokens[i]) else { throw Failure.path(svg) }
      i += 1
      return n
    }
    func pt() throws -> CGPoint {
      let x = try num()
      let y = try num()
      return CGPoint(x: x, y: y)
    }
    while i < tokens.count {
      if tokens[i].first?.isLetter == true {
        cmd = tokens[i]
        i += 1
        if cmd == "Z" || cmd == "z" {
          p.closeSubpath()
          continue
        }
      }
      switch cmd {
      case "M":
        p.move(to: try pt())
        cmd = "L"
      case "L": p.addLine(to: try pt())
      case "Q":
        let c = try pt()
        p.addQuadCurve(to: try pt(), control: c)
      case "C":
        let a = try pt()
        let b = try pt()
        p.addCurve(to: try pt(), control1: a, control2: b)
      default: throw Failure.path(svg)
      }
    }
    return p
  }
  func seal(_ ctx: CGContext, _ box: O, _ pal: O) throws {
    let x = Self.n(box, "x")
    let y = Self.n(box, "y")
    let size = Self.n(box, "size")
    ctx.saveGState()
    defer { ctx.restoreGState() }
    ctx.translateBy(x: x + size / 2, y: y + size / 2)
    ctx.rotate(by: Self.n(box, "rotate") * .pi / 180)
    ctx.setFillColor(try color(pal["seal"]))
    ctx.fill(CGRect(x: -size / 2, y: -size / 2, width: size, height: size))
    ctx.saveGState()
    ctx.setAlpha(0.55)
    ctx.setStrokeColor(try color(pal["onSeal"]))
    ctx.setLineWidth(max(1, size / 40))
    ctx.stroke(
      CGRect(
        x: -size / 2 + size * 0.07, y: -size / 2 + size * 0.07, width: size * 0.86,
        height: size * 0.86))
    ctx.restoreGState()
    let url = Bundle.module.url(
      forResource: "seal", withExtension: "json", subdirectory: "Resources")!
    let data = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! O
    let t = Self.o(data, "transform")
    let c = Self.o(data, "center")
    let k = size / Self.n(data, "view")
    ctx.scaleBy(x: k, y: k)
    ctx.translateBy(x: -Self.n(c, "x") + Self.n(t, "tx"), y: -Self.n(c, "y") + Self.n(t, "ty"))
    ctx.scaleBy(x: Self.n(t, "scale"), y: Self.n(t, "scale"))
    ctx.setFillColor(try color(pal["onSeal"]))
    for d in data["paths"] as? [String] ?? [] {
      ctx.addPath(try path(d))
      ctx.fillPath()
    }
  }
  func hand(_ ctx: CGContext, _ points: [[[String: Any]]], widthScale: Double = 1) {
    func radius(_ p: O) -> Double {
      let w = Self.n(p, "w", 11.5)
      return max(0.5, (w > 0 ? w : 11.5) * widthScale / 2)
    }
    func dot(_ p: O, _ r: Double) {
      ctx.fillEllipse(
        in: CGRect(x: Self.n(p, "x") - r, y: Self.n(p, "y") - r, width: 2 * r, height: 2 * r))
    }
    for stroke in points where !stroke.isEmpty {
      dot(stroke[0], radius(stroke[0]))
      for i in 1..<stroke.count {
        let a = stroke[i - 1]
        let b = stroke[i]
        let dx = Self.n(b, "x") - Self.n(a, "x")
        let dy = Self.n(b, "y") - Self.n(a, "y")
        let length = hypot(dx, dy)
        if length == 0 { continue }
        let nx = -dy / length
        let ny = dx / length
        let ra = radius(a)
        let rb = radius(b)
        ctx.beginPath()
        ctx.move(to: CGPoint(x: Self.n(a, "x") + nx * ra, y: Self.n(a, "y") + ny * ra))
        ctx.addLine(to: CGPoint(x: Self.n(b, "x") + nx * rb, y: Self.n(b, "y") + ny * rb))
        ctx.addLine(to: CGPoint(x: Self.n(b, "x") - nx * rb, y: Self.n(b, "y") - ny * rb))
        ctx.addLine(to: CGPoint(x: Self.n(a, "x") - nx * ra, y: Self.n(a, "y") - ny * ra))
        ctx.closePath()
        ctx.fillPath()
        dot(b, rb)
      }
    }
  }
  func cell(
    _ ctx: CGContext, _ cell: O, _ x: Double, _ y: Double, _ c: Double, _ pal: O, pad: Double = 0.12
  ) throws {
    ctx.saveGState()
    defer { ctx.restoreGState() }
    ctx.clip(to: CGRect(x: x, y: y, width: c, height: c))
    let points = cell["ink"] as? [[[String: Any]]] ?? []
    let size = c * (1 - 2 * pad)
    ctx.translateBy(x: x + c * pad, y: y + c * pad)
    if Self.s(cell, "mode") != "under" && points.contains(where: { !$0.isEmpty }) {
      ctx.scaleBy(x: size / 345, y: size / 345)
      ctx.setFillColor(try color(pal["hand"]))
      hand(ctx, points, widthScale: ImageLayout.inkWidthScale(c / 2.69))
    } else {
      let ch = Self.s(cell, "ch")
      if glyphs[ch] == nil,
        let data = try? Data(contentsOf: assets.appendingPathComponent("data/\(ch).json")),
        let o = try? JSONSerialization.jsonObject(with: data) as? O,
        let ds = o["strokes"] as? [String]
      {
        glyphs[ch] = try ds.map(path)
      }
      if let paths = glyphs[ch] {
        let p = size * 0.06
        let k = size * 0.88 / 1024
        ctx.translateBy(x: p, y: p + 900 * k)
        ctx.scaleBy(x: k, y: -k)
        ctx.setFillColor(try color(pal["under"]))
        for p in paths {
          ctx.addPath(p)
          ctx.fillPath()
        }
      } else {
        try text(
          ctx, ch, size / 2, size * 0.54, floor(size * 0.8 + 0.5), color(pal["under"]),
          family: "kai", align: "center")
      }
    }
  }
  func dot(_ ctx: CGContext, _ cell: O, _ x: Double, _ y: Double, _ c: Double, _ pal: O) throws {
    guard cell["dot"] as? Bool == true else { return }
    let layout = try Self.dict(
      ImageLayout.dotLayout(
        c, unit: 2.69, bounds: ImageLayout.inkBounds(Self.js(cell["ink"] ?? []))))
    let d = Self.n(layout, "d")
    let cx = Self.n(layout, "cx")
    let cy = Self.n(layout, "cy")
    ctx.setFillColor(try color(pal["zhu"]))
    ctx.fillEllipse(in: CGRect(x: x + cx - d / 2, y: y + cy - d / 2, width: d, height: d))
  }
  func signature(_ ctx: CGContext, _ value: String, _ box: O, _ pal: O) throws {
    try text(
      ctx, value, Self.n(box, "right"), Self.n(box, "top") + Self.n(box, "lineHeight") / 2,
      Self.n(box, "size"), color(pal["ink2"]), align: "right")
  }
  public func render(_ spec: O) throws -> [Data] {
    let kind = Self.s(spec, "kind")
    let args = Self.o(spec, "args")
    let pal = Self.o(spec, "palette")
    let scale = Self.n(args, "scale", 4 / 3)
    guard scale > 0, scale <= 4 else { throw Failure.invalidSpec }
    if kind == "annual-long" { return try annualLong(args, pal, scale) }
    let cells = args["cells"] as? [O] ?? []
    if kind == "work" || kind == "sheet", !cells.isEmpty {
      let signature = Self.s(args, "kuan")
      guard !signature.isEmpty, !signature.contains("\n") else { throw Failure.invalidSpec }
    }
    let ratio = (args["ratio"] as? String) ?? "3:4"
    let l: O
    let w: Double
    let h: Double
    let k: Double
    if kind == "glyph" {
      l = try Self.dict(
        ImageLayout.glyphLayout(
          ImageLayout.inkBounds(Self.js(args["points"] ?? [])),
          ratio: ratio == "square" ? "square" : "portrait"))
      guard Self.s(l, "status") == "ready" else { return [] }
      w = Self.n(l, "width")
      h = Self.n(l, "height")
      k = 1
    } else if kind == "work" || kind == "sheet" {
      guard !cells.isEmpty else { return [] }
      l = try Self.dict(ImageLayout.layout(cells.count, ratio: ratio, sheet: kind == "sheet"))
      w = Self.n(l, "W")
      h = Self.n(l, "H")
      k = scale
    } else if kind == "annual-cover" || kind == "annual-tail" {
      l = [:]
      w = 1080
      h = 1440
      k = scale
    } else {
      throw Failure.invalidSpec
    }
    return [
      try bitmap(w, h, k, pal) { ctx in
        if kind == "glyph" {
          ctx.saveGState()
          ctx.translateBy(x: Self.n(l, "ox"), y: Self.n(l, "oy"))
          ctx.scaleBy(x: Self.n(l, "k"), y: Self.n(l, "k"))
          ctx.setFillColor(try self.color(pal["hand"]))
          self.hand(ctx, args["points"] as? [[[String: Any]]] ?? [])
          ctx.restoreGState()
          let info = Self.o(l, "info")
          let sig = Self.o(l, "signature")
          try self.text(
            ctx, Self.s(args, "caption"), Self.n(info, "centerX"),
            Self.n(info, "top") + Self.n(info, "line") / 2, Self.n(info, "font"),
            self.color(pal["ink2"]), family: "label", align: "center")
          try self.text(
            ctx, Self.s(args, "signatureText"), Self.n(sig, "right"), Self.n(sig, "baseline"),
            Self.n(sig, "font"), self.color(pal["ink2"]), family: "label", align: "right",
            middle: false, tracking: 0.16)
          try self.seal(ctx, Self.o(l, "seal"), pal)
        } else if kind.hasPrefix("annual-") {
          try self.annualPage(ctx, args, pal, tail: kind == "annual-tail")
        } else {
          try self.work(ctx, args, pal, l, sheet: kind == "sheet")
        }
      }
    ]
  }
  func bitmap(_ w: Double, _ h: Double, _ scale: Double, _ pal: O, draw: (CGContext) throws -> Void)
    throws -> Data
  {
    let pw = Int(floor(w * scale + 0.5))
    let ph = Int(floor(h * scale + 0.5))
    guard pw > 0, ph > 0, pw <= 16384, ph <= 32768, pw * ph <= 64_000_000,
      let cs = CGColorSpace(name: CGColorSpace.sRGB),
      let ctx = CGContext(
        data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: pw * 4, space: cs,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw Failure.bitmap }
    ctx.translateBy(x: 0, y: Double(ph))
    ctx.scaleBy(x: scale, y: -scale)
    ctx.setFillColor(try color(pal["sheet"]))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    try draw(ctx)
    guard let image = ctx.makeImage() else { throw Failure.bitmap }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else {
      throw Failure.bitmap
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw Failure.bitmap }
    return data as Data
  }
  func work(_ ctx: CGContext, _ args: O, _ pal: O, _ l: O, sheet: Bool) throws {
    let cells = args["cells"] as? [O] ?? []
    let boxes = l["cells"] as? [O] ?? []
    let g = sheet ? Self.o(l, "grid") : l
    let c = Self.n(g, "c")
    let cols = Int(Self.n(g, "cols"))
    let n = cells.count
    for i in cells.indices {
      let x = Self.n(boxes[i], "x")
      let y = Self.n(boxes[i], "y")
      try cell(ctx, cells[i], x, y, c, pal)
      try dot(ctx, cells[i], x, y, c, pal)
    }
    ctx.setStrokeColor(try color(pal["guide"]))
    ctx.setLineWidth(1.5)
    ctx.beginPath()
    for i in cells.indices {
      let x = Self.n(boxes[i], "x")
      let y = Self.n(boxes[i], "y")
      if (i + 1) % cols != 0 && i + 1 < n {
        ctx.move(to: CGPoint(x: x + c, y: y))
        ctx.addLine(to: CGPoint(x: x + c, y: y + c))
      }
      if i + cols < n {
        ctx.move(to: CGPoint(x: x, y: y + c))
        ctx.addLine(to: CGPoint(x: x + c, y: y + c))
      }
    }
    ctx.strokePath()
    ctx.setStrokeColor(try color(pal["frame"]))
    ctx.setLineWidth(2)
    if sheet {
      let x = Self.n(l, "left")
      let y = Self.n(l, "top")
      let w = Self.n(g, "W")
      let h = Self.n(g, "H")
      let lastW = Self.n(g, "lastW")
      let rows = Self.n(g, "rows")
      ctx.beginPath()
      ctx.move(to: CGPoint(x: x, y: y))
      ctx.addLine(to: CGPoint(x: x + w, y: y))
      if g["full"] as? Bool == true {
        ctx.addLine(to: CGPoint(x: x + w, y: y + h))
      } else {
        ctx.addLine(to: CGPoint(x: x + w, y: y + (rows - 1) * c))
        ctx.addLine(to: CGPoint(x: x + lastW, y: y + (rows - 1) * c))
        ctx.addLine(to: CGPoint(x: x + lastW, y: y + h))
      }
      ctx.addLine(to: CGPoint(x: x, y: y + h))
      ctx.closePath()
      ctx.strokePath()
    } else {
      for r in l["frame"] as? [O] ?? [] {
        ctx.stroke(
          CGRect(
            x: Self.n(r, "x"), y: Self.n(r, "y"), width: Self.n(r, "w"), height: Self.n(r, "h")))
      }
    }
    let tags =
      sheet
      ? ImageLayout.sheetTags(try cells.map(Self.js)).map { $0.stringValue ?? "" }
      : cells.map { Self.s($0, "tag") }
    for i in tags.indices where !tags[i].isEmpty {
      let x = Self.n(boxes[i], "x")
      let y = Self.n(boxes[i], "y")
      if sheet {
        let tx = x + 8 + 5
        let w = try measure(tags[i], 30)
        ctx.setFillColor(try color(pal["sheet"]))
        ctx.fill(CGRect(x: tx - 5, y: y - 15, width: w + 10, height: 30))
        try text(ctx, tags[i], tx, y, 30, color(pal["ink3"]), family: "label", weight: 500)
      } else {
        try text(
          ctx, tags[i], x + 12, y + 8 + 15, 30, color(pal["ink3"]), family: "label", weight: 500)
      }
    }
    try signature(ctx, Self.s(args, "kuan"), Self.o(l, "kuan"), pal)
    try seal(ctx, Self.o(l, "seal"), pal)
  }
  func framed(
    _ ctx: CGContext, _ cell: O, _ x: Double, _ y: Double, _ c: Double, _ pal: O,
    frame: Bool = true, pad: Double = 0.12
  ) throws {
    try self.cell(ctx, cell, x, y, c, pal, pad: pad)
    if frame {
      ctx.setStrokeColor(try color(pal["frame"]))
      ctx.setLineWidth(2)
      ctx.stroke(CGRect(x: x + 1, y: y + 1, width: c - 2, height: c - 2))
    }
  }
  func annualPage(_ ctx: CGContext, _ a: O, _ p: O, tail: Bool) throws {
    if tail {
      try text(ctx, Self.s(a, "title"), 120, 236, 56, color(p["ink1"]))
      try framed(ctx, Self.o(a, "first"), 120, 420, 400, p)
      try framed(ctx, Self.o(a, "last"), 560, 420, 400, p)
      try text(ctx, Self.s(a, "firstDate"), 120, 875, 36, color(p["ink2"]))
      try text(ctx, Self.s(a, "lastDate"), 560, 875, 36, color(p["ink2"]))
    } else {
      try text(ctx, Self.s(a, "yearText"), 120, 260, 96, color(p["ink1"]))
      try text(ctx, Self.s(a, "line"), 124, 370, 44, color(p["ink2"]))
      try framed(ctx, Self.o(a, "first"), 120, 560, 420, p)
      try text(ctx, Self.s(a, "firstLabel"), 580, 925, 36, color(p["ink2"]))
      try text(ctx, Self.s(a, "firstDate"), 580, 975, 36, color(p["ink2"]))
    }
    try seal(ctx, ["x": 896, "y": 1240, "size": 64], p)
    try text(ctx, Self.s(a, "kuan"), 860, 1272, 36, color(p["ink2"]), align: "right")
  }
  func annualLong(_ a: O, _ p: O, _ scale: Double) throws -> [Data] {
    struct Block {
      let h: Double
      var keep = false
      let draw: (CGContext, Double) throws -> Void
    }
    let m = 97.0
    let cw = 886.0
    let c = 110.0
    var blocks: [Block] = []
    blocks.append(
      Block(
        h: 718,
        draw: { ctx, y in
          try self.text(ctx, Self.s(a, "yearText"), m, y + 170, 96, self.color(p["ink1"]))
          try self.text(ctx, Self.s(a, "line"), m, y + 276, 44, self.color(p["ink2"]))
          try self.framed(ctx, Self.o(a, "first"), m, y + 354, 300, p)
          try self.text(ctx, Self.s(a, "firstLabel"), m + 340, y + 579, 36, self.color(p["ink3"]))
          try self.text(ctx, Self.s(a, "firstDate"), m + 340, y + 629, 36, self.color(p["ink1"]))
        }))
    for month in a["months"] as? [O] ?? [] {
      blocks.append(
        Block(
          h: 136, keep: true,
          draw: { ctx, y in
            ctx.setFillColor(try self.color(p["line"]))
            ctx.fill(CGRect(x: m, y: y + 14, width: cw, height: 2))
            try self.text(
              ctx, Self.s(month, "name"), m, y + 77, 56, self.color(p["ink1"]), weight: 500)
            try self.text(
              ctx, Self.s(month, "count"), m + cw, y + 77, 32, self.color(p["ink3"]),
              family: "label", align: "right")
          }))
      let cells = month["cells"] as? [O] ?? []
      for r in stride(from: 0, to: cells.count, by: 8) {
        let row = Array(cells[r..<min(r + 8, cells.count)])
        blocks.append(
          Block(
            h: c + (r + 8 >= cells.count ? 56 : 0),
            draw: { ctx, y in
              for (i, cell) in row.enumerated() {
                try self.framed(ctx, cell, m + Double(i) * c, y, c, p, frame: false, pad: 0.09)
              }
            }))
      }
    }
    if let t = a["tail"] as? O {
      let tc = floor((cw - 46) / 2)
      blocks.append(
        Block(
          h: 14 + 28 + 72 + 28 + tc + 24 + 50 + 40,
          draw: { ctx, y in
            ctx.setFillColor(try self.color(p["line"]))
            ctx.fill(CGRect(x: m, y: y + 14, width: cw, height: 2))
            try self.text(ctx, Self.s(t, "title"), m, y + 78, 56, self.color(p["ink1"]))
            let cy = y + 142
            try self.framed(ctx, Self.o(t, "first"), m, cy, tc, p)
            try self.framed(ctx, Self.o(t, "last"), m + tc + 46, cy, tc, p)
            try self.text(ctx, Self.s(t, "firstDate"), m, cy + tc + 49, 36, self.color(p["ink2"]))
            try self.text(
              ctx, Self.s(t, "lastDate"), m + tc + 46, cy + tc + 49, 36, self.color(p["ink2"]))
          }))
    }
    blocks.append(
      Block(
        h: 164,
        draw: { ctx, y in
          try self.seal(ctx, ["x": m + cw - 64, "y": y + 40, "size": 64], p)
          try self.text(
            ctx, Self.s(a, "kuan"), m + cw - 64 - 36, y + 72, 36, self.color(p["ink2"]),
            align: "right")
        }))
    let maxLogical = floor(Self.n(a, "maxExportHeight", 11650) / scale)
    var chunks: [[Block]] = []
    var cur: [Block] = []
    var h = 0.0
    for (i, b) in blocks.enumerated() {
      let need = b.h + (b.keep && i + 1 < blocks.count ? blocks[i + 1].h : 0)
      if !cur.isEmpty && h + need > maxLogical {
        chunks.append(cur)
        cur = []
        h = 0
      }
      cur.append(b)
      h += b.h
    }
    if !cur.isEmpty { chunks.append(cur) }
    return try chunks.map { chunk in
      try bitmap(1080, chunk.reduce(0) { $0 + $1.h }, scale, p) { ctx in
        var y = 0.0
        for b in chunk {
          try b.draw(ctx, y)
          y += b.h
        }
      }
    }
  }
}
