import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(file) {
  const buf = readFileSync(file);
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const { width, height, bitDepth, colorType } = ihdr;
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const file = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 1e9);
const img = decodePng(file);
const { width, height, channels, data } = img;
const px = (x, y) => { const o = (y * width + x) * channels; return [data[o], data[o + 1], data[o + 2]]; };
console.log(`### ${file} ${width}x${height}`);
for (let y = from; y < Math.min(height, to); y += 2) {
  const buckets = new Set();
  let r = 0, g = 0, b = 0, n = 0;
  for (let x = 0; x < width; x += 2) {
    const [pr, pg, pb] = px(x, y);
    r += pr; g += pg; b += pb; n++;
    buckets.add((pr >> 3) * 1024 + (pg >> 3) * 32 + (pb >> 3));
  }
  console.log(`y=${y}\t${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}\tuniq=${buckets.size}`);
}
