// 阶段 1 S1（03 P200 / P201；decisions D50 ⑦ / D46 ⑮ / D30）：判断声 j1（三个变体轮换）、落款盖章声 s1，书写与描红不出声。
// 浏览器路径（不装假原生桥）：Web Audio 播放预解码的 WAV。原生路径（假桥消息里的文件名与增益）由 55-reminder 与 test/platform 覆盖。
//
//   1. 4 字一组逐字判断：请求到的音频资源只有 j1 三个变体（与落款 s1），没有别的；真的开始播放的 Web Audio 缓冲依次是
//      j1 / j1_b / j1_c / j1（150ms）→ 最后一字判断后结果页作品出现 → s1（320ms）恰好一次；soundLog 同序。
//   2. 书写与描红无声：回忆阶段落笔、「看答案」后「描一遍」每次落笔，都没有新的音频请求、没有新的播放。
//   3. 设置「按键音」关着：判断、结果页落款一个音频请求都不发、不播放。
//   4. 落款：作品出现才响；回到本页（同一组）不再响；整组没有墨（衬底一行、无落款）不响；直接打开结果页（刷新后）也响一次 s1。

import { HORIZONTAL, bootTestHost, drawStroke, openWrite, seedSession, tid, topSel, waitNavIdle, tap } from './helpers.mjs';
import { openResultPage, seedWork } from './work-helpers.mjs';

const JUDGE = ['j1_page_settle', 'j1_page_settle_b', 'j1_page_settle_c'];
const SEAL = 's1_wood_muted';

async function install(page) {
  const requests = [];
  page.on('request', req => {
    const m = /\/assets\/sound\/([^/?]+)$/.exec(new URL(req.url()).pathname);
    if (m) requests.push(m[1]);
  });
  await page.addInitScript(() => {
    window.__starts = [];
    const proto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
    if (!proto) return;
    const start = proto.start;
    proto.start = function patched(...args) {
      window.__starts.push({ ms: Math.round(((this.buffer && this.buffer.duration) || 0) * 1000) });
      return start.apply(this, args);
    };
  });
  return requests;
}

const log = page => page.evaluate(async () => (await import('/src/platform/sound.js')).soundLog());
const starts = page => page.evaluate(() => (window.__starts || []).map(s => s.ms));
/** 等预载完成（预载的 Promise 缓存在 sound.js 里，再 warm 一次就是同一批请求的结果）。 */
const ready = (page, events) => page.evaluate(async ev => (await import('/src/platform/sound.js')).warmSounds({ events: ev }), events || null);

async function judgeOne(page, wrong = false) {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel(wrong ? 'write-judge-wrong' : 'write-judge-correct'));
  await waitNavIdle(page);
  await page.click(topSel(wrong ? 'write-judge-wrong' : 'write-judge-correct'));
}

export default async function s1SoundSpec(page, ctx) {
  const { assert, step } = ctx;
  const requests = await install(page);
  await bootTestHost(page, ctx.baseURL);

  step('4 chars: judge sounds rotate j1 / _b / _c / j1, then the seal s1 once when the result page shows the work');
  let seeded = await seedSession(page, { id: 's80', kind: 'daily', slot: 'A', chars: ['永', '和', '春', '大'] });
  assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitNavIdle(page);
  await openWrite(page);
  assert.equal(await ready(page), true, 'all four sound files preloaded and decoded');
  const preloaded = [...requests].sort();
  assert.deepEqual(preloaded, [...JUDGE, SEAL].map(n => `${n}.wav`).sort(), 'only the four selected WAV files are requested');
  assert.deepEqual(await log(page), [], 'nothing played yet');

  await drawStroke(page, HORIZONTAL);
  assert.deepEqual(await log(page), [], 'recall stroke: silent');
  assert.deepEqual(await starts(page), [], 'recall stroke: no Web Audio playback');
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitNavIdle(page);
  assert.deepEqual(await log(page), [], 'compare page: silent');
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  assert.deepEqual(await log(page), [JUDGE[0]], 'first judgment → j1');
  await waitNavIdle(page);
  await judgeOne(page, true);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '2');
  assert.deepEqual(await log(page), JUDGE.slice(0, 2), 'a wrong judgment sounds the same family (no reward / penalty colour)');
  await waitNavIdle(page);
  await judgeOne(page);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '3');
  await waitNavIdle(page);
  assert.deepEqual(await log(page), JUDGE, 'third → j1_c');

  await judgeOne(page);
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => (window.__starts || []).length >= 5);
  assert.deepEqual(await log(page), [...JUDGE, JUDGE[0], SEAL], 'fourth judgment → j1 again; result page → s1 seal');
  assert.deepEqual(await starts(page), [150, 150, 150, 150, 320], 'the decoded buffers actually started: 4 × judge (150ms) + 1 × seal (320ms)');
  assert.equal((await page.locator(topSel('work-seal')).count()), 1, 'the result page shows the seal');
  await page.waitForTimeout(400);
  assert.equal((await starts(page)).length, 5, 'the seal sounds once');
  assert.deepEqual([...requests].sort(), preloaded, 'no further audio requests (everything came from the preload)');

  step('writing and tracing are silent (recall strokes, 看答案 → 描一遍 strokes)');
  await page.evaluate(() => window.__shiziTest.reset());
  seeded = await seedSession(page, { id: 's81', kind: 'daily', slot: 'A', chars: ['永', '和'] });
  assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitNavIdle(page);
  await openWrite(page);
  await ready(page);
  const startsBefore = (await starts(page)).length;
  const logBefore = (await log(page)).length;
  const reqBefore = requests.length;
  await tap(page, 'write-show-answer');
  await page.waitForSelector(topSel('write-answer-trace'));
  await waitNavIdle(page);
  await page.click(topSel('write-answer-trace'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'trace');
  await waitNavIdle(page);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await drawStroke(page, [[0.5, 0.2], [0.5, 0.8]]);
  await page.waitForTimeout(150);
  await drawStroke(page, HORIZONTAL);
  assert.equal((await starts(page)).length, startsBefore, 'trace strokes: no playback');
  assert.equal((await log(page)).length, logBefore, 'trace strokes: nothing logged');
  assert.equal(requests.length, reqBefore, 'trace strokes: no audio request');

  step('按键音 off: judging and the result page request and play nothing');
  await page.evaluate(() => window.__shiziTest.reset());
  const offReq = requests.length;
  const offStarts = (await starts(page)).length;
  const offLog = (await log(page)).length;
  // 新页面（模块缓存里的预载已有也不该播放）：关着时判断与落款完全无声
  seeded = await seedSession(page, { id: 's82', kind: 'daily', slot: 'A', chars: ['永'], extraState: { settings: { sound: false } } });
  assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitNavIdle(page);
  await openWrite(page);
  await judgeOne(page);
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.waitForTimeout(400);
  assert.equal((await starts(page)).length, offStarts, 'sound off: nothing played');
  assert.equal((await log(page)).length, offLog, 'sound off: nothing logged');
  assert.equal(requests.length, offReq, 'sound off: no audio request');

  step('the seal: once per result page; not when the group has no ink (plain row, no seal); sounds when the result page is opened directly');
  await page.evaluate(() => window.__shiziTest.reset());
  await page.evaluate(async () => (await import('/src/platform/sound.js')).resetSound());
  await page.evaluate(() => { window.__starts.length = 0; });
  const noInk = await seedWork(page, { id: 's83', chars: ['永', '和'], steps: ['skip', 'seen'] });
  await openResultPage(page, { slot: noInk.slot, sessionId: noInk.sessionId });
  await page.waitForTimeout(400);
  assert.equal(await page.locator(topSel('work-seal')).count(), 0, 'no ink → no seal');
  assert.deepEqual(await starts(page), [], 'no seal, no sound');
  await page.evaluate(() => window.__shiziTest.reset());
  const inked = await seedWork(page, { id: 's84', chars: ['永', '和', '春'], steps: ['correct', 'wrong', 'correct'] });
  await openResultPage(page, { slot: inked.slot, sessionId: inked.sessionId });
  await page.waitForFunction(() => (window.__starts || []).length >= 1);
  await page.waitForTimeout(300);
  assert.deepEqual(await starts(page), [320], 'work shown → seal sounds once');
  assert.deepEqual(await log(page), [SEAL], 'soundLog: the seal once');
  // 点开一格再关闭（结果页还在、作品重绘）不再响
  await page.click(topSel('work-cell'));
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  assert.deepEqual(await starts(page), [320], 'sheet open / close: the seal does not sound again');
}
