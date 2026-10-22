// 金标准 · 卡片 / 题库（src/core/cards.js、src/data/deck.js；B4.3）。
// 题库每隔 7 行取一行、加上全部有语境覆盖的字对应的行（套用真实覆盖）的卡片进夹具——Swift 的 buildCards 必须逐字段、逐键序一致；另有随机语境覆盖与题面模型的固定种子取样。全量 7218 行另由 deck.summary 与 verify:core-diff 的随机差分（deck.cardsOfRow）核对。
import { generatedCases } from '../lib/b43-golden.mjs';
import { deckSources } from '../../build_core_config.mjs';

function hand() {
  const R = [];
  const deck = deckSources();
  // 全部行每隔 7 行取一行 + 全部有覆盖的字对应的行（卡片构建逐行独立，所以抽样也能覆盖每种覆盖分支）
  const overridden = new Set(Object.keys(deck.overrides));
  deck.seed.forEach((row, index) => {
    const target = row.target || Array.from(row.ans)[Number(row.ci) || 0];
    if (index % 7 === 0 || overridden.has(target)) R.push({ op: 'deck.cardsOfRow', args: { index } });
  });
  R.push({ op: 'deck.summary', args: {} });
  R.push({ op: 'cards.libraries', args: {} });
  for (const c of ['人', '口', '𬇕', '拾', '越', '慢', '耿']) {
    R.push({ op: 'deck.cardForKey', args: { key: `base:${c}` } });
    R.push({ op: 'deck.isPracticable', args: { key: `base:${c}` } });
  }
  return R;
}

export default {
  id: 'cards',
  source: 'src/core/cards.js、src/data/deck.js',
  build({ withTZ, opCases }) {
    return { groups: [withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases([...hand(), ...generatedCases('cards', { seed: 4303, perOp: 16 })]) }))] };
  },
};
