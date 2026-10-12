// I3 · P0-07 ~ P0-14（规范 F3 / F5，D55 ②⑤）：成功提示与不可操作的提示全部删除——调用与文案都不在了。
// 状态需要告诉用户时在原地变化（保存键「已存好」、查字卡片的「已在自选的字里」、设置页行尾的库名、备份页的「上次备份」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const copyFiles = readdirSync(new URL('../../src/config/copy/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => read(`src/config/copy/${f}`)).join('\n');
const copySource = JSON.parse(read('docs/engineering/v10/copy-source.json'));

// 每条：[审计编号, 文案键, 不应再调用 showToast 的源文件]
const REMOVED = [
  ['P0-07', 'X-WORK.saved', ['src/ui/components/image-preview.js']],
  ['P0-08', 'X-LIBSWITCH.switchedToast', ['src/ui/screens/library/switch.js']],
  ['P0-09', 'X-BACKUP.exported', ['src/ui/screens/mine/backup.js', 'src/ui/screens/block/index.js']],
  ['P0-10', 'R-H05.oldGroupSavedToast', ['src/ui/screens/session/index.js']],
  ['P0-11', 'R-W15.zeroToast', ['src/ui/screens/write/end.js']],
  ['P0-12', 'R-B06.cancelled', ['src/ui/screens/mine/backup.js']],
  ['P0-13', 'X-SETTINGS.textSizeNotice', ['src/ui/screens/mine/settings.js', 'src/app.js']],
  ['P0-14', 'R-Q05.added', ['src/ui/components/query/QuerySheet.js']],
];

function allKeys() {
  const out = new Set();
  for (const group of ['entries', 'extra']) {
    for (const [id, entry] of Object.entries(copySource[group] || {})) {
      for (const slot of Object.keys(entry.slots || {})) out.add(`${id}.${slot}`);
    }
  }
  return out;
}

for (const [id, key, files] of REMOVED) {
  test(`${id}: 「${key}」 is gone from the copy tables, copy-source.json and the UI sources`, () => {
    assert.ok(!allKeys().has(key), 'still registered in copy-source.json');
    assert.ok(!copyFiles.includes(`'${key}'`), 'still defined in src/config/copy/*');
    for (const file of files) {
      assert.ok(!read(file).includes(key), `${file} still mentions ${key}`);
    }
  });
}

test('P0-08 / P0-09 / P0-10 / P0-11 / P0-14: the screens no longer import the toast at all (nothing left to confirm with a toast)', () => {
  for (const file of [
    'src/ui/screens/library/switch.js', 'src/ui/screens/session/index.js', 'src/ui/screens/write/end.js',
    'src/ui/components/query/QuerySheet.js', 'src/ui/components/image-preview.js', 'src/ui/screens/block/index.js',
  ]) {
    assert.ok(!/showToast\(/.test(read(file)), `${file} still calls showToast`);
  }
});

test('P0-13: no start-up notice about text size; the legacy large flag is still cleared silently', () => {
  assert.ok(!/showTextSizeNoticeOnce|TEXT_SIZE_NOTICE_MS/.test(read('src/app.js') + read('src/ui/screens/mine/settings.js')));
});
