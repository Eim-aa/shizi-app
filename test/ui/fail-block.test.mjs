// 保存失败三段式（交互与动效规范 S1，审计 P1-24 – P1-32；03 P290）：全 App 一个组件 components/FailBlock.js。
// 旧实现（10650a2）上：没有这个组件，各页各写一套（9 种形态），下面的「每一处失败都用它」扫描是红的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FailBlock, Announce, FAIL_COPY } from '../../src/ui/components/FailBlock.js';
import { Button } from '../../src/ui/components/Button.js';
import { t } from '../../src/config/copy/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}
const flat = node => {
  const out = [];
  walk(node, n => out.push(n));
  return out;
};
const ids = node => flat(node).filter(n => n.props && n.props['data-testid']).map(n => n.props['data-testid']);
const textOf = node => {
  let s = '';
  walk(node, n => {
    const c = n.props && n.props.children;
    if (typeof c === 'string') s += c;
    if (Array.isArray(c)) for (const x of c) if (typeof x === 'string') s += x;
  });
  return s;
};

test('order is fixed: sentence → 先不 X (text button) → 再试一次 (primary); default copy is R-W16', () => {
  const v = FailBlock({ testid: 'x', onCancel: () => {}, onRetry: () => {} });
  assert.deepEqual(ids(v), ['x', 'x-note', 'x-cancel', 'x-retry']);
  const buttons = flat(v).filter(n => n.type === Button);
  assert.deepEqual(buttons.map(b => b.props.variant), ['text', 'primary'], 'B1: 先不保存 is a text button, 再试一次 the primary');
  assert.equal(textOf(flat(v).find(n => n.props && n.props['data-testid'] === 'x-note')), t('R-W16.saveFailed'));
  assert.equal(textOf(buttons[0]), FAIL_COPY.cancel());
  assert.equal(textOf(buttons[1]), FAIL_COPY.retry());
});

test('dialog layout: [先不 X | 再试一次] in one row, cancel on the left (P1-25)', () => {
  const v = FailBlock({ testid: 'd', layout: 'dialog', text: '没保存上。', cancelLabel: '先不改', retryLabel: '再试一次', onCancel: () => {}, onRetry: () => {} });
  assert.equal(v.props['data-layout'], 'dialog');
  const row = flat(v).find(n => n.props && typeof n.props.class === 'string' && n.props.class.startsWith('sz-fail__btns'));
  assert.ok(row, 'buttons share one row');
  assert.deepEqual(ids(row), ['d-cancel', 'd-retry']);
  const one = FailBlock({ testid: 'o', onCancel: null, onRetry: () => {} });
  assert.deepEqual(ids(one), ['o', 'o-note', 'o-retry'], 'onCancel: null = a single exit');
});

test('no hook in the view; the sentence is spoken once through the persistent live region (Announce ref)', () => {
  const v = FailBlock({ testid: 'a', text: '没导出来。', onCancel: () => {}, onRetry: () => {} });
  const say = flat(v).find(n => n.props && n.props.class === 'sz-fail__say');
  assert.ok(say && typeof (say.ref || say.props.ref) === 'function', 'a hidden span announces on mount');
  assert.equal(Announce({ text: '' }), null);
  assert.equal(flat(FailBlock({ testid: 'q', text: 'x', speak: false })).some(n => n.props && n.props.class === 'sz-fail__say'), false);
});

test('every former failure shape now goes through FailBlock (P1-24 – P1-32)', () => {
  const users = [
    'src/ui/screens/write/end.js', 'src/ui/screens/write/result-row.js', 'src/ui/screens/write/persist.js', 'src/ui/screens/session/s02.js',
    'src/ui/screens/library/switch.js', 'src/ui/screens/library/list.js', 'src/ui/screens/library/all.js', 'src/ui/screens/result/index.js',
    'src/ui/screens/result/first.js', 'src/ui/screens/mine/remind.js', 'src/ui/screens/mine/choice.js', 'src/ui/screens/mine/backup.js', 'src/ui/screens/block/index.js',
    'src/ui/screens/detail/actions.js', 'src/ui/components/image-preview.js', 'src/ui/components/query/CharCard.js', 'src/ui/components/query/QuerySheet.js',
  ];
  for (const f of users) assert.match(read(f), /components\/FailBlock\.js|\.\.\/FailBlock\.js|'\.\/FailBlock\.js'/, `${f} imports the shared FailBlock`);
  // 写字页自己排版的失败（底栏求助行 + 主按钮）也经播报区读出说明（P1-27）
  for (const f of ['src/ui/screens/write/compare.js', 'src/ui/screens/write/answer.js', 'src/ui/screens/write/skip.js']) assert.match(read(f), /Announce|useAnnounce/, f);
  // 看答案写入失败不再是居中模态框（P1-24）
  assert.doesNotMatch(read('src/ui/screens/write/answer.js'), /openAnswerSaveFailed|write-answer-confirm'/);
  // 网页导出 / 分享失败不再静默（P1-30）；原生分享失败在屏上就地给（F3 ①）
  assert.match(read('src/ui/screens/mine/backup.js'), /setExportFail\(true\)/);
  assert.match(read('src/ui/components/share-failed.js'), /if \(!shown\) showToast/);
});
