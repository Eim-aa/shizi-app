// 中文按词折行（R3-K1，第三轮审查 A3-02，P242）。
//
// 上一轮（A2-11）为了不让按钮文字「自己 / 写」这样词内折行，给 AX 档按钮加了 `word-break:keep-all`——CJK 的 keep-all 等于「汉字之间都不许断」，
// 中文句子没有空格，一整句就成了一个词：WebKit 里「描好了，自己写」整行不折，压到「⋯」下面、冲出屏幕（Chromium 会在「，」后断，所以不复现）。
// 现在全局不用 keep-all：
//   - 按钮（components/Button.js 的字符串文字）与菜单项：经 Intl.Segmenter('zh', {granularity:'word'}) 分词，每个词包进 white-space:nowrap 的 span，
//     折行只发生在词与词之间（两个 span 的交界处由父元素的 white-space 决定能不能断：标准档按钮本来 nowrap，一行到底；AX 档按钮 normal，在词边界折）；
//     标点并进相邻的词（开括号「（“ 并进后一个词，其余并进前一个词），所以行首不会是「，」、行尾不会是「「」；空白照常是断点。
//   - 正文与说明句：正常 CJK 折行 + `line-break:strict`（各页样式里写，不经本组件）。
// 没有 Intl.Segmenter（iOS 15.4 以下，scripts/verify_api_floor.mjs API_ALLOW 已登记）时整段原样返回，退回正常 CJK 折行。

import { html } from '../../../vendor/ui.js';
import { injectStyles } from './styles.js';

injectStyles('words', `
.sz-words__w{white-space:nowrap}
`);

const OPENING = /^[「『（《〈【〔“‘([{]+$/u;
const CACHE_MAX = 400;
const cache = new Map();
let segmenter;

function getSegmenter() {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  } catch (error) {
    segmenter = null;
  }
  return segmenter;
}

/**
 * 把一段文字切成「不可再断」的块（纯函数，带缓存）：词（含并进来的标点）原样一块，空白单独一块（是断点）。
 * 没有分词器时返回 [text]。
 * @param {string} text
 * @returns {string[]}
 */
export function segmentWords(text) {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  if (cache.has(s)) return cache.get(s);
  const seg = getSegmenter();
  let out;
  if (!seg) {
    out = [s];
  } else {
    out = [];
    let pendingOpen = '';
    let lastIsWord = false; // out 的最后一块是不是可并标点的词块
    for (const part of seg.segment(s)) {
      const piece = part.segment;
      if (/^\s+$/u.test(piece)) {
        if (pendingOpen) {
          out.push(pendingOpen);
          pendingOpen = '';
        }
        out.push(piece);
        lastIsWord = false;
      } else if (part.isWordLike) {
        out.push(pendingOpen + piece);
        pendingOpen = '';
        lastIsWord = true;
      } else if (OPENING.test(piece)) {
        pendingOpen += piece;
      } else if (lastIsWord) {
        out[out.length - 1] += piece;
      } else {
        out.push(pendingOpen + piece);
        pendingOpen = '';
        lastIsWord = true;
      }
    }
    if (pendingOpen) out.push(pendingOpen);
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(s, out);
  return out;
}

/**
 * 按词折行的文字：外面一个 .sz-words（按钮常是 inline-flex / grid，词不能各自成为一个 flex / grid 项——那会在词间加 gap 或竖排），
 * 里面每个词一个 nowrap 的 span，空白原样。只有一块时直接返回字符串（DOM 不多一层）。
 * @param {{text: string}} props
 */
export function Words({ text }) {
  const parts = segmentWords(text);
  if (parts.length <= 1) return parts.length ? parts[0] : null;
  return html`<span class="sz-words">${parts.map((p, i) => (/^\s+$/u.test(p) ? p : html`<span key=${i} class="sz-words__w">${p}</span>`))}</span>`;
}
