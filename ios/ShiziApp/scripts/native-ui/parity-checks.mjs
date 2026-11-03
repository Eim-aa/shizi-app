// QA-H1 具名检查的聚合（B3.3 起检查按屏分文件：checks/<屏>.mjs 各自 export CHECKS / COVERED_ELSEWHERE，registry.mjs 按文件名顺序合并）。
// status / eval 的约定见 checks/write.mjs 文件头；页面卡只加自己的 checks/<屏>.mjs。
import { loadChecks } from './registry.mjs';

export const { CHECKS, COVERED_ELSEWHERE } = await loadChecks();
