// 习字 tab 根页（M0-4：空页；M2-1 按第十稿首页实现）。自注册，无中心路由表。
import { html } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { TabPage } from '../../components/Page.js';

// 占位文案：M0-6 建立 src/config/copy/ 后迁入（tab 名见原型 ShiziScreen tabs）。
export const HOME_LABEL = '习字';

// 演示子页只在测试主机上加载（ui/root.js），生产形态里 getScreen 为 null，入口不出现。
const DEMO_SCREEN = '_demo/sub';

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 9.4 11 3l8 6.4V19H3V9.4M8.4 19v-6.6h5.2V19"></path></svg>`;

function HomeScreen() {
  const demo = getScreen(DEMO_SCREEN);
  return html`<${TabPage} title=${HOME_LABEL} testid="screen-home">
    ${demo ? html`<${Button} variant="secondary" data-testid="demo-push"
      onClick=${() => nav.push(DEMO_SCREEN, { level: 1 })}>${demo.label}</${Button}>` : null}
  </${TabPage}>`;
}

registerScreen('home', HomeScreen, { tab: true, order: 0, label: HOME_LABEL, icon: ICON });
