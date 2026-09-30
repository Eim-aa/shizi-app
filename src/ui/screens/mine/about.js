// 关于（02 M4-6；04 R-AB01 / R-AB02；03 P21；原型 ShiziScreen-第十稿交接版 L161–L163，reference/J-proto-screen.md §2.3.19）。
//
// 页面 'about'（「我的」菜单「关于拾字 ›」推入；入口行归 M4-1，调用 openAbout()）：
//   页头「关于拾字」+ 返回；64px 红印「字」+「拾字」+ 版本行（src/build-info.js 的 BUILD，原型写死的「1.0 · 2026 年 9 月」
//   没有数据来源，待定）；楷体两行题句；三行（每行一个 button）：
//     隐私 / 「记录只存在这台手机上 ›」 → 'about-privacy'
//     「开源资料 · 致谢」 / › → 'about-credits'（原型左侧「字形和字源的出处」已被 R-AB01 替换掉，行标签取 R-AB01.openSourceRow 去掉行尾 ›）
//     「给我们写信」 / › → 'about-letter'
// 子页都是只读页，不写任何东西；返回一律 nav.back()（Page 默认），回到关于页。
//   'about-privacy'  隐私：X-ABOUT.privacy1–4（03 P21 过渡：由现有文档整理，待文案）。
//   'about-credits'  开源资料 · 致谢：src/config/credits.js（scripts/build_credits.mjs 由 THIRD_PARTY_NOTICES.md 与
//                    licenses/、sources/LICENSE-* 生成）按 程序 / 字形和字源 / 字体 分组；每项 名称 + 版本、许可名、出处网址
//                    （纯文本，不做外链，避免在壳里跳出应用），「许可全文」按钮展开 NOTICES 原文与许可全文（英文原文）。
//                    ShiziKai / ShiziSerifSC 在 M5-2 写进 NOTICES 后重跑生成器即出现。
//   'about-letter'   给我们写信：R-AB01.letterAddressPending「地址待补」（03 P21 待文案 / 地址）。
//
// data-testid（前缀 about-）：
//   about-screen、about-head、about-seal、about-name、about-build、about-motto、about-rows、
//   about-row-privacy / about-row-credits / about-row-letter（data-to=目标屏）；
//   about-privacy-screen、about-privacy-p（×4）；
//   about-credits-screen、about-credits-intro、about-credits-group（data-kind）、about-credit（data-id / data-kind / data-open）、
//   about-credit-name、about-credit-license、about-credit-url、about-credit-toggle（aria-expanded）、about-credit-text；
//   about-letter-screen、about-letter-address（data-pending=P21）。

import { html, useState } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { BUILD } from '../../../build-info.js';
import { CREDITS, LICENSE_TEXTS } from '../../../config/credits.js';

export const ABOUT_SCREEN = 'about';
export const ABOUT_PRIVACY_SCREEN = 'about-privacy';
export const ABOUT_CREDITS_SCREEN = 'about-credits';
export const ABOUT_LETTER_SCREEN = 'about-letter';

export const CREDIT_KINDS = Object.freeze(['code', 'data', 'font']);
const GROUP_KEY = Object.freeze({ code: 'X-ABOUT.groupCode', data: 'X-ABOUT.groupData', font: 'X-ABOUT.groupFont' });

// ---------------------------------------------------------------- 纯函数（test/ui/about.test.mjs）

/** 行尾的「 ›」只是视觉箭头：行标签 / 读屏名里去掉。 */
export function stripArrow(text) {
  return String(text).replace(/\s*›\s*$/, '');
}

/** 关于页三行：{key, label, value, to, aria}。 */
export function aboutRows() {
  const privacy = t('X-ABOUT.privacy');
  const privacyValue = t('R-AB01.privacyRow');
  const credits = stripArrow(t('R-AB01.openSourceRow'));
  const letter = t('R-AB01.letterTitle');
  return [
    { key: 'privacy', label: privacy, value: privacyValue, to: ABOUT_PRIVACY_SCREEN, aria: `${privacy}，${stripArrow(privacyValue)}` },
    { key: 'credits', label: credits, value: t('X-ABOUT.more'), to: ABOUT_CREDITS_SCREEN, aria: credits },
    { key: 'letter', label: letter, value: t('X-ABOUT.more'), to: ABOUT_LETTER_SCREEN, aria: letter },
  ];
}

/** 隐私子页段落。 */
export function privacyParagraphs() {
  return [1, 2, 3, 4].map(i => t(`X-ABOUT.privacy${i}`));
}

/**
 * 开源资料分组（程序 / 字形和字源 / 字体，空组不出现；组内保持 NOTICES 顺序）。
 * @returns {{kind, title, items: object[]}[]}
 */
export function creditGroups(credits = CREDITS) {
  return CREDIT_KINDS.map(kind => ({
    kind,
    title: t(GROUP_KEY[kind]),
    items: credits.filter(c => c.kind === kind),
  })).filter(g => g.items.length > 0);
}

/** 一项的展开全文：NOTICES 原文 + 引用的许可全文（按引用顺序）。 */
export function creditFullText(credit, texts = LICENSE_TEXTS) {
  const parts = [credit.notice];
  for (const p of credit.licenseFiles || []) if (texts[p]) parts.push(`— ${p} —\n\n${texts[p].trimEnd()}`);
  return parts.filter(Boolean).join('\n\n');
}

export function creditName(credit) {
  return credit.version ? `${credit.name} ${credit.version}` : credit.name;
}

export function openAbout() {
  nav.push(ABOUT_SCREEN);
}

// ---------------------------------------------------------------- 样式

injectStyles('about', `
.sz-about__head{display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px 0 8px}
.sz-about__seal{width:64px;height:64px;border-radius:6px;background:${T.a};display:grid;place-items:center;
  font-family:var(--kai, serif);font-size:42px;line-height:1;color:#FFF9F1;transform:rotate(-3deg)}
.sz-about__name{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});font-weight:500;color:${T.i1}}
.sz-about__build{margin:0;font-size:calc(15px * ${T.k});color:${T.i2};font-variant-numeric:tabular-nums;overflow-wrap:anywhere;text-align:center}
.sz-about__motto{margin:0;text-align:center;font-family:var(--kai, serif);font-size:calc(17px * ${T.k});line-height:1.9;color:${T.i1}}
.sz-about__rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;border-top:1px solid ${T.i5}}
.sz-about__row{width:100%;min-height:52px;padding:8px 0;box-sizing:border-box;display:flex;align-items:center;
  justify-content:space-between;gap:12px;text-align:left;color:${T.i1};border-bottom:1px solid ${T.i5}}
.sz-about__label{min-width:0;font-size:calc(15px * ${T.k});color:${T.i1}}
.sz-about__value{flex:none;max-width:60%;text-align:right;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-about__value--arrow{font-size:calc(13px * ${T.k});color:${T.i3}}
.sz-about__p{margin:0;font-size:calc(15px * ${T.k});line-height:1.8;color:${T.i1};text-wrap:pretty}
.sz-about__intro{margin:0;font-size:calc(15px * ${T.k});line-height:1.8;color:${T.i2};text-wrap:pretty}
.sz-about__group{display:flex;flex-direction:column;gap:0}
.sz-about__gtitle{margin:0 0 8px;font-family:${T.serif};font-size:calc(17px * ${T.k});font-weight:500;color:${T.i1}}
.sz-about__items{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;border-top:1px solid ${T.i5}}
.sz-about__item{display:flex;flex-direction:column;gap:4px;padding:12px 0;border-bottom:1px solid ${T.i5};min-width:0}
.sz-about__iname{margin:0;font-size:calc(15px * ${T.k});line-height:1.5;color:${T.i1};overflow-wrap:anywhere}
.sz-about__meta{margin:0;font-size:calc(13px * ${T.k});line-height:1.6;color:${T.i2};overflow-wrap:anywhere}
.sz-about__url{-webkit-user-select:text;user-select:text}
.sz-about__toggle{align-self:flex-start;min-height:44px;padding:0 4px;margin-left:-4px;font-size:calc(13px * ${T.k});color:${T.i2}}
.sz-about__text{margin:0;max-width:100%;box-sizing:border-box;padding:12px;background:${T.sh};border-radius:6px;
  font-family:ui-monospace, Menlo, monospace;font-size:calc(11px * ${T.k});line-height:1.55;color:${T.i2};
  white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.sz-about__address{margin:0;font-size:calc(15px * ${T.k});line-height:1.8;color:${T.i2}}
`);

// ---------------------------------------------------------------- 视图

export function AboutView({ onOpen = to => nav.push(to) } = {}) {
  const rows = aboutRows();
  return html`<${Page} title=${t('X-ABOUT.title')} testid="about-screen">
    <div class="sz-about__head" data-testid="about-head">
      <span class="sz-about__seal" aria-hidden="true" data-testid="about-seal">${t('X-ABOUT.seal')}</span>
      <p class="sz-about__name" data-testid="about-name">${t('X-ABOUT.appName')}</p>
      <p class="sz-about__build" data-testid="about-build">${BUILD}</p>
    </div>
    <p class="sz-about__motto" data-testid="about-motto">${t('X-ABOUT.motto').map((line, i) => html`${i ? html`<br />` : null}${line}`)}</p>
    <ul class="sz-about__rows" data-testid="about-rows">
      ${rows.map(r => html`<li key=${r.key}>
        <${Button} variant="plain" class="sz-about__row" data-testid=${`about-row-${r.key}`} data-to=${r.to}
          aria-label=${r.aria} onClick=${() => onOpen(r.to)}>
          <span class="sz-about__label">${r.label}</span>
          <span class=${r.key === 'privacy' ? 'sz-about__value' : 'sz-about__value sz-about__value--arrow'} aria-hidden="true">${r.value}</span>
        </${Button}>
      </li>`)}
    </ul>
  </${Page}>`;
}

export function PrivacyView() {
  return html`<${Page} title=${t('X-ABOUT.privacy')} testid="about-privacy-screen">
    ${privacyParagraphs().map((p, i) => html`<p class="sz-about__p" key=${i} data-testid="about-privacy-p">${p}</p>`)}
  </${Page}>`;
}

function CreditItem({ credit }) {
  const [open, setOpen] = useState(false);
  const name = creditName(credit);
  const textId = `about-credit-text-${credit.id}`;
  return html`<li class="sz-about__item" data-testid="about-credit" data-id=${credit.id} data-kind=${credit.kind}
    data-open=${open ? 'true' : 'false'}>
    <p class="sz-about__iname" data-testid="about-credit-name">${name}</p>
    ${credit.license ? html`<p class="sz-about__meta" data-testid="about-credit-license">${credit.license}</p>` : null}
    ${credit.url ? html`<p class="sz-about__meta sz-about__url" data-testid="about-credit-url">${credit.url}</p>` : null}
    <${Button} variant="plain" class="sz-about__toggle" data-testid="about-credit-toggle" aria-expanded=${open ? 'true' : 'false'}
      aria-controls=${textId} aria-label=${`${name}，${t('X-ABOUT.licenseMore')}`} onClick=${() => setOpen(v => !v)}
      >${t('X-ABOUT.licenseMore')}</${Button}>
    ${open ? html`<pre class="sz-about__text" id=${textId} data-testid="about-credit-text" lang="en">${creditFullText(credit)}</pre>` : null}
  </li>`;
}

export function CreditsView({ credits = CREDITS } = {}) {
  return html`<${Page} title=${t('X-ABOUT.creditsTitle')} testid="about-credits-screen">
    <p class="sz-about__intro" data-testid="about-credits-intro">${t('X-ABOUT.creditsIntro')}</p>
    ${creditGroups(credits).map(g => html`<section class="sz-about__group" key=${g.kind} data-testid="about-credits-group" data-kind=${g.kind}>
      <h2 class="sz-about__gtitle">${g.title}</h2>
      <ul class="sz-about__items">${g.items.map(c => html`<${CreditItem} key=${c.id} credit=${c} />`)}</ul>
    </section>`)}
  </${Page}>`;
}

export function LetterView() {
  return html`<${Page} title=${t('R-AB01.letterTitle')} testid="about-letter-screen">
    <p class="sz-about__address" data-testid="about-letter-address" data-pending="P21">${t('R-AB01.letterAddressPending')}</p>
  </${Page}>`;
}

function AboutScreen() {
  return html`<${AboutView} />`;
}

registerScreen(ABOUT_SCREEN, AboutScreen, { label: t('X-ABOUT.title') });
registerScreen(ABOUT_PRIVACY_SCREEN, () => html`<${PrivacyView} />`, { label: t('X-ABOUT.privacy') });
registerScreen(ABOUT_CREDITS_SCREEN, () => html`<${CreditsView} />`, { label: t('X-ABOUT.creditsTitle') });
registerScreen(ABOUT_LETTER_SCREEN, () => html`<${LetterView} />`, { label: t('R-AB01.letterTitle') });
