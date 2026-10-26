import UIKit

// B3.6 native query sheet + native S02 confirm box.
//
// The web standard answer (copy item by item, the native side is a 1:1 port):
//   src/ui/components/query/QuerySheet.js  the sheet (the panel, the head row, the sticky footer bar, the three-part failure)
//   src/ui/components/query/CharRow.js     one row (the pick checkbox + the char / pinyin / word + the record status + the chevron)
//   src/ui/components/query/CharCard.js     the char card (the two cells, the char / pinyin / word / record lines, the buttons)
//   src/ui/components/query/input.js        the input field, the keyboard avoidance, the IME composition gate
//   src/ui/components/query/index.js        openQuery (the native screen is a route entry)
//   src/ui/components/Sheet.js              the sheet skeleton (the rounded corners, the shadow, "Done", the drag-to-close)
//   src/ui/components/Button.js             the button variants (primary / secondary / text)
//   src/ui/components/FailBlock.js          the three-part failure (a note + [let it go | try again])
//   src/ui/components/Confirm.js            the centered confirm box
//   src/ui/screens/session/s02.js           S02
//
// The model / the ops (never write another model; the field names are copied from the model):
//   src/session/views/query.js  querySheetModel(...)  -> the view.query reply
//   src/session/api/query.js    view.query / query.add / query.pick / query.detail / view.s02 / s02.decide
//
// The native screen is a full-screen transparent layer that draws the sheet itself (the layer below is the web page).
// This file has no Chinese literals (the gate test/ios-native-write.test.mjs scans every native file): every user-visible
// string comes from the model's copy key + parameters and is rendered with ShiziCopy.

// MARK: - The type helpers (the web's font rules)

/// The mixed Chinese + Latin text (the web's font rules): the Chinese is PingFang's (the system font's CJK fallback),
/// the Latin letters / digits / spaces / punctuation are SF's (the web's -apple-system). The composed font (the system
/// font + the PingFang cascade) lets the middle dot fall to PingFang, which is wider than the web's SF middle dot, so
/// the Latin part is measured in SF and the difference is added as the letter spacing of each character.
func setMixedText(_ label: UILabel, _ text: String, font: UIFont, color: UIColor, align: NSTextAlignment, line: CGFloat) {
    NativeType.set(label, text, font: font, color: color, align: align, line: line)
    guard let attr = label.attributedText else { return }
    let out = NSMutableAttributedString(attributedString: attr)
    let sf = UIFont.systemFont(ofSize: font.pointSize, weight: NativeType.weight(of: font))
    var i = 0
    for ch in text {
        let n = (String(ch) as NSString).length
        let cjk = ch.unicodeScalars.contains { $0.value >= 0x2E80 }
        if !cjk {
            let want = (String(ch) as NSString).size(withAttributes: [.font: sf]).width
            let have = (String(ch) as NSString).size(withAttributes: [.font: font]).width
            let cur = (out.attribute(.kern, at: i, effectiveRange: nil) as? NSNumber)?.doubleValue ?? 0
            out.addAttribute(.kern, value: cur + want - have, range: NSRange(location: i, length: n))
        }
        i += n
    }
    label.attributedText = out
}

/// The Chinese letter spacing of a button's title (the web's PingFang tracking at the actual font size).
/// The native side pins the CJK optical size to 17 (NativeType.cjkFont), so the tracking of the actual size is made up
/// here: the difference of the font's trak table between the actual size and 17 (the table is read from the font itself).
/// The regular weight's table is used for every weight (the web's CJK fallback has one table for all the weights).
/// The font can be given: once a title has an attributed title, the label keeps that title's font, so reading the font
/// back from the label would keep the old size (the "done" button's size changes between the AX full sheet and the rest).
func trackTitle(_ b: UIButton, font: UIFont? = nil) {
    let states: [UIControl.State] = [.normal, .disabled, .highlighted]
    let text = b.title(for: .normal) ?? b.attributedTitle(for: .normal)?.string
    guard let t = text, !t.isEmpty, let f = font ?? b.titleLabel?.font, NativeType.hasCJK(t) else {
        if b.attributedTitle(for: .normal) != nil { states.forEach { b.setAttributedTitle(nil, for: $0) } }
        return
    }
    let k = cjkTrackAt(size: f.pointSize)
    guard k != 0 else {
        if b.attributedTitle(for: .normal) != nil { states.forEach { b.setAttributedTitle(nil, for: $0) } }
        return
    }
    let p = NSMutableParagraphStyle()
    p.alignment = b.titleLabel?.textAlignment ?? .center
    for st in states {
        let out = NSMutableAttributedString(string: t, attributes: [.font: f, .foregroundColor: b.titleColor(for: st) ?? b.currentTitleColor, .paragraphStyle: p, .kern: 0])
        var i = 0
        for ch in t {
            let n = (String(ch) as NSString).length
            if ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) { out.addAttribute(.kern, value: k, range: NSRange(location: i, length: n)) }
            i += n
        }
        b.setAttributedTitle(out, for: st)
    }
}

/// The Chinese tracking correction (the web's trak at the actual size − the native's trak at the optical size 17).
func cjkTrackAt(size: CGFloat) -> CGFloat {
    let f = NativeType.cjkFont(size: 17, weight: .regular) as CTFont
    guard let t = NativeType.parseTrak(f), !t.sizes.isEmpty else { return 0 }
    let upem = CGFloat(CTFontGetUnitsPerEm(f))
    func at(_ x: CGFloat) -> CGFloat {
        if x <= t.sizes[0] { return t.values[0] }
        for j in 1..<t.sizes.count where x <= t.sizes[j] {
            let u = (x - t.sizes[j - 1]) / (t.sizes[j] - t.sizes[j - 1])
            return t.values[j - 1] + (t.values[j] - t.values[j - 1]) * u
        }
        return t.values[t.values.count - 1]
    }
    let d = (at(size) - at(17)) / upem * size
    return abs(d) < 0.005 ? 0 : d
}

/// The text with a line break at each of the web's line break points (the page measured them: the Chinese line
/// breaking differs between the web and the native, so the web gives the points and the native breaks there).
func brokenAt(_ text: String, _ starts: [Int]) -> String {
    guard !starts.isEmpty else { return text }
    var out = ""
    for (i, ch) in text.enumerated() {
        if starts.contains(i) { out.append("\n") }
        out.append(ch)
    }
    return out
}

// MARK: - The copy reference in the model ({key, vars})

/// The copy reference the query / S02 models give: a copy key + the parameters (session/views/query.js, session/api/query.js).
struct QueryCopyRef: Decodable, Equatable {
    let key: String
    let vars: [String: Value]?

    enum Value: Decodable, Equatable {
        case text(String)
        case number(Double)

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .text(s); return }
            if let d = try? c.decode(Double.self) { self = .number(d); return }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "copy parameter")
        }

        var text: String {
            switch self {
            case .text(let s): return s
            case .number(let d): return d.rounded() == d && abs(d) < 1e15 ? String(Int64(d)) : String(d)
            }
        }
    }

    /// The rendered sentence. The day parameter is formatted as a date first (the web's cardStatText / formatDay).
    var rendered: String {
        var filled: [String: CustomStringConvertible] = [:]
        for (k, v) in vars ?? [:] {
            filled[k] = v.text
            if k == "day" { filled["date"] = QueryCopyRef.formatDay(v.text) }
        }
        return ShiziCopy.t(key, filled)
    }

    /// localDay ("YYYY-MM-DD") -> the date sentence (R-H02.dateFormat; the web's core/dates.js monthDayParts).
    static func formatDay(_ day: String) -> String {
        let parts = day.split(separator: "-")
        guard parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]) else { return day }
        return ShiziCopy.t("R-H02.dateFormat", ["month": m, "day": d])
    }
}

// MARK: - The overlay timing (T-sheet / T-confirm) from the generated motion tokens

/// The sheet / confirm box timing: the generated motion tokens (config/motion.js M.role / M.easing / M.gesture).
enum QueryOverlay {
    static var spec: NativeOverlaySpec {
        let motion = ShiziTokens.motion
        let role = motion["role"] as? [String: Any] ?? [:]
        let gesture = motion["gesture"] as? [String: Any] ?? [:]
        let duration = motion["duration"] as? [String: Any] ?? [:]
        let easing = motion["easing"] as? [String: Any] ?? [:]
        var spec = NativeOverlaySpec()
        func ms(_ d: [String: Any], _ k: String) -> Double { ((d[k] as? NSNumber)?.doubleValue ?? 0) / 1000 }
        spec.sheetIn = ms(role, "sheetIn")
        spec.sheetOut = ms(role, "sheetOut")
        spec.scrimIn = ms(role, "scrimIn")
        spec.scrimOut = ms(role, "scrimOut")
        spec.confirmIn = ms(role, "confirmIn")
        spec.confirmOut = ms(role, "confirmOut")
        spec.snap = ms(role, "gestureSnap")
        spec.reduce = ms(duration, "reduce")
        spec.easeOut = bezier(easing["out"] as? String)
        spec.easeIn = bezier(easing["in"] as? String)
        if let v = gesture["directionSlop"] as? NSNumber { spec.directionSlop = CGFloat(v.doubleValue) }
        if let v = gesture["sheetCommitRatio"] as? NSNumber { spec.commitRatio = CGFloat(v.doubleValue) }
        if let v = gesture["commitVelocity"] as? NSNumber { spec.commitVelocity = CGFloat(v.doubleValue) }
        if let v = gesture["returnVelocity"] as? NSNumber { spec.returnVelocity = CGFloat(v.doubleValue) }
        if let v = (motion["scale"] as? [String: Any])?["confirmFrom"] as? NSNumber { spec.confirmFrom = CGFloat(v.doubleValue) }
        return spec
    }

    /// "cubic-bezier(.2,.7,.2,1)" -> [0.2, 0.7, 0.2, 1].
    private static func bezier(_ s: String?) -> [Double]? {
        guard let s else { return nil }
        let inner = s.replacingOccurrences(of: "cubic-bezier(", with: "").replacingOccurrences(of: ")", with: "")
        let nums = inner.split(separator: ",").compactMap { Double(String($0).trimmingCharacters(in: .whitespaces)) }
        return nums.count == 4 ? nums : nil
    }
}

// MARK: - The overlay layer (the sheet / the box sits in its own presented layer)

/// The layer an overlay screen draws its scrim and panel in: a transparent controller presented over the screen, like
/// the other native sheets (the change sheet, the choice sheets, the image preview) - so the panel is its own layer above
/// the page below it (the AX checks look for overlaps inside one layer; the page below is covered by design).
final class QueryOverlayLayer: UIViewController {
    /// Someone else takes the layer away while its screen stays (another native page is pushed above the sheet): the
    /// screen takes its views back so the sheet stays where it is under the new page.
    var onRelease: (() -> Void)?
    /// The screen itself is leaving: the layer goes quietly (no release).
    fileprivate(set) var isLeaving = false

    init() {
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let v = UIView()
        v.backgroundColor = .clear
        view = v
    }

    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        if !isLeaving, presentedViewController == nil { onRelease?() }
        let was = isLeaving
        isLeaving = true
        super.dismiss(animated: false) { [weak self] in
            self?.isLeaving = was
            completion?()
        }
    }

    /// The screen is going: drop the layer without handing the views back.
    fileprivate func leaveQuietly(_ done: @escaping () -> Void) {
        guard presentingViewController != nil, !isBeingDismissed else { done(); return }
        isLeaving = true
        dismiss(animated: false) { [weak self] in
            self?.isLeaving = false
            done()
        }
    }
}

/// The overlay part of an overlay screen (the query sheet, the S02 box): the screen is a transparent page in the native
/// stack; its scrim and panel are drawn in a presented QueryOverlayLayer once the page has appeared (the layout keeps
/// using the page's bounds: the layer covers the same screen). The screens call in from their own overrides
/// (loadView / viewDidLoad / traitCollectionDidChange / viewDidAppear / dismiss).
final class QueryOverlayHost {
    let layer = QueryOverlayLayer()
    /// The views drawn in the layer (the scrim, the panel) and the gestures on the layer's view.
    var views: [UIView] = []
    var gestures: [UIGestureRecognizer] = []
    /// The QA marker "the layer is up" (the fixtures wait for it: 1 x 1, alpha 0.01, not in the element list).
    let readyMarker = UIView()
    private weak var page: ShiziScreenViewController?
    private var adopted = false

    init(readyId: String) {
        readyMarker.alpha = 0.01
        readyMarker.isUserInteractionEnabled = false
        readyMarker.isAccessibilityElement = false
        readyMarker.accessibilityIdentifier = readyId
    }

    /// The page's view: transparent (the page under the overlay shows through); the base class's chrome is hidden.
    static func clearView() -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        return v
    }

    /// From the page's viewDidLoad (after super): undo the base class's page colour and chrome.
    func pageDidLoad(_ page: ShiziScreenViewController) {
        self.page = page
        page.view.backgroundColor = .clear
        page.backButton.isHidden = true
        page.titleLabel.isHidden = true
        page.scroll.isHidden = true
        page.screenMarker.isHidden = true
        layer.onRelease = { [weak self] in self?.takeViewsBack() }
    }

    /// Moves the views into the layer and presents it (once, after the page appeared); then() runs when it is up.
    func adopt(then: @escaping () -> Void) {
        guard let page, !adopted, page.presentedViewController == nil, page.presentingViewController != nil else { then(); return }
        adopted = true
        layer.loadViewIfNeeded()
        layer.view.frame = page.view.bounds
        views.forEach { layer.view.addSubview($0) }
        gestures.forEach { layer.view.addGestureRecognizer($0) }
        page.present(layer, animated: false) { [weak self, weak page] in
            guard let self, let page else { return }
            self.readyMarker.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
            page.view.addSubview(self.readyMarker)
            then()
        }
    }

    private func takeViewsBack() {
        guard let page else { return }
        views.forEach { page.view.addSubview($0) }
        gestures.forEach { page.view.addGestureRecognizer($0) }
        page.view.setNeedsLayout()
    }

    /// From the page's dismiss override: true = the layer goes first (quietly), then `dismissPage` runs; false = dismiss
    /// the page as usual (no layer up, or the layer itself is the one leaving).
    func dismissLayerFirst(then dismissPage: @escaping () -> Void) -> Bool {
        guard let page, page.presentedViewController === layer, !layer.isLeaving else { return false }
        layer.leaveQuietly { [weak page] in
            guard page?.presentingViewController != nil else { return }
            dismissPage()
        }
        return true
    }
}

// MARK: - The check mark inside the picked checkbox (the web's Icons.check)

/// The check mark inside the picked checkbox (the web's Icons.check: 13 x 13, the paper color).
/// It is the button's icon (the web draws an svg inside the button), so the QA element list measures the same box.
enum QueryCheck {
    /// The check mark as an image (the web's path: m3 7.2 2.6 2.6 L11 4.4, in a 14 box).
    static func image(_ color: UIColor, side: CGFloat = 13) -> UIImage? {
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
            let s = side / 14
            let p = UIBezierPath()
            p.move(to: CGPoint(x: 3 * s, y: 7.2 * s))
            p.addLine(to: CGPoint(x: 5.6 * s, y: 9.8 * s))
            p.addLine(to: CGPoint(x: 11 * s, y: 4.4 * s))
            p.lineWidth = 1.5 * s
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            color.setStroke()
            p.stroke()
        }
    }
}

// MARK: - One row of characters (the web's CharRow.js)

/// The row's open button (the web's .sz-qrow__open): the texts are drawn by the labels, the title is only the accessible name.
final class QueryRowButton: UIButton {
    /// The union of the row's texts (the QA text frame: the web's button text frame is the union of its text nodes).
    var textUnion = CGRect.zero

    /// The glyph's box (the web draws the char as an svg inside the button; the native side makes it the button's icon,
    /// so the QA element list measures the same box).
    var glyphRect = CGRect.zero

    /// The union / title the title was fitted to (the fit only runs when one of them changes).
    private var fittedUnion = CGRect.zero
    private var fittedTitle = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupTitleLabel()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented.") }

    /// The title label is not drawn (the row's texts are drawn by their own labels); it only carries the QA text
    /// frame. The properties are set once (setting them on every layout pass would make UIKit lay the button out
    /// again, and a rich title would make it lay out forever).
    private func setupTitleLabel() {
        guard let tl = titleLabel else { return }
        if tl.alpha != 0 { tl.alpha = 0 }
        if tl.textAlignment != .left { tl.textAlignment = .left }
        if tl.numberOfLines != 1 { tl.numberOfLines = 1 }
        // The title's font must not be scaled by the accessibility (the button would re-apply the title again, forever).
        if tl.adjustsFontForContentSizeCategory { tl.adjustsFontForContentSizeCategory = false }
    }

    // The title's box is the union of the row's texts (the web's button text frame). UIKit puts the title label
    // there (setting the frame inside layoutSubviews would make UIKit lay the button out again, forever).
    override func titleRect(forContentRect r: CGRect) -> CGRect { textUnion }

    override func imageRect(forContentRect r: CGRect) -> CGRect { glyphRect }

    /// The web measures the button's text frame as the union of all the text nodes inside the button (the hidden char
    /// text + the pinyin + the word + the status). The native side draws those texts in their own labels, so the
    /// (invisible) title carries the union's box: the title's line box is the union's height (the paragraph style
    /// pins the line height), and the title's text is padded with spaces until it is wider than the union's box, so
    /// the label lays the text out in one line that fills the union's box (the QA text compare strips the spaces).
    /// Called from the row's layout (not from the button's layout pass: setting the title there would loop).
    func fitTitle(union: CGRect, font: UIFont) {
        textUnion = union
        guard let text = currentTitle, !text.isEmpty, union.width > 1 else { return }
        // The title may already carry the padding (from an earlier fit): the row's text is the one without it.
        let base = text.trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty else { return }
        if fittedUnion == union && fittedTitle == base { return }
        fittedUnion = union
        fittedTitle = base
        setupTitleLabel()
        let p = NSMutableParagraphStyle()
        p.alignment = .left
        p.minimumLineHeight = union.height
        p.maximumLineHeight = union.height
        p.lineBreakMode = .byTruncatingTail
        let attr = NSAttributedString(string: QueryRowButton.padded(base, font: font, width: union.width), attributes: [
            .font: font,
            .foregroundColor: titleColor(for: .normal) ?? currentTitleColor,
            .paragraphStyle: p,
            .kern: 0,
        ])
        setAttributedTitle(attr, for: .normal)
    }

    /// The text padded with spaces until it is wider than the given width (the label then lays it out in one line
    /// that fills its box, and reports that box as its text frame).
    static func padded(_ text: String, font: UIFont, width: CGFloat) -> String {
        let w = (text as NSString).size(withAttributes: [.font: font]).width
        if w >= width { return text }
        let space = (" " as NSString).size(withAttributes: [.font: font]).width
        guard space > 0.1 else { return text }
        let n = Int(((width - w) / space).rounded(.up)) + 1
        return text + String(repeating: " ", count: n)
    }

    /// The char's outline -> an image (the web's .sz-qrow__char is an outline picture; the native side draws it from the same glyph data).
    static func glyphImage(_ char: String, side: CGFloat, color: UIColor) -> UIImage? {
        guard side > 0, let glyph = NativeGlyphData.load(char) else { return nil }
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
            let cg = ctx.cgContext
            cg.setFillColor(color.cgColor)
            var t = NativeGlyphData.transform(size: side, padRatio: 0)
            for s in glyph.strokes {
                if let moved = s.copy(using: &t) { cg.addPath(moved) }
            }
            cg.fillPath(using: .winding)
        }
    }
}

/// One row of characters: [the pick checkbox] + the char / pinyin / word + the record status + the chevron.
/// The row's texts live inside the open button (the web's spans are inside the button too).
final class QueryCharRow: UIView {
    let selectButton = UIButton(type: .custom)
    let dot = UIView()
    let openButton = QueryRowButton(type: .custom)
    let charGlyph = NativeGlyphView()
    let pinyinLabel = UILabel()
    let wordLabel = UILabel()
    let statusLabel = UILabel()
    let chevron = UIImageView()
    /// The row's bottom hairline (the web's .sz-qrow's border-bottom).
    let hair = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        dot.isUserInteractionEnabled = false
        dot.layer.borderWidth = 1.5
        dot.layer.cornerRadius = 12 // the web's .sz-qrow__dot: a 24 circle
        dot.layer.borderColor = UIColor.clear.cgColor
        addSubview(dot)
        selectButton.backgroundColor = .clear
        selectButton.accessibilityIdentifier = "native-query-row-select"
        addSubview(selectButton)
        for l in [pinyinLabel, wordLabel, statusLabel] {
            l.isUserInteractionEnabled = false
            l.isAccessibilityElement = false
            openButton.addSubview(l)
        }
        charGlyph.isUserInteractionEnabled = false
        charGlyph.padRatio = 0 // the web's row char uses FACE_FULL (the 1024 box fills the cell)
        openButton.addSubview(charGlyph)
        chevron.contentMode = .scaleAspectFit
        openButton.addSubview(chevron)
        openButton.backgroundColor = .clear
        openButton.accessibilityIdentifier = "native-query-row-open"
        addSubview(openButton)
        hair.isUserInteractionEnabled = false
        addSubview(hair)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// The array's safe subscript (the row views are reused; the index may be stale).
extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

// MARK: - The query sheet (the web's QuerySheet.js)

@objc(ShiziScreen_query)
final class QueryScreen: ShiziScreenViewController {
    // MARK: The model (the field names are copied from session/views/query.js)

    struct Model: Decodable {
        struct Row: Decodable {
            let char: String
            let pinyin: String
            let word: String
            let status: QueryCopyRef
            let selectable: Bool
            let selected: Bool
            let practicable: Bool
            let custom: Bool
            let count: Int
        }
        struct Card: Decodable {
            let char: String
            let pinyin: String
            let word: String
            let strokes: Int
            let custom: Bool
            let count: Int
            let meta: QueryCopyRef?
            let stat: QueryCopyRef
            let ink: [[[Double]]]?
            /// The same record's raw strokes on the bridge ([[x, y, t, p]...], the detail page's view.detail shape): the native
            /// paints them with the web's ink algorithm (the web's InkMini paints the resampled points above).
            let inkStrokes: [[[Double]]]?
            /// The web's line break points of the two secondary buttons (the page measured them).
            let addLines: [Int]?
            let detailLines: [Int]?
        }
        struct Bad: Decodable {
            let char: String
            let pinyin: String
            let word: String
            let strokes: Int
            let custom: Bool
            let count: Int
            let title: QueryCopyRef
            let reason: QueryCopyRef
            let source: QueryCopyRef
        }
        struct Bar: Decodable {
            let key: String
            let vars: [String: QueryCopyRef.Value]?
            let disabled: Bool
            var text: String {
                var filled: [String: CustomStringConvertible] = [:]
                for (k, v) in vars ?? [:] { filled[k] = v.text }
                return ShiziCopy.t(key, filled)
            }
        }
        let mode: String
        let title: QueryCopyRef
        let placeholder: QueryCopyRef
        let view: String
        let cur: String
        let multi: Bool
        let notes: [QueryCopyRef]
        let hint: QueryCopyRef?
        let rows: [Row]
        let card: Card?
        let bad: Bad?
        let back: QueryCopyRef?
        let bar: Bar?
        let chosen: [String]
    }

    /// The failure of "start practicing": the same batch of chars is retried (the web's goFailed).
    struct GoFailure {
        let chars: [String]
        let from: String
    }

    // MARK: The sheet's transient state (not business state: the model is always re-fetched with view.query)

    private var model: Model?
    private var mode = "lookup"
    /// The text the model was fetched with (the pinyin inside an IME composition is not counted: the web's createTextGate).
    private var committedText = ""
    /// The text currently in the input field.
    private var fieldText = ""
    private var cur = ""
    private var selected: [String] = []
    /// The failure of "add to the custom list" (the three-part block in the footer).
    private var addFailed = false
    /// The failure of "start practicing" (the three-part block in the footer).
    private var goFailure: GoFailure?
    private var busy = false
    private var didReload = false
    /// The keyboard's top edge in the view's coordinates (nil = the keyboard is down).
    private var keyboardTop: CGFloat?

    /// The gap between the sheet's bottom edge and the top of the keyboard.
    /// The web keeps a bar above the keyboard (the browser's bar for the focused field): its keyboard area is 403pt
    /// (336 keyboard + 67 bar) on a 402x874 screen, so the visible area is 471pt and the sheet's bottom edge sits at
    /// y = 471. The native raises the same system keyboard (336pt) and keeps the same gap, so the sheet's bottom edge
    /// lands where the reference has it (Reference/query-*.png).
    private static let keyboardTopGap: CGFloat = 67
    private var rowViews: [QueryCharRow] = []
    /// The ink of the card (the pipeline points; the ink view is made when the cell's side is known).
    private var cardInk: [[[Double]]]?
    private var cardInkKey = ""
    /// The dashed frame of the empty "your writing" cell (the web's .sz-qcard__empty: frame-w dashed frame).
    private let mineDash = CAShapeLayer()
    /// The card's two captions (the web's .sz-qcard__label).
    private var mineCaptionText = ""
    private var refCaptionText = ""
    /// The side the current ink view was made for.
    private var inkSide: CGFloat = 0
    private var edgePan = UIScreenEdgePanGestureRecognizer()
    private var sheetPan = UIPanGestureRecognizer()
    private var sheetDragging = false

    // MARK: The views (the member names / accessibilityIdentifiers are the semantic keys for the QA capture: keys/query.mjs)

    let scrim = UIView()
    let sheet = UIView()
    let head = UIView()
    let sheetTitle = UILabel()
    let doneButton = NativeTextButton(type: .custom)
    let queryBody = UIView()
    let inputField = UITextField()
    let scrollArea = UIScrollView()
    let scrollContent = UIView()
    let notesBox = UIView()
    let rowsBox = UIView()
    /// The rows list's top hairline (the web's .sz-qrows's border-top).
    let rowsHair = UIView()
    let hintLabel = UILabel()
    let rowsBackButton = NativeTextButton(type: .custom)
    let cardBox = UIView()
    let mineCell = UIView()
    let mineInk = UIView()
    let mineEmpty = UILabel()
    let refCell = UIView()
    let refGlyph = NativeGlyphView()
    let mineCaption = UILabel()
    let refCaption = UILabel()
    let cardChar = NativeGlyphView()
    let metaLabel = UILabel()
    let wordLabel = UILabel()
    let statLabel = UILabel()
    let addButton = UIButton(type: .custom)
    let detailButton = UIButton(type: .custom)
    let badBox = UIView()
    let badTitle = UILabel()
    let badReason = UILabel()
    let badSource = UILabel()
    let foot = UIView()
    let goButton = UIButton(type: .custom)
    let failBlock = UIView()
    let failNote = UILabel()
    let failCancel = NativeTextButton(type: .custom)
    let failRetry = UIButton(type: .custom)

    // MARK: Life cycle

    required init(screen: String, entryId: String, params: [String: Any]) {
        super.init(screen: screen, entryId: entryId, params: params)
        // The sheet is not a page: the outer transition is a 150ms fade (not the full-page horizontal push).
        transitions.fadeNext = true
        mode = (params["mode"] as? String) == "pick" ? "pick" : "lookup"
        fieldText = params["text"] as? String ?? ""
        // While the IME is composing, the pinyin in the field is not the query yet (the web's composition gate).
        committedText = (params["composing"] as? Bool) == true ? "" : fieldText
        selected = (params["selected"] as? [String]) ?? []
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overlay.pageDidLoad(self)
        scrim.backgroundColor = color("scrim")
        scrim.accessibilityIdentifier = "native-query-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        view.addSubview(scrim)

        sheet.backgroundColor = color("elev")
        sheet.layer.cornerRadius = metrics.value("r-box")
        sheet.layer.cornerCurve = .continuous
        sheet.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        sheet.accessibilityIdentifier = "native-query-sheet"
        sheet.clipsToBounds = false
        view.addSubview(sheet)

        head.accessibilityIdentifier = "native-query-head"
        sheet.addSubview(head)

        sheetTitle.numberOfLines = 1
        sheetTitle.accessibilityTraits = [.header]
        sheetTitle.accessibilityIdentifier = "native-query-title"
        head.addSubview(sheetTitle)

        doneButton.titleLabel?.numberOfLines = 1
        doneButton.accessibilityIdentifier = "native-query-done"
        head.addSubview(doneButton)
        wire(doneButton) { ($0 as? QueryScreen)?.closeSheet() }

        queryBody.accessibilityIdentifier = "native-query-body"
        sheet.addSubview(queryBody)

        styleInput()
        queryBody.addSubview(inputField)
        inputField.accessibilityIdentifier = "native-query-input"

        scrollArea.alwaysBounceVertical = true
        scrollArea.showsVerticalScrollIndicator = false
        scrollArea.contentInsetAdjustmentBehavior = .never
        scrollArea.delaysContentTouches = false
        scrollArea.accessibilityIdentifier = "native-query-scroll"
        scrollArea.addSubview(scrollContent)
        queryBody.addSubview(scrollArea)

        notesBox.accessibilityIdentifier = "native-query-notes"
        scrollContent.addSubview(notesBox)
        rowsBox.accessibilityIdentifier = "native-query-rows"
        scrollContent.addSubview(rowsBox)
        rowsHair.isUserInteractionEnabled = false
        rowsHair.backgroundColor = color("line")
        scrollContent.addSubview(rowsHair)

        hintLabel.numberOfLines = 0
        hintLabel.accessibilityIdentifier = "native-query-hint"
        scrollContent.addSubview(hintLabel)

        rowsBackButton.titleLabel?.numberOfLines = 1
        rowsBackButton.accessibilityIdentifier = "native-query-back"
        scrollContent.addSubview(rowsBackButton)
        wire(rowsBackButton) { ($0 as? QueryScreen)?.backToRows() }

        cardBox.accessibilityIdentifier = "native-query-card"
        cardBox.backgroundColor = color("field")
        cardBox.layer.cornerRadius = metrics.value("r-ctl")
        cardBox.layer.cornerCurve = .continuous
        scrollContent.addSubview(cardBox)

        mineCell.layer.borderWidth = 1
        mineCell.layer.borderColor = color("frame").cgColor
        mineCell.layer.cornerRadius = metrics.value("r-work")
        mineCell.clipsToBounds = true
        cardBox.addSubview(mineCell)
        mineCell.addSubview(mineInk)
        mineDash.fillColor = UIColor.clear.cgColor
        mineDash.lineWidth = 1
        mineDash.lineDashPattern = [4, 3]
        mineCell.layer.addSublayer(mineDash)
        mineEmpty.numberOfLines = 0
        mineEmpty.textAlignment = .center
        mineCell.addSubview(mineEmpty)

        refCell.backgroundColor = color("sheet")
        refCell.layer.borderWidth = 1
        refCell.layer.borderColor = color("frame").cgColor
        refCell.layer.cornerRadius = metrics.value("r-work")
        refCell.clipsToBounds = true
        refCell.accessibilityIdentifier = "native-query-card-ref"
        cardBox.addSubview(refCell)
        refGlyph.padRatio = 0.06 // the web's RefMini draws the glyph with the 6% padding
        refCell.addSubview(refGlyph)

        mineCaption.numberOfLines = 1
        mineCaption.textAlignment = .center
        cardBox.addSubview(mineCaption)
        refCaption.numberOfLines = 1
        refCaption.textAlignment = .center
        cardBox.addSubview(refCaption)

        cardChar.padRatio = 0 // the web's card char uses FACE_FULL
        cardBox.addSubview(cardChar)
        metaLabel.numberOfLines = 1
        metaLabel.accessibilityIdentifier = "native-query-card-meta"
        cardBox.addSubview(metaLabel)
        wordLabel.numberOfLines = 1
        wordLabel.accessibilityIdentifier = "native-query-card-word"
        cardBox.addSubview(wordLabel)
        statLabel.numberOfLines = 0
        statLabel.accessibilityIdentifier = "native-query-card-stat"
        cardBox.addSubview(statLabel)

        styleSecondary(addButton, id: "native-query-card-add")
        styleSecondary(detailButton, id: "native-query-card-detail")
        scrollContent.addSubview(addButton)
        scrollContent.addSubview(detailButton)
        wire(addButton) { ($0 as? QueryScreen)?.addToCustom() }
        wire(detailButton) { ($0 as? QueryScreen)?.showDetail() }

        badBox.backgroundColor = color("field")
        badBox.layer.cornerRadius = metrics.value("r-ctl")
        badBox.accessibilityIdentifier = "native-query-bad"
        scrollContent.addSubview(badBox)
        for l in [badTitle, badReason, badSource] {
            l.numberOfLines = 0
            badBox.addSubview(l)
        }

        foot.accessibilityIdentifier = "native-query-card-foot"
        foot.backgroundColor = color("elev")
        sheet.addSubview(foot)
        stylePrimary(goButton, id: "native-query-go")
        foot.addSubview(goButton)
        wire(goButton) { ($0 as? QueryScreen)?.startPractice(from: "bar") }

        // The failure block (the web's FailBlock, layout dialog): the note + [let it go | try again].
        // It sits inside the foot (the web's .sz-query__foot) and is its own element (query-card-add-fail).
        failBlock.accessibilityIdentifier = "native-query-card-add-fail"
        foot.addSubview(failBlock)
        failNote.numberOfLines = 0
        failNote.accessibilityIdentifier = "native-query-card-add-fail-note"
        failBlock.addSubview(failNote)
        failCancel.titleLabel?.numberOfLines = 1
        failCancel.accessibilityIdentifier = "native-query-card-add-fail-cancel"
        failBlock.addSubview(failCancel)
        stylePrimary(failRetry, id: "native-query-card-add-fail-retry")
        failBlock.addSubview(failRetry)
        wire(failCancel) { ($0 as? QueryScreen)?.cancelFailure() }
        wire(failRetry) { ($0 as? QueryScreen)?.retryFailure() }

        // The keyboard avoidance: the sheet's bottom edge rides on the keyboard's top edge.
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)),
                                               name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)),
                                               name: UIResponder.keyboardWillHideNotification, object: nil)
        // Drag to close (the web's Sheet.js createSheetDrag): follow the finger, commit or snap back.
        sheetPan.delegate = self
        sheetPan.addTarget(self, action: #selector(sheetPanned(_:)))
        sheet.addGestureRecognizer(sheetPan)
        // The left edge swipe closes the sheet (the web's overlay edge gesture); the base class's page gesture is off.
        edgePan.edges = .left
        edgePan.delegate = self
        edgePan.addTarget(self, action: #selector(edgePanned(_:)))
        view.addGestureRecognizer(edgePan)
        overlay.views = [scrim, sheet]
        overlay.gestures = [edgePan]
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !entered else { return }
        entered = true
        overlay.adopt { [weak self] in self?.enter() }
    }

    private var entered = false

    /// The sheet's own entrance (once the layer is up): the scrim fades in + the panel slides up (the web's T-sheet).
    private func enter() {
        let spec = QueryOverlay.spec
        if NativeWriteTransitions.reduceMotion {
            scrim.alpha = 1
            sheet.alpha = 1
        } else {
            scrim.alpha = 0
            sheet.alpha = 1
            sheet.transform = CGAffineTransform(translationX: 0, y: sheet.bounds.height)
            NativeOverlaySpec.run(spec.scrimIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), { self.scrim.alpha = 1 })
            NativeOverlaySpec.run(spec.sheetIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                self.sheet.transform = .identity
            })
        }
        NativeA11y.screenChanged(sheetTitle)
        // The input takes the focus right away (the web's handOffFocus): the keyboard comes up.
        inputField.becomeFirstResponder()
        if !didReload {
            didReload = true
            reload()
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        inputField.resignFirstResponder()
    }

    // MARK: The overlay layer (QueryOverlayHost)

    let overlay = QueryOverlayHost(readyId: "native-query-ready")

    override func loadView() {
        view = QueryOverlayHost.clearView()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        // The ink colour is the theme's hand colour: paint the card's ink again on a theme change.
        if previous?.userInterfaceStyle != traitCollection.userInterfaceStyle { inkSide = 0 }
        super.traitCollectionDidChange(previous)
        view.backgroundColor = .clear // the base class paints the page colour again on a theme change
    }

    /// The page itself is dismissed (back, or released by the stage): the layer goes first, quietly, then the page.
    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        let handled = overlay.dismissLayerFirst { [weak self] in self?.dismissPage(animated: flag, completion: completion) }
        if !handled { super.dismiss(animated: flag, completion: completion) }
    }

    private func dismissPage(animated flag: Bool, completion: (() -> Void)?) {
        super.dismiss(animated: flag, completion: completion)
    }



    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat { top }

    /// The engine is not ready: the sheet stays on the screen, the buttons are not clickable (the base class's rule).
    override func engineStatusChanged(_ s: ShiziEngineStatus) {
        super.engineStatusChanged(s)
        let ready = s.isReady
        queryBody.isUserInteractionEnabled = ready
        foot.isUserInteractionEnabled = ready
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutSheet()
    }

    // MARK: The model

    /// Re-pulls the view with the current input / pre-selection / char being viewed (the base class reload
    /// uses the route's original params, which only hold the values from the moment the sheet opened).
    override func reload() {
        guard let engine = stage?.engine else { return }
        var p = params
        p["mode"] = mode
        p["text"] = committedText // Pinyin still being composed does not count as a query (web createTextGate)
        p["cur"] = cur
        p["selected"] = selected
        Task { @MainActor [weak self] in
            let body = await engine.raw("view.query", p)
            self?.apply(payload: body)
        }
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: Model.self)
        // The ink table travels with the view (the detail page's view.detail does the same): the card's ink is painted with it.
        if let k = WebInkParams((raw as? [String: Any])?["ink"]) { WebInkParams.current = k }
        model = m
        if m.mode == "pick" { mode = "pick" }
        applyModel(m)
    }

    /// The model changed: the texts, the rows, the card, the footer.
    private func applyModel(_ m: Model) {
        // The head: the title (the song face, 22 / 500) + the "done" button on the right.
        let title = m.title.rendered
        NativeType.set(sheetTitle, title, font: NativeType.song(size: metrics.value("fs22"), weight: .medium),
                       color: color("ink1"), align: .left, line: metrics.line("lh22"))
        ShiziFonts.untrack(sheetTitle)
        sheetTitle.accessibilityLabel = title
        sheetTitle.isHidden = largeText && keyboardTop != nil // the full-height sheet hides the title (it stays the dialog's name)

        let done = t("X-COMMON.done")
        doneButton.setTitle(done, for: .normal)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        doneButton.accessibilityLabel = done
        trackTitle(doneButton, font: doneFont)
        doneButton.titleLabel?.font = doneFont

        if inputField.attributedPlaceholder == nil || inputField.text != fieldText {
            inputField.text = fieldText
        }
        inputField.attributedPlaceholder = NSAttributedString(string: m.placeholder.rendered, attributes: [
            .font: ShiziFonts.kai(size: metrics.value("fs22")), .foregroundColor: color("ink2"),
        ])

        // The filter notes (the web's .sz-query__notes).
        notesBox.isHidden = m.notes.isEmpty
        for (i, n) in m.notes.enumerated() {
            let label = noteLabel(i)
            label.isHidden = false
            NativeType.set(label, n.rendered, font: metrics.font(13), color: color("ink2"), align: .left, line: metrics.line("lh13"))
        }
        for i in m.notes.count..<noteLabels.count { noteLabels[i].isHidden = true }

        // The rows.
        rowsBox.isHidden = m.view != "rows"
        syncRows(m.rows)

        // The hint.
        hintLabel.isHidden = m.hint == nil
        if let h = m.hint {
            NativeType.set(hintLabel, h.rendered, font: metrics.font(13), color: color("ink3"), align: .left, line: metrics.line("lh13"))
        }

        // The "back to the N chars" button.
        rowsBackButton.isHidden = m.back == nil
        if let b = m.back {
            rowsBackButton.setTitle(b.rendered, for: .normal)
            rowsBackButton.titleLabel?.font = metrics.font(15)
            rowsBackButton.setTitleColor(color("ink2"), for: .normal)
            trackTitle(rowsBackButton)
        }

        // The card / the "cannot practice" box.
        let showCard = m.view == "card" && m.card != nil
        let showBad = m.view == "bad" && m.bad != nil
        cardBox.isHidden = !showCard
        badBox.isHidden = !showBad
        if let c = m.card, showCard { applyCard(c) }
        if let b = m.bad, showBad { applyBad(b) }
        // The two secondary buttons belong to the card (the web only has them with a card).
        if !showCard {
            addButton.isHidden = true
            detailButton.isHidden = true
        }

        // The foot: the pick bar / the card's primary button / the three-part failure.
        applyFoot(m)

        markStateChange()
        view.setNeedsLayout()
    }

    /// One label per filter note (the notes are few; the labels are reused).
    private func noteLabel(_ i: Int) -> UILabel {
        while noteLabels.count <= i { noteLabels.append(UILabel()) }
        let l = noteLabels[i]
        if l.superview == nil { notesBox.addSubview(l) }
        return l
    }
    private var noteLabels: [UILabel] = []

    /// The rows: one view per row (reused).
    private func syncRows(_ rows: [Model.Row]) {
        while rowViews.count < rows.count {
            let r = QueryCharRow(frame: .zero)
            r.accessibilityIdentifier = "native-query-row"
            r.selectButton.addTarget(self, action: #selector(rowToggled(_:)), for: .touchUpInside)
            r.openButton.addTarget(self, action: #selector(rowOpened(_:)), for: .touchUpInside)
            rowViews.append(r)
            rowsBox.addSubview(r)
        }
        for (i, r) in rowViews.enumerated() { r.isHidden = i >= rows.count }
        for (i, row) in rows.enumerated() {
            guard i < rowViews.count else { break }
            let v = rowViews[i]
            let practicable = row.practicable
            // The char's outline: the web draws it as an svg inside the button; the native side makes it the button's icon
            // (the QA element list then measures the same box on both sides).
            let side = metrics.value("fs28")
            v.charGlyph.isHidden = true
            v.openButton.setImage(QueryRowButton.glyphImage(row.char, side: side, color: practicable ? color("ink1") : color("ink4")), for: .normal)
            NativeType.set(v.pinyinLabel, row.pinyin, font: metrics.font(15), color: color("ink2"), align: .left, line: metrics.line("lh15"))
            let showWord = !row.word.isEmpty && row.word != row.char
            v.wordLabel.isHidden = !showWord
            if showWord {
                NativeType.set(v.wordLabel, row.word, font: ShiziFonts.kai(size: metrics.value("fs17")),
                               color: color("ink2"), align: .left, line: metrics.line("lh17s"))
                ShiziFonts.untrack(v.wordLabel)
            }
            let status = row.status.rendered
            NativeType.set(v.statusLabel, status, font: metrics.font(13), color: color("ink3"), align: .right, line: metrics.line("lh13"))
            v.chevron.image = ShiziChevron.image(color("ink4"), size: CGSize(width: 8, height: 13))
            // The button's own text: all the texts of the row (the web's button text).
            var parts = [row.char]
            if !row.pinyin.isEmpty { parts.append(row.pinyin) }
            if showWord { parts.append(row.word) }
            parts.append(status)
            v.openButton.setTitle(parts.joined(separator: " "), for: .normal)
            v.openButton.titleLabel?.font = metrics.font(15)
            v.openButton.setTitleColor(color("ink1"), for: .normal)
            v.openButton.accessibilityLabel = row.pinyin.isEmpty
                ? t("X-QUERY.rowAriaNoPinyin", ["char": row.char, "status": status])
                : t("X-QUERY.rowAria", ["char": row.char, "pinyin": row.pinyin, "status": status])
            // The checkbox (the pick mode only).
            v.selectButton.isHidden = !row.selectable
            v.dot.isHidden = !row.selectable // the web only draws the circle in pick mode
            v.selectButton.accessibilityLabel = t(row.selected ? "X-QUERY.unselectAria" : "X-QUERY.selectAria", ["char": row.char])
            // The checkbox button carries no text of its own; its title's font and colour are the web's (ink1 / 15).
            v.selectButton.titleLabel?.font = metrics.font(15)
            v.selectButton.setTitleColor(color("ink1"), for: .normal)
            v.dot.layer.borderColor = (row.selected ? color("ink1") : color("ink4")).cgColor
            v.dot.backgroundColor = row.selected ? color("ink1") : .clear
            // The check mark is the button's icon (the web draws an svg inside the button).
            v.selectButton.setImage(row.selected ? QueryCheck.image(color("paper")) : nil, for: .normal)
            v.selectButton.accessibilityValue = row.selected ? "1" : "0"
            v.hair.backgroundColor = color("line")
        }
    }

    /// The char card (the web's CharCard).
    private func applyCard(_ c: Model.Card) {
        let meta = c.meta?.rendered ?? ""
        metaLabel.isHidden = meta.isEmpty
        if !meta.isEmpty {
            setMixedText(metaLabel, meta, font: metrics.font(15), color: color("ink2"), align: .left, line: metrics.line("lh15"))
        }
        let showWord = !c.word.isEmpty && c.word != c.char
        wordLabel.isHidden = !showWord
        if showWord {
            NativeType.set(wordLabel, c.word, font: ShiziFonts.kai(size: metrics.value("fs22")),
                           color: color("ink1"), align: .left, line: metrics.line("lh22"))
            ShiziFonts.untrack(wordLabel)
        }
        setMixedText(statLabel, c.stat.rendered, font: metrics.font(15), color: color("ink2"), align: .left, line: metrics.line("lh15"))
        cardChar.char = c.char
        cardChar.color = color("ink1")
        refGlyph.char = c.char
        refGlyph.color = color("ref")
        mineCaptionText = t("R-W09.labelMine")
        refCaptionText = t("R-W09.labelReference")
        applyCaption(mineCaption, mineCaptionText, wrap: false)
        applyCaption(refCaption, refCaptionText, wrap: false)

        // The ink (the latest judged record): the pipeline points -> the ink view (the web's InkMini).
        let hasInk = !(c.inkStrokes ?? []).isEmpty
        if cardInkKey != c.char || hasInk != (cardInk != nil) { inkSide = 0 } // a new char / ink: paint again
        cardInkKey = c.char
        cardInk = hasInk ? c.inkStrokes : nil
        mineInk.isHidden = !hasInk
        mineEmpty.isHidden = hasInk || c.count == 0
        // The web's .sz-compare__card (with ink: a solid frame on the sheet colour) / .sz-qcard__empty (no ink: a dashed frame).
        mineDash.isHidden = hasInk
        mineDash.strokeColor = color("frame").cgColor
        if hasInk {
            mineCell.backgroundColor = color("sheet")
            mineCell.layer.borderWidth = 1
            mineCell.layer.borderColor = color("frame").cgColor
            mineCell.accessibilityIdentifier = "native-query-card-mine"
            mineCell.accessibilityLabel = t("R-W09.labelMine")
        } else {
            mineCell.backgroundColor = .clear
            mineCell.layer.borderWidth = 0
            mineCell.accessibilityIdentifier = "native-query-card-mine-empty"
            if c.count > 0 {
                NativeType.set(mineEmpty, t("R-D07.noInkLabel"), font: metrics.font(13), color: color("ink2"),
                               align: .center, line: metrics.line("lh13"))
                mineCell.accessibilityLabel = t("R-D07.noInkLabel")
            } else {
                mineEmpty.text = ""
                mineCell.accessibilityLabel = t("R-W09.labelMine")
            }
        }

        // The two secondary buttons (the web's CardSecondary): the "add" button, the "view records" button.
        // In the failure state the web's CardSecondary is empty (the failure block takes its place).
        let inCustom = c.custom
        addButton.isHidden = addFailed || goFailure != nil
        let addText = inCustom ? t("R-Q05.alreadyAdded") : t("R-Q05.btnAdd")
        addButton.setTitle(brokenAt(addText, c.addLines ?? []), for: .normal)
        addButton.isEnabled = !inCustom
        addButton.accessibilityLabel = addButton.title(for: .normal)
        updateSecondaryState(addButton)
        trackTitle(addButton)
        detailButton.isHidden = addFailed || goFailure != nil || c.count == 0
        let detailText = t("R-Q05.viewRecords")
        detailButton.setTitle(brokenAt(detailText, c.detailLines ?? []), for: .normal)
        detailButton.accessibilityLabel = detailButton.title(for: .normal)
        updateSecondaryState(detailButton)
        trackTitle(detailButton)
    }

    /// The web's disabled secondary button (Button.js: .sz-btn--secondary[disabled]): the field background, no border.
    private func updateSecondaryState(_ b: UIButton) {
        b.backgroundColor = b.isEnabled ? .clear : color("field")
        b.layer.borderWidth = b.isEnabled ? 1 : 0
    }

    /// The web's disabled primary button (Button.js: .sz-btn--primary[disabled]): the field background.
    private func updatePrimaryState(_ b: UIButton) {
        b.backgroundColor = b.isEnabled ? color("btn-bg") : color("field")
    }

    /// The web's caption (the .sz-qcard__label span in a centered flex column): the text is centered while it fits the
    /// column; when the text is wider than the column, the span fills the column and the text wraps (left-aligned).
    private func applyCaption(_ label: UILabel, _ text: String, wrap: Bool) {
        label.numberOfLines = wrap ? 0 : 1
        NativeType.set(label, text, font: metrics.font(13), color: color("ink2"),
                       align: wrap ? .left : .center, line: metrics.line("lh13"))
    }

    /// The "cannot practice" box (the web's BadCard).
    private func applyBad(_ b: Model.Bad) {
        NativeType.set(badTitle, b.title.rendered, font: metrics.font(15), color: color("ink1"), align: .left, line: metrics.line("lh15"))
        NativeType.set(badReason, b.reason.rendered, font: metrics.font(13), color: color("ink2"), align: .left, line: metrics.line("lh13"))
        NativeType.set(badSource, b.source.rendered, font: metrics.font(13), color: color("ink2"), align: .left, line: metrics.line("lh13"))
    }

    /// The foot: the pick bar, the card's primary button, or the three-part failure.
    private func applyFoot(_ m: Model) {
        let failed = addFailed || goFailure != nil
        failBlock.isHidden = !failed
        failNote.isHidden = !failed
        failCancel.isHidden = !failed
        failRetry.isHidden = !failed
        goButton.isHidden = failed
        if failed {
            foot.isHidden = false
            // The web's CardSecondary is empty in the failure state.
            addButton.isHidden = true
            detailButton.isHidden = true
            // The foot stays the foot (the web keeps .sz-query__foot and puts the failure block inside it).
            foot.accessibilityIdentifier = m.bar != nil ? "native-query-bar" : "native-query-card-foot"
            failBlock.accessibilityIdentifier = goFailure != nil ? "native-query-card-practice-fail" : "native-query-card-add-fail"
            let note = goFailure != nil ? t("R-H06.saveFailed") : t("R-Q05.addFailed")
            NativeType.set(failNote, note, font: metrics.font(15), color: color("ink2"), align: .left, line: metrics.line("lh15"))
            failNote.accessibilityIdentifier = goFailure != nil ? "native-query-card-practice-fail-note" : "native-query-card-add-fail-note"
            let cancel = goFailure != nil ? t("R-H06.cancel") : t("R-Q05.cancel")
            failCancel.setTitle(cancel, for: .normal)
            failCancel.titleLabel?.font = metrics.font(15)
            failCancel.setTitleColor(color("ink2"), for: .normal)
            failCancel.accessibilityLabel = cancel
            trackTitle(failCancel)
            let retry = t("R-H06.retry")
            failRetry.setTitle(retry, for: .normal)
            failRetry.accessibilityLabel = retry
            failRetry.accessibilityIdentifier = goFailure != nil ? "native-query-card-practice-fail-retry" : "native-query-card-add-fail-retry"
            trackTitle(failRetry)
            return
        }
        // The normal case: the pick bar (the pick mode) or the card's primary button.
        if let bar = m.bar {
            goButton.isHidden = false
            goButton.setTitle(bar.text, for: .normal)
            goButton.isEnabled = !bar.disabled
            goButton.accessibilityLabel = bar.text
            goButton.accessibilityIdentifier = "native-query-go"
            updatePrimaryState(goButton)
            trackTitle(goButton)
            foot.accessibilityIdentifier = "native-query-bar"
            foot.isHidden = false
        } else if m.view == "card" {
            goButton.isHidden = false
            goButton.setTitle(t("R-Q05.btnPractice"), for: .normal)
            goButton.isEnabled = true
            goButton.accessibilityLabel = t("R-Q05.btnPractice")
            goButton.accessibilityIdentifier = "native-query-card-practice"
            updatePrimaryState(goButton)
            trackTitle(goButton)
            foot.accessibilityIdentifier = "native-query-card-foot"
            foot.isHidden = false
        } else {
            // No bar and no card: the web has no foot at all (the lookup hint state).
            goButton.isHidden = true
            foot.accessibilityIdentifier = "native-query-card-foot"
            foot.isHidden = true
        }
    }

    /// The web's hairline (--hair: 0.5px): the row's bottom border and the rows list's top border. WebKit rounds a
    /// 0.5px border to one device pixel (0.33pt on a 3x screen), so the native draws the same one-pixel line.
    private var hairline: CGFloat { 1 / (view.window?.screen.scale ?? UIScreen.main.scale) }


    // MARK: The layout

    /// The system text size is large (the web's --k >= 1.3: the sheet is full height while the keyboard is up).
    private var largeText: Bool { metrics.value("fs17") / 17 >= 1.3 }

    /// The sheet is full height (the web's data-full="true": the large text size with the keyboard up).
    private var sheetFull: Bool { largeText && keyboardTop != nil }

    /// The "done" button's font (the web's .sz-sheet__done: the AX full sheet caps the size at 22, the rest uses fs15).
    private var doneFont: UIFont {
        (axLayout && sheetFull) ? NativeType.compose(size: 22, weight: .regular) : metrics.font(15)
    }

    /// The input's height (the web's .sz-query__input: min-height 52px — the box does not grow with the text size).
    private var inputHeight: CGFloat { metrics.hit + 8 }

    private func layoutSheet() {
        let W = view.bounds.width
        let H = view.bounds.height
        guard W > 0 else { return }
        let safeTop = view.safeAreaInsets.top
        let safeBottom = view.safeAreaInsets.bottom
        let gutter = metrics.gutter
        let gap = metrics.space(4)
        let headH: CGFloat = metrics.hit
        let keyboardUp = keyboardTop != nil
        // The sheet's bottom edge rides on the top of the keyboard area. The web keeps a bar above the keyboard (the
        // browser's bar for the focused field), so the native keeps the same gap and the visible area matches.
        let bottom = keyboardUp ? max(0, (keyboardTop ?? H) - Self.keyboardTopGap) : H
        let visibleH = bottom
        let full = sheetFull
        let minH = floor(visibleH * 0.64)
        let maxH = floor(visibleH * 0.88)
        let padTop = full ? max(metrics.space(4), safeTop) : metrics.space(6)
        let padBottom = keyboardUp ? 16 : max(32, safeBottom)
        let contentW = W - 2 * gutter

        scrim.frame = view.bounds

        // The scroll content (laid out first: its height decides the sheet's height).
        let contentH = layoutContent(width: contentW)

        // The foot: the primary button, or the three-part failure block (the web's .sz-query__foot).
        let hasFoot = !foot.isHidden
        let failH = hasFoot && !failBlock.isHidden ? failBlockHeight(width: contentW) : 0
        let footH = hasFoot ? metrics.space(3) + (failH > 0 ? failH : buttonHeight) + padBottom : 0
        // The head is out of the flow while the sheet is full height (it sits at the top right).
        let headInFlow = !full
        var natural = padTop + (headInFlow ? headH + gap : 0) + inputHeight + gap + contentH
        natural += hasFoot ? gap + footH : padBottom
        let sheetH = full ? visibleH : min(max(natural, minH), maxH)
        sheet.frame = CGRect(x: 0, y: bottom - sheetH, width: W, height: sheetH)
        sheet.layer.cornerRadius = full ? 0 : metrics.value("r-box")
        sheet.layer.maskedCorners = full ? [] : [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        applySheetShadow()

        // The head: the title on the left, the "done" button on the right (the full-height sheet puts the head at the top right).
        // The AX full sheet caps the "done" button's font size at 22 (the web's Sheet.js AX rule).
        let doneText = t("X-COMMON.done")
        doneButton.setTitle(doneText, for: .normal)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        trackTitle(doneButton, font: doneFont)
        doneButton.titleLabel?.font = doneFont
        let doneW = NativeType.titleWidth(doneButton) + 8
        let doneX = W - gutter + 4 - doneW
        if full {
            head.frame = CGRect(x: doneX, y: max(metrics.space(4), safeTop), width: doneW, height: headH)
            sheetTitle.isHidden = true
        } else {
            head.frame = CGRect(x: gutter, y: padTop, width: contentW, height: headH)
            sheetTitle.isHidden = false
        }
        doneButton.frame = CGRect(x: full ? 0 : doneX - head.frame.minX, y: 0, width: doneW, height: headH)
        let titleH = metrics.line("lh22")
        sheetTitle.frame = CGRect(x: 0, y: (headH - titleH) / 2, width: max(0, head.frame.width - doneW - metrics.space(4)), height: titleH)

        // The body: the input + the scroll area.
        let bodyY = headInFlow ? padTop + headH + gap : padTop
        var bodyH = sheetH - padTop
        if headInFlow { bodyH -= headH + gap }
        bodyH -= hasFoot ? gap + footH : padBottom
        queryBody.frame = CGRect(x: gutter, y: bodyY, width: contentW, height: max(0, bodyH))

        // The input: the right side gives room to the "done" button while the sheet is full height.
        let reserve = full ? (axLayout ? 2 * 22 + 8 + metrics.space(4) : 2 * metrics.value("fs15") + 8 + metrics.space(4)) : 0
        inputField.frame = CGRect(x: 0, y: 0, width: max(0, contentW - reserve), height: inputHeight)
        scrollArea.frame = CGRect(x: 0, y: inputHeight + gap, width: contentW, height: max(0, bodyH - inputHeight - gap))
        scrollContent.frame = CGRect(x: 0, y: 0, width: contentW, height: contentH)
        scrollArea.contentSize = CGSize(width: contentW, height: contentH)

        // The foot: pinned to the bottom of the sheet (the web's .sz-query__foot).
        if hasFoot {
            foot.frame = CGRect(x: 0, y: sheetH - footH, width: W, height: footH)
            layoutFoot(width: contentW, height: footH, padBottom: padBottom)
        }
    }

    /// The scroll content (the web's .sz-query__scroll children): the notes, the rows, the hint, the back button, the card.
    private func layoutContent(width: CGFloat) -> CGFloat {
        var y: CGFloat = 0
        let gap = metrics.space(4)

        // The filter notes.
        if !notesBox.isHidden {
            var ny: CGFloat = 0
            for l in noteLabels where !l.isHidden {
                let h = noteHeight(l, width: width)
                l.frame = CGRect(x: 0, y: ny, width: width, height: h)
                ny += h + metrics.space(2)
            }
            notesBox.frame = CGRect(x: 0, y: y, width: width, height: max(0, ny - metrics.space(2)))
            y += notesBox.frame.height + gap
        } else {
            notesBox.frame = .zero
        }

        // The rows.
        if !rowsBox.isHidden {
            // The web's .sz-qrows has a hairline on top (0.5px), so the first row starts below it.
            var ry: CGFloat = hairline
            for r in rowViews where !r.isHidden {
                let h = rowHeight(r)
                // The web's row is its content plus the hairline at the bottom (fractional heights stack up exactly, as in the web's layout).
                r.frame = CGRect(x: 0, y: ry, width: width, height: h + hairline)
                layoutRow(r, height: h, width: width)
                ry += r.frame.height
            }
            rowsBox.frame = CGRect(x: 0, y: y, width: width, height: ry)
            rowsHair.frame = CGRect(x: 0, y: y, width: width, height: hairline)
            y += ry + gap
        } else {
            rowsBox.frame = .zero
            rowsHair.frame = .zero
        }

        // The hint.
        if !hintLabel.isHidden {
            let h = metrics.line("lh13")
            hintLabel.frame = CGRect(x: 0, y: y, width: width, height: h)
            y += h + gap
        } else {
            hintLabel.frame = .zero
        }

        // The "back to the N chars" button.
        if !rowsBackButton.isHidden {
            rowsBackButton.frame = CGRect(x: 0, y: y, width: width, height: metrics.hit)
            y += metrics.hit - 10 + gap // the web's margin-bottom: -10
        } else {
            rowsBackButton.frame = .zero
        }

        // The card.
        if !cardBox.isHidden {
            let h = layoutCard(width: width)
            cardBox.frame = CGRect(x: 0, y: y, width: width, height: h)
            y += h + gap
        } else {
            cardBox.frame = .zero
        }

        // The "cannot practice" box.
        if !badBox.isHidden {
            let h = layoutBad(width: width)
            badBox.frame = CGRect(x: 0, y: y, width: width, height: h)
            y += h + gap
        } else {
            badBox.frame = .zero
        }

        // The two secondary buttons (below the card, in the scroll area).
        let hasSecondary = !addButton.isHidden || !detailButton.isHidden
        if hasSecondary {
            let half = floor((width - metrics.space(3)) / 2)
            let h = max(buttonHeight,
                        axButtonHeight(addButton, width: half, inset: 16),
                        axButtonHeight(detailButton, width: half, inset: 16))
            addButton.frame = CGRect(x: 0, y: y, width: half, height: h)
            detailButton.frame = CGRect(x: half + metrics.space(3), y: y, width: half, height: h)
            y += h + gap
        } else {
            addButton.frame = .zero
            detailButton.frame = .zero
        }

        return max(0, y - gap)
    }

    /// One filter note (the web's .sz-query__note): the field background, the radius, the dot + the text.
    private func noteHeight(_ label: UILabel, width: CGFloat) -> CGFloat {
        let inner = width - 16 - 6 - 10 - 16
        let textH = NativeType.height(label, width: max(1, inner), line: metrics.line("lh13"))
        return 12 + max(20, textH) + 12
    }

    /// The row's height (the web's .sz-qrow): the char (28) + the word line + the button's padding.
    private func rowHeight(_ row: QueryCharRow) -> CGFloat {
        let wordH: CGFloat = row.wordLabel.isHidden ? 0 : 2 + metrics.line("lh17s")
        return max(metrics.value("fs17") * 64 / 17, metrics.value("fs28") + wordH + 16)
    }

    /// One row (the web's .sz-qrow__sel / .sz-qrow__open).
    private func layoutRow(_ row: QueryCharRow, height h: CGFloat, width: CGFloat) {
        let selectable = !row.selectButton.isHidden
        let selX: CGFloat = selectable ? -10 : 0
        let openX: CGFloat = selectable ? 38 : 0
        let openW = width - openX
        row.selectButton.frame = CGRect(x: selX, y: (h - metrics.hit) / 2, width: metrics.hit, height: metrics.hit)
        row.dot.frame = CGRect(x: selX + 10, y: (h - 24) / 2, width: 24, height: 24)
        row.openButton.frame = CGRect(x: openX, y: 0, width: openW, height: h)

        // The button's content: the char + the pinyin, the word below, the status on the right, the chevron at the end.
        let contentTop = metrics.space(2)
        let statusW = statusWidth(row, openW: openW)
        let mainW = openW - metrics.space(3) - 8 - statusW
        row.charGlyph.frame = CGRect(x: 0, y: contentTop, width: metrics.value("fs28"), height: metrics.value("fs28"))
        row.pinyinLabel.frame = CGRect(x: metrics.value("fs28") + 10, y: contentTop + (metrics.value("fs28") - metrics.line("lh15")) / 2,
                                      width: max(0, mainW - metrics.value("fs28") - 10), height: metrics.line("lh15"))
        if !row.wordLabel.isHidden {
            row.wordLabel.frame = CGRect(x: 0, y: contentTop + metrics.value("fs28") + 2,
                                         width: max(0, mainW), height: metrics.line("lh17s"))
        }
        row.statusLabel.frame = CGRect(x: openW - metrics.space(3) - 8 - statusW,
                                       y: contentTop + (h - 2 * metrics.space(2) - metrics.line("lh13")) / 2,
                                       width: statusW, height: metrics.line("lh13"))
        row.chevron.frame = CGRect(x: openW - 8, y: (h - 13) / 2, width: 8, height: 13)
        // The char's outline is the button's icon (the web draws it as an svg inside the button).
        row.openButton.glyphRect = CGRect(x: 0, y: contentTop, width: metrics.value("fs28"), height: metrics.value("fs28"))
        // The row's hairline (the web's .sz-qrow's border-bottom).
        row.hair.frame = CGRect(x: 0, y: row.frame.height - hairline, width: width, height: hairline)
        // The QA text frame: the union of the texts of the row (the web's button text frame).
        let union = unionTextFrame(row)
        applyRowTextFrame(row, union: union)
    }

    /// The QA text frame of a row's button: the web measures the union of all the text nodes inside the button
    /// (the char's hidden sr text + the pinyin + the word + the status). The native side draws those texts as separate
    /// views, so the button's (invisible) title carries the same box: the button stretches the title to the union
    /// (see QueryRowButton.fitTitle). The title's string itself is unchanged (the QA text compare strips spaces).
    private func applyRowTextFrame(_ row: QueryCharRow, union: CGRect) {
        row.openButton.fitTitle(union: union, font: metrics.font(15))
    }

    private func statusWidth(_ row: QueryCharRow, openW: CGFloat) -> CGFloat {
        min(NativeType.width(row.statusLabel), max(0, openW * 0.4))
    }

    /// The union of the row's texts (the button's own coordinate space): the char's hidden text (the web's
    /// .sz-pg__sr), the char's outline, the pinyin, the word, the status.
    /// The web measures the button's text frame as the union of all the text nodes inside the button (the DOM range
    /// rects); the hidden char text is one of them, and it is what puts the union's left edge 1pt before the glyph
    /// and its top edge 3pt above it.
    private func unionTextFrame(_ row: QueryCharRow) -> CGRect {
        var u = CGRect.null
        u = u.union(srCharBox(row))
        let glyph = row.openButton.glyphRect
        if glyph.width > 0 { u = u.union(glyph) }
        for l in [row.pinyinLabel, row.wordLabel, row.statusLabel] where !l.isHidden && !(l.text ?? "").isEmpty {
            let tr = l.textRect(forBounds: l.bounds, limitedToNumberOfLines: l.numberOfLines)
            let tx = l.textAlignment == .right ? l.bounds.width - tr.width
                : l.textAlignment == .center ? (l.bounds.width - tr.width) / 2 : tr.minX
            u = u.union(CGRect(x: l.frame.minX + tx, y: l.frame.minY + (l.bounds.height - tr.height) / 2,
                               width: tr.width, height: tr.height))
        }
        return u.isNull ? .zero : u
    }

    /// The web's visually hidden char text (PracticeGlyph's .sz-pg__sr): 11pt of body text at the glyph's -1/-1.
    /// Its box (the font's content area) is what the web's union starts from. The web's size does not scale with the
    /// text size (the CSS is a fixed 11px), so the native side uses a fixed 11pt too. The web's box is the glyph's -1/-1
    /// (the .sz-pg__sr's -1px margin) and the 11px text's content area reaches 2pt above that box, so the union's top
    /// edge is the glyph's -3.
    private func srCharBox(_ row: QueryCharRow) -> CGRect {
        let font = NativeType.compose(size: 11, weight: .regular)
        let contentH = font.ascender - font.descender
        let g = row.charGlyph.frame
        return CGRect(x: g.minX - 1, y: g.minY - 3, width: 11, height: contentH)
    }

    /// The char card (the web's .sz-qcard): the two cells, the char / pinyin / word / record lines.
    private func layoutCard(width: CGFloat) -> CGFloat {
        let pad = metrics.space(4)
        let inner = width - 2 * pad
        let columnW = (inner - pad) / 2
        let side = min(124, columnW)
        let leftX = pad + (columnW - side) / 2
        let rightX = pad + columnW + pad + (columnW - side) / 2
        // The captions (the web's .sz-qcard__label): a span in a centered flex column - the text is centered while it
        // fits the column; when it is wider, the span fills the column and the text wraps (left-aligned).
        let captionY = pad + side + 6
        let mineCaptionH = layoutCaption(mineCaption, mineCaptionText, colX: pad, colW: columnW, y: captionY)
        let refCaptionH = layoutCaption(refCaption, refCaptionText, colX: pad + columnW + pad, colW: columnW, y: captionY)
        let captionH = max(mineCaptionH, refCaptionH)
        let pairH = side + 6 + captionH
        let infoGap: CGFloat = 4
        let headH = metrics.value("fs28")
        let wordH = wordLabel.isHidden ? 0 : metrics.line("lh22")
        // The record line wraps (the web's p in the info column).
        let statH = NativeType.height(statLabel, width: inner, line: metrics.line("lh15"))
        var infoH = headH + infoGap + statH
        if wordH > 0 { infoH += infoGap + wordH }
        let h = pad + pairH + pad + infoH + pad

        mineCell.frame = CGRect(x: leftX, y: pad, width: side, height: side)
        refCell.frame = CGRect(x: rightX, y: pad, width: side, height: side)
        mineInk.frame = mineCell.bounds
        // The ink view follows the cell's side (the web's InkMini paints into the card).
        if let strokes = cardInk, !strokes.isEmpty {
            // The web's InkMini: the canvas inside the frame (side - 2 x frame-w), the hand colour, the small-card width floor.
            let frameW = metrics.value("frame-w")
            let inner = max(1, side - 2 * frameW)
            if inkSide != side {
                mineInk.subviews.forEach { $0.removeFromSuperview() }
                if let ink = NativeInkPaint.view(strokes: detailRawStrokes(strokes), side: inner, color: detailInkColor(traitCollection),
                                                 widthScale: detailInkScale(inner)) {
                    mineInk.addSubview(ink)
                }
                inkSide = side
            }
            mineInk.subviews.forEach { $0.frame = CGRect(x: frameW, y: frameW, width: inner, height: inner) }
        }
        mineDash.frame = mineCell.bounds
        mineDash.path = UIBezierPath(roundedRect: mineCell.bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: max(0, metrics.value("r-work") - 0.5)).cgPath
        mineEmpty.frame = mineCell.bounds.insetBy(dx: 8, dy: 8)
        refGlyph.frame = refCell.bounds

        var y = pad + pairH + pad
        cardChar.frame = CGRect(x: pad, y: y, width: metrics.value("fs28"), height: headH)
        let metaH = metrics.line("lh15")
        metaLabel.frame = CGRect(x: pad + metrics.value("fs28") + 10, y: y + (headH - metaH) / 2,
                                 width: max(0, inner - metrics.value("fs28") - 10), height: metaH)
        y += headH
        if wordH > 0 {
            y += infoGap
            wordLabel.frame = CGRect(x: pad, y: y, width: inner, height: wordH)
            y += wordH
        }
        y += infoGap
        statLabel.frame = CGRect(x: pad, y: y, width: inner, height: statH)
        return h
    }

    /// The caption's layout (the web's .sz-qcard__label). Returns its height.
    private func layoutCaption(_ label: UILabel, _ text: String, colX: CGFloat, colW: CGFloat, y: CGFloat) -> CGFloat {
        let lh = metrics.line("lh13")
        let natural = NativeType.width(label)
        if natural <= colW {
            applyCaption(label, text, wrap: false)
            label.frame = CGRect(x: colX + (colW - natural) / 2, y: y, width: max(1, natural), height: lh)
            return lh
        }
        applyCaption(label, text, wrap: true)
        let h = NativeType.height(label, width: colW, line: lh)
        label.frame = CGRect(x: colX, y: y, width: colW, height: h)
        return h
    }

    /// The "cannot practice" box (the web's .sz-qbad__box).
    private func layoutBad(width: CGFloat) -> CGFloat {
        let padX = metrics.space(4)
        let padY = metrics.space(3)
        let inner = width - 2 * padX
        let titleH = NativeType.height(badTitle, width: inner, line: metrics.line("lh15"))
        let reasonH = NativeType.height(badReason, width: inner, line: metrics.line("lh13"))
        let sourceH = NativeType.height(badSource, width: inner, line: metrics.line("lh13"))
        let h = padY + titleH + 4 + reasonH + 4 + sourceH + padY
        badTitle.frame = CGRect(x: padX, y: padY, width: inner, height: titleH)
        badReason.frame = CGRect(x: padX, y: padY + titleH + 4, width: inner, height: reasonH)
        badSource.frame = CGRect(x: padX, y: padY + titleH + 4 + reasonH + 4, width: inner, height: sourceH)
        return h
    }

    /// The foot: the primary button or the three-part failure (the web's .sz-query__foot).
    /// The foot is as wide as the sheet (the web's .sz-query__foot has a negative margin on both sides), and its
    /// content is back at the gutter.
    private func layoutFoot(width: CGFloat, height: CGFloat, padBottom: CGFloat) {
        let top = metrics.space(3)
        let x = metrics.gutter
        if !failBlock.isHidden {
            let noteH = NativeType.height(failNote, width: width, line: metrics.line("lh15"))
            let btnsY = noteH + 4 + metrics.space(2)
            let half = floor((width - metrics.space(3)) / 2)
            let cancelW = NativeType.titleWidth(failCancel) + 8
            let btnH = failButtonHeight(half: half)
            failBlock.frame = CGRect(x: x, y: top, width: width, height: btnsY + btnH)
            failNote.frame = CGRect(x: 0, y: 0, width: width, height: noteH)
            failCancel.frame = CGRect(x: (half - cancelW) / 2, y: btnsY, width: cancelW, height: textButtonHeight)
            failRetry.frame = CGRect(x: half + metrics.space(3), y: btnsY, width: half, height: btnH)
            return
        }
        goButton.frame = CGRect(x: x, y: top, width: width, height: primaryButtonHeight(goButton, width: width))
    }

    /// The failure block's height (the web's FailBlock, layout dialog): the note + the gap + the buttons.
    private func failBlockHeight(width: CGFloat) -> CGFloat {
        let noteH = NativeType.height(failNote, width: width, line: metrics.line("lh15"))
        let half = floor((width - metrics.space(3)) / 2)
        return noteH + 4 + metrics.space(2) + failButtonHeight(half: half)
    }

    /// The failure block's buttons' height (the web's FailBlock, layout dialog): the text button and the primary button.
    private func failButtonHeight(half: CGFloat) -> CGFloat {
        max(textButtonHeight, primaryButtonHeight(failRetry, width: half))
    }

    /// The text button's height (the web's .sz-btn--text): the min hit height; in the AX tiers the web's rule is
    /// min-height: max(44px, 1.3em + 12px) (components/ax.js).
    private var textButtonHeight: CGFloat {
        axLayout ? max(metrics.hit, 1.3 * metrics.value("fs15") + 12) : metrics.hit
    }

    /// The primary button's height (the web's --btn-h; in the AX tiers it grows with the wrapped title).
    private func primaryButtonHeight(_ b: UIButton, width: CGFloat) -> CGFloat {
        max(buttonHeight, axButtonHeight(b, width: width, inset: 48))
    }

    /// The primary button's height (the web's --btn-h).
    private var buttonHeight: CGFloat { max(metrics.value("btn-h"), 44) }

    /// The AX rule for the primary / secondary buttons (the web's components/ax.js): the height grows with the
    /// wrapped title (the padding 6 above and below); 0 outside the AX tiers.
    private func axButtonHeight(_ b: UIButton, width: CGFloat, inset: CGFloat) -> CGFloat {
        guard axLayout else { return 0 }
        let contentW = max(1, width - inset) // the web's horizontal padding
        let tw = NativeType.titleWidth(b)
        // The title's own line breaks (the web gave the points): the lines are fixed then.
        let breaks = (b.title(for: .normal) ?? "").split(separator: "\n", omittingEmptySubsequences: false).count - 1
        let lines: CGFloat = breaks > 0 ? CGFloat(breaks + 1) : max(1, ceil((tw - 0.5) / contentW))
        return lines * metrics.line("lh17s") + 12
    }

    /// The sheet's shadow (the web's --elev-shadow).
    private func applySheetShadow() {
        let dark = traitCollection.userInterfaceStyle == .dark
        sheet.layer.shadowColor = (dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 1)
                                        : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1)).cgColor
        sheet.layer.shadowOpacity = dark ? 0.06 : 0.10
        sheet.layer.shadowRadius = dark ? 0 : 15
        sheet.layer.shadowOffset = CGSize(width: 0, height: dark ? -0.5 : -10)
    }

    // MARK: The buttons' styles (the web's Button.js)

    private func stylePrimary(_ b: UIButton, id: String) {
        b.titleLabel?.font = metrics.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.backgroundColor = color("btn-bg")
        b.setTitleColor(color("btn-fg"), for: .normal)
        b.setTitleColor(color("ink4"), for: .disabled)
        b.layer.cornerRadius = metrics.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityIdentifier = id
    }

    private func styleSecondary(_ b: UIButton, id: String) {
        b.titleLabel?.font = metrics.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.backgroundColor = .clear
        b.setTitleColor(color("ink1"), for: .normal)
        b.setTitleColor(color("ink4"), for: .disabled)
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4").cgColor
        b.layer.cornerRadius = metrics.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
        b.accessibilityIdentifier = id
    }

    // MARK: The input field

    private func styleInput() {
        inputField.borderStyle = .none
        inputField.backgroundColor = color("field")
        inputField.layer.cornerRadius = metrics.value("r-ctl")
        inputField.layer.cornerCurve = .continuous
        inputField.layer.borderWidth = 1
        inputField.layer.borderColor = UIColor.clear.cgColor
        inputField.font = ShiziFonts.kai(size: metrics.value("fs22"))
        inputField.textColor = color("ink1")
        inputField.tintColor = color("ink1")
        inputField.keyboardType = .default
        // Keyboard convention matches the web: the page there raises the system keyboard and its whole keyboard area
        // (keyboard + the bar above it) is 403pt, so the visible area is 874 - 403 = 471pt. The native side raises the
        // same system keyboard (336pt here) and keeps the same gap above it (see keyboardTopGap), so the sheet's bottom
        // edge lands where the reference has it.
        inputField.returnKeyType = .done
        // The web's field keeps autocorrect / spellcheck off (input.js: autocorrect="off" spellcheck="false"),
        // but the native side must not switch the system's keyboard away from the Chinese one: the keyboard's
        // height (the pinyin candidate row) decides where the sheet's bottom edge sits (the web's 336pt).
        inputField.autocapitalizationType = .none
        inputField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 1))
        inputField.leftViewMode = .always
        inputField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 1))
        inputField.rightViewMode = .always
        inputField.addTarget(self, action: #selector(editingChanged), for: .editingChanged)
        inputField.addTarget(self, action: #selector(editingBegan), for: .editingDidBegin)
        inputField.addTarget(self, action: #selector(editingEnded), for: .editingDidEnd)
        inputField.addTarget(self, action: #selector(editingEnded), for: .editingDidEndOnExit)
    }

    @objc private func editingBegan() {
        inputField.layer.borderColor = color("ink1").cgColor
    }

    @objc private func editingEnded() {
        inputField.layer.borderColor = UIColor.clear.cgColor
    }

    /// The IME gate (the web's createTextGate): while the pinyin is being composed the field is not the query yet.
    @objc private func editingChanged() {
        let text = inputField.text ?? ""
        fieldText = text
        guard inputField.markedTextRange == nil else { return } // composing: wait for the composition to end
        guard text != committedText else { return }
        committedText = text
        reload()
    }

    // MARK: The actions

    @objc private func tapScrim() {
        closeSheet()
    }

    /// The "done" button: close the sheet.
    private func closeSheet() {
        guard !busy else { return }
        let spec = QueryOverlay.spec
        if NativeWriteTransitions.reduceMotion {
            finishSheet()
            return
        }
        // The sheet slides down, the scrim fades out (the web's T-sheet).
        UIView.animate(withDuration: spec.sheetOut, delay: 0, options: [.curveEaseIn]) {
            self.sheet.transform = CGAffineTransform(translationX: 0, y: self.sheet.bounds.height)
        }
        UIView.animate(withDuration: spec.scrimOut, delay: 0, options: [.curveEaseIn]) {
            self.scrim.alpha = 0
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + spec.sheetOut) { self.finishSheet() }
    }

    /// Leave the screen (the base class's requestBack: the native already played the exit, so the page fades).
    private func finishSheet() {
        enteredKind = .fade
        requestBack()
    }

    /// The row was tapped: look at that char's card.
    @objc private func rowOpened(_ sender: UIButton) {
        guard let row = sender.superview as? QueryCharRow, let index = rowViews.firstIndex(where: { $0 === row }) else { return }
        let char = currentRows[safe: index]?.char ?? ""
        guard !char.isEmpty else { return }
        cur = char
        goFailure = nil
        addFailed = false
        reload()
    }

    /// The checkbox was tapped: pick / unpick that char.
    @objc private func rowToggled(_ sender: UIButton) {
        guard let row = sender.superview as? QueryCharRow, let index = rowViews.firstIndex(where: { $0 === row }) else { return }
        let char = currentRows[safe: index]?.char ?? ""
        guard !char.isEmpty else { return }
        if let i = selected.firstIndex(of: char) {
            selected.remove(at: i)
        } else {
            selected.append(char)
        }
        reload()
    }

    /// The "back to the N chars" button.
    private func backToRows() {
        cur = ""
        goFailure = nil
        reload()
    }

    /// The rows of the current model (the row views are reused).
    private var currentRows: [Model.Row] { model?.rows ?? [] }

    /// "Add to the custom list": one commit (the web's query:add).
    private func addToCustom() {
        guard !busy, let c = model?.card else { return }
        guard let engine = stage?.engine else { return }
        busy = true
        engine.raw("query.add", ["char": c.char]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            if (reply["ok"] as? Bool) == true {
                // No prompt on success: the button itself turns into the disabled "already added" (the web's behavior).
                self.addFailed = false
                self.reload()
            } else {
                self.addFailed = true
                self.applyFailureState()
                self.view.setNeedsLayout()
                NativeA11y.announce(self.failNote.text)
            }
        }
    }

    /// "View the records": the web's callback opens that char's page.
    private func showDetail() {
        guard !busy, let c = model?.card else { return }
        guard let engine = stage?.engine else { return }
        busy = true
        engine.raw("query.detail", ["char": c.char]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            if (reply["ok"] as? Bool) != true {
                self.addFailed = true
                self.applyFailureState()
                self.view.setNeedsLayout()
            }
        }
    }

    /// The pick bar / the card's "practice this char": the web's callback (onPick / onPractice).
    private func startPractice(from: String) {
        guard !busy, let m = model else { return }
        var chars: [String] = []
        if from == "card" {
            guard let c = m.card else { return }
            chars = [c.char]
        } else {
            chars = m.chosen
        }
        guard !chars.isEmpty else { return }
        guard let engine = stage?.engine else { return }
        busy = true
        engine.raw("query.pick", ["chars": chars, "from": from]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            guard (reply["ok"] as? Bool) == true else {
                // The failure stays in place: the input and the card are kept (the web's R-H06).
                self.goFailure = GoFailure(chars: chars, from: from)
                self.applyFailureState()
                self.view.setNeedsLayout()
                NativeA11y.announce(self.failNote.text)
                return
            }
            // The web's callback closes the sheet before it opens the write page: the reply carries close.
            if (reply["close"] as? Bool) == true { self.closeSheet() }
        }
    }

    /// The "let it go" button of the three-part failure.
    private func cancelFailure() {
        addFailed = false
        goFailure = nil
        applyFailureState()
        view.setNeedsLayout()
    }

    /// The failure block came or went: the whole model again (the card's buttons give their place to the block and come back).
    private func applyFailureState() {
        if let m = model { applyModel(m) } else { applyFoot(Model.empty) }
    }

    /// The "try again" button of the three-part failure: the same action again.
    private func retryFailure() {
        if let f = goFailure {
            goFailure = nil
            startPractice(from: f.from)
            return
        }
        addFailed = false
        addToCustom()
    }

    // MARK: The keyboard

    @objc private func keyboardChanged(_ note: Notification) {
        guard let info = note.userInfo, let end = info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
        let frame = end.cgRectValue
        let inView = view.convert(frame, from: nil)
        let hidden = note.name == UIResponder.keyboardWillHideNotification
        if hidden || inView.minY >= view.bounds.height - 1 {
            keyboardTop = nil
        } else {
            keyboardTop = max(0, inView.minY)
        }
        view.setNeedsLayout()
    }

    // MARK: The drag to close (the web's Sheet.js createSheetDrag)

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g === edgePan { return true }
        // The base class's left-edge gesture would slide the whole page: the sheet closes instead (the edge swipe below).
        if g is UIScreenEdgePanGestureRecognizer { return false }
        if g === sheetPan {
            let v = sheetPan.velocity(in: sheet)
            return v.y > 0 && v.y > abs(v.x) && scrollArea.contentOffset.y <= 0
        }
        return super.gestureRecognizerShouldBegin(g)
    }

    @objc private func sheetPanned(_ g: UIPanGestureRecognizer) {
        let spec = QueryOverlay.spec
        let dy = max(0, g.translation(in: sheet).y)
        let h = max(1, sheet.bounds.height)
        let follow = !NativeWriteTransitions.reduceMotion
        switch g.state {
        case .changed:
            guard follow else { return }
            sheetDragging = true
            sheet.transform = CGAffineTransform(translationX: 0, y: dy)
            scrim.alpha = max(0, 1 - dy / h)
        case .ended, .cancelled:
            guard sheetDragging else { return }
            sheetDragging = false
            let v = g.velocity(in: sheet).y
            let commit = g.state == .ended && (v > spec.commitVelocity || (dy > h * spec.commitRatio && v > spec.returnVelocity))
            if commit {
                closeSheet()
            } else if follow {
                NativeOverlaySpec.run(spec.snap, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                    self.sheet.transform = .identity
                    self.scrim.alpha = 1
                })
            }
        default:
            break
        }
    }

    /// The left-edge swipe closes the sheet (the web's overlay edge gesture).
    @objc private func edgePanned(_ g: UIScreenEdgePanGestureRecognizer) {
        let spec = QueryOverlay.spec
        let x = max(0, g.translation(in: view).x)
        let v = g.velocity(in: view).x
        let width = max(1, view.bounds.width)
        switch g.state {
        case .changed:
            guard !NativeWriteTransitions.reduceMotion else { return }
            sheet.transform = CGAffineTransform(translationX: x, y: 0)
            scrim.alpha = max(0, 1 - x / width)
        case .ended, .cancelled:
            let commit = g.state == .ended && (v > spec.commitVelocity || (x > width * spec.commitRatio && v > spec.returnVelocity))
            if commit {
                closeSheet()
            } else {
                NativeOverlaySpec.run(spec.snap, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                    self.sheet.transform = .identity
                    self.scrim.alpha = 1
                })
            }
        default:
            break
        }
    }
}

extension QueryScreen.Model {
    /// An empty model (the failure path only needs the foot).
    static var empty: QueryScreen.Model {
        QueryScreen.Model(mode: "lookup", title: QueryCopyRef(key: "", vars: nil), placeholder: QueryCopyRef(key: "", vars: nil),
                           view: "hint", cur: "", multi: false, notes: [], hint: nil, rows: [], card: nil, bad: nil,
                           back: nil, bar: nil, chosen: [])
    }
}

// MARK: - The S02 confirm box (the web's src/ui/screens/session/s02.js)

@objc(ShiziScreen_s02)
final class S02Screen: ShiziScreenViewController {
    struct Model: Decodable {
        let chars: [String]
        let body: QueryCopyRef
        let fail: QueryCopyRef
        let continueOld: QueryCopyRef
        let endStart: QueryCopyRef
        let cancel: QueryCopyRef
        let failCancel: QueryCopyRef
        let retry: QueryCopyRef
        /// The web's line break points of the body (the page measured them).
        let bodyLines: [Int]?

        enum CodingKeys: String, CodingKey {
            case chars, body, fail, cancel, failCancel, retry
            case continueOld = "continue"
            case endStart
            case bodyLines
        }
    }

    private var model: Model?
    private var failed = false
    private var busy = false
    /// The body's text (the web's p): the pretty version (the web's text-wrap: pretty) is made at layout time,
    /// when the width is known.
    private var bodySource = ""
    /// The web's line break points of the body (the page measured them; the native breaks there).
    private var bodyLines: [Int] = []

    let scrim = UIView()
    let dialog = UIView()
    let bodyLabel = UILabel()
    let continueButton = UIButton(type: .custom)
    let endStartButton = UIButton(type: .custom)
    let cancelButton = NativeTextButton(type: .custom)
    let failBlock = UIView()
    let failCancelButton = NativeTextButton(type: .custom)
    let retryButton = UIButton(type: .custom)

    required init(screen: String, entryId: String, params: [String: Any]) {
        super.init(screen: screen, entryId: entryId, params: params)
        // The confirm box is not a page: the outer transition is a 150ms fade (the box plays its own T-confirm).
        transitions.fadeNext = true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overlay.pageDidLoad(self)
        scrim.backgroundColor = color("scrim")
        scrim.accessibilityIdentifier = "native-s02-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        view.addSubview(scrim)

        dialog.backgroundColor = color("elev")
        dialog.layer.cornerRadius = metrics.value("r-box")
        dialog.layer.cornerCurve = .continuous
        dialog.accessibilityIdentifier = "native-s02-dialog"
        view.addSubview(dialog)
        overlay.views = [scrim, dialog]

        bodyLabel.numberOfLines = 0
        bodyLabel.accessibilityIdentifier = "native-s02-body"
        dialog.addSubview(bodyLabel)

        stylePrimary(continueButton, id: "native-s02-continue")
        styleSecondary(endStartButton, id: "native-s02-end-start")
        styleText(cancelButton, id: "native-s02-cancel")
        for b in [continueButton, endStartButton, cancelButton] as [UIView] { dialog.addSubview(b) }
        wire(continueButton) { ($0 as? S02Screen)?.decide("continue") }
        wire(endStartButton) { ($0 as? S02Screen)?.decide("endStart") }
        wire(cancelButton) { ($0 as? S02Screen)?.decide("cancel") }

        failBlock.accessibilityIdentifier = "native-s02-fail"
        dialog.addSubview(failBlock)
        styleText(failCancelButton, id: "native-s02-fail-cancel")
        stylePrimary(retryButton, id: "native-s02-retry")
        failBlock.addSubview(failCancelButton)
        failBlock.addSubview(retryButton)
        wire(failCancelButton) { ($0 as? S02Screen)?.decide("cancel") }
        wire(retryButton) { ($0 as? S02Screen)?.decide("endStart") }
        // The base class renders the model inside super.viewDidLoad(), before the buttons above got their colours and fonts:
        // apply it again so the tracked (attributed) titles carry the styled colours.
        if let m = model { applyModel(m) }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !entered else { return }
        entered = true
        overlay.adopt { [weak self] in self?.enter() }
    }

    private var entered = false

    // MARK: The overlay layer (QueryOverlayHost)

    let overlay = QueryOverlayHost(readyId: "native-s02-ready")

    override func loadView() {
        view = QueryOverlayHost.clearView()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        view.backgroundColor = .clear // the base class paints the page colour again on a theme change
    }

    /// The page itself is dismissed (back, or released by the stage): the layer goes first, quietly, then the page.
    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        let handled = overlay.dismissLayerFirst { [weak self] in self?.dismissPage(animated: flag, completion: completion) }
        if !handled { super.dismiss(animated: flag, completion: completion) }
    }

    private func dismissPage(animated flag: Bool, completion: (() -> Void)?) {
        super.dismiss(animated: flag, completion: completion)
    }

    /// T-confirm (once the layer is up): the scrim fades in, the box scales up from 0.96 (the web's Confirm.js).
    private func enter() {
        let spec = QueryOverlay.spec
        if NativeWriteTransitions.reduceMotion {
            scrim.alpha = 1
            dialog.alpha = 1
        } else {
            scrim.alpha = 0
            dialog.alpha = 0
            dialog.transform = CGAffineTransform(scaleX: spec.confirmFrom, y: spec.confirmFrom)
            NativeOverlaySpec.run(spec.scrimIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), { self.scrim.alpha = 1 })
            NativeOverlaySpec.run(spec.confirmIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                self.dialog.alpha = 1
                self.dialog.transform = .identity
            })
        }
        NativeA11y.screenChanged(bodyLabel)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat { top }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutDialog()
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: Model.self)
        model = m
        applyModel(m)
    }

    private func applyModel(_ m: Model) {
        let text = failed ? m.fail.rendered : m.body.rendered
        bodySource = text
        // The web's line break points (the page measured them): the native breaks the body at the same places.
        bodyLines = failed ? [] : (m.bodyLines ?? [])
        bodyLabel.accessibilityLabel = text

        continueButton.isHidden = failed
        endStartButton.isHidden = failed
        cancelButton.isHidden = failed
        failBlock.isHidden = !failed

        let cont = m.continueOld.rendered
        continueButton.setTitle(cont, for: .normal)
        continueButton.accessibilityLabel = cont
        let end = m.endStart.rendered
        endStartButton.setTitle(end, for: .normal)
        endStartButton.accessibilityLabel = end
        let cancel = m.cancel.rendered
        cancelButton.setTitle(cancel, for: .normal)
        cancelButton.accessibilityLabel = cancel
        let failCancel = m.failCancel.rendered
        failCancelButton.setTitle(failCancel, for: .normal)
        failCancelButton.accessibilityLabel = failCancel
        let retry = m.retry.rendered
        retryButton.setTitle(retry, for: .normal)
        retryButton.accessibilityLabel = retry
        // The Chinese letter spacing of the titles (the web's font tracking; NativeType.cjkTrack).
        // The font is given (an attributed title keeps the font it was made with: reading it back would keep an old size).
        for b in [continueButton, endStartButton, retryButton] as [UIButton] {
            b.titleLabel?.font = metrics.font(17, .medium)
            trackTitle(b, font: metrics.font(17, .medium))
        }
        for b in [cancelButton, failCancelButton] as [UIButton] {
            b.titleLabel?.font = metrics.font(15)
            trackTitle(b, font: metrics.font(15))
        }
        markStateChange()
        view.setNeedsLayout()
    }

    /// The centered confirm box (the web's .sz-confirm): the page margins 20, vertically centered, the radius 24,
    /// the padding 24 / 20 / 20, the body 15 / 22 ink2; three buttons in a column (the primary, the secondary, the text button).
    private func layoutDialog() {
        let W = view.bounds.width
        let H = view.bounds.height
        guard W > 0 else { return }
        let gutter = metrics.gutter
        let padX = metrics.space(5)
        let padTop = metrics.space(6)
        let padBottom = metrics.space(5)
        let w = W - 2 * gutter
        let inner = w - 2 * padX
        scrim.frame = view.bounds

        // The body: the web's p has text-wrap: pretty (the two-line paragraph breaks at the punctuation).
        // The page measured the web's line break points: the native breaks there (the Chinese line breaking of the
        // web and the native differ). Without them the native falls back to its own pretty approximation.
        let bodyFont = metrics.font(15)
        let bodyText = bodyLines.isEmpty
            ? NativeType.pretty(bodySource, font: bodyFont, width: inner)
            : brokenAt(bodySource, bodyLines)
        NativeType.set(bodyLabel, bodyText, font: bodyFont, color: color("ink2"), align: .left, line: metrics.line("lh15"))
        let bodyH = NativeType.height(bodyLabel, width: inner, line: metrics.line("lh15"))
        let gap = metrics.space(3)
        let btnH = max(metrics.value("btn-h"), 44)
        // The text button's height: the web's AX rule (components/ax.js) is min-height: max(44px, 1.3em + 12px).
        let textH = axLayout ? max(metrics.hit, 1.3 * metrics.value("fs15") + 12) : metrics.hit
        // The ask state: the body, then the three buttons (the primary, the secondary, the text button).
        // The failed state: the body, then the three-part block (one row of two buttons).
        var h = padTop + bodyH + (failed ? gap : 16)
        h += failed ? btnH : (2 * btnH + 2 * gap + textH)
        h += padBottom
        dialog.frame = CGRect(x: gutter, y: (H - h) / 2, width: w, height: h)
        applyDialogShadow()
        bodyLabel.frame = CGRect(x: padX, y: padTop, width: inner, height: bodyH)

        var y = padTop + bodyH + (failed ? gap : 16)
        if failed {
            failBlock.frame = CGRect(x: padX, y: y, width: inner, height: btnH)
            let half = (inner - gap) / 2
            let cancelW = NativeType.titleWidth(failCancelButton) + 8
            failCancelButton.frame = CGRect(x: (half - cancelW) / 2, y: 0, width: cancelW, height: metrics.hit)
            retryButton.frame = CGRect(x: half + gap, y: 0, width: half, height: btnH)
            return
        }
        continueButton.frame = CGRect(x: padX, y: y, width: inner, height: btnH)
        y += btnH + gap
        endStartButton.frame = CGRect(x: padX, y: y, width: inner, height: btnH)
        y += btnH + gap
        cancelButton.frame = CGRect(x: padX - 4, y: y, width: inner + 8, height: textH)
    }

    private func applyDialogShadow() {
        let dark = traitCollection.userInterfaceStyle == .dark
        dialog.layer.shadowColor = (dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 1)
                                        : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1)).cgColor
        dialog.layer.shadowOpacity = dark ? 0.06 : 0.10
        dialog.layer.shadowRadius = dark ? 0 : 15
        dialog.layer.shadowOffset = CGSize(width: 0, height: dark ? -0.5 : -10)
    }

    @objc private func tapScrim() {
        decide("cancel")
    }

    /// One of the three buttons (the web's onContinue / onEndStart / cancel): the op runs the web's callback.
    private func decide(_ action: String) {
        guard !busy, let engine = stage?.engine else { return }
        busy = true
        engine.raw("s02.decide", ["action": action]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            guard (reply["ok"] as? Bool) == true else {
                // The failure stays in the box (the web's R-G04): the note + [let it go | try again].
                self.failed = true
                if let m = self.model { self.applyModel(m) }
                self.view.setNeedsLayout()
                NativeA11y.announce(self.bodyLabel.text)
                return
            }
            if (reply["close"] as? Bool) == true { self.closeDialog() }
        }
    }

    /// The box fades out (T-confirm) and then leaves the screen.
    private func closeDialog() {
        let spec = QueryOverlay.spec
        if NativeWriteTransitions.reduceMotion {
            finishDialog()
            return
        }
        UIView.animate(withDuration: spec.confirmOut, delay: 0, options: [.curveEaseIn]) { self.dialog.alpha = 0 }
        UIView.animate(withDuration: max(spec.scrimOut, spec.confirmOut), delay: 0, options: [.curveEaseIn]) { self.scrim.alpha = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + max(spec.scrimOut, spec.confirmOut)) { self.finishDialog() }
    }

    private func finishDialog() {
        enteredKind = .fade
        requestBack()
    }

    // MARK: The buttons' styles (the web's Button.js / Confirm.js)

    private func stylePrimary(_ b: UIButton, id: String) {
        b.titleLabel?.font = metrics.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.backgroundColor = color("btn-bg")
        b.setTitleColor(color("btn-fg"), for: .normal)
        b.layer.cornerRadius = metrics.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityIdentifier = id
    }

    private func styleSecondary(_ b: UIButton, id: String) {
        b.titleLabel?.font = metrics.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.backgroundColor = .clear
        b.setTitleColor(color("ink1"), for: .normal)
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4").cgColor
        b.layer.cornerRadius = metrics.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityIdentifier = id
    }

    private func styleText(_ b: UIButton, id: String) {
        b.titleLabel?.font = metrics.font(15)
        b.titleLabel?.numberOfLines = 1
        b.setTitleColor(color("ink2"), for: .normal)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        b.accessibilityIdentifier = id
    }
}
