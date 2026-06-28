#!/usr/bin/env python3
import json
import logging
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
GENERATED_DIR = ROOT / "generated"
SRC_DIR = ROOT / "sources"
DICT_PATH = SRC_DIR / "make-me-a-hanzi-dict.txt"
LEVEL1_PATH = SRC_DIR / "level-1.txt"
HANZI_DB_PATH = SRC_DIR / "hanzi_db.json"
JIEBA_DICT_PATH = SRC_DIR / "jieba_dict.txt"
PY_DEPS = ROOT / ".python-deps"
if PY_DEPS.exists():
    sys.path.insert(0, str(PY_DEPS))

try:
    from pypinyin import Style, pinyin
except ImportError as error:
    raise SystemExit("Missing Python dependency. Run: python3 -m pip install -r requirements.txt") from error

try:
    import jieba
    jieba.setLogLevel(logging.ERROR)
    from wordfreq import zipf_frequency
except ImportError:
    zipf_frequency = None

CJK_RE = re.compile(r"^[\u4e00-\u9fff]$")
IDS_OPS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻")
IDS_ARITY = {"⿰": 2, "⿱": 2, "⿲": 3, "⿳": 3, "⿴": 2, "⿵": 2, "⿶": 2, "⿷": 2, "⿸": 2, "⿹": 2, "⿺": 2, "⿻": 2}
OVERRIDES = {
    "邋": [3, 5, 7, 3],
}

CONTEXT_OVERRIDES = {
    "朝": "朝代",
    "微": "微笑",
    "湾": "海湾",
    "湖": "湖泊",
    "莫": "莫非",
    "勒": "勾勒",
    "洛": "洛阳",
    "埃": "尘埃",
    "赵": "完璧归赵",
    "曼": "曼妙",
    "朗": "朗读",
    "瑞": "祥瑞",
    "秦": "秦朝",
    "荷": "荷花",
    "黎": "黎明",
    "墨": "墨水",
    "腊": "腊月",
    "桑": "沧桑",
    "翼": "羽翼",
    "宾": "宾馆",
    "腾": "腾飞",
    "穆": "肃穆",
    "敦": "敦促",
    "瑟": "萧瑟",
    "翰": "翰林",
    "哼": "哼唱",
    "琼": "琼脂",
    "嘻": "嘻哈",
    "劈": "劈开",
    "躺": "躺下",
}


def read_make_me_hanzi():
    out = {}
    for line in DICT_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        out[entry["character"]] = entry
    return out


def read_level1():
    chars = []
    for line in LEVEL1_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if CJK_RE.match(line):
            chars.append(line)
    return set(chars)


def read_hanzi_db():
    rows = []
    for line in HANZI_DB_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("404:"):
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def read_context_words():
    words = []
    for line in JIEBA_DICT_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        word = parts[0]
        if not re.match(r"^[\u4e00-\u9fff]{2,4}$", word):
            continue
        try:
            freq = int(parts[1])
        except ValueError:
            continue
        tag = parts[2] if len(parts) >= 3 else ""
        words.append({"word": word, "freq": freq, "tag": tag})
    by_char = {}
    for item in words:
        seen = set(item["word"])
        for char in seen:
            by_char.setdefault(char, []).append(item)
    for items in by_char.values():
        items.sort(key=lambda item: -item["freq"])
    return by_char


def parse_ids(text, index=0):
    if not text or index >= len(text):
        return None, index
    char = text[index]
    if char in IDS_ARITY:
        children = []
        cursor = index + 1
        for _ in range(IDS_ARITY[char]):
            node, cursor = parse_ids(text, cursor)
            children.append(node)
        return (char, children), cursor
    return char, index + 1


def node_at_path(node, path):
    for part in path:
        if not isinstance(node, tuple) or part is None:
            return None
        children = node[1]
        if part < 0 or part >= len(children):
            return None
        node = children[part]
    return node


def match_runs(paths, depth):
    runs = []
    previous = object()
    for path in paths:
        key = path[depth] if isinstance(path, list) and len(path) > depth and path[depth] is not None else None
        if runs and key == previous:
            runs[-1]["count"] += 1
            runs[-1]["paths"].append(path)
        else:
            runs.append({"key": key, "count": 1, "paths": [path]})
            previous = key
    return runs


def build_group_resolver(mm):
    cache = {}

    def resolve(character):
        if character in OVERRIDES:
            return OVERRIDES[character][:]
        if character in cache:
            return cache[character][:]
        entry = mm.get(character)
        matches = entry.get("matches") if entry else None
        if not matches:
            return []
        root, _ = parse_ids(entry.get("decomposition") or "")

        def recurse(paths, depth, node):
            groups = []
            for run in match_runs(paths, depth):
                key = run["key"]
                count = run["count"]
                subpaths = run["paths"]
                split = None

                if count >= 5:
                    deeper = match_runs(subpaths, depth + 1)
                    if len(deeper) >= 2 and any(item["key"] is not None for item in deeper):
                        candidate = []
                        for child in deeper:
                            if child["count"] >= 6:
                                candidate.extend(recurse(child["paths"], depth + 2, None))
                            else:
                                candidate.append(child["count"])
                        if len(candidate) >= 2 and sum(candidate) == count and max(candidate) < count:
                            split = candidate

                if split is None and node is not None and key is not None and count >= 6:
                    component = node_at_path(node, [key])
                    if isinstance(component, str) and component in mm and component != character:
                        component_matches = mm[component].get("matches") or []
                        if len(component_matches) == count:
                            component_groups = resolve(component)
                            if len(component_groups) >= 2 and sum(component_groups) == count and max(component_groups) < count:
                                split = component_groups

                groups.extend(split if split else [count])
            return groups

        groups = recurse(matches, 0, root)
        while len(groups) > 5:
            merge_at = min(range(len(groups) - 1), key=lambda idx: groups[idx] + groups[idx + 1])
            groups = groups[:merge_at] + [groups[merge_at] + groups[merge_at + 1]] + groups[merge_at + 2:]
        cache[character] = groups[:]
        return groups

    return resolve


def score_candidate(row, groups):
    rank = int(row.get("frequency_rank") or 99999)
    strokes_match = re.search(r"\d+", str(row.get("stroke_count") or sum(groups)))
    strokes = int(strokes_match.group()) if strokes_match else sum(groups)
    group_count = len(groups)
    largest = max(groups)

    # Frequency sweet spot: common enough to matter, less elementary than the first pass.
    score = 0
    score += abs(rank - 1250) / 12
    score += abs(strokes - 12) * 9
    score += abs(group_count - 4) * 18
    score += max(0, largest - 9) * 16
    if rank < 250:
        score += 500
    return score


def choose_500(mm, level1, hanzi_db_rows):
    resolve_groups = build_group_resolver(mm)
    candidates = []
    seen = set()
    for row in hanzi_db_rows:
        ch = row.get("character", "")
        if ch in seen or not CJK_RE.match(ch):
            continue
        seen.add(ch)
        if ch not in level1 or ch not in mm:
            continue
        try:
            strokes = int(re.search(r"\d+", str(row.get("stroke_count") or "0")).group())
            rank = int(re.search(r"\d+", str(row.get("frequency_rank") or "999999")).group())
        except (AttributeError, ValueError):
            continue
        if strokes < 9 or strokes > 18:
            continue
        if rank < 250 or rank > 3500:
            continue
        groups = resolve_groups(ch)
        if not groups or len(groups) < 2:
            continue
        if sum(groups) != strokes:
            continue
        if len(groups) > 5:
            continue
        if max(groups) > 11:
            continue
        if min(groups) < 2:
            continue
        pinyin = mm[ch].get("pinyin") or [row.get("pinyin", "")]
        definition = row.get("definition") or mm[ch].get("definition") or ""
        candidates.append({
            "character": ch,
            "pinyin": pinyin[0] if pinyin else "",
            "definition": definition,
            "frequency_rank": rank,
            "stroke_count": strokes,
            "groups": groups,
            "decomposition": mm[ch].get("decomposition", ""),
            "radical": mm[ch].get("radical", row.get("radical", "")),
            "score": score_candidate(row, groups),
        })
    by_count = {count: [] for count in (2, 3, 4, 5)}
    for item in candidates:
        by_count[len(item["groups"])].append(item)
    for bucket in by_count.values():
        bucket.sort(key=lambda x: (x["score"], x["frequency_rank"]))

    chosen = []
    targets = {5: 70, 4: 170, 3: 240, 2: 20}
    used = set()
    for count in (5, 4, 3, 2):
        for item in by_count[count][:targets[count]]:
            chosen.append(item)
            used.add(item["character"])
    if len(chosen) < 500:
        remaining = sorted(
            [item for item in candidates if item["character"] not in used],
            key=lambda x: (x["score"], x["frequency_rank"]),
        )
        chosen.extend(remaining[:500 - len(chosen)])
    chosen.sort(key=lambda x: x["frequency_rank"])
    if len(chosen) < 500:
        raise RuntimeError(f"Only selected {len(chosen)} candidates")
    return chosen


def choose_context(item, word_index):
    character = item["character"]

    def build_context(word):
        if word.count(character) != 1:
            raise ValueError(f"Context override must contain {character} exactly once: {word}")
        idx = word.index(character)
        py = pinyin(word, style=Style.TONE, heteronym=False)[idx][0]
        match = next((entry for entry in word_index.get(character, []) if entry["word"] == word), None)
        freq = match["freq"] if match else 0
        tag = match["tag"] if match else "override"
        commonness = zipf_frequency(word, "zh") if zipf_frequency else 0
        return {"word": word, "ci": idx, "py": py, "word_freq": freq, "word_tag": tag, "commonness": commonness}

    if character in CONTEXT_OVERRIDES:
        return build_context(CONTEXT_OVERRIDES[character])

    candidates = []
    for word_item in word_index.get(character, []):
        word = word_item["word"]
        if word.count(character) != 1:
            continue
        idx = word.index(character)
        py = pinyin(word, style=Style.TONE, heteronym=False)[idx][0]
        length = len(word)
        tag = word_item["tag"]
        commonness = zipf_frequency(word, "zh") if zipf_frequency else 1 + len(str(word_item["freq"]))
        proper_penalty = 0.0
        if tag.startswith("nr") or tag == "nrt":
            proper_penalty = 0.35
        elif tag in {"ns", "nt", "nz", "j", "t"}:
            proper_penalty = 0.45
        length_penalty = {2: 0.0, 3: 0.08, 4: 0.16}[length]
        edge_penalty = abs(idx - (length - 1) / 2) * 0.04
        score = (-(commonness or 0) + proper_penalty + length_penalty + edge_penalty, -word_item["freq"], word)
        candidates.append((score, word, idx, py, word_item["freq"], tag, commonness))
    if not candidates:
        return {"word": character, "ci": 0, "py": item["pinyin"], "word_freq": 0, "word_tag": "", "commonness": 0}
    _, word, idx, py, freq, tag, commonness = sorted(candidates, key=lambda entry: entry[0])[0]
    return {"word": word, "ci": idx, "py": py, "word_freq": freq, "word_tag": tag, "commonness": commonness}


def fetch_char_data(ch):
    path = DATA_DIR / f"{ch}.json"
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data.get("strokes"), list):
                return data
        except Exception:
            pass
    url = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/" + urllib.parse.quote(ch) + ".json"
    last_error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except Exception as error:
            last_error = error
            time.sleep(0.4 + attempt * 0.7)
    else:
        raise last_error
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    time.sleep(0.015)
    return data


def validate_and_fetch(chosen):
    bad = []
    for item in chosen:
        data = fetch_char_data(item["character"])
        total = len(data.get("strokes", []))
        if total != sum(item["groups"]) or total != item["stroke_count"]:
            bad.append((item["character"], item["groups"], total, item["stroke_count"]))
    if bad:
        raise RuntimeError(f"Stroke mismatches: {bad[:20]}")


def js_string(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def patch_index(chosen, word_index):
    index_path = ROOT / "index.html"
    html = index_path.read_text(encoding="utf-8")

    seed = []
    for item in chosen:
        context = choose_context(item, word_index)
        item["context_word"] = context["word"]
        item["context_index"] = context["ci"]
        item["context_pinyin"] = context["py"]
        item["context_word_freq"] = context["word_freq"]
        item["context_word_tag"] = context["word_tag"]
        item["context_commonness"] = context["commonness"]
        seed.append({
            "py": context["py"],
            "hint": f"常用词语 · {item['stroke_count']}画 · {len(item['groups'])}个部件 · 字频#{item['frequency_rank']}",
            "ans": context["word"],
            "ci": context["ci"],
            "target": item["character"],
        })
    groups = {item["character"]: item["groups"] for item in chosen}

    html = re.sub(
        r"const SEED = \[[\s\S]*?\];\nconst CARDS=",
        "const SEED = " + js_string(seed) + ";\nconst CARDS=",
        html,
        count=1,
    )
    cards_block = (
        "const CARDS=[];\n"
        "SEED.forEach(w=>{ const chars=Array.from(w.ans), pys=w.py.split(/\\s+/);\n"
        "  if(Number.isInteger(w.ci)){ const ci=w.ci; CARDS.push({ word:w.ans, chars, ci, target:w.target||chars[ci], py:w.py, hint:w.hint }); return; }\n"
        "  chars.forEach((ch,ci)=>CARDS.push({ word:w.ans, chars, ci, target:ch, py:pys[ci]||w.py, hint:w.hint })); });"
    )
    html, cards_count = re.subn(
        r"const CARDS=\[\];\nSEED\.forEach[\s\S]*?\}\);\n// 每个字的部件分组",
        lambda _match: cards_block + "\n// 每个字的部件分组",
        html,
        count=1,
    )
    if cards_count != 1:
        raise RuntimeError("Could not replace CARDS generation block")
    html = re.sub(
        r"// 每个字的部件分组[\s\S]*?const GROUPS=\{[\s\S]*?\};",
        "// 每个字的部件分组（自动生成：500 个偏中等难度的常用字，按 Make Me a Hanzi matches 递归部件分组）\nconst GROUPS=" + js_string(groups) + ";",
        html,
        count=1,
    )
    html = html.replace(
        'const DECK_KEY="shizi.deck.v500"',
        'const DECK_KEY="shizi.deck.v500.struct1"',
    )
    html = html.replace(
        'const DECK_KEY="shizi.deck.v500.struct1"',
        'const DECK_KEY="shizi.deck.v500.context1"',
    )
    index_path.write_text(html, encoding="utf-8")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    GENERATED_DIR.mkdir(exist_ok=True)
    mm = read_make_me_hanzi()
    level1 = read_level1()
    rows = read_hanzi_db()
    word_index = read_context_words()
    chosen = choose_500(mm, level1, rows)
    validate_and_fetch(chosen)
    patch_index(chosen, word_index)
    (GENERATED_DIR / "selected_500_chars.json").write_text(
        json.dumps(chosen, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"selected={len(chosen)}")
    print("rank_range=", chosen[0]["frequency_rank"], chosen[-1]["frequency_rank"])
    print("stroke_range=", min(x["stroke_count"] for x in chosen), max(x["stroke_count"] for x in chosen))
    print("group_count_range=", min(len(x["groups"]) for x in chosen), max(len(x["groups"]) for x in chosen))
    print("sample=", "".join(x["character"] for x in chosen[:50]))


if __name__ == "__main__":
    main()
