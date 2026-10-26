// 字库子页的网页量测（B3.8；原生字库子页用）。
//
// 原生排版要用到几处「网页量出来的值」——它们都由网页的排版规则或字体度量决定，原生（TextKit / CoreText）算不出同一个数：
//   1) 组头（.sz-all__head）的高：flex + align-items:baseline 的行盒高 = max(基线以上) + max(基线以下)，
//      由字体的升降部决定；网页（WebKit）与原生（CoreText）取字体度量的口径略有差别，逐组量一次最省事。
//   2) text-wrap: pretty 的段落的折行点（.sz-list__top / .sz-list__hint / .sz-all__note）：网页 WebKit 按整段均衡各行长度，
//      原生 TextKit 没有这个规则（做法同 result/native-view.js 的 webLineStarts）。
//   3) 页头尾端「排序 · 筛选」文字按钮的宽：网页 -apple-system 的中文字宽与原生 compose 的苹方正文款差 0.1–0.8pt/字。
//   4) 弹层里排序三键的字（网页 Button.js 的字可折行，折行点与原生不同；折行点一致才不会互相压住）。
//
// 量法：页面里用**同一组 CSS 类**排一份看不见的副本，量出盒子的几何 / 折行点，原生照这些值排版（原生不另算规则）。
// 没有 DOM（node:test）时返回 null，原生按自己的宽度排。

const HIDDEN = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none';

/** 视口宽（CSS px）；页面外（node:test）返回 0。 */
export function viewportWidth() {
    if (typeof document === 'undefined' || !document.body) return 0;
    return document.documentElement.clientWidth || 0;
}

/** 页边距（网页 --gutter，px）；页面外返回 0。 */
export function gutterWidth() {
    if (typeof document === 'undefined' || !document.documentElement) return 0;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--gutter');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

/** 正文宽（网页 .sz-page__body 的内容宽 = 视口宽 − 2 × 页边距）。 */
export function contentWidth() {
    const w = viewportWidth();
    if (!w) return 0;
    return Math.max(0, w - 2 * gutterWidth());
}

/** 一个看不见的量测宿主（absolute + visibility:hidden，仍参与排版）。 */
function hiddenHost(width) {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `${HIDDEN};width:${width}px`;
    document.body.appendChild(host);
    return host;
}

/**
 * 网页的折行点（同 result/native-view.js 的 webLineStarts）：一段文字在给定宽下，每一行从第几个字开始。
 * build(host) 把副本放进 host 并返回单位表：{node, off, len}（一个字）。
 */
export function webLineStarts(build, width) {
    if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
    const host = hiddenHost(width);
    try {
        const units = build(host);
        document.body.appendChild(host);
        const starts = [];
        let lastTop = null;
        units.forEach((u, i) => {
            let top = null;
            if (u.el) {
                top = u.el.getBoundingClientRect().top;
            } else {
                const r = document.createRange();
                r.setStart(u.node, u.off);
                r.setEnd(u.node, u.off + u.len);
                const rects = r.getClientRects();
                if (rects.length) top = rects[rects.length - 1].top;
            }
            if (top === null) return;
            if (lastTop !== null && top > lastTop + 8) starts.push(i); // 换行 = 竖向跳过半行以上
            lastTop = top;
        });
        return starts;
    } catch (error) {
        return null;
    } finally {
        host.remove();
    }
}

/** 一段纯文字的折行点（按 Array.from 的字计）。 */
export function textLineStarts(text, { wrapClass, tag = 'p', cls }, width) {
    if (!text) return null;
    return webLineStarts(host => {
        const wrap = document.createElement('div');
        wrap.className = wrapClass;
        const el = document.createElement(tag);
        el.className = cls;
        const node = document.createTextNode(text);
        el.appendChild(node);
        wrap.appendChild(el);
        host.appendChild(wrap);
        const units = [];
        let off = 0;
        for (const ch of Array.from(node.data)) {
            units.push({ node, off, len: ch.length });
            off += ch.length;
        }
        return units;
    }, width);
}

/**
 * 一个组头的高（网页 .sz-all__head：组名（宋 fs22）+ 字数（黑 fs15），flex + align-items:baseline）。
 * isButton = 网页这一行是可点的月份标题（.sz-all__head.sz-btn，最小高 44）还是普通的一行文字（最小高 28）。
 */
export function groupHeadHeight(name, count, isButton, width) {
    if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
    const host = hiddenHost(width);
    try {
        const head = document.createElement(isButton ? 'button' : 'div');
        head.className = isButton ? 'sz-btn sz-btn--plain sz-all__head' : 'sz-all__head';
        const nameEl = document.createElement('span');
        nameEl.className = 'sz-all__name';
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.className = 'sz-all__count';
        countEl.textContent = count;
        head.appendChild(nameEl);
        head.appendChild(countEl);
        host.appendChild(head);
        const h = head.getBoundingClientRect().height;
        return Number.isFinite(h) ? h : null;
    } catch (error) {
        return null;
    } finally {
        host.remove();
    }
}

/**
 * 一个文字按钮的宽（网页 .sz-btn--text：字宽 + 左右各 4px 内边距；外边距 −4 不进盒）。
 * 原生按这个宽摆按钮（页头尾端的「排序 · 筛选」）。
 */
export function textButtonWidth(text, width) {
    if (typeof document === 'undefined' || !document.body) return null;
    const host = hiddenHost(Math.max(1, width || 0));
    try {
        const b = document.createElement('button');
        b.className = 'sz-btn sz-btn--text';
        b.textContent = text;
        host.appendChild(b);
        const w = b.getBoundingClientRect().width;
        return Number.isFinite(w) ? w : null;
    } catch (error) {
        return null;
    } finally {
        host.remove();
    }
}

/**
 * 排序键（网页 .sz-all__sort.sz-btn：display:grid + place-items:center，字在键里折行）的折行点。
 * 网页的字在键里折行（Button.js 的字可折行），折行点与原生不同；折行点一致才不会互相压住。
 */
export function sortButtonLines(text, width) {
    if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
    const host = hiddenHost(width);
    try {
        const b = document.createElement('button');
        b.className = 'sz-btn sz-btn--plain sz-all__sort';
        b.style.width = width + 'px';
        const node = document.createTextNode(text);
        b.appendChild(node);
        host.appendChild(b);
        const units = [];
        let off = 0;
        for (const ch of Array.from(node.data)) {
            units.push({ node, off, len: ch.length });
            off += ch.length;
        }
        const starts = [];
        let lastTop = null;
        units.forEach((u, i) => {
            const r = document.createRange();
            r.setStart(u.node, u.off);
            r.setEnd(u.node, u.off + u.len);
            const rects = r.getClientRects();
            if (!rects.length) return;
            const top = rects[rects.length - 1].top;
            if (lastTop !== null && top > lastTop + 8) starts.push(i);
            lastTop = top;
        });
        return starts;
    } catch (error) {
        return null;
    } finally {
        host.remove();
    }
}
