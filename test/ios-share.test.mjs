// 阶段 1 Q2-6（03 P162）：存相册。不编译 Xcode 工程，只对 ios/ShiziApp/ShiziApp/RootViewController.swift 做静态核对；
// Swift 能否编译由 `xcodebuild build`（Simulator SDK）另行验证。
//   Q2-6：保存到相册接受 JPEG（quality 0.92 的 data:image/jpeg）与 PNG，文件头与声明一致；保存按原始字节写入相册；扩展名跟着实际格式走。
// B4.9：页面发起的分享（sharePracticeCard / shareBackup，Q2-7 的临时文件目录）随网页删除——原生备份页与图片预览自己弹系统分享面板。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/RootViewController.swift'), 'utf8');

test('Q2-6 原生壳接受 JPEG：imageData 认 data:image/jpeg 与 data:image/png 并核对文件头', () => {
  assert.match(swift, /static func imageData\(fromDataURL dataURL: String\) -> CardImage\?/);
  assert.match(swift, /data:image\/jpeg;base64,/);
  assert.match(swift, /\[0xFF, 0xD8, 0xFF\]/, 'JPEG magic');
  assert.match(swift, /\[0x89, 0x50, 0x4E, 0x47\]/, 'PNG magic');
  assert.doesNotMatch(swift, /static func pngData/, '不再只认 PNG');
});

test('Q2-6 保存走 imageData：按原始字节写入相册；文件名的扩展名跟着实际格式走', () => {
  const save = swift.slice(swift.indexOf('func saveCard('), swift.indexOf('// MARK: - 练习提醒'));
  assert.match(save, /Self\.imageData\(fromDataURL: dataURL\)/);
  assert.match(save, /PHAssetCreationRequest\.forAsset\(\)/);
  assert.match(save, /addResource\(with: \.photo, data: card\.data/);
  assert.match(swift, /static func fileName\(_ stem: String, forExtension ext: String\) -> String/);
});
