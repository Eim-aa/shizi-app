import AVFoundation
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import Vision
import WebKit

final class WebViewController: UIViewController {
    private static let nativeSmokeConfirmMessage = "__shizi_native_smoke_confirm__"

    private let schemeHandler: LocalWebSchemeHandler
    private var webView: WKWebView!
    private var practiceBackGesture: UIScreenEdgePanGestureRecognizer!
    private var nativeSmokeDidRun = false
    private var reminderSyncGeneration = 0
    private var pageReady = false
    private var pendingReminderCardKey: String?
    private lazy var stampHaptic = UIImpactFeedbackGenerator(style: .medium)
    private lazy var undoHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var actionHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var selectionHaptic = UISelectionFeedbackGenerator()
    private lazy var milestoneHaptic = UINotificationFeedbackGenerator()
    private lazy var stampSoundPlayer = makePaperSoundPlayer(kind: .stamp)
    private lazy var paperSoundPlayer = makePaperSoundPlayer(kind: .paper)

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

        let practiceBackGesture = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handlePracticeBackGesture(_:)))
        practiceBackGesture.edges = .left
        practiceBackGesture.maximumNumberOfTouches = 1
        webView.addGestureRecognizer(practiceBackGesture)

        self.webView = webView
        self.practiceBackGesture = practiceBackGesture
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadApp()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .default
    }

    @objc private func handlePracticeBackGesture(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended else { return }
        let distance = gesture.translation(in: webView).x
        let velocity = gesture.velocity(in: webView).x
        guard distance > webView.bounds.width * 0.24 || velocity > 650 else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('shizi-native-back')); void 0;")
    }

    private func loadApp() {
        pageReady = false
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

    func openReminderTarget(cardKey: String) {
        guard !cardKey.isEmpty else { return }
        pendingReminderCardKey = cardKey
        dispatchPendingReminderTargetIfReady()
    }

    private func dispatchPendingReminderTargetIfReady() {
        guard pageReady, let cardKey = pendingReminderCardKey else { return }
        guard
            let encoded = try? JSONEncoder().encode(cardKey),
            let literal = String(data: encoded, encoding: .utf8)
        else {
            pendingReminderCardKey = nil
            return
        }
        pendingReminderCardKey = nil
        let script = "typeof shiziOpenReminderTarget === 'function' && shiziOpenReminderTarget(\(literal));"
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if error != nil {
                self?.pendingReminderCardKey = cardKey
            }
        }
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
        let backForwardSnapshotsDisabled = !webView.allowsBackForwardNavigationGestures
        let nativeEdgeGestureInstalled = webView.gestureRecognizers?.contains(where: { $0 === practiceBackGesture }) == true

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
              viewportZoomAllowed: false,
              keyboardInsetVar: false,
              visualViewportAvailable: false,
              sheetScrollable: false,
              sheetBottomPadding: false,
              addInputFocused: false,
              keyboardInsetPixels: 0,
              keyboardInsetActive: false,
              keyboardInsetMatchesViewport: false,
              inputVisibleAboveKeyboard: false,
              addConfirmReachableAboveKeyboard: false,
              practiceFixed: false,
              practiceActionsInViewport: false,
              toastAriaLive: false,
              largeTypeScaled: false,
              criticalTargets44: false,
              readableOutcomeLegend: false,
              outcomeMarksRedundant: false
            },
            handwritingFlow: {
              pointerEventsSupported: false,
              touchActionNone: false,
              pointerDownPrevented: false,
              pointerMovePrevented: false,
              touchMovePrevented: false,
              strokeRecorded: false,
              strokePointCount: 0,
              brushRendererAvailable: false,
              brushMetadataRecorded: false,
              brushShareMetadata: false,
              inkPixelsChanged: false,
              pageScrollStable: false,
              clearWorked: false,
              undoStrokeWorked: false,
              actionCooldownActive: false,
              peekEntered: false,
              peekCancelledPartialStroke: false,
              peekActionsUnlocked: false,
              peekBlockedInk: false,
              peekRestored: false,
              peekControlVisible: false,
              actionLabelsDirect: false,
              peekControlEntered: false,
              peekControlGlyphVisible: false,
              peekControlUncounted: false
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
              recentInkStored: false,
              wildPhotoInputProcessed: false,
              wildVisionRequestCompleted: false,
              wildOCRRequiresSelection: false,
              wildCaptureStored: false,
              wildPhotoBounded: false,
              wildPhotoViewsDecode: false,
              wildFailureFallback: false,
              wildPhotoMime: '',
              wildVisionCandidateCount: -1,
              wildSmokeStage: 'not-started',
              libraryAvailable: false,
              libraryReachable: false,
              libraryUI: false,
              libraryCalibrationLifecycle: false,
              contextAvailable: false,
              contextOverridesApplied: false,
              contextMemoryStable: false,
              contextOfflineResource: false,
              backupParses: false,
              backupHasAppMarker: false,
              backupHasAdded: false,
              backupHasCustom: false,
              backupHasMemory: false,
              backupHasRecentInk: false,
              backupHasReminder: false,
              backupHasSound: false,
              backupHasLibrary: false,
              backupHasFunnel: false,
              backupExcludesSmokeKey: false,
              backupHasMeta: false,
              backupRestoreApplied: false,
              backupRestoreKeyCount: 0,
              backupRestoreAdded: false,
              backupRestoreCustom: false,
              backupRestoreMemory: false,
              backupRestoreRecentInk: false,
              backupRestoreLibrary: false,
              backupRestoreFunnel: false,
              backupRestorePreservesSmokeKey: false,
              backupRestoreRejectsInvalid: false,
              nativeBridgeAvailable: false,
              nativeImportAvailable: false,
              nativeConfirmAvailable: false,
              reminderStateAvailable: false,
              soundStateAvailable: false,
              soundscapeStateAvailable: false,
              etymologyResourceAvailable: false,
              etymologyDetailAvailable: false,
              funnelStateAvailable: false,
              reminderSettingsRowVisible: false,
              soundSettingsRowVisible: false,
              soundscapeSettingsRowVisible: false,
              reminderQuestionPayload: false,
              calibrationReturnInviteVisible: false,
              calibrationReturnPermissionRequested: false,
              shareCardGenerated: false,
              shareCardPrivate: false,
              shareCardBridgeAvailable: false,
              calendarAvailable: false,
              monthlyPostGenerated: false,
              annualReportAvailable: false,
              recentInkBounded: false
            },
            navigationFlow: {
              practiceEntryVisible: false,
              practiceTabActive: false,
              bookVisible: false,
              bookTabActive: false,
              footVisibleOnBook: false,
              bookAchievementVisible: false,
              stampGuideAvailable: false,
              meVisible: false,
              meTabActive: false,
              footVisibleOnMe: false,
              profileVisible: false,
              profileFootHidden: false,
              profileReturnedToMe: false,
              profileHasNoDuplicateChars: false,
              meActionsDisclosed: false,
              metricLanguageConsistent: false,
              monthlyRhythmVisible: false,
              homeCaptureVisible: false,
              auditVisible: false,
              auditReturnedToSettings: false
            },
            practiceFlow: {
              started: false,
              batchSize: 0,
              cardVisible: false,
              showEnabled: false,
              doneEnabled: false,
              revealVisible: false,
              comparisonGridComplete: false,
              comparisonSkeletonVisible: false,
              comparisonCoordinatesAligned: false,
              noNextButton: false,
              immediateAdvanced: false,
              undoBarFollowed: false,
              undoRollback: false,
              undoActivityRollback: false,
              nextCardUntouched: false,
              summaryPocketVisible: false,
              traceModeVisible: false,
              traceOutlineVisible: false,
              traceRequiresInk: false,
              traceReadyAfterInk: false,
              activityRecorded: false,
              sessionSnapshotStored: false,
              resumeHomeState: false,
              resumeRestored: false,
              reminderSyncAfterStamp: false,
              hapticSelectTipRecorded: false,
              hapticActionRevealRecorded: false,
              hapticStampRecorded: false,
              soundStampRecorded: false,
              soundPaperRecorded: false,
              hapticUndoRecorded: false,
              hapticSelectTracingRecorded: false,
              hapticHintedSequence: [],
              hapticUndoSequence: [],
              hapticDontKnowSequence: [],
              hapticTraceCompletionSequence: [],
              hapticMilestoneSequence: [],
              hapticOrdinaryCompletionSequence: [],
              outcome: '',
              posLabelBefore: '',
              posLabelAfter: ''
            },
            exitFlow: {
              noExitSheet: false,
              returnedHome: false,
              practiceHidden: false,
              footVisible: false,
              roundStatsUnchanged: false,
              roundStatsBeforeExit: -1,
              roundStatsAfterExit: -1,
              positionBeforeExit: -1,
              historyInitialLength: 0,
              directReturnCount: 0,
              historyLengthStable: false,
              directReturnStatePreserved: false,
              directReturnSaved: false,
              nativeEdgeBackEvent: false,
              backForwardSnapshotsDisabled: \(backForwardSnapshotsDisabled),
              nativeEdgeGestureInstalled: \(nativeEdgeGestureInstalled),
              homeBackNoop: false
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
            const visible = (id) => {
              const element = document.getElementById(id);
              return !!element && getComputedStyle(element).display !== 'none';
            };
            const activeTab = (id) => document.getElementById(id).classList.contains('active');
            const viewportMeta = document.querySelector('meta[name="viewport"]');
            result.layoutFlow.viewportFitCover = !!viewportMeta && viewportMeta.content.includes('viewport-fit=cover');
            const compactViewport = viewportMeta ? viewportMeta.content.replaceAll(' ', '') : '';
            result.layoutFlow.viewportZoomAllowed = !!viewportMeta && !compactViewport.includes('user-scalable=no') && !compactViewport.includes('maximum-scale=1');
            result.layoutFlow.toastAriaLive = document.getElementById('toast').getAttribute('aria-live') === 'polite';
            result.layoutFlow.keyboardInsetVar = /^\\d+px$/.test(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim());
            result.layoutFlow.visualViewportAvailable = !!window.visualViewport;
            if (typeof renderMe === 'function') renderMe();
            if (typeof renderSettings === 'function') {
              renderSettings(false);
              result.devToolsDisplay = getComputedStyle(document.getElementById('devTools')).display;
              renderMe();
            }
            result.localStoragePersistedFromPreviousLaunch = localStorage.getItem('shizi.nativeSmoke.v1') !== null;
            localStorage.setItem('shizi.nativeSmoke.v1', new Date().toISOString());
            result.localStorageWritable = localStorage.getItem('shizi.nativeSmoke.v1') !== null;
            const response = await fetch('data/' + encodeURIComponent('美') + '.json');
            result.fetchOk = response.ok;
            result.fetchStatus = response.status;
            const payload = await response.json();
            result.strokeCount = Array.isArray(payload.strokes) ? payload.strokes.length : 0;
            const etymologyResponse = await fetch('data/etymology.json');
            const etymologyPayload = etymologyResponse.ok ? await etymologyResponse.json() : [];
            result.dataFlow.etymologyResourceAvailable = Array.isArray(etymologyPayload) && etymologyPayload.length >= 1000 && etymologyPayload.every(row => row && typeof row.char === 'string' && typeof row.gloss === 'string' && row.gloss.length <= 20 && typeof row.source === 'string');
            const contextResponse = await fetch('data/context-overrides.js');
            result.dataFlow.contextOfflineResource = contextResponse.ok && (await contextResponse.text()).includes('CONTEXT_OVERRIDES');
            const contextIndex = BASE_BY_CHAR['毓'];
            const glossIndex = BASE_BY_CHAR['谔'];
            const contextCard = CARDS[contextIndex];
            const glossCard = CARDS[glossIndex];
            const originalContext = SEED.find(row => (row.target || Array.from(row.ans)[Number(row.ci) || 0]) === '毓');
            const contextLeaks = Object.keys(OVERRIDES).filter(target => {
              const card = CARDS[BASE_BY_CHAR[target]];
              return !card || (promptHTML(card).replace(/<[^>]+>/g, '') + ' ' + (card.hint || '')).includes(target);
            });
            const rejectedPromptWords = ['战战兢兢', '千里迢迢', '翩翩起舞', '谆谆教诲', '佼佼者', '年高德劭', '崔嵬', '陶埙', '匏瓜', '勖勉', '安瓿', '礞石', '老趼', '振翮'];
            result.dataFlow.contextAvailable = Object.keys(OVERRIDES).length === 56;
            result.dataFlow.contextOverridesApplied = contextCard.word === '钟灵毓秀' && contextCard.ctx === 'override'
              && glossCard.word === '谔' && glossCard.ctx === 'gloss' && glossCard.hint === '直言争辩的样子'
              && contextLeaks.length === 0
              && !Object.values(OVERRIDES).some(row => rejectedPromptWords.includes(row.w));
            result.dataFlow.contextMemoryStable = cardKey(contextIndex) === 'base:毓' && contextCard.py === originalContext.py;

            if (typeof renderBook === 'function' && typeof renderMe === 'function' && typeof renderProfile === 'function' && typeof renderHome === 'function') {
              document.getElementById('tabBook').click();
              await waitFor(() => visible('studybook'));
              result.navigationFlow.bookVisible = visible('studybook');
              result.navigationFlow.bookTabActive = activeTab('tabBook');
              result.navigationFlow.footVisibleOnBook = visible('foot');
              const wall = document.getElementById('memoryWall');
              const wallChars = Array.from(wall.querySelectorAll('.memoryChar'));
              result.navigationFlow.bookAchievementVisible = document.getElementById('boxCount').textContent.includes('字') && document.getElementById('bookCurator').textContent.length > 0;
              result.layoutFlow.readableOutcomeLegend = wallChars.every(node => parseFloat(getComputedStyle(node).fontSize) >= 21);
              result.layoutFlow.outcomeMarksRedundant = wall.querySelectorAll('.dot,.outcomeMark').length === 0 && getComputedStyle(wall).gridTemplateColumns.split(' ').length === 6;
              result.navigationFlow.stampGuideAvailable = document.getElementById('bookSearchInput').placeholder.includes('找一个字') && !!document.getElementById('bookSaveMonth');
              if (typeof loadEtymology === 'function' && typeof openCharSheet === 'function') {
                await loadEtymology();
                openCharSheet(CARDS.findIndex(card => card.target === '水'));
                result.dataFlow.etymologyDetailAvailable = getComputedStyle(document.getElementById('etymLine')).display === 'block' && document.getElementById('etymGloss').textContent.length > 0 && document.getElementById('etymSource').textContent.includes('说文解字');
                closeCharSheet();
              }
              if (typeof openLibSheet === 'function' && typeof libraryCounts === 'function') {
                const libraryBefore = cloneObj(libraryState);
                const tuningBefore = cloneObj(tuning);
                const memoryBeforeLibrary = cloneObj(memory);
                const statusBeforeLibrary = cloneObj(status);
                const qualityBeforeLibrary = cloneObj(quality);
                const sessionDoneBeforeLibrary = [...sessionDone];
                const preferenceBeforeLibrary = preference;
                const activeModeBeforeLibrary = activeMode;
                const calibrationTargetsBeforeLibrary = calibrationTargets.slice();
                const roundStatsBeforeLibrary = cloneObj(roundStats);
                const funnelBeforeLibrary = cloneObj(funnel);
                memory = {}; status = {}; quality = {}; sessionDone = new Set();
                const libraryRows = LIBRARIES.map(lib => {
                  setLibrary(lib.id);
                  tuning.contextStrict = 4;
                  const strict4 = newPool(false).length;
                  tuning.contextStrict = 0;
                  const strict0 = newPool(false).length;
                  const counts = libraryCounts(lib);
                  return { total: counts.total, officialTotal: counts.officialTotal, strict0, strict4 };
                });
                const legacyLibraries = ['primary', 'junior', 'senior'].map(id => normalizeLibrary({ id, userSelected: true }));
                setLibrary('curriculum2500');
                renderBook();
                openLibSheet();
                result.dataFlow.libraryAvailable = LIBRARIES.length === 4 && BACKUP_KEYS.includes(LIB_KEY)
                  && JSON.stringify(libraryRows.map(row => row.total)) === JSON.stringify([3500, 2868, 486, 2500])
                  && JSON.stringify(libraryRows.map(row => row.officialTotal)) === JSON.stringify([3500, 3000, 1605, 2500])
                  && CARDS.slice(0, BASE_N).every(card => ['入门', '基础', '进阶', '较难', '挑战'].includes(card.band) && !('level' in card));
                result.dataFlow.libraryReachable = libraryRows.every(row => row.total > 0 && row.strict0 === row.total && row.strict4 === row.total);
                result.dataFlow.libraryUI = document.getElementById('libList').querySelectorAll('[data-lib]').length === 4
                  && document.getElementById('libSheet').textContent.includes('换库不丢任何东西')
                  && document.getElementById('libName').textContent === '义教基础字'
                  && LIBRARIES[2].name === '规范专门用字' && libraryRows[2].total === 486 && libraryRows[2].officialTotal === 1605
                  && document.getElementById('libSheet').textContent.includes('官方 3000')
                  && document.getElementById('libSheet').textContent.includes('官方 1605')
                  && !/小学|初中|高中/.test(document.getElementById('libSheet').textContent)
                  && !document.getElementById('libCard').querySelector('.libBar,.libTones')
                  && !document.getElementById('libList').querySelector('.libBar')
                  && !/拾完|手速|墨色进度/.test(document.getElementById('libSheet').textContent + document.getElementById('libCard').textContent);
                closeLibSheet();
                const calibrationIndexes = allIndexes().slice(0, 15);
                const completeChallengeCalibration = manualLibrary => {
                  preference = 'balanced'; tuning = { calibrated: false, offset: 0, contextStrict: 0, rounds: [] };
                  libraryState = normalizeLibrary(null); save(LIB_KEY, libraryState);
                  if (manualLibrary) setLibrary(manualLibrary);
                  activeMode = 'calibrate'; calibrationTargets = calibrationIndexes.slice();
                  roundStats = calibrationIndexes.map(idx => ({ idx, outcome: 'fast', geometryStatus: 'ok' }));
                  const before = cloneObj(libraryState); maybeFinishCalibration();
                  return { before, preference, after: cloneObj(libraryState), stored: load(LIB_KEY, null) };
                };
                const freshCalibration = completeChallengeCalibration('');
                const manualCalibration = completeChallengeCalibration('curriculum2500');
                result.dataFlow.libraryCalibrationLifecycle = freshCalibration.before.id === 'core3500' && !freshCalibration.before.userSelected
                  && freshCalibration.preference === 'challenge' && freshCalibration.after.id === 'adv3000' && !freshCalibration.after.userSelected
                  && freshCalibration.stored.id === 'adv3000'
                  && manualCalibration.before.id === 'curriculum2500' && manualCalibration.before.userSelected
                  && manualCalibration.preference === 'challenge' && manualCalibration.after.id === 'curriculum2500' && manualCalibration.after.userSelected
                  && legacyLibraries[0].id === 'curriculum2500' && legacyLibraries[1].id === 'core3500' && legacyLibraries[2].id === 'core3500'
                  && legacyLibraries.every(row => row.userSelected);
                memory = memoryBeforeLibrary; status = statusBeforeLibrary; quality = qualityBeforeLibrary; sessionDone = new Set(sessionDoneBeforeLibrary);
                tuning = tuningBefore; libraryState = normalizeLibrary(libraryBefore); preference = preferenceBeforeLibrary; activeMode = activeModeBeforeLibrary;
                calibrationTargets = calibrationTargetsBeforeLibrary; roundStats = roundStatsBeforeLibrary; funnel = funnelBeforeLibrary;
                saveMemory(); save(DECK_KEY, status); saveQuality(); saveTuning(); save(PREF_KEY, preference); save(LIB_KEY, libraryState); saveFunnel();
                renderBook();
              }

              document.getElementById('tabMe').click();
              await waitFor(() => visible('mePanel'));
              result.navigationFlow.meVisible = visible('mePanel');
              result.navigationFlow.meTabActive = activeTab('tabMe');
              result.navigationFlow.footVisibleOnMe = visible('foot');
              result.navigationFlow.meActionsDisclosed = visible('meCalendar') && !!document.getElementById('openProfile') && !!document.querySelector('.meMonthCard') && !!document.getElementById('openSettings') && !!document.getElementById('openBackupSettings');
              const practiced = profileIndexes();
              const recovered = practiced.filter(isStable);
              const atRisk = practiced.filter(isHighRisk);
              result.navigationFlow.metricLanguageConsistent = !document.querySelector('.meStats') && recovered.every(index => !atRisk.includes(index)) && practiced.length >= recovered.length + atRisk.length && document.getElementById('calendarMonthStat').textContent.includes('累计') && document.getElementById('meMonthMeta').textContent.includes('字是你的手写');
              document.getElementById('openSettings').click();
              await waitFor(() => visible('settingsPanel'));
              const oldFontScale = fontScaleLarge;
              fontScaleLarge = false; applyFontScale();
              const normalType = parseFloat(getComputedStyle(document.querySelector('.settingsPanel h2')).fontSize);
              fontScaleLarge = true; applyFontScale();
              const largeType = parseFloat(getComputedStyle(document.querySelector('.settingsPanel h2')).fontSize);
              fontScaleLarge = oldFontScale; applyFontScale();
              result.layoutFlow.largeTypeScaled = largeType >= normalType * 1.1 && document.getElementById('fontScaleRow').getAttribute('aria-pressed') === (oldFontScale ? 'true' : 'false');
              result.layoutFlow.criticalTargets44 = ['exitPractice','tip','undoStroke','clear','show','done','fontScaleRow','overlayToggle','replayBtn'].every(id => parseFloat(getComputedStyle(document.getElementById(id)).minHeight) >= 44)
                && Array.from(document.querySelectorAll('#qualityBox button')).every(node => parseFloat(getComputedStyle(node).minHeight) >= 44);

              document.getElementById('closeSettings').click();
              await waitFor(() => visible('mePanel'));
              document.getElementById('openProfile').click();
              await waitFor(() => visible('profilePanel'));
              result.navigationFlow.profileVisible = visible('profilePanel');
              result.navigationFlow.profileFootHidden = !visible('foot');
              result.navigationFlow.profileHasNoDuplicateChars = document.getElementById('profileChars') === null;
              document.getElementById('closeProfile').click();
              await waitFor(() => visible('mePanel'));
              result.navigationFlow.profileReturnedToMe = true;

              if (result.devQuery) {
                document.getElementById('openSettings').click();
                await waitFor(() => visible('settingsPanel'));
                document.getElementById('auditLink').click();
                await waitFor(() => visible('auditPanel'));
                result.navigationFlow.auditVisible = visible('auditPanel');
                document.getElementById('closeAudit').click();
                await waitFor(() => visible('settingsPanel'));
                result.navigationFlow.auditReturnedToSettings = true;
              }

              document.getElementById('tabPractice').click();
              await waitFor(() => visible('home') || visible('welcome'));
              result.navigationFlow.practiceEntryVisible = visible('home') || visible('welcome');
              result.navigationFlow.practiceTabActive = activeTab('tabPractice');
              result.navigationFlow.homeCaptureVisible = !!document.getElementById('homeAdd') && document.getElementById('homeAdd').textContent.includes('收字');
              result.navigationFlow.monthlyRhythmVisible = !document.getElementById('monthSignal') && !!document.getElementById('calendarMonthStat');
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
              result.dataFlow.recentInkStored = !!memoryForSmokeChar && persistRecentInk(memoryForSmokeChar, [[{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.75 }, { x: 0.8, y: 0.25 }]], Date.now()) && !!memoryForSmokeChar.recentInk;
              saveMemory();

              const handCardCanvas = await renderHandCardCanvas(indexForSmokeChar, 'portrait');
              const handCardSquare = await renderHandCardCanvas(indexForSmokeChar, 'square');
              openCharSheet(indexForSmokeChar);
              result.dataFlow.handCardDetailEntry = getComputedStyle(document.getElementById('charDetailCard')).display === 'block';
              closeCharSheet();
              result.dataFlow.handCardGenerated = !!handCardCanvas && handCardCanvas.width === 1080 && handCardCanvas.height === 1440
                && handCardCanvas.dataset.inkSource === 'vector' && Number(handCardCanvas.dataset.inkStrokeCount) > 0
                && !!handCardSquare && handCardSquare.width === 1080 && handCardSquare.height === 1080;
              const handCardMessages = [];
              const handCardBridge = { postMessage: message => handCardMessages.push(message) };
              const handCardSave = await exportHandCard('save', { index: indexForSmokeChar, ratio: 'portrait', nativeBridge: handCardBridge });
              const handCardShare = await exportHandCard('share', { index: indexForSmokeChar, ratio: 'square', nativeBridge: handCardBridge });
              result.dataFlow.handCardNativeRoutes = handCardSave.route === 'native-save' && handCardShare.route === 'native-share'
                && handCardMessages[0].type === 'savePracticeCard' && handCardMessages[1].type === 'sharePracticeCard'
                && handCardMessages.every(message => message.kind === 'character' && message.dataURL.startsWith('data:image/png;base64,'));
              handCardPref = normalizeHandCardPref({ promptEnabled: true, lastPromptDay: '' });
              const handCardPromptFirst = maybeOfferHandCard(indexForSmokeChar, 'fast');
              const handCardPromptSecond = maybeOfferHandCard(indexForSmokeChar, 'fast');
              handCardPref.promptEnabled = false; handCardPref.lastPromptDay = ''; save(HAND_CARD_KEY, handCardPref);
              result.dataFlow.handCardPromptBounded = handCardPromptFirst && !handCardPromptSecond && !maybeOfferHandCard(indexForSmokeChar, 'fast');
              hideHandCardPrompt();
              const vectorRecentInk = JSON.parse(JSON.stringify(memoryForSmokeChar.recentInk));
              memoryForSmokeChar.recentInk = { version: 1, day: vectorRecentInk.day, at: vectorRecentInk.at, dataURL: vectorRecentInk.dataURL };
              openCharSheet(indexForSmokeChar);
              const legacyEntryHidden = getComputedStyle(document.getElementById('charDetailCard')).display === 'none';
              const legacyPromptVisible = getComputedStyle(document.getElementById('charDetailCardLegacy')).display === 'block'
                && document.getElementById('charDetailCardLegacy').textContent.includes('重新独立写一次');
              closeCharSheet();
              const legacyCanvas = await renderHandCardCanvas(indexForSmokeChar, 'portrait');
              const legacyExport = await exportHandCard('share', { index: indexForSmokeChar, ratio: 'square', nativeBridge: handCardBridge });
              result.dataFlow.handCardLegacyBlocked = legacyEntryHidden && legacyPromptVisible && legacyCanvas === null && legacyExport.route === 'empty';
              memoryForSmokeChar.recentInk = vectorRecentInk;
              saveMemory();

              const wildKnownChar = '拾';
              result.dataFlow.wildSmokeStage = 'opening-sheet';
              openAddSheet();
              await waitFor(() => document.getElementById('addSheet').classList.contains('open'));
              const originalOCRResult = window.shiziOCRResult;
              let nativeOCRPayload = null;
              window.shiziOCRResult = payload => {
                nativeOCRPayload = payload;
                return originalOCRResult(payload);
              };
              const fixtureResponse = await fetch('icon-192.png');
              const fixtureBlob = await fixtureResponse.blob();
              const fixtureFile = new File([fixtureBlob], 'wild-photo-fixture.png', { type: fixtureBlob.type || 'image/png' });
              result.dataFlow.wildSmokeStage = `handling-photo:${fixtureBlob.type}:${fixtureBlob.size}`;
              const handledWildPhoto = await handleWildPhoto(fixtureFile);
              result.dataFlow.wildSmokeStage = `waiting-thumbnail:${handledWildPhoto}`;
              await waitFor(() => wildDraft && document.getElementById('wildCaptureThumb').complete && document.getElementById('wildCaptureThumb').naturalWidth > 0);
              const nativeRequestID = wildDraft.requestId;
              result.dataFlow.wildSmokeStage = `waiting-vision:${nativeRequestID}`;
              await waitFor(() => nativeOCRPayload && Number(nativeOCRPayload.requestId) === nativeRequestID, 15000);
              result.dataFlow.wildSmokeStage = 'vision-complete';
              result.dataFlow.wildPhotoInputProcessed = handledWildPhoto === true
                && (wildDraft.dataURL.startsWith('data:image/webp;base64,')
                  || wildDraft.dataURL.startsWith('data:image/jpeg;base64,'))
                && wildImageBytes(wildDraft.dataURL) > 0
                && wildImageBytes(wildDraft.dataURL) <= WILD_PHOTO_MAX_BYTES;
              result.dataFlow.wildVisionRequestCompleted = Number(nativeOCRPayload.requestId) === nativeRequestID
                && Array.isArray(nativeOCRPayload.candidates);
              result.dataFlow.wildPhotoMime = wildDraft.dataURL.split(';', 1)[0].slice(5);
              result.dataFlow.wildVisionCandidateCount = Array.isArray(nativeOCRPayload.candidates)
                ? nativeOCRPayload.candidates.length : -1;
              const nativeOCRLeftSelectionEmpty = document.getElementById('addInput').value === ''
                && document.getElementById('addConfirm').disabled;
              window.shiziOCRResult = originalOCRResult;
              window.shiziOCRResult({ requestId: nativeRequestID, candidates: ['拾时拾'] });
              const wildCandidateButtons = Array.from(document.querySelectorAll('#wildCandidates [data-wild-candidate]'));
              result.dataFlow.wildOCRRequiresSelection = nativeOCRLeftSelectionEmpty
                && wildCandidateButtons.map(button => button.textContent).join('') === '拾时'
                && document.getElementById('addInput').value === '';
              wildCandidateButtons[0].click();
              confirmAdd();
              await waitFor(() => !document.getElementById('addSheet').classList.contains('open'));
              const wildIndex = BASE_BY_CHAR[wildKnownChar];
              const wildMemory = memory[cardKey(wildIndex)] || {};
              result.dataFlow.wildCaptureStored = wildMemory.source === 'wild'
                && wildMemory.wildDay === today() && !!wildCaptureFor(wildKnownChar);
              result.dataFlow.wildPhotoBounded = wildImageBytes(wildCaptureFor(wildKnownChar).dataURL) <= WILD_PHOTO_MAX_BYTES
                && WILD_PHOTO_MAX === 30 && WILD_PHOTO_BUDGET === 420 * 1024;
              openCharSheet(wildIndex);
              await waitFor(() => document.getElementById('charDetailWildImage').complete && document.getElementById('charDetailWildImage').naturalWidth > 0);
              document.getElementById('charDetailWild').click();
              await waitFor(() => document.getElementById('wildPhotoSheet').classList.contains('open')
                && document.getElementById('wildPhotoFull').complete && document.getElementById('wildPhotoFull').naturalWidth > 0);
              result.dataFlow.wildPhotoViewsDecode = document.getElementById('charDetailWildImage').naturalWidth > 0
                && document.getElementById('wildPhotoFull').naturalWidth > 0;
              closeWildPhoto(); closeCharSheet();
              openAddSheet();
              const failedWildPhoto = await handleWildPhoto(new File(['not-an-image'], 'broken.png', { type: 'image/png' }));
              result.dataFlow.wildFailureFallback = failedWildPhoto === false && wildDraft === null
                && document.getElementById('wildCaptureNote').textContent.includes('手动输入')
                && !document.getElementById('addInput').disabled;
              closeAddSheet();
              result.dataFlow.wildSmokeStage = 'complete';

              localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 2, smoke: true }));
              const backup = JSON.parse(backupPayload({ funnelExportAt: Date.now() }));
              const backupData = backup && backup.data ? backup.data : {};
              result.dataFlow.backupParses = true;
              result.dataFlow.backupHasAppMarker = backup.app === 'shizi' && backup.version === 1;
              result.dataFlow.backupHasAdded = Object.prototype.hasOwnProperty.call(backupData, ADDED_KEY) && String(backupData[ADDED_KEY]).includes(smokeChar);
              result.dataFlow.backupHasCustom = BASE_BY_CHAR[smokeChar] != null || (Object.prototype.hasOwnProperty.call(backupData, CUSTOM_KEY) && String(backupData[CUSTOM_KEY]).includes(smokeChar));
              result.dataFlow.backupHasMemory = Object.prototype.hasOwnProperty.call(backupData, MEMORY_KEY) && String(backupData[MEMORY_KEY]).includes(smokeChar);
              result.dataFlow.backupHasRecentInk = Object.prototype.hasOwnProperty.call(backupData, MEMORY_KEY) && String(backupData[MEMORY_KEY]).includes('recentInk');
              result.dataFlow.backupHasHandCard = Object.prototype.hasOwnProperty.call(backupData, HAND_CARD_KEY)
                && String(backupData[MEMORY_KEY]).includes('strokes');
              result.dataFlow.backupHasWild = Object.prototype.hasOwnProperty.call(backupData, WILD_KEY) && String(backupData[WILD_KEY]).includes(wildKnownChar);
              result.dataFlow.backupHasReminder = Object.prototype.hasOwnProperty.call(backupData, REMINDER_KEY);
              result.dataFlow.backupHasSound = Object.prototype.hasOwnProperty.call(backupData, SOUND_KEY);
              result.dataFlow.backupHasLibrary = Object.prototype.hasOwnProperty.call(backupData, LIB_KEY);
              const backupFunnel = Object.prototype.hasOwnProperty.call(backupData, FUNNEL_KEY) ? JSON.parse(backupData[FUNNEL_KEY]) : null;
              result.dataFlow.backupHasFunnel = !!backupFunnel && backupFunnel.version === 1 && backupFunnel.events.filter(row => row.name === 'backup_exported').length === 1;
              result.dataFlow.backupHasSessionV2 = Object.prototype.hasOwnProperty.call(backupData, SESSION_KEY) && JSON.parse(backupData[SESSION_KEY]).version === 2;
              result.dataFlow.backupHasFSRSLog = Object.prototype.hasOwnProperty.call(backupData, FSRS_LOG_KEY);
              result.dataFlow.backupHasTraceTutorial = Object.prototype.hasOwnProperty.call(backupData, TRACE_TUTORIAL_KEY);
              result.dataFlow.backupExcludesSmokeKey = !Object.prototype.hasOwnProperty.call(backupData, 'shizi.nativeSmoke.v1');
              result.dataFlow.backupExcludesSafetyKey = !Object.prototype.hasOwnProperty.call(backupData, SAFETY_KEY);
              result.dataFlow.backupHasMeta = Object.prototype.hasOwnProperty.call(backupData, BACKUP_META_KEY);
              if (typeof restoreBackupPayload === 'function') {
                localStorage.setItem(ADDED_KEY, JSON.stringify([]));
                localStorage.setItem(CUSTOM_KEY, JSON.stringify([]));
                localStorage.setItem(MEMORY_KEY, JSON.stringify({}));
                localStorage.setItem(HAND_CARD_KEY, JSON.stringify({ promptEnabled: true, lastPromptDay: '' }));
                localStorage.setItem(WILD_KEY, JSON.stringify({ version: 1, captures: {}, wishes: {} }));
                localStorage.setItem(SESSION_KEY, JSON.stringify({ current: true }));
                const smokeValueBeforeRestore = localStorage.getItem('shizi.nativeSmoke.v1');
                const restoreResult = restoreBackupPayload(JSON.stringify(backup), { skipConfirm: true, reload: false });
                const restoredAdded = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]');
                const restoredCustom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
                result.dataFlow.backupRestoreApplied = !!restoreResult && restoreResult.applied === true;
                result.dataFlow.backupRestoreKeyCount = restoreResult && Array.isArray(restoreResult.keys) ? restoreResult.keys.length : 0;
                result.dataFlow.backupRestoreAdded = Array.isArray(restoredAdded) && restoredAdded.includes(smokeChar);
                result.dataFlow.backupRestoreCustom = BASE_BY_CHAR[smokeChar] != null || (Array.isArray(restoredCustom) && restoredCustom.includes(smokeChar));
                result.dataFlow.backupRestoreMemory = String(localStorage.getItem(MEMORY_KEY) || '').includes(smokeChar);
                result.dataFlow.backupRestoreRecentInk = String(localStorage.getItem(MEMORY_KEY) || '').includes('recentInk');
                result.dataFlow.backupRestoreHandCard = String(localStorage.getItem(HAND_CARD_KEY) || '').includes('promptEnabled')
                  && String(localStorage.getItem(MEMORY_KEY) || '').includes('strokes');
                result.dataFlow.backupRestoreWild = String(localStorage.getItem(WILD_KEY) || '').includes(wildKnownChar);
                result.dataFlow.backupRestoreLibrary = localStorage.getItem(LIB_KEY) === backupData[LIB_KEY];
                const restoredFunnel = JSON.parse(localStorage.getItem(FUNNEL_KEY) || '{}');
                result.dataFlow.backupRestoreFunnel = restoredFunnel.version === 1 && restoredFunnel.events.filter(row => row.name === 'backup_exported').length === 1;
                result.dataFlow.backupRestorePreservesSessionV2 = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}').version === 2;
                result.dataFlow.backupRestorePreservesSmokeKey = localStorage.getItem('shizi.nativeSmoke.v1') === smokeValueBeforeRestore;
                const safetyCopy = JSON.parse(localStorage.getItem(SAFETY_KEY) || 'null');
                result.dataFlow.backupSafetyCreated = !!safetyCopy && safetyCopy.reason === 'restore' && !!safetyCopy.payload;
                try {
                  restoreBackupPayload({ app: 'wrong-app', data: { 'shizi.bad': '1' } }, { skipConfirm: true, reload: false });
                } catch (_) {
                  result.dataFlow.backupRestoreRejectsInvalid = true;
                }
              }
              result.dataFlow.nativeBridgeAvailable = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.shiziNative);
              result.dataFlow.nativeOCRBridgeAvailable = result.dataFlow.nativeBridgeAvailable && typeof handleWildPhoto === 'function' && typeof window.shiziOCRResult === 'function';
              result.dataFlow.nativeCardSaveBridgeAvailable = result.dataFlow.nativeBridgeAvailable && typeof exportHandCard === 'function' && typeof window.shiziCardSaved === 'function';
              result.dataFlow.nativeImportAvailable = result.dataFlow.nativeBridgeAvailable && typeof requestBackupImport === 'function';
              result.dataFlow.shareCardBridgeAvailable = result.dataFlow.nativeBridgeAvailable && typeof sharePracticeCard === 'function';
              result.dataFlow.nativeConfirmAvailable = window.confirm('\(Self.nativeSmokeConfirmMessage)') === true;
              result.dataFlow.reminderStateAvailable = typeof reminder === 'object' && typeof reminder.enabled === 'boolean' && typeof totalPracticeDays === 'function' && Number.isInteger(totalPracticeDays());
              result.dataFlow.soundStateAvailable = typeof sound === 'object' && sound.enabled === true && typeof soundFeedback === 'function';
              result.dataFlow.soundscapeStateAvailable = sound.scene === 'off' && typeof startAmbient === 'function' && typeof stopAmbient === 'function' && typeof ambientNoiseBuffer === 'function';
              result.dataFlow.funnelStateAvailable = typeof funnel === 'object' && funnel.version === 1 && typeof recordFunnelOnce === 'function' && typeof recordFunnelComparison === 'function';
              result.dataFlow.reminderSettingsRowVisible = getComputedStyle(document.getElementById('reminderSection')).display !== 'none' && getComputedStyle(document.getElementById('reminderRow')).display !== 'none';
              result.dataFlow.soundSettingsRowVisible = getComputedStyle(document.getElementById('soundRow')).display !== 'none' && document.getElementById('soundState').textContent === '开';
              result.dataFlow.soundscapeSettingsRowVisible = getComputedStyle(document.getElementById('soundscapeRow')).display !== 'none' && document.querySelector('#soundscapeBox [data-scene="off"]').getAttribute('aria-pressed') === 'true';
              const reminderProbeIndex = CARDS.findIndex(card => card.target === '器');
              const reminderProbeKey = cardKey(reminderProbeIndex);
              const reminderProbeMemory = cloneObj(memory);
              memory = { [reminderProbeKey]: { seen: 1, dueDay: today(), pendingLearning: false, lastOutcome: 'miss', misses: 2, ease: 24, last: Date.now() } };
              const reminderProbe = reminderQuestions(2);
              syncReminder();
              result.dataFlow.reminderQuestionPayload = reminderProbe.length === 2 && reminderProbe[0].targetCardKey === reminderProbeKey && reminderDebug.lastSync.targetCardKey === reminderProbeKey && reminderDebug.lastSync.body.includes('点开写写看');
              memory = reminderProbeMemory;
              const reminderBeforeCalibrationInvite = cloneObj(reminder);
              const pendingBeforeCalibrationInvite = reminderPendingEnable;
              const requestReminderPermissionBeforeSmoke = requestReminderPermission;
              const summaryDisplayBeforeCalibrationInvite = document.getElementById('summary').style.display;
              const calibrationDisplayBeforeInvite = document.getElementById('calibCard').style.display;
              let calibrationPermissionRequested = false;
              requestReminderPermission = () => { calibrationPermissionRequested = true; };
              reminder = normalizeReminder(null);
              document.getElementById('summary').style.display = 'flex';
              document.getElementById('calibCard').style.display = 'flex';
              renderCalibrationReturnHook();
              result.dataFlow.calibrationReturnInviteVisible = visible('calibReturnHook') && visible('calibReminderYes');
              document.getElementById('calibReminderYes').onclick();
              result.dataFlow.calibrationReturnPermissionRequested = calibrationPermissionRequested && reminderPendingEnable && reminder.promptDismissed;
              document.getElementById('summary').style.display = summaryDisplayBeforeCalibrationInvite;
              document.getElementById('calibCard').style.display = calibrationDisplayBeforeInvite;
              requestReminderPermission = requestReminderPermissionBeforeSmoke;
              reminder = normalizeReminder(reminderBeforeCalibrationInvite);
              reminderPendingEnable = pendingBeforeCalibrationInvite;
              saveReminder();
            }

            if (typeof roundSummary === 'function' && typeof markPracticeStamp === 'function') {
              const completionState = {
                activity: cloneObj(activity), reminder: cloneObj(reminder), tuning: cloneObj(tuning), activeMode,
                baseTargets: baseTargets.slice(), batch: batch.slice(), baseCursor, roundStats: cloneObj(roundStats),
                roundId, practicePhase, unresolved: [...unresolved]
              };
              const completionTargets = indexesForChars(['强', '器', '疑']);
              activity = newActivity();
              activity.inheritedStreak = 0;
              activity.inheritedTotalDays = 0;
              activity.daily = {};
              activity.practiceDays = [];
              reminder.milestonesShown = [];
              reminder.characterMilestonesShown = CHARACTER_MILESTONES.slice();
              reminder.characterMilestoneDay = '';
              tuning = { calibrated: true, offset: 0, contextStrict: 0, rounds: [] };
              activeMode = 'new';
              baseTargets = completionTargets.slice(0, 2);
              batch = baseTargets;
              baseCursor = baseTargets.length;
              unresolved = new Set();
              practicePhase = 'between';
              roundStats = baseTargets.map((idx, position) => ({ idx, target: CARDS[idx].target, outcome: position === 0 ? 'hinted' : 'fast', independentlyRecovered: position === 0, handwriting: [[{ x: 0.22, y: 0.25 }, { x: 0.44, y: 0.5 }, { x: 0.72, y: 0.68 }]] }));
              roundId = 'native-smoke-milestone';
              baseTargets.forEach(idx => markPracticeStamp(idx));
              hapticDebug.events = [];
              hapticDebug.last = null;
              roundSummary(true);
              await waitFor(() => hapticDebug.events.length === 1);
              result.practiceFlow.hapticMilestoneSequence = hapticDebug.events.slice();
              result.practiceFlow.summaryPocketVisible = visible('pocketCard') && summaryFocusIndexes.length === 1 && document.getElementById('pocketBtn').textContent.includes('马上再拾');
              const shareCanvas = renderPracticeCardCanvas();
              const shareSource = `${renderPracticeCardCanvas}\n${drawShareHandwriting}`;
              result.dataFlow.shareCardGenerated = !!shareCanvas && shareCanvas.width === 1080 && shareCanvas.height === 1440 && Number(shareCanvas.dataset.inkStrokeCount) === 2 && shareCanvas.toDataURL('image/png').startsWith('data:image/png;base64,') && !shareSource.includes('fillText(stat.target');
              result.dataFlow.shareCardPrivate = !/localStorage|memory|activity|backup|seenStat|riskStat/.test(shareSource);
              result.dataFlow.calendarAvailable = typeof renderCalendar === 'function' && typeof startMakeupDay === 'function' && !!document.getElementById('meCalendar') && !!document.getElementById('makeupSheet');
              const monthlyCanvas = await renderMonthlyPostCanvas(today().slice(0, 7));
              result.dataFlow.monthlyPostGenerated = !!monthlyCanvas && monthlyCanvas.width === 1080 && monthlyCanvas.height === 1440 && Number(monthlyCanvas.dataset.itemCount) >= 2 && monthlyCanvas.toDataURL('image/png').startsWith('data:image/png;base64,');
              result.dataFlow.annualReportAvailable = typeof yearReportData === 'function' && typeof renderAnnualReport === 'function' && !!document.getElementById('annualPanel') && !!document.getElementById('annualSlides');
              result.dataFlow.recentInkBounded = RECENT_INK_MAX === 96 && RECENT_INK_BUDGET === 420 * 1024 && typeof trimRecentInk === 'function';

              baseTargets = completionTargets.slice(2);
              batch = baseTargets;
              baseCursor = baseTargets.length;
              unresolved = new Set();
              practicePhase = 'between';
              roundStats = baseTargets.map(idx => ({ idx, target: CARDS[idx].target, outcome: 'fast', independentlyRecovered: false }));
              roundId = 'native-smoke-ordinary';
              baseTargets.forEach(idx => markPracticeStamp(idx));
              hapticDebug.events = [];
              hapticDebug.last = null;
              roundSummary(true);
              await waitFor(() => hapticDebug.events.length === 1);
              result.practiceFlow.hapticOrdinaryCompletionSequence = hapticDebug.events.slice();

              activity = normalizeActivity(completionState.activity);
              reminder = normalizeReminder(completionState.reminder);
              tuning = completionState.tuning;
              activeMode = completionState.activeMode;
              baseTargets = completionState.baseTargets;
              batch = completionState.batch;
              baseCursor = completionState.baseCursor;
              roundStats = completionState.roundStats;
              roundId = completionState.roundId;
              practicePhase = completionState.practicePhase;
              unresolved = new Set(completionState.unresolved);
              saveActivity();
              saveReminder();
              saveTuning();
              renderHome();
            }

            if (typeof startMode === 'function' && typeof revealAnswer === 'function' && typeof pickStamp === 'function') {
              if (typeof clearSessionSnapshot === 'function') clearSessionSnapshot();
              Object.values(memory).forEach(item => { if (item) item.queuedFront = false; });
              saveMemory();
              const smokeTargets = indexesForChars(['器', '疑', '强']);
              startFocus(smokeTargets);
              await waitFor(() => Array.isArray(batch) && batch.length > 2 && visible('card'));
              await waitFor(() => !document.getElementById('show').disabled && !document.getElementById('done').disabled);
              result.practiceFlow.started = true;
              result.practiceFlow.batchSize = Array.isArray(batch) ? batch.length : 0;
              result.practiceFlow.cardVisible = visible('card');
              result.practiceFlow.showEnabled = !document.getElementById('show').disabled;
              result.practiceFlow.doneEnabled = !document.getElementById('done').disabled;
              result.practiceFlow.noNextButton = !document.getElementById('nextBtn');
              result.practiceFlow.posLabelBefore = document.getElementById('posLabel').textContent;

              await new Promise(resolve => setTimeout(resolve, 350));
              const cardRect = document.getElementById('card').getBoundingClientRect();
              const actionRect = document.getElementById('actions').getBoundingClientRect();
              const practiceViewport = window.visualViewport;
              const practiceTop = practiceViewport ? practiceViewport.offsetTop : 0;
              const practiceBottom = practiceViewport ? practiceViewport.offsetTop + practiceViewport.height : window.innerHeight;
              result.layoutFlow.practiceFixed = getComputedStyle(document.getElementById('card')).position === 'fixed';
              result.layoutFlow.practiceActionsInViewport = cardRect.top >= practiceTop - 1 && cardRect.bottom <= practiceBottom + 1 && actionRect.bottom <= practiceBottom + 1;
              result.layoutFlow.practiceMetrics = {
                innerHeight: window.innerHeight,
                viewportTop: practiceTop,
                viewportBottom: practiceBottom,
                cardTop: cardRect.top,
                cardBottom: cardRect.bottom,
                actionTop: actionRect.top,
                actionBottom: actionRect.bottom,
                boxBottom: document.getElementById('boxwrap').getBoundingClientRect().bottom
              };

              result.handwritingFlow.pointerEventsSupported = typeof PointerEvent === 'function';
              let dispatchStroke = null;
              let pixelCount = () => 0;
              if (result.handwritingFlow.pointerEventsSupported && inkCanvas && inkCtx && typeof clearInk === 'function') {
                clearInk();
                pixelCount = () => {
                  const pixels = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data;
                  let count = 0;
                  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) count++;
                  return count;
                };
                let pointerID = 4242;
                dispatchStroke = () => {
                  const rect = inkCanvas.getBoundingClientRect();
                  const points = [
                    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.30 },
                    { x: rect.left + rect.width * 0.40, y: rect.top + rect.height * 0.42 },
                    { x: rect.left + rect.width * 0.56, y: rect.top + rect.height * 0.54 },
                    { x: rect.left + rect.width * 0.72, y: rect.top + rect.height * 0.66 }
                  ];
                  const id = pointerID++;
                  const pointer = (type, point, buttons) => new PointerEvent(type, {
                    bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true,
                    button: 0, buttons, clientX: point.x, clientY: point.y
                  });
                  const downPrevented = !inkCanvas.dispatchEvent(pointer('pointerdown', points[0], 1));
                  let movesPrevented = true;
                  for (let i = 1; i < points.length; i++) movesPrevented = !inkCanvas.dispatchEvent(pointer('pointermove', points[i], 1)) && movesPrevented;
                  inkCanvas.dispatchEvent(pointer('pointerup', points[points.length - 1], 0));
                  return { downPrevented, movesPrevented };
                };
                const scrollBefore = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
                const pixelsBefore = pixelCount();
                result.handwritingFlow.touchActionNone = getComputedStyle(inkCanvas).touchAction === 'none';
                const dispatched = dispatchStroke();
                result.handwritingFlow.pointerDownPrevented = dispatched.downPrevented;
                result.handwritingFlow.pointerMovePrevented = dispatched.movesPrevented;
                result.handwritingFlow.actionCooldownActive = document.getElementById('actions').classList.contains('tlock');
                const touchProbe = new Event('touchmove', { bubbles: true, cancelable: true });
                inkCanvas.dispatchEvent(touchProbe);
                result.handwritingFlow.touchMovePrevented = touchProbe.defaultPrevented;
                result.handwritingFlow.strokeRecorded = inkStrokes.length === 1;
                result.handwritingFlow.strokePointCount = inkStrokes.length ? inkStrokes[0].length : 0;
                result.handwritingFlow.brushRendererAvailable = typeof paintBrushStroke === 'function' && typeof brushWidthFor === 'function';
                result.handwritingFlow.brushMetadataRecorded = inkStrokes.length === 1 && inkStrokes[0].every(point => Number.isFinite(point.w) && Number.isFinite(point.v));
                const sharedBrush = shareInkFromSnapshot({ canvasSize: S, inkStrokes });
                result.handwritingFlow.brushShareMetadata = sharedBrush.length === 1 && sharedBrush[0].every(point => Number.isFinite(point.w) && Number.isFinite(point.v));
                result.handwritingFlow.inkPixelsChanged = pixelCount() > pixelsBefore;
                const scrollAfter = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
                result.handwritingFlow.pageScrollStable = scrollAfter === scrollBefore;
                undoInkStroke();
                result.handwritingFlow.undoStrokeWorked = inkStrokes.length === 0 && pixelCount() === 0;
                dispatchStroke();
                await new Promise(resolve => setTimeout(resolve, 340));
                clearInk();
                result.handwritingFlow.clearWorked = inkStrokes.length === 0 && pixelCount() === 0;
                const peekControl = document.getElementById('tip');
                await waitFor(() => !peekControl.disabled && peekEl && peekEl.querySelector('path'));
                result.handwritingFlow.peekControlVisible = visible('tip') && peekControl.textContent.trim() === '点拨';
                const showControl = document.getElementById('show');
                const doneControl = document.getElementById('done');
                result.handwritingFlow.actionLabelsDirect = visible('show') && visible('done')
                  && showControl.textContent.trim() === '不会写'
                  && showControl.getAttribute('aria-label').startsWith('不会写：')
                  && doneControl.textContent.trim() === '写好了'
                  && doneControl.getAttribute('aria-label') === '写好了';
                const hintBeforePeek = { ever: hintEverUsed, used: hintsUsedThisCard, group: groupIdx, shown: shownStrokes };
                const controlRect = peekControl.getBoundingClientRect();
                const controlPointer = (type, buttons) => new PointerEvent(type, {
                  bubbles: true, cancelable: true, pointerId: 7000, pointerType: 'touch', isPrimary: true,
                  button: 0, buttons, clientX: controlRect.left + 20, clientY: controlRect.top + 20
                });
                peekControl.dispatchEvent(controlPointer('pointerdown', 1));
                await new Promise(resolve => setTimeout(resolve, 420));
                result.handwritingFlow.peekControlEntered = peeking === true && peekEl.classList.contains('active') && Number(inkCanvas.style.opacity) <= 0.06;
                result.handwritingFlow.peekControlGlyphVisible = peekEl.querySelectorAll('path').length > 0;
                peekControl.dispatchEvent(controlPointer('pointerup', 0));
                peekControl.click();
                result.handwritingFlow.peekControlUncounted = peeking === false && !peekEl.classList.contains('active')
                  && hintBeforePeek.ever === hintEverUsed && hintBeforePeek.used === hintsUsedThisCard
                  && hintBeforePeek.group === groupIdx && hintBeforePeek.shown === shownStrokes;
                const peekRect = inkCanvas.getBoundingClientRect();
                const peekPointer = (type, id, isPrimary, x, y, buttons) => new PointerEvent(type, {
                  bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary,
                  button: 0, buttons, clientX: peekRect.left + peekRect.width * x, clientY: peekRect.top + peekRect.height * y
                });
                inkCanvas.dispatchEvent(peekPointer('pointerdown', 7001, true, 0.25, 0.30, 1));
                inkCanvas.dispatchEvent(peekPointer('pointermove', 7001, true, 0.48, 0.50, 1));
                const partialPixels = pixelCount();
                inkCanvas.dispatchEvent(peekPointer('pointerdown', 7002, false, 0.72, 0.68, 1));
                result.handwritingFlow.peekEntered = peeking === true && Number(inkCanvas.style.opacity) <= 0.06 && hzEl.classList.contains('peekHint');
                result.handwritingFlow.peekCancelledPartialStroke = partialPixels > 0 && drawing === false && curInkStroke === null && pixelCount() === 0;
                result.handwritingFlow.peekActionsUnlocked = !document.getElementById('actions').classList.contains('tlock') && Number(getComputedStyle(document.getElementById('actions')).opacity) === 1;
                inkCanvas.dispatchEvent(peekPointer('pointermove', 7001, true, 0.62, 0.62, 1));
                inkCanvas.dispatchEvent(peekPointer('pointermove', 7002, false, 0.78, 0.74, 1));
                result.handwritingFlow.peekBlockedInk = inkStrokes.length === 0 && curInkStroke === null && pixelCount() === 0;
                inkCanvas.dispatchEvent(peekPointer('pointerup', 7002, false, 0.78, 0.74, 0));
                result.handwritingFlow.peekRestored = peeking === false && Number(inkCanvas.style.opacity) === 1 && !hzEl.classList.contains('peekHint');
                inkCanvas.dispatchEvent(peekPointer('pointerup', 7001, true, 0.62, 0.62, 0));
                await new Promise(resolve => setTimeout(resolve, 340));
                clearInk();
                dispatchStroke();
                await new Promise(resolve => setTimeout(resolve, 340));
              }

              await waitFor(() => Array.isArray(curMedians) && curMedians.length > 0);
              hapticDebug.events = [];
              hapticDebug.last = null;
              await document.getElementById('tip').onclick();
              result.practiceFlow.hapticSelectTipRecorded = hapticDebug.last === 'select';
              const firstIndex = currentCardIndex();
              const firstAttempt = currentAttemptId;
              const firstKey = cardKey(firstIndex);
              const firstMemoryBefore = JSON.stringify(memory[firstKey] || null);
              const firstStatusBefore = status[firstIndex];
              const activityBefore = todayStampCount();
              const attemptsBefore = dailyActivity().attempts;
              const fsrsBefore = fsrsReviewLog.length;
              const firstNextIndex = baseTargets[1];
              const nextMemoryBefore = JSON.stringify(memory[cardKey(firstNextIndex)] || null);
              inkStrokes = mediansToCanvas(curMedians.slice(shownStrokes));
              redrawInk();
              unlockGradeActions();
              if (!revealAnswer()) {
                throw new Error(`Reveal probe rejected: revealed=${revealed}, animating=${animating}, cooldown=${actionCooldownUntil}, ink=${inkStrokes.length}`);
              }
              await waitFor(() => visible('reveal'));
              result.practiceFlow.hapticActionRevealRecorded = hapticDebug.last === 'action';
              result.practiceFlow.revealVisible = true;
              const comparisonBoxes = Array.from(document.querySelectorAll('.cmpBox'));
              result.practiceFlow.comparisonGridComplete = comparisonBoxes.length === 2 && comparisonBoxes.every((box) => ['cx', 'cy', 'd1', 'd2'].every((name) => !!box.querySelector(`.${name}`)));
              const standardSkeleton = document.querySelector('#rightHz svg');
              const overlaySkeleton = document.querySelector('#mineOverlay svg');
              result.practiceFlow.comparisonSkeletonVisible = !!standardSkeleton && document.querySelectorAll('#rightHz svg path').length === curMedians.length;
              result.practiceFlow.comparisonCoordinatesAligned = !!standardSkeleton && !!overlaySkeleton && standardSkeleton.getAttribute('viewBox') === overlaySkeleton.getAttribute('viewBox');
              result.practiceFlow.decisionVisible = visible('decisionRow');
              result.practiceFlow.functionalDecisionLabels = document.getElementById('decisionCorrect').textContent.includes('写对了') && document.getElementById('decisionWrong').textContent.includes('写错了');
              result.practiceFlow.selfAssessmentControls = visible('uncertainAction') && document.getElementById('decisionUncertain').textContent.includes('记不清') && !visible('softConfirm');
              result.practiceFlow.submissionSnapshotComplete = submissionSnapshot.hintStrokeIds.length > 0 && submissionSnapshot.compositeGeometry.length === submissionSnapshot.hintStrokes.length + submissionSnapshot.inkStrokes.length && submissionSnapshot.lastVerdict.status === 'ok';

              soundDebug.events = [];
              soundDebug.last = null;
              decideSubmission(true);
              await waitFor(() => stamped && visible('stampedToast'));
              result.practiceFlow.feedbackHeld = currentAttemptId === firstAttempt && document.getElementById('stampedToast').textContent.includes('本组稍后再写');
              result.practiceFlow.reminderSyncAfterStamp = !!(reminderDebug.lastSync && reminderDebug.lastSync.type === 'syncReminder' && reminderDebug.lastSync.practicedToday === true);
              result.practiceFlow.hapticStampRecorded = hapticDebug.last === 'stamp';
              result.practiceFlow.soundStampRecorded = soundDebug.last === 'stamp' && soundDebug.events.join() === 'stamp';
              result.practiceFlow.hapticHintedSequence = hapticDebug.events.slice();
              result.practiceFlow.outcome = roundStats.length ? roundStats[0].outcome : '';
              const firstFSRSEvents = fsrsReviewLog.slice(fsrsBefore);
              result.practiceFlow.fsrsAgainOnly = firstFSRSEvents.length === 1 && firstFSRSEvents[0].rating === 'Again' && firstFSRSEvents[0].reason === 'hinted';
              hapticDebug.events = [];
              hapticDebug.last = null;
              reopenStampChoices();
              await waitFor(() => visible('reveal') && practicePhase === 'revealDecision');
              result.practiceFlow.undoRollback = roundStats.length === 0 && fsrsReviewLog.length === fsrsBefore && JSON.stringify(memory[firstKey] || null) === firstMemoryBefore && status[firstIndex] === firstStatusBefore;
              result.practiceFlow.undoActivityRollback = todayStampCount() === activityBefore && dailyActivity().attempts === attemptsBefore;
              result.practiceFlow.hapticUndoRecorded = hapticDebug.last === 'undo';
              result.practiceFlow.hapticUndoSequence = hapticDebug.events.slice();
              result.practiceFlow.nextCardUntouched = JSON.stringify(memory[cardKey(firstNextIndex)] || null) === nextMemoryBefore;

              decideSubmission(true);
              await waitFor(() => currentAttemptId !== firstAttempt && visible('card'));
              result.practiceFlow.immediateAdvanced = true;
              result.practiceFlow.undoBarFollowed = visible('undoBar');
              result.practiceFlow.posLabelAfter = document.getElementById('posLabel').textContent;
              await waitFor(() => Array.isArray(curMedians) && curMedians.length > 0 && !document.getElementById('show').disabled);
              traceTutorialShown = false;
              save(TRACE_TUTORIAL_KEY, false);
              hapticDebug.events = [];
              hapticDebug.last = null;
              const eventsBeforeTeaching = fsrsReviewLog.length;
              declareDontKnow();
              await waitFor(() => practicePhase === 'tracing' && visible('traceActions'));
              await waitFor(() => {
                const svg = hzEl.querySelector('svg');
                if (hzEl.classList.contains('traceFallback')) return hzEl.textContent.trim() === cur.target;
                if (!svg) return false;
                const box = svg.getBoundingClientRect();
                return box.width > 200 && box.height > 200 && Array.from(svg.querySelectorAll('path')).some(node => (node.getAttribute('d') || '').length > 0);
              });
              result.practiceFlow.hapticSelectTracingRecorded = hapticDebug.last === 'select';
              result.practiceFlow.hapticDontKnowSequence = hapticDebug.events.slice();
              result.practiceFlow.traceTutorialVisible = visible('traceIntro') && document.getElementById('traceIntro').textContent.includes('接着答案会隐藏');
              result.practiceFlow.traceModeVisible = visible('traceActions') && !visible('actions');
              const traceLayer = hzEl;
              const traceSVG = traceLayer.querySelector('svg');
              const traceBox = traceSVG ? traceSVG.getBoundingClientRect() : null;
              result.practiceFlow.traceOutlineVisible = (traceLayer.classList.contains('traceFallback') && traceLayer.textContent.trim() === cur.target) || !!(traceSVG && traceBox.width > 200 && traceBox.height > 200 && Array.from(traceSVG.querySelectorAll('path')).some(node => (node.getAttribute('d') || '').length > 0));
              result.practiceFlow.traceRequiresInk = document.getElementById('traceDone').disabled;
              soundDebug.events = [];
              soundDebug.last = null;
              lastPaperSoundAt = 0;
              if (dispatchStroke) {
                dispatchStroke();
                await new Promise(resolve => setTimeout(resolve, 340));
              }
              result.practiceFlow.traceReadyAfterInk = tracedThisCard === true && !document.getElementById('traceDone').disabled;
              result.practiceFlow.soundPaperRecorded = soundDebug.last === 'paper' && soundDebug.events.join() === 'paper';
              hapticDebug.events = [];
              hapticDebug.last = null;
              finishTracing();
              await waitFor(() => practicePhase === 'postTraceRecall');
              result.practiceFlow.hapticTraceCompletionSequence = hapticDebug.events.slice();
              result.practiceFlow.postTraceRecall = document.getElementById('phaseTitle').textContent.includes('2/2 自己写') && getComputedStyle(document.getElementById('tip')).display === 'none' && document.getElementById('show').textContent === '再描一遍';
              result.practiceFlow.hapticTraceNoReview = fsrsReviewLog.length === eventsBeforeTeaching + 1 && fsrsReviewLog[fsrsReviewLog.length - 1].rating === 'Again';
              const practiceDay = dailyActivity();
              result.practiceFlow.activityRecorded = todayStampCount() >= activityBefore && practiceDay.attempts === attemptsBefore + 2 && practiceDay.targetKeys.includes(firstKey) && practiceDay.targetKeys.includes(cardKey(currentCardIndex())) && activity.practiceDays.includes(today());
              const storedSession = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
              result.practiceFlow.sessionSnapshotStored = !!storedSession && storedSession.version === 2 && storedSession.practicePhase === 'postTraceRecall' && storedSession.unresolved.length === 2;
              result.practiceFlow.historyGuardArmed = practiceHistoryArmed === true && history.state && history.state.shiziView === 'practice';

              if (typeof exitCurrentRound === 'function') {
                result.exitFlow.roundStatsBeforeExit = roundStats.length;
                result.exitFlow.positionBeforeExit = baseCursor;
                result.exitFlow.historyInitialLength = history.length;
                const phaseBeforeSwipe = practicePhase;
                const attemptBeforeSwipe = currentAttemptId;
                let directStatePreserved = true;
                for (let attempt = 0; attempt < 3; attempt++) {
                  window.dispatchEvent(new Event('shizi-native-back'));
                  await waitFor(() => visible('home') && practiceHistoryArmed === false && history.state && history.state.shiziView === 'home');
                  const resume = resumableSession();
                  const statePreserved = history.length === result.exitFlow.historyInitialLength
                    && history.state && history.state.shiziView === 'home'
                    && !!resume && resume.version === 2
                    && resume.practicePhase === phaseBeforeSwipe
                    && resume.currentAttemptId === attemptBeforeSwipe
                    && resume.roundStats.length === result.exitFlow.roundStatsBeforeExit;
                  directStatePreserved = directStatePreserved && statePreserved;
                  result.exitFlow.directReturnCount += 1;
                  result.exitFlow.nativeEdgeBackEvent = true;
                  if (attempt < 2) {
                    restoreSession(resume);
                    await waitFor(() => visible('card') && practicePhase === phaseBeforeSwipe && practiceHistoryArmed === true);
                  }
                }
                result.exitFlow.historyLengthStable = history.length === result.exitFlow.historyInitialLength;
                result.exitFlow.directReturnStatePreserved = directStatePreserved;
                await new Promise(resolve => setTimeout(resolve, 120));
                result.exitFlow.returnedHome = visible('home');
                result.exitFlow.practiceHidden = !visible('card');
                result.exitFlow.footVisible = visible('foot');
                result.exitFlow.roundStatsAfterExit = roundStats.length;
                result.exitFlow.roundStatsUnchanged = result.exitFlow.roundStatsAfterExit === result.exitFlow.roundStatsBeforeExit;
                const resume = resumableSession();
                result.exitFlow.directReturnSaved = !!resume && resume.version === 2
                  && history.length === result.exitFlow.historyInitialLength
                  && history.state && history.state.shiziView === 'home';
                result.exitFlow.noExitSheet = !document.getElementById('exitSheet') && !document.body.textContent.includes('退出本组？');
                history.back();
                await new Promise(resolve => setTimeout(resolve, 120));
                result.exitFlow.homeBackNoop = visible('home')
                  && practiceHistoryArmed === false
                  && history.length === result.exitFlow.historyInitialLength
                  && history.state && history.state.shiziView === 'home';
                result.practiceFlow.resumeHomeState = !!resume && resume.version === 2 && document.getElementById('startBtn').textContent === '续';
                restoreSession(resume);
                await waitFor(() => visible('card') && practicePhase === 'postTraceRecall');
                result.practiceFlow.resumeRestored = roundStats.length === 2 && document.getElementById('phaseTitle').textContent.includes('2/2 自己写');
                exitCurrentRound();
                await waitFor(() => visible('home'));
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
        activity.completionWithItemsHandler = { [weak self] _, completed, _, _ in
            guard completed else { return }
            self?.webView.evaluateJavaScript("if (typeof markBackupExported === 'function') markBackupExported(); void 0;")
        }
        if let popover = activity.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(activity, animated: true)
    }

    private func sharePracticeCard(filename: String, dataURL: String) {
        guard presentedViewController == nil else { return }
        guard
            dataURL.hasPrefix("data:image/png;base64,"),
            let comma = dataURL.firstIndex(of: ","),
            let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
            data.count <= 12 * 1024 * 1024,
            data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        else {
            presentError(message: "字帖图片生成失败，请稍后再试。")
            return
        }

        let safeStem = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
        let safeName = safeStem.lowercased().hasSuffix(".png") ? safeStem : "\(safeStem).png"
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try data.write(to: fileURL, options: .atomic)
        } catch {
            presentError(message: "字帖图片生成失败，请稍后再试。")
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
        pageReady = true
        dispatchPendingReminderTargetIfReady()
        runNativeSmokeIfNeeded()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        nativeSmokeDidRun = false
        pageReady = false
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
        guard presentedViewController == nil else {
            completionHandler()
            return
        }
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

        guard presentedViewController == nil else {
            completionHandler(false)
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
        guard presentedViewController == nil else {
            completionHandler(nil)
            return
        }
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
        case "sharePracticeCard":
            let name = body["name"] as? String ?? "shizi-card.png"
            let dataURL = body["dataURL"] as? String ?? ""
            sharePracticeCard(filename: name, dataURL: dataURL)
        case "savePracticeCard":
            let dataURL = body["dataURL"] as? String ?? ""
            savePracticeCard(dataURL: dataURL)
        case "pickBackup":
            presentBackupPicker()
        case "nativeSmokeResult":
            let payload = body["payload"] as? String ?? #"{"error":"Missing native smoke payload"}"#
            writeNativeSmokeResult(payload)
        case "haptic":
            playHaptic(kind: body["kind"] as? String ?? "")
        case "sound":
            playPaperSound(kind: body["kind"] as? String ?? "")
        case "soundscape":
            configureAmbientAudioSession()
        case "syncReminder":
            syncReminder(body: body)
        case "requestReminderPermission":
            requestReminderPermission()
        case "queryReminderStatus":
            sendReminderStatus()
        case "recognizeChars":
            let dataURL = body["dataURL"] as? String ?? ""
            let requestID = (body["requestId"] as? NSNumber)?.intValue ?? 0
            recognizeChars(dataURL: dataURL, requestID: requestID)
        default:
            break
        }
    }
}

extension WebViewController {
    private func practiceCardImage(dataURL: String) -> UIImage? {
        guard
            dataURL.hasPrefix("data:image/png;base64,"),
            let comma = dataURL.firstIndex(of: ","),
            let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
            data.count <= 12 * 1024 * 1024,
            data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        else {
            return nil
        }
        return UIImage(data: data)
    }

    private func savePracticeCard(dataURL: String) {
        guard let image = practiceCardImage(dataURL: dataURL) else {
            sendPracticeCardSaveResult(false)
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else {
                self?.sendPracticeCardSaveResult(false)
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, _ in
                self?.sendPracticeCardSaveResult(success)
            }
        }
    }

    private func sendPracticeCardSaveResult(_ success: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(
                "if (typeof window.shiziCardSaved === 'function') window.shiziCardSaved({success:\(success ? "true" : "false")}); void 0;"
            )
        }
    }
}

// MARK: - 拍字入盒：Vision 只返回候选，最终选字始终由 Web 端用户确认
extension WebViewController {
    private static func visionOrientation(for image: UIImage) -> CGImagePropertyOrientation {
        switch image.imageOrientation {
        case .up: .up
        case .down: .down
        case .left: .left
        case .right: .right
        case .upMirrored: .upMirrored
        case .downMirrored: .downMirrored
        case .leftMirrored: .leftMirrored
        case .rightMirrored: .rightMirrored
        @unknown default: .up
        }
    }

    private func recognizeChars(dataURL: String, requestID: Int) {
        guard
            dataURL.hasPrefix("data:image/"),
            let comma = dataURL.firstIndex(of: ","),
            let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
            data.count <= 64 * 1024,
            let image = UIImage(data: data),
            let cgImage = image.cgImage
        else {
            sendRecognizedChars([], requestID: requestID)
            return
        }

        let orientation = Self.visionOrientation(for: image)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["zh-Hans"]
            request.usesLanguageCorrection = true

            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:]).perform([request])
                let candidates = (request.results ?? []).flatMap { observation in
                    observation.topCandidates(3).map(\.string)
                }
                self?.sendRecognizedChars(candidates, requestID: requestID)
            } catch {
                self?.sendRecognizedChars([], requestID: requestID)
            }
        }
    }

    private func sendRecognizedChars(_ candidates: [String], requestID: Int) {
        let payload: [String: Any] = [
            "requestId": requestID,
            "candidates": candidates,
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let literal = String(data: data, encoding: .utf8)
        else {
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(
                "if (typeof window.shiziOCRResult === 'function') window.shiziOCRResult(\(literal)); void 0;"
            )
        }
    }
}

// MARK: - 纸墨声音：ambient 会随静音键静默，并与其他音频混合
extension WebViewController {
    private enum PaperSoundKind {
        case stamp
        case paper
    }

    private func configureAmbientAudioSession() {
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
    }

    private func makePaperSoundPlayer(kind: PaperSoundKind) -> AVAudioPlayer? {
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            let player = try AVAudioPlayer(data: Self.paperSoundData(kind: kind))
            player.prepareToPlay()
            return player
        } catch {
            return nil
        }
    }

    private func playPaperSound(kind: String) {
        let player: AVAudioPlayer?
        switch kind {
        case "stamp":
            player = stampSoundPlayer
        case "paper":
            player = paperSoundPlayer
        default:
            return
        }
        player?.currentTime = 0
        player?.play()
    }

    private static func paperSoundData(kind: PaperSoundKind) -> Data {
        let sampleRate: UInt32 = 22_050
        let duration = kind == .stamp ? 0.22 : 0.11
        let frameCount = Int(Double(sampleRate) * duration)
        var pcm = Data(capacity: frameCount * 2)
        var noiseState: UInt32 = kind == .stamp ? 194 : 73
        var filteredNoise = 0.0

        for index in 0..<frameCount {
            noiseState = noiseState &* 1_664_525 &+ 1_013_904_223
            let noise = Double(noiseState) / Double(UInt32.max) * 2 - 1
            let progress = Double(index) / Double(frameCount)
            let time = Double(index) / Double(sampleRate)
            let value: Double
            if kind == .stamp {
                filteredNoise = filteredNoise * 0.82 + noise * 0.18
                let envelope = pow(1 - progress, 2.8)
                value = (sin(2 * .pi * (82 + 22 * time) * time) * 0.58 + filteredNoise * 0.34) * envelope * 0.42
            } else {
                let envelope = pow(1 - progress, 1.4)
                value = (noise - filteredNoise) * envelope * 0.075
                filteredNoise = noise
            }
            let sample = Int16(clamping: Int(value * Double(Int16.max)))
            appendLittleEndian(sample, to: &pcm)
        }

        var wav = Data()
        wav.append(Data("RIFF".utf8))
        appendLittleEndian(UInt32(36 + pcm.count), to: &wav)
        wav.append(Data("WAVEfmt ".utf8))
        appendLittleEndian(UInt32(16), to: &wav)
        appendLittleEndian(UInt16(1), to: &wav)
        appendLittleEndian(UInt16(1), to: &wav)
        appendLittleEndian(sampleRate, to: &wav)
        appendLittleEndian(sampleRate * 2, to: &wav)
        appendLittleEndian(UInt16(2), to: &wav)
        appendLittleEndian(UInt16(16), to: &wav)
        wav.append(Data("data".utf8))
        appendLittleEndian(UInt32(pcm.count), to: &wav)
        wav.append(pcm)
        return wav
    }

    private static func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }
}

// MARK: - 触觉反馈：按记账、过程完成、选择切换分层；未知值忽略
extension WebViewController {
    private func playHaptic(kind: String) {
        switch kind {
        case "stamp":
            stampHaptic.impactOccurred()
            stampHaptic.prepare()
        case "undo":
            undoHaptic.impactOccurred()
            undoHaptic.prepare()
        case "action":
            actionHaptic.impactOccurred()
            actionHaptic.prepare()
        case "select":
            selectionHaptic.selectionChanged()
            selectionHaptic.prepare()
        case "milestone":
            milestoneHaptic.notificationOccurred(.success)
            milestoneHaptic.prepare()
        default:
            break
        }
    }
}

// MARK: - 练习提醒：native 是无状态执行器，开关/习惯时间/已练状态全部由 web 侧下发
extension WebViewController {
    private struct ReminderQuestion {
        let day: String
        let title: String
        let body: String
        let targetCardKey: String

        init?(_ value: [String: Any]) {
            guard
                let day = value["day"] as? String,
                let title = value["title"] as? String,
                let body = value["body"] as? String,
                let targetCardKey = value["targetCardKey"] as? String,
                !day.isEmpty,
                !title.isEmpty,
                !body.isEmpty,
                !targetCardKey.isEmpty
            else {
                return nil
            }
            self.day = day
            self.title = title
            self.body = body
            self.targetCardKey = targetCardKey
        }
    }

    private static let reminderIdentifierPrefix = "shizi.reminder."
    private static let reminderWindowDays = 7

    private func syncReminder(body: [String: Any]) {
        let enabled = body["enabled"] as? Bool ?? false
        let hour = (body["hour"] as? NSNumber)?.intValue ?? 20
        let minute = (body["minute"] as? NSNumber)?.intValue ?? 0
        let practicedToday = body["practicedToday"] as? Bool ?? false
        let questions = (body["questions"] as? [[String: Any]] ?? []).compactMap(ReminderQuestion.init)
        // 世代号防并发交错：快速开关时旧一轮的 remove/schedule 全部作废，只让最新一轮落地
        reminderSyncGeneration += 1
        let generation = reminderSyncGeneration
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { [weak self] requests in
            DispatchQueue.main.async {
                guard let self, generation == self.reminderSyncGeneration else { return }
                let ours = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderIdentifierPrefix) }
                center.removePendingNotificationRequests(withIdentifiers: ours)
                guard enabled, !questions.isEmpty else { return }
                center.getNotificationSettings { settings in
                    DispatchQueue.main.async {
                        guard generation == self.reminderSyncGeneration else { return }
                        // web 侧的 permission 可能来自换机恢复的备份，调度前以本机授权状态为准
                        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
                        Self.scheduleReminderWindow(hour: hour, minute: minute, practicedToday: practicedToday, questions: questions)
                    }
                }
            }
        }
    }

    // 每次同步最多预约接下来的 7 道题；没有有效目标的日期不发送。
    private static func scheduleReminderWindow(hour: Int, minute: Int, practicedToday: Bool, questions: [ReminderQuestion]) {
        let calendar = Calendar.current
        let now = Date()
        let center = UNUserNotificationCenter.current()
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let questionsByDay = Dictionary(questions.map { ($0.day, $0) }, uniquingKeysWith: { first, _ in first })
        var scheduled = 0
        for offset in 0...reminderWindowDays {
            if scheduled == reminderWindowDays { break }
            guard
                let day = calendar.date(byAdding: .day, value: offset, to: now),
                let fireDate = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)
            else { continue }
            if offset == 0 && (practicedToday || fireDate <= now) { continue }
            let dayKey = formatter.string(from: fireDate)
            guard let question = questionsByDay[dayKey] else { continue }
            scheduled += 1
            let content = UNMutableNotificationContent()
            content.title = question.title
            content.sound = .default
            content.body = question.body
            content.userInfo = ["targetCardKey": question.targetCardKey]
            let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let identifier = reminderIdentifierPrefix + dayKey
            center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
        }
    }

    private func requestReminderPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                self?.dispatchReminderStatus(granted ? "granted" : "denied")
            }
        }
    }

    private func sendReminderStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                status = "granted"
            case .denied:
                status = "denied"
            case .notDetermined:
                status = "unknown"
            @unknown default:
                status = "unknown"
            }
            DispatchQueue.main.async {
                self?.dispatchReminderStatus(status)
            }
        }
    }

    private func dispatchReminderStatus(_ status: String) {
        webView.evaluateJavaScript("if (typeof shiziReminderStatus === 'function') shiziReminderStatus({permission:'\(status)'}); void 0;")
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
