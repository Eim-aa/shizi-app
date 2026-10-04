// 阶段 1 S1（03 P200 / P201）：iOS 壳的声音。不编译 Xcode 工程，只对 WebViewController.swift 做静态核对；Swift 能否编译由 `xcodebuild build` 另行验证。
//   · 播放的是包里的 CAF（assets/sound/*.caf），文件名与页面 sound.js 的 SOUND_FILES 一一对应，启动时预载；
//   · AVAudioSession 是 .ambient + .mixWithOthers（遵守静音键、不打断不压低后台音乐，不用 duckOthers / playback / soloAmbient）；
//   · 旧的程序化 stamp / paper 合成（82Hz 盖章声、高频纸声）已删除；未知 kind 忽略；增益来自页面消息并夹在 0…1。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_FILES } from '../src/platform/sound.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');
const scheme = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/LocalWebSchemeHandler.swift'), 'utf8');

test('原生声音文件名与页面一致，且包里（assets/sound）有对应 CAF', () => {
  const m = swift.match(/private static let soundNames = \[([^\]]+)\]/);
  assert.ok(m, 'soundNames list');
  const names = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(names, Object.values(SOUND_FILES).flat());
  for (const n of names) assert.ok(existsSync(join(ROOT, 'assets/sound', `${n}.caf`)), `${n}.caf`);
  assert.match(swift, /appendingPathComponent\("assets\/sound"/);
  assert.match(swift, /AVAudioPlayer\(contentsOf: url\)/);
  assert.match(swift, /player\.prepareToPlay\(\)/);
});

test('AVAudioSession：ambient + mixWithOthers（静音键生效、后台音乐不被打断 / 压低）', () => {
  const sec = swift.slice(swift.indexOf('// MARK: - 声音'), swift.indexOf('// MARK: - 触觉反馈'));
  assert.match(sec, /setCategory\(\.ambient, mode: \.default, options: \[\.mixWithOthers\]\)/);
  const code = swift.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /duckOthers|\.soloAmbient|setCategory\(\.playback/);
});

test('旧的程序化合成已删除；未知 kind 忽略；增益夹在 0…1；预载在 viewDidLoad', () => {
  assert.doesNotMatch(swift, /paperSoundData|makePaperSoundPlayer|playPaperSound|stampSoundPlayer|paperSoundPlayer|appendLittleEndian/);
  assert.match(swift, /guard let player = soundPlayers\[kind\] else \{ return \}/);
  assert.match(swift, /Float\(min\(max\(gain, 0\), 1\)\)/);
  assert.match(swift, /case "sound":\s*playSound\(kind: body\["kind"\] as\? String \?\? "", gain: body\["gain"\] as\? Double \?\? 1\)/);
  const vdl = swift.slice(swift.indexOf('override func viewDidLoad()'), swift.indexOf('override var preferredStatusBarStyle'));
  assert.match(vdl, /preloadSounds\(\)/);
});

test('自定义 scheme 的 MIME 表认得 wav / caf', () => {
  assert.match(scheme, /case "wav":\s*return "audio\/wav"/);
  assert.match(scheme, /case "caf":\s*return "audio\/x-caf"/);
});
