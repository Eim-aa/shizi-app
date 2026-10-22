// 按 '\n' 切行（B4.0）。不用 node:readline：它把 U+2028 / U+2029 也当换行，而 JSON.stringify 不转义这两个字符，
// 协议规定只有 '\n' 是行尾（Swift 端 readLine 同样只认 '\n' / '\r\n'；协议行里不会出现裸 '\r'）。
import { StringDecoder } from 'node:string_decoder';

export function onLines(stream, fn) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  stream.on('data', (chunk) => {
    buf += decoder.write(chunk);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      fn(line);
    }
  });
  stream.on('end', () => {
    buf += decoder.end();
    if (buf) fn(buf);
    buf = '';
  });
}
