// B4.7：影子比对汇总（verify-native-ui.sh ENGINE=shadow）。读 <dir>/s*/<启动>.json（App 写的 ShadowEngine 统计），写 shadow.md；
// 第一行打到 stdout（进 summary.md）。有任何 mismatch（或一份统计都没收到）退出码 1。
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, outFile] = process.argv.slice(2);
const files = [];
if (dir && existsSync(dir)) {
  for (const s of readdirSync(dir)) {
    const d = join(dir, s);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) if (f.endsWith('.json')) files.push(join(d, f));
  }
}
const total = { launches: 0, ops: 0, groups: 0, mismatches: 0, skipped: 0, unanswered: 0, sounds: 0 };
const bad = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { bad.push({ file: f, kind: 'unreadable' }); continue; }
  total.launches += 1;
  for (const k of ["ops", "groups", "mismatches", "skipped", "unanswered", "sounds"]) total[k] += Number(j[k]) || 0;
  if (j.mismatches > 0) bad.push({ file: f, recent: j.recent || [j.first] });
}
const line = `shadow: ${total.ops} ops compared in ${total.groups} groups over ${total.launches} launches, ${total.mismatches} mismatches, ${total.skipped} skipped, ${total.unanswered} unanswered, ${total.sounds} sounds`;
const md = ['# 影子比对（B4.7）', '', `- ${line}`, ''];
for (const b of bad) {
  md.push(`## ${b.file}`, '');
  if (b.kind) md.push(`- ${b.kind}`);
  for (const m of b.recent || []) if (m) md.push(`- [${m.kind}] ${m.op} ${m.path}: web=${m.web} swift=${m.swift} args=${m.args}`);
  md.push('');
}
if (outFile) writeFileSync(outFile, md.join('\n'));
console.log(line);
process.exit(total.mismatches > 0 || total.launches === 0 || bad.some(b => b.kind) ? 1 : 0);
