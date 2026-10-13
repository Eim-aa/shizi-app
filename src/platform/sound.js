// 声音（03 P24 / P200 / P201；D50 ⑦ / D46 ⑮ / D30；决定见 assets/sound/README.md）。D63：不再有开关，按这里的缺省行为播放；静音键与系统音量照旧管着它。
//
// 只有两种声音（程序合成的素材，scripts/sound/gen.mjs 可复跑）：
//   judge  判断「收进」（写对了 / 写错了 / 修改判断，每字一次，两种判断同一声，无奖惩感）→ j1「纸页落定」，三个变体按顺序轮换
//   seal   落款盖章（结果页作品首次呈现落款时，每组一次）                               → s1「木印·闷实」
// 书写与描红不出声（policy.keySoundEvents 里没有 trace-stroke；旧的 82Hz 盖章声与高频纸声已删除）。
// 没有开关（D63 删掉了设置里的「声音」；旧数据里的 settings.sound 读到也不再生效）。静音键：原生走 AVAudioSession.ambient，网页走 audioSession 'ambient'，都遵守。
//
// 播放：
//   原生壳内：postNative('sound', {kind: 文件名, gain})，原生播放包里的 CAF（预载的 AVAudioPlayer，AVAudioSession 为 ambient +
//     mixWithOthers：遵守静音键、不打断不压低后台音乐）。
//   浏览器 / PWA：Web Audio 播放预解码好的 WAV（assets/sound/，进 SW 预缓存，离线可用）；支持 navigator.audioSession 的 Safari 上设为
//     'ambient'（同样遵守静音键、与音乐混音）。素材要先预载（warmSounds，写字页 / 结果页挂载时调用）；没载好就这一声不出，不拖延。
//   页面声音只在用户操作里触发（点按判断）或页面刚呈现时（落款）；AudioContext 挂起时先 resume。
// 响度：判断声比落款声低约 8dB（耳机）/ 6dB（外放）——这个差已经在素材里（LUFS-M −31 对 −23，采样峰值 −10.6…−12.2 对 −3.0 dBFS），
// 播放增益 policy.soundGainDb 两项都取 0dB（P201）：在播放端放大会削波，只留作真机调整的唯一入口。

import { bridge } from './bridge.js';
import * as defaultPolicy from '../config/policy.js';

/** 事件名（policy.keySoundEvents）→ 声音文件（assets/sound/<名>.wav|.caf）。判断有三个轮换变体，落款一个。 */
export const SOUND_FILES = Object.freeze({
  judge: Object.freeze(['j1_page_settle', 'j1_page_settle_b', 'j1_page_settle_c']),
  seal: Object.freeze(['s1_wood_muted']),
});
const SOUND_DIR = '../../assets/sound/';

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 某事件的播放增益（dB → 线性）。policy.soundGainDb 缺项按 0dB。 */
export function soundGainDb(event, policy = defaultPolicy) {
  const table = policy && policy.soundGainDb;
  const db = table && Number.isFinite(table[event]) ? table[event] : 0;
  return db;
}

export function soundGain(event, policy = defaultPolicy) {
  return Math.pow(10, soundGainDb(event, policy) / 20);
}

/** 网页素材地址（相对本模块，WKWebView 的自定义 scheme 与 http 都能解析）。 */
export function soundUrl(name) {
  return new URL(`${SOUND_DIR}${name}.wav`, import.meta.url).href;
}

function enabledEvents(policy) {
  return Array.isArray(policy.keySoundEvents) ? policy.keySoundEvents.filter(e => Object.prototype.hasOwnProperty.call(SOUND_FILES, e)) : [];
}

// ---------------------------------------------------------------- Web Audio

const contexts = new WeakMap(); // win → AudioContext（win 不是对象时不缓存）
let fallbackContext = null;
const buffers = new Map(); // 文件名 → AudioBuffer
const loading = new Map(); // 文件名 → Promise

function contextOf(win) {
  const cached = win && typeof win === 'object' ? contexts.get(win) : fallbackContext;
  if (cached) return cached;
  const Ctor = win && (win.AudioContext || win.webkitAudioContext);
  if (!Ctor) return null;
  let ctx = null;
  try {
    ctx = new Ctor();
    // 遵守静音键、与其他音频混音（Safari 16.4+；不支持就保持现状）
    const session = win.navigator && win.navigator.audioSession;
    if (session) session.type = 'ambient';
  } catch (error) {
    if (!ctx) return null;
  }
  if (win && typeof win === 'object') contexts.set(win, ctx);
  else fallbackContext = ctx;
  return ctx;
}

function loadOne(name, win) {
  if (buffers.has(name)) return Promise.resolve(true);
  if (loading.has(name)) return loading.get(name);
  const ctx = contextOf(win);
  const doFetch = win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
  if (!ctx || !doFetch) return Promise.resolve(false);
  const p = Promise.resolve()
    .then(() => doFetch(soundUrl(name)))
    .then(res => (res && res.ok ? res.arrayBuffer() : Promise.reject(new Error('sound fetch failed'))))
    .then(data => ctx.decodeAudioData(data))
    .then(buffer => {
      buffers.set(name, buffer);
      return true;
    })
    .catch(() => false)
    .then(ok => {
      loading.delete(name);
      return ok;
    });
  loading.set(name, p);
  return p;
}

/**
 * 预载并解码网页要用的素材（原生壳内不需要：原生自己预载 CAF）。
 * 缺省预载 policy.keySoundEvents 里的全部事件（判断三个变体 + 落款），可用 events 缩小。返回 Promise<boolean>（是否全部就绪）。
 * @param {{policy?:object, bridge?:object, win?:object, events?:string[]}} [o]
 */
export function warmSounds(o = {}) {
  const policy = o.policy || defaultPolicy;
  const win = o.win === undefined ? globalWin() : o.win;
  const b = o.bridge || bridge;
  if (b && typeof b.isNative === 'function' && b.isNative()) return Promise.resolve(false);
  const wanted = enabledEvents(policy).filter(e => !o.events || o.events.indexOf(e) >= 0);
  const names = wanted.flatMap(e => SOUND_FILES[e]);
  if (!names.length) return Promise.resolve(false);
  return Promise.all(names.map(n => loadOne(n, win))).then(all => all.every(Boolean));
}

/** 浏览器里用 Web Audio 播放一个已预解码的素材。返回是否已开始播放（没预载好 = false，不等）。 */
export function playWeb(name, gain = 1, win = globalWin()) {
  const buffer = buffers.get(name);
  const ctx = buffer ? contextOf(win) : null;
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const node = ctx.createGain();
    node.gain.value = gain;
    source.connect(node);
    node.connect(ctx.destination);
    source.start();
    return true;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------- 事件入口

const log = [];
const sealed = new Set();
let judgeCount = 0;

/** 最近发出的声音文件名（旧版 soundDebug.events 的等价物；测试与诊断用）。 */
export function soundLog() {
  return log.slice();
}

/**
 * 声音。event 是 policy.keySoundEvents 里的事件名（'judge' | 'seal'）；书写 / 描红没有声音。
 * 返回 'native' | 'web' | false（不在触发点 / 同一 key 已响过 / 放不出来）。
 * @param {string} event
 * @param {{policy?:object, bridge?:object, win?:object, key?:string}} [o]
 *   key：同一个 key 只响一次（落款：一组结果页一次，页面重绘 / 回到本页不再响）。
 */
export function keySound(event, o = {}) {
  const policy = o.policy || defaultPolicy;
  const files = Object.prototype.hasOwnProperty.call(SOUND_FILES, event) ? SOUND_FILES[event] : null;
  if (!files || enabledEvents(policy).indexOf(event) < 0) return false;
  const id = o.key !== undefined ? `${event}:${o.key}` : null;
  if (id && sealed.has(id)) return false;
  // 判断：三个变体顺序轮换（连续多字不像同一段录音在机关枪）；落款只有一个
  const name = files[event === 'judge' ? judgeCount % files.length : 0];
  const gain = soundGain(event, policy);
  const b = o.bridge || bridge;
  let how = false;
  if (b && b.postNative('sound', { kind: name, gain })) how = 'native';
  else if (playWeb(name, gain, o.win === undefined ? globalWin() : o.win)) how = 'web';
  if (!how) return false; // 没放出来（素材还没预载好 / 没有 Web Audio）：不推进轮换、不占 key，下次再来
  if (event === 'judge') judgeCount += 1;
  if (id) sealed.add(id);
  log.push(name);
  if (log.length > 30) log.splice(0, log.length - 30);
  return how;
}

/** 测试：清日志、轮换计数、落款去重与预载缓存。 */
export function resetSound() {
  log.length = 0;
  sealed.clear();
  judgeCount = 0;
  buffers.clear();
  loading.clear();
  fallbackContext = null;
}
