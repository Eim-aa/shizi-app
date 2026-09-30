// 按键音（04 R-S01「按键音」；03 P24 触发点「判断落定与描红落笔两处（沿旧）」= policy.keySoundEvents；02 M5-5）。
//
// 事件 → 旧版声音种类（639f592 index.html L1333–L1341；WebViewController paperSoundData）：
//   judge         判断落定（写对了 / 写错了，含修改判断）→ 'stamp'：0.22s 低频正弦 + 滤波噪声，指数衰减
//   trace-stroke  「描一遍」每次落笔                       → 'paper'：0.11s 高通噪声（纸声），100ms 内只响一次（沿旧）
// 开关：settings.sound（缺省开，与设置页 DEFAULT_SOUND 同口径）。关着时什么都不发。
// 原生壳内：postNative('sound', {kind})，原生播放同一算法合成的 WAV；浏览器 / PWA：Web Audio 就地合成同一段波形播放
// （不另放音频文件：旧版网页端与原生端都是程序合成，算法逐行移植，离线可用、不占 SW 缓存；已在 M5-5 报告说明）。
// 页面声音只在用户操作里触发（点按判断、落笔），满足浏览器自动播放限制；AudioContext 挂起时先 resume。

import { bridge } from './bridge.js';
import * as defaultPolicy from '../config/policy.js';

/** 事件名（policy.keySoundEvents）→ 声音种类（原生 `sound` 消息的 kind）。 */
export const SOUND_OF_EVENT = Object.freeze({ judge: 'stamp', 'trace-stroke': 'paper' });
export const SOUND_KINDS = Object.freeze(['stamp', 'paper']);
/** 纸声最短间隔（ms，沿旧版 soundFeedback）。 */
export const PAPER_MIN_GAP_MS = 100;
/** 按键音缺省开（原型 SD.sound=true；设置页 settings.js DEFAULT_SOUND 同值）。 */
export const DEFAULT_SOUND = true;

const DURATION = Object.freeze({ stamp: 0.22, paper: 0.11 });

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** settings → 按键音开没开。 */
export function soundEnabled(settings) {
  return settings && typeof settings.sound === 'boolean' ? settings.sound : DEFAULT_SOUND;
}

/**
 * 合成一段按键音的采样（-1..1）。与旧版 playWebPaperSound / 原生 paperSoundData 同一算法（LCG 噪声种子 194 / 73）。
 * @param {'stamp'|'paper'} kind
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function synthesize(kind, sampleRate) {
  if (SOUND_KINDS.indexOf(kind) < 0) throw new RangeError(`unknown sound kind: ${kind}`);
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
  const length = Math.max(1, Math.round(rate * DURATION[kind]));
  const data = new Float32Array(length);
  let seed = kind === 'stamp' ? 194 : 73;
  let filtered = 0;
  for (let i = 0; i < length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967295) * 2 - 1;
    const t = i / rate;
    const envelope = Math.pow(1 - i / length, kind === 'stamp' ? 2.8 : 1.4);
    if (kind === 'stamp') {
      filtered = filtered * 0.82 + noise * 0.18;
      data[i] = (Math.sin(2 * Math.PI * (82 + 22 * t) * t) * 0.58 + filtered * 0.34) * envelope * 0.42;
    } else {
      data[i] = (noise - filtered) * envelope * 0.075;
      filtered = noise;
    }
  }
  return data;
}

let audioContext = null;

function contextOf(win) {
  if (audioContext) return audioContext;
  const Ctor = win && (win.AudioContext || win.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch (error) {
    audioContext = null;
  }
  return audioContext;
}

/** 浏览器里用 Web Audio 播放一段按键音。返回是否已开始播放。 */
export function playWeb(kind, win = globalWin()) {
  const ctx = contextOf(win);
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    const samples = synthesize(kind, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return true;
  } catch (error) {
    return false;
  }
}

const log = [];
let lastPaperAt = -Infinity;

/** 最近发出的按键音种类（旧版 soundDebug.events 的等价物；测试与诊断用）。 */
export function soundLog() {
  return log.slice();
}

/**
 * 按键音。event 是 policy.keySoundEvents 里的事件名（'judge' | 'trace-stroke'）。
 * 返回 'native' | 'web' | false（关着 / 不在触发点 / 节流 / 放不出来）。
 * @param {string} event
 * @param {{state?:object, settings?:object, policy?:object, bridge?:object, win?:object, now?:number}} [o]
 *   state / settings：调用方手上的状态（commit 通知带来的新状态 / 写字页订阅的状态）；都不给时按缺省（开）。
 */
export function keySound(event, o = {}) {
  const policy = o.policy || defaultPolicy;
  const events = Array.isArray(policy.keySoundEvents) ? policy.keySoundEvents : [];
  const kind = SOUND_OF_EVENT[event];
  if (!kind || events.indexOf(event) < 0) return false;
  const settings = o.settings !== undefined ? o.settings : o.state ? o.state.settings : null;
  if (!soundEnabled(settings)) return false;
  if (kind === 'paper') {
    const at = typeof o.now === 'number' ? o.now : Date.now();
    if (at - lastPaperAt < PAPER_MIN_GAP_MS) return false;
    lastPaperAt = at;
  }
  log.push(kind);
  if (log.length > 30) log.splice(0, log.length - 30);
  const b = o.bridge || bridge;
  if (b && b.postNative('sound', { kind })) return 'native';
  return playWeb(kind, o.win === undefined ? globalWin() : o.win) ? 'web' : false;
}

/** 测试：清节流与日志。 */
export function resetSound() {
  lastPaperAt = -Infinity;
  log.length = 0;
}
