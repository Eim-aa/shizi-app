// 把参考实现对 vectors.json 每条向量的输出摘成一份可逐值比对的 JSON（P1-S2 原生书写面 spike 用）。
// 原生端（ios/ShiziApp/ShiziApp/InkModelCheck.swift）除了照 check.mjs 同口径断言外，还拿它与参考实现逐值比较：
//   final：弧长、样本数、u = 0…1 每 0.01 的宽度、并集面积、端帽、钩、折角数、v30、洇墨数、多边形数；
//   live：前 60% 原始点、final=false（书写中、预混收笔）的同一组量——验证实时路径与参考实现一致。
// 用法：node dump-reference.mjs  → out/reference-dump.json（参数或向量变了就重跑，并随向量一起提交）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, geometry, unionArea, widthAt, MODEL_VERSION } from './reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));

const r9 = x => (x === null || x === undefined ? null : Number(x.toPrecision(12)));

function summary(points, opts) {
  const pr = analyze(points, opts);
  const geom = geometry(pr);
  const w = [];
  for (let i = 0; i <= 100; i += 1) w.push(r9(widthAt(pr, (i / 100) * pr.len)));
  return {
    len: r9(pr.len),
    n: pr.samples.length,
    w,
    area: r9(unionArea(geom, 0.1)),
    polys: geom.polys.length,
    capStart: pr.caps.start.type,
    capEnd: pr.caps.end.type,
    hook: !!pr.hook,
    corners: pr.corners.length,
    v30: r9(pr.v30),
    blooms: pr.blooms.length,
  };
}

const out = { model: MODEL_VERSION, paramsVersion: doc.paramsVersion, generatedBy: 'dump-reference.mjs', vectors: [] };
for (const v of doc.vectors) {
  const cut = Math.max(3, Math.floor(v.points.length * 0.6));
  out.vectors.push({ id: v.id, final: summary(v.points, {}), live: summary(v.points.slice(0, cut), { final: false }), liveCut: cut });
}
writeFileSync(join(HERE, 'out', 'reference-dump.json'), JSON.stringify(out) + '\n');
console.log(`reference-dump.json: ${out.vectors.length} vectors`);
