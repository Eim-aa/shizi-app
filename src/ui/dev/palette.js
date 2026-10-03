// ?dev=1 色板页（M0-3）：逐键列出 tokens.css / base.css 的令牌名、当前值、各主题取值与来源（原型文件 + 行号）。
// 来源直接解析 CSS 行尾注释（「用途 · 来源：…」），不另维护一份表，改令牌只改 CSS。
// 仅开发工具（03 待产品决定 P30：仅 ?dev=1），不进产品界面；下列标签是开发者看的，不走 src/config/copy/。
// 字号：D29 起没有 data-large，按钮轮换模拟原生系统字号（platform/text-size.js receiveContentSize，P130）。

import { receiveContentSize } from '../../platform/text-size.js';

const SIZE_CYCLE = ['L', 'XXXL', 'AX3', 'AX5'];

const SOURCES = [
  { file: 'tokens.css', url: new URL('../../config/tokens.css', import.meta.url) },
  { file: 'base.css', url: new URL('../../config/base.css', import.meta.url) },
];

const LABELS = {
  title: 'Design tokens · 设计令牌',
  intro: '逐键列出令牌名、当前计算值、各上下文取值与来源（原型文件 L 行号）。切换 data-theme / 系统字号后「当前值」随之刷新。',
  theme: '主题',
  themeSystem: '跟随系统',
  themeLight: '浅色',
  themeDark: '深色',
  size: '系统字号',
  sample: '字号 calc(15px*var(--k)) · 楷体 --kai：提笔忘字 · 宋体 --serif：拾字 · 黑体 --sans：今天写几个字',
  colName: '令牌',
  colNow: '当前值',
  colUse: '用途 · 来源',
  loadFailed: '读取令牌文件失败：',
};

// 上下文：由选择器栈归类。
const CONTEXTS = [
  { id: 'base', label: ':root', match: s => s.length === 1 && s[0] === ':root' },
  { id: 'light', label: '浅色', match: s => s.length === 1 && /data-theme="light"/.test(s[0]) },
  { id: 'dark', label: '深色', match: s => s.length === 1 && /data-theme="dark"/.test(s[0]) },
  { id: 'darkMedia', label: '深色（跟随系统）', match: s => s.length === 2 && /prefers-color-scheme:\s*dark/.test(s[0]) },
  { id: 'reduce', label: '减少动态效果', match: s => s.length === 2 && /prefers-reduced-motion/.test(s[0]) },
];

const DECL_RE = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*;\s*(?:\/\*\s*(.*?)\s*\*\/)?\s*$/;

/** 解析 CSS 文本里的自定义属性声明：[{name, value, note, selectors[]}]。只认一行一个声明的写法。 */
export function parseTokenDecls(cssText) {
  const out = [];
  const stack = [];
  let pending = '';
  let inComment = false;
  for (const raw of cssText.split('\n')) {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      inComment = false;
      line = line.slice(end + 2);
    }
    const decl = DECL_RE.exec(line);
    if (decl) {
      out.push({ name: decl[1], value: decl[2], note: decl[3] || '', selectors: stack.slice() });
      continue;
    }
    // 去掉整行/行内注释，再看是否开了多行注释
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) {
      inComment = true;
      line = line.slice(0, open);
    }
    const text = line.trim();
    if (!text) continue;
    if (text.endsWith('{')) {
      stack.push(normalizeSelector(pending + ' ' + text.slice(0, -1)));
      pending = '';
    } else if (text === '}') {
      stack.pop();
    } else if (text.endsWith(',')) {
      pending += ' ' + text;
    }
  }
  return out;
}

function normalizeSelector(sel) {
  return sel.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

function contextOf(selectors) {
  const hit = CONTEXTS.find(c => c.match(selectors));
  return hit ? hit.id : selectors.join(' › ');
}

function splitNote(note) {
  const i = note.indexOf('来源：');
  if (i < 0) return { use: note, source: '' };
  return { use: note.slice(0, i).replace(/[\s·]+$/, ''), source: note.slice(i + 3) };
}

function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (text != null) node.textContent = text;
  return node;
}

function currentValue(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isColor(value) {
  return !!value && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', value);
}

async function loadRows() {
  const rows = new Map();
  for (const src of SOURCES) {
    const res = await fetch(src.url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${src.file} HTTP ${res.status}`);
    for (const d of parseTokenDecls(await res.text())) {
      const ctx = contextOf(d.selectors);
      if (!rows.has(d.name)) rows.set(d.name, { name: d.name, file: src.file, byCtx: {} });
      rows.get(d.name).byCtx[ctx] = { value: d.value, ...splitNote(d.note) };
    }
  }
  return [...rows.values()];
}

function themeState() {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme') || 'system',
    size: root.getAttribute('data-text-size') || 'L',
  };
}

export function mountPalette(root) {
  const host = root || document.body;
  const page = el('main', {
    minHeight: '100vh',
    padding: 'calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(16px + var(--safe-left))',
    color: 'var(--i1)',
    fontFamily: 'var(--sans)',
    userSelect: 'text',
    webkitUserSelect: 'text',
  });
  page.className = 'paper';
  page.setAttribute('data-dev-palette', '');

  page.appendChild(el('h1', { fontFamily: 'var(--serif)', fontWeight: '500', fontSize: 'calc(26px * var(--k))', lineHeight: '1.3' }, LABELS.title));
  page.appendChild(el('p', { margin: '6px 0 14px', fontSize: 'calc(13px * var(--k))', color: 'var(--i3)' }, LABELS.intro));

  // 工具条
  const bar = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginBottom: '10px' });
  const status = el('code', { display: 'block', margin: '0 0 12px', fontSize: 'calc(13px * var(--k))', color: 'var(--i2)', wordBreak: 'break-all' });
  status.setAttribute('data-palette-status', '');
  const themeButtons = [];
  const mkBtn = (label, action, onClick) => {
    const b = el('button', {
      padding: '0 14px', borderRadius: '12px', background: 'var(--c)', color: 'var(--i1)',
      boxShadow: 'inset 0 0 0 .5px var(--i5)', fontSize: 'calc(15px * var(--k))',
    }, label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    b.addEventListener('click', onClick);
    return b;
  };
  bar.appendChild(el('span', { fontSize: 'calc(13px * var(--k))', color: 'var(--i3)' }, LABELS.theme));
  for (const [label, value] of [[LABELS.themeSystem, 'system'], [LABELS.themeLight, 'light'], [LABELS.themeDark, 'dark']]) {
    const b = mkBtn(label, `theme-${value}`, () => {
      if (value === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', value);
      refresh();
    });
    b.dataset.value = value;
    themeButtons.push(b);
    bar.appendChild(b);
  }
  const sizeBtn = mkBtn(LABELS.size, 'size-cycle', () => {
    const now = SIZE_CYCLE.indexOf(themeState().size);
    receiveContentSize({ category: SIZE_CYCLE[(now + 1) % SIZE_CYCLE.length] });
    refresh();
  });
  bar.appendChild(sizeBtn);
  page.appendChild(bar);
  page.appendChild(status);
  page.appendChild(el('p', { margin: '0 0 16px', fontSize: 'calc(15px * var(--k))', lineHeight: '1.6', color: 'var(--i2)' }, LABELS.sample));

  const list = el('div', { display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--i5)' });
  list.setAttribute('role', 'list');
  page.appendChild(list);
  host.appendChild(page);

  let rows = [];
  const cells = []; // {name, swatch, now}

  function renderRows() {
    list.textContent = '';
    cells.length = 0;
    for (const row of rows) {
      const item = el('div', {
        display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: '4px 12px',
        padding: '10px 0', borderBottom: '1px solid var(--i5)', alignItems: 'start',
      });
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-token', row.name);
      const swatch = el('span', {
        width: '36px', height: '36px', borderRadius: '8px', boxShadow: 'inset 0 0 0 .5px var(--i5)',
        display: 'grid', placeItems: 'center', fontSize: '11px', color: 'var(--i3)', overflow: 'hidden',
      });
      const body = el('div', { minWidth: '0', display: 'flex', flexDirection: 'column', gap: '3px' });
      const head = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px' });
      head.appendChild(el('code', { fontSize: 'calc(15px * var(--k))', fontWeight: '600', color: 'var(--i1)' }, row.name));
      const now = el('code', { fontSize: 'calc(13px * var(--k))', color: 'var(--i2)', wordBreak: 'break-all' });
      now.setAttribute('data-current', '');
      head.appendChild(now);
      head.appendChild(el('span', { fontSize: '11px', color: 'var(--i3)' }, row.file));
      body.appendChild(head);
      for (const ctx of Object.keys(row.byCtx)) {
        if (ctx === 'darkMedia' && row.byCtx.dark) continue; // 与 data-theme=dark 块一致（单测核对），不重复列
        const entry = row.byCtx[ctx];
        const label = (CONTEXTS.find(c => c.id === ctx) || { label: ctx }).label;
        const line = el('div', { fontSize: 'calc(12px * var(--k))', lineHeight: '1.5', color: 'var(--i3)', wordBreak: 'break-all' });
        line.setAttribute('data-ctx', ctx);
        line.appendChild(el('span', { color: 'var(--i2)' }, `${label}  ${entry.value}`));
        if (entry.use) line.appendChild(el('span', null, `  · ${entry.use}`));
        if (entry.source) line.appendChild(el('span', { display: 'block' }, `来源：${entry.source}`));
        body.appendChild(line);
      }
      item.appendChild(swatch);
      item.appendChild(body);
      list.appendChild(item);
      cells.push({ name: row.name, swatch, now });
    }
    refresh();
  }

  function refresh() {
    const st = themeState();
    for (const b of themeButtons) {
      const on = b.dataset.value === st.theme;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.boxShadow = on ? 'inset 0 0 0 1.5px var(--i1)' : 'inset 0 0 0 .5px var(--i5)';
    }
    sizeBtn.textContent = `${LABELS.size}：${st.size}`;
    status.textContent = `data-theme=${st.theme}  data-text-size=${st.size}  --p=${currentValue('--p')}  --k=${currentValue('--k')}`;
    for (const c of cells) {
      const v = currentValue(c.name);
      c.now.textContent = v;
      if (c.name === '--paper-image') {
        c.swatch.textContent = '';
        c.swatch.className = 'paper';
      } else if (isColor(v)) {
        c.swatch.textContent = '';
        c.swatch.style.background = `var(${c.name})`;
      } else {
        c.swatch.style.background = 'var(--c)';
        c.swatch.textContent = v.length <= 6 ? v : '…';
      }
    }
  }

  if (window.matchMedia) {
    for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)']) {
      const mq = window.matchMedia(q);
      if (mq.addEventListener) mq.addEventListener('change', refresh);
      else if (mq.addListener) mq.addListener(refresh);
    }
  }

  loadRows().then(r => {
    rows = r;
    renderRows();
  }, error => {
    list.appendChild(el('p', { padding: '12px 0', color: 'var(--ar)' }, LABELS.loadFailed + (error && error.message ? error.message : String(error))));
    console.warn('[shizi] palette:', error);
  });

  mountPointerStats(page); // M0-7：指针与手势 spike 块
  return page;
}
import { mountPointerStats } from './pointer-stats.js'; // M0-7
