#!/usr/bin/env python3
"""scripts/summarize_backups.py 的回归门禁。

这个脚本是"拾字到底有没有用"的唯一读数来源，却一直没有任何自动覆盖。
这里用一支手算过的合成队列钉死每一个读数，并单独跑一轮敌意备份证明韧性。

队列刻意包含一个"打开过一次就再没回来"的人（B）：旧口径会把他从分母里删掉，
于是 D1 显示 100%；新口径把他算进去，D1 是 66.7%。两个数并列出现才说明问题。
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARIZE = ROOT / "scripts" / "summarize_backups.py"

failures: list[str] = []


def note(message: str) -> None:
    print(f"[backup-summary] {message}")


def check(condition: bool, message: str, details: object = None) -> None:
    if not condition:
        failures.append(f"{message}{'' if details is None else f': {details!r}'}")


def equal(actual: object, expected: object, label: str) -> None:
    check(actual == expected, f"{label} 与手算值不符", {"expected": expected, "actual": actual})


def ms(day: str, hour: int = 12) -> int:
    """本地日折算成毫秒。取正午，避开任何时区边界上的歧义。"""
    stamp = datetime.fromisoformat(day).replace(hour=hour, tzinfo=timezone.utc)
    return int(stamp.timestamp() * 1000)


def envelope(date: object, data: dict[str, object]) -> dict[str, object]:
    return {"app": "shizi", "version": 1, "date": date,
            "data": {key: json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
                     for key, value in data.items()}}


# ── 甲：练了、拾回过、拍过字、手动收过字，观察窗完全走满 ──────────────────
PERSON_A_OPENS = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-08",
                  "2026-01-20", "2026-01-25", "2026-01-27"]
PERSON_A = envelope("2026-05-01T09:00:00.000Z", {
    "shizi.opens.v1": PERSON_A_OPENS,
    "shizi.memory.v1": {
        # fast>0 = 独立写出过；地/人 练过但没独立写出，属"仍待拾回"
        "base:天": {"target": "天", "seen": 5, "fast": 2, "firstSeenAt": ms("2026-03-01")},
        "base:地": {"target": "地", "seen": 3, "fast": 0, "misses": 2,
                    "firstSeenAt": ms("2026-03-02"), "source": "wild", "wildDay": "2026-03-10"},
        "base:人": {"target": "人", "seen": 1, "fast": 0, "hints": 1, "firstSeenAt": ms("2026-03-15")},
        # 首次接触早于 120 天原始事件窗口 → 间隔中位数必须排除它
        "base:山": {"target": "山", "seen": 4, "fast": 1, "firstSeenAt": ms("2025-06-01")},
    },
    "shizi.fsrsReviewLog.v1": {"version": 2, "monthly": {}, "events": [
        {"cardKey": "base:天", "localDay": "2026-03-01", "rating": "Again", "reviewedAt": "2026-03-01T01:00:00.000Z"},
        {"cardKey": "base:天", "localDay": "2026-03-05", "rating": "Good", "reviewedAt": "2026-03-05T01:00:00.000Z"},
        # 首次独立写出满 30 天后再遇仍 Good = 真正拾回
        {"cardKey": "base:天", "localDay": "2026-04-10", "rating": "Good", "reviewedAt": "2026-04-10T01:00:00.000Z"},
        {"cardKey": "base:地", "localDay": "2026-03-02", "rating": "Again", "reviewedAt": "2026-03-02T01:00:00.000Z"},
        {"cardKey": "base:山", "localDay": "2026-02-01", "rating": "Good", "reviewedAt": "2026-02-01T01:00:00.000Z"},
    ]},
    "shizi.wild.v1": {"version": 1, "wishes": {},
                      "captures": {"天": {"day": "2026-03-01", "at": ms("2026-03-01")}}},
    "shizi.added.v1": ["人"],
    "shizi.activity.v1": {"version": 2, "daily": {}, "monthly": {}, "practiceDays": PERSON_A_OPENS},
    "shizi.funnel.v1": {"version": 2, "events": [], "rounds": [],
                        "eventCounts": {"welcome_shown": 1, "calib_card1_done": 1, "calib_completed": 1,
                                        "d2_return": 1, "backup_exported": 1},
                        "counts": {"revealCompared": 10, "revealDisagree": 2},
                        "roundTotals": {"count": 3, "durationMs": 300000,
                                        "byMode": {"new": {"count": 3, "durationMs": 300000}}}},
})

# ── 乙：装完打开一次就再没回来。观察窗早已走满，必须留在分母里记 0 ──────────
PERSON_B = envelope("2026-04-01T00:00:00.000Z", {
    "shizi.opens.v1": ["2026-02-01"],
    "shizi.memory.v1": {},
    "shizi.activity.v1": {"version": 2, "daily": {}, "monthly": {}, "practiceDays": []},
})

# ── 丙：两天前刚装。右删失，进 D1 但不进 D7，也不进任何直方图 ───────────────
PERSON_C = envelope("2026-06-03T00:00:00.000Z", {"shizi.opens.v1": ["2026-06-01", "2026-06-02"]})


def run(paths: list[Path], *extra: str) -> tuple[int, str, str]:
    proc = subprocess.run([sys.executable, str(SUMMARIZE), *[str(p) for p in paths], *extra],
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def write(directory: Path, name: str, payload: object) -> Path:
    path = directory / name
    path.write_text(payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False),
                    encoding="utf-8")
    return path


def verify_cohort(directory: Path) -> None:
    for name, person in (("jia.json", PERSON_A), ("yi.json", PERSON_B), ("bing.json", PERSON_C)):
        write(directory, name, person)
    code, out, err = run([directory], "--json")
    check(code == 0, "合成队列汇总应当成功退出", {"code": code, "stderr": err[-400:]})
    if code != 0:
        return
    s = json.loads(out)

    equal(s["files"], {"valid": 3, "invalid": 0, "skipped": 0, "with_funnel": 1}, "files")

    r = s["retention"]
    # 乙只打开过一天：旧口径把他删失掉，D1 于是显示 100%
    equal(r["d1"], {"returned": 2, "eligible": 3, "rate": 0.6667}, "D1 单日")
    equal(r["d7"], {"returned": 1, "eligible": 2, "rate": 0.5}, "D7 单日")
    equal(r["d1_window"], {"returned": 2, "eligible": 3, "rate": 0.6667, "days": [1, 2]}, "D1 区间")
    equal(r["d7_window"], {"returned": 1, "eligible": 2, "rate": 0.5, "days": [5, 9]}, "D7 区间")
    equal(r["d1_legacy_denominator"], {"returned": 2, "eligible": 2, "rate": 1.0}, "D1 旧分母")
    check(r["d1_legacy_denominator"]["rate"] > r["d1"]["rate"],
          "旧分母必须比修正后的分母更乐观，否则这条对照就没有意义")

    e = s["efficacy"]
    equal(e["people"], 3, "疗效样本人数")
    equal((e["practiced_total"], e["independent_total"], e["pending_total"]), (4, 2, 2), "练过/独立写出/待拾回")
    equal(e["independent_share"], 0.5, "独立写出占比")
    equal(e["first_independent_lag_days"], {"median": 4, "cards": 1, "excluded_before_window": 1}, "首次独立写出间隔")
    equal(e["recovered"], {"cards": 1, "eligible": 1, "rate": 1.0, "lag_days": 30, "window_days": 120}, "真正拾回")

    equal(s["wild"], {"people": 1, "share": 0.3333, "chars_total": 2,
                      "chars_per_person": 0.7, "first_day_index_median": 59}, "野外拾字")
    equal(s["added"], {"people": 1, "share": 0.3333, "chars_total": 1,
                       "chars_per_person": 0.3, "first_day_index_median": 73}, "手动收字")

    # 甲首 14 天练 4 天 → 3-6；首 28 天练 7 天 → 7-13。乙两个窗口都是 0。丙窗口没走满，两边都不进。
    equal(s["practice_days"]["14"], {"eligible": 2, "buckets": {"0": 1, "1-2": 0, "3-6": 1, "7-13": 0, "14+": 0}}, "首 14 天直方图")
    equal(s["practice_days"]["28"], {"eligible": 2, "buckets": {"0": 1, "1-2": 0, "3-6": 0, "7-13": 1, "14+": 0}}, "首 28 天直方图")

    equal(s["funnel_events"], {"d2_return": 1, "backup_exported": 1}, "此前从未打印过的两个事件")
    equal(s["rounds"]["completed"], 3, "完整组数")

    code, human, _ = run([directory])
    check(code == 0, "人类可读输出应当成功退出")
    for phrase in ("样本偏差声明", "未回传者", "疗效", "野外拾字", "练习日数直方图",
                   "真正拾回", "次日回访事件", "导出过备份", "旧口径分母"):
        check(phrase in human, f"人类可读输出缺少「{phrase}」")
    note("合成队列 3 人：每项读数与手算一致，旧/新分母差异已并列输出")


def verify_roster(directory: Path) -> None:
    roster = directory / "roster.txt"
    roster.write_text("# 记名队列\njia\nyi\nbing\nding\n", encoding="utf-8")
    code, out, _ = run([directory / "jia.json", directory / "yi.json", directory / "bing.json"],
                       "--json", "--roster", str(roster))
    check(code == 0, "带名册的汇总应当成功退出")
    if code == 0:
        equal(json.loads(out)["sample_bias"]["roster"],
              {"roster": 4, "returned": 3, "missing": 1}, "名册口径")
        note("名册口径：4 人在册、3 人回传、1 人未回传按流失计")


def verify_hostile(directory: Path) -> None:
    write(directory, "a-broken.json", "{ this is not json")
    write(directory, "b-wrong-app.json", {"app": "other", "data": {}})
    write(directory, "c-data-not-dict.json", {"app": "shizi", "data": "nope"})
    # 信封合法、每个字段都被做过手脚：必须逐字段降级，而不是整份丢掉或炸掉
    write(directory, "d-hostile.json", json.dumps({
        "app": "shizi", "version": 1, "date": 12345,
        "data": {
            "shizi.opens.v1": '{"x":1}',
            # 1e309 在 JSON 里解析成 inf，int(inf) 抛 OverflowError
            "shizi.memory.v1": '{"base:天":{"target":"天","seen":1e309,"fast":1e309,"firstSeenAt":1e309}}',
            "shizi.fsrsReviewLog.v1": '{"events":"nope"}',
            "shizi.activity.v1": '"a string"',
            "shizi.wild.v1": '{"captures":[1,2]}',
            "shizi.added.v1": '12',
            "shizi.funnel.v1": '{"version":9}',
        },
    }))
    write(directory, "e-null-rows.json", json.dumps({
        "app": "shizi", "version": 1, "date": "2026-05-01T00:00:00.000Z",
        "data": {
            "shizi.opens.v1": '["2026-01-01", null, 42, "not-a-day"]',
            "shizi.memory.v1": '{"base:天": null, "base:地": [], "base:人": {"seen": -3}}',
            "shizi.fsrsReviewLog.v1": '[{"cardKey": null, "localDay": "2026-01-02", "rating": "Good"}, null]',
            "shizi.activity.v1": '{"practiceDays": [null, "2026-01-01", {"a": 1}]}',
            "shizi.wild.v1": '{"captures": {"天": null, "地": {"day": "nope"}}}',
            "shizi.added.v1": '[null, "", "人"]',
        },
    }))
    write(directory, "f-good.json", PERSON_A)

    code, out, err = run([directory], "--json")
    check(code == 0, "敌意备份不得让整批汇总失败", {"code": code, "stderr": err[-400:]})
    if code != 0:
        return
    s = json.loads(out)
    equal(s["files"]["invalid"], 3, "无效信封计数")
    equal(s["files"]["valid"], 3, "有效备份计数")
    equal(s["files"]["skipped"], 0, "内容异常但信封合法的备份不该被整份丢掉")
    # inf 被降级成 0，所以敌意那份不贡献任何"练过"
    equal(s["efficacy"]["practiced_total"], 4, "敌意备份不得虚增疗效读数")
    equal(s["sample_bias"]["backups_without_export_date"], 1, "缺导出日期的备份必须被点名")
    equal(s["sample_bias"]["backups_without_open_history"], 1, "没有打开历史的备份必须被点名")
    note("敌意备份 5 份：3 份信封无效、2 份逐字段降级，无一崩溃或虚增读数")


def main() -> int:
    check(SUMMARIZE.exists(), "找不到 scripts/summarize_backups.py")
    if SUMMARIZE.exists():
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            verify_cohort(directory)
            verify_roster(directory)
        with tempfile.TemporaryDirectory() as raw:
            verify_hostile(Path(raw))
    if failures:
        for item in failures:
            print(f"[backup-summary] 失败：{item}", file=sys.stderr)
        return 1
    note("汇总脚本回归通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
