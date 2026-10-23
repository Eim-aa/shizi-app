// 关于 + 三个子页的视图模型（B3.2 试点页；网页 ui/screens/mine/about.js 与 App API 的 view.about* 同一组函数）。
//
// 只给文案引用（键 + 参数）与数据，不拼句子（B3.4 规则）；网页用 tRef 渲染、原生用 ShiziCopy 渲染，两边的渲染规则一样：
//   - 行标签 = 渲染后去掉行尾「 ›」（stripArrow）；
//   - 行的读屏名 = 有 value 时「标签，value 去掉行尾 ›」，没有 value（行尾画 chevron）时就是标签；
//   - motto 是多行文案（数组值）。
// 版本号 / BUILD、是否在原生壳内由调用方传入（src/build-info.js 不在会话层的导入边界里，platform/env 判断由 UI 层做）。

import { ref } from '../../config/copy/index.js';
import { CREDITS, LICENSE_TEXTS } from '../../config/credits.js';
import { sealGlyphPath } from '../../core/images/shi-paths.js';

export const ABOUT_SCREEN = 'about';
export const ABOUT_PRIVACY_SCREEN = 'about-privacy';
export const ABOUT_CREDITS_SCREEN = 'about-credits';
export const ABOUT_LETTER_SCREEN = 'about-letter';

export const CREDIT_KINDS = Object.freeze(['code', 'data', 'font']);
const GROUP_KEY = Object.freeze({ code: 'X-ABOUT.groupCode', data: 'X-ABOUT.groupData', font: 'X-ABOUT.groupFont' });

/** BUILD「20261001-abcdef123456」的日期部分；形状不对就原样返回。 */
export function buildDay(build) {
  const m = /^(\d{8})-/.exec(String(build));
  return m ? m[1] : String(build);
}

/** 行尾的「 ›」只是视觉箭头：行标签 / 读屏名里去掉（网页与原生同一条规则）。 */
export function stripArrow(text) {
  return String(text).replace(/\s*›\s*$/, '');
}

/** 版本行：「版本 1.0（20261001）」、读屏名、展开后的完整构建号（D36 / P90）。 */
export function versionRefs(version, build) {
  const vars = { version, day: buildDay(build) };
  return { line: ref('X-ABOUT.version', vars), aria: ref('X-ABOUT.versionAria', vars), full: ref('X-ABOUT.buildFull', { build }) };
}

/** 关于页三行：{key, label, value（null = 行尾画 chevron）, to}。 */
export function aboutRowRefs() {
  return [
    { key: 'privacy', label: ref('X-ABOUT.privacy'), value: ref('R-AB01.privacyRow'), to: ABOUT_PRIVACY_SCREEN },
    { key: 'credits', label: ref('R-AB01.openSourceRow'), value: null, to: ABOUT_CREDITS_SCREEN },
    { key: 'letter', label: ref('R-AB01.letterTitle'), value: null, to: ABOUT_LETTER_SCREEN },
  ];
}

/** 关于页（view.about）。seal：题句末那枚印的印文路径（单位方块，网页 SealGlyph 同一组 path；原生按边长缩放）。 */
export function aboutModel({ version, build }) {
  return {
    title: ref('X-ABOUT.title'),
    name: ref('X-ABOUT.appName'),
    version: versionRefs(version, build),
    motto: ref('X-ABOUT.motto'),
    rows: aboutRowRefs(),
    seal: sealGlyphPath(),
  };
}

/** 隐私子页（view.about-privacy）：第 3 段按平台（C1，P197）——iOS 壳完全不联网，网页 / PWA 联网只取更新与笔顺。 */
export function privacyModel({ native }) {
  return {
    title: ref('X-ABOUT.privacy'),
    paragraphs: [ref('X-ABOUT.privacy1'), ref('X-ABOUT.privacy2'), ref(native ? 'X-ABOUT.privacy3Native' : 'X-ABOUT.privacy3Web'), ref('X-ABOUT.privacy4')],
  };
}

export function creditName(credit) {
  return credit.version ? `${credit.name} ${credit.version}` : credit.name;
}

/** 一项的展开全文：NOTICES 原文 + 引用的许可全文（按引用顺序）。 */
export function creditFullText(credit, texts = LICENSE_TEXTS) {
  const parts = [credit.notice];
  for (const p of credit.licenseFiles || []) if (texts[p]) parts.push(`— ${p} —\n\n${texts[p].trimEnd()}`);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * 开源资料分组（程序 / 字形和字源 / 字体，空组不出现；组内保持 NOTICES 顺序）：{kind, title: 引用, items: 原始条目}。
 */
export function creditGroupRefs(credits = CREDITS) {
  return CREDIT_KINDS.map(kind => ({ kind, title: ref(GROUP_KEY[kind]), items: credits.filter(c => c.kind === kind) })).filter(g => g.items.length > 0);
}

/** 开源致谢子页（view.about-credits）：每项 名称 + 版本、许可名、出处网址、展开全文（数据，不是文案）。 */
export function creditsModel(credits = CREDITS, texts = LICENSE_TEXTS) {
  return {
    title: ref('X-ABOUT.creditsTitle'),
    intro: ref('X-ABOUT.creditsIntro'),
    toggle: ref('X-ABOUT.licenseMore'),
    groups: creditGroupRefs(credits).map(g => ({
      kind: g.kind,
      title: g.title,
      items: g.items.map(c => ({ id: c.id, kind: c.kind, name: creditName(c), license: c.license || '', url: c.url || '', text: creditFullText(c, texts) })),
    })),
  };
}

/** 联系我们子页（view.about-letter）：来信地址未定（03 P21 过渡文案）。 */
export function letterModel() {
  return { title: ref('R-AB01.letterTitle'), address: ref('R-AB01.letterAddressPending') };
}
