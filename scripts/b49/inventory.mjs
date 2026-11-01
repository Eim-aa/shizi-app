#!/usr/bin/env node
// B4.9 预备：JS / WKWebView 移除清单（只读盘点，不改、不删任何文件）。
//
// 依据：docs/engineering/v10/B3B4-原生化架构与计划.md §4.5 第 3–5 条、§6.2 B4.9 行、
// §10.x B3.F（「留着、不再起作用、留给 B4.9 删」）、B3Z-e2e映射.md、B4-单测转写清单.md。
//
// 用法：
//   node scripts/b49/inventory.mjs          人读清单，按 (a)–(f) 分类
//   node scripts/b49/inventory.mjs --json   机器可读 JSON（remove.sh 与文档取数用）
//
// 分类：
//   (a) 随包 Web 资产中要移出 App 包（及仓库，见各项 repo 说明）的文件 / 目录
//   (b) Swift 里要删除或简化的 Web 代码（逐 文件:行 + 一行理由）
//   (c) 把 Web/ 拷进包的构建阶段与脚本（含各断言应改成什么）
//   (d) 测试：node 参考实现测试 vs 仅网页测试、XCUITest 网页路径、QA 宿主网页分支
//   (e) 必须保留的（数据 / 字体 / 许可 / 声音——原生仍在读包内 Web/ 下的这些）
//   (f) PrivacyInfo / entitlements 里的 WebKit 条目（若有）
//
// 只读保证：本脚本只 stat / read，不写任何文件。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JSON_OUT = process.argv.includes('--json');

const rel = (p) => relative(ROOT, p).split('\\').join('/');
const exists = (p) => existsSync(join(ROOT, p));
const readRepo = (p) => readFileSync(join(ROOT, p), 'utf8');
const byteSize = (p) => {
  try { return statSync(join(ROOT, p)).size; } catch { return 0; }
};
const dirBytes = (p) => {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return 0;
  const st = statSync(abs);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const name of readdirSync(abs)) {
    const child = join(abs, name);
    const cs = statSync(child);
    sum += cs.isDirectory() ? dirBytes(join(p, name)) : cs.size;
  }
  return sum;
};
const countFiles = (p) => {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return 0;
  if (!statSync(abs).isDirectory()) return 1;
  let n = 0;
  for (const name of readdirSync(abs)) {
    if (statSync(join(abs, name)).isDirectory()) n += countFiles(join(p, name));
    else n += 1;
  }
  return n;
};
const mib = (b) => Math.round((b / (1024 * 1024)) * 100) / 100;

// ---------------------------------------------------------------------------
// (a) 随包 Web 资产：包内 Web/ 由 scripts/shell-manifest.txt（pnpm run build:manifest
//     生成）在构建期 rsync 进包（ios/ShiziApp/scripts/sync-web-assets.sh）。
//     B4.9 从包内删除 = §4.5 第 3 条点名的清单；仓库去留单独标注（§4.5 第 5 条 + D59 ④）。
// ---------------------------------------------------------------------------

const LEAVE_EXACT = new Set([
  'index.html', 'deck-data.js', 'core-strokes.js', 'sw.js', 'sw-manifest.js', 'manifest.webmanifest',
]);
const LEAVE_DIRS = ['src/', 'vendor/']; // src/ 只出包，仓库冻结保留（§4.5 第 5 条）
const ICON_RE = /^icon-[^/]+\.png$/;

function inventoryBundleAssets() {
  const manifestPath = 'scripts/shell-manifest.txt';
  const entries = exists(manifestPath)
    ? readRepo(manifestPath).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  const leave = [];
  const stay = [];
  for (const path of entries) {
    const isLeave =
      LEAVE_EXACT.has(path) ||
      LEAVE_DIRS.some((d) => path.startsWith(d)) ||
      (ICON_RE.test(path) && !path.includes('/'));
    const size = byteSize(path);
    const item = { path, bytes: size };
    if (isLeave) {
      item.bundle = '删除';
      item.repo = path.startsWith('src/')
        ? '留（冻结参考实现与测试先知，§4.5 第 5 条；本卡明确不删仓库 src/）'
        : '随 D59 ④：网页版不保留才删（remove.sh 需 --web-retired）';
      leave.push(item);
    } else {
      stay.push(item);
    }
  }
  const leaveBytes = leave.reduce((s, i) => s + i.bytes, 0);
  const totalBytes = leave.reduce((s, i) => s + i.bytes, 0) + stay.reduce((s, i) => s + i.bytes, 0);
  const groups = {};
  for (const item of leave) {
    const g = item.path.startsWith('src/') ? 'src/'
      : item.path.startsWith('vendor/') ? 'vendor/'
      : ICON_RE.test(item.path) ? 'PWA 图标' : '壳单文件';
    const cell = (groups[g] ??= { files: 0, bytes: 0 });
    cell.files += 1;
    cell.bytes += item.bytes;
  }
  return { manifest: manifestPath, manifestFiles: entries.length, totalBytes, leaveBytes, groups, leave, stay };
}

// ---------------------------------------------------------------------------
// (b) Swift：对 ios/**/*.swift 扫描 Web 符号（卡面点名的词 + 惰性遗留物），
//     每个命中给 文件:行 + 一行理由（理由按文件处置表给）。
// ---------------------------------------------------------------------------

const GREP_TERMS = [
  'WKWebView', 'evaluateJavaScript', 'callAsyncJavaScript', 'shiziNative',
  'WebEngine', 'webRaw', 'Web/', 'LocalWebSchemeHandler', 'shizi-resource',
  'snapshotURL', 'awaitReattach', 'takeUnclaimed',
];

// 文件（相对仓库根）→ { action, why }。action ∈ delete（整文件删）/ simplify（删分支、换引擎）/ keep（保留，说明为什么）。
const SWIFT_DISPOSITIONS = {
  'ios/ShiziApp/ShiziApp/WebViewController.swift': {
    action: 'delete',
    why: '窗口根 = WKWebView 宿主（:99 加载 shizi-resource://app）。B4.9 换原生窗口根后整文件删；先搬走仍在用的职责：声音播放（:976–978 读 Web/assets/sound）、提醒深链派发 openReminderTarget（AppDelegate 调）、备份导出回调 markBackupExported、字号 / 外观 / 读屏环境注入',
  },
  'ios/ShiziApp/ShiziApp/LocalWebSchemeHandler.swift': {
    action: 'delete',
    why: 'shizi-resource:// 静态文件服务；store 路由（__native/store/v1 → NativeStoreBridge）与静态路由都随 WKWebView 删（§4.5 第 3 条点名）',
  },
  'ios/ShiziApp/ShiziApp/NativeStoreBridge.swift': {
    action: 'delete',
    why: 'JS↔原生 SQLite 桥（同步 XHR 写入 + localStorage 迁移）；B4.4 Swift Store 已接管写入，桥随 WebEngine 退场（转写清单：native-store.test.mjs「B4.9 随 WebEngine 退场」）',
  },
  'ios/ShiziApp/ShiziApp/NativeWriteBridge.swift': {
    action: 'delete',
    why: '写字 / 结果会话桥（window.shiziNativeWrite / shiziNativeNav 经 callAsyncJavaScript）；§4.5 第 3 条点名删除，SwiftEngine 直接实现同一组 op',
  },
  'ios/ShiziApp/ShiziApp/NativeInkSpike.swift': {
    action: 'delete',
    why: 'DEBUG 书写面 spike（B2 前期）：把原生墨层叠在 WKWebView 页面上（evaluateJavaScript 注入 __shiziNativeInk）；写字页全原生后被 NativeWrite 取代，页面没了即无意义',
  },
  'ios/ShiziApp/ShiziWriteTests/NativeWriteBridgeTests.swift': {
    action: 'delete',
    why: '只测 NativeWriteBridge 与页面的桥往返（等 window.shiziNativeWrite 就绪、真 callAsyncJavaScript），桥删则用例删',
  },
  'ios/ShiziApp/ShiziApp/ShiziKit/ShiziEngine.swift': {
    action: 'simplify',
    why: '删 WebEngine 实现（MARK: - WebEngine 起至文件尾）与 webRaw 的 image.spec / image.persist 网页回退（B4.6 的「原生失败回退网页」）；保留 ShiziEngine 协议（SwiftEngine 实现它）',
  },
  'ios/ShiziApp/ShiziApp/NativeStage.swift': {
    action: 'simplify',
    why: 'let engine: WebEngine 换 SwiftEngine；删 B3.F 惰性遗留：snapshotURL（截图 data URL 不再显示）、NativeNavState 的重载认领字段（awaitReattach / takeUnclaimed / reattachWait）、__shiziNative* 注入脚本随页面删',
  },
  'ios/ShiziApp/ShiziApp/NativeSmoke.swift': {
    action: 'simplify',
    why: '网页冒烟部分（?test=1、__shiziNativeDev 注入、shiziNative 消息脚本、evaluateJavaScript 事件注入）随页面删；原生冒烟若还需探针改走原生通道',
  },
  'ios/ShiziApp/ShiziApp/NativeQAHarness.swift': {
    action: 'simplify',
    why: 'QA 宿主网页分支删（callAsyncJavaScript 网页摘要 :68/:1079）；「窗口里除 WKWebView 外」的遍历过滤（:144/:152/:194/:522）在无 WKWebView 后恒真，条件删',
  },
  'ios/ShiziApp/ShiziApp/QAFixtures.swift': {
    action: 'simplify',
    why: 'QA 夹具经 webView.callAsyncJavaScript 注入（qaRunJS :110、qaWebStrokes :267）随页面删，夹具注入改原生通道',
  },
  'ios/ShiziApp/ShiziApp/Screens/Backup.swift': {
    action: 'simplify',
    why: 'qaPickFile（:802）从网页 window.__qaBackupPick 取测试文件（qaFileMode）；改原生测试钩子，qaFileMode 一并删',
  },
  'ios/ShiziApp/ShiziApp/Screens/ImagePreview.swift': {
    action: 'simplify',
    why: 'refreshPresentingResult（:1242）经 (engine as? WebEngine)?.webView + NativeWriteBridge 重取结果视图；B4.8 起改 engine.raw("result")（SwiftEngine 页面 API），回退分支删',
  },
  'ios/ShiziApp/ShiziApp/Screens/Detail.swift': {
    action: 'simplify',
    why: '「练这个字」前 WebViewController.snapshotURL(:704) 给 stage.cover 截图（B3.F 起截图 url 已不显示，只留让开记账）；B4.9 连 stage.cover 一起删',
  },
  'ios/ShiziApp/ShiziApp/NativeGlyph.swift': {
    action: 'keep',
    why: '仅注释说明包内 Web/data 与原生读同一批文件（sync-web-assets.sh），不改',
  },
  'ios/ShiziApp/ShiziApp/Screens/Home.swift': {
    action: 'simplify',
    why: '发 nav op 时带 WebViewController.snapshotURL(:1154) 给 stage.cover（B3.F 起截图 url 不再显示）；B4.9 连 stage.cover 一起删',
  },
  'ios/ShiziApp/ShiziApp/Screens/Library.swift': {
    action: 'simplify',
    why: '同 Home.swift（:459，B3.5d 根页连同原生 Tab 栏截图）；B4.9 删',
  },
  'ios/ShiziApp/ShiziApp/Screens/Query.swift': {
    action: 'simplify',
    why: '查字弹层「练这个字」前 snapshotURL(:1921) 交 stage.cover；B4.9 连 stage.cover 一起删',
  },
  'ios/ShiziApp/ShiziApp/NativeWriteViewController.swift': {
    action: 'simplify',
    why: '仅注释引用 callAsyncJavaScript 队列语义（:1717）；B4.8 换 SwiftEngine 后注释与排序保证改指 SwiftEngine 的调用队列',
  },
  'ios/ShiziApp/ShiziApp/AppDelegate.swift': {
    action: 'simplify',
    why: 'window.rootViewController = WebViewController()（:16）换原生根；openReminderTarget 派发（:42–46）迁到新根',
  },
  'ios/ShiziApp/ShiziApp/ShiziKit/NativeType.swift': {
    action: 'keep',
    why: '宋体从 Bundle.main/Web/fonts/*.woff2 经 CoreText 读（字体留在包内，:306 路径不变）',
  },
  'ios/ShiziApp/ShiziApp/ShiziKit/ShiziScreen.swift': {
    action: 'keep',
    why: '楷体从 Bundle.main/Web/fonts/ShiziKai-Regular.woff2 读（同上，:36 路径不变）',
  },
  'ios/ShiziApp/ShiziUITests/AccessibilityAuditTests.swift': {
    action: 'simplify',
    why: '「网页引擎（WKWebView）元素」豁免分支（:10、:61）在无 WKWebView 后恒不命中，删',
  },
  'ios/ShiziApp/ShiziUITests/AccessibilityFlowTests.swift': {
    action: 'simplify',
    why: '同上：WKWebView 元素过滤分支（:126）删',
  },
  'ios/ShiziApp/ShiziWriteTests/NativeStageTests.swift': {
    action: 'rewrite',
    why: '宿主测试经网页路由 + WebEngine（:8、:19、:31、:91 WebEngine(webView: nil)、:120）；B4.8 起换 SwiftEngine 宿主或删对应用例',
  },
  'ios/ShiziApp/ShiziWriteTests/ShiziKitTests.swift': {
    action: 'rewrite',
    why: '字阶夹具让页面（tokens.css）算一遍（:7、:21、:32）；换 ShiziKit 生成物直算或 SwiftEngine 宿主',
  },
  'ios/ShiziApp/ShiziWriteTests/NativeJudgeTests.swift': {
    action: 'rewrite',
    why: '等页面 shiziNativeWrite 就绪（:20、:34）再驱动写字会话；换 SwiftEngine 注入',
  },
  'ios/ShiziApp/ShiziWriteTests/NativeAnswerSkipTests.swift': {
    action: 'rewrite',
    why: '同上（:20、:34）',
  },
  'ios/ShiziCore/Sources/ShiziCore/Session/WriteWire.swift': {
    action: 'keep',
    why: '移植的规则（__shiziNativeWrite 环境判断，test/ui/native-write.test.mjs 的对侧）；B4.9 后环境恒缺该键、规则退化恒 false——保留以维持与 JS 参考实现一致',
  },
  'ios/ShiziCore/Sources/ShiziCore/Schedule/SchedMath.swift': {
    action: 'keep',
    why: '仅注释引用 WKWebView 的 JSC = Darwin libm 依据（.darwin 缺省的理由），不动',
  },
  'ios/ShiziCore/Tests/ShiziCoreTests/SessionTranscriptionTests.swift': {
    action: 'keep',
    why: '转写用例名引用 __shiziNativeWrite 规则名，是参考实现对账的一部分，不动',
  },
};

const DEFAULT_DISPOSITION = {
  action: 'review',
  why: '命中 Web 符号；B4.9 时按符号逐处核对（未列入处置表的先人工归类）',
};

function listFiles(dir, predicate) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    const child = join(abs, name);
    if (statSync(child).isDirectory()) out.push(...listFiles(join(dir, name), predicate));
    else if (predicate(name)) out.push(rel(child));
  }
  return out;
}

function inventorySwift() {
  const files = listFiles('ios', (name) => name.endsWith('.swift'));
  const perFile = [];
  let hits = 0;
  for (const file of files) {
    const lines = readRepo(file).split('\n');
    const found = [];
    lines.forEach((text, i) => {
      for (const term of GREP_TERMS) {
        if (text.includes(term)) {
          found.push({ line: i + 1, term, text: text.trim().slice(0, 160) });
          return; // 一行只记一次（首个命中的词）
        }
      }
    });
    if (!found.length) continue;
    hits += found.length;
    const disp = SWIFT_DISPOSITIONS[file] ?? DEFAULT_DISPOSITION;
    perFile.push({ file, action: disp.action, why: disp.why, hits: found });
  }
  const order = { delete: 0, simplify: 1, rewrite: 2, keep: 3, review: 4 };
  perFile.sort((a, b) => (order[a.action] - order[b.action]) || a.file.localeCompare(b.file));
  const counts = {};
  for (const f of perFile) counts[f.action] = (counts[f.action] ?? 0) + 1;
  return { terms: GREP_TERMS, scannedFiles: files.length, hits, counts, files: perFile };
}

// ---------------------------------------------------------------------------
// (c) 构建：把 Web/ 拷进包的阶段 / 脚本，及各断言应改成什么。
// ---------------------------------------------------------------------------

function findLines(path, needle) {
  if (!exists(path)) return [];
  return readRepo(path).split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({ text }) => text.includes(needle));
}

function inventoryBuild() {
  const items = [];
  const pbx = 'ios/ShiziApp/ShiziApp.xcodeproj/project.pbxproj';
  const pbxLines = findLines(pbx, 'Sync Web Assets');
  items.push({
    path: pbx,
    lines: pbxLines.map((l) => l.line),
    action: '收窄',
    what: 'Xcode Run Script 阶段「Sync Web Assets」→ ios/ShiziApp/scripts/sync-web-assets.sh',
    become: '阶段保留、脚本断言收窄为 data/ fonts/ licenses/ assets/（见下）；若做 B4.10（笔顺 SQLite 打包）则连同阶段一起删',
  });
  const syncLines = findLines('ios/ShiziApp/scripts/sync-web-assets.sh', 'test -f');
  items.push({
    path: 'ios/ShiziApp/scripts/sync-web-assets.sh',
    lines: syncLines.map((l) => l.line),
    action: '改断言',
    what: `构建期 rsync --files-from=shell-manifest.txt 进包 + 壳断言（index.html、deck-data.js、core-strokes.js、vendor/*、src/app.js、manifest.webmanifest 共 ${syncLines.length} 条 test）`,
    become: '断言改为：Web/data 目录在、Web/fonts 与 Web/assets/sound 在（原生在读）、Web/src 与 Web/index.html 等**不得**在；InkModel / QAStates 的 Debug 段不动',
  });
  const vbaLines = findLines('ios/ShiziApp/scripts/verify-bundle-assets.sh', '${WEB}');
  items.push({
    path: 'ios/ShiziApp/scripts/verify-bundle-assets.sh',
    lines: vbaLines.map((l) => l.line),
    action: '改断言',
    what: `Release 归档断言：Web/index.html、Web/deck-data.js、Web/core-strokes.js、Web/vendor/*、Web/src/app.js、Web/manifest.webmanifest 正向断言 + shell-manifest 逐行核对`,
    become: '按计划 §4.5 第 3 条改：不含 Web/src（及 Web/index.html / deck-data.js / core-strokes.js / vendor / manifest）、含 deck.json（ShiziCore 资源包 Bundled/）、DEBUG 标记断言保留；data JSON 计数与 zh-Hans / Paper 断言不动',
  });
  items.push({
    path: 'ios/ShiziApp/scripts/verify-archive.sh',
    lines: [],
    action: '保留',
    what: '归档门禁：无 Web 正向断言，只有 DEBUG 标记「不得出现」表 + 原生写字 / 墨面正向标记',
    become: '标记表随 NativeSmoke / NativeInkSpike 简化收缩（shizi-smoke-probe.js、__shiziNativeInk 等标记可随之移除）；其余不动',
  });
  const roots = findLines('scripts/build_shell_manifest.mjs', "export const SHELL_ROOTS");
  items.push({
    path: 'scripts/build_shell_manifest.mjs',
    lines: roots.map((l) => l.line),
    action: '收窄',
    what: 'SHELL_ROOTS = index.html / deck-data.js / core-strokes.js / manifest.webmanifest / sw.js / sw-manifest.js / data / src / vendor / fonts / assets / licenses；并生成 index.html 指纹、sw-manifest.js、src/build-info.js',
    become: 'SHELL_ROOTS 收窄为 data/ fonts/ licenses/ assets/（去 icon-*.png 模式与全部壳单文件）；index.html / sw-manifest.js / core-strokes.js 生成段删除；src/build-info.js 若网页版保留则与网页工具一起拆出去（D59 ④）',
  });
  items.push({
    path: 'scripts/shell-manifest.txt',
    lines: [],
    action: '重新生成',
    what: '生成物：当前 7,518 行（包内 28.17 MiB）',
    become: 'build:manifest 收根后重跑；预计 ~7,253 行（data 7,221 + fonts 5 + licenses 12 + assets 15）',
  });
  items.push({
    path: 'scripts/verify_assets.mjs',
    lines: findLines('scripts/verify_assets.mjs', 'CSP').map((l) => l.line),
    action: '随网页退役',
    what: 'CSP 与 index.html 一致性等网页壳断言（verify:data 链内）',
    become: 'B4.9 从 verify:data 缺省链摘除（网页版若保留则随网页工具拆走）',
  });
  items.push({
    path: 'package.json',
    lines: [],
    action: '摘除',
    what: 'verify:pwa、verify:web、verify:sw-unit、verify:webkit-ax 挂在 verify:data / test 缺省链上',
    become: 'B4.9 从链里摘除（脚本本体随网页去留处理，D59 ④）',
  });
  items.push({
    path: 'scripts/verify_sw_unit.mjs + test/platform/sw.test.mjs',
    lines: [],
    action: '随网页退役',
    what: 'Service Worker 单测 / 门禁（sw.js B4.9 删）',
    become: '随 sw.js 退役',
  });
  items.push({
    path: 'scripts/verify_pwa_upgrade.js',
    lines: [],
    action: '随网页退役',
    what: 'PWA 升级门禁',
    become: '随 manifest.webmanifest / sw.js 退役',
  });
  items.push({
    path: 'scripts/verify-webkit-ax.mjs + scripts/webkit-ax-probe.js',
    lines: [],
    action: '随 WKWebView 退役',
    what: 'WebKit 读屏探针门禁（verify:webkit-ax；B3.F 起由 AccessibilityAuditTests 承担）',
    become: 'B4.9 删（门禁已由原生 AX 审计接管）',
  });
  items.push({
    path: 'scripts/native-store-probe.js',
    lines: [],
    action: '随桥退役',
    what: 'JS↔原生 SQLite 桥探针',
    become: '随 NativeStoreBridge 退役',
  });
  items.push({
    path: 'test/shell-manifest.test.mjs',
    lines: [],
    action: '改',
    what: '壳清单 / 指纹 node 门禁（deck-data 指纹一致等）',
    become: '收根后改为只核对 data/fonts/licenses/assets 的清单同步（或随清单退役）',
  });
  for (const item of items) if (!exists(item.path.split(' + ')[0])) item.missing = true;
  return items;
}

// ---------------------------------------------------------------------------
// (d) 测试：node 参考实现测试 vs 仅网页测试；e2e 分类（映射表）；XCUITest 网页路径；QA 宿主网页分支。
// ---------------------------------------------------------------------------

// 仅网页 / 仅桥的 node 测试（出处：B4-单测转写清单.md「不转」说明、§10.x 各卡记录）。
const NODE_WEB_ONLY = [
  ['test/platform/bridge.test.mjs', '网页桥（window.webkit 消息时序）——仅网页'],
  ['test/platform/accessibility.test.mjs', '网页桥读屏上报——仅网页'],
  ['test/platform/sound.test.mjs', '网页声音（Web Audio / sound.js）——原生声音由 ios-sound.test.mjs 守'],
  ['test/platform/text-size.test.mjs', '网页字号桥——仅网页'],
  ['test/platform/sw.test.mjs', 'Service Worker——仅网页'],
  ['test/platform/env-clock.test.mjs', 'QA 固定时钟靠壳 documentStart 注入页面——随页面退场'],
  ['test/store/hooks.test.mjs', '网页测试钩子（test-hooks.js）——仅网页'],
  ['test/store/native-store.test.mjs', 'JS↔原生 SQLite 桥与 localStorage 迁移——转写清单注明「B4.9 随 WebEngine 退场」'],
  ['test/core/font-loader.test.mjs', '网页字体加载器（fetch / FontFace）——原生直读包内 woff2'],
  ['test/core/strokes.test.mjs', '网页笔顺加载器（fetch / LRU）——原生直读 data/*.json'],
  ['test/core/web-ink-golden.test.mjs', '已有 Swift 版（ShiziWriteTests/WebInkTests）——随网页退役'],
  ['test/ui/engine.test.mjs', 'B3.F 引擎模式（engine.js 镜像路由、B3Zf-1 判断声安装）——引擎随 B4.9 删'],
];

function parseTranscriptionList() {
  // B4-单测转写清单.md 的按文件表：| test/... | N | 归类 | 卡 | 说明 |
  const out = [];
  if (!exists('docs/engineering/v10/B4-单测转写清单.md')) return out;
  for (const line of readRepo('docs/engineering/v10/B4-单测转写清单.md').split('\n')) {
    const m = line.match(/^\|\s*(test\/[^\s|]+\.mjs)\s*\|\s*(\d+)\s*\|\s*([^|]+)\|/);
    if (m) out.push({ file: m[1], cases: Number(m[2]), classify: m[3].trim() });
  }
  return out;
}

function parseE2eMap() {
  // B3Z-e2e映射.md 逐文件表：| `spec` | 类 | 原生替代 | 备注 |
  const out = [];
  if (!exists('docs/engineering/v10/B3Z-e2e映射.md')) return out;
  for (const line of readRepo('docs/engineering/v10/B3Z-e2e映射.md').split('\n')) {
    const m = line.match(/^\|\s*`?([0-9a-z-]+)`?\s*\|\s*([RPLW])\s*\|/);
    if (m) out.push({ spec: m[1], klass: m[2] });
  }
  return out;
}

function inventoryTests() {
  const transcription = parseTranscriptionList();
  const webOnly = NODE_WEB_ONLY
    .map(([file, why]) => ({ file, why, present: exists(file) }))
    .filter((x) => x.present);
  const webOnlySet = new Set(webOnly.map((x) => x.file));

  // test/ 下全部 node 测试文件
  const testFiles = listFiles('test', (name) => name.endsWith('.test.mjs')).sort();
  const reference = testFiles.filter((f) => !webOnlySet.has(f));

  const e2e = parseE2eMap();
  const e2eCounts = {};
  for (const { klass } of e2e) e2eCounts[klass] = (e2eCounts[klass] ?? 0) + 1;

  const refDir = 'ios/ShiziApp/ShiziUITests/Reference';
  const referenceDir = {
    path: refDir,
    present: exists(refDir),
    files: exists(refDir) ? countFiles(refDir) : 0,
    bytes: exists(refDir) ? dirBytes(refDir) : 0,
    note: 'QA-H1 逐屏对比的标准答案（692 屏 png+json，B3.F 取证截止冻结）——停跑 spec ≠ 可删；重取（--update-reference）依赖网页构建，删网页前必须确认不再重取（B3Z 映射 §5.2）',
  };

  return {
    transcriptionRows: transcription.length,
    transcriptionCases: transcription.reduce((s, r) => s + r.cases, 0),
    node: {
      webOnly,
      webOnlyFiles: webOnly.length,
      referenceFiles: reference.length,
      reference,
      note: '参考实现测试（test/core 规则、test/store、test/ui 视图、ios-* 源码门禁、tokens / copy 门禁）B4.9 后继续跑（§6.2 B4.9 行：node 规则测试保留为参考实现测试）；仅网页 / 仅桥的随 D59 ④ 与桥退役',
    },
    e2e: {
      specs: e2e.length,
      counts: e2eCounts,
      plan: 'B4.9 停跑（§6.2 B4.9 行）：W 类 8 个随网页退役（54-native-bridge 随桥）；P / L 类在网页构建冻结后停；R 类 18 个在差分接管前不停。做法：scripts/e2e/batch.mjs 加 retired.json（B3Z 映射 §5 提案），不删 spec 文件',
    },
    xcuitestWebPaths: [
      'ios/ShiziApp/ShiziUITests/AccessibilityAuditTests.swift（WKWebView 元素豁免分支）',
      'ios/ShiziApp/ShiziUITests/AccessibilityFlowTests.swift（同上）',
      'ios/ShiziApp/ShiziWriteTests/NativeStageTests.swift（网页路由 + WebEngine 宿主路径）',
      'ios/ShiziApp/ShiziWriteTests/ShiziKitTests.swift（页面 tokens.css 夹具路径）',
      'ios/ShiziApp/ShiziWriteTests/NativeJudgeTests.swift / NativeAnswerSkipTests.swift（等页面就绪的宿主路径）',
      'ios/ShiziApp/ShiziWriteTests/NativeWriteBridgeTests.swift（整文件：只测桥）',
    ],
    qaWebBranches: [
      'ios/ShiziApp/scripts/native-ui/capture.mjs（--ui web 自 B3.F 已报错退役，B4.9 删分支）',
      'ios/ShiziApp/ShiziApp/NativeQAHarness.swift（网页摘要 callAsyncJavaScript、WKWebView 过滤）',
      'ios/ShiziApp/ShiziApp/QAFixtures.swift（qaRunJS / qaWebStrokes 注入）',
      'ios/ShiziApp/ShiziApp/NativeSmoke.swift（网页冒烟：?test=1、__shiziNativeDev、shiziNative 脚本）',
      'ios/ShiziApp/ShiziApp/Screens/Backup.swift（qaPickFile 读网页 __qaBackupPick）',
    ],
    referenceDir,
  };
}

// ---------------------------------------------------------------------------
// (e) 必须保留：原生还在读包内 Web/ 下这些，或与 JS 无关。
// ---------------------------------------------------------------------------

function inventoryStay() {
  const groups = [
    { path: 'data/', why: '笔顺 / 字形数据（data/<字>.json 与 etymology.json、context-overrides.js、LICENSE.md）——包内体积大头，原生直读（§4.5 第 3 条点名保留）' },
    { path: 'fonts/', why: '宋 / 楷 woff2——原生经 CoreText 读（NativeType.swift:306、ShiziScreen.swift:36、ImageRenderer）；fonts.css / coverage-manifest.json 仅网页用、随 src 同批出包与否见文档风险一节' },
    { path: 'licenses/', why: '许可与 NOTICE（含 hanzi-writer / preact / htm / jieba / pypinyin）——§4.5 第 3 条点名保留；即使 JS 库删除，许可文本继续保留一个版本周期最稳妥' },
    { path: 'assets/', why: 'assets/sound（j1 / s1）由原生播放器读包内 Web/assets/sound（WebViewController.swift:978；声音轮换规则 B3Zf-1 在引擎侧 installCommitFeedback）——B4.9 换窗口根时播放器要搬走但文件必须留；assets/branding 仅网页 / 生成器用（D59 ④）' },
    { path: 'ios/ShiziCore/Sources/ShiziCore/Bundled/', why: 'deck.json（deck-data.js 的替代，B4.1 起已在包）、card-rules / copy / motion / policy 等——ShiziCore 资源，与 JS 无关' },
    { path: 'THIRD_PARTY_NOTICES.md', why: '根目录 notices（§4.5 第 3 条点名保留），不在包内清单' },
    { path: 'src/', why: '仓库冻结保留为参考实现与测试先知（§4.5 第 5 条）；只出包，不删仓库' },
  ];
  return groups.map((g) => ({
    ...g,
    present: exists(g.path),
    files: g.path === 'src/' ? undefined : countFiles(g.path),
    bytes: dirBytes(g.path),
  }));
}

// ---------------------------------------------------------------------------
// (f) PrivacyInfo / entitlements / Info.plist 里的 WebKit 条目。
// ---------------------------------------------------------------------------

function inventoryPrivacy() {
  const hits = [];
  const candidates = [];
  const walk = (dir) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const child = join(abs, name);
      if (statSync(child).isDirectory()) {
        if (name !== 'node_modules' && name !== 'Reference') walk(join(dir, name));
      } else if (/PrivacyInfo\.xcprivacy$|\.entitlements$|Info\.plist$|\.xcconfig$/.test(name)) {
        candidates.push(rel(child));
      }
    }
  };
  walk('ios');
  for (const file of candidates) {
    const lines = readRepo(file).split('\n');
    lines.forEach((text, i) => {
      if (/WebKit|WKAppBoundDomains/i.test(text)) {
        hits.push({ file, line: i + 1, text: text.trim() });
      }
    });
  }
  return { scanned: candidates, hits, note: hits.length ? 'B4.9 删以下 WebKit 条目' : '无 WebKit 条目（PrivacyInfo 三段均为空数组；仓库无 *.entitlements；Info.plist / xcconfig 无 WebKit 键）——B4.9 无需动 PrivacyInfo' };
}

// ---------------------------------------------------------------------------

function main() {
  const a = inventoryBundleAssets();
  const b = inventorySwift();
  const c = inventoryBuild();
  const d = inventoryTests();
  const e = inventoryStay();
  const f = inventoryPrivacy();

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), a, b, c, d, e, f }, null, 2)}\n`);
    return;
  }

  const L = [];
  L.push('B4.9 移除清单（只读盘点；依据 B3B4-原生化架构与计划.md §4.5 第 3–5 条 / §6.2 B4.9 行）');
  L.push('');
  L.push('(a) 出包文件 —— 清单 scripts/shell-manifest.txt 共 ' + a.manifestFiles + ' 项 / ' + mib(a.totalBytes) + ' MiB；');
  L.push('    删除集 ' + a.leave.length + ' 项 / ' + mib(a.leaveBytes) + ' MiB（计划口径约 −5 MiB）：');
  for (const [g, v] of Object.entries(a.groups)) {
    L.push(`      ${g}: ${v.files} 文件 / ${mib(v.bytes)} MiB`);
  }
  for (const item of a.leave.filter((i) => !i.path.startsWith('src/') && !i.path.startsWith('vendor/'))) {
    L.push(`      - ${item.path}（${(item.bytes / 1024).toFixed(0)} KiB；仓库：${item.repo}）`);
  }
  L.push('      - src/ 249 文件 / ' + mib(a.groups['src/']?.bytes ?? 0) + ' MiB（只出包；仓库冻结保留，§4.5 第 5 条）');
  L.push('      - vendor/ ' + (a.groups['vendor/']?.files ?? 0) + ' 文件（preact、hanzi-writer、fsrs6、htm、ui.js、package.json）');
  L.push('    完整逐文件列表见 --json 的 a.leave。');
  L.push('');
  L.push('(b) Swift —— 扫描 ' + b.terms.join(' / ') + '：' + b.scannedFiles + ' 个 .swift 里 ' + b.hits + ' 行命中、' + b.files.length + ' 个文件：');
  for (const f of b.files) {
    L.push(`      [${f.action}] ${f.file}（${f.hits.length} 处）`);
    L.push(`        ${f.why}`);
  }
  L.push('');
  L.push('(c) 构建阶段与脚本 —— ' + c.length + ' 项：');
  for (const item of c) {
    const at = item.lines.length ? `（行 ${item.lines.join('、')}）` : '';
    L.push(`      [${item.action}] ${item.path}${at}`);
    L.push(`        现状：${item.what}`);
    L.push(`        改为：${item.become}`);
  }
  L.push('');
  L.push('(d) 测试 ——');
  L.push(`      node 仅网页 / 仅桥（随 D59 ④ 与桥退役）${d.node.webOnlyFiles} 个：`);
  for (const w of d.node.webOnly) L.push(`        - ${w.file}：${w.why}`);
  L.push(`      node 参考实现测试（B4.9 后继续跑）${d.node.referenceFiles} 个（清单见 --json 的 d.node.reference；转写清单共 ${d.transcriptionRows} 文件 / ${d.transcriptionCases} 用例）`);
  L.push(`      e2e ${d.e2e.specs} 个 spec：R ${d.e2e.counts.R ?? 0} / P ${d.e2e.counts.P ?? 0} / L ${d.e2e.counts.L ?? 0} / W ${d.e2e.counts.W ?? 0}；${d.e2e.plan}`);
  L.push('      XCUITest 网页路径：');
  for (const x of d.xcuitestWebPaths) L.push(`        - ${x}`);
  L.push('      QA 宿主网页分支：');
  for (const q of d.qaWebBranches) L.push(`        - ${q}`);
  L.push(`      QA-H1 参考图 ${d.referenceDir.files} 文件 / ${mib(d.referenceDir.bytes)} MiB —— 保留（${d.referenceDir.note}）`);
  L.push('');
  L.push('(e) 必须保留 —— ' + e.length + ' 组：');
  for (const s of e) {
    const size = s.files !== undefined ? `（${s.files} 文件 / ${mib(s.bytes)} MiB）` : `（${mib(s.bytes)} MiB）`;
    L.push(`      - ${s.path}${size}：${s.why}`);
  }
  L.push('');
  L.push('(f) PrivacyInfo / entitlements —— ' + f.note);
  for (const h of f.hits) L.push(`      ${h.file}:${h.line} ${h.text}`);
  L.push('');
  L.push('体积合计：出包 ' + mib(a.leaveBytes) + ' MiB / ' + a.leave.length + ' 文件；留在包内 ' + mib(a.totalBytes - a.leaveBytes) + ' MiB。计划口径 −5 MiB（§4.5 第 4 条），deck.json 已随 B4.6 进包、无净增。');

  process.stdout.write(L.join('\n') + '\n');
}

main();
