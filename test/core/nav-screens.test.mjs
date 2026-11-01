// B4.9a：ShiziCore NavScreens.app（导航层的屏名表 = getScreen 的那一份）与 src/ 里 registerScreen 的登记同步；core-diff 的 NAV_TABS / NAV_SUBS 同一份。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_TABS, NAV_SUBS } from '../../scripts/core-diff/lib/js-ops-b49.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every registerScreen in src/ui is in the native navigation screen table (tabs and sub screens alike)', () => {
  const consts = new Map();
  const calls = [];
  for (const f of files(path.join(ROOT, 'src/ui'))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/const ([A-Z_]+) = '([^']+)'/g)) consts.set(m[1], m[2]);
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue; // 注释
      const m = /registerScreen\(([^,]+),.*/.exec(line);
      if (m) calls.push({ arg: m[1].trim(), tab: /tab: true/.test(m[0]), file: f });
    }
  }
  const seen = new Map();
  for (const c of calls) {
    if (c.file.endsWith(path.join('ui', 'router.js'))) continue; // registerScreen 本身的定义 / 报错文字
    const name = /^'.*'$/.test(c.arg) ? c.arg.slice(1, -1) : consts.get(c.arg);
    assert.ok(name, `cannot resolve ${c.arg} in ${c.file}`);
    seen.set(name, c.tab);
  }
  const tabs = [...seen].filter(([, t]) => t).map(([n]) => n).sort();
  const subs = [...seen].filter(([, t]) => !t).map(([n]) => n).filter(n => n !== 'glyph-demo').sort(); // glyph-demo 只在测试宿主登记（NavScreens.app(testHost:)）
  assert.deepEqual(tabs, [...NAV_TABS].sort());
  assert.deepEqual(subs, [...NAV_SUBS].sort());
});

test('ShiziCore NavScreens.app lists the same screens as the core-diff reference', () => {
  const swift = readFileSync(path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Navigation/RouteRules.swift'), 'utf8');
  const body = swift.slice(swift.indexOf('public static func app('), swift.indexOf('public func tab('));
  const tabs = /tabs: \[([^\]]*)\]/.exec(body)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  const subs = /subs: \[([\s\S]*?)\] \+/.exec(body)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  assert.deepEqual(tabs, NAV_TABS);
  assert.deepEqual(subs, NAV_SUBS);
});
