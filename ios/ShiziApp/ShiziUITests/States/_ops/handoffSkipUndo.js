// 最后一字跳过 → 写字页把撤销机会交给结果页（取证时撤销条留够久，不在截图前收起）。需要先 call skip。a: {slot}
const { handoffSkipUndo } = await import('/src/ui/screens/result/index.js');
const sk = ctx.vars.last;
handoffSkipUndo({ ...sk.undo, slot: a.slot || 'B', strokes: null, until: performance.now() + 600000 });
