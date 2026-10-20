// 逐个 spec 跑 e2e：每个 spec 单独进程、超时即结束该进程（只结束自己起的子进程组），失败或挂住重试一次。
// 一次跑完整套偶尔会挂住（page.evaluate(import()) 无响应），逐个跑可避免整套卡死。
// usage: node scripts/e2e/batch.mjs [filter...]      环境变量：LIMIT（每个 spec 秒数，缺省 300）、OUT（结果文件）、JOBS（并发，缺省 1）
import { spawn } from 'node:child_process';
import { readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const only = process.argv.slice(2);
const LIMIT = Number(process.env.LIMIT || 300) * 1000;
const JOBS = Math.max(1, Number(process.env.JOBS || 1));
const OUT = process.env.OUT || join(repo, '.review', 'e2e-batch.log');
writeFileSync(OUT, '');
const specs = readdirSync(join(repo, 'scripts/e2e')).filter(f => f.endsWith('.spec.js')).sort()
  .filter(f => !only.length || only.some(o => f.includes(o)));

function runOne(spec) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn('node', ['scripts/e2e/run.mjs', spec.replace(/\.spec\.js$/, '.spec')], { cwd: repo, detached: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, LIMIT);
    child.on('close', code => {
      clearTimeout(timer);
      const passed = (out.match(/^\s*(ok|PASS)\b/gm) || []).length;
      const fails = (out.match(/^\s*FAIL.*$/gm) || []).slice(0, 5).join(' | ');
      resolve({ spec, code: hung ? 'hung' : code, secs: Math.round((Date.now() - t0) / 1000), passed, hung, fails, tail: out.split('\n').slice(-15).join('\n') });
    });
  });
}

const bad = [];
let i = 0;
async function worker() {
  while (i < specs.length) {
    const spec = specs[i++];
    let r = await runOne(spec);
    if (r.code !== 0) {
      appendFileSync(OUT, 'RETRY ' + JSON.stringify({ spec, code: r.code, fails: r.fails }) + '\n');
      r = await runOne(spec);
    }
    if (r.code !== 0) { bad.push(spec); appendFileSync(OUT, `BAD ${JSON.stringify({ spec, code: r.code, secs: r.secs, fails: r.fails })}\n--- tail\n${r.tail}\n`); }
    else appendFileSync(OUT, `ok  ${JSON.stringify({ spec, secs: r.secs, passed: r.passed })}\n`);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
appendFileSync(OUT, `DONE specs=${specs.length} bad=${bad.length} ${JSON.stringify(bad)}\n`);
console.log(`DONE specs=${specs.length} bad=${bad.length} ${JSON.stringify(bad)} → ${OUT}`);
process.exit(bad.length ? 1 : 0);
