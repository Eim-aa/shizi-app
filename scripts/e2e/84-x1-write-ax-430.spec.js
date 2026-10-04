// R2-X1（D51 ⑦，P225）：写字页 AX 专属版式，430×932 一档（共用 x1-write-ax.mjs；拆开是为了单个 spec 不超过 90s）。
import { runWriteAx } from './x1-write-ax.mjs';

export default async function x1WriteAx430(page, ctx) {
  await runWriteAx(page, ctx, [{ width: 430, height: 932 }]);
}
