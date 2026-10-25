import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// 用固定 xcresulttool 输出验证门禁判定，避免测试本身启动模拟器。
function summary(results) {
  const dir = mkdtempSync(join(tmpdir(), 'shizi-flow-summary-'));
  try {
    writeFileSync(join(dir, 'xcrun'), '#!/bin/sh\nprintf \'%s\' "$QA_XCRESULT_FIXTURE"\n', { mode: 0o755 });
    const testNodes = [{ nodeType: 'Test Suite', name: 'Flows', children: results.map(([result, msg]) => ({
      nodeType: 'Test Case', name: 'testFlow()', result,
      children: msg ? [{ nodeType: 'Failure Message', name: msg }] : [],
    })) }];
    const out = join(dir, 'flows.md');
    const run = spawnSync(process.execPath, [resolve('ios/ShiziApp/scripts/native-ui/flows-summary.mjs'), 'fixture.xcresult', out], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, QA_XCRESULT_FIXTURE: JSON.stringify({ testNodes }) },
    });
    return { status: run.status, stderr: run.stderr, markdown: readFileSync(out, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('native flow gate: passing cases may coexist with pending page skeletons', () => {
  const run = summary([['Passed'], ['Skipped']]);
  assert.equal(run.status, 0);
  assert.match(run.markdown, /通过 1/);
  assert.match(run.markdown, /待办（骨架，页面卡填）1/);
});

test('native flow gate: failures and expired expected-failure wrappers block the gate', () => {
  for (const message of ['XCTAssertEqual failed', 'Expected failure not encountered']) {
    assert.equal(summary([['Failed', message]]).status, 1, message);
  }
});

test('native flow gate: empty bundles and all-pending bundles cannot pass', () => {
  for (const results of [[], [['Skipped']]]) {
    const run = summary(results);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no executable flow cases/);
  }
});
