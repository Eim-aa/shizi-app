// WebKit AX 版式探针（R3-K1，ADA A3-01 / A3-02 / A3-03）：由 scripts/verify-webkit-ax.mjs 放进模拟器 App 数据容器的
// Documents/shizi-smoke-probe.js，DEBUG 壳以 `-shizi-smoke -shizi-smoke-stage probe -shizi-probe-arg <状态>` 启动后在 WKWebView 里执行
// （ios/ShiziApp/ShiziApp/NativeSmoke.swift runSmokeProbe）。只用公开测试钩子 window.__shiziTest、data-testid 与 router 的 nav。
//
// 整个文件是一个函数表达式（壳把它包进括号、以状态名调用），不是模块；不进 App 包、不进壳清单。
// 状态：write（回忆，上一字的结果行「修改」在格下说明位）| trace（看答案后直接进入的描一遍，格下是后果说明，主按钮「凭记忆写」，D64 ②）| retrace（凭记忆写，格下是 R-W07.selfNote、两枚文字按钮 + 下一个）
//       | self（看过答案后恢复到的回忆阶段，格下同样是 R-W07.selfNote，求助行是提示 / 看答案）| judge（判断页两格）| detail（没写过的字的详情页空态）。
// 每个状态量三件事并回传：
//   1. 书写格（及判断页两格、看答案格、纸面格）宽高相等（±1）；写字状态再画一笔「屏幕上 dx = dy」的斜线，存进数据的笔画 dy / dx 也必须是 1（±2%）；
//   2. 没有文字横向溢出：文字节点的行框都在视口内、在所在按钮内；含文字的元素 scrollWidth ≤ clientWidth；文字之间不互相叠压；
//   3. 写字类页面：正文不滚动，正文区里的每一行字（格下说明位）都在底栏上沿之上；
//   4. 整页不平移（R6-J1，交互与动效规范 N7）：根文档一屏（scrollWidth ≤ 视口宽、scrollHeight ≤ 视口高）、scrollTo(40, 40) 后仍在 (0, 0)、页头不动，内容滚动容器横向不可滚。
(async function probe(STATE) {
  if (window.__shiziProbeRunning) return;
  window.__shiziProbeRunning = true;
  const native = window.webkit.messageHandlers.shiziNative;
  const result = { state: STATE, checks: [], metrics: {} };
  const post = () => native.postMessage({ type: 'nativeSmokeResult', payload: JSON.stringify(result) });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(fn, label, ms = 15000) {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) {
        last = e;
      }
      await sleep(50);
    }
    throw new Error('timeout: ' + label + (last ? ' (' + (last.message || last) + ')' : ''));
  }
  const check = (name, ok, detail) => result.checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  const T = () => window.__shiziTest;
  const app = () => document.querySelector('.sz-app');
  const topLayer = () => document.querySelector('.sz-layer[data-top="true"]');
  const q = id => (topLayer() ? topLayer().querySelector('[data-testid="' + id + '"]') : null);
  const r1 = v => Math.round(v * 10) / 10;
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r1(r.left), top: r1(r.top), right: r1(r.right), bottom: r1(r.bottom), width: r1(r.width), height: r1(r.height) };
  };
  async function idle(settle = 700) {
    await waitFor(() => app() && app().dataset.navAnim === 'idle', 'nav idle');
    await sleep(settle);
  }
  const pad = n => (n < 10 ? '0' + n : String(n));
  const localDay = ms => {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const CHARS = ['根', '据', '永', '和', '春'];
  function session(cursor, current) {
    const at = T().now();
    return {
      id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' },
      queue: CHARS.map(c => 'base:' + c), cursor, items: [],
      current: Object.assign({ phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, current || {}),
      lastLine: null, startedAt: at, startedDay: localDay(at), updatedAt: at,
    };
  }
  async function seed(sessionA) {
    T().reset();
    const res = T().seed({ sessions: { A: sessionA, B: null, lastEnded: {} } });
    if (!res || !res.ok) throw new Error('seed failed: ' + JSON.stringify(res));
  }
  async function toHome() {
    const { nav } = await import('/src/ui/router.js');
    for (let i = 0; i < 6 && !(app() && app().dataset.topScreen === 'home'); i += 1) {
      nav.switchTab('home');
      await idle(300);
      if (app().dataset.topScreen !== 'home') nav.back();
      await idle(300);
    }
    return nav;
  }
  /** 合成一笔（PointerEvent，与原生冒烟同法）：pts 是相对书写格左上角的 CSS px。 */
  async function stroke(pts) {
    const canvas = await waitFor(() => q('write-grid-live'), 'write grid');
    const r = canvas.getBoundingClientRect();
    const base = { pointerId: 51, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, button: 0 };
    const at = (x, y) => ({ clientX: r.left + x, clientY: r.top + y });
    const fire = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, Object.assign({}, base, p, { buttons })));
    fire('pointerdown', at(pts[0][0], pts[0][1]), 1);
    for (let i = 1; i < pts.length; i += 1) {
      for (let s = 1; s <= 10; s += 1) {
        const f = s / 10;
        fire('pointermove', at(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f), 1);
        await sleep(16);
      }
    }
    const last = pts[pts.length - 1];
    fire('pointerup', at(last[0], last[1]), 0);
  }

  /** 视觉上看不见（读屏专用的 1px 裁切、visibility:hidden、display:none、透明）。 */
  function hidden(el, stop) {
    for (let a = el; a && a !== stop && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
      const r = a.getBoundingClientRect();
      if (cs.overflow !== 'visible' && (r.width <= 2 || r.height <= 2)) return true;
      if (r.width <= 2 && r.height <= 2) return true; // 读屏专用的 1px 盒（clip-path / clip 裁切）
      if (cs.position === 'absolute' && cs.clip && cs.clip !== 'auto') return true;
    }
    return false;
  }

  function measure({ writePage }) {
    const layer = topLayer();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const page = layer.querySelector('.sz-page');
    const body = layer.querySelector('.sz-page__body');
    const foot = layer.querySelector('.sz-page__foot');
    const footBox = foot && foot.getBoundingClientRect().height > 0 ? box(foot) : null;
    const m = { vw, vh, docScrollW: document.documentElement.scrollWidth, page: box(page), body: box(body), foot: footBox };
    m.bodyScroll = body ? [body.scrollHeight, body.clientHeight] : null;

    // 1. 正方形
    const squares = [...layer.querySelectorAll('.sz-inkgrid, .sz-compare__card, .sz-compare__empty')]
      .filter(el => !hidden(el, layer))
      .map(el => ({ testid: el.dataset.testid || el.className, ...box(el) }));
    m.squares = squares;
    for (const s of squares) check('square ' + s.testid, Math.abs(s.width - s.height) <= 1, s.width + '×' + s.height);

    // 2. 横向溢出与叠压
    const lines = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || hidden(el, layer)) continue;
      if (el.closest('svg, canvas')) continue;
      range.selectNodeContents(node);
      const btn = el.closest('button, .sz-btn');
      const btnBox = btn ? btn.getBoundingClientRect() : null;
      // 滚动容器（页面正文）里滚到可视区外的行不算：它们被正文区裁掉，不会和底栏叠在一起。
      let clip = null;
      for (let a = el.parentElement; a && a !== layer; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowY;
        if (ov === 'auto' || ov === 'scroll') {
          clip = a.getBoundingClientRect();
          break;
        }
      }
      for (const r of range.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const top = clip ? Math.max(r.top, clip.top) : r.top;
        const bottom = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
        if (bottom - top < 0.5) continue;
        lines.push({ el, text: node.nodeValue.trim().slice(0, 24), left: r.left, right: r.right, top, bottom, rawBottom: r.bottom, h: r.height, btn: btnBox, inFoot: !!(foot && foot.contains(el)) });
      }
    }
    const outside = lines.filter(l => l.left < -1 || l.right > vw + 1);
    check('text inside viewport', outside.length === 0, outside.map(l => l.text + ' [' + r1(l.left) + ',' + r1(l.right) + ']'));
    const outBtn = lines.filter(l => l.btn && (l.left < l.btn.left - 1 || l.right > l.btn.right + 1 || l.top < l.btn.top - 1 || l.bottom > l.btn.bottom + 1));
    check('button text inside its button', outBtn.length === 0, outBtn.map(l => l.text + ' [' + r1(l.left) + '–' + r1(l.right) + ' in ' + r1(l.btn.left) + '–' + r1(l.btn.right) + ']'));
    const textEls = [...new Set(lines.map(l => l.el))];
    const scrollers = [];
    for (const el of textEls) {
      for (let a = el; a && a !== layer; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'inline' || cs.display === 'contents') continue;
        if (a.scrollWidth > a.clientWidth + 1 && a.clientWidth > 0) scrollers.push((a.dataset.testid || a.className || a.tagName) + ' ' + a.scrollWidth + '>' + a.clientWidth);
        break;
      }
    }
    check('no text element with scrollWidth > clientWidth', scrollers.length === 0, [...new Set(scrollers)]);
    const overlaps = [];
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const a = lines[i];
        const b = lines[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // 行框是字体的内容区，紧行高时上下相邻两行的行框本来就会重一点；重叠超过较矮一行的 40% 才算字压字。
        if (w > 2 && h > 0.4 * Math.min(a.h, b.h)) overlaps.push(a.text + ' × ' + b.text);
      }
    }
    check('no overlapping text', overlaps.length === 0, overlaps.slice(0, 10));

    // 3. 写字类页面：不滚动、正文区的字都在底栏之上
    if (writePage) {
      check('body does not scroll', m.bodyScroll && m.bodyScroll[0] <= m.bodyScroll[1] + 1, m.bodyScroll);
      const below = footBox ? lines.filter(l => !l.inFoot && l.rawBottom > footBox.top + 0.5) : [];
      check('body text above the foot', below.length === 0, below.map(l => l.text + ' bottom ' + r1(l.rawBottom) + ' > foot ' + footBox.top));
      const note = q('write-note');
      if (note) {
        m.note = box(note);
        m.noteScroll = [note.scrollHeight, note.clientHeight];
        const grid = q('write-grid') || q('write-paper-grid');
        m.grid = box(grid);
        check('note slot under the grid and above the foot', (!grid || m.note.top >= m.grid.bottom - 0.5) && (!footBox || m.note.bottom <= footBox.top + 0.5),
          { note: m.note, grid: m.grid, footTop: footBox && footBox.top });
        // 说明位里「看得见的内容」（文字行 + 图标）不被裁，且 scrollHeight 不超过 clientHeight（K2：结果行「修改 ›」的 44 热区比 40 高的说明位多出的 4 全部伸向上方，不计入可滚动区）。
        const nb = note.getBoundingClientRect();
        const ink = [...lines.filter(l => note.contains(l.el)).map(l => ({ text: l.text, top: l.top, bottom: l.rawBottom })),
          ...[...note.querySelectorAll('svg')].filter(v => !hidden(v, layer)).map(v => ({ text: 'svg', top: v.getBoundingClientRect().top, bottom: v.getBoundingClientRect().bottom }))];
        const clipped = ink.filter(i => i.top < nb.top - 1 || i.bottom > nb.bottom + 1);
        m.noteInk = ink.map(i => i.text + ' ' + r1(i.top) + '–' + r1(i.bottom));
        check('note slot content not clipped', clipped.length === 0 && note.scrollHeight <= note.clientHeight + 1, { scroll: m.noteScroll, note: m.note, clipped: clipped.map(i => i.text), ink: m.noteInk });
      }
      // R4-F1（D55）：写字页没有「⋯」菜单；W2（A7）起底栏是求助行 + 「写好了」，求助行的按钮都在底栏之内、在视口内（上面的溢出 / 叠压检查已覆盖字）。
      const links = layer.querySelector('[data-testid="write-links"]');
      if (links && foot) {
        const lb = box(links);
        check('help row inside the foot and on screen', lb.top >= footBox.top - 0.5 && lb.bottom <= vh + 0.5 && lb.left >= -0.5 && lb.right <= vw + 0.5, { links: lb, footTop: footBox.top });
        check('no 「⋯」 menu on the write page', !q('write-more') && !document.querySelector('[data-testid="write-ax-menu"]'));
        // R4-P1（D56）：「在纸上写」移到设置，写字页的文字行 / 格下都不再有它；提示 / 看答案 / 跳过任何字号都不收起（回忆阶段）。
        check('no 在纸上写 entry on the write page', !q('write-to-paper'));
        if (q('write-done')) {
          check('提示 / 看答案 are in the help row, 跳过 in the page head (A7)', !!(q('write-hint') && q('write-show-answer') && q('write-skip')));
          // W2（D57，A7）：求助行在「写好了」正上方（间距 20；AX 档收紧时 8）、等宽一行；撤销 / 清空在书写格正下方一行；跳过在页头右上、进度在页头中间。
          const done = box(q('write-done'));
          const hint = box(q('write-hint'));
          const ans = box(q('write-show-answer'));
          const gap = done.top - hint.bottom;
          check('A7: help row directly above 「写好了」 (gap 6–20) and on one row', gap >= 5.5 && gap <= 20.5 && Math.abs(hint.top - ans.top) <= 1 && hint.bottom <= done.top, { gap: r1(gap), hint, ans, done });
          check('A7: help buttons ≥ 44 high and inside the viewport', hint.height >= 44 && ans.height >= 44 && hint.left >= -0.5 && ans.right <= vw + 0.5, { hint: hint.height, ans: ans.height });
          const undo = q('write-undo');
          const clr = q('write-clear');
          const grid2 = q('write-grid');
          if (undo && clr && grid2) {
            const ub = box(undo);
            const cb = box(clr);
            const gb = box(grid2);
            check('A7: 撤销 / 清空 in the row right under the grid, above the help row', ub.top >= gb.bottom - 0.5 && ub.top - gb.bottom <= 8 && ub.height >= 44 && cb.height >= 44 && ub.bottom <= hint.top + 0.5 && ub.right < cb.left, { grid: gb, undo: ub, clear: cb });
          }
          const sk = box(q('write-skip'));
          const head = layer.querySelector('.sz-page__head');
          check('A7: 跳过 in the page head, right end', !!head && sk.bottom <= head.getBoundingClientRect().bottom + 0.5 && sk.right >= vw - 28 && sk.height >= 44, { skip: sk });
        }
      }
    }
    return m;
  }

  /** 4. 整页不平移（N7）：每个状态量完版式后再推一下根文档与内容滚动容器。 */
  async function panCheck() {
    const layer = topLayer();
    const de = document.documentElement;
    const head = layer.querySelector('.sz-page__head');
    const body = layer.querySelector('.sz-page__body');
    const h0 = box(head);
    const doc = { w: de.scrollWidth, h: de.scrollHeight, vw: de.clientWidth, vh: window.innerHeight };
    window.scrollTo(40, 40);
    de.scrollLeft = 40;
    if (body) body.scrollLeft = 40;
    await sleep(120);
    const h1 = box(head);
    const at = { x: window.scrollX, y: window.scrollY, bodyLeft: body ? body.scrollLeft : 0 };
    result.metrics.pan = { doc, at, head: h1 };
    check('page does not pan', doc.w <= doc.vw + 0.5 && doc.h <= doc.vh + 0.5 && at.x === 0 && at.y === 0 && at.bodyLeft === 0
      && JSON.stringify(h0) === JSON.stringify(h1), { doc, at, head0: h0, head1: h1 });
  }

  try {
    await waitFor(() => app() && T() && window.__shiziBridge && window.__shiziBridge.isReady(), 'app boot');
    await idle(400);
    try {
      await document.fonts.ready;
    } catch (e) {
      // 没有字体接口
    }
    result.metrics.textSize = document.documentElement.getAttribute('data-text-size');
    result.metrics.ax = document.documentElement.getAttribute('data-ax');
    let nav = null;
    const openWrite = async () => {
      nav.push('write', { slot: 'A' });
      await waitFor(() => q('write-screen') && topLayer().querySelector('.sz-write'), 'write screen');
      await idle(900);
    };

    if (STATE === 'write') {
      await seed(session(0));
      nav = await toHome();
      await openWrite();
      // 存进数据的笔画不因格子变形而失真：屏幕上 dx = dy 的一笔，存下来 dy / dx = 1。
      const grid = q('write-grid');
      const g = grid.getBoundingClientRect();
      const s = Math.min(g.width, g.height);
      const cx = g.width / 2;
      const cy = g.height / 2;
      const d = s * 0.3;
      await stroke([[cx - d, cy - d], [cx, cy], [cx + d, cy + d]]);
      await waitFor(() => Number(q('write-grid').dataset.strokeCount) === 1, 'stroke counted');
      await sleep(400);
      const { decodeRawStrokes } = await import('/src/core/ink-math.js');
      const st = T().getState();
      const raw = decodeRawStrokes(st.sessions.A.current.strokes)[0] || [];
      const p0 = raw[0];
      const p1 = raw[raw.length - 1];
      const ratio = p0 && p1 ? (p1.y - p0.y) / (p1.x - p0.x) : null;
      result.metrics.strokeRatio = ratio === null ? null : Math.round(ratio * 1000) / 1000;
      check('stored stroke keeps its aspect (dy/dx = 1 ± 2%)', ratio !== null && Math.abs(ratio - 1) <= 0.02, result.metrics.strokeRatio);
      // 判断「写错了」→ 第二个字：格下说明位是上一字的结果行（「修改」入口）
      q('write-done').click();
      await waitFor(() => q('write-compare-ref') && q('write-compare-ref').dataset.state === 'ready', 'compare ready');
      await idle(900);
      await waitFor(() => q('write-judge-wrong') && !q('write-judge-wrong').disabled, 'judge button');
      q('write-judge-wrong').click();
      await waitFor(() => topLayer().querySelector('.sz-write[data-cursor="1"][data-phase="recall"]'), 'next card');
      await idle(900);
      result.metrics.layout = measure({ writePage: true });
      await panCheck();
      const line = q('write-line-slot');
      check('result row (修改) visible in the note slot', !!line && line.textContent.trim().length > 0 && !hidden(line, topLayer()), line ? line.textContent.trim() : null);
    } else if (STATE === 'retrace' || STATE === 'trace' || STATE === 'self') {
      await seed(session(1, { phase: STATE === 'self' ? 'recall' : STATE, answerSeen: true }));
      nav = await toHome();
      await openWrite();
      await sleep(STATE === 'trace' ? 3500 : 1500);
      result.metrics.layout = measure({ writePage: true });
      await panCheck();
    } else if (STATE === 'judge') {
      const { encodeRawStrokes } = await import('/src/core/ink-math.js');
      const line = (x0, y0, x1, y1) => Array.from({ length: 9 }, (_, i) => ({ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, t: i * 16 }));
      const strokes = encodeRawStrokes([line(80, 120, 260, 120), line(170, 60, 170, 290)]);
      await seed(session(1, { phase: 'compare', strokes }));
      nav = await toHome();
      await openWrite();
      await waitFor(() => q('write-compare-ref') && q('write-compare-ref').dataset.state === 'ready', 'compare ready');
      await idle(900);
      result.metrics.layout = measure({ writePage: true });
      await panCheck();
    } else if (STATE === 'detail') {
      T().reset();
      nav = await toHome();
      nav.push('detail', { char: '完' });
      await waitFor(() => app().dataset.topScreen === 'detail', 'detail screen');
      await idle(1200);
      result.metrics.layout = measure({ writePage: false });
      await panCheck();
    } else {
      throw new Error('unknown probe state ' + STATE);
    }
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
  }
  post();
})
