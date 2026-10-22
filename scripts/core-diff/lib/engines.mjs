// 按名字开引擎（B4.0）：js | js-cli | swift，名字后可带「~故障名」（仅 js / js-cli，自检用）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsEngine } from './js-engine.mjs';
import { inProcess, subprocess } from './transport.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PACKAGE_DIR = path.join(ROOT, 'ios/ShiziCore');
const JS_CLI = path.join(ROOT, 'scripts/core-diff/js-cli.mjs');

/** 已编好的 shizi-core-cli（先 release 后 debug）；没有返回 null。 */
export function swiftBin(explicit = null) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  for (const conf of ['release', 'debug']) {
    const p = path.join(PACKAGE_DIR, '.build', conf, 'shizi-core-cli');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function openEngine(spec, { swiftPath = null } = {}) {
  const [kind, fault = null] = spec.split('~');
  const env = { ...process.env };
  if (kind === 'js') return inProcess(createJsEngine({ fault }));
  if (kind === 'js-cli') return subprocess(spec, process.execPath, [JS_CLI, ...(fault ? ['--fault', fault] : [])], { env });
  if (kind === 'swift') {
    const bin = swiftBin(swiftPath);
    if (!bin) throw new Error('shizi-core-cli 未编译：swift build -c release --package-path ios/ShiziCore');
    return subprocess('swift', bin, [], { env });
  }
  throw new Error('unknown engine: ' + spec);
}
