// 习字 tab 根页（M0-4：空页；M2-1 按第十稿首页实现）。自注册，无中心路由表。
import { html } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { TabPage } from '../../components/Page.js';
import { t } from '../../../config/copy/index.js';
import { isTestHost } from '../../../platform/env.js';
// 写字页自注册（M1-1）：首页是它的入口页，随首页一起加载。
import '../write/index.js';

// M1-1：测试宿主（?test=1 且 localhost）才出现的写字页入口，e2e 与走查用；开发标签不是用户文案（同 _demo）。
const DEV_WRITE_ENTRY = '写字（测试）';

// tab 名取自文案表（copy/common.js X-TABS）。
export const HOME_LABEL = t('X-TABS.write');

// 演示子页只在测试主机上加载（ui/root.js），生产形态里 getScreen 为 null，入口不出现。
const DEMO_SCREEN = '_demo/sub';

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 9.4 11 3l8 6.4V19H3V9.4M8.4 19v-6.6h5.2V19"></path></svg>`;

function HomeScreen() {
  const demo = getScreen(DEMO_SCREEN);
  return html`<${TabPage} title=${HOME_LABEL} testid="screen-home">
    ${demo ? html`<${Button} variant="secondary" data-testid="demo-push"
      onClick=${() => nav.push(DEMO_SCREEN, { level: 1 })}>${demo.label}</${Button}>` : null}
    ${isTestHost() ? html`<${Button} variant="secondary" data-testid="write-test-entry"
      onClick=${() => nav.push('write', { slot: 'A' })}>${DEV_WRITE_ENTRY}</${Button}>` : null}
  </${TabPage}>`;
}

registerScreen('home', HomeScreen, { tab: true, order: 0, label: HOME_LABEL, icon: ICON });
