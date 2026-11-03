#!/usr/bin/env node
// 设计令牌门禁（接进 pnpm test）。
//
// D84：网页壳（src/ui、tokens.css、扫字号 / 圆角 / 颜色字面量的源码扫描）已随网页版删除。原生一侧的令牌核对：
//   1. docs/design/design-system-v1/tokens.json 的 motion.duration / motion.easing 与
//      ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitTokens.json 的 motion.cssVars（--dur-* / --ease-*）逐值一致，键也一一对应；
//   2. ShiziKitTokens.json 是纯 JSON 数据（没有非有限数）。
// 颜色 / 字阶 / 间距 / 圆角 / 线宽 / 触控与 tokens.json 的一致由 test/ios-shizikit.test.mjs 守；
// Swift 源码无中文字面量由同一个测试守；字号、圆角等取值的视觉回归由原生基线（verify-native-ui.sh）守。
//
// 用法：node scripts/verify_tokens.mjs [--quiet]   有违规退出码 1。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
export const TOKENS_JSON = 'docs/design/design-system-v1/tokens.json';
export const KIT_TOKENS_JSON = 'ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitTokens.json';

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/** tokens.json 的 motion.duration / easing 与 ShiziKitTokens.json 的 motion.cssVars 逐值一致（返回不一致的说明）。 */
export function motionTokenDrift(root = REPO_ROOT) {
  const errors = [];
  const json = readJson(root, TOKENS_JSON);
  const kit = readJson(root, KIT_TOKENS_JSON);
  const declared = new Map(Object.entries((kit.motion && kit.motion.cssVars) || {}).filter(([k]) => /^--(?:dur|ease)-/.test(k)));
  const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  const want = new Map();
  for (const [k, v] of Object.entries((json.motion && json.motion.duration) || {})) want.set(`--dur-${kebab(k)}`, `${v}ms`);
  for (const [k, v] of Object.entries((json.motion && json.motion.easing) || {})) want.set(`--ease-${kebab(k)}`, v);
  if (!want.size) errors.push('tokens.json has no motion.duration / easing');
  for (const [name, value] of want) {
    if (!declared.has(name)) errors.push(`${name} missing from ShiziKitTokens.json motion.cssVars`);
    else if (declared.get(name).replace(/\s+/g, '') !== value.replace(/\s+/g, '')) errors.push(`${name}: ShiziKitTokens.json ${declared.get(name)} ≠ tokens.json ${value}`);
  }
  for (const name of declared.keys()) if (!want.has(name)) errors.push(`${name} is not in tokens.json motion`);
  return errors;
}

/** ShiziKitTokens.json 里没有 NaN / Infinity / 函数（纯数据）。 */
export function kitTokenShape(root = REPO_ROOT) {
  const errors = [];
  const walk = (x, where) => {
    if (typeof x === 'number' && !Number.isFinite(x)) errors.push(`${where}: non-finite number`);
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${where}.${k}`);
  };
  walk(readJson(root, KIT_TOKENS_JSON), 'ShiziKitTokens');
  return errors;
}

export function scan({ root = REPO_ROOT } = {}) {
  const violations = [...motionTokenDrift(root), ...kitTokenShape(root)];
  return { violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quiet = process.argv.includes('--quiet');
  const { violations } = scan();
  if (!quiet) for (const v of violations) console.log(`[verify-tokens] ${v}`);
  console.log(`[verify-tokens] tokens.json motion ⇄ ShiziKitTokens.json; violations ${violations.length}`);
  process.exit(violations.length ? 1 : 0);
}
