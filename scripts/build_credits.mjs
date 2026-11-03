#!/usr/bin/env node
// 开源资料 · 致谢 数据生成器（02 M4-6；04 R-AB01 / R-AB02；03 P21「开源页由现有文档生成」）。
//
// 输入：THIRD_PARTY_NOTICES.md（每个 `## ` 小节一项）+ 小节里用反引号引用的许可全文文件
//       （licenses/*、sources/LICENSE-*）。
// 输出：src/config/credits.js —— 关于页「开源资料 · 致谢」子页的全部内容（逐字取自上面两处，不另写说明）：
//   CREDITS       [{id, title, name, version, kind:'code'|'data'|'font', url, license, notice, licenseFiles:[path]}]
//   LICENSE_TEXTS {path: 全文}
//   SOURCE        生成来源说明
// 内容不变时不重写文件（重复运行 git diff 为空）。
//
// 用法：
//   node scripts/build_credits.mjs          生成 / 更新
//   node scripts/build_credits.mjs --check  只检查：生成物与工作区不一致则退出码 1
//
// ShiziKai / ShiziSerifSC 在 M5-2 写进 NOTICES（及 licenses/）后，重跑本脚本即出现在关于页，不用改代码。

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES_PATH = 'THIRD_PARTY_NOTICES.md';
export const OUT_PATH = 'src/config/credits.js';
/** D84：ShiziCore 的 Bundled/credits.json 由本脚本直接写（不经 build_core_config）；不读 src/。 */
export const BUNDLED_PATH = 'ios/ShiziCore/Sources/ShiziCore/Bundled/credits.json';

// 许可名：按小节正文里出现的字样识别（先匹配的优先）。显示名保持英文原名（许可的正式名称，不是界面文案）。
const LICENSE_RULES = [
  [/SIL OPEN FONT LICENSE|\bOFL\b/i, 'SIL Open Font License 1.1'],
  [/Arphic Public License/i, 'Arphic Public License'],
  [/GNU LGPL|LGPL/i, 'GNU LGPL 3.0 or later'],
  [/Apache License(,)? (Version )?2\.0/i, 'Apache License 2.0'],
  [/MIT License/i, 'MIT License'],
];

// 引用的许可全文文件（只收这两处：随包的 licenses/ 与仓库 sources/LICENSE-*）。
const LICENSE_FILE_RE = /`((?:licenses\/[^`\s]+)|(?:sources\/LICENSE-[^`\s]+))`/g;

function slug(text) {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 小节标题 → {name, version}：「Preact 10.29.8 (core and hooks)」→ Preact / 10.29.8。 */
export function splitTitle(title) {
  const m = /^(.*?)\s+v?(\d+(?:\.\d+){1,3})(?:\s+\(.*\))?\s*$/.exec(title);
  if (!m) return { name: title.trim(), version: '' };
  return { name: m[1].trim(), version: m[2] };
}

export function detectLicense(body) {
  const flat = String(body).replace(/\s+/g, ' ');
  for (const [re, name] of LICENSE_RULES) if (re.test(flat)) return name;
  return '';
}

/** 程序库（vendor/ 下随包的代码）/ 字体 / 数据。 */
export function detectKind(title, body, license) {
  if (license === 'SIL Open Font License 1.1' || /\bfont\b.*\b(subset|woff2?)\b|^Shizi(Kai|Serif)/i.test(title)) return 'font';
  if (/`vendor\//.test(body)) return 'code';
  return 'data';
}

/**
 * 正文：去掉首尾空行；文字逐字保留，只做显示整理——Markdown 链接写成「文字 (网址)」、去掉反引号、
 * 段内的硬换行（NOTICES 按 80 列折行）接成一行，空行分段与「- 」列表项照旧换行。
 */
export function plainNotice(body) {
  const flat = String(body)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s+|\s+$/g, '');
  return flat
    .split(/\n{2,}/)
    .map(para => para.split('\n').reduce((out, line) => {
      const l = line.trim();
      if (!out) return l;
      return /^- /.test(l) ? `${out}\n${l}` : `${out} ${l}`;
    }, ''))
    .join('\n\n');
}

/**
 * @param {string} notices     THIRD_PARTY_NOTICES.md 全文
 * @param {(path:string) => string|null} readText  读许可全文（不存在返回 null）
 */
export function buildCredits(notices, readText) {
  const text = String(notices).replace(/\r\n?/g, '\n');
  const parts = text.split(/^## /m).slice(1);
  const credits = [];
  const licenseTexts = {};
  const seen = new Set();
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = nl < 0 ? '' : part.slice(nl + 1);
    const { name, version } = splitTitle(title);
    let id = slug(title) || `item-${credits.length + 1}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    const urlMatch = /\]\((https?:\/\/[^)\s]+)\)/.exec(body);
    const license = detectLicense(body);
    const files = [];
    for (const m of body.matchAll(LICENSE_FILE_RE)) {
      const p = m[1];
      if (files.includes(p)) continue;
      const content = readText(p);
      if (content == null) continue;
      files.push(p);
      if (!(p in licenseTexts)) licenseTexts[p] = String(content).replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n';
    }
    credits.push({
      id,
      title,
      name,
      version,
      kind: detectKind(title, body, license),
      url: urlMatch ? urlMatch[1] : '',
      license,
      notice: plainNotice(body),
      licenseFiles: files,
    });
  }
  const sortedTexts = {};
  for (const k of Object.keys(licenseTexts).sort()) sortedTexts[k] = licenseTexts[k];
  return { credits, licenseTexts: sortedTexts };
}

export function renderModule({ credits, licenseTexts }) {
  return [
    '// 由 scripts/build_credits.mjs 从 THIRD_PARTY_NOTICES.md 与其引用的许可全文生成，勿手改。',
    '// 关于页「开源资料 · 致谢」（src/ui/screens/mine/about.js）按需 import。',
    '',
    `export const SOURCE = ${JSON.stringify(NOTICES_PATH)};`,
    '',
    `export const CREDITS = Object.freeze(${JSON.stringify(credits, null, 2)});`,
    '',
    `export const LICENSE_TEXTS = Object.freeze(${JSON.stringify(licenseTexts, null, 2)});`,
    '',
  ].join('\n');
}

export function readRepoText(root = ROOT) {
  return p => {
    const abs = join(root, p);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
}

export function generate(root = ROOT) {
  const notices = readFileSync(join(root, NOTICES_PATH), 'utf8');
  return renderModule(buildCredits(notices, readRepoText(root)));
}

/** 模块文本 → Bundled JSON 文本（{CREDITS, LICENSE_TEXTS, SOURCE}；只 import 生成物自己的文本，不读 src/）。 */
export async function bundledJson(moduleText) {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(moduleText).toString('base64'));
  return JSON.stringify({ ...mod }, null, 2) + '\n';
}

async function main(argv) {
  const check = argv.includes('--check');
  const text = generate(ROOT);
  const outputs = [[OUT_PATH, text], [BUNDLED_PATH, await bundledJson(text)]];
  let stale = 0;
  for (const [rel, next] of outputs) {
    const out = join(ROOT, rel);
    const prev = existsSync(out) ? readFileSync(out, 'utf8') : null;
    if (prev === next) {
      console.log(`${rel} up to date`);
    } else if (check) {
      console.error(`${rel} is stale: run node scripts/build_credits.mjs`);
      stale += 1;
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, next);
      console.log(`wrote ${rel}`);
    }
  }
  return stale ? 1 : 0;
}

function isMain() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch (error) {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await main(process.argv.slice(2));
}
