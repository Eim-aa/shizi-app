// 流程页余项的视图模型（B3.12；网页 src/ui/screens/session/none.js 与 App API 的 view.session-none 同一组函数）。
//
// 只给文案引用（键 + 参数）与数据，不拼句子（B3.4 规则）：网页用 tRef 渲染、原生用 ShiziCopy 渲染，两边的渲染规则一样。
// 「没有要写的字」页（R-H11）：
//   页头标题 = 「写字」；中间是全 App 唯一的空状态（S2：空格子 + 标题 + 说明 + 可选操作）；
//   exhausted（练习范围学完）时说明多一段、次入口是「看写错过的字 ›」，主按钮换成「更换字库」，「自己选字」降为次按钮；
//   没注册的入口不显示（不放点了没反应的按钮）——入口有没有由调用方（网页模块 / 原生）给。
// 入口的名字与去处（pick / wrongList / libSwitch）由网页的 setNoneActions 登记；原生经 App API 的 session.* op 走同一批函数。
//
// 折行点（lines）：网页的段落是 text-wrap: balance / pretty（WebKit 按整段均衡折行），原生（TextKit）折得不一样。
// 这里把网页量出来的「每一行从第几个字开始」一起给出去（量法见 src/session/views/lines.js）：原生按这些位置换行。
// 量不到（node 单测、没有 DOM）时是 null，原生按自己的宽度折。

import { ref, tRef } from '../../config/copy/index.js';
import { measureLines } from './lines.js';

export const NONE_SCREEN = 'session-none';

/** 空状态的操作：{label: 文案引用, to: 屏名或动作名}。to 为 null 时表示这个入口只是「有个去处」，由调用方接到自己的动作上。 */
export function noneView({ exhausted = false, pick = false, wrongList = false, libSwitch = false } = {}) {
  const canLibSwitch = !!exhausted && !!libSwitch;
  const titleText = tRef(ref('R-H11.title'));
  const bodyText = tRef(ref('R-H11.body'));
  const extraText = exhausted ? tRef(ref('R-H11.noCharsBody')) : '';
  return {
    screen: NONE_SCREEN,
    exhausted: !!exhausted,
    title: ref('X-TABS.write'),
    empty: {
      cell: true,
      title: ref('R-H11.title'),
      body: [ref('R-H11.body')],
      extra: exhausted ? [ref('R-H11.noCharsBody')] : [],
      // 「看写错过的字 ›」：只在 exhausted 且登记了这个入口时出现
      action: exhausted && wrongList ? { label: ref('R-H11.noCharsLink'), to: 'wrongList' } : null,
    },
    // 底栏：主按钮（exhausted 时是「更换字库」）+ 次按钮（「自己选字」）
    primary: canLibSwitch ? { label: ref('X-SESSION.noneLibSwitch'), to: 'libSwitch' } : pick ? { label: ref('X-SESSION.nonePick'), to: 'pick' } : null,
    secondary: canLibSwitch && pick ? { label: ref('X-SESSION.nonePick'), to: 'pick' } : null,
    // 折行点（网页量）：标题 / 说明 / 次说明各是从第几个字开始换行。
    lines: {
      title: measureLines({ text: titleText, variant: 'empty-title' }),
      body: measureLines({ text: bodyText, variant: 'empty-body' }),
      extra: extraText ? measureLines({ text: extraText, variant: 'empty-body' }) : null,
    },
  };
}
