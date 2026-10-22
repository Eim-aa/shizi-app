// 金标准 · 数字的 JS 序列化（ECMAScript Number::toString；计划 §4.3「数字与 JSON」）。
// Swift 的 JSNumber.toString 必须逐字节相同，落盘 JSON「Swift 写、JS 读」与「JS 写、Swift 读」才逐字节可比（FNV-1a 校验和一致）。
// 每条：bits（IEEE 754 位型，16 位十六进制）→ text（String(x)）。随机部分种子固定。
import { rng } from '../../core-diff/lib/gen.mjs';

function bitsOf(x) {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getUint32(0).toString(16).padStart(8, '0') + v.getUint32(4).toString(16).padStart(8, '0');
}

function fromBits(hi, lo) {
  const v = new DataView(new ArrayBuffer(8));
  v.setUint32(0, hi);
  v.setUint32(4, lo);
  return v.getFloat64(0);
}

export default {
  id: 'number-format',
  source: 'ECMA-262 Number::toString（JSON.stringify 的数字格式）',
  build() {
    const xs = [0, -0, 1, -1, 0.1, 0.2, 0.1 + 0.2, 1 / 3, 2 / 3, 100, 1e20, 1e21, 1e21 - 65536, 123456789012345680000, 1.5e21, 1e-6, 1e-7, 1.5e-7, 0.000001234, 0.0000001234,
      2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 63, 2 ** 64, 4.35, 0.5, 1.7976931348623157e308, 5e-324, 1e-323, 2.2250738585072014e-308, 2.225073858507201e-308,
      9007199254740993, 1772488800000, 1772488800000.25, 86400000, 3.14159, 1e100, 1e-100, 123e-20, 5e-7, 4.9e-7, 999999999999999900000, 1234.5678, 0.1 * 3, 1.1 * 1.1];
    const r = rng(20261022);
    for (let i = 0; i < 400; i += 1) {
      const x = fromBits(Math.floor(r() * 2 ** 32), Math.floor(r() * 2 ** 32));
      if (Number.isFinite(x)) xs.push(x);
    }
    for (let i = 0; i < 200; i += 1) xs.push(Math.round((r() - 0.5) * 10 ** (1 + Math.floor(r() * 8))) / 10 ** Math.floor(r() * 6));
    for (let e = -10; e <= 25; e += 1) xs.push(10 ** e, 1.25 * 10 ** e);
    return { cases: xs.map((x) => ({ bits: bitsOf(x), text: String(x) })) };
  },
};
