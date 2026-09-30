// 演示子页：只给 e2e（scripts/e2e/00-shell.spec.js）与开发走查用，不是产品页面。
// 只有测试主机（?test=1 且 localhost/127.0.0.1）才由 ui/root.js 动态加载；生产形态不 import 本文件。
// 覆盖：连续推入子页、遮罩栈（确认框 / 底部弹层、弹层上再推入一页）、轻提示、撤销底栏。
// 本文件字串是开发演示用，不进 copy/（M0 验收修复 F5 明确允许保留下面的 DEV 常量：它们不是用户文案，
// 生产形态不加载本文件；verify_copy 若将来扫描 src/ 需排除 src/ui/screens/_demo/）。
import { html, useState } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Page } from '../../components/Page.js';
import { Confirm } from '../../components/Confirm.js';
import { Sheet } from '../../components/Sheet.js';
import { UndoBar } from '../../components/UndoBar.js';
import { showToast } from '../../components/Toast.js';

export const DEMO_SCREEN = '_demo/sub';

const DEV = {
  entry: '演示子页',
  title: level => `演示子页 ${level}`,
  pushNext: '再推入一层',
  openConfirm: '打开确认框',
  openSheet: '打开底部弹层',
  toast: '显示轻提示',
  toastText: '这是一条轻提示。',
  undoShow: '显示撤销底栏',
  undoLine1: '演示：已做了一次改动',
  undoLine2: '离开这一页前可以撤销',
  confirmTitle: '演示确认框',
  confirmBody: '点「好」或「取消」都会关掉它。',
  cancel: '取消',
  ok: '好',
  sheetTitle: '演示底部弹层',
  sheetPush: '在弹层上推入一页',
  sheetClose: '关掉弹层',
};

function DemoSheet({ close, active, level }) {
  return html`<${Sheet} title=${DEV.sheetTitle} onClose=${close} active=${active} testid="demo-sheet">
    <${Button} variant="secondary" data-testid="demo-sheet-push"
      onClick=${() => nav.push(DEMO_SCREEN, { level: level + 1 })}>${DEV.sheetPush}</${Button}>
    <${Button} variant="text" data-testid="demo-sheet-close" onClick=${close}>${DEV.sheetClose}</${Button}>
  </${Sheet}>`;
}

function DemoSub({ params }) {
  const level = Number(params && params.level) || 1;
  const [undo, setUndo] = useState(null); // null | 'shown' | 'done'
  const openConfirm = () => {
    const id = nav.openOverlay(Confirm, {
      title: DEV.confirmTitle,
      body: DEV.confirmBody,
      cancelLabel: DEV.cancel,
      confirmLabel: DEV.ok,
      testid: 'demo-confirm',
      onConfirm: () => nav.closeOverlay(id),
    }, { name: 'demo-confirm' });
  };
  return html`<${Page} title=${DEV.title(level)} testid=${`screen-demo-${level}`}>
    <${Button} data-testid="demo-push-next" onClick=${() => nav.push(DEMO_SCREEN, { level: level + 1 })}>${DEV.pushNext}</${Button}>
    <${Button} variant="secondary" data-testid="demo-open-confirm" onClick=${openConfirm}>${DEV.openConfirm}</${Button}>
    <${Button} variant="secondary" data-testid="demo-open-sheet"
      onClick=${() => nav.openOverlay(DemoSheet, { level }, { name: 'demo-sheet' })}>${DEV.openSheet}</${Button}>
    <${Button} variant="text" data-testid="demo-toast" onClick=${() => showToast(DEV.toastText)}>${DEV.toast}</${Button}>
    <${Button} variant="text" data-testid="demo-undo" onClick=${() => setUndo('shown')}>${DEV.undoShow}</${Button}>
    ${undo ? html`<${UndoBar} line1=${DEV.undoLine1} line2=${DEV.undoLine2} done=${undo === 'done'}
      onUndo=${() => setUndo('done')} onDoneEnd=${() => setUndo(null)} />` : null}
  </${Page}>`;
}

registerScreen(DEMO_SCREEN, DemoSub, { label: DEV.entry });
