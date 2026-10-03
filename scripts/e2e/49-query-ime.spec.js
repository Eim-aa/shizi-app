// F6（真机复现）：查字 / 自己选字弹层里，用中文拼音输入法从候选条选字后，输入框里已经有汉字，结果行 / 字卡却不出现，
// 必须再按一个非输入法的键才出结果。
//   根因：QueryInput 用 onCompositionStart / onCompositionEnd 驼峰名挂事件，Preact 在元素上查不到 oncompositionstart 属性，
//   实际监听的是区分大小写的 'CompositionStart' / 'CompositionEnd'——永远不触发。WebKit（iOS）选字时只有
//   input(isComposing=true) 然后 compositionend，没有 isComposing=false 的 input，于是整次选字都被 isComposing 过滤掉了；
//   Chromium 会在 compositionend 后补一个 isComposing=false 的 input，所以桌面浏览器上看不出来。
//   修复：全小写事件名 + compositionend 时用输入框最终值上报一次（createTextGate，同值去重）。
//
// 三种方式，每种都在两个入口（首页「自己选字 →」pick、字库查字框 lookup）各跑一遍：
//   WebKit 顺序   compositionstart → input(true)… → 值变成汉字 → input(true) → compositionend（之后没有别的事件）
//   Chromium 顺序 同上，但 compositionend 之后再补一个 input(false)
//   真实输入法    CDP Input.imeSetComposition + Input.insertText（Chromium 自己的组字 / 提交顺序）
// 断言：组字中（拼音字母）不出过滤提示、不出结果；选字后立即出现逐字行 / 字卡，不需要再按任何键。
import { bootTestHost, tid, waitNavIdle } from './helpers.mjs';

const SHEET = '[data-testid="query-sheet"]';
const INPUT = `${SHEET} ${tid('query-input')}`;

async function openFromHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('home-pick')}`);
  await page.waitForSelector(INPUT);
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function openFromLibrary(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector(INPUT);
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function closeSheet(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('.sz-sheet'));
  await waitNavIdle(page);
}

/** 在输入框上按给定顺序派发事件。steps: ['start'] | ['value', 'chun'] | ['input', isComposing] | ['end']。 */
async function fire(page, steps) {
  await page.evaluate(list => {
    const el = document.querySelector('[data-testid="query-input"]');
    for (const [kind, arg] of list) {
      if (kind === 'start') el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      else if (kind === 'value') el.value = arg;
      else if (kind === 'input') el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: arg, data: el.value }));
      else if (kind === 'end') el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: el.value }));
    }
  }, steps);
}

async function typedState(page) {
  return page.evaluate(() => ({
    value: document.querySelector('[data-testid="query-input"]').value,
    view: document.querySelector('[data-testid="query-body"]').dataset.view,
    rows: document.querySelectorAll('[data-testid="query-row"]').length,
    cards: document.querySelectorAll('[data-testid="query-card"]').length,
    notes: document.querySelectorAll('[data-testid="query-note"]').length,
  }));
}

async function clearInput(page) {
  await page.fill(INPUT, '');
  await page.waitForFunction(() => document.querySelector('[data-testid="query-body"]').dataset.view === 'hint');
}

export default async function queryImeSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const cdp = await page.context().newCDPSession(page);
  const entries = [['home 自己选字 (pick)', openFromHome], ['library 查字框 (lookup)', openFromLibrary]];

  for (const [name, open] of entries) {
    await page.evaluate(() => window.__shiziTest.reset());
    await open(page);

    step(`${name}: WebKit 顺序（input(isComposing=true) 后只有 compositionend）→ 选字后立即出现逐字行`);
    await fire(page, [['start'], ['value', 'c'], ['input', true], ['value', 'chun'], ['input', true]]);
    let s = await typedState(page);
    assert.equal(s.view, 'hint', `${name}: 组字中（拼音字母）不出结果`);
    assert.equal(s.notes, 0, `${name}: 组字中不出「只能输入汉字」提示`);
    await fire(page, [['value', '春夏'], ['input', true], ['end']]);
    await page.waitForSelector(`${SHEET} ${tid('query-rows')}`, { timeout: 1500 });
    s = await typedState(page);
    assert.deepEqual([s.value, s.view, s.rows], ['春夏', 'rows', 2], `${name}: WebKit 顺序选字后立即有 2 行（没有再按任何键）`);
    await clearInput(page);

    step(`${name}: WebKit 顺序，单字 → 立即出现字卡`);
    await fire(page, [['start'], ['value', 'chun'], ['input', true], ['value', '春'], ['input', true], ['end']]);
    await page.waitForSelector(`${SHEET} ${tid('query-card')}[data-char="春"]`, { timeout: 1500 });
    await clearInput(page);

    step(`${name}: Chromium 顺序（compositionend 之后再补 input(isComposing=false)）→ 立即出现`);
    await fire(page, [['start'], ['value', 'xia'], ['input', true], ['value', '夏秋'], ['input', true], ['end'], ['input', false]]);
    await page.waitForSelector(`${SHEET} ${tid('query-rows')}`, { timeout: 1500 });
    s = await typedState(page);
    assert.deepEqual([s.value, s.view, s.rows], ['夏秋', 'rows', 2], `${name}: Chromium 顺序有 2 行`);
    await clearInput(page);

    step(`${name}: 真实输入法（CDP imeSetComposition + insertText）→ 组字中不出结果，选字后立即出现`);
    await page.focus(INPUT);
    await cdp.send('Input.imeSetComposition', { text: 'chun', selectionStart: 4, selectionEnd: 4 });
    s = await typedState(page);
    assert.equal(s.view, 'hint', `${name}: 真实组字中不出结果`);
    assert.equal(s.notes, 0, `${name}: 真实组字中不出过滤提示`);
    await cdp.send('Input.insertText', { text: '春夏' });
    await page.waitForSelector(`${SHEET} ${tid('query-rows')}`, { timeout: 1500 });
    s = await typedState(page);
    assert.deepEqual([s.value, s.view, s.rows], ['春夏', 'rows', 2], `${name}: 真实输入法选字后立即有 2 行`);

    step(`${name}: 普通键入仍然逐字更新`);
    await clearInput(page);
    await page.focus(INPUT);
    await page.keyboard.type('山');
    await page.waitForSelector(`${SHEET} ${tid('query-card')}[data-char="山"]`, { timeout: 1500 });
    await closeSheet(page);
  }
}
