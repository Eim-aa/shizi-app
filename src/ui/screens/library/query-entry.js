// 字库首页顶部的查字框（02 M3-3；04 R-Q01–R-Q08、R-L04；原型 字库墨墙屏 L29–L31、APP lkPractice / lkDetail；
// reference/K-proto-home-lib.md「字库 · 首页」「查字 / 自己选字弹层」）。
//
// 查字框是一个长得像输入框的按钮（放大镜 +「查字」）：点它在点击处理里**同步**调用 M2-0 的
//   openQuery({mode:'lookup', onPractice, onDetail})（R-Q08：openQuery 在同一个事件里聚焦代理输入框，iOS 才弹键盘）。
// 弹层里的动作：
//   「练这个字」（onPractice）→ session/index.js startPicked([字], {source:{view:'library'}})（原型 lkPractice 的 src 缺省
//      'library'）。旧 B 没写完 → S02 三键（startPicked 处理，确认框盖在查字弹层上；取消回到卡片、B 不动）；
//      写入失败 → 返回 {ok:false}，弹层就地显示 R-H06 三段式、输入还在。
//      弹层不关：写字页推在弹层上面，写到一半返回时回到查字卡片、输入不变（R-Q07；M2-0 约定「弹层不关，调用方需要时 close」）。
//      写完进结果页后「回到字库」按 R-R06 切回字库 tab 根（弹层随之关闭）。
//   「查看记录」（onDetail）→ 单字详情 openDetail(字)（M3-6）；弹层留在栈里，返回回到弹层（R-Q05）。
//   「加入自选的字」与成功轻提示「「X」已加入自选的字。」由查字组件自己做（commitAdd，决定-D21）。
// 打开、输入、看卡片、查看记录都不写存储、不弹 S02、不动 sessions.B（只有「练这个字」经 startPicked 才会）。
//
// 接入：library/index.js 在 library-query-slot 里画 LibraryQueryBox（setLibraryQuerySlot 挂了别的组件时以它为准）。
// 本文件不 import library/index.js（它 import 本文件；反向 import 会成环，模块求值时 querySlot 还在 TDZ）。
//
// data-testid：library-query-open（查字框按钮，data-mode=lookup）。

import { html } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { openQuery } from '../../components/query/index.js';
import { startPicked } from '../session/index.js';
import { openDetail } from '../detail/index.js';

/** 从字库查字开的组（B）的来源：结果页「回到字库」（R-R06 leaveLibrary）。 */
export const LIBRARY_QUERY_SOURCE = Object.freeze({ view: 'library' });

injectStyles('library-query', `
.sz-libq.sz-btn{width:100%;min-height:calc(44px + 6px * ${T.k});box-sizing:border-box;border-radius:14px;background:${T.off};
  box-shadow:inset 0 1px 2px rgba(48,38,26,.08),inset 0 0 0 .5px ${T.i5};display:flex;align-items:center;gap:10px;padding:0 16px;
  text-align:left}
.sz-libq__icon{flex:none;width:18px;height:18px;color:${T.i2}}
.sz-libq__text{min-width:0;font-size:calc(17px * ${T.k});line-height:calc(24px * ${T.k});letter-spacing:.04em;color:${T.i3}}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const SEARCH_ICON = () => html`<svg class="sz-libq__icon" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6"></circle><path d="m14.5 14.5 4 4"></path></svg>`;

/**
 * 查字弹层卡片「练这个字」：开「这次选的字」（B）。旧 B 没写完 → S02（startPicked 弹）；失败 → {ok:false}（弹层三段式）。
 * 弹层不关（R-Q07）。
 */
export function practiceFromLookup(char) {
  const r = startPicked([char], { source: { ...LIBRARY_QUERY_SOURCE } });
  if (!r || r.ok === false) return { ok: false, error: r ? r.error : null };
  return r;
}

/** 查字弹层卡片「查看记录」：推单字详情（M3-6），弹层留在栈里。 */
export function detailFromLookup(char) {
  openDetail(char);
}

/** 打开查字弹层（lookup）。**必须在点击处理里同步调用**（R-Q08）。 */
export function openLibraryQuery() {
  return openQuery({ mode: 'lookup', onPractice: practiceFromLookup, onDetail: detailFromLookup });
}

/** 字库首页顶部的查字框（无 props；library-query-slot 里画）。 */
export function LibraryQueryBox() {
  const label = t('R-Q01.titleLookup');
  return html`<${Button} variant="plain" class="sz-libq" data-testid="library-query-open" data-mode="lookup"
    aria-haspopup="dialog" onClick=${() => { openLibraryQuery(); }}>
    ${SEARCH_ICON()}<span class="sz-libq__text">${label}</span>
  </${Button}>`;
}
