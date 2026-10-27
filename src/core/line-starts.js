// 折行点的登记口（B3.9）：网页界面层量出「每一行从第几个字开始」，会话层据此把折行点放进视图模型，原生按同样的位置换行。
//
// 会话层不导入 UI：网页界面层（src/ui/screens/mine/line-starts.js）把测量函数登记进来，
// 会话层（src/session/views/mine-sub.js）只调用登记好的函数。没有登记 / 没有 DOM（node 单测）→ null（按各自的宽度折行）。
//
// 网页这几个段落是 text-wrap: pretty（WebKit 按整段平衡折行），原生排版算法不同：网页的折行点由网页量、原生照着排。

let breaker = null;

/**
 * 登记折行点的测量函数（{kind, text} → 每一行从第几个字开始的数组；null = 量不到）。
 * @param {(kind: string, text: string) => number[]|null} fn
 */
export function setLineBreaker(fn) {
  breaker = typeof fn === 'function' ? fn : null;
}

/**
 * 某一段的折行点（网页量的；null = 没有 / 量不到 → 按各自的宽度折行）。
 * @param {string} kind 段落的名字（网页界面层认得）
 * @param {string} text 那段的字
 * @returns {number[]|null}
 */
export function lineStarts(kind, text) {
  if (!breaker || !text) return null;
  try {
    const r = breaker(kind, text);
    return Array.isArray(r) ? r : null;
  } catch (error) {
    return null;
  }
}
