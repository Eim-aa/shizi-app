// 打开单字详情（detail/index.js 的 openDetail 抽出来，让结果页 / 写字页不用把整张详情页拉进来；D66 ⑮）。
// 栈顶已是同一个字的详情时不再叠一层。
import { getRouter, nav } from '../../router.js';
import { isHan } from '../../../core/query.js';

export const DETAIL_SCREEN_NAME = 'detail';

/**
 * @returns {boolean} 是否推入
 */
export function openCharDetail(char) {
  if (!isHan(char)) return false;
  const router = getRouter();
  const snap = router ? router.getState() : null;
  const top = snap ? snap.top : null;
  if (snap && snap.depth > 0 && !snap.topIsOverlay && top && top.n === DETAIL_SCREEN_NAME && top.p && top.p.char === char) return false;
  nav.push(DETAIL_SCREEN_NAME, { char });
  return true;
}
