#!/usr/bin/env python3
"""Build the offline context rejection gate from the generated deck and jieba."""

from __future__ import annotations

import json
import argparse
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DECK_PATH = ROOT / "deck-data.js"
JIEBA_PATH = ROOT / "sources" / "jieba_dict.txt"
APPROVED_PATH = ROOT / "scripts" / "fixtures" / "context-quality-approved.json"
OUTPUT_PATH = ROOT / "data" / "context-quality.js"


EXPECTATIONS_PATH = ROOT / "scripts" / "fixtures" / "context-quality-expectations.json"


def load_cards() -> list[dict]:
    source = DECK_PATH.read_text(encoding="utf-8")
    marker = "const SEED = "
    start = source.find(marker)
    end = source.find(";\n", start)
    if start < 0 or end < 0:
        raise RuntimeError("SEED not found in deck-data.js")
    return json.loads(source[start + len(marker) : end])


def load_jieba() -> dict[str, tuple[int, frozenset[str]]]:
    frequencies: dict[str, int] = {}
    tags: dict[str, set[str]] = {}
    for line in JIEBA_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.rsplit(" ", 2)
        if len(parts) != 3 or not parts[1].isdigit():
            continue
        word, frequency, tag = parts
        frequencies[word] = max(frequencies.get(word, 0), int(frequency))
        tags.setdefault(word, set()).add(tag)
    return {word: (frequency, frozenset(tags[word])) for word, frequency in frequencies.items()}


def load_approved_contexts() -> dict[tuple[str, str], str]:
    """人工批准项必须绑定到「目标字 + 候选词」。

    只按词字符串放行的话，候选换成别的词（勾勒 -> 勒令）仍然命中同一条批准记录，
    批准就失去了它要表达的意思，候选变化也不会触发重审。
    """
    payload = json.loads(APPROVED_PATH.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 2 or not isinstance(payload.get("approvedContexts"), list):
        raise RuntimeError("invalid context-quality-approved.json")
    approved: dict[tuple[str, str], str] = {}
    for row in payload["approvedContexts"]:
        target, word = str(row.get("target", "")), str(row.get("word", ""))
        if not target or not word:
            raise RuntimeError("approved context needs both target and word")
        if (target, word) in approved:
            raise RuntimeError(f"duplicate approved context: {target} / {word}")
        approved[(target, word)] = str(row.get("note", ""))
    return approved


def load_expectations() -> dict[str, list[tuple[str, str]]]:
    payload = json.loads(EXPECTATIONS_PATH.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1:
        raise RuntimeError("invalid context-quality-expectations.json")
    out = {}
    for bucket in ("mustKeep", "mustReject"):
        rows = payload.get(bucket)
        if not isinstance(rows, list):
            raise RuntimeError(f"invalid {bucket}")
        out[bucket] = [(str(row["target"]), str(row["word"])) for row in rows]
    return out


# 候选生成器（scripts/build_8105_chars.py）把 i 和 l 都当成熟语，这里必须用同一套口径，
# 否则「毋庸置疑、蔚为壮观」这类 l 类熟语会被当成低频长语境退回「只按拼音写」。
IDIOM_TAGS = {"i", "l"}


def rejection_reason(
    card: dict,
    jieba: dict[str, tuple[int, frozenset[str]]],
    approved: dict[tuple[str, str], str] | None = None,
) -> str:
    target = str(card.get("target", ""))
    word = str(card.get("ans", ""))
    frequency, tags = jieba.get(word, (0, frozenset()))
    if word == target + "字":
        return "placeholder"
    if (approved or {}).get((target, word)) is not None or (tags & IDIOM_TAGS):
        return ""
    proper_noun_tags = {"nr", "nrt", "nrfg", "ns", "nt"}
    if tags and tags <= proper_noun_tags and frequency <= 300 and len(word) <= 3:
        return "low_frequency_proper_noun"
    if len(word) >= 4 and frequency <= 300:
        return "low_frequency_long_context"
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the generated file is stale")
    options = parser.parse_args()
    cards = load_cards()
    jieba = load_jieba()
    approved = load_approved_contexts()
    expectations = load_expectations()
    by_target = {str(card.get("target", "")): str(card.get("ans", "")) for card in cards}

    # 每条人工批准必须恰好命中一张生产卡。候选换了词，这里就会失败并要求重审，
    # 而不是让一条早已不适用的批准继续默默生效。
    unmatched = [f"{t}/{w}" for (t, w) in approved if by_target.get(t) != w]
    if unmatched:
        raise SystemExit("approved contexts no longer match production cards: " + ", ".join(sorted(unmatched)))

    rejected = {
        card["target"]: reason
        for card in cards
        if (reason := rejection_reason(card, jieba, approved))
    }

    # 明确锁住「应保留 / 应拒绝」，不能只锁总数：总数不变也可能是一进一出。
    kept_violations = [f"{t}/{w}" for (t, w) in expectations["mustKeep"] if by_target.get(t) != w or t in rejected]
    reject_violations = [f"{t}/{w}" for (t, w) in expectations["mustReject"] if by_target.get(t) != w or t not in rejected]
    if kept_violations or reject_violations:
        raise SystemExit("context quality expectations drifted; keep=" + ", ".join(sorted(kept_violations))
                         + " reject=" + ", ".join(sorted(reject_violations)))
    counts = Counter(rejected.values())
    summary = {
        "schemaVersion": 1,
        "deckCards": len(cards),
        "rejectedCards": len(rejected),
        "acceptedCards": len(cards) - len(rejected),
        "reasons": dict(sorted(counts.items())),
        "rules": {
            "properNounAllowedTags": ["nr", "nrfg", "nrt", "ns", "nt"],
            "properNounMaximumFrequencyInclusive": 300,
            "properNounMaximumCharacters": 3,
            "longContextMinimumCharacters": 4,
            "longContextMaximumFrequencyInclusive": 300,
            "idiomTagsExempted": sorted(IDIOM_TAGS),
            "reviewedSafeContexts": len(approved),
            "lockedKeep": len(expectations["mustKeep"]),
            "lockedReject": len(expectations["mustReject"]),
        },
    }
    payload = (
        "// Generated by scripts/build_context_quality.py; do not edit by hand.\n"
        f"const CONTEXT_REJECTED = Object.freeze({json.dumps(rejected, ensure_ascii=False, separators=(',', ':'))});\n"
        f"const CONTEXT_QUALITY_SUMMARY = Object.freeze({json.dumps(summary, ensure_ascii=False, separators=(',', ':'))});\n"
    )
    if options.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != payload:
            raise SystemExit("data/context-quality.js is stale; rebuild it")
    else:
        OUTPUT_PATH.write_text(payload, encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
