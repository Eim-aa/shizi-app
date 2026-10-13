// 阶段 1 S1（03 P200 / P201；D50 ⑦ / D46 ⑮ / D30）：声音只有两种——判断「收进」的纸页落定 j1（三个变体轮换）、落款盖章 s1；
// 书写与描红不出声。静音键由系统管（原生 ambient / 网页 audioSession ambient）；D63 起没有声音开关。素材由 scripts/sound/gen.mjs 程序合成（可复跑、逐字节一致）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../../src/platform/bridge.js';
import * as policy from '../../src/config/policy.js';
import { swLists } from '../../scripts/build_shell_manifest.mjs';
import * as sound from '../../src/platform/sound.js';
import { applyFeedback, COMMIT_FEEDBACK } from '../../src/platform/haptics.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JUDGE = ['j1_page_settle', 'j1_page_settle_b', 'j1_page_settle_c'];
const SEAL = 's1_wood_muted';

function nativeBridge() {
  const sent = [];
  const win = { webkit: { messageHandlers: { shiziNative: { postMessage: msg => sent.push(msg) } } } };
  return { b: createBridge(win), sent };
}

test('policy.keySoundEvents = 判断 + 落款；书写 / 描红点位已移除', () => {
  assert.deepEqual([...policy.keySoundEvents], ['judge', 'seal']);
  assert.ok(!policy.keySoundEvents.includes('trace-stroke'));
  assert.deepEqual({ ...policy.soundGainDb }, { judge: 0, seal: 0 });
});

test('事件 → 声音文件：判断 3 个变体、落款 1 个；旧 stamp / paper 合成不再存在', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(sound.SOUND_FILES)), { judge: JUDGE, seal: [SEAL] });
  assert.equal(sound.synthesize, undefined, '不再有程序化合成（旧 82Hz 盖章声 / 高频纸声）');
  assert.equal(sound.PAPER_MIN_GAP_MS, undefined);
});

test('判断声三个变体轮换（j1、_b、_c、j1…）；原生消息带文件名与增益', () => {
  sound.resetSound();
  const { b, sent } = nativeBridge();
  const got = [];
  for (let i = 0; i < 7; i += 1) got.push(sound.keySound('judge', { bridge: b, settings: null }));
  assert.deepEqual(got, Array(7).fill('native'));
  assert.deepEqual(sent.map(m => m.kind), [...JUDGE, ...JUDGE, JUDGE[0]]);
  assert.ok(sent.every(m => m.type === 'sound' && m.gain === 1));
  assert.deepEqual(sound.soundLog(), sent.map(m => m.kind));
});

test('落款：s1；同一个 key（同一组结果页）只响一次', () => {
  sound.resetSound();
  const { b, sent } = nativeBridge();
  assert.equal(sound.keySound('seal', { bridge: b, key: 'A:s1' }), 'native');
  assert.equal(sound.keySound('seal', { bridge: b, key: 'A:s1' }), false, '同一组再次渲染不再响');
  assert.equal(sound.keySound('seal', { bridge: b, key: 'A:s2' }), 'native', '另一组再响');
  assert.deepEqual(sent.map(m => m.kind), [SEAL, SEAL]);
});

test('书写与描红不出声：trace-stroke / 未知事件什么都不发', () => {
  sound.resetSound();
  const { b, sent } = nativeBridge();
  for (const ev of ['trace-stroke', 'stroke', 'tap', 'write', '']) assert.equal(sound.keySound(ev, { bridge: b }), false, ev);
  assert.deepEqual(sent, []);
  assert.deepEqual(sound.soundLog(), []);
  // 即便有人把它加回 policy，也没有对应文件，仍不出声
  assert.equal(sound.keySound('trace-stroke', { bridge: b, policy: { keySoundEvents: ['trace-stroke'] } }), false);
});

test('D63 没有声音开关：旧数据里的 settings.sound=false 不再让声音消失；policy.keySoundEvents 不含该事件时无声', () => {
  sound.resetSound();
  const { b, sent } = nativeBridge();
  assert.equal(sound.keySound('judge', { bridge: b, settings: { sound: false } }), 'native');
  assert.equal(sound.keySound('seal', { bridge: b, settings: { sound: false }, key: 'k' }), 'native');
  assert.deepEqual(sent.map(m => m.kind), [JUDGE[0], SEAL]);
  assert.equal(sound.soundEnabled, undefined, '没有 soundEnabled 开关函数了');
  assert.equal(sound.keySound('judge', { bridge: b, policy: { keySoundEvents: ['seal'] } }), false);
});

test('commit 反馈：判断类 commit 发判断声 + judge 触觉（soft 0.7，D58 ③）；落款不是 commit（结果页作品出现时发）', () => {
  for (const label of ['write:judge', 'write:correct', 'result:correct']) assert.equal(COMMIT_FEEDBACK[label].sound, 'judge', label);
  assert.ok(!Object.values(COMMIT_FEEDBACK).some(fb => fb.sound && fb.sound !== 'judge'));
  const calls = [];
  applyFeedback({ type: 'commit', label: 'write:judge' }, {}, {
    haptic: k => calls.push(['h', k]) && 'native', keySound: e => calls.push(['s', e]) && 'native',
  });
  assert.deepEqual(calls, [['h', 'judge'], ['s', 'judge']], '判断：触觉与声音各发一次');
});

test('响度关系：判断声比落款低约 6–8dB（差已在文件里；播放增益 0dB，不在播放端放大）', () => {
  // LUFS-M（BS.1770 K 计权、400ms）与「外放估」（300Hz 高通后）由 gen.mjs 在合成时实测，写进 --candidates 的 meta.json
  const dir = mkdtempSync(join(tmpdir(), 'shizi-snd-meta-'));
  let items;
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/sound/gen.mjs'), '--out', join(dir, 'out'), '--candidates', dir], { stdio: 'pipe' });
    items = Object.fromEntries(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).items.map(m => [m.id, m]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const judge = items.j1_page_settle;
  const seal = items.s1_wood_muted;
  const sealDb = sound.soundGainDb('seal');
  const judgeDb = sound.soundGainDb('judge');
  const headphones = seal.lufsM + sealDb - (judge.lufsM + judgeDb);
  const speaker = seal.spkLufs + sealDb - (judge.spkLufs + judgeDb);
  assert.ok(headphones >= 7 && headphones <= 8.5, `headphones: seal − judge = ${headphones.toFixed(2)}dB LUFS-M`);
  assert.ok(speaker >= 5.5 && speaker <= 7, `speaker (est.): seal − judge = ${speaker.toFixed(2)}dB`);
  // 三个变体 + 盖章的采样峰值（含 ±0.7dB 增益变化）仍守住限幅
  const peakDb = name => {
    const pcm = readWav(join(ROOT, 'assets/sound', `${name}.wav`)).pcm;
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    return 20 * Math.log10(peak / 32768);
  };
  for (const n of JUDGE) assert.ok(peakDb(n) <= -10, `${n} peak ≤ −10dBFS`);
  assert.ok(peakDb(SEAL) <= -2.9 && peakDb(SEAL) > -3.5, 'seal peak ≈ −3dBFS (limiter)');
  assert.equal(sealDb, 0);
  assert.equal(judgeDb, 0);
  assert.equal(sound.soundGain('judge'), 1);
  assert.equal(sound.soundGain('seal', { soundGainDb: { seal: -6 } }).toFixed(3), '0.501');
});

function readWav(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WAVE');
  assert.equal(b.readUInt16LE(20), 1, 'PCM');
  assert.equal(b.readUInt16LE(22), 1, 'mono');
  assert.equal(b.readUInt32LE(24), 44100);
  assert.equal(b.readUInt16LE(34), 16);
  assert.equal(b.toString('latin1', 36, 40), 'data');
  const n = b.readUInt32LE(40);
  assert.equal(b.length, 44 + n);
  return { pcm: b.subarray(44), n };
}

test('素材：每个声音有 WAV（网页）与 CAF（iOS 包，LEI16 无编码补零），两者采样逐字节一致；起音从第 0 个采样起', () => {
  for (const name of [...JUDGE, SEAL]) {
    const wav = readWav(join(ROOT, 'assets/sound', `${name}.wav`));
    const caf = readFileSync(join(ROOT, 'assets/sound', `${name}.caf`));
    assert.equal(caf.toString('latin1', 0, 4), 'caff');
    assert.equal(caf.toString('latin1', 8, 12), 'desc');
    assert.equal(caf.readDoubleBE(20), 44100);
    assert.equal(caf.toString('latin1', 28, 32), 'lpcm');
    assert.equal(caf.readUInt32BE(32), 2, 'little-endian integer PCM');
    assert.equal(caf.readUInt32BE(48), 16);
    assert.equal(caf.toString('latin1', 52, 56), 'data');
    assert.equal(Number(caf.readBigInt64BE(56)), 4 + wav.n);
    assert.ok(wav.pcm.equals(caf.subarray(68)), `${name}: caf samples = wav samples`);
    assert.ok(wav.n / 2 / 44100 <= 0.32 + 1e-9, `${name}: duration ≤ 320ms`);
    assert.equal(wav.pcm.readInt16LE(wav.n - 2), 0, `${name}: last sample 0 (no click)`);
  }
  assert.equal(sound.soundUrl(JUDGE[1]).endsWith('assets/sound/j1_page_settle_b.wav'), true);
});

test('素材只有入选的 4 个（8 个文件）+ README；没有未选候选、没有 m4a', () => {
  const files = readdirSync(join(ROOT, 'assets/sound')).sort();
  const expect = [...JUDGE, SEAL].flatMap(n => [`${n}.caf`, `${n}.wav`]).concat('README.md').sort();
  assert.deepEqual(files, expect);
});

test('scripts/sound/gen.mjs 可复跑：重新生成的 WAV / CAF 与入库文件逐字节相同；程序合成、无采样无下载', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shizi-snd-'));
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/sound/gen.mjs'), '--out', dir], { stdio: 'pipe' });
    const regenerated = readdirSync(dir).sort();
    assert.deepEqual(regenerated, readdirSync(join(ROOT, 'assets/sound')).filter(f => !f.endsWith('.md')).sort());
    for (const f of regenerated) {
      assert.ok(readFileSync(join(dir, f)).equals(readFileSync(join(ROOT, 'assets/sound', f))), `${f} reproducible`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const gen = readFileSync(join(ROOT, 'scripts/sound/gen.mjs'), 'utf8');
  assert.match(gen, /没有采样/);
  assert.doesNotMatch(gen, /https?:\/\/|fetch\(|require\(|child_process/, '不联网、不调外部程序');
  assert.match(readFileSync(join(ROOT, 'assets/sound/README.md'), 'utf8'), /无需署名/);
});

test('壳清单与 SW 预缓存：WAV 进壳清单与 SW 尽力批次；CAF 进壳清单（iOS rsync）但不进 SW', () => {
  const lines = readFileSync(join(ROOT, 'scripts/shell-manifest.txt'), 'utf8').split('\n').filter(Boolean);
  for (const n of [...JUDGE, SEAL]) {
    assert.ok(lines.includes(`assets/sound/${n}.wav`), `${n}.wav in shell manifest`);
    assert.ok(lines.includes(`assets/sound/${n}.caf`), `${n}.caf in shell manifest`);
  }
  const { bestEffort, shell } = swLists(lines, () => 'x');
  for (const n of [...JUDGE, SEAL]) {
    assert.ok(bestEffort.includes(`assets/sound/${n}.wav`), `${n}.wav precached`);
    assert.ok(![...bestEffort, ...shell].some(p => p.endsWith('.caf')), 'caf not precached');
  }
});

// ---------------------------------------------------------------- 网页路径（Web Audio，预解码）

function fakeAudioWindow({ audioSession = true } = {}) {
  const log = { fetched: [], started: [], gains: [], resumed: 0 };
  class Ctx {
    constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.destination = { dest: true }; log.ctx = this; }
    resume() { log.resumed += 1; return Promise.resolve(); }
    decodeAudioData(ab) { return Promise.resolve({ decoded: ab.byteLength }); }
    createGain() { const g = { gain: { value: 1 }, connect: n => { g.to = n; } }; log.gains.push(g); return g; }
    createBufferSource() { const s = { connect: n => { s.to = n; }, start: () => log.started.push(s) }; return s; }
  }
  const win = {
    AudioContext: Ctx,
    fetch: url => { log.fetched.push(String(url)); return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
  };
  if (audioSession) win.navigator = { audioSession: { type: 'auto' } };
  return { win, log };
}

test('网页：warm 只取判断三个变体；播放走 GainNode，audioSession 设为 ambient（遵守静音键）', async () => {
  sound.resetSound();
  const { win, log } = fakeAudioWindow();
  const web = createBridge({});
  assert.equal(sound.keySound('judge', { bridge: web, win, settings: null }), false, '还没预载好：不拖延、不出声');
  sound.resetSound();
  await sound.warmSounds({ win, settings: null, bridge: web, events: ['judge'] });
  assert.deepEqual(log.fetched.map(u => u.split('/').pop()), JUDGE.map(n => `${n}.wav`));
  assert.equal(win.navigator.audioSession.type, 'ambient', 'Safari：遵守静音键、与音乐混音');
  assert.equal(sound.keySound('judge', { bridge: web, win, settings: null }), 'web');
  assert.equal(log.started.length, 1);
  assert.equal(log.gains.at(-1).gain.value, 1);
  assert.equal(log.started[0].to, log.gains.at(-1), 'source → gain');
  assert.equal(log.gains.at(-1).to, log.ctx.destination, 'gain → destination');
  assert.deepEqual(sound.soundLog(), [JUDGE[0]]);
});

test('网页：原生壳内不预载（原生自己预载 CAF）；原生消息通道可用时不走 Web Audio', async () => {
  sound.resetSound();
  const { b } = nativeBridge();
  const { win, log } = fakeAudioWindow();
  await sound.warmSounds({ win, settings: null, bridge: b });
  assert.deepEqual(log.fetched, []);
  assert.equal(sound.keySound('judge', { bridge: b, win }), 'native');
  assert.equal(log.started.length, 0);
});
