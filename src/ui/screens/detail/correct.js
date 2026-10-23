// 字详情里改判（D66 ④；P5-01）：记录格放大弹层里的「改为写错 / 写对」。
//
// 与结果页（result/index.js correctResultInDraft）、写字页（write/result-row.js correctInDraft）同一套规则：同一条记录只改 judgment、
// 追加 corrections（core/records.correctRecord），不增加记录；撤销规则也一样——没有撤销条，弹层里的按钮反过来再点一次就改回去。
// 区别只在调度重算：结果页 / 写字页靠本会话的 fsrsBefore；字详情多半在会话清掉之后改，重算见 core/correct.js（会话还留着 fsrsBefore 就用，否则从空卡重放）。
// 改判后字库三档、首页、下次练习日同步：它们都从记录与 sched 实时算，不另存。
// B3.7：提交函数挪到 src/session/ops/detail.js（App API 与网页页面共用同一批函数），这里原样转出。
import { CORRECT_LABEL, canCorrectHere, correctRecordInDraft, commitCorrectRecord } from '../../../session/ops/detail.js';

export { CORRECT_LABEL, canCorrectHere, correctRecordInDraft, commitCorrectRecord };
