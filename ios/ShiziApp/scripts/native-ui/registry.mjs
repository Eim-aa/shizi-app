// QA-H1 数据驱动（B3.3）：状态、元素键、具名检查都按目录扫描——页面卡只加自己的文件，不改共享文件。
//
//   ShiziUITests/States/<状态>.json        状态夹具（路由 / 造数据 / 点按 / 时钟；字段见 ShiziApp/QAFixtures.swift，op 见 QAOps.swift），原生取证、XCUITest 同一份
//   ShiziUITests/Baseline/<状态>_<外观>_<字号>.png|json   冻结的原生基线（D84：取代网页参考；verify-native-ui.sh --update-baseline 重录）
//   scripts/native-ui/keys/<屏>.mjs        语义键：export const KEYS = [{key, native:[…]}]（elements.mjs 配对）
//   scripts/native-ui/checks/<屏>.mjs      具名检查：export const CHECKS = […]、可选 COVERED_ELSEWHERE
//   parity.config.json                     全局的容差
//
// 夹具里 native: true 的状态才跑逐屏对比（页面卡原生化合并时改成 true）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const STATES_DIR = join(here, '..', '..', 'ShiziUITests', 'States');
export const BASELINE_DIR = join(here, '..', '..', 'ShiziUITests', 'Baseline');
export const KEYS_DIR = join(here, 'keys');
export const CHECKS_DIR = join(here, 'checks');

const files = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(ext) && !f.startsWith('_')).sort() : []);

/** 全部状态夹具（不含下划线开头的内部夹具与 _ops / _templates），按名字排序。 */
export function loadFixtures(dir = STATES_DIR) {
  const list = files(dir, '.json').map(f => {
    const name = f.slice(0, -5);
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (fx.state !== name) throw new Error(`States/${f}: "state" must be "${name}" (got ${JSON.stringify(fx.state)})`);
    return fx;
  });
  // 取证顺序：夹具的 order（数字，小的在前；缺省排在最后，再按名字）。B2 的 25 个状态保持原来的顺序——造数据时钟钉住时「N 天后再见」靠逐位一致，
  // 同一次启动里前面跑过什么状态也算在内（B2.9b）。
  return list.sort((a, b) => (a.order ?? 1e6) - (b.order ?? 1e6) || (a.state < b.state ? -1 : 1));
}

export const FIXTURES = loadFixtures();
export const DEFAULT_SIZES = ['L', 'XXXL'];
export const AX_SIZES_OF_MAIN = ['AX3', 'AX5'];
/** 一个状态要取的字号档：夹具 sizes 优先（例：只在 AX 档才出现的弹层）；否则 L / XXXL，ax: true 再加 AX3 / AX5。 */
export const sizesOf = fx => (Array.isArray(fx.sizes) ? fx.sizes : fx.ax === true ? [...DEFAULT_SIZES, ...AX_SIZES_OF_MAIN] : DEFAULT_SIZES);
/** 跑逐屏对比的状态（parity != false 且 native === true）。 */
export const STATES = FIXTURES.filter(f => f.parity !== false && f.native === true).map(f => f.state);
/** 某字号档要取的状态（native = true 时只取原生已实现的）。 */
export const statesForSize = (size, { native = false } = {}) => FIXTURES.filter(f => f.parity !== false && (!native || f.native === true) && sizesOf(f).includes(size)).map(f => f.state);
/** 含 AX 档的状态（AX-01 等只在 AX 档跑的检查用）。 */
export const AX_STATES = FIXTURES.filter(f => f.parity !== false && f.native === true && sizesOf(f).some(s => s.startsWith('AX'))).map(f => f.state);
export const STATE_NAMES = Object.fromEntries(FIXTURES.map(f => [f.state, f.name || f.state]));
export const fixtureOf = Object.fromEntries(FIXTURES.map(f => [f.state, f]));

/** keys/*.mjs 的 KEYS 合并（文件名顺序）。 */
export async function loadKeys() {
  const out = [];
  for (const f of files(KEYS_DIR, '.mjs')) out.push(...((await import(join(KEYS_DIR, f))).KEYS || []));
  return out;
}

/** checks/*.mjs 合并。 */
export async function loadChecks() {
  const CHECKS = [];
  const COVERED_ELSEWHERE = {};
  for (const f of files(CHECKS_DIR, '.mjs')) {
    const m = await import(join(CHECKS_DIR, f));
    CHECKS.push(...(m.CHECKS || []));
    Object.assign(COVERED_ELSEWHERE, m.COVERED_ELSEWHERE || {});
  }
  return { CHECKS, COVERED_ELSEWHERE };
}
