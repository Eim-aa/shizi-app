// 年报的分享 / 保存（阶段 1 P1-E7；交接 §8.2；D39 / D46 ⑦ ⑧）。年报页右上「分享」→ 弹层「保存年报」：
//   默认册页：卷首 1 张 + 每月一页（月字帖，超过 80 字按 D39 分张）+ 卷尾 1 张（有「同一个字，两次」才出），每张 3:4；主按钮「保存 {n} 张图片」；
//   文字按钮「存成一张长图」：一张、宽 1440、高按内容，不受 80 字上限；总高超过单张上限时按月切成几张（不截字）。
// 落款只用品牌印「字」；纸上记录不进（D46-13，由 annual-model / pick.js 的成员口径保证）。
// 取墨与取字口径同月字帖（D42）：每月每字取该月留墨的第一次，没墨画 under 衬底。
import { nav } from './router.js';
import { getStore } from '../store/store.js';
import { t } from '../config/copy/index.js';
import * as defaultPolicy from '../config/policy.js';
import { localDay, monthOf } from '../core/dates.js';
import { now as envNow } from '../platform/env.js';
import { renderWorkPage } from '../core/images/render.js';
import { renderAnnualCover, renderAnnualLong, renderAnnualTail } from '../core/images/annual-render.js';
import { ImagePreview, IMAGE_OVERLAY } from './components/image-preview.js';
import { recordHasInk } from './screens/detail/records.js';
import { annualPlan } from './screens/mine/annual-model.js';
import { inkPointsOf, renderDeps } from './images-entry.js';
import {
  annualBrandKuan, annualCoverLine, annualFirstDateText, annualTailDateText, annualTailKuan, annualYearText, monthKuan,
} from './work-text.js';

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 年报弹层的任务（形状见 components/image-preview.js 头注）。 */
export function buildAnnualJob({ state = null, store = storeOrNull(), inkOf = null, policy = defaultPolicy, today = null } = {}) {
  const st = state || (store ? store.getState() : null);
  const day = today || localDay(envNow());
  const ink = inkOf || (record => inkPointsOf(store, record));
  const plan = annualPlan(st, { today: day, inkOf: ink, hasInk: record => recordHasInk(store, record), policy });
  const year = plan.model.year;
  const sealText = t('X-IMAGES.seal');
  const deps = renderDeps();
  const coverArgs = () => ({
    yearText: annualYearText(year),
    line: annualCoverLine(plan.model.count),
    first: plan.first,
    firstLabel: t('X-WORK.annualFirstLabel'),
    firstDate: annualFirstDateText(plan.model.first.day),
    kuan: annualBrandKuan(),
    sealText,
  });
  const tailArgs = () => ({
    title: t('X-WORK.annualTwiceTitle'),
    first: plan.tail.first,
    last: plan.tail.last,
    firstDate: annualTailDateText(plan.tail.firstDay),
    lastDate: annualTailDateText(plan.tail.lastDay),
    kuan: annualTailKuan(monthOf(day)),
    sealText,
  });
  return {
    kind: 'annual',
    plan,
    title: t('X-WORK.annualSaveTitle'),
    note: t('X-WORK.annualSaveNote'),
    emptyNote: '',
    ratios: ['3:4'],
    initialRatio: '3:4',
    status: () => plan.status,
    pageCount: () => plan.pages.length || 1,
    saveLabel: total => t('X-WORK.annualSaveButton', { n: total }),
    renderPage: async (i, ratio, { scale } = {}) => {
      const page = plan.pages[i];
      if (!page) return { status: 'empty', canvas: null };
      if (page.type === 'cover') return renderAnnualCover({ ...coverArgs(), scale, ...deps, meta: { page: i + 1, pages: plan.pages.length } });
      if (page.type === 'tail') return renderAnnualTail({ ...tailArgs(), scale, ...deps, meta: { page: i + 1, pages: plan.pages.length } });
      return renderWorkPage({
        cells: page.cells, ratio: '3:4', kuan: monthKuan({ month: page.month, n: page.cells.length, part: page.part, of: page.of }), sealText, scale, ...deps,
        meta: { kind: 'annual-month', month: page.month, page: i + 1, pages: plan.pages.length },
      });
    },
    fileName: (ratio, i, total) => `shizi-annual-${year}-${String(i + 1).padStart(2, '0')}of${total}.jpg`,
    alt: {
      label: t('X-WORK.annualSaveLong'),
      note: t('X-WORK.annualLongNote'),
      render: async () => {
        const out = await renderAnnualLong({
          ...coverArgs(),
          months: plan.months.map(m => ({
            name: t('X-WORK.annualMonthName', { month: m.monthNum }),
            count: t('X-WORK.annualMonthCount', { n: m.cells.length }),
            cells: m.cells,
          })),
          tail: plan.tail ? { ...tailArgs() } : null,
          ...deps,
        });
        return out.canvases;
      },
      fileName: (i, total) => `shizi-annual-${year}-long${total > 1 ? `-${i + 1}of${total}` : ''}.jpg`,
    },
  };
}

/** 打开「保存年报」弹层；返回 overlay id。 */
export function openAnnualImage(opts) {
  return nav.openOverlay(ImagePreview, { job: buildAnnualJob(opts) }, { name: IMAGE_OVERLAY });
}
