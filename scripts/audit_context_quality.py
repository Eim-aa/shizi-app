#!/usr/bin/env python3
"""语境词冷门率审计（#132 第一步）。

#105 的定性判断是对的——「用户不认识这个词，就无法确定要写的是哪个字，
哪怕他会写那个字」——但它从没被做成可复算的东西。这个脚本把它变成数字。

口径与 #132 公布的实测一致：冷门率 = 语境词 Zipf 词频 < 3.0 的卡占比。
同一套函数跑 4d6e8e5 的旧题库，能逐位复现 #132 的三个数
（一级 7.1% / 二级 83.3% / 三级 98.1%，中位 4.14 / 1.23 / 0.50）。

同时它会检查 `common` 字段本身还是不是 Zipf 词频——见 COMMONNESS_REGRESSION。
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DECK_PATH = ROOT / "deck-data.js"
BASELINE_PATH = ROOT / "scripts" / "fixtures" / "context-quality-baseline.json"

COLD_THRESHOLD = 3.0
NORM_LEVELS = ("一级", "二级", "三级")
RANK_BANDS = ((1, 500), (501, 1500), (1501, 3500), (3501, 6000), (6001, None))

COMMONNESS_REGRESSION = """\
`common` 字段已不是 Zipf 词频，冷门率无法计算。

build_8105_chars.py 顶部 `from wordfreq import ...` 失败时会把 zipf_frequency 置为
None，随后两条分支静默降级：dict 语境走 `1 + len(str(word_freq))`（整数 2–7），
fallback/override 语境走常数 0。题库在 c7c8fc2（2026-08-05）被重新生成时，
生成环境里没装 wordfreq，于是整份 deck 的 common 变成了这个代理值。

证据：common 没有任何小数，取值里没有 1，且 common==0 的卡数与 ctx!=dict 的卡数
完全相等。f9969e2（2026-07-28）的旧题库里 6206/6854 张卡的 common 还是小数。

影响：index.html 的 PREFS 用 common 做选卡权重（balanced 1 / practical 2.2 /
challenge 0.4），这些权重是按连续 Zipf 调的；现在全部 fallback/override 卡恒为 0。

修法：装好 wordfreq 后重新生成 deck-data.js，并同步 index.html 与 sw.js 里的
指纹。本脚本不做这件事——那是一份 2MB 的改动，会和在飞的 PR 全面冲突。"""


def load_cards(path: Path) -> list[dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    marker = "const SEED = "
    start = source.find(marker)
    end = source.find(";\n", start)
    if start < 0 or end < 0:
        raise SystemExit(f"{path} 里找不到 SEED")
    return json.loads(source[start + len(marker):end])


def commonness(card: dict[str, Any]) -> float:
    try:
        return float(card.get("common") or 0)
    except (TypeError, ValueError):
        return 0.0


def commonness_health(cards: list[dict[str, Any]]) -> dict[str, Any]:
    """判断 common 还是不是连续 Zipf 词频。"""
    values = [commonness(card) for card in cards]
    fractional = sum(1 for value in values if value != int(value))
    zeros = sum(1 for value in values if value == 0)
    non_dict = sum(1 for card in cards if card.get("ctx") != "dict")
    return {
        # 真 Zipf 一定有大量小数；降级后的代理值全是整数
        "healthy": fractional > 0,
        "fractional_values": fractional,
        "zero_valued_cards": zeros,
        "non_dict_cards": non_dict,
        # 降级的特征指纹：0 值卡与非 dict 卡一一对应，且取值里没有 1
        "degraded_signature": zeros == non_dict and not any(v == 1 for v in values),
    }


def group_stats(group: list[dict[str, Any]], healthy: bool) -> dict[str, Any]:
    total = len(group)
    fallback = sum(1 for card in group if card.get("ctx") == "fallback")
    override = sum(1 for card in group if card.get("ctx") == "override")
    row: dict[str, Any] = {
        "cards": total,
        "fallback": fallback,
        "override": override,
        "fallback_rate": round(fallback / total, 4) if total else None,
    }
    if healthy and total:
        values = [commonness(card) for card in group]
        row["median_commonness"] = round(statistics.median(values), 2)
        row["cold_rate"] = round(sum(1 for v in values if v < COLD_THRESHOLD) / total, 4)
    else:
        row["median_commonness"] = None
        row["cold_rate"] = None
    return row


def band_label(low: int, high: int | None) -> str:
    return f"{low}+" if high is None else f"{low}-{high}"


def audit(cards: list[dict[str, Any]]) -> dict[str, Any]:
    health = commonness_health(cards)
    healthy = health["healthy"]

    by_norm = defaultdict(list)
    for card in cards:
        by_norm[card.get("norm")].append(card)

    by_band = defaultdict(list)
    for card in cards:
        try:
            rank = int(card.get("rank") or 0)
        except (TypeError, ValueError):
            rank = 0
        for low, high in RANK_BANDS:
            if rank >= low and (high is None or rank <= high):
                by_band[band_label(low, high)].append(card)
                break

    worst: list[dict[str, Any]] = []
    if healthy:
        ranked = sorted(cards, key=lambda card: (commonness(card), -(int(card.get("rank") or 0))))
        worst = [{"target": c.get("target"), "word": c.get("ans"), "commonness": commonness(c),
                  "norm": c.get("norm"), "ctx": c.get("ctx")} for c in ranked[:200]]

    return {
        "deck_cards": len(cards),
        "cold_threshold": COLD_THRESHOLD,
        "commonness_field": health,
        "context_source": dict(Counter(card.get("ctx") for card in cards)),
        "by_norm": {level: group_stats(by_norm[level], healthy) for level in NORM_LEVELS if by_norm.get(level)},
        "by_rank_band": {band_label(low, high): group_stats(by_band[band_label(low, high)], healthy)
                         for low, high in RANK_BANDS if by_band.get(band_label(low, high))},
        "worst_200": worst,
    }


def print_human(report: dict[str, Any]) -> None:
    health = report["commonness_field"]
    print(f"题库 {report['deck_cards']} 张卡 · 语境来源 " +
          " / ".join(f"{k} {v}" for k, v in sorted(report["context_source"].items())))
    if not health["healthy"]:
        print()
        print("!! " + COMMONNESS_REGRESSION.replace("\n", "\n   "))
        print()
        print("以下只列与词频无关的结构指标；冷门率一栏在题库修好前无法计算。")
    for title, block in (("按规范等级", report["by_norm"]), ("按字频段", report["by_rank_band"])):
        print(f"\n— {title} —")
        print(f"{'':<10}{'字数':>7}{'中位词频':>10}{'冷门率':>9}{'无语境词':>10}{'人工覆盖':>10}")
        for key, row in block.items():
            median = "—" if row["median_commonness"] is None else f"{row['median_commonness']:.2f}"
            cold = "—" if row["cold_rate"] is None else f"{row['cold_rate']:.1%}"
            print(f"{key:<10}{row['cards']:>7}{median:>10}{cold:>9}"
                  f"{row['fallback_rate']:>9.1%}{row['override']:>10}")


def compare(report: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    """棘轮：只允许变好，不允许变差。"""
    problems: list[str] = []
    now, before = report["commonness_field"], baseline["commonness_field"]
    if before["healthy"] and not now["healthy"]:
        problems.append("common 字段从 Zipf 词频退化成了整数代理值——题库多半是在没装 wordfreq 的环境里重新生成的")
    if not before["healthy"] and now["healthy"]:
        problems.append("好消息：common 已恢复成 Zipf 词频。请重新生成基线（--write-baseline）"
                        "并把 #132 的冷门率门槛正式设起来")
    for level, row in report["by_norm"].items():
        old = baseline["by_norm"].get(level)
        if not old:
            continue
        if row["fallback_rate"] is not None and old["fallback_rate"] is not None \
                and row["fallback_rate"] > old["fallback_rate"] + 1e-6:
            problems.append(f"{level} 的无语境词比例上升：{old['fallback_rate']:.1%} → {row['fallback_rate']:.1%}")
        if row["cold_rate"] is not None and old.get("cold_rate") is not None \
                and row["cold_rate"] > old["cold_rate"] + 1e-6:
            problems.append(f"{level} 的冷门率上升：{old['cold_rate']:.1%} → {row['cold_rate']:.1%}")
    return problems


def selftest() -> list[str]:
    """用手算过的合成题库证明这套算法本身是对的。

    同样的函数跑 4d6e8e5 的真实旧题库，能逐位复现 #132 公布的
    一级 7.1% / 二级 83.3% / 三级 98.1%；这里不依赖 git 历史，只钉算法。
    """
    cards = [
        {"target": "的", "ans": "目的", "common": 5.2, "norm": "一级", "ctx": "dict", "rank": 1},
        {"target": "人", "ans": "人民", "common": 4.0, "norm": "一级", "ctx": "dict", "rank": 400},
        # 2.9 < 3.0 → 冷门。一级共 3 张，冷门 1 张 = 33.33%
        {"target": "冷", "ans": "生僻词", "common": 2.9, "norm": "一级", "ctx": "dict", "rank": 600},
        {"target": "潺", "ans": "潺潺", "common": 1.1, "norm": "二级", "ctx": "dict", "rank": 4000},
        # 无语境词：commonness 为 0，既算冷门也算 fallback
        {"target": "沄", "ans": "混混沄沄", "common": 0, "norm": "三级", "ctx": "fallback", "rank": 7000},
    ]
    report = audit(cards)
    problems = []

    def want(actual, expected, label):
        if actual != expected:
            problems.append(f"{label}：期望 {expected}，实得 {actual}")

    want(report["commonness_field"]["healthy"], True, "自测题库应被判为 Zipf 健康")
    want(report["by_norm"]["一级"]["cold_rate"], 0.3333, "一级冷门率")
    want(report["by_norm"]["一级"]["median_commonness"], 4.0, "一级中位词频")
    want(report["by_norm"]["二级"]["cold_rate"], 1.0, "二级冷门率")
    want(report["by_norm"]["三级"]["fallback_rate"], 1.0, "三级无语境词比例")
    want(report["by_rank_band"]["1-500"]["cards"], 2, "字频段 1-500 的卡数")
    want(report["by_rank_band"]["6001+"]["cards"], 1, "字频段 6001+ 的卡数")
    want(len(report["worst_200"]), 5, "最差列表长度")
    want(report["worst_200"][0]["target"], "沄", "最差一张应是词频最低的那张")

    degraded = audit([{**c, "common": int(c["common"])} for c in cards])
    want(degraded["commonness_field"]["healthy"], False, "全整数题库应被判为已降级")
    want(degraded["by_norm"]["一级"]["cold_rate"], None, "已降级时不得给出冷门率")
    want(degraded["by_norm"]["一级"]["fallback_rate"], 0.0, "已降级时结构指标仍应给出")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="语境词冷门率审计（#132）")
    parser.add_argument("--deck", default=str(DECK_PATH), help="题库路径，默认仓库里的 deck-data.js")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读 JSON")
    parser.add_argument("--check", action="store_true", help="自测 + 与基线比对，只允许变好")
    parser.add_argument("--write-baseline", action="store_true", help="把当前结果写成新基线")
    args = parser.parse_args()

    failures = selftest()
    if failures:
        for item in failures:
            print(f"[context-audit] 自测失败：{item}", file=sys.stderr)
        return 1

    report = audit(load_cards(Path(args.deck)))
    slim = {k: v for k, v in report.items() if k != "worst_200"}

    if args.write_baseline:
        # 基线里显式记下"当前 common 已降级"这件事，避免后来的人把它当成正常状态。
        # 一旦题库用装好 wordfreq 的环境重新生成，--check 会主动要求重新基线。
        slim = {"note": ("棘轮基线：只允许变好。commonness_field.healthy 为 false 是已知回归"
                         "（#132，自 c7c8fc2 起），不是正常状态——见 audit_context_quality.py 的"
                         "COMMONNESS_REGRESSION。题库修好后请重跑 --write-baseline。"), **slim}
        BASELINE_PATH.write_text(json.dumps(slim, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[context-audit] 基线已写入 {BASELINE_PATH.relative_to(ROOT)}")
        return 0

    if args.check:
        if not BASELINE_PATH.exists():
            print(f"[context-audit] 缺少基线 {BASELINE_PATH.relative_to(ROOT)}", file=sys.stderr)
            return 1
        problems = compare(report, json.loads(BASELINE_PATH.read_text(encoding="utf-8")))
        if problems:
            for item in problems:
                print(f"[context-audit] 失败：{item}", file=sys.stderr)
            return 1
        state = "Zipf 正常" if report["commonness_field"]["healthy"] else "common 已降级（#132 已记录，见基线）"
        print(f"[context-audit] 自测通过；{report['deck_cards']} 张卡未较基线变差（{state}）")
        return 0

    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
