// B2.0 原生写字页的静态门禁（docs/engineering/v10/B2-原生写字架构.md §5 / §9）：
// 1. 文案单一来源：原生写字页的 Swift 源码里不得有含汉字的字符串字面量——用户可见的字一律取自页面 src/config/copy（open 回包的 copy 字典）；
// 2. 原生写字页用到的文案键都在 native-session.js 的 NATIVE_WRITE_COPY_KEYS 里（键名写错 = 原生拿到空字符串）；
// 3. 纵切只在开发构建：这些文件整体包在 #if DEBUG 里（Release 产物不含，verify-archive 另查标记）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/helpers.mjs';
import { NATIVE_WRITE_COPY_KEYS } from '../src/ui/screens/write/native-session.js';

const DIR = path.join(ROOT, 'ios/ShiziApp/ShiziApp');
const FILES = ['NativeWriteViewController.swift', 'NativeWriteCoordinator.swift', 'NativeWriteBridge.swift', 'NativeGlyph.swift'];
const HAN = /[㐀-鿿＀-￯　-〿]/;

/** 去掉 // 行注释与块注释后的源码（字符串里的 // 不在这些文件里出现）。 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

test('native write sources: no Chinese string literals (copy comes from src/config/copy)', () => {
  for (const f of FILES) {
    const literals = code(fs.readFileSync(path.join(DIR, f), 'utf8')).match(/"(?:[^"\\\n]|\\.)*"/g) || [];
    const bad = literals.filter(s => HAN.test(s));
    assert.deepEqual(bad, [], `${f} has user-visible literals`);
  }
});

test('native write sources: every copy key the page asks for is shipped in the open payload', () => {
  const src = fs.readFileSync(path.join(DIR, 'NativeWriteViewController.swift'), 'utf8');
  const used = [...new Set([...src.matchAll(/tr\("([A-Z][\w-]*\.\w+)"/g)].map(m => m[1]))];
  assert.ok(used.length >= 10);
  for (const k of used) assert.ok(NATIVE_WRITE_COPY_KEYS.includes(k), `${k} missing from NATIVE_WRITE_COPY_KEYS`);
});

test('native write sources: DEBUG only during B2.0', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(src.startsWith('#if DEBUG') && src.endsWith('#endif'), f);
  }
});
