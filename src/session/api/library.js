// App API · 字库首页（B3.5b；view.library、library.startToday）。
// 视图 op 返回页面渲染用的同一份数据（src/session/views/library.js libraryPageView，文案是引用 + 数据）；
// 「今日练习」是首页主按钮在该状态下的同一动作（网页 ui/screens/home/index.js startToday = resumeOther：先续今天的练习（A 槽），没有就开下一组；不碰自己选的那一组）。
// 会话层不导入 UI：开写字页 / 没字页用注入的网页路由 ctx.nav.push（网页 session/index.js openWrite、session/none.js openNonePage 同一个 nav.push）；
// 失败原样回 {ok:false, error}（D07：原生就地三段式，不动、重试只记一次）。契约 test/ui/native-library.test.mjs（网页路径 == API 路径）。
// 导航（搜索框 / 练习范围 / 区详情 / 全部）经通用的 nav.* op，目标屏名由视图给（views/library.js LIBRARY_PAGE_ROUTES）。

import { libraryPageView } from '../views/library.js';
import * as core from '../../core/session-start.js';
import { deckAdapter } from '../../data/deck.js';
import { localDay } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';

/** 从字库「今日练习」开的组，写完结果页的离开按钮是「回到字库」（R-R06 leaveLibrary；网页 LIBRARY_TODAY_SOURCE）。 */
export const LIBRARY_TODAY_SOURCE = Object.freeze({ view: 'library' });
const WRITE_SCREEN = 'write';
const NONE_SCREEN = 'session-none';

/** 一次「今日练习」：首页 startToday → resumeOther 的会话部分（resumeSlot('A')，没有再 startA）。返回与网页同一形状的结果。 */
export function startTodayWith({ store, nav, now = envNow, deck = deckAdapter, source = LIBRARY_TODAY_SOURCE }) {
  const open = slot => nav.push(WRITE_SCREEN, { slot });
  const r = core.resumeSlot(store, 'A', { now });
  if (!r.ok) return r;
  if (r.session) {
    open('A');
    return { ...r, opened: 'resume' };
  }
  // startA
  const resumable = core.resumableSession(store.getState(), 'A', { now });
  if (resumable) {
    open('A');
    return { ok: true, opened: 'resume', session: resumable };
  }
  const s = core.startNextA(store, { now, deck, source: { ...source } });
  if (!s.ok) return s;
  if (s.started || s.occupied) {
    open('A');
    return { ...s, opened: s.started ? 'new' : 'resume' };
  }
  if (s.empty) {
    nav.push(NONE_SCREEN, { exhausted: !!s.libraryExhausted });
    return { ...s, opened: 'none' };
  }
  return { ...s, opened: null };
}

export const OPS = Object.freeze({
  'view.library': (args, ctx) => {
    const store = ctx.getStore();
    const nowMs = envNow();
    return {
      ok: true,
      view: libraryPageView(store.getState(), nowMs, {
        today: localDay(nowMs),
        deck: deckAdapter,
        getInk: record => { try { return store.getInk(record); } catch (error) { return null; } },
      }),
    };
  },
  'library.startToday': (args, ctx) => {
    if (!ctx.nav) throw new Error('no router');
    const r = startTodayWith({ store: ctx.getStore(), nav: ctx.nav });
    if (r && r.ok === false) return { ok: false, error: r.error || { kind: 'write' } };
    return { ok: true, opened: r ? r.opened || null : null };
  },
});
