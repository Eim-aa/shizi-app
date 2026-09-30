// vendor/ 固定文件：SHA-256 与 THIRD_PARTY_NOTICES.md 登记一致；无裸 from"preact"；ui.js 聚合导出齐全。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDORED_SHA256, hasBarePreactImport, rewriteModule } from '../scripts/vendor_preact.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

test('vendored files match pinned SHA-256 and are registered in THIRD_PARTY_NOTICES.md', () => {
  for (const [rel, want] of Object.entries(VENDORED_SHA256)) {
    const got = createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
    assert.equal(got, want, `${rel} sha256`);
    assert.ok(notices.includes(want), `${rel} sha256 ${want} missing from THIRD_PARTY_NOTICES.md`);
  }
});

test('no vendored module keeps a bare "preact" specifier', () => {
  for (const rel of ['vendor/preact.module.js', 'vendor/preact-hooks.module.js', 'vendor/htm.module.js', 'vendor/ui.js']) {
    assert.equal(hasBarePreactImport(readFileSync(join(ROOT, rel), 'utf8')), false, rel);
  }
});

test('import rewrite is idempotent', () => {
  const upstream = 'import{options as n}from"preact";var x=1;\n//# sourceMappingURL=hooks.module.js.map\n';
  const once = rewriteModule(upstream, { rewritePreact: true });
  assert.equal(once, 'import{options as n}from"./preact.module.js";var x=1;\n');
  assert.equal(rewriteModule(once, { rewritePreact: true }), once);
});

test('vendor/ui.js exposes the agreed API', async () => {
  const ui = await import('../vendor/ui.js');
  const fns = ['h', 'render', 'Fragment', 'createContext', 'useState', 'useEffect', 'useLayoutEffect',
    'useRef', 'useMemo', 'useCallback', 'useReducer', 'useContext', 'html'];
  for (const name of fns) assert.equal(typeof ui[name], 'function', name);
  assert.equal(typeof ui.options, 'object');
  const vnode = ui.html`<p class="x">${'字'}</p>`;
  assert.equal(vnode.type, 'p');
  assert.equal(vnode.props.class, 'x');
});
