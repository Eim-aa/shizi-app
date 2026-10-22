// 金标准 · App 已经写下的原生库（B4.4；计划 §4.4「SQLite 里的现有数据（JS 写的）Swift 读」）。
// JS 一侧：在原生替身（FakeNativeDb，与 App 的 NativeStore 同一协议）上 seed 状态——磁盘上的键 / 原始字串就是 App 里 JS 经
// NativeStoreBridge apply 写进 SQLite 的内容（含旧 ink 月键、坏值、残留路由提示）；再 load 一次得到 JS 读出的状态与启动报告。
// Swift 的 SQLiteStoreTests：把这些行经 SQLiteKVStore.apply（与 App NativeStore.apply 同一份代码）写进真的 SQLite 文件，
// 用 ShiziCore Store 打开，读出的状态 / 启动报告 / 迁移后的库必须与 JS 相同。
import { createJsEngine } from '../../core-diff/lib/js-engine.mjs';
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import { storeState, STORE_T0 } from '../../core-diff/domains/store.mjs';
import { KEYS, inkKey } from '../../../src/core/schema.js';

export default {
  id: 'native-rows',
  source: 'src/store/store.js + test/store/native-fake.mjs（JS 参考引擎）',
  build({ withTZ }) {
    return withTZ('Asia/Shanghai', () => {
      const cases = [];
      let seed = 100;
      while (cases.length < 8 && seed < 400) {
        seed += 1;
        const s = storeState(makeCtx(rng(seed)));
        const e = createJsEngine();
        e.handle({ op: 'store.open', args: { backend: 'native', clock: STORE_T0 } });
        const r = e.handle({ op: 'store.seed', args: { state: s } });
        if (!r.reply.ok) continue;
        const rows = { ...r.state.store.disk };
        // 一半用例把墨迹改回 schema 1 的旧月键（B2.3 之前的库），并放一个坏值与路由提示
        if (cases.length % 2) {
          const tables = {};
          for (const k of Object.keys(rows)) {
            const m = /^shizi\.v2\.ink\.(\d{4}-\d{2})\.(r\d+)$/.exec(k);
            if (!m) continue;
            (tables[m[1]] = tables[m[1]] || {})[m[2]] = JSON.parse(rows[k]);
            delete rows[k];
          }
          for (const m of Object.keys(tables)) rows[inkKey(m)] = JSON.stringify(tables[m]);
          rows[KEYS.custom] = '{"added":5}';
          rows[KEYS.route] = '{"screen":"home"}';
        }
        const boot = createJsEngine();
        const opened = boot.handle({ op: 'store.open', args: { backend: 'native', clock: STORE_T0, disk: rows } });
        cases.push({ label: `seed ${seed}`, rows, load: opened.reply, state: opened.state.store.state, status: opened.state.store.status, disk: opened.state.store.disk, serial: opened.state.store.serial });
      }
      return { cases };
    });
  },
};
