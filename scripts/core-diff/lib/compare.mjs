// 回包比对（B4.0；计划 §4.3「数字与 JSON」）：
//   1. 值比对：两边各自 JSON.parse 后逐字段比（对象不看键序；数字 ===）；ok 相同；失败时只比 error.code 与 state，不比 message；
//   2. 字节比对：值相等且都成功时，两行文字必须逐字节相同（键序、数字格式、转义都照 JS JSON.stringify）。
// 返回 null（相同）或 { kind: 'value' | 'encoding' | 'unparseable', path, a, b }。

export function firstDiff(a, b, path = '$') {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return { path, a, b };
  if (ta === 'array') {
    if (a.length !== b.length) return { path: path + '.length', a: a.length, b: b.length };
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k)) return { path: `${path}.${k}`, a: a[k], b: undefined };
    for (const k of kb) if (!Object.prototype.hasOwnProperty.call(a, k)) return { path: `${path}.${k}`, a: undefined, b: b[k] };
    for (const k of ka) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path, a, b };
}

function parse(line) {
  try {
    return { v: JSON.parse(line) };
  } catch {
    return null;
  }
}

export function compareLines(la, lb) {
  const pa = parse(la);
  const pb = parse(lb);
  if (!pa || !pb) return { kind: 'unparseable', path: '$', a: la, b: lb };
  const a = pa.v;
  const b = pb.v;
  if (a && b && a.ok === false && b.ok === false) {
    const strip = (r) => ({ ...r, error: { code: r.error && r.error.code } });
    const d = firstDiff(strip(a), strip(b));
    return d ? { kind: 'value', ...d } : null;
  }
  const d = firstDiff(a, b);
  if (d) return { kind: 'value', ...d };
  if (a && a.ok === true && la !== lb) {
    let i = 0;
    while (i < la.length && la[i] === lb[i]) i += 1;
    return { kind: 'encoding', path: `@${i}`, a: la.slice(Math.max(0, i - 30), i + 40), b: lb.slice(Math.max(0, i - 30), i + 40) };
  }
  return null;
}
