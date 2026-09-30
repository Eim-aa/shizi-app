// 开发路由 'query-demo'：只给 e2e（scripts/e2e/20-query.spec.js）与开发走查用，不是产品页面。
// 只有测试主机（?test=1 且 localhost/127.0.0.1）才由 index.js 动态加载；生产形态不 import 本文件。
// 本文件的按钮标签是开发演示用，不进 copy/（同 src/ui/screens/_demo/sub.js，M0 验收 F5 允许）。
//
// 页面上两个按钮在点击处理里同步调用 openQuery（lookup / pick），并把「点击处理结束时的焦点」记进
// window.__shiziQueryDemo.focusAtClick（R-Q08 同步 focus 的断言）。回调只记录，不开会话：
//   picks / practices / details：每次回调的参数；nextResult：下一次 onPick / onPractice 的返回值（例如 {ok:false}，
//   测 R-H06 三段式），用一次就清掉。

import { html } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { Button } from '../Button.js';
import { Page } from '../Page.js';
import { openQuery } from './index.js';

export const QUERY_DEMO_SCREEN = 'query-demo';

const DEV = {
  title: '查字组件（开发）',
  lookup: '打开查字（lookup）',
  pick: '打开自己选字（pick）',
  lookupDetail: '打开查字（带查看记录）',
};

function log() {
  if (typeof window === 'undefined') return null;
  if (!window.__shiziQueryDemo) {
    window.__shiziQueryDemo = { picks: [], practices: [], details: [], focusAtClick: null, nextResult: undefined, opened: 0 };
  }
  return window.__shiziQueryDemo;
}

function takeResult() {
  const l = log();
  const r = l ? l.nextResult : undefined;
  if (l) l.nextResult = undefined;
  return r;
}

function open(mode, withDetail = false) {
  const l = log();
  openQuery({
    mode,
    onPick: chars => {
      l.picks.push(chars.slice());
      return takeResult();
    },
    onPractice: mode === 'lookup' ? c => {
      l.practices.push(c);
      return takeResult();
    } : undefined,
    onDetail: withDetail ? c => { l.details.push(c); } : undefined,
  });
  const el = document.activeElement;
  l.opened += 1;
  l.focusAtClick = el ? { tag: el.tagName, proxy: el.hasAttribute('data-query-focus-proxy') } : null;
}

function QueryDemo() {
  log();
  return html`<${Page} title=${DEV.title} testid="screen-query-demo">
    <${Button} variant="secondary" data-testid="query-demo-lookup" onClick=${() => open('lookup')}>${DEV.lookup}</${Button}>
    <${Button} variant="secondary" data-testid="query-demo-pick" onClick=${() => open('pick')}>${DEV.pick}</${Button}>
    <${Button} variant="secondary" data-testid="query-demo-lookup-detail" onClick=${() => open('lookup', true)}>${DEV.lookupDetail}</${Button}>
  </${Page}>`;
}

registerScreen(QUERY_DEMO_SCREEN, QueryDemo, { label: DEV.title });
