// R2-X1（D51 ⑦，P225）：写字页 AX 专属版式，375×667 一档（共用 x1-write-ax.mjs；拆开是为了单个 spec 不超过 90s）。
import { runWriteAx } from './x1-write-ax.mjs';

export default async function x1WriteAxse(page, ctx) {
  await runWriteAx(page, ctx, [{ width: 375, height: 667 }]);
}
