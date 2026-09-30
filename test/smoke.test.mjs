// verify:unit 冒烟：确认 node:test 运行器与 ES 模块解析可用。
import test from 'node:test';
import assert from 'node:assert/strict';

test('node:test runner is wired', () => {
  assert.equal(1 + 1, 2);
});
