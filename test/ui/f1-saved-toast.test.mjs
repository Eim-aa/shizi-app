// R4-F1（D55，P262）：写字页返回首页不再出「已保存，下次接着写」提示条（不能点、没有操作空间）。保存失败的三段式提示不动。
// 真实流程（返回后 1.5s 内页面上没有 toast 元素、失败路径仍有提示）在 scripts/e2e/81-h1-toast.spec.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, has } from '../../src/config/copy/index.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('文案槽 R-H10.savedToast 已删（运行时文案与 copy-source.json 都没有）', () => {
  assert.ok(!read('src/config/copy/home.js').includes('R-H10'));
  const source = JSON.parse(read('docs/engineering/v10/copy-source.json'));
  const text = read('docs/engineering/v10/copy-source.json');
  assert.ok(!/"R-H10":/.test(text) && !/"savedToast":/.test(text), 'copy-source.json has no R-H10 group / savedToast slot');
  assert.ok(source.nonRuntimeDecisions && source.nonRuntimeDecisions.P262, 'P262 is registered as a non-runtime decision');
  if (typeof has === 'function') assert.equal(has('R-H10.savedToast'), false);
});

test('session/index.js 不再订阅 router 发这条提示；首页不再挂它', () => {
  const session = read('src/ui/screens/session/index.js').replace(/\/\/[^\n]*/g, '');
  assert.ok(!session.includes('ensureNavHooks') && !session.includes('onRouterChange') && !session.includes('R-H10'));
  assert.ok(!read('src/ui/screens/home/index.js').includes('ensureNavHooks'));
});

test('Toast 组件仍在（失败与可撤销还用它）；旧组已保存、换字库、导出备份这些成功提示的调用已删（I3 P0-08 ~ P0-10）', () => {
  assert.ok(!/showToast\(/.test(read('src/ui/screens/session/index.js')));
  assert.ok(!/showToast\(/.test(read('src/ui/screens/library/switch.js')));
  assert.match(read('src/ui/components/Toast.js'), /export function showToast/);
});

test('保存失败的提示保持原样：写字页顶部三段式（X-PERSIST.saveFailed）', () => {
  assert.equal(t('X-PERSIST.saveFailed').length > 0, true);
  assert.match(read('src/ui/screens/write/persist.js'), /write-persist-notice/);
});
