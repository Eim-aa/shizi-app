// 原生桥骨架（01-架构设计 §8.1；M0-7 spike 建骨架，M5-5 扩展）。
//
// iOS→JS：模块顶层同步把下列全局函数定义到 window，store 就绪前到达的调用进队列，
// markReady(store) 之后按到达顺序回放给 registerNativeHandler 注册的实现；
// 提醒深链只保留最后一个 cardKey。
//   全局名与 WebViewController.swift 现状一致：shiziOpenReminderTarget、markBackupExported、
//   shiziCardSaved、shiziReminderStatus（Swift 已在调用）；shiziBackupPicked、shiziBackupRejected
//   按 01 §8.1 预先定义（Swift 侧导入桥在 M5-3 改为调用它们）。旧 shiziOCRResult 不定义（P07 移除 OCR）。
//   事件 shizi-native-back / shizi-native-back-progress 由 Swift 直接 dispatch 到 window，这里不经手。
//
// JS→iOS：postNative(type, payload) → window.webkit.messageHandlers.shiziNative.postMessage({type, ...payload})；
//   不在原生壳内时静默返回 false。setBackGestureEnabled(bool) 只在值变化时发送。
//
// M5-5 扩展：
//   - 各全局的实现由所属模块注册（registerNativeHandler），本文件只做分发与排队：
//       shiziOpenReminderTarget(cardKey)、shiziReminderStatus({permission}) → platform/reminder.js（startReminder 注册）；
//       markBackupExported()、shiziBackupPicked(text)、shiziBackupRejected({reason}) → ui/screens/mine/backup.js（M4-4）；
//       shiziCardSaved({success}) → ui/components/image-preview.js（M4-5）；
//       shiziShareFailed({kind, reason}) → ui/components/share-failed.js（P96 过渡，M6-6：原生分享面板 / 外链打不开时页面轻提示；
//         kind = backup | card | link，reason 只作诊断；用户取消不回调）。
//   - markReady(store) 幂等：第一次把桥置为就绪并按到达顺序回放积压调用；再次调用只更新 store 并回放仍积压的调用
//     （app.js 启动序列与 M5-3 的 pageReady 接线都可能调用，谁先谁后都行）。
//   - 全局函数返回 true = 页面已接收（交付或入队）；Swift 的深链只在 evaluate 返回 true 后清 key（M5-3）。

export const NATIVE_GLOBALS = Object.freeze([
  'shiziOpenReminderTarget',
  'shiziBackupPicked',
  'shiziBackupRejected',
  'markBackupExported',
  'shiziCardSaved',
  'shiziReminderStatus',
  'shiziShareFailed',
]);

// 同名全局在队列里只保留最后一次调用（01 §8.1：提醒深链只保留最后一个 cardKey）。
const LAST_ONLY = new Set(['shiziOpenReminderTarget']);

function nativeChannel(win) {
  try {
    const handlers = win && win.webkit && win.webkit.messageHandlers;
    return handlers && handlers.shiziNative && typeof handlers.shiziNative.postMessage === 'function'
      ? handlers.shiziNative
      : null;
  } catch (error) {
    return null;
  }
}

/**
 * 在 win 上装一套桥（测试可传假 window）。返回桥对象；同一 win 重复调用返回同一个。
 */
export function createBridge(win) {
  if (win && win.__shiziBridge) return win.__shiziBridge;

  const handlers = Object.create(null);
  let queue = [];
  let ready = false;
  let store = null;
  let lastBackGesture = null;

  function deliver(name, args) {
    const fn = handlers[name];
    if (typeof fn !== 'function') return false;
    try {
      fn(...args);
    } catch (error) {
      if (typeof console !== 'undefined') console.error(`[shizi] bridge ${name} failed:`, error);
    }
    return true;
  }

  function enqueue(name, args) {
    if (LAST_ONLY.has(name)) queue = queue.filter(item => item.name !== name);
    queue.push({ name, args });
  }

  function receive(name, args) {
    if (ready && deliver(name, args)) return true;
    // store 未就绪，或就绪了但该名尚无实现（M5 之前）：先存着，注册实现时再回放。
    enqueue(name, args);
    return true;
  }

  const bridge = {
    /** M5 各模块注册 iOS→JS 的实现：fn(...args)。注册时若已就绪会回放该名的积压调用。 */
    registerNativeHandler(name, fn) {
      if (NATIVE_GLOBALS.indexOf(name) < 0) throw new Error(`unknown native global: ${name}`);
      handlers[name] = fn;
      if (ready) flush(name);
    },
    /**
     * store 建好、UI 挂好之后调用；回放积压调用。幂等：返回 true 表示这一次把桥从未就绪变为就绪；
     * 再次调用时 readyStore 给出才更新 store（undefined 保留原值），并回放仍积压的调用。
     */
    markReady(readyStore) {
      const first = !ready;
      if (readyStore !== undefined) store = readyStore;
      else if (first) store = null;
      ready = true;
      flush();
      return first;
    },
    /** 某个全局是否已有实现（测试 / 诊断用）。 */
    hasHandler(name) {
      return typeof handlers[name] === 'function';
    },
    /** 是否在原生壳内（shiziNative 消息通道存在）。 */
    isNative() {
      return !!nativeChannel(win);
    },
    isReady() {
      return ready;
    },
    getStore() {
      return store;
    },
    /** 调试/测试：当前积压的调用（副本）。 */
    pending() {
      return queue.map(item => ({ name: item.name, args: item.args.slice() }));
    },
    /** JS→iOS。不在原生壳内返回 false。 */
    postNative(type, payload) {
      const channel = nativeChannel(win);
      if (!channel) return false;
      try {
        channel.postMessage(Object.assign({}, payload || {}, { type }));
        return true;
      } catch (error) {
        return false;
      }
    },
    /** 最近一次成功发给原生的 backGestureEnabled 值（未发过为 null）。 */
    lastBackGestureSent() {
      return lastBackGesture;
    },
    /** 01 §7：告诉原生此刻能否开始左缘返回手势；值不变不重复发送。 */
    setBackGestureEnabled(value) {
      const next = value !== false;
      if (next === lastBackGesture) return false;
      const sent = bridge.postNative('backGestureEnabled', { value: next });
      if (sent) lastBackGesture = next;
      return sent;
    },
  };

  function flush(onlyName) {
    const rest = [];
    for (const item of queue) {
      if (onlyName && item.name !== onlyName) {
        rest.push(item);
        continue;
      }
      if (!deliver(item.name, item.args)) rest.push(item);
    }
    queue = rest;
  }

  if (win) {
    for (const name of NATIVE_GLOBALS) {
      // 顶层同步定义：Swift 用 `typeof f === 'function' && f(...)` 调用，返回 true 表示页面已接收（交付或入队）。
      win[name] = (...args) => receive(name, args);
    }
    try {
      Object.defineProperty(win, '__shiziBridge', { value: bridge, configurable: true });
    } catch (error) {
      win.__shiziBridge = bridge;
    }
  }
  return bridge;
}

const browserWin = typeof window !== 'undefined' ? window : null;

/** 页面内唯一的桥实例（node 下为不挂全局的空桥）。 */
export const bridge = createBridge(browserWin);
export const { registerNativeHandler, markReady, postNative, setBackGestureEnabled } = bridge;
/** 当前页面是否在原生壳内（bridge.isNative 的独立导出）。 */
export const isNative = () => bridge.isNative();
