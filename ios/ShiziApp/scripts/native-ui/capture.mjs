// QA-H1 逐屏取证（宿主一半）：在指定模拟器上按「外观 × 字号」逐轮启动 App（DEBUG 包，-shizi-qa parity），
// App 逐个状态注入并写元素清单，本脚本在每个状态落定后用 simctl 截图、写回执，最后把清单拷出来。
//
// usage: node capture.mjs --udid <模拟器> --ui native|web --out <目录> [--states a,b] [--appearances light,dark] [--sizes L,XXXL,AX3,AX5] [--scale 1]
//   输出：<out>/<状态>_<外观>_<字号>.png 与 .json（文件名 = 状态_外观_字号）
//   --states 缺省：web = 全部参考状态（夹具 parity != false），native = 原生已实现的状态（夹具 native: true；给了 --states 也只取这些里 native 的）
//   --sizes  缺省 L,XXXL；某一档只取「夹具要这一档」的状态（夹具 ax: true → 另有 AX3 / AX5；sizes 数组直接指定，registry.mjs sizesOf）
//   --scale：截图缩到几倍（1 = 逻辑点尺寸，参考图进仓库用；缺省 1）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REFERENCE_STATES, STATES, APPEARANCES, SIZES, SIZE_SIM, BUNDLE_ID, fixtureOf, sizesOf } from './config.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : acc), []));
const udid = args.udid;
const ui = args.ui || 'native';
const out = args.out;
let states = (args.states || (ui === 'web' ? REFERENCE_STATES : STATES).join(',')).split(',').filter(Boolean);
// 原生取证只取原生页已实现的状态（夹具 native: true）；其余只有网页参考
if (ui === 'native') states = states.filter(s => !fixtureOf[s] || fixtureOf[s].native === true);
const appearances = (args.appearances || APPEARANCES.join(',')).split(',');
const sizes = (args.sizes || SIZES.join(',')).split(',');
const scale = Number(args.scale || 1);
const CHUNK = Number(args.chunk || 30);
if (!udid || !out) {
  console.error('usage: node capture.mjs --udid <udid> --ui native|web --out <dir>');
  process.exit(2);
}
for (const s of states) if (!fixtureOf[s]) { console.error(`unknown state "${s}" (no ShiziUITests/States/${s}.json)`); process.exit(2); }
mkdirSync(out, { recursive: true });

const sim = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function container() {
  return sim('get_app_container', udid, BUNDLE_ID, 'data');
}

async function round(appearance, size, roundStates) {
  const tag = `${appearance}_${size}`;
  sim('ui', udid, 'appearance', appearance);
  sim('ui', udid, 'content_size', SIZE_SIM[size]);
  try { sim('terminate', udid, BUNDLE_ID); } catch {}
  const qa = join(container(), 'Documents', 'qa');
  rmSync(qa, { recursive: true, force: true });
  mkdirSync(qa, { recursive: true });
  await sleep(600);
  sim('launch', udid, BUNDLE_ID, '-shizi-test-host', ui === 'native' ? '-shizi-native-write' : '-shizi-native-write-off',
    '-shizi-qa', 'parity', '-shizi-qa-ui', ui, '-shizi-qa-states', roundStates.join(','), '-shizi-qa-tag', tag);
  let seen = -1;
  const t0 = Date.now();
  while (!existsSync(join(qa, 'done'))) {
    if (Date.now() - t0 > 60_000 + roundStates.length * 20_000) throw new Error(`timeout in round ${tag} (last ${seen})`);
    const readyFile = join(qa, 'ready');
    if (existsSync(readyFile)) {
      const [iStr, state] = readFileSync(readyFile, 'utf8').trim().split(' ');
      const i = Number(iStr);
      if (i > seen) {
        const png = join(out, `${state}_${tag}.png`);
        sim('io', udid, 'screenshot', '--type=png', png);
        if (scale !== 0) {
          // 缩到 scale 倍逻辑点（参考图进仓库：1 倍）
          const json = JSON.parse(readFileSync(join(qa, ui, `${state}_${tag}.json`), 'utf8'));
          const w = Math.round(json.screen.w * scale);
          if (w > 0) execFileSync('sips', ['--resampleWidth', String(w), png], { stdio: 'ignore' });
        }
        seen = i;
        writeFileSync(join(qa, `ack-${i}`), 'ok');
        process.stdout.write(`  ${ui} ${tag} ${state}\n`);
      }
    }
    await sleep(120);
  }
  for (const f of readdirSync(join(qa, ui))) copyFileSync(join(qa, ui, f), join(out, f));
  try { sim('terminate', udid, BUNDLE_ID); } catch {}
}

sim('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100');
let shots = 0;
for (const appearance of appearances) {
  for (const size of sizes) {
    const roundStates = states.filter(s => sizesOf(fixtureOf[s]).includes(size));
    if (!roundStates.length) continue;
    // 每次启动最多 CHUNK 个状态：App 中途出问题只丢这一小段，重跑也快
    for (let i = 0; i < roundStates.length; i += CHUNK) await round(appearance, size, roundStates.slice(i, i + CHUNK));
    shots += roundStates.length;
  }
}
sim('ui', udid, 'appearance', 'light');
sim('ui', udid, 'content_size', 'large');
console.log(`captured ${ui}: ${states.length} states, ${shots} screens (${appearances.join('/')} × ${sizes.join('/')}) → ${out}`);
