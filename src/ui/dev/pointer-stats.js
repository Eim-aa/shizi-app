// ?dev=1 面板里的「指针与手势 spike」块（M0-7）。由 palette.js 挂载。
// 内容：
//   1. 运行环境自检：type=module 已执行、localStorage 可写、deck 全局（SEED/GROUPS/CONTEXT_OVERRIDES）可读、
//      原生壳下 fonts/ShiziSerifSC-Regular.woff2 与 .js/.css 的 Content-Type（验证 LocalWebSchemeHandler MIME 表）。
//   2. 345pt 书写格（与原型 393 宽机型上的格一致：左缘 x=24pt），统计 2 秒 pointermove 频率、
//      getCoalescedEvents 是否可用/是否真的合并、pressure 非零比例，以及 pointercancel / lostpointercapture。
//   3. 原生手势观测：shizi-native-back-progress 各阶段计数、shizi-native-back 计数；
//      书写格有活动指针时经 bridge 发 backGestureEnabled(false)，抬笔/中断后发 true（01 §7），可关掉门控做对照。
// 仅开发工具（P30：仅 ?dev=1），标签给开发者看，不走 src/config/copy/。

import { bridge } from '../../platform/bridge.js';
import { isNativeShell } from '../../platform/env.js';

const GRID = 345;
const WINDOW_MS = 2000;
const FONT_PROBE = 'fonts/ShiziSerifSC-Regular.woff2'; // M5 删除了 spike 字体，改探正式字体

const LABELS = {
  title: 'M0-7 指针与手势 spike',
  env: '运行环境',
  gateOn: '门控 backGestureEnabled：开',
  gateOff: '门控 backGestureEnabled：关（对照）',
  reset: '清零',
  probe: '测 MIME',
  gridAt24: '格左缘 24',
  gridAt0: '格贴左缘 0',
  pdOn: 'touch preventDefault 开',
  pdOff: 'touch preventDefault 关',
};

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (text != null) node.textContent = text;
  return node;
}

function line(key) {
  const node = el('div', { fontSize: 'var(--fs11)', lineHeight: '1.4', color: 'var(--ink2)', wordBreak: 'break-all', fontFamily: 'ui-monospace, Menlo, monospace' });
  node.setAttribute('data-spike', key);
  return node;
}

function envChecks() {
  const out = {};
  out.module = 'ok（本文件以 type=module 执行）';
  try {
    const k = '__shizi_spike_m07';
    const v = String(Date.now());
    window.localStorage.setItem(k, v);
    const back = window.localStorage.getItem(k);
    window.localStorage.removeItem(k);
    out.localStorage = back === v ? 'ok（写入/读回/删除）' : `读回不一致：${back}`;
  } catch (error) {
    out.localStorage = `失败：${error && error.name ? error.name : error}`;
  }
  // deck-data.js / context-overrides.js 以经典脚本声明的全局词法名，不是 window 属性（M0-1 交接）。
  let deck = '';
  try { deck += `SEED=${typeof SEED !== 'undefined' ? SEED.length : '无'} `; } catch (error) { deck += 'SEED=异常 '; }
  try { deck += `GROUPS=${typeof GROUPS !== 'undefined' ? Object.keys(GROUPS).length : '无'} `; } catch (error) { deck += 'GROUPS=异常 '; }
  try { deck += `CONTEXT_OVERRIDES=${typeof CONTEXT_OVERRIDES !== 'undefined' ? Object.keys(CONTEXT_OVERRIDES).length : '无'} `; } catch (error) { deck += 'CONTEXT_OVERRIDES=异常 '; }
  deck += `FSRS=${typeof globalThis.FSRS} HanziWriter=${typeof globalThis.HanziWriter}`;
  out.deck = deck;
  out.shell = `nativeShell=${isNativeShell()} href=${location.href} dpr=${window.devicePixelRatio} vw=${window.innerWidth}×${window.innerHeight}`;
  out.pointer = `PointerEvent=${typeof window.PointerEvent} getCoalescedEvents=${!!(window.PointerEvent && typeof window.PointerEvent.prototype.getCoalescedEvents === 'function')} maxTouchPoints=${navigator.maxTouchPoints}`;
  return out;
}

async function probeOne(path) {
  try {
    const res = await fetch(new URL(path, document.baseURI), { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    return { path, ok: res.ok, status: res.status, type: res.headers.get('content-type') || '', bytes: buf.byteLength, buf };
  } catch (error) {
    return { path, ok: false, status: 0, type: '', bytes: 0, error: error && error.message ? error.message : String(error) };
  }
}

async function probeMime() {
  const results = [];
  for (const p of [FONT_PROBE, 'src/app.js', 'src/config/tokens.css']) results.push(await probeOne(p));
  const font = results[0];
  let fontFace = '未试';
  if (font.ok && typeof FontFace === 'function') {
    try {
      const face = new FontFace('ShiziSpikeSerif', font.buf);
      await face.load();
      document.fonts.add(face);
      fontFace = 'FontFace 解码 ok';
    } catch (error) {
      fontFace = `FontFace 失败：${error && error.message ? error.message : error}`;
    }
  }
  return { results, fontFace };
}

export function mountPointerStats(page) {
  const host = page || document.body;
  const block = el('section', { margin: '0 0 16px', padding: '0 0 12px', borderBottom: '1px solid var(--line)' });
  block.setAttribute('data-dev-pointer-stats', '');
  block.appendChild(el('h2', { fontFamily: 'var(--song)', fontWeight: '500', fontSize: 'var(--fs17)', margin: '0 0 4px' }, LABELS.title));

  // 详细环境行放在书写格下方（393×852 首屏只放统计与书写格），格上方只放一行摘要。
  const env = envChecks();
  const summaryLine = line('summary');
  block.appendChild(summaryLine);
  const envBox = el('div', { marginTop: '6px' });
  for (const key of ['module', 'localStorage', 'deck', 'shell', 'pointer']) {
    const node = line(`env-${key}`);
    node.textContent = `${key}: ${env[key]}`;
    envBox.appendChild(node);
  }
  const mimeLine = line('mime');
  mimeLine.textContent = 'mime: （原生壳内自动测；浏览器点「测 MIME」）';
  envBox.appendChild(mimeLine);
  const fontSample = el('div', { fontFamily: 'ShiziSpikeSerif, var(--song)', fontSize: 'var(--fs15)', color: 'var(--ink1)', margin: '2px 0' }, '拾字 · 提笔忘字（ShiziSpikeSerif 样张）');
  envBox.appendChild(fontSample);
  let mimeSummary = '未测';
  function renderSummary() {
    const deckOk = typeof SEED !== 'undefined' && SEED.length > 0;
    summaryLine.textContent = `摘要: module=ok localStorage=${env.localStorage.startsWith('ok') ? 'ok' : '失败'} deck=${deckOk ? 'ok' : '无'} native=${isNativeShell()} woff2=${mimeSummary}`;
  }
  renderSummary();

  // 工具条
  const bar = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px 8px', margin: '6px 0' });
  const mkBtn = (label, action, onClick) => {
    const b = el('button', { padding: '0 12px', borderRadius: '12px', background: 'var(--sheet)', color: 'var(--ink1)', boxShadow: 'inset 0 0 0 .5px var(--line)', fontSize: 'var(--fs13)' }, label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  let gate = true;
  const gateBtn = mkBtn(LABELS.gateOn, 'spike-gate-toggle', () => {
    gate = !gate;
    gateBtn.textContent = gate ? LABELS.gateOn : LABELS.gateOff;
    if (!gate) bridge.setBackGestureEnabled(true);
    render();
  });
  mkBtn(LABELS.reset, 'spike-reset', () => { resetStats(); clearCanvas(); render(); });
  mkBtn(LABELS.probe, 'spike-probe', () => { runProbe(); });
  // 压力用例：把格挪到屏幕最左缘（x=0），让起笔点落进边缘识别区，检验门控是否真的拦住识别器。
  let gridLeft = 24;
  const gridBtn = mkBtn(LABELS.gridAt24, 'spike-grid-edge', () => {
    gridLeft = gridLeft === 24 ? 0 : 24;
    gridBtn.textContent = gridLeft === 24 ? LABELS.gridAt24 : LABELS.gridAt0;
    bleed.style.paddingLeft = `${gridLeft}px`;
    render();
  });
  // 对照用：关掉 touchstart/touchmove/pointerdown 的 preventDefault，看 WebKit 是否因此放行原生边缘识别器。
  let preventTouch = true;
  const pdBtn = mkBtn(LABELS.pdOn, 'spike-prevent-toggle', () => {
    preventTouch = !preventTouch;
    pdBtn.textContent = preventTouch ? LABELS.pdOn : LABELS.pdOff;
    render();
  });
  block.appendChild(bar);

  const statsLine = line('stats');
  const lastLine = line('last');
  const eventsLine = line('events');
  const nativeLine = line('native');
  const gateLine = line('gate');
  for (const n of [statsLine, lastLine, eventsLine, nativeLine, gateLine]) block.appendChild(n);

  // 书写格：外层撑满视口宽度抵消色板页左右内边距，格左缘固定在 x=24pt
  // （= 原型 393 宽机型上 345 格居中的位置；在 402 宽的 iPhone 17 Pro 上也按 24pt 测，比居中的 28.5pt 更靠边、更严格）。
  const bleed = el('div', {
    width: '100vw',
    marginLeft: 'calc(-16px - var(--safe-left, 0px))',
    display: 'flex', justifyContent: 'flex-start', padding: '6px 0 6px 24px', boxSizing: 'border-box',
  });
  const box = el('div', {
    position: 'relative', width: `${GRID}px`, height: `${GRID}px`, flex: '0 0 auto',
    background: 'var(--sheet)', boxShadow: 'inset 0 0 0 1px var(--ink4)', borderRadius: 'var(--r-work)',
    touchAction: 'none', overscrollBehavior: 'none',
  });
  box.setAttribute('data-spike-grid', '');
  const canvas = el('canvas', { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' });
  box.appendChild(canvas);
  bleed.appendChild(box);
  block.appendChild(bleed);
  const rectLine = line('rect');
  block.appendChild(rectLine);
  block.appendChild(envBox);

  host.insertBefore(block, host.firstChild);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(GRID * dpr);
  canvas.height = Math.round(GRID * dpr);
  const ctx = canvas.getContext('2d');
  function clearCanvas() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, GRID, GRID);
    ctx.strokeStyle = 'rgba(160,140,120,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GRID / 2, 0); ctx.lineTo(GRID / 2, GRID);
    ctx.moveTo(0, GRID / 2); ctx.lineTo(GRID, GRID / 2);
    ctx.stroke();
  }
  clearCanvas();

  // ---- 统计
  let stats;
  let last;
  const native = { back: 0, began: 0, changed: 0, ended: 0, cancelled: 0, lastDetail: '' };
  const counts = { pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0, lostpointercapture: 0 };
  function resetStats() {
    stats = { start: 0, moves: 0, samples: 0, coalescedMulti: 0, pressureNonZero: 0, pressureValues: new Set(), downMs: 0, types: new Set(), done: false };
    last = null;
    for (const k of Object.keys(counts)) counts[k] = 0;
    native.back = native.began = native.changed = native.ended = native.cancelled = 0;
    native.lastDetail = '';
  }
  resetStats();

  let active = null; // {id, t0, lastT, prev:{x,y}, moves, samples, minX, maxX, firstX, firstClientX, cancelled}
  let segStart = 0;

  function localPoint(e) {
    const r = box.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inWindow(t) {
    if (!stats.start) return false;
    return t - stats.start <= WINDOW_MS;
  }

  function onDown(e) {
    counts.pointerdown += 1;
    if (active) return; // 只跟一根主指针
    if (preventTouch) e.preventDefault();
    if (gate) bridge.setBackGestureEnabled(false);
    try { box.setPointerCapture(e.pointerId); } catch (error) { /* 忽略 */ }
    const p = localPoint(e);
    if (!stats.start) stats.start = e.timeStamp;
    segStart = e.timeStamp;
    stats.types.add(e.pointerType);
    active = { id: e.pointerId, t0: e.timeStamp, moves: 0, samples: 0, prev: p, minX: p.x, maxX: p.x, firstX: p.x, firstClientX: e.clientX, cancelled: false, end: '' };
    ctx.fillStyle = 'rgba(180,60,40,.9)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    render();
  }

  function onMove(e) {
    if (!active || e.pointerId !== active.id) return;
    counts.pointermove += 1;
    if (preventTouch) e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = list && list.length ? list : [e];
    active.moves += 1;
    active.samples += samples.length;
    if (inWindow(e.timeStamp)) {
      stats.moves += 1;
      stats.samples += samples.length;
      if (samples.length > 1) stats.coalescedMulti += 1;
      if (e.pressure > 0) stats.pressureNonZero += 1;
      if (stats.pressureValues.size < 8) stats.pressureValues.add(Number(e.pressure).toFixed(3));
    }
    ctx.strokeStyle = 'rgba(40,32,28,.9)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(active.prev.x, active.prev.y);
    for (const s of samples) {
      const p = localPoint(s);
      ctx.lineTo(p.x, p.y);
      active.prev = p;
      active.minX = Math.min(active.minX, p.x);
      active.maxX = Math.max(active.maxX, p.x);
    }
    ctx.stroke();
    if (counts.pointermove % 4 === 0) render();
  }

  function finish(e, kind) {
    if (!active || e.pointerId !== active.id) return;
    const end = Math.min(e.timeStamp, stats.start + WINDOW_MS);
    if (end > segStart) stats.downMs += end - segStart;
    if (stats.start && e.timeStamp - stats.start > WINDOW_MS) stats.done = true;
    active.cancelled = kind !== 'pointerup';
    active.end = kind;
    active.duration = e.timeStamp - active.t0;
    last = active;
    active = null;
    if (gate) bridge.setBackGestureEnabled(true);
    render();
  }

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', e => { counts.pointerup += 1; finish(e, 'pointerup'); });
  box.addEventListener('pointercancel', e => { counts.pointercancel += 1; finish(e, 'pointercancel'); });
  // 抬笔后浏览器会隐式释放捕获并补发 lostpointercapture，只统计书写中途（尚未 up/cancel）丢失捕获的异常情况。
  box.addEventListener('lostpointercapture', e => { if (active && e.pointerId === active.id) { counts.lostpointercapture += 1; finish(e, 'lostpointercapture'); } });
  // 与 iOS Safari 旧实现一致：阻止触摸默认行为，避免页面滚动吞掉笔画。
  for (const type of ['touchstart', 'touchmove']) box.addEventListener(type, e => { if (preventTouch) e.preventDefault(); }, { passive: false });

  window.addEventListener('shizi-native-back', e => {
    native.back += 1;
    native.lastDetail = JSON.stringify((e && e.detail) || null);
    render();
  });
  window.addEventListener('shizi-native-back-progress', e => {
    const d = (e && e.detail) || {};
    if (d.phase && Object.prototype.hasOwnProperty.call(native, d.phase)) native[d.phase] += 1;
    native.lastDetail = JSON.stringify(d);
    if (d.phase !== 'changed') render();
  });

  function render() {
    const hz = stats.downMs > 0 ? (stats.moves / (stats.downMs / 1000)).toFixed(1) : '—';
    const shz = stats.downMs > 0 ? (stats.samples / (stats.downMs / 1000)).toFixed(1) : '—';
    const ratio = stats.moves ? ((stats.pressureNonZero / stats.moves) * 100).toFixed(0) + '%' : '—';
    statsLine.textContent = `2s窗口${stats.done ? '(完)' : ''}: move=${stats.moves} 按下时长=${Math.round(stats.downMs)}ms move频率=${hz}Hz 采样(含coalesced)=${stats.samples} ${shz}Hz coalesced>1的move=${stats.coalescedMulti} pressure非零=${ratio} pressure值=[${[...stats.pressureValues].join(',')}] type=[${[...stats.types].join(',')}]`;
    lastLine.textContent = last
      ? `上一笔: 结束=${last.end} 完整=${!last.cancelled} 起笔格内x=${last.firstX.toFixed(1)} 起笔clientX=${last.firstClientX.toFixed(1)} 跨度x=${last.minX.toFixed(1)}→${last.maxX.toFixed(1)} move=${last.moves} 采样=${last.samples} 时长=${Math.round(last.duration)}ms`
      : '上一笔: —';
    eventsLine.textContent = `事件计数: down=${counts.pointerdown} move=${counts.pointermove} up=${counts.pointerup} cancel=${counts.pointercancel} lostcapture=${counts.lostpointercapture}`;
    nativeLine.textContent = `原生: back=${native.back} progress began=${native.began} changed=${native.changed} ended=${native.ended} cancelled=${native.cancelled} last=${native.lastDetail}`;
    gateLine.textContent = `门控=${gate ? '开' : '关'} preventDefault=${preventTouch ? '开' : '关'} 格左缘=${gridLeft} 书写中=${!!active} 已发送backGestureEnabled=${bridge.lastBackGestureSent()}`;
    const r = box.getBoundingClientRect();
    rectLine.textContent = `书写格 rect: x=${r.left.toFixed(1)} y=${r.top.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)}（屏幕坐标 = CSS px；scrollY=${Math.round(window.scrollY)}）`;
  }
  window.addEventListener('scroll', () => render(), { passive: true });
  window.addEventListener('resize', () => render());

  async function runProbe() {
    mimeLine.textContent = 'mime: 测试中…';
    const { results, fontFace } = await probeMime();
    mimeSummary = `${results[0].status} ${results[0].type || '(无)'}${fontFace.startsWith('FontFace 解码 ok') ? ' 解码ok' : ''}`;
    renderSummary();
    mimeLine.textContent = 'mime: ' + results.map(r => `${r.path} → ${r.status} ${r.type || '(无)'} ${r.bytes}B${r.error ? ' ' + r.error : ''}`).join(' | ') + ` | ${fontFace}`;
  }

  render();
  if (isNativeShell()) runProbe();
  return block;
}
