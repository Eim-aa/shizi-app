// 触发一次「分享 / 保存失败」（原生壳里提示条由原生出，网页这一侧不出）。
// 只在原生壳里生效（网页版由夹具的步骤用 js 调同一个入口，取证口径不变）。
if (!window.__shiziNative) return { ok: true, skipped: true };
for (let i = 0; i < 80; i += 1) {
  if (document.querySelector('[data-testid="screen-library"]')) break;
  await new Promise(r => setTimeout(r, 100));
}
if (typeof window.shiziShareFailed === 'function') window.shiziShareFailed({ kind: 'card', reason: 'qa' });
return { ok: true };
