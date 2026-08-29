#!/usr/bin/env python3
"""Aggregate anonymous local funnel metrics from user-exported Shizi backups."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Iterable


OPEN_KEY = "shizi.opens.v1"
FUNNEL_KEY = "shizi.funnel.v1"
MEMORY_KEY = "shizi.memory.v1"
ACTIVITY_KEY = "shizi.activity.v1"
WILD_KEY = "shizi.wild.v1"
ADDED_KEY = "shizi.added.v1"
FSRS_LOG_KEY = "shizi.fsrsReviewLog.v1"
# 单组时长上限：后台挂起/中途放置会让墙钟计时虚高，超过此值的组不计入均值/中位数。
MAX_ROUND_MS = 60 * 60 * 1000
# index.html 的 FSRS_RAW_RETENTION_DAYS：逐条复习事件只留 120 天，更早的被压成月度
# 汇总（月度行不含 cardKey）。所有"按天算间隔"的疗效读数都只在这个窗口内成立。
FSRS_RAW_RETENTION_DAYS = 120
# "真正拾回"的判据：首次独立写出之后至少隔这么多天再遇到，仍然独立写出。
RECOVERY_LAG_DAYS = 30
# 留存的区间口径（#130 D）：单日点估计对间隔重复产品会系统性低估。
D1_WINDOW = (1, 2)
D7_WINDOW = (5, 9)
# 练习日数直方图的分桶上界（#46 自己列过但一直没实现的那一项）。
PRACTICE_BUCKETS = ((0, 0), (1, 2), (3, 6), (7, 13), (14, None))


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
    event_counts = funnel.get("eventCounts")
    if isinstance(event_counts, dict) and isinstance(event_counts.get(name), (int, float)) and event_counts[name] > 0:
        return True
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
    except (TypeError, ValueError, OverflowError):
        # JSON 里的 1e309 会解析成 inf，int(inf) 抛 OverflowError；
        # 不接住的话一份被篡改的备份会把它自己整份丢掉。
        return default
    return result if result >= 0 else default


def backup_day(payload: dict[str, Any]) -> date | None:
    """备份导出日 = 这份样本的观察截止日。

    分母必须用它，不能用"最后一次打开"：只打开过一次就再没回来的人，
    正是最典型的流失者，用最后一次打开当观察终点会把他们从分母里删失掉。
    """
    text = payload.get("date")
    return day(str(text)[:10]) if isinstance(text, str) else None


def day_from_ms(value: Any) -> date | None:
    """毫秒时间戳 → 日期。

    存的是本机本地时刻，这里统一按 UTC 折算：跨机器可复现，代价是可能差一天。
    只用在"按天算间隔"的中位数上，±1 天不改变结论；输出里已声明这一点。
    """
    ms = safe_int(value)
    if ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()
    except (OverflowError, OSError, ValueError):
        return None


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def card_char(key: Any, record: dict[str, Any]) -> str:
    """cardKey 形如 base:字 / custom:字；memory 行里另存了 target 兜底。"""
    target = record.get("target")
    if isinstance(target, str) and len(target) == 1:
        return target
    text = str(key)
    tail = text.split(":", 1)[1] if ":" in text else text
    return tail if len(tail) == 1 else ""


def bucket_label(count: int) -> str:
    for low, high in PRACTICE_BUCKETS:
        if count >= low and (high is None or count <= high):
            return f"{low}" if low == high else (f"{low}+" if high is None else f"{low}-{high}")
    return "?"


def memory_rows(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = as_dict(stored_json(data, MEMORY_KEY, {}))
    return {key: row for key, row in rows.items() if isinstance(row, dict)}


def fsrs_events(data: dict[str, Any]) -> list[dict[str, Any]]:
    """逐条复习事件。v1 存成裸数组，v2 存成 {version,events,monthly}。"""
    stored = stored_json(data, FSRS_LOG_KEY, [])
    raw = stored if isinstance(stored, list) else as_list(as_dict(stored).get("events"))
    events = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        localday = day(row.get("localDay"))
        key = row.get("cardKey")
        if localday and isinstance(key, str):
            events.append({"cardKey": key, "day": localday, "good": row.get("rating") == "Good"})
    events.sort(key=lambda row: row["day"])
    return events


def wrote_independently(record: dict[str, Any]) -> bool:
    """全 App 只有一个"独立写出"口径：outcome==="fast"。

    它同时对应 FSRS rating "Good"、reason "independent" 与 activity 的
    independentTargetKeys（index.html:1284/1826）。slow 写出来了但不算独立，
    hinted 用了提示，miss 没写出来——三者都不计入。
    """
    return safe_int(record.get("fast")) > 0


def efficacy_for_person(data: dict[str, Any], horizon: date | None) -> dict[str, Any]:
    """A · 疗效：练过 / 独立写出 / 仍待拾回，外加两个按天算的间隔。"""
    rows = memory_rows(data)
    practiced = independent = 0
    for record in rows.values():
        if safe_int(record.get("seen")) <= 0:
            continue
        practiced += 1
        independent += int(wrote_independently(record))

    by_card: dict[str, list[dict[str, Any]]] = {}
    for event in fsrs_events(data):
        by_card.setdefault(event["cardKey"], []).append(event)
    first_good = {key: next((e["day"] for e in events if e["good"]), None) for key, events in by_card.items()}
    window_start = horizon - timedelta(days=FSRS_RAW_RETENTION_DAYS) if horizon else None

    lags: list[int] = []
    truncated = 0
    for key, record in rows.items():
        seen_day, good_day = day_from_ms(record.get("firstSeenAt")), first_good.get(key)
        if not seen_day or not good_day:
            continue
        # 首次接触早于原始事件窗口的卡，它真正的"首次独立写出"可能已被压缩掉，
        # 留下的最早 Good 会把间隔算长。整卡排除并单独计数，不混进中位数。
        if window_start and seen_day < window_start:
            truncated += 1
            continue
        lags.append(max(0, (good_day - seen_day).days))

    recoverable = recovered = 0
    for key, good_day in first_good.items():
        if not good_day or (window_start and good_day < window_start):
            continue
        cutoff = good_day + timedelta(days=RECOVERY_LAG_DAYS)
        later = [event for event in by_card[key] if event["day"] >= cutoff]
        if not later:
            continue
        recoverable += 1
        recovered += int(later[0]["good"])

    return {
        "practiced": practiced,
        "independent": independent,
        "pending": max(0, practiced - independent),
        "lags": lags,
        "lag_truncated": truncated,
        "recoverable": recoverable,
        "recovered": recovered,
    }


def wild_for_person(data: dict[str, Any], first_day: date | None) -> dict[str, Any]:
    """B · 野外拾字：拍字入盒。照片可能因配额被裁掉，所以 memory 那一路必须并进来。"""
    captures = as_dict(as_dict(stored_json(data, WILD_KEY, {})).get("captures"))
    chars: set[str] = set()
    days: list[date] = []
    for char, row in captures.items():
        if not isinstance(row, dict) or not isinstance(char, str):
            continue
        chars.add(char)
        stamped = day(row.get("day")) or day_from_ms(row.get("at"))
        if stamped:
            days.append(stamped)
    for key, record in memory_rows(data).items():
        if record.get("source") != "wild":
            continue
        char = card_char(key, record)
        if char:
            chars.add(char)
        stamped = day(record.get("wildDay"))
        if stamped:
            days.append(stamped)
    first = min(days) if days else None
    return {
        "chars": len(chars),
        "first_day_index": (first - first_day).days if first and first_day else None,
    }


def added_for_person(data: dict[str, Any], first_day: date | None) -> dict[str, Any]:
    """B · 手动收字。added.v1 只存字不存日期，首次发生日只能从 memory.firstSeenAt 推。"""
    chars = {value for value in as_list(stored_json(data, ADDED_KEY, [])) if isinstance(value, str) and value}
    days = [
        stamped
        for key, record in memory_rows(data).items()
        if card_char(key, record) in chars and (stamped := day_from_ms(record.get("firstSeenAt")))
    ]
    first = min(days) if days else None
    return {
        "chars": len(chars),
        "first_day_index": (first - first_day).days if first and first_day else None,
    }


def practice_days_for_person(data: dict[str, Any], first_day: date | None, horizon: date | None) -> dict[int, int | None]:
    """C · 首 14 / 28 天的实际练习日数。

    观察窗没走满的人返回 None——他们是右删失，不能当成"练了 0 天"塞进直方图。
    但窗口已走满、后来不再出现的人必须留在分母里记 0，那才是流失。
    """
    days = {stamped for stamped in (day(value) for value in as_list(as_dict(stored_json(data, ACTIVITY_KEY, {})).get("practiceDays"))) if stamped}
    out: dict[int, int | None] = {}
    for span in (14, 28):
        if not first_day or not horizon or (horizon - first_day).days < span - 1:
            out[span] = None
            continue
        end = first_day + timedelta(days=span - 1)
        out[span] = sum(1 for stamped in days if first_day <= stamped <= end)
    return out


def summarize(backups: list[dict[str, Any]], invalid: int = 0, roster: list[str] | None = None) -> dict[str, Any]:
    single = {"d1": [0, 0], "d7": [0, 0]}
    windowed = {"d1": [0, 0], "d7": [0, 0]}
    legacy = {"d1": [0, 0], "d7": [0, 0]}
    horizonless = 0
    funnel_samples = welcome = card1 = calibrated = 0
    compared = disagreed = 0
    durations: list[int] = []
    round_count = round_duration_ms = 0
    skipped = 0
    openless = 0
    d2_return = backup_exported = 0
    practiced_totals: list[int] = []
    independent_totals: list[int] = []
    pending_totals: list[int] = []
    all_lags: list[int] = []
    lag_truncated = recoverable = recovered = 0
    wild_people = wild_chars_total = 0
    wild_first: list[int] = []
    added_people = added_chars_total = 0
    added_first: list[int] = []
    histogram: dict[int, dict[str, int]] = {14: {}, 28: {}}
    histogram_eligible = {14: 0, 28: 0}

    for payload in backups:
        # 单份内容损坏/被篡改的备份不应中断整批汇总（对齐加载阶段对坏文件的韧性）。
        try:
            data = payload["data"]
            # 观察终点是信封的属性，先无条件记账：有没有打开历史是另一回事，
            # 两种缺失都会让这份样本悄悄退出按天锚定的读数，必须分别点名。
            exported = backup_day(payload)
            if exported is None:
                horizonless += 1
            raw_opens = stored_json(data, OPEN_KEY, [])
            opens = sorted({value for value in raw_opens if day(value)}) if isinstance(raw_opens, list) else []
            if not opens:
                openless += 1
            first_day = horizon = None
            if opens:
                first_day, observed = day(opens[0]), day(opens[-1])
                opened = {day(value) for value in opens}
                # 观察终点用备份导出日，不用最后一次打开：后者会把流失者从分母里删掉。
                horizon = exported or observed
                if first_day and observed and horizon:
                    for label, offset, (low, high) in (("d1", 1, D1_WINDOW), ("d7", 7, D7_WINDOW)):
                        exact = first_day + timedelta(days=offset)
                        start, end = first_day + timedelta(days=low), first_day + timedelta(days=high)
                        if horizon >= exact:
                            single[label][1] += 1
                            single[label][0] += int(exact in opened)
                        if horizon >= end:
                            windowed[label][1] += 1
                            windowed[label][0] += int(any(start <= value <= end for value in opened))
                        # 旧口径：分母是"最后一次打开 >= 首日+N"，并列输出用于对照差异。
                        if observed >= exact:
                            legacy[label][1] += 1
                            legacy[label][0] += int(exact in opened)

            efficacy = efficacy_for_person(data, horizon)
            practiced_totals.append(efficacy["practiced"])
            independent_totals.append(efficacy["independent"])
            pending_totals.append(efficacy["pending"])
            all_lags.extend(efficacy["lags"])
            lag_truncated += efficacy["lag_truncated"]
            recoverable += efficacy["recoverable"]
            recovered += efficacy["recovered"]

            wild = wild_for_person(data, first_day)
            wild_chars_total += wild["chars"]
            wild_people += int(wild["chars"] > 0)
            if wild["first_day_index"] is not None:
                wild_first.append(wild["first_day_index"])

            added = added_for_person(data, first_day)
            added_chars_total += added["chars"]
            added_people += int(added["chars"] > 0)
            if added["first_day_index"] is not None:
                added_first.append(added["first_day_index"])

            for span, count in practice_days_for_person(data, first_day, horizon).items():
                if count is None:
                    continue
                histogram_eligible[span] += 1
                label = bucket_label(count)
                histogram[span][label] = histogram[span].get(label, 0) + 1

            funnel = stored_json(data, FUNNEL_KEY, None)
            if not isinstance(funnel, dict) or funnel.get("version") not in (1, 2):
                continue
            funnel_samples += 1
            welcome += int(has_event(funnel, "welcome_shown"))
            card1 += int(has_event(funnel, "calib_card1_done"))
            calibrated += int(has_event(funnel, "calib_completed"))
            # 早就落盘、但从来没被汇总打印过的两个事件（#130 E）。
            d2_return += int(has_event(funnel, "d2_return"))
            backup_exported += int(has_event(funnel, "backup_exported"))
            counts = funnel.get("counts") if isinstance(funnel.get("counts"), dict) else {}
            compared += max(0, safe_int(counts.get("revealCompared")))
            disagreed += max(0, safe_int(counts.get("revealDisagree")))
            rounds = funnel.get("rounds")
            raw_round_count = raw_round_duration = 0
            if isinstance(rounds, list):
                for row in rounds:
                    # 校准组结构性更慢且不受时间预算封顶，排除出常规练习均值。
                    if not isinstance(row, dict) or row.get("mode") == "calibrate":
                        continue
                    duration = row.get("durationMs")
                    if isinstance(duration, (int, float)) and 0 <= duration <= MAX_ROUND_MS:
                        value = int(duration)
                        durations.append(value)
                        raw_round_count += 1
                        raw_round_duration += value
            totals = funnel.get("roundTotals") if funnel.get("version") == 2 and isinstance(funnel.get("roundTotals"), dict) else {}
            by_mode = totals.get("byMode") if isinstance(totals.get("byMode"), dict) else {}
            usable_modes = [row for mode, row in by_mode.items() if mode in ("new", "review", "focus", "makeup") and isinstance(row, dict)]
            if usable_modes:
                for row in usable_modes:
                    count = safe_int(row.get("count"))
                    duration = min(safe_int(row.get("durationMs")), count * MAX_ROUND_MS)
                    round_count += count
                    round_duration_ms += duration
            else:
                round_count += raw_round_count
                round_duration_ms += raw_round_duration
        except Exception as error:  # noqa: BLE001 - 坏备份跳过并计数，不中断整批
            skipped += 1
            print(f"跳过内容异常的备份 {payload.get('__path__', '?')}: {error}", file=sys.stderr)

    people = len(backups)
    returned_names = {Path(payload.get("__path__", "")).stem for payload in backups if payload.get("__path__")}
    roster_block = None
    if roster is not None:
        missing = [name for name in roster if name not in returned_names]
        roster_block = {"roster": len(roster), "returned": len(roster) - len(missing), "missing": len(missing)}

    def retention(bucket: dict[str, list[int]], label: str) -> dict[str, Any]:
        got, eligible = bucket[label]
        return {"returned": got, "eligible": eligible, "rate": rate(got, eligible)}

    return {
        "files": {"valid": len(backups), "invalid": invalid, "skipped": skipped, "with_funnel": funnel_samples},
        "sample_bias": {
            "self_selected": True,
            "opens_are_page_loads": True,
            "backups_without_export_date": horizonless,
            "backups_without_open_history": openless,
            "roster": roster_block,
        },
        "retention": {
            "d1": retention(single, "d1"),
            "d7": retention(single, "d7"),
            "d1_window": {**retention(windowed, "d1"), "days": list(D1_WINDOW)},
            "d7_window": {**retention(windowed, "d7"), "days": list(D7_WINDOW)},
            "d1_legacy_denominator": retention(legacy, "d1"),
            "d7_legacy_denominator": retention(legacy, "d7"),
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
            "average_duration_seconds": round(round_duration_ms / round_count / 1000, 1) if round_count else None,
            "median_duration_seconds": round(median(durations) / 1000, 1) if durations else None,
        },
        "efficacy": {
            "people": people,
            "practiced_total": sum(practiced_totals),
            "independent_total": sum(independent_totals),
            "pending_total": sum(pending_totals),
            "practiced_per_person": round(sum(practiced_totals) / people, 1) if people else None,
            "independent_per_person": round(sum(independent_totals) / people, 1) if people else None,
            "pending_per_person": round(sum(pending_totals) / people, 1) if people else None,
            "independent_share": rate(sum(independent_totals), sum(practiced_totals)),
            "first_independent_lag_days": {
                "median": round(median(all_lags), 1) if all_lags else None,
                "cards": len(all_lags),
                "excluded_before_window": lag_truncated,
            },
            "recovered": {
                "cards": recovered,
                "eligible": recoverable,
                "rate": rate(recovered, recoverable),
                "lag_days": RECOVERY_LAG_DAYS,
                "window_days": FSRS_RAW_RETENTION_DAYS,
            },
        },
        "wild": {
            "people": wild_people,
            "share": rate(wild_people, people),
            "chars_total": wild_chars_total,
            "chars_per_person": round(wild_chars_total / people, 1) if people else None,
            "first_day_index_median": round(median(wild_first), 1) if wild_first else None,
        },
        "added": {
            "people": added_people,
            "share": rate(added_people, people),
            "chars_total": added_chars_total,
            "chars_per_person": round(added_chars_total / people, 1) if people else None,
            "first_day_index_median": round(median(added_first), 1) if added_first else None,
        },
        "practice_days": {
            str(span): {
                "eligible": histogram_eligible[span],
                "buckets": {bucket_label(low): histogram[span].get(bucket_label(low), 0) for low, _ in PRACTICE_BUCKETS},
            }
            for span in (14, 28)
        },
        "funnel_events": {"d2_return": d2_return, "backup_exported": backup_exported},
    }


def percent(value: float | None) -> str:
    return "样本不足" if value is None else f"{value * 100:.1f}%"


def number(value: Any, suffix: str = "") -> str:
    return "样本不足" if value is None else f"{value}{suffix}"


def print_human(summary: dict[str, Any]) -> None:
    files = summary["files"]
    retention = summary["retention"]
    calibration = summary["calibration"]
    comparison = summary["system_comparison"]
    rounds = summary["rounds"]
    efficacy = summary["efficacy"]
    wild, added = summary["wild"], summary["added"]
    bias = summary["sample_bias"]

    print("样本偏差声明：本汇总只覆盖主动回传备份的人，未回传者（含装完即走）不在任何分母里；"
          "opens 记的是页面加载而非练习，含开发者本人的调试打开。")
    if bias.get("roster"):
        roster = bias["roster"]
        print(f"　名册 {roster['roster']} 人 · 回传 {roster['returned']} 人 · 未回传 {roster['missing']} 人（未回传按流失计，不进分母）")
    if bias.get("backups_without_export_date"):
        print(f"　{bias['backups_without_export_date']} 份备份没有导出日期，已退回用最后一次打开当观察终点（这部分仍有删失）")
    if bias.get("backups_without_open_history"):
        print(f"　{bias['backups_without_open_history']} 份备份没有可用的打开历史，已退出全部按天锚定的读数（留存、首次发生日、练习日数直方图）")
    print(f"有效备份 {files['valid']} 份（含本地漏斗 {files['with_funnel']} 份，无效 {files['invalid']} 份，内容异常跳过 {files.get('skipped', 0)} 份）")

    print("— 疗效（把手写能力练回来了吗）—")
    print(f"人均：练过 {number(efficacy['practiced_per_person'])} 字 · 独立写出 {number(efficacy['independent_per_person'])} 字 · 仍待拾回 {number(efficacy['pending_per_person'])} 字")
    print(f"独立写出占练过：{percent(efficacy['independent_share'])}（{efficacy['independent_total']}/{efficacy['practiced_total']}）")
    lag = efficacy["first_independent_lag_days"]
    print(f"首次接触 → 首次独立写出：中位 {number(lag['median'], ' 天')}（{lag['cards']} 张卡；{lag['excluded_before_window']} 张因早于原始事件窗口被排除）")
    recovered = efficacy["recovered"]
    print(f"真正拾回（首次独立写出满 {recovered['lag_days']} 天后再遇仍独立写出）：{recovered['cards']}/{recovered['eligible']} · {percent(recovered['rate'])}"
          f"（只在最近 {recovered['window_days']} 天的逐条事件窗口内可算）")

    print("— 野外拾字（这个痛在生活里真实发生吗）—")
    print(f"拍字入盒：{wild['people']}/{efficacy['people']} 人 · {percent(wild['share'])} · 人均 {number(wild['chars_per_person'])} 字 · 首次发生在第 {number(wild['first_day_index_median'])} 天（中位）")
    print(f"手动收字：{added['people']}/{efficacy['people']} 人 · {percent(added['share'])} · 人均 {number(added['chars_per_person'])} 字 · 首次发生在第 {number(added['first_day_index_median'])} 天（中位）")

    print("— 练习日数直方图（观察窗走满的人才进分母）—")
    for span in ("14", "28"):
        block = summary["practice_days"][span]
        cells = " · ".join(f"{label} 天：{count}" for label, count in block["buckets"].items())
        print(f"首 {span} 天（{block['eligible']} 人）：{cells}")

    print("— 留存 —")
    for label, name in (("d1", "D1"), ("d7", "D7")):
        exact, window = retention[label], retention[f"{label}_window"]
        low, high = window["days"]
        print(f"{name} 回访：单日 {exact['returned']}/{exact['eligible']} · {percent(exact['rate'])}"
              f"　｜　区间 +{low}~+{high} 天 {window['returned']}/{window['eligible']} · {percent(window['rate'])}")
        legacy_block = retention[f"{label}_legacy_denominator"]
        if legacy_block["eligible"] != exact["eligible"]:
            print(f"　（旧口径分母 {legacy_block['eligible']} 人：它把只打开过一次就流失的人删掉了，故偏高）")

    print("— 漏斗 —")
    print(f"校准首卡：{calibration['card1_done']}/{calibration['welcome_shown']} · {percent(calibration['card1_rate'])}")
    print(f"校准完成：{calibration['completed']}/{calibration['welcome_shown']} · {percent(calibration['completion_rate'])}")
    events = summary["funnel_events"]
    print(f"次日回访事件：{events['d2_return']} 人 · 导出过备份：{events['backup_exported']} 人")
    print(f"系统-用户分歧：{comparison['disagreed']}/{comparison['compared']} · {percent(comparison['disagreement_rate'])}")
    average = rounds["average_duration_seconds"]
    median_seconds = rounds.get("median_duration_seconds")
    average_text = f"{average} 秒" if average is not None else "样本不足"
    median_text = f" · 中位 {median_seconds} 秒" if median_seconds is not None else ""
    print(f"完整组时长（不含校准）：{rounds['completed']} 组 · 平均 {average_text}{median_text}")


def load_roster(path: str) -> list[str]:
    lines = Path(path).expanduser().read_text(encoding="utf-8").splitlines()
    names = [line.strip() for line in lines]
    return [name for name in names if name and not name.startswith("#")]


def main() -> int:
    parser = argparse.ArgumentParser(description="汇总一批拾字备份中的本地漏斗与疗效指标")
    parser.add_argument("paths", nargs="+", help="备份 JSON 文件或只含备份的目录；每位测试者请保留最新一份")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读 JSON")
    parser.add_argument("--roster", help="记名队列名册：一行一个标识，与备份文件名（去扩展名）对齐；名册里没回传的人计为流失")
    args = parser.parse_args()

    roster = None
    if args.roster:
        try:
            roster = load_roster(args.roster)
        except OSError as error:
            print(f"读不到名册 {args.roster}: {error}", file=sys.stderr)
            return 2

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

    summary = summarize(backups, invalid, roster)
    if args.as_json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print_human(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
