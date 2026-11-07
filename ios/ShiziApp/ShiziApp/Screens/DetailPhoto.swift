import UIKit

// B3.7：旧版本的记录（照网页版 1:1 移植；视图模型 photoView，App API view.detail-photo）。
// 只读：不写任何东西。全页强制深色（网页 .t-dark：令牌在页内取深色一套，D43）：本页的 overrideUserInterfaceStyle 固定 .dark，颜色照常取 ShiziTokens.dynamicColor。
// 版式：页头「‹」+ 标题「「X」的旧记录」；3:4 照片（contain，笺底 field）；底部小标题「旧记录」+ 两行说明。照片没了（恢复了别的备份）时框里只留「旧版本拍下的照片」。

@objc(ShiziScreen_detail_photo)
final class DetailPhotoScreen: ShiziScreenViewController {
    struct View: Decodable {
        let title: ShiziCopyRef
        let alt: ShiziCopyRef
        let caption: ShiziCopyRef
        let body: ShiziCopyRef
        let photo: String?
    }

    private let frameView = UIView()
    private let imageView = UIImageView()
    private let missing = UILabel()
    private let caption = UILabel()
    private let body = UILabel()
    private var model: View?
    private var photoImage: UIImage?
    private var photoSource: String?

    required init(screen: String, entryId: String, params: [String: Any]) {
        super.init(screen: screen, entryId: entryId, params: params)
        overrideUserInterfaceStyle = .dark
    }

    override var watchedDomains: [String]? { ["photos"] }

    override func viewDidLoad() {
        frameView.clipsToBounds = true
        imageView.contentMode = .scaleAspectFit
        imageView.accessibilityIdentifier = "native-detail-photo-image"
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = [.image]
        missing.accessibilityIdentifier = "native-detail-photo-missing"
        missing.numberOfLines = 0
        caption.accessibilityIdentifier = "native-detail-photo-caption"
        body.accessibilityIdentifier = "native-detail-photo-body"
        body.numberOfLines = 0
        frameView.addSubview(imageView)
        frameView.addSubview(missing)
        for v in [frameView, caption, body] as [UIView] { content.addSubview(v) }
        super.viewDidLoad()
        view.overrideUserInterfaceStyle = .dark
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        let mt = metrics
        setTitle(m.title.text)
        screenMarker.backgroundColor = color("paper") // 网页 .sz-dphoto 整页的底（强制深色）
        frameView.backgroundColor = color("field")
        frameView.layer.cornerRadius = mt.value("r-work")
        if m.photo != photoSource {
            photoSource = m.photo
            photoImage = m.photo.flatMap(Self.decode)
        }
        imageView.image = photoImage
        imageView.isHidden = photoImage == nil
        imageView.accessibilityLabel = m.alt.text
        missing.isHidden = photoImage != nil
        NativeType.set(missing, m.alt.text, font: mt.font(15), color: color("ink3"), align: .center, line: mt.line("lh15"))
        NativeType.set(caption, m.caption.text, font: mt.font(13), color: color("ink3"), line: mt.line("lh15"))
        NativeType.set(body, m.body.lines.joined(separator: "\n"), font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
    }

    /// data URL（data:image/…;base64,…）→ 图。
    static func decode(_ url: String) -> UIImage? {
        guard let comma = url.firstIndex(of: ","), let data = Data(base64Encoded: String(url[url.index(after: comma)...]), options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard model != nil else { return top }
        let mt = metrics
        var y = top
        let ch = NativeType.height(caption, width: width, line: mt.line("lh15"))
        let bh = NativeType.height(body, width: width, line: mt.line("lh15"))
        let foot = ch + 6 + bh
        // 3:4 的框是 flex 项（可收缩）：正文区放不下（AX 档字大）时框的高度收到刚好放下底部说明（网页 .sz-dphoto__frame 的 aspect-ratio 与 flex-shrink）
        let natural = width * 4 / 3
        let avail = scroll.bounds.height - top - mt.space(8)
        let h = max(0, min(natural, avail - mt.groupGap - foot))
        frameView.frame = CGRect(x: x, y: y, width: width, height: h)
        imageView.frame = frameView.bounds
        let mh = NativeType.height(missing, width: width, line: mt.line("lh15"))
        missing.frame = CGRect(x: 0, y: (h - mh) / 2, width: width, height: mh)
        y += h + mt.groupGap
        caption.frame = CGRect(x: x, y: y, width: width, height: ch)
        y += ch + 6
        body.frame = CGRect(x: x, y: y, width: width, height: bh)
        return y + bh
    }
}
