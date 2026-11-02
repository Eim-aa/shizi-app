// 阶段 1 S1（03 P200 / P201）：iOS 的声音。不编译 Xcode 工程，只对 SoundPlayer.swift（B4.9 从 WebViewController 搬出）做静态核对；Swift 能否编译由 `xcodebuild build` 另行验证。
//   · 播放的是包里的 CAF（App 的原生资源 Sounds/*.caf，仓库 ios/ShiziApp/ShiziApp/Sounds/），文件名与 JS 参考 sound.js 的 SOUND_FILES 一一对应，首帧之后预载；
//   · AVAudioSession 是 .ambient + .mixWithOthers（遵守静音键、不打断不压低后台音乐，不用 duckOthers / playback / soloAmbient）；
//   · 旧的程序化 stamp / paper 合成（82Hz 盖章声、高频纸声）已删除；未知 kind 忽略；增益夹在 0…1；播哪个由引擎定（判断声轮换、落款声）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_FILES } from '../src/platform/sound.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/SoundPlayer.swift'), 'utf8');
const root = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/RootViewController.swift'), 'utf8');
const engine = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/SwiftEngine.swift'), 'utf8');
const pbx = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp.xcodeproj/project.pbxproj'), 'utf8');

test('原生声音文件名与 JS 参考一致，且 App 的原生资源 Sounds/ 里有对应 CAF（进包：Resources 阶段的 Sounds 文件夹）', () => {
  const m = swift.match(/static let soundNames = \[([^\]]+)\]/);
  assert.ok(m, 'soundNames list');
  const names = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(names, Object.values(SOUND_FILES).flat());
  for (const n of names) assert.ok(existsSync(join(ROOT, 'ios/ShiziApp/ShiziApp/Sounds', `${n}.caf`)), `${n}.caf`);
  assert.match(swift, /Bundle\.main\.url\(forResource: "Sounds", withExtension: nil\)/);
  assert.match(pbx, /Sounds in Resources/, 'the Sounds folder is a bundle resource');
  assert.match(swift, /AVAudioPlayer\(contentsOf: url\)/);
  assert.match(swift, /player\.prepareToPlay\(\)/);
});

test('AVAudioSession：ambient + mixWithOthers（静音键生效、后台音乐不被打断 / 压低）', () => {
  const sec = swift;
  assert.match(sec, /setCategory\(\.ambient, mode: \.default, options: \[\.mixWithOthers\]\)/);
  const code = swift.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /duckOthers|\.soloAmbient|setCategory\(\.playback/);
});

test('旧的程序化合成已删除；未知 kind 忽略；增益夹在 0…1；首帧之后预载；引擎的判断声 / 落款声走它', () => {
  assert.doesNotMatch(swift, /paperSoundData|makePaperSoundPlayer|playPaperSound|stampSoundPlayer|paperSoundPlayer|appendLittleEndian/);
  assert.match(swift, /guard let player = players\[kind\] else \{ return \}/);
  assert.match(swift, /Float\(min\(max\(gain, 0\), 1\)\)/);
  const vdl = root.slice(root.indexOf('override func viewDidLoad()'), root.indexOf('override var preferredStatusBarStyle'));
  assert.match(vdl, /stage\.afterBootFrame \{ SoundPlayer\.shared\.preload\(\) \}/);
  assert.match(engine, /core\.onSound = \{ name, gain in SoundPlayer\.shared\.play\(kind: name, gain: gain\) \}/);
});
