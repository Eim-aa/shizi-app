#!/usr/bin/env python3
"""Aggregate anonymous local funnel metrics from user-exported Shizi backups."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from statistics import median
from typing import Any, Iterable


OPEN_KEY = "shizi.opens.v1"
FUNNEL_KEY = "shizi.funnel.v1"
# 单组时长上限：后台挂起/中途放置会让墙钟计时虚高，超过此值的组不计入均值/中位数。
MAX_ROUND_MS = 60 * 60 * 1000


def stored_json(data: dict[str, Any], key: str, default: Any) -> Any:
    value = data.get(key)
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value if value is not None else default


def day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def input_files(paths: Iterable[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            files.extend(sorted(path.glob("*.json")))
        else:
            files.append(path)
    return list(dict.fromkeys(path.resolve() for path in files))


def load_backup(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("app") != "shizi" or not isinstance(payload.get("data"), dict):
        raise ValueError("not a Shizi backup")
    return payload


def has_event(funnel: dict[str, Any], name: str) -> bool:
    events = funnel.get("events")
    if not isinstance(events, list):
        return False
    return any(isinstance(row, dict) and row.get("name") == name for row in events)


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def safe_int(value: Any, default: int = 0) -> int:
    """把可能被篡改/损坏的字段安全转成 int，异常时回退默认值而非抛出。"""
    try:
        result = int(value)
    except (TypeError, ValueError):
        return default
    return result if result >= 0 else default


def summarize(backups: list[dict[str, Any]], invalid: int = 0) -> dict[str, Any]:
    d1_eligible = d1_returned = d7_eligible = d7_returned = 0
    funnel_samples = welcome = card1 = calibrated = 0
    compared = disagreed = 0
    durations: list[int] = []
    skipped = 0

    for payload in backups:
        # 单份内容损坏/被篡改的备份不应中断整批汇总（对齐加载阶段对坏文件的韧性）。
        try:
            data = payload["data"]
            raw_opens = stored_json(data, OPEN_KEY, [])
            opens = sorted({value for value in raw_opens if day(value)}) if isinstance(raw_opens, list) else []
            if opens:
                first, observed = day(opens[0]), day(opens[-1])
                opened = {day(value) for value in opens}
                if first and observed:
                    d1 = first + timedelta(days=1)
                    d7 = first + timedelta(days=7)
                    if observed >= d1:
                        d1_eligible += 1
                        d1_returned += int(d1 in opened)
                    if observed >= d7:
                        d7_eligible += 1
                        d7_returned += int(d7 in opened)

            funnel = stored_json(data, FUNNEL_KEY, None)
            if not isinstance(funnel, dict) or funnel.get("version") != 1:
                continue
            funnel_samples += 1
            welcome += int(has_event(funnel, "welcome_shown"))
            card1 += int(has_event(funnel, "calib_card1_done"))
            calibrated += int(has_event(funnel, "calib_completed"))
            counts = funnel.get("counts") if isinstance(funnel.get("counts"), dict) else {}
            compared += max(0, safe_int(counts.get("revealCompared")))
            disagreed += max(0, safe_int(counts.get("revealDisagree")))
            rounds = funnel.get("rounds")
            if isinstance(rounds, list):
                for row in rounds:
                    # 校准组结构性更慢且不受时间预算封顶，排除出常规练习均值。
                    if not isinstance(row, dict) or row.get("mode") == "calibrate":
                        continue
                    duration = row.get("durationMs")
                    if isinstance(duration, (int, float)) and 0 <= duration <= MAX_ROUND_MS:
                        durations.append(int(duration))
        except Exception as error:  # noqa: BLE001 - 坏备份跳过并计数，不中断整批
            skipped += 1
            print(f"跳过内容异常的备份 {payload.get('__path__', '?')}: {error}", file=sys.stderr)

    round_count = len(durations)
    return {
        "files": {"valid": len(backups), "invalid": invalid, "skipped": skipped, "with_funnel": funnel_samples},
        "retention": {
            "d1": {"returned": d1_returned, "eligible": d1_eligible, "rate": rate(d1_returned, d1_eligible)},
            "d7": {"returned": d7_returned, "eligible": d7_eligible, "rate": rate(d7_returned, d7_eligible)},
        },
        "calibration": {
            "welcome_shown": welcome,
            "card1_done": card1,
            "completed": calibrated,
            "card1_rate": rate(card1, welcome),
            "completion_rate": rate(calibrated, welcome),
        },
        "system_comparison": {
            "compared": compared,
            "disagreed": disagreed,
            "disagreement_rate": rate(disagreed, compared),
        },
        "rounds": {
            "completed": round_count,
            "average_duration_seconds": round(sum(durations) / round_count / 1000, 1) if round_count else None,
            "median_duration_seconds": round(median(durations) / 1000, 1) if round_count else None,
        },
    }


def percent(value: float | None) -> str:
    return "样本不足" if value is None else f"{value * 100:.1f}%"


def print_human(summary: dict[str, Any]) -> None:
    files = summary["files"]
    d1, d7 = summary["retention"]["d1"], summary["retention"]["d7"]
    calibration = summary["calibration"]
    comparison = summary["system_comparison"]
    rounds = summary["rounds"]
    print(f"有效备份 {files['valid']} 份（含本地漏斗 {files['with_funnel']} 份，无效 {files['invalid']} 份，内容异常跳过 {files.get('skipped', 0)} 份）")
    print(f"D1 回访：{d1['returned']}/{d1['eligible']} · {percent(d1['rate'])}")
    print(f"D7 回访：{d7['returned']}/{d7['eligible']} · {percent(d7['rate'])}")
    print(f"校准首卡：{calibration['card1_done']}/{calibration['welcome_shown']} · {percent(calibration['card1_rate'])}")
    print(f"校准完成：{calibration['completed']}/{calibration['welcome_shown']} · {percent(calibration['completion_rate'])}")
    print(f"系统-用户分歧：{comparison['disagreed']}/{comparison['compared']} · {percent(comparison['disagreement_rate'])}")
    average = rounds["average_duration_seconds"]
    median_seconds = rounds.get("median_duration_seconds")
    average_text = f"{average} 秒" if average is not None else "样本不足"
    median_text = f" · 中位 {median_seconds} 秒" if median_seconds is not None else ""
    print(f"完整组时长（不含校准）：{rounds['completed']} 组 · 平均 {average_text}{median_text}")


def main() -> int:
    parser = argparse.ArgumentParser(description="汇总一批拾字备份中的本地漏斗指标")
    parser.add_argument("paths", nargs="+", help="备份 JSON 文件或只含备份的目录；每位测试者请保留最新一份")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读 JSON")
    args = parser.parse_args()

    backups: list[dict[str, Any]] = []
    invalid = 0
    for path in input_files(args.paths):
        try:
            backup = load_backup(path)
            backup["__path__"] = str(path)
            backups.append(backup)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            invalid += 1
            print(f"跳过 {path}: {error}", file=sys.stderr)
    if not backups:
        print("没有可汇总的有效拾字备份。", file=sys.stderr)
        return 2

    summary = summarize(backups, invalid)
    if args.as_json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print_human(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
