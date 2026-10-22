// QA-H1：把 XCUITest 结果包（xcresult）整理成通过 / 失败清单。
// usage: node flows-summary.mjs <xcresult> <输出 md>
//   结果分四类：通过；预期失败（待修，XCTExpectFailure 里的已知问题，失败说明以「NF-xx / NP-xx 待修」开头）；
//   意外通过（已知问题包装里没有失败 = 可能已修好，严格模式下 XCTest 报失败「Expected failure … not encountered」）；失败（回归）。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [bundle, out] = process.argv.slice(2);
const json = JSON.parse(execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const cases = [];
(function walk(n, suite) {
  if (n.nodeType === 'Test Suite') suite = n.name;
  if (n.nodeType === 'Test Case') {
    const msgs = (n.children || []).filter(c => c.nodeType === 'Failure Message').map(c => c.name);
    let kind = 'pass';
    if (n.result === 'Expected Failure') kind = 'expected';
    else if (n.result === 'Failed') kind = msgs.some(m => /expected failure|预期|not encountered|未遇到/i.test(m)) && msgs.every(m => /expected failure|not encountered|未遇到/i.test(m)) ? 'unexpected-pass' : 'fail';
    else if (n.result === 'Skipped') kind = 'skipped';
    cases.push({ suite, name: n.name.replace(/\(\)$/, ''), kind, secs: Math.round(n.durationInSeconds || 0), msgs });
    return;
  }
  for (const c of n.children || []) walk(c, suite);
})({ children: json.testNodes });

const count = k => cases.filter(c => c.kind === k).length;
const LABEL = { pass: '通过', expected: '预期失败（待修）', 'unexpected-pass': '意外通过（已知问题可能已修好）', fail: '**失败**', skipped: '待办（骨架）' };
const md = ['# 原生写字页流程测试（XCUITest · ShiziUITests）', '',
  `- 用例 ${cases.length - count('skipped')}：通过 ${count('pass')}、预期失败（待修）${count('expected')}、意外通过 ${count('unexpected-pass')}、失败 ${count('fail')}${count('skipped') ? `；待办（骨架，页面卡填）${count('skipped')}` : ''}`, '',
  '| 用例 | 结果 | 秒 | 说明 |', '|---|---|---|---|'];
for (const c of cases) md.push(`| ${c.suite}.${c.name} | ${LABEL[c.kind]} | ${c.secs} | ${c.msgs.slice(0, 3).map(m => m.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 220)).join('<br>')} |`);
writeFileSync(out, md.join('\n') + '\n');
// B3.3：流程测试骨架（B3B4 §5.2）里还没填的用例是 XCTSkip（「待办」），不算在用例数里，另报一个数
console.log(`flows: ${cases.length - count('skipped')} cases — pass ${count('pass')}, expected-fail ${count('expected')}, unexpected-pass ${count('unexpected-pass')}, FAIL ${count('fail')}, pending ${count('skipped')}`);
for (const c of cases.filter(x => x.kind === 'fail' || x.kind === 'unexpected-pass')) console.log(`  ${c.kind === 'fail' ? 'FAIL' : 'UNEXPECTED PASS'} ${c.suite}.${c.name}: ${(c.msgs[0] || '').split('\n')[0].slice(0, 200)}`);
process.exitCode = count('fail') ? 1 : 0;
