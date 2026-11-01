#!/usr/bin/env node
// WebKit AX 版式门禁（R3-K1，ADA A3-01 / A3-02 / A3-04 建议的「WKWebView × 三机型 × 字号档」；K2 起缺省覆盖 L、XXXL、AX3、AX5 四档：Chromium e2e 拦不住 WebKit 的行盒与热区溢出，标准字号也要量）：`pnpm run verify:webkit-ax`。
// 不在 `pnpm test` 默认集合里（要 Xcode 与 iOS 模拟器；Chromium 不复现这几条缺陷，所以必须在 WebKit 上量）。发版前、动了写字页 / 详情页版式后跑一遍。
//
// 流程：xcodebuild DEBUG 模拟器包（SKIP_BUILD=1 跳过）→ 每台模拟器 `simctl install`（覆盖安装，数据容器保留）→ 浅色外观 →
//   每个系统字号（simctl ui content_size）× 每个状态：把 scripts/webkit-ax-probe.js 放进 App 数据容器 Documents/shizi-smoke-probe.js，
//   以 `-shizi-smoke -shizi-smoke-stage probe -shizi-probe-arg <状态>` 冷启动（NativeSmoke.swift runSmokeProbe 在页面里执行探针），
//   等 Documents/shizi-native-smoke.json，截一张模拟器图，按探针回传的检查项判定。
// 断言（探针里）：书写格 / 判断页两格宽高相等（±1）、写下的斜线存进数据后 dy/dx = 1（±2%）；文字不横向溢出视口 / 按钮、含文字的元素
//   scrollWidth ≤ clientWidth、文字不互相叠压；写字类页面不滚动、格下说明位在格子之下且完整在底栏上沿之上。
// 收尾：每台模拟器恢复系统字号 L（large）与浅色外观（中途失败也恢复）。
//
// 选项（环境变量）：
//   DERIVED_DATA_PATH  构建目录（缺省 ios/ShiziApp/build/webkit-ax/DerivedData，已在 .gitignore）
//   SKIP_BUILD=1       用已有的 .app
//   DEVICES            逗号分隔的 名字=UDID（缺省 iPhone17 / SE3 / ProMax 三台评审模拟器）
//   SIZES              逗号分隔，normal（L）/ xxxl / ax3 / ax5（缺省四档，K2；也接受 xs）
//   STATES             逗号分隔，write / trace / retrace / self / judge / detail / redo / result（缺省全部；retrace / self 是格下 R-W07.selfNote 的两种阶段，r7-W3；redo = 重写错字页、result = 首练结果页的提醒邀请在首屏内，D66）
//   OUT_DIR            截图与每次结果 JSON 的目录（缺省 ios/ShiziApp/build/webkit-ax/out）
//   RESULT_TIMEOUT     每个状态等结果的秒数（缺省 60）
//   ENGINE             App 的 -shizi-engine（缺省 web；B4.9c）

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IOS = join(ROOT, 'ios/ShiziApp');
const BUILD = join(IOS, 'build/webkit-ax');
const DD = process.env.DERIVED_DATA_PATH || join(BUILD, 'DerivedData');
const OUT = process.env.OUT_DIR || join(BUILD, 'out');
const APP = join(DD, 'Build/Products/Debug-iphonesimulator/Shizi.app');
const BID = 'com.eimaa.shizi';
const PROBE = join(ROOT, 'scripts/webkit-ax-probe.js');
const TIMEOUT = Number(process.env.RESULT_TIMEOUT || 60);
// B4.9c：探针量的是 WKWebView 里网页写字页的版式（WebEngine 那条路）——显式带 -shizi-engine（缺省 web）。**已知失效**：2026-11-01 实测
// 缺省 swift 与 web 都卡在「app boot」（探针等网页根节点 .sz-app，B3.F 起引擎模式不挂网页界面，早于本卡）；原生写字页的 AX 版式由
// verify-native-ui.sh 的逐屏对比（AX3 / AX5）与流程用例覆盖。待 B4.9 随网页退役。
const ENGINE = process.env.ENGINE || 'web';

const DEFAULT_DEVICES = 'iPhone17=F1193537-1696-4C87-8094-E6F24E4F220D,SE3=66BBBA9C-B7FB-4DA0-9D1C-08B729304053,ProMax=2247F84A-D0D1-4056-A79A-88B772B35DE3';
const DEVICES = (process.env.DEVICES || DEFAULT_DEVICES).split(',').map(s => s.split('=')).map(([name, udid]) => ({ name, udid }));
const CONTENT_SIZE = { xs: 'extra-small', normal: 'large', xxxl: 'extra-extra-extra-large', ax3: 'accessibility-extra-large', ax5: 'accessibility-extra-extra-extra-large' };
const SIZES = (process.env.SIZES || 'normal,xxxl,ax3,ax5').split(',');
const STATES = (process.env.STATES || 'write,trace,retrace,self,judge,detail,redo,result').split(',');

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const simctl = (...args) => sh('xcrun', ['simctl', ...args]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quiet = fn => {
  try {
    return fn();
  } catch (error) {
    return null;
  }
};

for (const s of SIZES) if (!CONTENT_SIZE[s]) throw new Error(`unknown size ${s}`);

if (process.env.SKIP_BUILD !== '1') {
  console.log(`Building Shizi (Debug, iOS Simulator) → ${DD}`);
  execFileSync('xcodebuild', [
    '-project', join(IOS, 'ShiziApp.xcodeproj'), '-scheme', 'Shizi', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', DD, 'CODE_SIGNING_ALLOWED=NO', 'build', '-quiet',
  ], { stdio: 'inherit' });
}
if (!existsSync(APP)) throw new Error(`Simulator app not found: ${APP}`);
mkdirSync(OUT, { recursive: true });

function restore(dev) {
  quiet(() => simctl('terminate', dev.udid, BID));
  quiet(() => simctl('ui', dev.udid, 'content_size', 'large'));
  quiet(() => simctl('ui', dev.udid, 'appearance', 'light'));
}

async function runState(dev, size, state, container) {
  const docs = join(container, 'Documents');
  mkdirSync(docs, { recursive: true });
  copyFileSync(PROBE, join(docs, 'shizi-smoke-probe.js'));
  const resultFile = join(docs, 'shizi-native-smoke.json');
  rmSync(resultFile, { force: true });
  quiet(() => simctl('terminate', dev.udid, BID));
  await sleep(600);
  simctl('launch', dev.udid, BID, '-shizi-engine', ENGINE, '-shizi-smoke', '-shizi-smoke-stage', 'probe', '-shizi-probe-arg', state);
  const end = Date.now() + TIMEOUT * 1000;
  while (Date.now() < end && !(existsSync(resultFile) && readFileSync(resultFile, 'utf8').length)) await sleep(500);
  const tag = `${dev.name}-${size}-${state}`;
  quiet(() => simctl('io', dev.udid, 'screenshot', join(OUT, `${tag}.png`)));
  if (!existsSync(resultFile)) return { tag, error: `no result after ${TIMEOUT}s`, checks: [] };
  const raw = readFileSync(resultFile, 'utf8');
  writeFileSync(join(OUT, `${tag}.json`), raw);
  const res = JSON.parse(raw);
  return { tag, ...res };
}

const rows = [];
let failed = 0;
for (const dev of DEVICES) {
  try {
    simctl('bootstatus', dev.udid, '-b');
    quiet(() => simctl('terminate', dev.udid, BID));
    simctl('install', dev.udid, APP);
    simctl('ui', dev.udid, 'appearance', 'light');
    // 首次安装时数据容器在第一次启动后才有 WebKit 目录；容器路径本身安装后即有。
    const container = simctl('get_app_container', dev.udid, BID, 'data');
    for (const size of SIZES) {
      simctl('ui', dev.udid, 'content_size', CONTENT_SIZE[size]);
      await sleep(1500);
      for (const state of STATES) {
        const res = await runState(dev, size, state, container);
        const bad = res.checks.filter(c => !c.ok);
        const ok = !res.error && bad.length === 0 && res.checks.length > 0;
        if (!ok) failed += 1;
        const sq = res.metrics && res.metrics.layout && res.metrics.layout.squares
          ? res.metrics.layout.squares.map(s => `${s.width}×${s.height}`).join(' ') : '';
        rows.push({ tag: res.tag, ok, sq, ratio: res.metrics ? res.metrics.strokeRatio : undefined, error: res.error, bad });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${res.tag}${sq ? `  grid ${sq}` : ''}${res.metrics && res.metrics.strokeRatio != null ? `  stroke dy/dx ${res.metrics.strokeRatio}` : ''}`);
        if (res.error) console.log(`      error: ${res.error}`);
        for (const c of bad) console.log(`      ✗ ${c.name}: ${JSON.stringify(c.detail)}`);
      }
    }
  } finally {
    restore(dev);
  }
}

const total = rows.length;
const checks = rows.reduce((n, r) => n + (r.bad ? r.bad.length : 0), 0);
console.log(`\nWebKit AX gate: ${total - failed}/${total} states passed (${checks} failed checks). Screenshots and JSON: ${OUT}`);
process.exit(failed ? 1 : 0);
