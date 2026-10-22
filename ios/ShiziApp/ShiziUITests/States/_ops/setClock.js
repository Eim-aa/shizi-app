// 把页面时钟平移到固定时刻（之后照常流逝；QAClock 记住偏移，杀进程重开也一样）。a: {iso: 'YYYY-MM-DDTHH:mm:ss'}。
// 与 clock.pin 的区别：pin 只在造数据期间让每次读数 +5ms（FSRS fuzz 种子含复习时刻，要可复现）；setClock 是造完以后「现在是几号几点」。
ctx.T.setClock(a.iso);
