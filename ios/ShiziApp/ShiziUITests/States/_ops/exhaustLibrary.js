// 练习范围学完（D66 ⑩）：把设置里的练习范围切到最小的库（a.library，缺省 rare），再给这个库里每个可练的字一条写对的判断记录（不留墨，只为让「没有新字可出」成立）。
// 记录时刻从 a.at 起（缺省 2026-10-05 08:00；逐字错开 1 秒）。要提交请接着调 seed。
const { libraryOf, isPracticable } = await import('/src/data/deck.js');
const lib = a.library || 'rare';
// 大写数字特别组（D40）的字也写过，免得首页还有一组特别组可出
const chars = [...new Set([...libraryOf(lib).keys, ...[...'壹贰叁肆伍陆柒捌玖拾零佰仟'].map(c => 'base:' + c)].filter(k => isPracticable(k)).map(k => k.slice('base:'.length)))];
await OPS.patch(ctx, { domain: 'settings', value: { library: lib } });
await OPS.seedRecords(ctx, { entries: chars.map((ch, i) => ({ char: ch, at: Date.parse(a.at || '2026-10-05T08:00:00') + i * 1000, ink: false })) });
