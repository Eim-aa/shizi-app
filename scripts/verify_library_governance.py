#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LEVEL_FILES = {
    "一级": ROOT / "sources" / "level-1.txt",
    "二级": ROOT / "sources" / "level-2.txt",
    "三级": ROOT / "sources" / "level-3.txt",
}
EXPECTED_NORM_COUNTS = {"一级": 3500, "二级": 3000, "三级": 1605}
EXPECTED_NORM_SHA256 = {
    "一级": "79a6c710013cc86617d5db65871f59b2d67dee72415d380a2cc7145a51450fe4",
    "二级": "d597a6e99ea7b8c41215081f824c6e8587bf1c9a3f45fb13086a826306789785",
    "三级": "c9fbc83a9f8cd860306b218bf16c6a4cc56d7c4a22a686d403b176a0dbec7931",
}
EXPECTED_AVAILABLE = {"一级": 3500, "二级": 2868, "三级": 486}
EXPECTED_CURRICULUM_FILE_SHA256 = "c9b12e616ca252a3af6e7c872a953281ae7d5614bd2263f640131e90bf67b528"
EXPECTED_CURRICULUM_MEMBERS_SHA256 = "c3de017903fc18076a7ab59ad9f41a29d0daba9a1725f04d206c0158a28de4aa"
EXPECTED_CURRICULUM_PDF_SHA256 = "3ef0ec8a30b5a950211202658df07d99f5427f750f8ba0c3cfda12736b7bd71a"
ALLOWED_BANDS = {"入门", "基础", "进阶", "较难", "挑战"}


def chars(path):
    return list("".join(path.read_text(encoding="utf-8").split()))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def members_sha256(rows):
    return hashlib.sha256("".join(rows).encode("utf-8")).hexdigest()


def validate_curriculum_members(rows, level_one):
    require(len(rows) == len(set(rows)) == 2500, "curriculum table one must contain 2500 unique characters")
    require(set(rows) <= set(level_one), "curriculum table one must be a subset of normative level one")
    require(members_sha256(rows) == EXPECTED_CURRICULUM_MEMBERS_SHA256, "curriculum table-one membership changed without source review")
    require(len(set(level_one) - set(rows)) == 1000, "derived curriculum table two must contain 1000 characters")


def load_seed():
    source = (ROOT / "deck-data.js").read_text(encoding="utf-8")
    prefix = "const SEED = "
    start = source.index(prefix) + len(prefix)
    end = source.index(";\n", start)
    return json.loads(source[start:end])


def main():
    norm = {level: chars(path) for level, path in LEVEL_FILES.items()}
    require({level: len(rows) for level, rows in norm.items()} == EXPECTED_NORM_COUNTS, "normative counts changed")
    require({level: sha256(path) for level, path in LEVEL_FILES.items()} == EXPECTED_NORM_SHA256, "normative source membership changed without source review")
    require(all(len(rows) == len(set(rows)) for rows in norm.values()), "a normative level contains duplicate characters")
    require(not (set(norm["一级"]) & set(norm["二级"]) or set(norm["一级"]) & set(norm["三级"]) or set(norm["二级"]) & set(norm["三级"])), "normative levels overlap")

    curriculum_path = ROOT / "sources" / "curriculum-common-2500.txt"
    curriculum = chars(curriculum_path)
    require(sha256(curriculum_path) == EXPECTED_CURRICULUM_FILE_SHA256, "curriculum source file changed without source review")
    validate_curriculum_members(curriculum, norm["一级"])

    # This mutation preserves count, uniqueness and level-one membership. Only the
    # independently pinned membership digest can reject it.
    mutant = list(curriculum)
    mutant[-1] = next(ch for ch in norm["一级"] if ch not in set(curriculum))
    try:
        validate_curriculum_members(mutant, norm["一级"])
    except AssertionError:
        pass
    else:
        raise AssertionError("curriculum membership negative control was not rejected")

    selected_payload = json.loads((ROOT / "generated" / "selected_8105_candidates.json").read_text(encoding="utf-8"))
    selected = selected_payload["selected"]
    skipped = selected_payload["skipped"]
    selected_chars = {row["character"] for row in selected}
    skipped_chars = {row["character"] for rows in skipped.values() for row in rows}
    all_norm = set().union(*(set(rows) for rows in norm.values()))
    require(len(selected) == len(selected_chars) == 6854, "selected practice cards must remain unique and explicit")
    require(selected_chars.isdisjoint(skipped_chars), "a character cannot be both available and unavailable")
    require(selected_chars | skipped_chars == all_norm, "every normative character needs an availability status")
    require({reason: len(rows) for reason, rows in skipped.items()} == {"no_hanzi_writer": 1239, "no_make_me_hanzi": 0, "stroke_mismatch": 12}, "availability reasons changed without review")
    require({level: sum(row["norm_level"] == level for row in selected) for level in LEVEL_FILES} == EXPECTED_AVAILABLE, "available counts changed without review")
    require(all(row.get("difficulty_band") in ALLOWED_BANDS and "level" not in row for row in selected), "generated records must use writing difficulty bands, not education levels")
    require(sum(row.get("curriculum_table") == "表一" for row in selected) == 2500, "all curriculum table-one characters must be practice-ready")
    require(sum(row.get("curriculum_table") == "表二" for row in selected) == 1000, "all curriculum table-two characters must be practice-ready")

    seed = load_seed()
    require(len(seed) == len(selected), "runtime seed and selected manifest disagree")
    require(all(row.get("band") in ALLOWED_BANDS and "level" not in row for row in seed), "runtime cards must not carry school-stage difficulty labels")
    require(sum(row.get("edu") == "表一" for row in seed) == 2500 and sum(row.get("edu") == "表二" for row in seed) == 1000, "runtime curriculum membership is incomplete")

    audit_path = ROOT / "generated" / "library-governance.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    require(audit["normative_source"]["total"] == 8105 and audit["curriculum_source"]["total"] == 3500, "audit source totals are wrong")
    require(audit["practice_availability"]["available"] == 6854 and audit["practice_availability"]["unavailable"] == 1251, "audit availability totals are wrong")
    for item in audit["normative_source"]["files"]:
        require(sha256(ROOT / item["path"]) == item["sha256"], f"source hash mismatch: {item['path']}")
    table_one = audit["curriculum_source"]["table_one"]
    require(sha256(ROOT / table_one["path"]) == table_one["sha256"], "curriculum source hash mismatch")
    require(table_one["sha256"] == EXPECTED_CURRICULUM_FILE_SHA256, "audit curriculum source hash is not independently pinned")
    require(table_one["members_sha256"] == EXPECTED_CURRICULUM_MEMBERS_SHA256, "audit curriculum membership hash is not independently pinned")
    require(audit["curriculum_source"]["document_sha256"] == EXPECTED_CURRICULUM_PDF_SHA256, "audit curriculum PDF version is not independently pinned")
    require(all(audit["invariants"].values()), "a library-governance invariant is false")

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    require("日常读写九成五" not in html, "unsupported 95% claim is still visible")
    require(all(f'name:"{name}"' not in html for name in ("小学", "初中", "高中")), "unsupported school-stage libraries are still visible")
    require("LEVEL_RANK" not in html and "cardLevel(" not in html, "education terminology is still used for writing difficulty")
    require(all(name in html for name in ("规范常用字", "规范次常用字", "规范专门用字", "义教基础字")), "source-backed library labels are incomplete")

    print("library governance: 8105 normative characters classified; 3500 curriculum characters verified; 6854 practice-ready; 1251 explicitly unavailable")


if __name__ == "__main__":
    main()
