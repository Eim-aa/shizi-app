// 阶段 1 Q2-6 / Q2-7（03 P162 / P182）：iOS 壳的分享与保存。不编译 Xcode 工程，只对 ios/ShiziApp/ShiziApp/WebViewController.swift 做静态核对；
// Swift 能否编译由 `xcodebuild build`（Simulator SDK）另行验证。
//   Q2-7：备份 / 图片分享的临时文件放在各自独立的 shizi-share-<UUID>/ 目录里，文件名就是页面给的名字（拾字备份-日期.json），文件名里不放 UUID；
//         同名冲突在扩展名前加序号；用完连目录一起删。
//   Q2-6：保存到相册 / 分享 接受 JPEG（quality 0.92 的 data:image/jpeg）与 PNG，文件头与声明一致；保存按原始字节写入相册；扩展名跟着实际格式走。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');

test('Q2-6 原生壳接受 JPEG：imageData 认 data:image/jpeg 与 data:image/png 并核对文件头', () => {
  assert.match(swift, /static func imageData\(fromDataURL dataURL: String\) -> CardImage\?/);
  assert.match(swift, /data:image\/jpeg;base64,/);
  assert.match(swift, /\[0xFF, 0xD8, 0xFF\]/, 'JPEG magic');
  assert.match(swift, /\[0x89, 0x50, 0x4E, 0x47\]/, 'PNG magic');
  assert.doesNotMatch(swift, /static func pngData/, '不再只认 PNG');
});

test('Q2-6 分享与保存走 imageData：扩展名跟着格式，保存按原始字节写入相册', () => {
  const share = swift.slice(swift.indexOf('private func sharePracticeCard'), swift.indexOf('private func presentCentered'));
  assert.match(share, /Self\.imageData\(fromDataURL: dataURL\)/);
  assert.match(share, /Self\.fileName\(safeStem, forExtension: image\.fileExtension\)/);
  assert.doesNotMatch(share, /\.png"/, '分享不再把名字强加 .png');
  const save = swift.slice(swift.indexOf('private func savePracticeCard'), swift.indexOf('private func sendPracticeCardSaveResult'));
  assert.match(save, /Self\.imageData\(fromDataURL: dataURL\)/);
  assert.match(save, /PHAssetCreationRequest\.forAsset\(\)/);
  assert.match(save, /addResource\(with: \.photo, data: card\.data/);
});

test('Q2-6 默认文件名是 .jpg', () => {
  assert.match(swift, /body\["name"\] as\? String \?\? "shizi-card\.jpg"/);
});

test('Q2-7 分享临时文件：独立目录 + 可认的文件名，文件名里没有 UUID，同名加序号，用完连目录删', () => {
  const fn = swift.slice(swift.indexOf('func temporaryShareURL'), swift.indexOf('private func shareBackup'));
  assert.match(fn, /appendingPathComponent\("\\\(Self\.temporarySharePrefix\)\\\(UUID\(\)\.uuidString\)", isDirectory: true\)/, 'UUID 只出现在目录名里');
  assert.match(fn, /createDirectory\(at: directory/);
  assert.match(fn, /return Self\.uniqueShareURL\(in: directory, name: filename\)/);
  assert.doesNotMatch(fn, /-\\\(safeName\)/, '文件名不再拼 UUID 前缀');
  assert.match(fn, /"\\\(stem\) \\\(n\)"/, '同名冲突加序号');
  assert.match(fn, /func removeTemporaryShareFile/);
  assert.equal((swift.match(/removeTemporaryShareFile\(/g) || []).length >= 4, true, '分享 / 保存 / 导入后都经它删除');
  assert.doesNotMatch(swift, /removeItem\(at: fileURL\)/, '不再只删文件留下空目录');
});
