// 设置（02 M4-3；04 R-S01–R-S03；03 P07 / P13（删）、P18、P24、P51、P59（D29 删）、P132；01 §3 settings 形状、§8.1 原生桥；
// 原型 ShiziScreen-第十稿交接版 L145–L160、逻辑 L463–L467，reference/J-proto-screen.md §2.3.17–2.3.18）。
//
// 页面 'settings'（「我的」菜单「设置」推入，M4-1 拥有入口，调用 openSettings() 或 nav.push('settings')）：
//   页头「设置」+ 返回；四组（组标题 20px 宋体 + 列表，原型顺序）：
//   练习：练习范围（右侧「{库名} ›」→ nav.push('library-switch')，M3-5 换库页；换完它自己 nav.back() 回到这里）、
//         写字方式（阶段 1 P1-E8，D46 ⑬ / 03 P165：右侧「在屏幕上写 | 在纸上写 ›」，点开底部弹层二选 + 说明，写 settings.writeMode；
//         弹层流程与外观同一套 openPickSheet）、
//         按键音（开关，settings.sound，缺省开 = 原型 SD；P24 触发点沿旧，由 M5 sound.js 读）。
//         「练字背景音」一行与「背景音只在写字的时候响。」按 P07（features.soundscape=false）删除，不画。
//   提醒：练习提醒（开关 + 小字 R-S01.remindNote；通知被关时小字换 R-S02.title，组下 R-S02.body +「去手机设置 ›」）、
//         开着时多一行「提醒时间」（<input type=time>，P18 用户选、缺省 policy.remindDefault）。
//         「写完提示做成图片」按 P13（features.photoHint=false）删除，不画。
//   显示：外观（右侧「{浅色|深色|跟随系统} ›」；点开底部弹层三选，R-S03 / 边改 V01；P51 features.appearanceSwitch；开关关掉时整组不画）。
//         「更大字体」开关与 R-S04 说明按 D29（覆盖 P59）删除：字号跟随手机的系统字号（platform/text-size.js，P130）。
//         settings.large 只保留读取兼容、不再生效；v1 迁移带来的 large=true 在启动后由 showTextSizeNoticeOnce 显示一次
//         「文字大小跟随手机设置…」（X-SETTINGS.textSizeNotice，P132 过渡文案），显示后从 settings 去掉 large（= 记下不再显示）。
//   数据：备份与恢复（右侧「上次备份 {date} ›」/「还没有备份 ›」，R-M03；→ 已注册的 'backup' 屏，M4-4）。
//
// 写入：一律 store.commit（01 §4），每次只改 settings 一个键、保留其余字段；值没变不写。
//   失败不发布（D07）：该组下方三段式（R-G04 / T01：「没保存上，刚才的选择没记下。」+ 先不保存 / 再试一次），开关与时间留在原值；
//   再试一次 = 同一目标值再 commit 一次。外观弹层里失败时弹层不关，就地换成三段式。
// 外观只写 store；<html> 的 data-theme 由 src/platform/appearance.js 订阅 store 后应用（启动时也由它应用）。
// 提醒（原生执行，M5-5 接完整链路）：本页只经 platform/bridge.js postNative 发消息，不在原生壳内时 postNative 返回 false，页面照常：
//   打开 → 写 enabled（首开补 hour/minute 缺省）→ 权限不是 granted 时 postNative('requestReminderPermission') → syncReminder；
//   关闭 / 改时间 → syncReminder。syncReminder 缺省发 {type:'syncReminder', enabled, hour, minute, practicedToday:false, questions:[]}；
//   题目（P48 写错过优先、其次到期最久）归 M5-5，用 setReminderSync(fn) 换成带题目的实现。
//   原生回 shiziReminderStatus({permission}) → applyReminderStatus(store, payload)（M5-5 用 registerNativeHandler 接上；本卡不注册）。
//   「去手机设置 ›」→ postNative('openAppSettings')（01 §8.1 表里没有这个 type，已登记待定）。
//
// data-testid（前缀 settings-）：settings-screen、settings-group（data-group=practice|remind|display|data）、settings-group-title、
//   settings-library（data-library）、settings-library-value、settings-sound（role=switch，aria-checked）、
//   settings-remind（role=switch）、settings-remind-sub、settings-remind-time（input，data-value）、settings-remind-denied、
//   settings-open-system、settings-appearance（data-value）、
//   settings-appearance-value、settings-backup（data-last-export）、settings-backup-value、
//   settings-fail（data-group / data-field）、settings-fail-note、settings-fail-cancel、settings-fail-retry；
//   外观弹层：settings-appearance-sheet（data-state=pick|failed）、settings-appearance-options（role=radiogroup）、
//   settings-appearance-option（role=radio，data-value，aria-checked）、settings-appearance-fail（+ -cancel / -retry）；
//   写字方式（P1-E8）：settings-writemode（data-value）、settings-writemode-value、settings-writemode-sheet、settings-writemode-options、
//   settings-writemode-option（role=radio，data-value，aria-checked）、settings-writemode-note、settings-writemode-fail。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { Chevron } from '../../components/Chevron.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T } from '../../components/styles.js';
import { getStore } from '../../../store/store.js';
import { postNative } from '../../../platform/bridge.js';
import { APPEARANCES, appearanceOf } from '../../../platform/appearance.js';
import { currentLibraryId } from '../../../data/deck.js';
import { localDay, monthDayParts } from '../../../core/dates.js';
import { libraryName } from '../library/index.js';
import * as policy from '../../../config/policy.js';
import { t } from '../../../config/copy/index.js';
import { showToast } from '../../components/Toast.js';
import { WRITE_MODES, writeModeOf } from '../../../core/paper.js';

export const SETTINGS_SCREEN = 'settings';
export const BACKUP_SCREEN = 'backup';
export const LIBRARY_SWITCH_ROUTE = 'library-switch';
export const APPEARANCE_OVERLAY = 'settings-appearance';

export const LABELS = Object.freeze({
  sound: 'settings:sound',
  remind: 'settings:remind',
  remindTime: 'settings:remind-time',
  permission: 'settings:remind-permission',
  appearance: 'settings:appearance',
  writeMode: 'settings:write-mode',
  textSizeNotice: 'settings:text-size-notice',
});

// 按键音缺省开：原型 ShiziScreen L463 SD.sound=true（旧版 shizi.sound.v1 也缺省开）。
export const DEFAULT_SOUND = true;
export const PERMISSIONS = Object.freeze(['granted', 'denied', 'unknown']);
/** 外观弹层里选项的顺序（R-S03「浅色 / 深色 / 跟随系统」）。 */
export const APPEARANCE_ORDER = Object.freeze(['light', 'dark', 'auto']);
/** 写字方式弹层的选项顺序（实现交接 §10.3「在屏幕上写 / 在纸上写」；阶段 1 P1-E8，P165）。 */
export const WRITE_MODE_ORDER = WRITE_MODES;
export const WRITE_MODE_OVERLAY = 'settings-writemode';

// ---------------------------------------------------------------- 纯函数（test/ui/settings.test.mjs）

/** 'HH:MM' → {hour, minute}；不合法返回 null。 */
export function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const pad2 = n => (n < 10 ? `0${n}` : String(n));

/** {hour, minute} → 'HH:MM'（<input type=time> 的值）。 */
export function timeText(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 提醒缺省时间（P18 policy.remindDefault；写坏了退回 20:00）。 */
export function defaultRemindTime(p = policy) {
  return parseTime(p.remindDefault) || { hour: 20, minute: 0 };
}

/**
 * settings（可为 null）→ 页面要显示的值（补缺省）。
 * @returns {{library:string, libraryName:string, sound:boolean, remind:{enabled:boolean, hour:number, minute:number, permission:string},
 *   denied:boolean, appearance:'auto'|'light'|'dark', appearanceSwitch:boolean}}
 */
export function settingsView(settings, { p = policy } = {}) {
  const s = settings || {};
  const library = currentLibraryId(settings);
  const r = s.remind || {};
  const def = defaultRemindTime(p);
  const permission = PERMISSIONS.indexOf(r.permission) >= 0 ? r.permission : 'unknown';
  const remind = {
    enabled: r.enabled === true,
    hour: Number.isInteger(r.hour) ? r.hour : def.hour,
    minute: Number.isInteger(r.minute) ? r.minute : def.minute,
    permission,
  };
  const features = p.features || {};
  return {
    library,
    libraryName: libraryName(library),
    sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SOUND,
    remind,
    // 原型 settingsDenied：只要手机关了通知就显示 R-S02（开关照旧表示用户的选择）。
    denied: permission === 'denied',
    appearance: appearanceOf(settings, { features }).theme,
    appearanceSwitch: features.appearanceSwitch !== false,
    writeMode: writeModeOf(settings), // P1-E8（P165）：缺省 screen
  };
}

/** 备份行右侧（R-M03）：lastExportAt → 「上次备份 {date} ›」，没有 → 「还没有备份」（› 另画，装饰）。 */
export function backupValue(backupMeta) {
  const at = backupMeta && typeof backupMeta.lastExportAt === 'number' ? backupMeta.lastExportAt : null;
  if (at === null) return { text: t('R-M03.noBackup'), arrow: true, day: null };
  const day = localDay(at);
  return { text: t('R-M03.lastBackup', { date: t('R-H02.dateFormat', monthDayParts(day)) }), arrow: false, day };
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 一次 commit 把 fields 合进 settings（只改给出的字段，其余保留）。值没变不写，返回 {ok:true, keys:[], skipped:true}。
 * fields.remind 若给出，与原 remind 合并（保留 permission 等）。
 */
export function commitSettings(store, label, fields) {
  const cur = store.getState().settings || {};
  const next = { ...cur };
  for (const key of Object.keys(fields)) {
    if (key === 'remind') next.remind = { ...(cur.remind || {}), ...fields.remind };
    else next[key] = fields[key];
  }
  if (sameJSON(next, cur) && store.getState().settings) return { ok: true, keys: [], skipped: true };
  return store.commit(label, draft => {
    const base = draft.settings || {};
    const merged = { ...base };
    for (const key of Object.keys(fields)) {
      if (key === 'remind') merged.remind = { ...(base.remind || {}), ...fields.remind };
      else merged[key] = fields[key];
    }
    draft.settings = merged;
  });
}

export function commitSound(store, on) {
  return commitSettings(store, LABELS.sound, { sound: !!on });
}

/** 写字方式（P1-E8，P165）：settings.writeMode = 'screen' | 'paper'。 */
export function commitWriteMode(store, value) {
  if (WRITE_MODES.indexOf(value) < 0) throw new RangeError(`unknown write mode: ${value}`);
  return commitSettings(store, LABELS.writeMode, { writeMode: value });
}

export function commitAppearance(store, value) {
  if (APPEARANCES.indexOf(value) < 0) throw new RangeError(`unknown appearance: ${value}`);
  return commitSettings(store, LABELS.appearance, { appearance: value });
}

/**
 * 提醒开关。打开时若还没存过时间，补上缺省时间（P18），让存下的就是界面显示的。
 */
export function commitRemindEnabled(store, on, { p = policy } = {}) {
  const cur = (store.getState().settings || {}).remind || {};
  const patch = { enabled: !!on };
  if (on) {
    const def = defaultRemindTime(p);
    if (!Number.isInteger(cur.hour)) patch.hour = def.hour;
    if (!Number.isInteger(cur.minute)) patch.minute = def.minute;
  }
  return commitSettings(store, LABELS.remind, { remind: patch });
}

export function commitRemindTime(store, hour, minute) {
  return commitSettings(store, LABELS.remindTime, { remind: { hour, minute } });
}

/**
 * 原生回报的通知权限（shiziReminderStatus({permission})）→ settings.remind.permission。
 * M5-5 用 registerNativeHandler('shiziReminderStatus', payload => applyReminderStatus(getStore(), payload)) 接上。
 */
export function applyReminderStatus(store, payload) {
  const raw = payload && typeof payload === 'object' ? payload.permission : payload;
  const permission = PERMISSIONS.indexOf(raw) >= 0 ? raw : 'unknown';
  const result = commitSettings(store, LABELS.permission, { remind: { permission } });
  if (result.ok && !result.skipped) syncReminder(remindOf(store));
  return result;
}

function remindOf(store) {
  return settingsView(store.getState().settings).remind;
}

let reminderSync = null;

/** M5-5 注册带题目的同步实现：fn(remind) → void；传 null 恢复缺省。 */
export function setReminderSync(fn) {
  reminderSync = typeof fn === 'function' ? fn : null;
}

/** 把提醒设置发给原生（缺省实现不带题目；不在原生壳内返回 false）。 */
export function syncReminder(remind) {
  if (reminderSync) {
    try {
      reminderSync(remind);
      return true;
    } catch (error) {
      if (typeof console !== 'undefined') console.error('[shizi] reminder sync failed:', error);
      return false;
    }
  }
  return postNative('syncReminder', {
    enabled: !!remind.enabled, hour: remind.hour, minute: remind.minute, practicedToday: false, questions: [],
  });
}

/** 打开提醒后向原生要通知权限（已 granted 不再要）。 */
export function requestReminderPermission(remind) {
  if (remind && remind.permission === 'granted') return false;
  return postNative('requestReminderPermission', {});
}

// ---------------------------------------------------------------- 样式（原型 ShiziScreen L145–L152；J §2.3.17）

injectStyles('settings', `
.sz-set{display:flex;flex-direction:column;gap:${T.groupGap}}
.sz-set__group{display:flex;flex-direction:column;gap:${T.s3}}
.sz-set__gtitle{margin:0;font-family:${T.hei};font-size:${T.fs13};line-height:${T.lh13};font-weight:400;color:${T.ink3}} /* 分组标题：黑体 13 ink3，不画线（iOS 分组列表惯例，T2-14；比页面标题小、比行字灰，不再倒置） */
.sz-set__list{display:flex;flex-direction:column}
.sz-set__row{box-sizing:border-box;width:100%;min-height:52px;padding:${T.s3} 0;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border:0;border-bottom:${T.hair} solid ${T.line};background:transparent;color:inherit;font:inherit;text-align:left}
button.sz-set__row{cursor:pointer}
button.sz-set__row:focus-visible{outline:2px solid ${T.ink1};outline-offset:2px}
.sz-set__main{display:flex;flex-direction:column;gap:3px;min-width:0}
/* 列表行（设计系统 v1）：主文字 17 / 22 墨一，副文字 15 / 22 墨三，右侧值 15 墨三 */
.sz-set__title{font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink1}}
.sz-set__sub{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};text-wrap:pretty}
.sz-set__sub span{display:block}
.sz-set__value{flex:none;display:flex;align-items:center;gap:${T.s2};font-size:${T.fs15};color:${T.ink3}}
.sz-set__arrow{display:flex;color:${T.ink4}}
.sz-set__switch{position:relative;flex:none;width:44px;height:26px;border-radius:${T.rCtl};background:${T.line};
  box-shadow:inset 0 0 0 1px ${T.ink3};transition:background .15s}
.sz-set__knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:${T.sheet};
  transition:left .15s}
[aria-checked="true"] .sz-set__switch{background:${T.ink1};box-shadow:none}
[aria-checked="true"] .sz-set__knob{left:21px;background:${T.paper}}
.sz-set__time{flex:none;min-height:44px;min-width:88px;box-sizing:border-box;padding:0 10px;border:0;border-radius:${T.rCtl};
  background:${T.field};color:${T.ink1};font:inherit;font-size:${T.fs15};font-variant-numeric:tabular-nums;
  -webkit-appearance:none;appearance:none;color-scheme:light dark}
.sz-set__time:focus-visible{outline:2px solid ${T.ink1};outline-offset:2px}
.sz-set__note{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-set__note .sz-btn--text{min-height:44px;padding:0;color:${T.ink1};font-size:${T.fs15}}
.sz-set__fail{display:flex;flex-direction:column;gap:10px;padding:4px 0 0}
.sz-set__fail-note{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-set__fail-btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-set__opts{display:flex;flex-direction:column;border-top:1px solid ${T.line}}
.sz-set__opt{box-sizing:border-box;width:100%;min-height:52px;padding:8px 0;display:flex;align-items:center;justify-content:space-between;
  gap:12px;border-bottom:1px solid ${T.line};font-size:${T.fs17};text-align:left;color:${T.ink1}}
.sz-set__check{flex:none;width:22px;height:22px;color:${T.ink1};visibility:hidden}
.sz-set__opt[aria-checked="true"] .sz-set__check{visibility:visible}
.sz-set__opt[aria-checked="true"]{font-weight:500}
.sz-set__opt .sz-set__sub{font-weight:400}
.sz-set__mnote{margin:${T.s3} 0 0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK_ICON = () => Icons.checkLarge({ cls: 'sz-set__check' });

// ---------------------------------------------------------------- 视图零件

function Group({ id, title, children, note = null }) {
  const titleId = `sz-set-g-${id}`;
  return html`<section class="sz-set__group" data-testid="settings-group" data-group=${id} aria-labelledby=${titleId}>
    <h2 class="sz-set__gtitle" id=${titleId} data-testid="settings-group-title">${title}</h2>
    <div class="sz-set__list">${children}</div>
    ${note}
  </section>`;
}

/** 开关行：整行一个 <button role=switch>（44px 以上可点），名字 = 标题，说明 = 小字。 */
function SwitchRow({ testid, title, sub = null, subTestid, on, onToggle }) {
  const ids = { title: `sz-${testid}-title`, sub: `sz-${testid}-sub` };
  const lines = sub === null ? null : Array.isArray(sub) ? sub : [sub];
  return html`<${Button} variant="plain" class="sz-set__row" role="switch" aria-checked=${on ? 'true' : 'false'}
    aria-labelledby=${ids.title} aria-describedby=${lines ? ids.sub : undefined} data-testid=${testid} onClick=${onToggle}>
    <span class="sz-set__main">
      <span class="sz-set__title" id=${ids.title}>${title}</span>
      ${lines ? html`<span class="sz-set__sub" id=${ids.sub} data-testid=${subTestid}>${lines.map((l, i) => html`<span key=${i}>${l}</span>`)}</span>` : null}
    </span>
    <span class="sz-set__switch" aria-hidden="true"><span class="sz-set__knob"></span></span>
  </${Button}>`;
}

/** 右侧带值的行（点了去别处 / 开弹层）。AX 档标题与值改上下排（sz-set__row--value，ui/components/ax.js）。 */
function ValueRow({ testid, title, value, valueTestid, arrow = true, onClick, extra = {} }) {
  return html`<${Button} variant="plain" class="sz-set__row sz-set__row--value" data-testid=${testid} onClick=${onClick} ...${extra}>
    <span class="sz-set__main"><span class="sz-set__title">${title}</span></span>
    <span class="sz-set__value"><span data-testid=${valueTestid}>${value}</span>${arrow
      ? html`<span class="sz-set__arrow" aria-hidden="true"><${Chevron} /></span>` : null}</span>
  </${Button}>`;
}

function TimeRow({ hour, minute, onTime }) {
  const inputId = 'sz-settings-remind-time';
  const value = timeText(hour, minute);
  return html`<div class="sz-set__row">
    <label class="sz-set__main" for=${inputId}><span class="sz-set__title">${t('X-SETTINGS.remindTime')}</span></label>
    <input class="sz-set__time" id=${inputId} type="time" step="60" required value=${value} data-value=${value}
      data-testid="settings-remind-time" onChange=${onTime} />
  </div>`;
}

/** 三段式（R-G04 / T01）：说明 + 先不保存 / 再试一次。 */
export function FailBlock({ testid = 'settings-fail', group = null, field = null, onCancel, onRetry }) {
  return html`<div class="sz-set__fail" data-testid=${testid} data-group=${group || undefined} data-field=${field || undefined}>
    <p class="sz-set__fail-note" role="status" aria-live="polite" data-testid=${`${testid}-note`}>${t('X-SETTINGS.saveFailed')}</p>
    <div class="sz-set__fail-btns">
      <${Button} variant="secondary" data-testid=${`${testid}-cancel`} onClick=${onCancel}>${t('X-SETTINGS.cancel')}</${Button}>
      <${Button} variant="primary" data-testid=${`${testid}-retry`} onClick=${onRetry}>${t('X-SETTINGS.retry')}</${Button}>
    </div>
  </div>`;
}

function appearanceLabel(value) {
  return t(`R-S03.appearance.${value}`);
}

/**
 * 设置页正文（纯函数，无 hooks；test/ui/settings.test.mjs 直接调用）。
 * @param {object} p
 * @param {ReturnType<typeof settingsView>} p.view
 * @param {{text:string, arrow:boolean, day:string|null}} p.backup
 * @param {{group:string, field:string}|null} [p.fail]
 * @param {object} p.on  回调：library / sound / remind / time / openSystem / appearance / backup / failCancel / failRetry
 */
export function SettingsBody({ view, backup, fail = null, on }) {
  const failFor = group => (fail && fail.group === group
    ? html`<${FailBlock} group=${fail.group} field=${fail.field} onCancel=${on.failCancel} onRetry=${on.failRetry} />`
    : null);
  const remind = view.remind;
  const remindNote = view.denied
    ? html`<p class="sz-set__note" data-testid="settings-remind-denied">
        <span>${t('R-S02.body')}</span><br />
        <${Button} variant="text" data-testid="settings-open-system" onClick=${on.openSystem}>${t('R-S02.link')}</${Button}>
      </p>`
    : null;
  return html`<div class="sz-set">
    <${Group} id="practice" title=${t('X-SETTINGS.groupPractice')} note=${failFor('practice')}>
      <${ValueRow} testid="settings-library" title=${t('R-S01.library')} value=${view.libraryName} valueTestid="settings-library-value"
        onClick=${on.library} extra=${{ 'data-library': view.library }} />
      <${ValueRow} testid="settings-writemode" title=${t('X-SETTINGS.writeMode')} value=${writeModeLabel(view.writeMode)}
        valueTestid="settings-writemode-value" onClick=${on.writeMode} extra=${{ 'data-value': view.writeMode, 'aria-haspopup': 'dialog' }} />
      <${SwitchRow} testid="settings-sound" title=${t('R-S01.keySound')} on=${view.sound} onToggle=${on.sound} />
    </${Group}>
    <${Group} id="remind" title=${t('X-SETTINGS.groupRemind')} note=${html`${remindNote}${failFor('remind')}`}>
      <${SwitchRow} testid="settings-remind" title=${t('X-SETTINGS.remindLabel')} subTestid="settings-remind-sub"
        sub=${view.denied ? t('R-S02.title') : t('R-S01.remindNote')} on=${remind.enabled} onToggle=${on.remind} />
      ${remind.enabled ? html`<${TimeRow} hour=${remind.hour} minute=${remind.minute} onTime=${on.time} />` : null}
    </${Group}>
    ${view.appearanceSwitch ? html`<${Group} id="display" title=${t('X-SETTINGS.groupDisplay')} note=${failFor('display')}>
      <${ValueRow} testid="settings-appearance" title=${t('R-S03.appearance')}
        value=${appearanceLabel(view.appearance)} valueTestid="settings-appearance-value" onClick=${on.appearance}
        extra=${{ 'data-value': view.appearance, 'aria-haspopup': 'dialog' }} />
    </${Group}>` : null}
    <${Group} id="data" title=${t('X-SETTINGS.groupData')} note=${failFor('data')}>
      <${ValueRow} testid="settings-backup" title=${t('R-M03.backup')} value=${backup.text} valueTestid="settings-backup-value"
        arrow=${backup.arrow} onClick=${on.backup} extra=${{ 'data-last-export': backup.day || '' }} />
    </${Group}>
  </div>`;
}

// ---------------------------------------------------------------- 外观弹层

/** 弹层视图（纯函数）。state: 'pick' | 'failed'（pending = 失败的那个选择）。 */
export function AppearanceSheetView({ current, failed = false, pending = null, onPick, onCancel, onRetry, close, active = true }) {
  return html`<${Sheet} title=${t('R-S03.appearance')} onClose=${close} active=${active} testid="settings-appearance-sheet">
    <div class="sz-set__opts" role="radiogroup" aria-label=${t('R-S03.appearance')} data-testid="settings-appearance-options"
      data-state=${failed ? 'failed' : 'pick'}>
      ${APPEARANCE_ORDER.map(value => html`<${Button} key=${value} variant="plain" class="sz-set__opt" role="radio"
        aria-checked=${value === current ? 'true' : 'false'} data-testid="settings-appearance-option" data-value=${value}
        onClick=${() => onPick(value)}><span>${appearanceLabel(value)}</span>${CHECK_ICON()}</${Button}>`)}
    </div>
    ${failed ? html`<${FailBlock} testid="settings-appearance-fail" group="display" field=${`appearance:${pending}`}
      onCancel=${onCancel} onRetry=${onRetry} />` : null}
  </${Sheet}>`;
}

function AppearanceSheet({ failed = false, pending = null, onPick, onRetry, close, active = true }) {
  const view = useSettingsState();
  return AppearanceSheetView({
    current: settingsView(view.settings).appearance, failed, pending, onPick, onCancel: close, onRetry, close, active,
  });
}

/**
 * 打开外观三选弹层。点当前项 → 关；点别的 → commit，成功关，失败就地换成三段式（再试一次 = 同一选择）。
 * @returns overlay id
 */
export function openAppearanceSheet({ getStore: storeOf = getStore } = {}) {
  return openPickSheet({
    Component: AppearanceSheet, name: APPEARANCE_OVERLAY, storeOf,
    currentOf: settings => settingsView(settings).appearance,
    commit: (store, value) => commitAppearance(store, value),
  });
}

/** 打开写字方式二选弹层（P1-E8，P165）：规则同外观弹层。 */
export function openWriteModeSheet({ getStore: storeOf = getStore } = {}) {
  return openPickSheet({
    Component: WriteModeSheet, name: WRITE_MODE_OVERLAY, storeOf,
    currentOf: settings => settingsView(settings).writeMode,
    commit: (store, value) => commitWriteMode(store, value),
  });
}

/** 单选弹层的共用流程：点当前项 → 关；点别的 → commit，成功关，失败就地换成三段式（再试一次 = 同一选择）。 */
function openPickSheet({ Component, name, storeOf, currentOf, commit }) {
  let overlayId = null;
  let done = false;
  let pending = null;
  const attempt = value => {
    if (done) return;
    let result;
    try {
      result = commit(storeOf(), value);
    } catch (error) {
      result = { ok: false, error: { kind: 'unknown', reason: error && error.message ? error.message : String(error) } };
    }
    if (result && result.ok) {
      done = true;
      nav.closeOverlay(overlayId);
      return;
    }
    nav.updateOverlay(overlayId, { failed: true, pending: value });
  };
  const pick = value => {
    if (done) return;
    pending = value;
    if (value === currentOf(storeOf().getState().settings)) {
      done = true;
      nav.closeOverlay(overlayId);
      return;
    }
    attempt(value);
  };
  const retry = () => {
    if (pending) attempt(pending);
  };
  overlayId = nav.openOverlay(Component, { failed: false, pending: null, onPick: pick, onRetry: retry }, { name });
  return overlayId;
}

// ---------------------------------------------------------------- 写字方式弹层（阶段 1 P1-E8，D46 ⑬；03 P165）

const WRITE_MODE_COPY = Object.freeze({
  screen: { title: 'X-SETTINGS.writeScreen', sub: 'X-SETTINGS.writeScreenSub' },
  paper: { title: 'X-SETTINGS.writePaper', sub: 'X-SETTINGS.writePaperSub' },
});

/** 写字方式弹层视图（纯函数）：两个单选（标题 + 说明）+ 下面一段说明（实现交接 §10.3、求助与判断 ⑤）。 */
export function WriteModeSheetView({ current, failed = false, pending = null, onPick, onCancel, onRetry, close, active = true }) {
  return html`<${Sheet} title=${t('X-SETTINGS.writeMode')} onClose=${close} active=${active} testid="settings-writemode-sheet">
    <div class="sz-set__opts" role="radiogroup" aria-label=${t('X-SETTINGS.writeMode')} data-testid="settings-writemode-options"
      data-state=${failed ? 'failed' : 'pick'}>
      ${WRITE_MODE_ORDER.map(value => html`<${Button} key=${value} variant="plain" class="sz-set__opt" role="radio"
        aria-checked=${value === current ? 'true' : 'false'} data-testid="settings-writemode-option" data-value=${value}
        onClick=${() => onPick(value)}><span class="sz-set__main"><span class="sz-set__title">${t(WRITE_MODE_COPY[value].title)}</span><span
        class="sz-set__sub">${t(WRITE_MODE_COPY[value].sub)}</span></span>${CHECK_ICON()}</${Button}>`)}
    </div>
    <p class="sz-set__mnote" data-testid="settings-writemode-note">${t('X-SETTINGS.writeModeNote')}</p>
    ${failed ? html`<${FailBlock} testid="settings-writemode-fail" group="practice" field=${`writeMode:${pending}`}
      onCancel=${onCancel} onRetry=${onRetry} />` : null}
  </${Sheet}>`;
}

function WriteModeSheet({ failed = false, pending = null, onPick, onRetry, close, active = true }) {
  const view = useSettingsState();
  return WriteModeSheetView({
    current: settingsView(view.settings).writeMode, failed, pending, onPick, onCancel: close, onRetry, close, active,
  });
}

function writeModeLabel(value) {
  return t(WRITE_MODE_COPY[value === 'paper' ? 'paper' : 'screen'].title);
}

// ---------------------------------------------------------------- 页面

function readState() {
  try {
    return getStore().getState();
  } catch (error) {
    return { settings: null, backupMeta: null };
  }
}

function useSettingsState() {
  const [state, setState] = useState(readState);
  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      return undefined;
    }
    setState(store.getState());
    return store.subscribe(next => setState(next));
  }, []);
  return state;
}

function go(name, params) {
  if (!getScreen(name)) {
    if (typeof console !== 'undefined') console.warn(`[shizi] settings: screen "${name}" is not registered yet`);
    return false;
  }
  nav.push(name, params);
  return true;
}

function SettingsScreen() {
  const state = useSettingsState();
  const [fail, setFail] = useState(null); // {group, field, run}
  const view = settingsView(state.settings);
  const backup = backupValue(state.backupMeta);

  const run = (group, field, fn, after = null) => {
    let result;
    try {
      result = fn();
    } catch (error) {
      result = { ok: false, error: { kind: 'unknown', reason: error && error.message ? error.message : String(error) } };
    }
    if (result && result.ok) {
      setFail(null);
      if (after) after(result);
      return true;
    }
    setFail({ group, field, run: () => run(group, field, fn, after) });
    return false;
  };
  const store = () => getStore();
  const afterRemind = () => syncReminder(remindOf(store()));

  const on = {
    library: () => go(LIBRARY_SWITCH_ROUTE, {}),
    sound: () => {
      const next = !view.sound;
      run('practice', 'sound', () => commitSound(store(), next));
    },
    remind: () => {
      const next = !view.remind.enabled;
      run('remind', 'remind', () => commitRemindEnabled(store(), next), () => {
        const remind = remindOf(store());
        if (next) requestReminderPermission(remind);
        syncReminder(remind);
      });
    },
    time: event => {
      const input = event.currentTarget;
      const parsed = parseTime(input.value);
      const old = timeText(view.remind.hour, view.remind.minute);
      if (!parsed) {
        input.value = old; // 清空等不合法输入：退回原值，不写
        return;
      }
      const ok = run('remind', 'time', () => commitRemindTime(store(), parsed.hour, parsed.minute), afterRemind);
      if (!ok) input.value = old;
    },
    openSystem: () => postNative('openAppSettings', {}),
    appearance: () => openAppearanceSheet(),
    writeMode: () => openWriteModeSheet(),
    backup: () => go(BACKUP_SCREEN, {}),
    failCancel: () => setFail(null),
    failRetry: () => {
      if (fail && fail.run) fail.run();
    },
  };

  return html`<${Page} title=${t('R-S01.title')} testid="settings-screen">
    <${SettingsBody} view=${view} backup=${backup} fail=${fail} on=${on} />
  </${Page}>`;
}

// ---------------------------------------------------------------- 旧「更大字体」的一次说明（D29 / P132）

/** 说明显示时长（ms）：比普通轻提示（3.2s）长，句子有两段（P132 过渡值）。 */
export const TEXT_SIZE_NOTICE_MS = 6000;

/** 要不要显示「文字大小跟随手机设置」：settings.large 仍为 true（v1 迁移带来、或旧版 App 内开关打开过，还没显示过）。 */
export function textSizeNoticeDue(settings) {
  return !!settings && settings.large === true;
}

/** 记下已显示：从 settings 去掉不再生效的 large（其余字段不动）。 */
export function commitTextSizeNoticeShown(store) {
  return store.commit(LABELS.textSizeNotice, draft => {
    const next = { ...(draft.settings || {}) };
    delete next.large;
    draft.settings = next;
  });
}

/**
 * 启动后（app.js，迁移与挂 UI 之后）调用一次：需要时显示说明并记下，下次启动不再显示。
 * 写入失败只是下次再显示一次。返回是否显示了。
 */
export function showTextSizeNoticeOnce({ getStore: storeOf = getStore, show = showToast } = {}) {
  let store = null;
  try {
    store = storeOf();
  } catch (error) {
    return false;
  }
  if (!store || !textSizeNoticeDue(store.getState().settings)) return false;
  show(t('X-SETTINGS.textSizeNotice'), { duration: TEXT_SIZE_NOTICE_MS });
  try {
    commitTextSizeNoticeShown(store);
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[shizi] text size notice not recorded:', error);
  }
  return true;
}

/** 从「我的」菜单进入设置（M4-1）。 */
export function openSettings() {
  return go(SETTINGS_SCREEN, {});
}

registerScreen(SETTINGS_SCREEN, SettingsScreen, { label: t('R-S01.title') });
