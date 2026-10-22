// 参考引擎读请求行用的 JSON 解析（B4.2）。为什么不用 JSON.parse：node 26（V8）的 JSON.parse 在「沿用前面同形对象的隐藏类」快路径上
// 有个 bug——前面解析过键为 "\\" 的对象之后，同位置的转义键 "\u001f" 会被读成 "\\"（夜间差分种子 4896 第 195 步，纯 JSON.parse 即可复现，
// 新进程里不复现）。参考实现必须按规范，所以请求行用这个逐字符的解析器；语义同 JSON.parse（重复键后者为准、__proto__ 是普通自有键、
// 数字用 Number()、坏 JSON 抛 SyntaxError）。
export function parseJson(text) {
  let i = 0;
  const n = text.length;
  const fail = (m) => {
    throw new SyntaxError(`${m} at position ${i}`);
  };
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };
  function str() {
    i += 1; // "
    let out = '';
    let start = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i += 1;
        return out;
      }
      if (c < 0x20) fail('Bad control character in string literal');
      if (c === 0x5c) {
        out += text.slice(start, i);
        const e = text[i + 1];
        i += 2;
        if (e === '"') out += '"';
        else if (e === '\\') out += '\\';
        else if (e === '/') out += '/';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const h = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('Bad Unicode escape');
          out += String.fromCharCode(parseInt(h, 16));
          i += 4;
        } else fail('Bad escaped character');
        start = i;
      } else i += 1;
    }
    return fail('Unterminated string');
  }
  function value() {
    ws();
    if (i >= n) fail('Unexpected end of JSON input');
    const c = text[i];
    if (c === '{') {
      i += 1;
      const o = {};
      ws();
      if (text[i] === '}') {
        i += 1;
        return o;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected property name');
        const k = str();
        ws();
        if (text[i] !== ':') fail("Expected ':'");
        i += 1;
        const v = value();
        Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true });
        ws();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return o;
        }
        fail("Expected ',' or '}'");
      }
    }
    if (c === '[') {
      i += 1;
      const a = [];
      ws();
      if (text[i] === ']') {
        i += 1;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return a;
        }
        fail("Expected ',' or ']'");
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) fail('Unexpected token');
    i += m[0].length;
    return Number(m[0]);
  }
  const v = value();
  ws();
  if (i !== n) fail('Unexpected non-whitespace character after JSON');
  return v;
}
