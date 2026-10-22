// node --test 的自定义报告器（B4.0 转写清单用）：每个跑完的 test / 子 test 输出一行 JSON {file, name, nesting, suite, skip, todo, ok}。
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (!d.file) continue;
    yield JSON.stringify({
      file: d.file,
      name: d.name,
      nesting: d.nesting,
      suite: d.details && d.details.type === 'suite',
      skip: !!d.skip,
      todo: !!d.todo,
      ok: event.type === 'test:pass',
    }) + '\n';
  }
}
