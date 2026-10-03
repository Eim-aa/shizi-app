// M6-4 文案审计（scripts/verify_copy.mjs 6–12 项）的单元测试：扫描器本身会不会漏、会不会误报。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PATHS,
  stringLiterals,
  cssCjkLines,
  hardcodeExcluded,
  isQuoteJoiner,
  checkHardcoded,
  checkBannedInSource,
  checkNumerals,
  checkNumeralHelpers,
  checkExportWord,
  checkPlaceholders,
  checkTodo,
  checkNoPlaceholderText,
  PLACEHOLDER_TEXT_RE,
  checkMirrors,
  collectSourceLiterals,
  registeredPNumbers,
  HARDCODE_ALLOW,
} from '../../scripts/verify_copy.mjs';
import { SCREENS, t } from '../../src/config/copy/index.js';
import { imageMaxChars } from '../../src/config/policy.js';

const source = JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const texts = (src) => stringLiterals(src).map((l) => l.text);

test('audit lexer: comments and regex literals are skipped; strings and template pieces are collected', () => {
  const src = [
    "// 注释里的中文不算 '引号'",
    '/* 块注释「也不算」 */',
    "const a = '写对了'; const b = \"写错\";",
    'const re = /[㐀-鿿]/g; const half = total / 2 / count;',
    'const t = `还有 ${n} 个字${ok ? `「${c}」` : \'无\'}`;',
    'const css = `.x{color:red} /* 样式注释 */ .y{}`;',
    "if (x) return /'/.test(s) ? '是' : '否';",
  ].join('\n');
  const got = texts(src);
  assert.ok(got.includes('写对了'));
  assert.ok(got.includes('写错'));
  assert.ok(got.includes('还有 '));
  assert.ok(got.includes(' 个字'));
  assert.ok(got.includes('「') && got.includes('」'));
  assert.ok(got.includes('无'));
  assert.ok(got.includes('是') && got.includes('否'), 'regex after return does not swallow the rest of the line');
  assert.ok(!got.some((t) => t.includes('注释')), 'comments (incl. CSS comments in templates) are not literals');
  assert.ok(!got.some((t) => t.includes('㐀')), 'regex character classes are not literals');
  const lines = stringLiterals(src).filter((l) => l.text === '写对了').map((l) => l.line);
  assert.deepEqual(lines, [3]);
});

test('audit lexer: htm templates expose their static text', () => {
  const got = texts('html`<p class="a">${x}开始写</p>`');
  assert.ok(got.some((t) => t.includes('开始写')));
  assert.deepEqual(cssCjkLines('/* 说明 */\n.a{content:"拾字"}').map((l) => l.line), [2]);
});

test('audit: excluded paths and quote joiners', () => {
  assert.equal(hardcodeExcluded('src/config/copy/home.js'), true);
  assert.equal(hardcodeExcluded('src/ui/screens/_demo/sub.js'), true);
  assert.equal(hardcodeExcluded('src/ui/dev/palette.js'), true);
  assert.equal(hardcodeExcluded('src/ui/screens/home/index.js'), false);
  assert.equal(isQuoteJoiner('「'), true);
  assert.equal(isQuoteJoiner('」'), true);
  assert.equal(isQuoteJoiner('「写」'), false);
});

test('audit: a hardcoded Chinese literal is reported; allowlist entries must still match', () => {
  const lits = [
    { file: 'src/ui/screens/home/index.js', line: 9, text: '今天写几个字', kind: 'string' },
    { file: 'src/ui/screens/home/index.js', line: 10, text: 'plain ascii', kind: 'string' },
    { file: 'src/ui/screens/result/index.js', line: 11, text: '「', kind: 'template' },
    { file: 'src/ui/dev/palette.js', line: 12, text: '开发标签', kind: 'string' },
    { file: 'src/core/dates.js', line: 13, text: '二', kind: 'string' },
  ];
  const allow = [
    { file: 'src/core/dates.js', texts: ['二'], why: 'test' },
    { file: 'src/core/gone.js', any: true, why: 'test' },
  ];
  const { errors, allowed } = checkHardcoded(lits, allow);
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], /home\/index\.js:9: hardcoded Chinese literal 「今天写几个字」/);
  assert.match(errors[1], /gone\.js.*stale allowlist/);
  assert.equal(allowed, 2);
  for (const a of HARDCODE_ALLOW) assert.ok(a.why && a.why.length > 4, a.file + ' has a reason');
});

test('audit: the real src/ tree has zero unallowlisted hardcoded Chinese', () => {
  const { errors } = checkHardcoded(collectSourceLiterals());
  assert.deepEqual(errors, []);
});

test('audit: banned words are caught in source literals', () => {
  const lits = [{ file: 'src/ui/screens/mine/index.js', line: 3, text: '今天盖章了', kind: 'string' }];
  assert.equal(checkBannedInSource(lits, source.bannedWords).length, 1);
  for (const w of ['背景音', '补记', '拍字', '字卡', '里程碑', '收字', '点拨', '盖章', '校准']) assert.ok(source.bannedWords.includes(w), w);
});

test('audit: Chinese numerals in UI copy are rejected unless the key is allowlisted', () => {
  const modules = { mine: { 'X-MINE.bad': '写了三次', 'X-MINE.ok': '一个字', 'X-MINE.big': '共二十个', 'R-M06.section1': '一 · 今年有记录的字' } };
  const { errors } = checkNumerals(modules, source);
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('X-MINE.bad')));
  assert.ok(errors.some((e) => e.startsWith('X-MINE.big')));
  assert.deepEqual(checkNumerals(SCREENS, source).errors, []);
  assert.deepEqual(checkNumeralHelpers(), []);
});

test('audit: 「导出」 only as the button name unless registered', () => {
  const s = clone(source);
  const modules = { backup: { 'X-BACKUP.a': '导出备份文件', 'X-BACKUP.b': '先导出记录' } };
  s.exportWordAllow = {};
  const errors = checkExportWord(modules, s);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /X-BACKUP\.b/);
  s.exportWordAllow = { 'X-BACKUP.zzz': 'reason' };
  assert.ok(checkExportWord(modules, s).some((e) => /stale/.test(e)));
  assert.deepEqual(checkExportWord(SCREENS, source), []);
});

test('audit: placeholders must be registered and well-formed', () => {
  const s = clone(source);
  const modules = { home: { 'X-HOME.a': '还有 {N} 个字', 'X-HOME.b': '{日期} 写的', 'X-HOME.c': '{n} / {total}' } };
  const errors = checkPlaceholders(modules, s).filter((e) => e.startsWith('X-HOME'));
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.deepEqual(checkPlaceholders(SCREENS, source), []);
});

test('audit: TODO keys must be registered under P55/P66/P76/P90', () => {
  const registered = registeredPNumbers(fs.readFileSync(PATHS.pending, 'utf8'));
  assert.deepEqual(checkTodo(SCREENS, source, registered).errors, []);
  // F2 之后 json.todo 为空；用合成的 TODO 槽验证登记规则本身仍然生效
  assert.deepEqual(source.todo, []);
  const withTodo = { ...SCREENS, images: { ...SCREENS.images, 'R-I01.overLimit': 'TODO: 说明' } };
  const s = clone(source);
  s.todo = ['R-I01.overLimit'];
  s.todoRegistry = { 'R-I01.overLimit': 'P25' };
  assert.ok(checkTodo(withTodo, s, registered).errors.some((e) => /R-I01\.overLimit: TODO registered under P25/.test(e)));
  s.todoRegistry = {};
  assert.ok(checkTodo(withTodo, s, registered).errors.some((e) => /R-I01\.overLimit: TODO key has no P number/.test(e)));
  s.todoRegistry = { 'R-I01.overLimit': 'P55' };
  const ok = checkTodo(withTodo, s, registered);
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => /P55 →/.test(w)));
});

test('audit F2: runtime copy must not contain TODO / TBD / FIXME / 待补 / 占位 (fails on the old TODO values, green now)', () => {
  assert.deepEqual(checkNoPlaceholderText(SCREENS), [], 'current copy is placeholder-free');
  // 修复前的三个槽原值：门禁必须能抓到
  const oldValues = {
    common: { 'X-SYS.corruptNotice': 'TODO: 启动时发现坏数据的顶部提示（P55）', 'X-SYS.blockMigration': 'TODO: 旧数据没能导入时阻断页补充说明（P55，M5-6 迁移变体）' },
    images: { 'R-I01.overLimit': 'TODO: 超过 80 个字的图片说明（P25）' },
  };
  assert.equal(checkNoPlaceholderText(oldValues).length, 3);
  const words = { x: { a: 'todo later', b: '内容 TBD', c: 'fixme', d: '地址待补', e: '这里是占位', f: ['第一行', '第二行 Todo'], g: '一切正常' } };
  const errors = checkNoPlaceholderText(words);
  assert.equal(errors.length, 6, errors.join('\n'));
  assert.ok(!errors.some((e) => e.startsWith('g ')));
  assert.ok(PLACEHOLDER_TEXT_RE.test('FixMe'));
});

test('audit F2: the three former TODO slots say something concrete and 80 matches policy.imageMaxChars', () => {
  for (const key of ['X-SYS.corruptNotice', 'X-SYS.blockMigration', 'R-I01.overLimit']) {
    const v = t(key);
    assert.equal(typeof v, 'string');
    assert.ok(v.length >= 20, key + ' is a real sentence');
    assert.ok(!/P\d{2}|M\d|TODO/.test(v), key + ' exposes no engineering ids');
  }
  assert.ok(t('R-I01.overLimit').includes(String(imageMaxChars)), 'overLimit names the real cap');
  assert.match(t('X-SYS.blockMigration'), /没有丢/);
  assert.match(t('X-SYS.corruptNotice'), /备份文件/);
});

test('audit: core mirror constants equal their copy keys', async () => {
  assert.deepEqual(await checkMirrors(SCREENS), []);
  const drifted = { ...SCREENS, write: { ...SCREENS.write, 'X-PROMPT.fallbackHint': '别的' } };
  assert.equal((await checkMirrors(drifted)).length, 1);
});
