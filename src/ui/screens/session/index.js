// 会话开始 / 续写的 UI 入口（02 M2-2）。首页（M2-1）、查字 / 自己选字（M2-0）、清单（M3-2）、单字详情（M3-6）都经这里开组，
// 不直接 nav.push('write')。写入走 core/session-start（store.commit 包装）；本模块只管导航、S02 确认框、轻提示。
//
//   openWrite(slot)                  打开某槽的写字页；栈顶已是同槽写字页时 nav.replace（不叠两层，M1 验收修复发现）
//   resumeSlot(slot)                 续写：先做跨天过期（P37），该槽还有没写完的组就打开写字页
//   startA({source})                 首页主入口：A 槽有没写完的组 → 续写；否则开第一次练习 / 今天的练习；
//                                    今天的练习选不出字 → 「现在没有要写的字」页（R-H11）
//   startPicked(chars, {source})     开这次选的字（B）：旧 B 没写完 → S02；否则一次 commit + 打开写字页
//   expireStale()                    首页读取 / 回前台时调用：跨天的今天的练习按 P37 作废（不开页）
//   aStartInfo()                     下一组 A 是 first 还是 daily、是不是真的第一次来（R-H09，首页说法用）
//   s02Data()                        旧 B 没写完时的 S02 数据（首页 / 清单预先判断用）
//
// 返回值：{ok:true, opened:'resume'|'new'|'none'|'s02'|null, …} 或 commit 的 {ok:false, error}（调用方按自己的三段式处理，
// 例如自己选字弹层 R-H06「没保存上，输入的字还在。」）。
//
// 写到一半从写字页返回首页：不出任何提示（R4-F1，D55，P262：原「已保存，下次接着写」条不能点、没有操作空间，真机试用后去掉；保存成功不需要告知）。

import { getRouter, nav } from '../../router.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { deckAdapter } from '../../../data/deck.js';
import * as core from '../../../core/session-start.js';
import { showToast } from '../../components/Toast.js';
import { format, t } from '../../../config/copy/index.js';
import { openS02 } from './s02.js';
import { openNonePage } from './none.js';
import '../write/index.js'; // 写字页自注册

export const WRITE_SCREEN = 'write';
const HOME_TAB = 'home';

function slotOfParams(p) {
  return p && p.slot === 'B' ? 'B' : 'A';
}

// ---------------------------------------------------------------- 写字页去重

/**
 * 打开某槽的写字页。栈顶（遮罩下面的顶层页面）已经是同槽写字页：没有遮罩时 nav.replace（同一层换成新页面，不叠第二层），
 * 有遮罩时什么都不做（那个写字页就是要打开的）；否则 nav.push。
 * @returns {'push'|'replace'|'noop'}
 */
export function openWrite(slot) {
  const s = slot === 'B' ? 'B' : 'A';
  const router = getRouter();
  const snap = router ? router.getState() : null;
  const top = snap ? snap.top : null;
  if (snap && snap.depth > 0 && top && top.n === WRITE_SCREEN && slotOfParams(top.p) === s) {
    if (snap.topIsOverlay) return 'noop';
    nav.replace(WRITE_SCREEN, { slot: s });
    return 'replace';
  }
  nav.push(WRITE_SCREEN, { slot: s });
  return 'push';
}

// ---------------------------------------------------------------- 流程

function store() {
  return getStore();
}

export function expireStale() {
  return core.expireStale(store(), { now: envNow });
}

export function aStartInfo() {
  return core.aStartInfo(store().getState());
}

export function s02Data() {
  return core.s02Data(store().getState());
}

export function resumeSlot(slot) {
  const r = core.resumeSlot(store(), slot, { now: envNow });
  if (!r.ok) return r;
  if (!r.session) return { ...r, opened: null };
  openWrite(slot);
  return { ...r, opened: 'resume' };
}

export function startA({ source } = {}) {
  const st = store();
  // 续写判断不写入；跨天过期由 startNextA 与开新组放在同一次 commit 里（选不出字时单独写过期）。
  const resumable = core.resumableSession(st.getState(), 'A', { now: envNow });
  if (resumable) {
    openWrite('A');
    return { ok: true, opened: 'resume', session: resumable };
  }
  const r = core.startNextA(st, { now: envNow, deck: deckAdapter, source: source || { view: HOME_TAB } });
  if (!r.ok) return r;
  if (r.started || r.occupied) {
    openWrite('A');
    return { ...r, opened: r.started ? 'new' : 'resume' };
  }
  if (r.empty) {
    openNonePage({ exhausted: r.libraryExhausted });
    return { ...r, opened: 'none' };
  }
  return { ...r, opened: null };
}

/**
 * 开这次选的字（B）。chars：单字或 cardKey 列表（只收题库里能练的字）。
 * 旧 B 没写完 → S02（返回 {ok:true, opened:'s02', s02}）；「结束那组，开新的」成功后打开新 B，旧 B 有判断时轻提示（P38）。
 */
export function startPicked(chars, { source } = {}) {
  const st = store();
  const src = source || { view: HOME_TAB };
  let r;
  try {
    r = core.startPicked(st, { keys: chars, source: src, deck: deckAdapter });
  } catch (error) {
    // 没有一个题库里能练的字：不开组（调用方本该只把能练的字交进来，pick 底栏 0 个时真禁用）。
    return { ok: false, error: { kind: 'invalid', reason: error && error.message ? error.message : String(error) } };
  }
  if (!r.ok) return r;
  if (r.started) {
    openWrite('B');
    return { ...r, opened: 'new' };
  }
  const prompt = r.s02;
  const overlayId = openS02({
    chars: prompt.unwrittenChars,
    onContinue: () => openWrite('B'),
    onEndStart: () => core.endOldAndStartPicked(store(), { keys: r.queue, source: src, deck: deckAdapter }),
    onStarted: result => {
      openWrite('B');
      if (result.notice && result.notice.kind === 'oldGroupSaved') {
        showToast(format(t('R-H05.oldGroupSavedToast'), { m: result.notice.judgedCount }), { kind: 'legacy', audit: 'P0-10' }); // 交互合规待修 P0-10（I3 删除这条成功提示）
      }
    },
  });
  return { ok: true, started: false, opened: 's02', s02: prompt, overlayId };
}
