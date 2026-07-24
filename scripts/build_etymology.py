#!/usr/bin/env python3
"""Build the compact, source-attributed character-origin dataset."""

import argparse
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECK_PATH = ROOT / "deck-data.js"
HANZI_DB_PATH = ROOT / "sources" / "hanzi_db.json"
MAKE_ME_A_HANZI_PATH = ROOT / "sources" / "make-me-a-hanzi-dict.txt"
OPENCC_ST_PATH = ROOT / "sources" / "opencc-st-characters.txt"
OPENCC_TS_PATH = ROOT / "sources" / "opencc-ts-characters.txt"
OUTPUT_PATH = ROOT / "data" / "etymology.json"
COVERAGE_PATH = ROOT / "generated" / "etymology-coverage.json"
ACCURACY_FIXTURE_PATH = ROOT / "scripts" / "fixtures" / "etymology_accuracy.json"
CONTEXT_AUDIT_PATH = ROOT / "scripts" / "fixtures" / "etymology_context_audit.json"
COPY_REVIEW_PATH = ROOT / "scripts" / "fixtures" / "etymology_copy_review.json"

SHUOWEN_REVISION = "6553a350763ce4feca2c5d1cc2cad7e594dc2975"
OPENCC_REVISION = "8a8ef3eb10e563ed013f27628e6a46a5f0ade7d8"
TOP_LIMIT = 1000
MAX_GLOSS = 20

# These 50 records were checked against the pinned raw source records. Their
# wording favors present-day readability while staying within the source.
AUDITED_GLOSSES = {
    "一": "万物之始，以一分天地",
    "人": "天地万物中，人最贵",
    "大": "天大地大，人也大",
    "中": "内里，从口，一竖上下通",
    "上": "位置高，在基准线之上",
    "下": "位置低，在基准线之下",
    "日": "太阳之精，象太阳形",
    "月": "太阴之精，象月亮形",
    "山": "有石而高，象群峰形",
    "水": "众水并流，象流水形",
    "火": "能烧毁事物，火焰向上",
    "木": "冒地而生，下象树根",
    "土": "地上能吐生万物",
    "手": "手掌，象手的形状",
    "口": "人用来言语饮食",
    "心": "心在五脏之中",
    "女": "妇人，象形",
    "子": "阳气发动，万物滋生",
    "学": "觉悟，从教从冂",
    "生": "草木从土上生出",
    "明": "照亮，从月从囧",
    "字": "生育，从子在屋内",
    "书": "书写，从聿，者声",
    "车": "车厢和车轮的总名",
    "马": "象马头、鬃毛、尾和四足",
    "门": "由两扇户组成，象形",
    "雨": "水从云中落下",
    "金": "五色金属的总称",
    "石": "山中的石头",
    "田": "种谷的田，象阡陌形",
    "目": "人的眼睛，象形",
    "耳": "主管听觉，象形",
    "足": "人的脚，从止从口",
    "言": "直说叫言，论难叫语",
    "食": "食米，从皀，亼声",
    "衣": "人依靠衣服蔽体",
    "竹": "冬天仍生长的草木",
    "米": "谷物的籽实，象形",
    "鱼": "水中生物，象鱼形",
    "见": "看见，从儿从目",
    "力": "筋力，象人的筋",
    "刀": "兵器，象刀形",
    "王": "天下人心归往",
    "玉": "石头中美的部分",
    "气": "云气，象云气形",
    "笔": "秦称为笔，从聿从竹",
    "们": "从亻，门声",
    "样": "从木，羊声",
    "吗": "从口，马声",
    "妈": "从女，马声",
}

# These modern forms have an explicit, reviewable historical counterpart in
# the pinned Shuowen data, but are not listed in that record's search indexes.
SHUOWEN_ALIASES = {
    "上": "丄",
    "下": "丅",
    "于": "亏",
    "其": "箕",
    "明": "朙",
    "卫": "衞",
    "留": "畱",
    "冫": "仌",
    "巛": "川",
    "廾": "𠬞",
    "彐": "彑",
    "歹": "歺",
    "阜": "𨸏",
}

# Make Me a Hanzi labels these as ideographic/pictographic. The English hints
# are manually condensed here; entries without a reliable hint stay absent.
MAKE_ME_A_HANZI_GLOSSES = {
    "亠": "一点一横，表示覆盖或字头",
    "个": "人字中一竖，表示计数",
    "你": "从人，从尔，表示对人的称呼",
    "她": "从女，从也，表示女性称呼",
    "第": "从竹，弟声，指竹简次序",
    "表": "从衣，从毛，本指皮衣",
    "真": "直形在上，几形在下",
    "别": "从刀，从另，表示划分",
    "太": "大字加点，表示程度更甚",
    "做": "从人，从故，故亦声",
    "即": "人跪食器前，表示靠近",
    "难": "手抓隹鸟，表示不易",
    "断": "用斤斩米，表示截断",
    "农": "像持辰耕田之形",
    "找": "手执戈寻找",
    "雷": "雨在田上，表示雷雨",
    "卡": "上下相夹，表示卡住",
    "既": "人背食器，表示食毕",
    "您": "你下加心，表示敬意",
    "沉": "从水，从冗，表示下没",
    "帮": "从巾，从邦，邦亦声",
    "岛": "鸟落山上，表示海岛",
    "座": "从广，从坐，坐亦声",
    "散": "手持器物播撒",
    "画": "像画在架上的图",
    "智": "从日，从知，知亦声",
    "康": "屋下有隶，表示安定",
    "票": "从覀，从示，本指祭祀焚物",
    "疗": "从疒，从了，了亦声",
    "炸": "从火，从乍，乍亦声",
    "抓": "从手，从爪，爪亦声",
    "爿": "像劈开的半片木头",
}


def read_json_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def read_deck():
    match = re.search(r"const SEED = (\[.*\]);", DECK_PATH.read_text(), re.S)
    if not match:
        raise SystemExit(f"Could not parse {DECK_PATH}")
    return json.loads(match.group(1))


def read_opencc(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or "\t" not in line:
            continue
        source, targets = line.split("\t", 1)
        result[source] = targets.split()
    return result


def simplify_text(text, traditional_to_simplified):
    chars = []
    for char in text:
        mapped = traditional_to_simplified.get(char)
        chars.append(mapped[0] if mapped else char)
    return "".join(chars)


def has_cjk_extension(text):
    return any(
        0x3400 <= ord(char) <= 0x4DBF or 0x20000 <= ord(char) <= 0x323AF
        for char in text
    )


def main_gloss_clause(gloss):
    return str(gloss or "").split("。", 1)[0]


def is_opaque_ancient_gloss(gloss, known_characters):
    match = re.fullmatch(r"(.{1,2})(?:也|同)", main_gloss_clause(gloss))
    return bool(match and any(char not in known_characters for char in match.group(1)))


def strip_unreviewed_extension_structures(gloss):
    clauses = str(gloss or "").split("。")
    return "。".join(
        clause for index, clause in enumerate(clauses)
        if clause and (index == 0 or not has_cjk_extension(clause))
    )


def concise_shuowen_gloss(explanation, traditional_to_simplified):
    text = simplify_text(str(explanation or ""), traditional_to_simplified)
    text = re.sub(r"（[^）]*）|\([^)]*\)", "", text)
    text = re.sub(r"《[^》]+》曰[:：]?[“\"][^”\"]*[”\"]?", "", text)
    text = text.replace("；", "。").replace(";", "。").replace("：", "，")
    sentences = [part.strip(" ，。；") for part in re.split(r"[。！？]", text) if part.strip(" ，。；")]
    if not sentences:
        return ""
    primary = sentences[0]
    if len(primary) > MAX_GLOSS:
        clauses = [part.strip() for part in re.split(r"[，,]", primary) if part.strip()]
        primary = next((part for part in clauses if len(part) <= MAX_GLOSS), "")
    if not primary:
        return ""
    selected = [primary]
    for sentence in sentences[1:]:
        if not sentence.startswith("从"):
            continue
        candidate = "。".join([*selected, sentence])
        if len(candidate) <= MAX_GLOSS:
            selected.append(sentence)
        break
    gloss = "。".join(selected).strip(" ，。；")
    return gloss if 1 <= len(gloss) <= MAX_GLOSS else ""


def make_me_a_hanzi_gloss(char, record):
    etymology = record.get("etymology") or {}
    kind = etymology.get("type")
    if kind == "pictophonetic":
        semantic = str(etymology.get("semantic") or "").strip()
        phonetic = str(etymology.get("phonetic") or "").strip()
        if semantic and phonetic:
            gloss = f"从{semantic}，{phonetic}声"
            return gloss if len(gloss) <= MAX_GLOSS else ""
    gloss = MAKE_ME_A_HANZI_GLOSSES.get(char, "")
    return gloss if len(gloss) <= MAX_GLOSS else ""


def git_revision(path):
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_shuowen_indexes(records):
    exact = {}
    aliases = defaultdict(list)
    for record in records:
        headword = str(record.get("wordhead") or "")
        if headword:
            exact.setdefault(headword, record)
        for key in record.get("indexes") or []:
            key = str(key or "")
            if key and key != headword:
                aliases[key].append(record)
    return exact, aliases


def read_context_audit(deck, simplified_to_traditional):
    fixture = json.loads(CONTEXT_AUDIT_PATH.read_text())
    entries = fixture.get("entries") or []
    expected_count = int(fixture.get("expectedCount") or 0)
    if len(entries) != expected_count:
        raise SystemExit(f"Context audit expected {expected_count} rows, got {len(entries)}")

    deck_context = {record["target"]: record.get("ans", "") for record in deck}
    audit = {}
    for entry in entries:
        char = entry.get("char", "")
        context = entry.get("context", "")
        status = entry.get("status", "")
        if not char or char in audit:
            raise SystemExit(f"Invalid or duplicate context audit character: {char}")
        if deck_context.get(char) != context:
            raise SystemExit(
                f"Context audit for {char} is stale: {context} != {deck_context.get(char, '')}"
            )
        candidates = simplified_to_traditional.get(char, [])
        if len(candidates) <= 1:
            raise SystemExit(f"Context audit character {char} is not one-to-many: {candidates}")
        if status == "present":
            headword = entry.get("sourceHeadword", "")
            if headword not in candidates:
                raise SystemExit(
                    f"Context audit headword {headword} for {char} is not in {candidates}"
                )
        elif status != "absent":
            raise SystemExit(f"Invalid context audit status for {char}: {status}")
        audit[char] = entry
    return audit


def read_copy_review(known_characters):
    fixture = json.loads(COPY_REVIEW_PATH.read_text())
    entries = fixture.get("entries") or []
    expected_count = int(fixture.get("expectedCount") or 0)
    if len(entries) != expected_count:
        raise SystemExit(f"Copy review expected {expected_count} rows, got {len(entries)}")

    review = {}
    for entry in entries:
        char = entry.get("char", "")
        candidate = entry.get("candidate", "")
        status = entry.get("status", "")
        if not char or char in review or not candidate:
            raise SystemExit(f"Invalid or duplicate copy review character: {char}")
        if status == "present":
            copy = entry.get("copy", "")
            if not 1 <= len(copy) <= MAX_GLOSS or has_cjk_extension(copy):
                raise SystemExit(f"Invalid reviewed copy for {char}: {copy}")
            if is_opaque_ancient_gloss(copy, known_characters):
                raise SystemExit(f"Reviewed copy remains opaque for {char}: {copy}")
        elif status != "absent" or entry.get("copy"):
            raise SystemExit(f"Invalid copy review status for {char}: {status}")
        review[char] = entry
    return review


def resolve_shuowen(char, exact, aliases, simplified_to_traditional, context_audit):
    traditional = simplified_to_traditional.get(char, [])
    if len(traditional) > 1:
        reviewed = context_audit.get(char)
        if reviewed and reviewed["status"] == "present":
            headword = reviewed["sourceHeadword"]
            record = exact.get(headword)
            if not record:
                raise SystemExit(f"Missing context-reviewed Shuowen headword {headword} for {char}")
            return record, headword, "reviewed-context", None
        reason = "reviewed-context-omission" if reviewed else "ambiguous-opencc"
        return None, "", "", {
            "reason": reason,
            "candidates": traditional,
            "context": reviewed.get("context", "") if reviewed else "",
        }

    if char in exact:
        return exact[char], char, "exact", None

    reviewed_headword = SHUOWEN_ALIASES.get(char)
    if reviewed_headword:
        record = exact.get(reviewed_headword)
        if not record:
            raise SystemExit(f"Missing reviewed Shuowen headword {reviewed_headword} for {char}")
        return record, reviewed_headword, "reviewed-alias", None

    if len(traditional) == 1:
        headword = traditional[0]
        record = exact.get(headword)
        if record:
            return record, headword, "opencc-one-to-one", None
    alias_headwords = sorted({
        str(record.get("wordhead") or "")
        for record in aliases.get(char, [])
        if record.get("wordhead")
    })
    if alias_headwords:
        return None, "", "", {
            "reason": "unreviewed-index-alias",
            "candidates": alias_headwords,
        }
    return None, "", "", {"reason": "no-reviewed-source"}


def validate_accuracy_fixture(entries, detail, omissions):
    fixture = json.loads(ACCURACY_FIXTURE_PATH.read_text())
    rows = {row["char"]: row for row in entries}
    for expected in fixture.get("entries", []):
        char = expected["char"]
        if expected["status"] == "present":
            row = rows.get(char)
            record = detail.get(char)
            if not row or not record:
                raise SystemExit(f"Accuracy fixture expected {char} to be present")
            actual = {
                "source": row["source"],
                "sourceHeadword": record["sourceHeadword"],
                "matchKind": record["matchKind"],
                "gloss": row["gloss"],
            }
            wanted = {key: expected[key] for key in actual}
            if actual != wanted:
                raise SystemExit(f"Accuracy fixture mismatch for {char}: {actual} != {wanted}")
        else:
            if char in rows or char in detail:
                raise SystemExit(f"Accuracy fixture expected {char} to be absent")
            reason = (omissions.get(char) or {}).get("reason")
            if reason != expected.get("strategy"):
                raise SystemExit(f"Accuracy fixture omission mismatch for {char}: {reason}")


def build(shuowen_dir):
    if len(AUDITED_GLOSSES) != 50 or any(
        len(gloss) > MAX_GLOSS for gloss in AUDITED_GLOSSES.values()
    ):
        raise SystemExit("The manual audit must contain exactly 50 compact glosses")
    shuowen_data_dir = shuowen_dir / "data"
    if not shuowen_data_dir.is_dir():
        raise SystemExit(f"Missing Shuowen data directory: {shuowen_data_dir}")
    revision = git_revision(shuowen_dir)
    if revision and revision != SHUOWEN_REVISION:
        raise SystemExit(f"Expected Shuowen {SHUOWEN_REVISION}, got {revision}")

    shuowen_records = [
        json.loads(path.read_text())
        for path in sorted(shuowen_data_dir.glob("*.json"), key=lambda item: int(item.stem))
    ]
    shuowen_exact, shuowen_aliases = build_shuowen_indexes(shuowen_records)

    simplified_to_traditional = read_opencc(OPENCC_ST_PATH)
    traditional_to_simplified = read_opencc(OPENCC_TS_PATH)
    make_me_a_hanzi = {
        record["character"]: record
        for record in read_json_lines(MAKE_ME_A_HANZI_PATH)
    }
    deck = read_deck()
    context_audit = read_context_audit(deck, simplified_to_traditional)
    known_characters = {record["target"] for record in deck}
    copy_review = read_copy_review(known_characters)
    hanzi_db = {record["character"]: record for record in read_json_lines(HANZI_DB_PATH)}
    rank = {record["target"]: int(record.get("rank", 999999)) for record in deck}
    top_chars = {
        record["target"] for record in deck
        if int(record.get("rank", 999999)) <= TOP_LIMIT
    }
    radical_chars = {
        hanzi_db.get(record["target"], {}).get("radical", "")
        for record in deck
    } - {""}
    targets = top_chars | radical_chars
    if not set(copy_review).issubset(targets):
        raise SystemExit(f"Copy review contains non-target characters: {sorted(set(copy_review) - targets)}")

    entries = []
    detail = {}
    omissions = {}
    for char in sorted(targets, key=lambda item: (rank.get(item, 999999), item)):
        record, matched, match_kind, omission = resolve_shuowen(
            char, shuowen_exact, shuowen_aliases, simplified_to_traditional,
            context_audit
        )

        gloss = ""
        source = ""
        source_id = None
        source_headword = ""
        original = ""
        if record:
            gloss = concise_shuowen_gloss(record.get("explanation"), traditional_to_simplified)
            if gloss:
                source = "《说文解字》"
                source_id = record.get("id")
                source_headword = record.get("wordhead", "")
                original = record.get("explanation", "")
        blocked_ambiguity = omission and omission.get("reason") in {
            "ambiguous-opencc", "reviewed-context-omission"
        }
        if not gloss and not blocked_ambiguity:
            fallback = make_me_a_hanzi.get(char, {})
            gloss = make_me_a_hanzi_gloss(char, fallback)
            if gloss:
                source = "Make Me a Hanzi"
                source_headword = char
                original = (fallback.get("etymology") or {}).get("hint", "")
                matched = char
                match_kind = "make-me-a-hanzi"

        if not gloss:
            omissions[char] = omission or {"reason": "no-reviewed-source"}
            continue
        candidate_gloss = gloss
        reviewed_copy = copy_review.get(char)
        if reviewed_copy:
            if reviewed_copy["candidate"] != candidate_gloss:
                raise SystemExit(
                    f"Copy review candidate changed for {char}: {candidate_gloss} != "
                    f"{reviewed_copy['candidate']}"
                )
            if reviewed_copy["status"] == "absent":
                omissions[char] = {
                    "reason": "readability-review-omission",
                    "candidate": candidate_gloss,
                }
                continue
            gloss = reviewed_copy["copy"]
            match_kind = f"{match_kind}+reviewed-copy"
        elif char in AUDITED_GLOSSES:
            gloss = AUDITED_GLOSSES[char]
            match_kind = f"{match_kind}+reviewed-copy"
        else:
            gloss = strip_unreviewed_extension_structures(gloss)
            if has_cjk_extension(main_gloss_clause(gloss)) or is_opaque_ancient_gloss(
                gloss, known_characters
            ):
                omissions[char] = {
                    "reason": "unreadable-unreviewed",
                    "candidate": candidate_gloss,
                }
                continue
        if has_cjk_extension(gloss):
            raise SystemExit(f"Published copy still contains a CJK extension character: {char} {gloss}")
        entries.append({"char": char, "gloss": gloss, "source": source})
        detail[char] = {
            "source": source,
            "sourceId": source_id,
            "sourceHeadword": source_headword,
            "matchedIndex": matched,
            "matchKind": match_kind,
            "original": original,
            "gloss": gloss,
        }

    validate_accuracy_fixture(entries, detail, omissions)

    source_counts = Counter(entry["source"] for entry in entries)
    covered = {entry["char"] for entry in entries}
    coverage = {
        "schemaVersion": 2,
        "sourceRevisions": {
            "shuowenjiezi/shuowen": SHUOWEN_REVISION,
            "BYVoid/OpenCC": OPENCC_REVISION,
        },
        "limits": {"topRank": TOP_LIMIT, "maxGlossCharacters": MAX_GLOSS},
        "totals": {
            "entries": len(entries),
            "targetUnion": len(targets),
            "topCharacters": len(top_chars),
            "topCovered": len(top_chars & covered),
            "radicalCharacters": len(radical_chars),
            "radicalCovered": len(radical_chars & covered),
        },
        "sourceCounts": dict(sorted(source_counts.items())),
        "manualAudit": {
            "count": len(AUDITED_GLOSSES),
            "characters": list(AUDITED_GLOSSES),
        },
        "contextAudit": {
            "count": len(context_audit),
            "present": sum(row["status"] == "present" for row in context_audit.values()),
            "absent": sum(row["status"] == "absent" for row in context_audit.values()),
        },
        "copyReview": {
            "count": len(copy_review),
            "present": sum(row["status"] == "present" for row in copy_review.values()),
            "absent": sum(row["status"] == "absent" for row in copy_review.values()),
        },
        "missingTopCharacters": sorted(top_chars - covered, key=lambda item: rank[item]),
        "missingRadicalCharacters": sorted(radical_chars - covered),
        "omissions": {char: omissions[char] for char in sorted(omissions)},
        "detail": detail,
    }
    return entries, coverage


def serialized(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shuowen-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    entries, coverage = build(args.shuowen_dir.resolve())
    output = serialized(entries)
    coverage_output = serialized(coverage)
    if args.check:
        failures = []
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text() != output:
            failures.append(str(OUTPUT_PATH.relative_to(ROOT)))
        if not COVERAGE_PATH.exists() or COVERAGE_PATH.read_text() != coverage_output:
            failures.append(str(COVERAGE_PATH.relative_to(ROOT)))
        if failures:
            raise SystemExit("Generated files are stale: " + ", ".join(failures))
        print(f"Verified {len(entries)} source-attributed character origins.")
        return
    OUTPUT_PATH.write_text(output)
    COVERAGE_PATH.write_text(coverage_output)
    print(f"Wrote {len(entries)} entries to {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
