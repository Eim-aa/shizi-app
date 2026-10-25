// 提醒页（D63 ③）：原「设置」页的「提醒」组挪到这里——开关、时间、通知被手机关掉时的说明与「手机设置 ›」。逻辑与原生桥照旧（prefs.js：commitRemindEnabled / commitRemindTime /
// requestReminderPermission / syncReminder / applyReminderStatus）。L1 推入页：左上「‹」返回，左缘右滑同一个函数（Page.js useBackAction）；由「我的」页「提醒」行进入（屏名 'remind'）。
//
// 版式：页头「提醒」+ 返回；「练习提醒」开关行（小字 R-S01.remindNote；通知被关时小字换 R-S02.title）；开着时多一行「提醒时间」（<input type=time>，缺省 policy.remindDefault）；
//   通知被关（permission = denied）时说明 R-S02.body +「手机设置 ›」（postNative('openAppSettings')）。
// 写入：一律 store.commit；失败不发布（D07）：就地三段式「没保存上，刚才的选择没记下。先不保存 / 再试一次」，开关与时间留在原值。
//
// data-testid：remind-screen、remind-switch（role=switch，aria-checked）、remind-sub、remind-time（input，data-value）、remind-denied、remind-open-system、
//   remind-fail（data-field）、remind-fail-cancel、remind-fail-retry。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { FailBlock } from '../../components/FailBlock.js';
import { injectStyles, T } from '../../components/styles.js';
import { getStore } from '../../../store/store.js';
import { postNative } from '../../../platform/bridge.js';
import { domLineStarts, registerTextLines, screenWidth, textUnits } from '../../text-lines.js';
import { t, tRef } from '../../../config/copy/index.js';
import {
  commitRemindEnabled, commitRemindTime, parseTime, remindOf, requestReminderPermission, syncReminder, timeText,
} from './prefs.js';
import { remindView } from '../../../session/views/settings.js';

export const REMIND_SCREEN = 'remind';

injectStyles('remind', `
.sz-remind{display:flex;flex-direction:column}
.sz-remind__row{box-sizing:border-box;width:100%;min-height:56px;display:flex;align-items:center;justify-content:space-between;gap:${T.s3};
  border:0;border-top:${T.hair} solid ${T.line};border-bottom:${T.hair} solid ${T.line};text-align:left;color:${T.ink1}}
.sz-remind__row+.sz-remind__row{border-top:0}
.sz-remind__main{display:flex;flex-direction:column;gap:1px;min-width:0}
.sz-remind__title{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-remind__sub{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-remind__switch{position:relative;flex:none;width:44px;height:26px;border-radius:${T.rCtl};background:${T.line};
  box-shadow:inset 0 0 0 1px ${T.ink3};transition:background ${T.dFade} ${T.eLinear}}
.sz-remind__knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:${T.sheet};
  transition:left ${T.dFade} ${T.eOut}}
@media (prefers-reduced-motion: reduce){.sz-remind__switch,.sz-remind__knob{transition-duration:${T.dReduce};transition-timing-function:${T.eLinear}}}
[aria-checked="true"] .sz-remind__switch{background:${T.ink1};box-shadow:none}
[aria-checked="true"] .sz-remind__knob{left:21px;background:${T.paper}}
.sz-remind__time{flex:none;min-height:44px;min-width:88px;box-sizing:border-box;padding:0 10px;border:0;border-radius:${T.rCtl};
  background:${T.field};color:${T.ink1};font:inherit;font-size:${T.fs15};font-variant-numeric:tabular-nums;
  -webkit-appearance:none;appearance:none;color-scheme:light dark}
.sz-remind__time:focus-visible{outline:2px solid ${T.ink1};outline-offset:2px}
.sz-remind__note{margin:${T.s3} 0 0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-remind__note .sz-btn--text{min-height:44px;padding:0;color:${T.ink1};font-size:${T.fs15}}
.sz-remind__fail{padding:${T.s3} 0 0}
`);

function readState() {
  try {
    return getStore().getState();
  } catch (error) {
    return { settings: null };
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

/** 提醒页正文（纯视图，无 hooks；单测直接调用）。view = session/views/settings.js 的 remindView（与原生页同一个模型）。 */
export function RemindBody({ view, fail = null, on }) {
  const remind = view.remind;
  const sub = tRef(view.remindPage.sub[view.denied ? 'denied' : 'on']);
  return html`<div class="sz-remind" data-testid="remind-body">
    <${Button} variant="plain" class="sz-remind__row" role="switch" aria-checked=${view.on ? 'true' : 'false'}
      aria-labelledby="sz-remind-title" aria-describedby="sz-remind-sub" data-testid="remind-switch" onClick=${on.toggle}>
      <span class="sz-remind__main">
        <span class="sz-remind__title" id="sz-remind-title">${tRef(view.remindPage.label)}</span>
        <span class="sz-remind__sub" id="sz-remind-sub" data-testid="remind-sub">${sub}</span>
      </span>
      <span class="sz-remind__switch" aria-hidden="true"><span class="sz-remind__knob"></span></span>
    </${Button}>
    ${view.on ? html`<div class="sz-remind__row">
      <label class="sz-remind__main" for="sz-remind-time"><span class="sz-remind__title">${tRef(view.remindPage.timeLabel)}</span></label>
      <input class="sz-remind__time" id="sz-remind-time" type="time" step="60" required value=${timeText(remind.hour, remind.minute)}
        data-value=${timeText(remind.hour, remind.minute)} data-testid="remind-time" onChange=${on.time} />
    </div>` : null}
    ${view.denied ? html`<p class="sz-remind__note" data-testid="remind-denied">
      <span>${tRef(view.remindPage.note.body)}</span><br />
      <${Button} variant="text" data-testid="remind-open-system" onClick=${on.openSystem}>${tRef(view.remindPage.note.link)}</${Button}>
    </p>` : null}
    ${fail ? html`<div class="sz-remind__fail">${FailBlock({
      testid: 'remind-fail', text: tRef(view.remindPage.fail.text), cancelLabel: tRef(view.remindPage.fail.cancel), retryLabel: tRef(view.remindPage.fail.retry),
      attrs: { 'data-field': fail.field }, onCancel: on.failCancel, onRetry: on.failRetry,
    })}</div>` : null}
  </div>`;
}

function RemindScreen() {
  const state = useSettingsState();
  const [fail, setFail] = useState(null); // {field, run}
  const view = remindView(state.settings);

  const run = (field, fn, after = null) => {
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
    setFail({ field, run: () => run(field, fn, after) });
    return false;
  };
  const store = () => getStore();
  const on = {
    toggle: () => {
      // 开关显示的是「现在收不收得到」（view.on）。通知被手机关掉时（denied）开关显示关：再点一下 = 记下「要开」、
      // 重新向系统要一次权限（系统已拒绝时不会再弹窗，原生立刻回 denied）并带去手机设置——iOS 只能在那里重新打开（E3）。
      if (view.denied && !view.on) {
        run('remind', () => commitRemindEnabled(store(), true), () => {
          const remind = remindOf(store());
          requestReminderPermission(remind);
          syncReminder(remind);
          postNative('openAppSettings', {});
        });
        return;
      }
      const next = !view.on;
      run('remind', () => commitRemindEnabled(store(), next), () => {
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
      const ok = run('time', () => commitRemindTime(store(), parsed.hour, parsed.minute), () => syncReminder(remindOf(store())));
      if (!ok) input.value = old;
    },
    openSystem: () => postNative('openAppSettings', {}),
    failCancel: () => setFail(null),
    failRetry: () => {
      if (fail && fail.run) fail.run();
    },
  };
  return html`<${Page} title=${t('R-M03.remind')} testid="remind-screen">
    <${RemindBody} view=${view} fail=${fail} on=${on} />
  </${Page}>`;
}

/** 从「我的」页「提醒」行进入。 */
export function openRemind() {
  if (!getScreen(REMIND_SCREEN)) return false;
  nav.push(REMIND_SCREEN, {});
  return true;
}

registerScreen(REMIND_SCREEN, RemindScreen, { label: t('R-M03.remind'), native: true });

// ---------------------------------------------------------------- 网页的折行点（B3.10：原生要跟网页折在同一处）
//
// 开关行的小字是 text-wrap: pretty（.sz-remind__sub）：WebKit 的折法不是贪心折行，
// 原生按这里量出的行起点断行（src/ui/text-lines.js；与结果页 native-view.js 的 webLineStarts 同一做法）。
// 副本照网页的层级排（.sz-page__body → .sz-remind → .sz-remind__row → .sz-remind__main → .sz-remind__sub）：
// 开关本体（44 宽）也在副本里，小字的可用宽才与网页一样（行宽 − 44 − 间距 12）。

function remindSubLineStarts(text, extra) {
  return domLineStarts(host => {
    const body = document.createElement('div');
    body.className = 'sz-page__body';
    const block = document.createElement('div');
    block.className = 'sz-remind';
    const row = document.createElement('button');
    row.className = 'sz-btn sz-btn--plain sz-remind__row';
    const main = document.createElement('span');
    main.className = 'sz-remind__main';
    const title = document.createElement('span');
    title.className = 'sz-remind__title';
    title.textContent = (extra && extra.title) || '';
    const sub = document.createElement('span');
    sub.className = 'sz-remind__sub';
    const node = document.createTextNode(text);
    sub.appendChild(node);
    main.appendChild(title);
    main.appendChild(sub);
    const sw = document.createElement('span');
    sw.className = 'sz-remind__switch';
    sw.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('span');
    knob.className = 'sz-remind__knob';
    sw.appendChild(knob);
    row.appendChild(main);
    row.appendChild(sw);
    block.appendChild(row);
    body.appendChild(block);
    host.appendChild(body);
    return textUnits(node);
  }, screenWidth());
}

registerTextLines('remind.sub', (text, extra) => remindSubLineStarts(text, extra));
