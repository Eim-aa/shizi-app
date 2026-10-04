// 阶段 1 Q2-6（03 P162，交接 §6.5，复测 simB D9）：导出图一律 JPEG 0.92——网页（下载 / Web Share）与原生壳（保存到相册 / 分享）同一格式；
// 原生壳放开 JPEG 后 NATIVE_ACCEPTS_JPEG = true；文件名扩展名跟着实际格式走。Swift 一侧（WebViewController.imageData）的静态核对见 test/ios-share.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_ACCEPTS_JPEG, exportImage, withExt } from '../../src/ui/components/image-preview.js';
import { JPEG_QUALITY } from '../../src/core/images/render.js';

function fakeCanvas() {
  const calls = [];
  return { calls, toDataURL: (...args) => { calls.push(args); return `data:${args[0]};base64,AAAA`; } };
}

test('原生壳已接受 JPEG（P162）', () => {
  assert.equal(NATIVE_ACCEPTS_JPEG, true);
  assert.equal(JPEG_QUALITY, 0.92);
});

test('exportImage：网页与原生壳内都是 JPEG 0.92', () => {
  const web = fakeCanvas();
  assert.equal(exportImage(web, { win: {} }), 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(web.calls, [['image/jpeg', 0.92]]);
  const native = fakeCanvas();
  const nativeWin = { webkit: { messageHandlers: { shiziNative: { postMessage() {} } } } };
  assert.equal(exportImage(native, { win: nativeWin }), 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(native.calls, [['image/jpeg', 0.92]], 'native shell no longer gets a PNG');
});

test('withExt：扩展名跟着实际格式走（JPEG 保持 .jpg，PNG 才改 .png）', () => {
  assert.deepEqual(withExt({ dataURL: 'data:image/jpeg;base64,AAAA', name: 'a.jpg' }), { dataURL: 'data:image/jpeg;base64,AAAA', name: 'a.jpg' });
  assert.equal(withExt({ dataURL: 'data:image/png;base64,AAAA', name: 'a.jpg' }).name, 'a.png');
});
