// B1 原生数据层量测探针（01 §4.1）：放进模拟器 App 数据容器的 Documents/shizi-smoke-probe.js，DEBUG 壳以
//   xcrun simctl launch <udid> com.eimaa.shizi -shizi-smoke -shizi-smoke-stage probe -shizi-probe-arg <状态>
// 冷启动后执行（ios/ShiziApp/ShiziApp/NativeSmoke.swift runSmokeProbe），结果写 Documents/shizi-native-smoke.json。
// 整个文件是一个函数表达式，不是模块；不进 App 包、不进壳清单。旧版（localStorage）壳同样能跑，用来对比。
// 状态：
//   info          启动打点（app-eval → store-native → store → mounted → first-frame）、store.status.backend / usage、原生 stats
//   write:<n>     经真实 store.commit 连写 n 次「判断」形状的提交（当月 records + 当月 ink + sched，与写字页判断同一组键），
//                 再写 n 次小提交（settings 一个开关），量每次 commit 的耗时（含同步桥与 SQLite 事务）
//   backup        按「我的 › 备份」同一套函数导出（buildBackupV2 + serializeBackup）→ inspectBackup → restoreFromBackup（保护副本 +
//                 替换）→ 核对白名单键逐字不变（backupMeta 按规则换成结论）→ dropSafety；量导出与恢复耗时
(async function probe(STATE) {
  if (window.__shiziProbeRunning) return;
  window.__shiziProbeRunning = true;
  const native = window.webkit.messageHandlers.shiziNative;
  const result = { state: STATE, ok: true };
  const post = () => native.postMessage({ type: 'nativeSmokeResult', payload: JSON.stringify(result) });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const summarize = list => {
    const s = list.slice().sort((a, b) => a - b);
    const pick = q => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 100) / 100;
    return { n: s.length, min: pick(0), p50: pick(0.5), p90: pick(0.9), max: pick(1), mean: Math.round((s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)) * 100) / 100 };
  };
  try {
    const end = Date.now() + 15000;
    while (!window.__shiziTest && Date.now() < end) await sleep(50);
    const T = window.__shiziTest;
    if (!T) throw new Error('no test hooks');
    await sleep(300);
    const marks = {};
    for (const m of performance.getEntriesByType('mark')) if (m.name.indexOf('shizi:') === 0) marks[m.name.slice(6)] = Math.round(m.startTime * 10) / 10;
    result.marks = marks;
    const fcp = performance.getEntriesByType('paint').filter(p => p.name === 'first-contentful-paint')[0];
    result.fcp = fcp ? Math.round(fcp.startTime) : null;
    const status = T.getStatus();
    result.backend = status.backend || null;
    result.available = status.available;
    result.blocked = status.blocked;
    result.corruptNotice = status.corruptNotice;
    result.lastRepair = status.lastRepair ? { txn: status.lastRepair.txn, quarantined: status.lastRepair.quarantined.length } : null;
    result.usage = status.usage ? { total: status.usage.total, ratio: status.usage.ratio, level: status.usage.level } : null;
    const keys = T.getRawKeys('shizi.', { includeRoute: true });
    result.keys = Object.keys(keys).length;
    result.chars = Object.keys(keys).reduce((n, k) => n + keys[k].length, 0);
    try {
      const resp = await fetch('/__native/store/v1/stats', { method: 'POST', body: '{}' });
      result.stats = await resp.json();
    } catch (error) {
      result.stats = null;
    }
    if (result.stats && result.stats.ok) {
      // 拆分：原生 load 的往返与原生自身耗时；一次约 100KB 的 apply（写一个临时 aux 键再删掉）的往返与原生耗时。
      const { createXhrTransport, checksum } = await import('./src/platform/native-store.js');
      const t = createXhrTransport({ win: window });
      let a = performance.now();
      const loaded = await t.callAsync('load', {});
      result.loadSplit = { roundtripMs: Math.round(performance.now() - a), nativeMs: Math.round(loaded.ms) };
      const value = JSON.stringify({ x: 'y'.repeat(100000) });
      const runs = [];
      for (let i = 0; i < 10; i += 1) {
        a = performance.now();
        const sum = checksum(value);
        const b = performance.now();
        const res = t.callSync('apply', { ops: [['shizi.b1probe', value, sum]] });
        runs.push({ checksumMs: b - a, roundtripMs: performance.now() - b, nativeMs: res.ms });
      }
      t.callSync('apply', { ops: [['shizi.b1probe', null]] });
      result.apply100k = {
        checksum: summarize(runs.map(r => r.checksumMs)),
        roundtrip: summarize(runs.map(r => r.roundtripMs)),
        native: summarize(runs.map(r => r.nativeMs)),
      };
    }
    const parts = String(STATE).split(':');
    if (parts[0] === 'write') {
      const n = Math.max(1, Number(parts[1]) || 10);
      const { getStore, setInk, getInk } = await import('./src/store/store.js');
      const { localDay } = await import('./src/core/dates.js');
      const store = getStore();
      const state = store.getState();
      const months = Object.keys(state.records).sort();
      let template = null;
      for (let i = months.length - 1; i >= 0 && !template; i -= 1) {
        const v = state.records[months[i]];
        const list = Array.isArray(v) ? v : v.kept || [];
        for (let j = list.length - 1; j >= 0; j -= 1) if (list[j].kind === 'judged' && getInk(state, list[j])) { template = list[j]; break; }
      }
      if (!template) throw new Error('no judged record with ink to copy');
      const ink = getInk(state, template);
      const sched = state.sched && state.sched[template.cardKey];
      const big = [];
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        const r = store.commit('b1-probe-judge', (draft, ctx) => {
          const day = localDay(ctx.now);
          const month = day.slice(0, 7);
          const rec = Object.assign({}, template, { id: ctx.nextId('r'), at: ctx.now, localDay: day });
          delete rec.inkId;
          const list = Array.isArray(draft.records[month]) ? draft.records[month] : [];
          draft.records[month] = list.concat([rec]);
          setInk(draft, rec, ink);
          if (sched) draft.sched = Object.assign({}, draft.sched, { [template.cardKey]: Object.assign({}, sched, { lastJudgedAt: ctx.now }) });
        });
        big.push(performance.now() - t0);
        if (!r.ok) throw new Error('commit failed: ' + JSON.stringify(r.error));
        await sleep(20);
      }
      const small = [];
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        const r = store.commit('b1-probe-setting', draft => {
          draft.settings = Object.assign({}, draft.settings, { sound: !(draft.settings && draft.settings.sound) });
        });
        small.push(performance.now() - t0);
        if (!r.ok) throw new Error('small commit failed: ' + JSON.stringify(r.error));
        await sleep(20);
      }
      result.judgeCommit = summarize(big);
      result.smallCommit = summarize(small);
      const after = store.getState();
      const month = localDay(Date.now()).slice(0, 7);
      result.monthBytes = {
        records: JSON.stringify(after.records[month] || []).length,
        ink: JSON.stringify((after.ink || {})[month] || {}).length,
        sched: JSON.stringify(after.sched || {}).length,
      };
    }
    if (parts[0] === 'backup') {
      const { getStore } = await import('./src/store/store.js');
      const B = await import('./src/core/backup.js');
      const { BACKUP_WHITELIST, KEYS } = await import('./src/core/schema.js');
      const store = getStore();
      const isWhite = key => key !== KEYS.backupMeta && key.indexOf('shizi.v2.') === 0 && BACKUP_WHITELIST.some(d => key === 'shizi.v2.' + d || key.indexOf('shizi.v2.' + d + '.') === 0);
      const before = T.getRawKeys('shizi.v2.');
      const t0 = performance.now();
      const text = B.serializeBackup(B.buildBackupV2(store.getState(), { now: Date.now(), serial: store.serial }));
      const t1 = performance.now();
      const report = B.inspectBackup(text);
      if (!report.ok) throw new Error('inspect failed: ' + JSON.stringify(report));
      const r = B.restoreFromBackup(store, report, { now: Date.now() });
      const t2 = performance.now();
      if (!r.ok) throw new Error('restore failed: ' + JSON.stringify(r));
      const after = T.getRawKeys('shizi.v2.');
      const diff = [];
      const added = [];
      for (const key of new Set(Object.keys(before).concat(Object.keys(after)))) {
        if (!isWhite(key)) continue;
        // 没有 meta 的旧数据：导出时 buildBackupV2 按规则补一份 meta，恢复后多出这个键（不算不一致）
        if (key === KEYS.meta && before[key] === undefined) {
          added.push(key);
          continue;
        }
        if (before[key] !== after[key]) diff.push(key);
      }
      const drop = B.dropSafety(store);
      result.backup = {
        bytes: text.length,
        exportMs: Math.round(t1 - t0),
        restoreMs: Math.round(t2 - t1),
        whitelistKeys: Object.keys(before).filter(isWhite).length,
        diff,
        added,
        safetyDropped: !!(drop && drop.ok),
        safetyGone: T.getRawKeys('shizi.v2.')[KEYS.safety] === undefined,
      };
      if (diff.length) result.ok = false;
    }
  } catch (error) {
    result.ok = false;
    result.error = String((error && error.stack) || error);
  }
  post();
})
