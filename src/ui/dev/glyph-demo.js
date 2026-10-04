// 参考字形演示页（M1-2）：只给 e2e（scripts/e2e/12-glyph.spec.js）与开发走查用，不是产品页面。
// 只在测试主机（?test=1 且 localhost/127.0.0.1，见 platform/env.js isTestHost）注册独立路由 'glyph-demo'；
// 生产形态里没有任何模块 import 本文件。e2e 用 import('/src/ui/dev/glyph-demo.js') 加载后 nav.push('glyph-demo', {char})。
// 覆盖：strokes.js 加载三态（loading / ready / missing）、联网恢复重取、Path2D 静态字形、hanzi-writer 看答案播放、
// 描一遍（轮廓 + 先播一遍可跳过）、减少动态效果直接终态、10.13 楷体 DOM 回退与灰字「暂时没有提示」。
// 本文件的 DEV 常量是开发演示字串，不进 copy/（同 _demo/sub.js 的约定）；面向用户的字串取 copy。
import { html, useEffect, useRef, useState } from '../../../vendor/ui.js';
import { registerScreen } from '../router.js';
import { isTestHost } from '../../platform/env.js';
import { Button } from '../components/Button.js';
import { Page } from '../components/Page.js';
import { injectStyles, T } from '../components/styles.js';
import { t } from '../../config/copy/index.js';
import { hintButtonCopy, hintButtonState, nextHintRange } from '../../core/hints.js';
import { watchStrokes } from '../../data/strokes.js';
import { animate, drawGlyph, drawMedians, glyphColor } from '../canvas/glyph.js';
import { GlyphFallback, NoHintLabel, fallbackCopy } from '../screens/write/glyph-fallback.js';

export const GLYPH_DEMO_SCREEN = 'glyph-demo';

const DEV = {
  entry: '参考字形演示',
  title: char => `参考字形 · ${char}`,
  modeStatic: '静态字形',
  skip: '跳过播放',
  replay: '再播一遍',
  loading: '加载中',
};

injectStyles('glyph-demo', `
.sz-gd__box{position:relative;align-self:center;background:${T.sheet};border-radius:${T.rCtl};overflow:hidden}
.sz-gd__box canvas{position:absolute;left:0;top:0;display:block}
.sz-gd__anim{position:absolute;left:0;top:0;pointer-events:none}
.sz-gd__row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.sz-gd__row>.sz-btn--secondary,.sz-gd__row>.sz-btn--primary{flex:1;min-width:120px}
.sz-gd__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

function boxSize(win) {
  const w = (win && win.innerWidth) || 393;
  return Math.max(200, Math.min(345, w - 48));
}

function paintBase(canvas, size) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const px = Math.round(size * dpr);
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function GlyphDemo({ params }) {
  const char = (params && params.char) || '永';
  const size = boxSize(typeof window !== 'undefined' ? window : null);
  const [load, setLoad] = useState({ status: 'loading', data: null, source: null, reason: null });
  const [mode, setMode] = useState('static'); // static | play | trace
  const [anim, setAnim] = useState('idle'); // idle | running | completed | skipped | static | cancelled | failed
  const [hintsUsed, setHintsUsed] = useState(0);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const ctrlRef = useRef(null);

  // 数据：strokes.js 取一次，取不到就等 online 事件再取（01 §8.5）。
  useEffect(() => {
    setLoad({ status: 'loading', data: null, source: null, reason: null });
    setHintsUsed(0);
    const w = watchStrokes(char, ev => {
      setLoad({ status: ev.status, data: ev.data || null, source: ev.source || null, reason: ev.reason || null });
    });
    return () => w.stop();
  }, [char]);

  // 画布与动画：数据或模式变化时重画；旧动画先拆掉（换字 / 离开不串到新状态）。
  useEffect(() => {
    if (ctrlRef.current) {
      ctrlRef.current.destroy();
      ctrlRef.current = null;
    }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = paintBase(canvas, size);
    const data = load.status === 'ready' ? load.data : null;
    if (!data) {
      setAnim('idle');
      return undefined;
    }
    const scale = size / 345;
    ctx.scale(scale, scale); // 下面按书写格内部 345 单位画
    if (mode === 'static') {
      drawGlyph(ctx, data, { color: glyphColor('--ref') });
      if (hintsUsed > 0) {
        const r = nextHintRange({ totalStrokes: data.strokes.length, writtenStrokes: 0, used: hintsUsed - 1 });
        if (r) drawMedians(ctx, data, { from: r.from, to: r.from + r.count, color: glyphColor('--hint', glyphColor('--ar')), alpha: 0.92 });
      }
      setAnim('idle');
      return undefined;
    }
    if (mode === 'trace') {
      drawGlyph(ctx, data, { color: glyphColor('--tf'), outline: { color: glyphColor('--tl'), width: 4 } });
    }
    const ctrl = animate(animRef.current, data, { mode: mode === 'trace' ? 'preview' : 'play', char, size });
    ctrlRef.current = ctrl;
    setAnim(ctrl.state);
    ctrl.done.then(result => {
      if (ctrlRef.current === ctrl) setAnim(result);
    });
    return undefined;
  }, [load, mode, size, hintsUsed]);

  useEffect(() => () => {
    if (ctrlRef.current) ctrlRef.current.destroy();
    ctrlRef.current = null;
  }, []);

  const copy = fallbackCopy();
  const missing = load.status === 'missing';
  const ready = load.status === 'ready';
  const hintState = hintButtonState({ used: hintsUsed, hasStrokeData: ready });
  const hintCopy = hintButtonCopy(hintState);
  const note = missing
    ? mode === 'trace' ? '' : mode === 'play' ? copy.answerNote : copy.noHintNote
    : ready && mode === 'play' ? copy.answerNote : '';
  const fbVariant = mode === 'trace' ? 'trace' : 'answer';
  const skip = () => {
    if (ctrlRef.current) ctrlRef.current.skip();
  };
  const replay = () => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    setAnim('running');
    ctrl.replay().then(result => {
      if (ctrlRef.current === ctrl) setAnim(result);
    });
  };

  return html`<${Page} title=${DEV.title(char)} testid="write-glyph-demo">
    <div data-testid="write-glyph-state" data-state=${load.status} data-source=${load.source || ''}
      data-reason=${load.reason || ''} data-mode=${mode} data-anim=${anim} data-char=${char}>
      <div class="sz-gd__box" data-testid="write-glyph-box" style=${`width:${size}px;height:${size}px`}>
        <canvas ref=${canvasRef} data-testid="write-glyph-canvas" aria-hidden="true"></canvas>
        <div class="sz-gd__anim" ref=${animRef} data-testid="write-glyph-anim" style=${`width:${size}px;height:${size}px`}></div>
        ${missing ? html`<${GlyphFallback} char=${char} variant=${fbVariant} size=${size} />` : null}
      </div>
    </div>
    ${note ? html`<p class="sz-gd__note" data-testid="write-glyph-note">${note}</p>` : null}
    <div class="sz-gd__row">
      ${missing
        ? html`<${NoHintLabel} />`
        : html`<${Button} variant="secondary" data-testid="write-hint" disabled=${!ready || hintState.state !== 'available'}
            onClick=${() => { setMode('static'); setHintsUsed(n => n + 1); }}>${ready ? t(hintCopy.key, hintCopy.vars) : DEV.loading}</${Button}>`}
    </div>
    <div class="sz-gd__row">
      <${Button} variant="secondary" data-testid="write-glyph-mode-static" onClick=${() => setMode('static')}>${DEV.modeStatic}</${Button}>
      <${Button} variant="secondary" data-testid="write-glyph-mode-play" onClick=${() => setMode('play')}>${t('R-W07.btnShowAnswer')}</${Button}>
      <${Button} variant="secondary" data-testid="write-glyph-mode-trace" onClick=${() => setMode('trace')}>${t('R-W07.btnTrace')}</${Button}>
    </div>
    <div class="sz-gd__row">
      <${Button} variant="text" data-testid="write-glyph-skip" disabled=${anim !== 'running'} onClick=${skip}>${DEV.skip}</${Button}>
      <${Button} variant="text" data-testid="write-glyph-replay" disabled=${!ready || mode === 'static' || anim === 'running'}
        onClick=${replay}>${DEV.replay}</${Button}>
    </div>
  </${Page}>`;
}

if (isTestHost()) registerScreen(GLYPH_DEMO_SCREEN, GlyphDemo, { label: DEV.entry });
