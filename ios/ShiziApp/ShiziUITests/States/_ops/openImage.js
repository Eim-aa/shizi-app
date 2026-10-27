// 点网页上的「做图片」入口（原生壳里网页只发 open 消息，原生弹层出来；网页版照旧开自己的弹层）。
// 只在原生壳里生效（网页版由夹具的步骤点同一个按钮，取证口径不变）。
// 注意：网页按钮有 0.4s 防连点（新建页 / 新状态后 0.4s 内不响应，components/Button.js）——
// 这个 op 在建页之后紧接着跑，所以要等过这个窗口再点，否则按下去没反应。
// a: {sel: css 选择器（默认 [data-testid="annual-adjust"]），scope: 网页按钮不在时（原生页）直接开的图片范围}
if (!window.__shiziNative) return { ok: true, skipped: true };
const sel = (a && a.sel) || '[data-testid="annual-adjust"]';
let el = null;
for (let i = 0; i < 80; i += 1) {
  el = document.querySelector(sel);
  if (el) break;
  await new Promise(r => setTimeout(r, 100));
}
if (!el) {
  // B3.9：月字帖 / 年报已是原生页，网页按钮不在了——按夹具写的 scope 直接开原生弹层（与原生页的图片按钮同一个 NativeImagePreviewController，
  // 经网页发起的宿主 ShiziScreen_image_preview 呈现，ready 标记 id:native-image-preview-screen 在宿主上）
  if (a && a.scope) {
    const { openImage } = await import('/src/ui/images-entry.js');
    openImage(a.scope);
    await new Promise(r => setTimeout(r, 300));
    return { ok: true, via: 'scope' };
  }
  return { ok: false, error: { kind: 'no-button' } };
}
await new Promise(r => setTimeout(r, 600)); // 等过防连点的 0.4s
el.click();
await new Promise(r => setTimeout(r, 300)); // 等消息发出去
return { ok: true };
