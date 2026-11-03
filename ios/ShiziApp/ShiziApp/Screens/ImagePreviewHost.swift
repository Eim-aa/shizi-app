import UIKit

// B3.11：原生图片预览弹层与失败提示条的**宿主**（网页这一侧发起时用）。
//
// 网页页面（年报页 / 月字帖页 / 字库页…还是网页的那几张）点「做图片」时，网页不再开自己的弹层，改发
// {type:'native', op:'open', screen:'image-preview' | 'image-toast'}；NativeStage 按屏名找类（ShiziScreen_<屏名>），
// 于是这两个宿主把真正的原生弹层 / 提示条呈现出来。宿主自己是一张看不见的页（页头 / 正文都收起来），
// 弹层关掉后宿主经 image.closed op 请网页把这一条原生屏收掉（网页栈里没有这一层，不发 nav.back）。

/// 原生图片预览弹层的宿主（网页发起时）。
@objc(ShiziScreen_image_preview)
final class ShiziScreen_image_preview: ShiziScreenViewController {
    private var sheet: NativeImagePreviewController?
    /// 「弹层真的出来了」的标记（QA 夹具 ready 用 id:native-image-preview-screen 等它）。
    /// 1 × 1、alpha 0.01：不进元素清单（取证只收可见的），但夹具能在宿主这一层里找到它。
    private let readyMarker = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        backButton.isHidden = true
        titleLabel.isHidden = true
        scroll.isHidden = true
        screenMarker.isHidden = true
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        presentSheet()
    }

    private func presentSheet() {
        guard sheet == nil, let engine = stage?.engine else { return }
        let scope = (params["scope"] as? [String: Any]) ?? [:]
        let vc = NativeImagePreviewController(engine: engine, scope: scope)
        vc.onClose = { [weak self] in self?.askWebToClose() }
        sheet = vc
        Task { @MainActor [weak self, weak vc] in
            guard let self, let vc else { return }
            let ok = await vc.prepare()
            guard ok else { return }
            self.present(vc, animated: true) { self.markSheetReady() }
        }
    }

    /// 弹层已经呈现出来：给宿主打上就绪标记（夹具的 ready 在宿主的视图里找它）。
    private func markSheetReady() {
        guard readyMarker.superview == nil else { return }
        readyMarker.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        readyMarker.alpha = 0.01
        readyMarker.isUserInteractionEnabled = false
        readyMarker.accessibilityIdentifier = "native-image-preview-screen"
        view.addSubview(readyMarker)
    }

    /// 弹层关了：请网页把这一条原生屏收掉（网页 → 原生的 close 消息）。
    private func askWebToClose() {
        guard let engine = stage?.engine else { return }
        let id = entryId
        Task { @MainActor in
            _ = await engine.raw("image.closed", ["entryId": id])
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        sheet?.dismiss(animated: true)
        return true
    }
}

/// 原生失败提示条的宿主（网页发起时；L4 浮条）。
@objc(ShiziScreen_image_toast)
final class ShiziScreen_image_toast: ShiziScreenViewController {
    private var toast: NativeImageToastView?
    private var dismissWork: DispatchWorkItem?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        backButton.isHidden = true
        titleLabel.isHidden = true
        scroll.isHidden = true
        screenMarker.isHidden = true
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        showToast()
    }

    private func showToast() {
        guard toast == nil else { return }
        let text = (params["text"] as? String) ?? ""
        let v = NativeImageToastView(text: text)
        view.addSubview(v)
        toast = v
        view.setNeedsLayout()
        // 显示时长与退场（网页 Toast.js：timing.toast；退场 T-fade）
        let ms = ((ShiziTokens.motion["timing"] as? [String: Any])?["toast"] as? NSNumber)?.doubleValue ?? 3200
        v.runTimer(ms / 1000)
        let work = DispatchWorkItem { [weak self] in self?.dismissToast() }
        dismissWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: work)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let toast else { return }
        let m = ShiziMetrics()
        let w = view.bounds.width
        let safe = view.safeAreaInsets.bottom
        // 网页 .sz-toast：min-height 48、padding s3 s4、上下各 1px 边
        let h = max(48, m.line("lh15") + m.space(3) * 2 + 2)
        toast.frame = CGRect(x: m.gutter, y: view.bounds.height - safe - 110 - h, width: w - 2 * m.gutter, height: h)
    }

    private func dismissToast() {
        guard let toast else { return }
        self.toast = nil
        UIView.animate(withDuration: 0.15, animations: { toast.alpha = 0 }) { [weak self] _ in
            toast.removeFromSuperview()
            self?.askWebToClose()
        }
    }

    private func askWebToClose() {
        guard let engine = stage?.engine else { return }
        let id = entryId
        Task { @MainActor in
            _ = await engine.raw("image.closed", ["entryId": id])
        }
    }
}
