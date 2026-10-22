// 网页上写笔画：在书写格的 live 画布上按 16ms 间隔派发指针事件（InkGrid 同一个 onDown / onMove / onUp）。参数 lines = [[[x, y]…]…]（345 单位）。
const c = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-live"]');
if (!c) return false;
const rc = c.getBoundingClientRect();
const side = Math.min(rc.width, rc.height), ox = (rc.width - side) / 2, oy = (rc.height - side) / 2;
const at = (q) => ({ clientX: rc.left + ox + q[0] * side / 345, clientY: rc.top + oy + q[1] * side / 345 });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let id = 40;
for (const line of lines) {
  id += 1;
  const base = { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1 };
  c.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...at(line[0]) }));
  for (let i = 1; i < line.length; i += 1) { await wait(16); c.dispatchEvent(new PointerEvent('pointermove', { ...base, ...at(line[i]) })); }
  c.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, ...at(line[line.length - 1]) }));
  await wait(200);
}
return true;
