// 我的 tab 根页（M0-4：空页；M4-1 按第十稿「我的」实现）。自注册，无中心路由表。
import { html } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { TabPage } from '../../components/Page.js';

// 占位文案：M0-6 建立 src/config/copy/ 后迁入（tab 名见原型 ShiziScreen tabs）。
export const MINE_LABEL = '我的';

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="7" r="3.6"></circle><path d="M4.2 19.4v-3a6.8 6.8 0 0 1 13.6 0v3"></path></svg>`;

function MineScreen() {
  return html`<${TabPage} title=${MINE_LABEL} testid="screen-mine"></${TabPage}>`;
}

registerScreen('mine', MineScreen, { tab: true, order: 2, label: MINE_LABEL, icon: ICON });
