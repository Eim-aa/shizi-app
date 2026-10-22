import UIKit

// ShiziKit（B3.1）：页头的几何（网页 Page.js .sz-page__head；B2 R9-A 写字页 / B2.7 结果页量出的数值，原来各页各写一份）。
// 页头名义高 44；左槽 [页边, 页边 + 44]，图标按钮 44 × 44、图标描边外缘落在页边线上（各图标的偏移不同）；中间在两槽之间、各让 8；
// 只给读屏的页标题（网页 .sz-page__title--hidden）是页边左 1、页头中线附近的 1 × 1。
enum ShiziPageHeader {
    /// 名义页头高（pt）。
    static let height: CGFloat = 44
    /// 槽宽 / 图标按钮边长（最小点击区）。
    static let slot: CGFloat = 44
    /// 中间（进度 / 标题）离两槽的距离。
    static let centerGap: CGFloat = 8

    /// 页头图标：按钮框相对页边线的偏移 = 图标描边外缘到按钮框边的距离（网页 icons.js 路径在 44 框里的位置）。
    enum Icon {
        case back, close, share

        var edgeInset: CGFloat {
            switch self {
            case .back: return 17.75
            case .close: return 16.25
            case .share: return 15.25
            }
        }
    }

    /// 左槽图标按钮的框（y = 页头里按钮的顶）。
    static func leadFrame(_ icon: Icon, gutter: CGFloat, y: CGFloat) -> CGRect {
        CGRect(x: gutter - icon.edgeInset, y: y, width: slot, height: slot)
    }

    /// 右槽图标按钮的框（width = 页面宽）。
    static func trailFrame(_ icon: Icon, width: CGFloat, gutter: CGFloat, y: CGFloat) -> CGRect {
        CGRect(x: width - gutter + icon.edgeInset - slot, y: y, width: slot, height: slot)
    }

    /// 中间区的左沿（左槽右沿 + 8）。
    static func centerLeft(gutter: CGFloat) -> CGFloat { gutter + slot + centerGap }

    /// 只给读屏的页标题（1 × 1，读屏名称与 screenChanged 落点照旧）。
    static func screenReaderTitleFrame(gutter: CGFloat, top: CGFloat) -> CGRect {
        CGRect(x: gutter - 1, y: top + 21.5, width: 1, height: 1)
    }
}
