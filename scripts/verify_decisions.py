#!/usr/bin/env python3
"""DECISIONS.md 的防腐门禁。

#134 的诊断是「立规矩的能力很强，执行规矩的机制是零」。一个没人校对的决策日志
就是同一个失败模式再来一遍——#134 正文自己把盖章停留记成 1100ms，而代码里是
1800ms，恰好证明了这一点。

所以这里只做一件事：把 DECISIONS.md 里那些**可机器校对**的数字和口径，
逐条钉回代码。日志写错了会红，代码改了没同步日志也会红。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECISIONS = ROOT / "DECISIONS.md"
APP = ROOT / "index.html"

failures: list[str] = []


def check(condition: bool, message: str, details: object = None) -> None:
    if not condition:
        failures.append(f"{message}{'' if details is None else f': {details!r}'}")


def main() -> int:
    check(DECISIONS.exists(), "DECISIONS.md 不存在（#134 验收项）")
    if not DECISIONS.exists():
        print("[decisions] 失败：DECISIONS.md 不存在", file=sys.stderr)
        return 1
    log = DECISIONS.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")

    for heading in ("## 已生效", "## 待裁定"):
        check(heading in log, f"DECISIONS.md 缺少「{heading}」小节")

    # ① 盖章停留：日志里写的毫秒数必须就是代码里的常量
    hold = re.search(r"const STAMP_HOLD_MS=(\d+)", app)
    check(bool(hold), "index.html 里找不到 STAMP_HOLD_MS")
    if hold:
        check(f"**{hold.group(1)}ms**" in log,
              "DECISIONS.md 记的盖章停留与 STAMP_HOLD_MS 不一致", {"code": hold.group(1)})

    # ② 提醒默认关：只认显式 true
    check("r.enabled=r.enabled===true" in app,
          "提醒默认值变了：normalizeReminder 不再只认显式 true，DECISIONS.md 需同步改")

    # ③ 四库方案：id 与数量都钉死
    libraries = re.findall(r'\{id:"([a-zA-Z0-9]+)",name:', app)
    check(libraries == ["core3500", "adv3000", "rare", "curriculum2500"],
          "LIBRARIES 与 DECISIONS.md 记的四库方案不一致", {"actual": libraries})

    # ④ 全 App 只有一个「独立写出」口径：fast
    check('if(outcome==="fast"&&!row.independentTargetKeys.includes(targetKey))' in app,
          "independentTargetKeys 不再只认 fast，「独立写出」出现了第二个口径")
    check('const hard=outcome!=="fast"' in app,
          "FSRS Good 不再等价于 fast，「独立写出」口径已分叉")

    # ⑤ 待裁定项必须与现状同步：默认开就得挂在待裁定里，改成默认关就该移走
    prompt_defaults_on = "promptEnabled:value.promptEnabled!==false" in app
    listed = "「好字成卡提示」默认状态" in log.split("## 待裁定", 1)[-1]
    check(prompt_defaults_on == listed,
          "「好字成卡提示」的实际默认值与 DECISIONS.md 待裁定表不同步",
          {"代码默认开": prompt_defaults_on, "待裁定表里有": listed})

    if failures:
        for item in failures:
            print(f"[decisions] 失败：{item}", file=sys.stderr)
        return 1
    print(f"[decisions] DECISIONS.md 与代码一致：盖章停留 {hold.group(1)}ms、提醒默认关、"
          f"四库 {'/'.join(libraries)}、独立写出口径唯一")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
