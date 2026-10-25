// 折行点（网页量、原生用；B3.12 / B3.13）。
//
// 网页的段落是 text-wrap: pretty / balance（WebKit 按整段均衡折行），原生（TextKit）没有对应的折行算法，
// 同一段字两边折出来的行不一样（AX 档尤其明显）。这里由界面层（src/ui/）把「量」的实现登记进来，
// 会话层只取结果：量到每一行从第几个字开始，原生按这些位置换行（字的样子仍由原生排）。
//
// 量法与 src/ui/screens/result/native-view.js 的 webLineStarts 同一套：在页面里用同一组 CSS 类排一份看不见的副本，
// 量出每一行从第几个单位开始。没有 DOM 的地方（node 单测）量不到，就不给折行点，原生按自己的宽度折。
//
// 会话层不碰 DOM、不导入界面层：实现登记在界面层，这里只留一个槽位。

let measurer = null;

/** 界面层登记「量折行点」的实现（传 null 取消）。 */
export function setLineMeasurer(fn) {
  measurer = typeof fn === 'function' ? fn : null;
}

/**
 * 量一段字在给定宽度下的折行点。
 * @param {{text: string, cls: string, tag?: string, width?: number}} spec
 *   text：一段字；cls：网页上这段字的 CSS 类（量的时候用同一组类，字号 / 行高 / text-wrap 才一样）；
 *   tag：元素的标签名（p 有全局的 text-wrap: pretty，h2 有标题的 balance）；width：这段字可用的宽（0 = 页面正文宽）。
 * @returns {number[]|null} 每一行从第几个字开始（第一行是 0，不在数组里）；量不到返回 null
 */
export function measureLines(spec) {
  if (!measurer) return null;
  try {
    const r = measurer(spec);
    return Array.isArray(r) ? r : null;
  } catch (error) {
    return null;
  }
}
