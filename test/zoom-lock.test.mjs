// 阶段 1 Q2-14（复测 simC D11）：页面不能被双指缩放（缩放后界面没有恢复入口，只能重启）。
//   网页：viewport meta 带 minimum-scale=1 / maximum-scale=1 / user-scalable=no（iOS Safari 标签页里系统会为辅助功能忽略它，PWA / 壳内有效）；
//   原生壳：WKWebView 的 scrollView 最小 / 最大缩放比都是 1，并关掉捏合手势识别器。
// 不影响系统层的辅助功能「缩放」（屏幕放大镜，不是页面缩放）、「更大字体」（走 shiziContentSize 的 --k）和 VoiceOver：它们不经过页面的 viewport 缩放。
// 只对 index.html 做静态核对（网页版冻结在仓库里）。B4.9：App 里没有 WKWebView 了，原生页本来就不能整页缩放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

test('index.html viewport：禁止缩放，仍铺满刘海 / 安全区', () => {
  const m = html.match(/<meta name="viewport" content="([^"]*)"/);
  assert.ok(m, 'viewport meta');
  const parts = Object.fromEntries(m[1].split(',').map(s => s.trim().split('=')));
  assert.equal(parts['width'], 'device-width');
  assert.equal(parts['initial-scale'], '1');
  assert.equal(parts['minimum-scale'], '1');
  assert.equal(parts['maximum-scale'], '1');
  assert.equal(parts['user-scalable'], 'no');
  assert.equal(parts['viewport-fit'], 'cover');
});
