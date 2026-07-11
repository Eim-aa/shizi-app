import UIKit
import UniformTypeIdentifiers
import WebKit

final class WebViewController: UIViewController {
    private static let nativeSmokeConfirmMessage = "__shizi_native_smoke_confirm__"

    private let schemeHandler: LocalWebSchemeHandler
    private var webView: WKWebView!
    private var nativeSmokeDidRun = false

    init() {
        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            fatalError("Missing bundled Web assets. Build the app through Xcode so the sync-web-assets phase runs.")
        }

        self.schemeHandler = LocalWebSchemeHandler(rootDirectory: webRoot)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: ShiziWebResource.scheme)

        let userContentController = WKUserContentController()
        userContentController.add(self, name: "shiziNative")
        configuration.userContentController = userContentController

        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        let paper = UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0.106, green: 0.094, blue: 0.075, alpha: 1)
                : UIColor(red: 0.937, green: 0.906, blue: 0.827, alpha: 1)
        }
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        self.webView = webView
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadApp()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .default
    }

    private func loadApp() {
        var components = URLComponents()
        components.scheme = ShiziWebResource.scheme
        components.host = ShiziWebResource.host
        components.path = "/index.html"

        if Self.devModeEnabled {
            components.queryItems = [URLQueryItem(name: "dev", value: "1")]
        }

        guard let url = components.url else {
            assertionFailure("Unable to build local app URL")
            return
        }

        webView.load(URLRequest(url: url))
    }

    private static var devModeEnabled: Bool {
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-shizi-dev") || process.environment["SHIZI_DEV"] == "1"
    }

    private static var nativeSmokeEnabled: Bool {
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-shizi-smoke") || process.environment["SHIZI_SMOKE"] == "1"
    }

    private func runNativeSmokeIfNeeded() {
        guard Self.nativeSmokeEnabled, !nativeSmokeDidRun else {
            return
        }
        nativeSmokeDidRun = true

        let script = """
        (async function(){
          const result = {
            href: location.href,
            title: document.title,
            seed: typeof SEED !== 'undefined' ? SEED.length : -1,
            cards: typeof CARDS !== 'undefined' ? CARDS.length : -1,
            groups: typeof GROUPS !== 'undefined' ? Object.keys(GROUPS).length : -1,
            devToolsDisplayInitial: getComputedStyle(document.getElementById('devTools')).display,
            devToolsDisplay: '',
            welcomeDisplay: getComputedStyle(document.getElementById('welcome')).display,
            footDisplay: getComputedStyle(document.getElementById('foot')).display,
            devQuery: new URLSearchParams(location.search).get('dev') === '1',
            localStorageWritable: false,
            localStoragePersistedFromPreviousLaunch: false,
            fetchOk: false,
            fetchStatus: 0,
            strokeCount: 0,
            layoutFlow: {
              viewportFitCover: false,
              keyboardInsetVar: false,
              visualViewportAvailable: false,
              sheetScrollable: false,
              sheetBottomPadding: false,
              addInputFocused: false,
              keyboardInsetPixels: 0,
              keyboardInsetActive: false,
              keyboardInsetMatchesViewport: false,
              inputVisibleAboveKeyboard: false,
              addConfirmReachableAboveKeyboard: false
            },
            handwritingFlow: {
              pointerEventsSupported: false,
              touchActionNone: false,
              pointerDownPrevented: false,
              pointerMovePrevented: false,
              touchMovePrevented: false,
              strokeRecorded: false,
              strokePointCount: 0,
              inkPixelsChanged: false,
              pageScrollStable: false,
              clearWorked: false
            },
            dataFlow: {
              addSheetOpened: false,
              addPreviewRendered: false,
              addConfirmEnabled: false,
              addSheetClosed: false,
              addedCharStored: false,
              customWordStored: false,
              customCardIndexed: false,
              memoryHasAddedChar: false,
              backupParses: false,
              backupHasAppMarker: false,
              backupHasAdded: false,
              backupHasCustom: false,
              backupHasMemory: false,
              backupHasSmokeKey: false,
              backupRestoreApplied: false,
              backupRestoreKeyCount: 0,
              backupRestoreAdded: false,
              backupRestoreCustom: false,
              backupRestoreMemory: false,
              backupRestoreSmokeKey: false,
              backupRestoreRejectsInvalid: false,
              nativeBridgeAvailable: false,
              nativeImportAvailable: false,
              nativeConfirmAvailable: false
            },
            navigationFlow: {
              practiceEntryVisible: false,
              practiceTabActive: false,
              bookVisible: false,
              bookTabActive: false,
              footVisibleOnBook: false,
              meVisible: false,
              meTabActive: false,
              footVisibleOnMe: false,
              profileVisible: false,
              profileFootHidden: false,
              profileReturnedToMe: false,
              auditVisible: false,
              auditReturnedToMe: false
            },
            practiceFlow: {
              started: false,
              batchSize: 0,
              cardVisible: false,
              showEnabled: false,
              doneEnabled: false,
              revealVisible: false,
              stampVisible: false,
              stampedToastVisible: false,
              nextVisible: false,
              nextAdvanced: false,
              outcome: '',
              posLabelBefore: '',
              posLabelAfter: ''
            },
            exitFlow: {
              sheetOpened: false,
              returnedHome: false,
              practiceHidden: false,
              footVisible: false,
              roundStatsUnchanged: false,
              roundStatsBeforeExit: -1,
              roundStatsAfterExit: -1,
              positionBeforeExit: -1
            },
            error: ''
          };
          try {
            const waitFor = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
              const start = Date.now();
              const tick = () => {
                let ok = false;
                try { ok = !!predicate(); } catch (_) {}
                if (ok) { resolve(true); return; }
                if (Date.now() - start > timeoutMs) { reject(new Error('Timed out waiting for smoke condition')); return; }
                setTimeout(tick, 50);
              };
              tick();
            });
            const visible = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
            const activeTab = (id) => document.getElementById(id).classList.contains('active');
            const viewportMeta = document.querySelector('meta[name="viewport"]');
            result.layoutFlow.viewportFitCover = !!viewportMeta && viewportMeta.content.includes('viewport-fit=cover');
            result.layoutFlow.keyboardInsetVar = /^\\d+px$/.test(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim());
            result.layoutFlow.visualViewportAvailable = !!window.visualViewport;
            if (typeof renderMe === 'function') renderMe();
            result.devToolsDisplay = getComputedStyle(document.getElementById('devTools')).display;
            result.localStoragePersistedFromPreviousLaunch = localStorage.getItem('shizi.nativeSmoke.v1') !== null;
            localStorage.setItem('shizi.nativeSmoke.v1', new Date().toISOString());
            result.localStorageWritable = localStorage.getItem('shizi.nativeSmoke.v1') !== null;
            const response = await fetch('data/' + encodeURIComponent('美') + '.json');
            result.fetchOk = response.ok;
            result.fetchStatus = response.status;
            const payload = await response.json();
            result.strokeCount = Array.isArray(payload.strokes) ? payload.strokes.length : 0;

            if (typeof renderBook === 'function' && typeof renderMe === 'function' && typeof renderProfile === 'function' && typeof renderHome === 'function') {
              document.getElementById('tabBook').click();
              await waitFor(() => visible('studybook'));
              result.navigationFlow.bookVisible = visible('studybook');
              result.navigationFlow.bookTabActive = activeTab('tabBook');
              result.navigationFlow.footVisibleOnBook = visible('foot');

              document.getElementById('tabMe').click();
              await waitFor(() => visible('mePanel'));
              result.navigationFlow.meVisible = visible('mePanel');
              result.navigationFlow.meTabActive = activeTab('tabMe');
              result.navigationFlow.footVisibleOnMe = visible('foot');

              document.getElementById('openProfile').click();
              await waitFor(() => visible('profilePanel'));
              result.navigationFlow.profileVisible = visible('profilePanel');
              result.navigationFlow.profileFootHidden = !visible('foot');
              document.getElementById('closeProfile').click();
              await waitFor(() => visible('mePanel'));
              result.navigationFlow.profileReturnedToMe = true;

              if (result.devQuery) {
                document.getElementById('auditLink').click();
                await waitFor(() => visible('auditPanel'));
                result.navigationFlow.auditVisible = visible('auditPanel');
                document.getElementById('closeAudit').click();
                await waitFor(() => visible('mePanel'));
                result.navigationFlow.auditReturnedToMe = true;
              }

              document.getElementById('tabPractice').click();
              await waitFor(() => visible('home') || visible('welcome'));
              result.navigationFlow.practiceEntryVisible = visible('home') || visible('welcome');
              result.navigationFlow.practiceTabActive = activeTab('tabPractice');
            }

            if (typeof openAddSheet === 'function' && typeof confirmAdd === 'function' && typeof backupPayload === 'function') {
              const smokeChar = '龘';
              openAddSheet();
              await waitFor(() => document.getElementById('addSheet').classList.contains('open'));
              await waitFor(() => document.activeElement === document.getElementById('addInput'));
              await new Promise(resolve => setTimeout(resolve, 450));
              if (typeof updateKeyboardInset === 'function') updateKeyboardInset();
              result.dataFlow.addSheetOpened = true;
              result.layoutFlow.sheetScrollable = ['auto', 'scroll'].includes(getComputedStyle(document.getElementById('addSheet')).overflowY);
              result.layoutFlow.sheetBottomPadding = parseFloat(getComputedStyle(document.getElementById('addSheet')).paddingBottom) > 0;
              result.layoutFlow.addInputFocused = document.activeElement === document.getElementById('addInput');
              const visualViewport = window.visualViewport;
              const keyboardInset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) || 0;
              const expectedKeyboardInset = visualViewport ? Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop) : 0;
              const visibleTop = visualViewport ? visualViewport.offsetTop : 0;
              const visibleBottom = visualViewport ? visualViewport.offsetTop + visualViewport.height : window.innerHeight;
              const inputRect = document.getElementById('addInput').getBoundingClientRect();
              result.layoutFlow.keyboardInsetPixels = keyboardInset;
              result.layoutFlow.keyboardInsetActive = keyboardInset > 0;
              result.layoutFlow.keyboardInsetMatchesViewport = Math.abs(keyboardInset - expectedKeyboardInset) <= 2;
              result.layoutFlow.inputVisibleAboveKeyboard = inputRect.top >= visibleTop && inputRect.bottom <= visibleBottom;
              document.getElementById('addInput').value = smokeChar;
              document.getElementById('addInput').dispatchEvent(new Event('input', { bubbles: true }));
              await waitFor(() => !document.getElementById('addConfirm').disabled);
              document.getElementById('addConfirm').scrollIntoView({ block: 'nearest', inline: 'nearest' });
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const confirmRect = document.getElementById('addConfirm').getBoundingClientRect();
              result.layoutFlow.addConfirmReachableAboveKeyboard = confirmRect.top >= visibleTop && confirmRect.bottom <= visibleBottom;
              result.dataFlow.addPreviewRendered = document.getElementById('addPreview').textContent.includes(smokeChar);
              result.dataFlow.addConfirmEnabled = !document.getElementById('addConfirm').disabled;
              confirmAdd();
              await waitFor(() => !document.getElementById('addSheet').classList.contains('open'));
              result.dataFlow.addSheetClosed = true;

              const added = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]');
              const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
              const indexForSmokeChar = indexesForChars([smokeChar])[0];
              const memoryForSmokeChar = Number.isInteger(indexForSmokeChar) ? memory[cardKey(indexForSmokeChar)] : null;
              result.dataFlow.addedCharStored = Array.isArray(added) && added.includes(smokeChar);
              result.dataFlow.customWordStored = BASE_BY_CHAR[smokeChar] != null || (Array.isArray(custom) && custom.includes(smokeChar));
              result.dataFlow.customCardIndexed = Number.isInteger(indexForSmokeChar) && indexForSmokeChar >= 0;
              result.dataFlow.memoryHasAddedChar = !!memoryForSmokeChar && memoryForSmokeChar.target === smokeChar && memoryForSmokeChar.lastOutcome === 'miss' && Number(memoryForSmokeChar.seen || 0) > 0;

              const backup = JSON.parse(backupPayload());
              const backupData = backup && backup.data ? backup.data : {};
              result.dataFlow.backupParses = true;
              result.dataFlow.backupHasAppMarker = backup.app === 'shizi' && backup.version === 1;
              result.dataFlow.backupHasAdded = Object.prototype.hasOwnProperty.call(backupData, ADDED_KEY) && String(backupData[ADDED_KEY]).includes(smokeChar);
              result.dataFlow.backupHasCustom = BASE_BY_CHAR[smokeChar] != null || (Object.prototype.hasOwnProperty.call(backupData, CUSTOM_KEY) && String(backupData[CUSTOM_KEY]).includes(smokeChar));
              result.dataFlow.backupHasMemory = Object.prototype.hasOwnProperty.call(backupData, MEMORY_KEY) && String(backupData[MEMORY_KEY]).includes(smokeChar);
              result.dataFlow.backupHasSmokeKey = Object.prototype.hasOwnProperty.call(backupData, 'shizi.nativeSmoke.v1');
              if (typeof restoreBackupPayload === 'function') {
                localStorage.setItem(ADDED_KEY, JSON.stringify([]));
                localStorage.setItem(CUSTOM_KEY, JSON.stringify([]));
                localStorage.setItem(MEMORY_KEY, JSON.stringify({}));
                localStorage.removeItem('shizi.nativeSmoke.v1');
                const restoreResult = restoreBackupPayload(JSON.stringify(backup), { skipConfirm: true, reload: false });
                const restoredAdded = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]');
                const restoredCustom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
                result.dataFlow.backupRestoreApplied = !!restoreResult && restoreResult.applied === true;
                result.dataFlow.backupRestoreKeyCount = restoreResult && Array.isArray(restoreResult.keys) ? restoreResult.keys.length : 0;
                result.dataFlow.backupRestoreAdded = Array.isArray(restoredAdded) && restoredAdded.includes(smokeChar);
                result.dataFlow.backupRestoreCustom = BASE_BY_CHAR[smokeChar] != null || (Array.isArray(restoredCustom) && restoredCustom.includes(smokeChar));
                result.dataFlow.backupRestoreMemory = String(localStorage.getItem(MEMORY_KEY) || '').includes(smokeChar);
                result.dataFlow.backupRestoreSmokeKey = localStorage.getItem('shizi.nativeSmoke.v1') !== null;
                try {
                  restoreBackupPayload({ app: 'wrong-app', data: { 'shizi.bad': '1' } }, { skipConfirm: true, reload: false });
                } catch (_) {
                  result.dataFlow.backupRestoreRejectsInvalid = true;
                }
              }
              result.dataFlow.nativeBridgeAvailable = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.shiziNative);
              result.dataFlow.nativeImportAvailable = result.dataFlow.nativeBridgeAvailable && typeof requestBackupImport === 'function';
              result.dataFlow.nativeConfirmAvailable = window.confirm('\(Self.nativeSmokeConfirmMessage)') === true;
            }

            if (typeof startMode === 'function' && typeof revealAnswer === 'function' && typeof pickStamp === 'function') {
              startMode('new');
              await waitFor(() => Array.isArray(batch) && batch.length > 0 && visible('card'));
              await waitFor(() => !document.getElementById('show').disabled && !document.getElementById('done').disabled);
              result.practiceFlow.started = true;
              result.practiceFlow.batchSize = Array.isArray(batch) ? batch.length : 0;
              result.practiceFlow.cardVisible = visible('card');
              result.practiceFlow.showEnabled = !document.getElementById('show').disabled;
              result.practiceFlow.doneEnabled = !document.getElementById('done').disabled;
              result.practiceFlow.posLabelBefore = document.getElementById('posLabel').textContent;

              result.handwritingFlow.pointerEventsSupported = typeof PointerEvent === 'function';
              if (result.handwritingFlow.pointerEventsSupported && inkCanvas && inkCtx && typeof clearInk === 'function') {
                clearInk();
                const pixelCount = () => {
                  const pixels = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data;
                  let count = 0;
                  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) count++;
                  return count;
                };
                const rect = inkCanvas.getBoundingClientRect();
                const points = [
                  { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.30 },
                  { x: rect.left + rect.width * 0.40, y: rect.top + rect.height * 0.42 },
                  { x: rect.left + rect.width * 0.56, y: rect.top + rect.height * 0.54 },
                  { x: rect.left + rect.width * 0.72, y: rect.top + rect.height * 0.66 }
                ];
                const pointer = (type, point, buttons) => new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 4242,
                  pointerType: 'touch',
                  isPrimary: true,
                  button: 0,
                  buttons,
                  clientX: point.x,
                  clientY: point.y
                });
                const scrollBefore = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
                const pixelsBefore = pixelCount();
                result.handwritingFlow.touchActionNone = getComputedStyle(inkCanvas).touchAction === 'none';
                result.handwritingFlow.pointerDownPrevented = !inkCanvas.dispatchEvent(pointer('pointerdown', points[0], 1));
                let movesPrevented = true;
                for (let i = 1; i < points.length; i++) {
                  movesPrevented = !inkCanvas.dispatchEvent(pointer('pointermove', points[i], 1)) && movesPrevented;
                }
                inkCanvas.dispatchEvent(pointer('pointerup', points[points.length - 1], 0));
                result.handwritingFlow.pointerMovePrevented = movesPrevented;
                const touchProbe = new Event('touchmove', { bubbles: true, cancelable: true });
                inkCanvas.dispatchEvent(touchProbe);
                result.handwritingFlow.touchMovePrevented = touchProbe.defaultPrevented;
                result.handwritingFlow.strokeRecorded = inkStrokes.length === 1;
                result.handwritingFlow.strokePointCount = inkStrokes.length ? inkStrokes[0].length : 0;
                result.handwritingFlow.inkPixelsChanged = pixelCount() > pixelsBefore;
                const scrollAfter = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
                result.handwritingFlow.pageScrollStable = scrollAfter === scrollBefore;
                clearInk();
                result.handwritingFlow.clearWorked = inkStrokes.length === 0 && pixelCount() === 0;
              }

              revealAnswer(false);
              await waitFor(() => visible('reveal'));
              result.practiceFlow.revealVisible = true;
              result.practiceFlow.stampVisible = visible('stampRow');

              pickStamp('fast');
              await waitFor(() => visible('stampedToast') && visible('nextWrap'));
              result.practiceFlow.stampedToastVisible = true;
              result.practiceFlow.nextVisible = true;
              result.practiceFlow.outcome = roundStats.length ? roundStats[roundStats.length - 1].outcome : '';

              goNext();
              await waitFor(() => pos === 1 && visible('card'));
              result.practiceFlow.nextAdvanced = true;
              result.practiceFlow.posLabelAfter = document.getElementById('posLabel').textContent;

              if (typeof openExitSheet === 'function' && typeof exitCurrentRound === 'function') {
                result.exitFlow.roundStatsBeforeExit = roundStats.length;
                result.exitFlow.positionBeforeExit = pos;
                openExitSheet();
                await waitFor(() => document.getElementById('exitSheet').classList.contains('open'));
                result.exitFlow.sheetOpened = true;
                exitCurrentRound();
                await waitFor(() => visible('home'));
                result.exitFlow.returnedHome = visible('home');
                result.exitFlow.practiceHidden = !visible('card');
                result.exitFlow.footVisible = visible('foot');
                result.exitFlow.roundStatsAfterExit = roundStats.length;
                result.exitFlow.roundStatsUnchanged = result.exitFlow.roundStatsAfterExit === result.exitFlow.roundStatsBeforeExit;
              }
            }
          } catch (error) {
            result.error = String(error && error.message ? error.message : error);
          }
          window.webkit.messageHandlers.shiziNative.postMessage({
            type: 'nativeSmokeResult',
            payload: JSON.stringify(result)
          });
        })();
        void 0;
        """

        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                self?.writeNativeSmokeResult(#"{"error":"\#(error.localizedDescription)"}"#)
            }
        }
    }

    private func writeNativeSmokeResult(_ payload: String) {
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return
        }
        let resultURL = documentsURL.appendingPathComponent("shizi-native-smoke.json")
        try? payload.data(using: .utf8)?.write(to: resultURL, options: .atomic)
    }

    private func shareBackup(filename: String, payload: String) {
        let safeName = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)

        do {
            try payload.data(using: .utf8)?.write(to: fileURL, options: .atomic)
        } catch {
            presentError(message: "备份文件生成失败，请稍后再试。")
            return
        }

        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        if let popover = activity.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(activity, animated: true)
    }

    private func presentBackupPicker() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    private func importBackup(from url: URL) {
        let hasSecurityScope = url.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let fileSize = values.fileSize, fileSize > 10 * 1024 * 1024 {
                throw BackupImportError.tooLarge
            }

            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            guard
                data.count <= 10 * 1024 * 1024,
                let payload = String(data: data, encoding: .utf8),
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                object["app"] as? String == "shizi",
                let backupData = object["data"] as? [String: Any],
                backupData.keys.contains(where: { $0.hasPrefix("shizi.") })
            else {
                throw BackupImportError.invalidFormat
            }

            let encoded = try JSONSerialization.data(withJSONObject: [payload])
            guard let arguments = String(data: encoded, encoding: .utf8) else {
                throw BackupImportError.invalidFormat
            }

            let script = """
            (function(payload){
              const result = restoreBackupPayload(payload, { reload: false });
              if (result && result.applied) setTimeout(function(){ location.reload(); }, 0);
              return result;
            })(\(arguments)[0]);
            """
            webView.evaluateJavaScript(script) { [weak self] _, error in
                if error != nil {
                    self?.presentError(message: "备份恢复失败，请确认文件内容后重试。")
                }
            }
        } catch BackupImportError.tooLarge {
            presentError(message: "备份文件超过 10 MB，无法导入。")
        } catch {
            presentError(message: "这个文件不是有效的拾字备份。")
        }
    }

    private func presentError(message: String) {
        let alert = UIAlertController(title: "拾字", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            if !opened {
                self?.presentError(message: "无法打开这个链接。")
            }
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.scheme == ShiziWebResource.scheme {
            decisionHandler(.allow)
            return
        }

        if navigationAction.targetFrame?.isMainFrame != false {
            openExternally(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        runNativeSmokeIfNeeded()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        nativeSmokeDidRun = false
        loadApp()
    }
}

extension WebViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: "拾字", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        if Self.nativeSmokeEnabled, message == Self.nativeSmokeConfirmMessage {
            completionHandler(true)
            return
        }

        let alert = UIAlertController(title: "拾字", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: "拾字", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "shiziNative",
            let body = message.body as? [String: Any],
            let type = body["type"] as? String
        else {
            return
        }

        switch type {
        case "shareBackup":
            let name = body["name"] as? String ?? "shizi-backup.json"
            let payload = body["payload"] as? String ?? "{}"
            shareBackup(filename: name, payload: payload)
        case "pickBackup":
            presentBackupPicker()
        case "nativeSmokeResult":
            let payload = body["payload"] as? String ?? #"{"error":"Missing native smoke payload"}"#
            writeNativeSmokeResult(payload)
        default:
            break
        }
    }
}

extension WebViewController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            return
        }
        importBackup(from: url)
    }
}

private enum BackupImportError: Error {
    case invalidFormat
    case tooLarge
}
