// 字库 tab 根页（M0-4：空页；M3-1 按第十稿字库墨墙实现）。自注册，无中心路由表。
import { html } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { t } from '../../../config/copy/index.js';

// tab 名取自文案表（copy/common.js X-TABS）。
export const LIBRARY_LABEL = t('X-TABS.library');

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5.4C7.8 3 4.6 3.8 3 4.6v13.2c2.4-.8 5.4-.4 8 1.2 2.6-1.6 5.6-2 8-1.2V4.6c-1.6-.8-4.8-1.6-8 .8ZM11 5.4v13.6"></path></svg>`;

function LibraryScreen() {
  return html`<${TabPage} title=${LIBRARY_LABEL} testid="screen-library"></${TabPage}>`;
}

registerScreen('library', LibraryScreen, { tab: true, order: 1, label: LIBRARY_LABEL, icon: ICON });
