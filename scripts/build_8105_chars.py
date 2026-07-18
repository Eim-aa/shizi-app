#!/usr/bin/env python3
import json
import logging
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
GENERATED_DIR = ROOT / "generated"
SRC_DIR = ROOT / "sources"
DICT_PATH = SRC_DIR / "make-me-a-hanzi-dict.txt"
LEVEL_PATHS = [
    ("一级", SRC_DIR / "level-1.txt"),
    ("二级", SRC_DIR / "level-2.txt"),
    ("三级", SRC_DIR / "level-3.txt"),
]
HANZI_DB_PATH = SRC_DIR / "hanzi_db.json"
JIEBA_DICT_PATH = SRC_DIR / "jieba_dict.txt"
PY_DEPS = ROOT / ".python-deps"
DECK_KEY = "shizi.deck.v8105.context1"
GENERATED_JSON = "selected_8105_candidates.json"
COVERAGE_JSON = "hanzi_writer_coverage.json"
CORE_STROKE_SCRIPT = "core-strokes.js"
CORE_STROKE_COUNT = 600
CALIBRATION_CORE_CHARS = ["尴", "嚏", "狩", "晤", "飓", "痿", "俾", "跻", "徵", "瞰", "裘", "娩", "邃", "暧", "煲"]
HANZI_WRITER_FLAT_URL = "https://data.jsdelivr.com/v1/package/npm/hanzi-writer-data@2.0.1/flat"
if PY_DEPS.exists():
    sys.path.insert(0, str(PY_DEPS))

try:
    from pypinyin import Style, pinyin
except ImportError as error:
    raise SystemExit("Missing Python dependency. Run: python3 -m pip install -r requirements.txt") from error

try:
    import jieba
    jieba.setLogLevel(logging.ERROR)
    from wordfreq import top_n_list, zipf_frequency
except ImportError:
    top_n_list = None
    zipf_frequency = None

CJK_RE = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0002ebef]$")
CJK_WORD_RE = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0002ebef]{2,4}$")
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
    "啰": "啰嗦",
    "嗡": "嗡鸣",
    "叼": "叼着",
    "捌": "大写捌",
    "柒": "大写柒",
    "抡": "抡起",
    "馍": "泡馍",
    "箕": "簸箕",
    "玖": "大写玖",
    "舀": "舀水",
    "叁": "大写叁",
    "汞": "汞柱",
    "涣": "涣散",
    "闰": "闰年",
    "椿": "香椿",
    "锰": "锰矿",
    "钾": "钾肥",
    "涧": "山涧",
    "酉": "酉时",
    "贰": "大写贰",
    "壹": "大写壹",
    "馋": "嘴馋",
    "抠": "抠门",
    "糠": "米糠",
    "咦": "咦了一声",
    "赓": "赓续",
    "攥": "攥紧",
    "呸": "呸了一声",
    "啵": "啵啵",
    "蟮": "曲蟮",
    "氐": "氐族",
    "谝": "谝闲传",
    "馕": "烤馕",
    "荩": "忠荩",
    "庋": "庋藏",
    "嘭": "嘭的一声",
    "妫": "妫姓",
    "绺": "一绺头发",
    "觯": "酒觯",
    "迨": "迨至",
    "喵": "喵喵叫",
    "谖": "永矢弗谖",
    "啐": "啐了一口",
    "洹": "洹河",
    "钍": "钍矿",
    "嗵": "嗵的一声",
    "槭": "槭树",
    "匦": "铜匦",
    "窸": "窸窣",
    "诖": "诖误",
    "蛩": "蛩声",
    "嗄": "嗄声",
    "郛": "城郛",
    "鬈": "鬈发",
    "鲧": "鲧禹治水",
    "抻": "抻面",
    "笾": "笾豆",
    "跞": "卓跞",
    "擤": "擤鼻涕",
    "醢": "菹醢",
    "呦": "呦呦鹿鸣",
    "嗌": "嗌痛",
    "炝": "炝锅",
    "硐": "矿硐",
    "锸": "锸土",
    "嗾": "嗾使",
    "龀": "龆龀",
    "聃": "老聃",
    "鸫": "斑鸫",
    "噌": "噌的一声",
    "焐": "焐热",
    "腚": "光腚",
    "萋": "芳草萋萋",
    "嚯": "嚯的一声",
    "嘬": "嘬一口",
}

TOPIC_RULES = [
    ("语法", "的是不了也而于与以为因由所但或并则却该让被把将很更已可需必须此其只都又再个们",
     ["particle", "pronoun", "prefix", "suffix", "conjunction", "preposition", "demonstrative", "negative", "perhaps", "must", "should", "need", "can", "may"]),
    ("数量", "一二三四五六七八九十百千万亿零半双两数第量斤尺寸吨米克倍",
     ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "number", "measure", "count", "unit", "half", "double", "percent"]),
    ("时间", "年月日时分秒早晚晨夜春夏秋冬季节周旬昨今明先后曾始终久暂",
     ["time", "year", "month", "day", "hour", "season", "period", "era", "age", "morning", "night", "begin", "end", "early", "late", "again"]),
    ("空间", "上下左右东西南北里外前后中间边旁近远高低深浅宽窄内外围地方处所区域位空满面",
     ["place", "location", "direction", "north", "south", "east", "west", "inside", "outside", "front", "back", "middle", "center", "near", "far", "space", "surface", "boundary", "region", "area", "position", "side", "top", "bottom"]),
    ("人物", "人你我他她它们民众友亲父母兄弟姐妹儿女孩童老师学生客户宾",
     ["man", "person", "people", "human", "woman", "child", "father", "mother", "friend", "teacher", "student", "guest", "official"]),
    ("社会", "国省市县乡村区政党军警法院校社族官权证规制律战争和平公共",
     ["nation", "country", "government", "political", "law", "rule", "regulation", "court", "police", "military", "war", "peace", "society", "public", "province", "city", "county", "official"]),
    ("工作", "工业务办公司厂店职任管营作劳商课题项供给生产建设组织会议",
     ["work", "business", "office", "company", "factory", "manage", "operate", "task", "job", "profession", "labor", "commercial", "meeting", "produce", "build"]),
    ("学习", "学书文字读写课教讲问答试题考识词语句篇记论述证",
     ["learn", "study", "school", "teach", "read", "write", "book", "word", "language", "explain", "record", "remember", "knowledge", "question", "discuss"]),
    ("思维", "思想意识知觉认懂解理观点意见原因判断决定选择计划目标注意相信证明理论精神",
     ["think", "thought", "mind", "know", "understand", "reason", "decide", "judge", "choose", "plan", "idea", "meaning", "conscious", "believe", "prove", "theory"]),
    ("动作", "走跑跳飞打拿抓拉推搬转开关进出回来去看听说行过达接收取造持改变",
     ["go", "come", "move", "walk", "run", "jump", "fly", "take", "hold", "pull", "push", "turn", "open", "close", "pass", "arrive", "receive", "change", "make"]),
    ("状态", "大小多少强弱好坏难易新旧冷热快慢重轻真正常平安全完整特殊清明暗",
     ["big", "small", "many", "few", "strong", "weak", "good", "bad", "difficult", "easy", "new", "old", "hot", "cold", "fast", "slow", "heavy", "light", "true", "correct", "common", "special", "complete", "clear"]),
    ("自然", "山水江河湖海洋风雨雪云天地土石林木花草鸟鱼虫兽田禾竹火冰",
     ["mountain", "water", "river", "lake", "sea", "ocean", "wind", "rain", "snow", "cloud", "earth", "soil", "stone", "tree", "wood", "flower", "grass", "bird", "fish", "insect", "animal", "fire", "ice"]),
    ("身体", "身手足脚头眼耳口鼻牙心脑脸胸腹腰腿臂血肉皮骨目见月",
     ["body", "hand", "foot", "head", "eye", "ear", "mouth", "nose", "tooth", "heart", "brain", "face", "blood", "flesh", "bone", "skin", "see", "hear"]),
    ("情绪", "情爱恨喜怒哀乐忧惊怕恐悲笑哭烦愁悦痛苦",
     ["emotion", "love", "hate", "happy", "sad", "angry", "fear", "afraid", "laugh", "cry", "worry", "pain", "suffer"]),
    ("饮食", "饭菜肉鱼酒茶糖米面豆果瓜汤盐油饼糕餐馒馍饺",
     ["food", "eat", "drink", "rice", "meal", "meat", "fish", "wine", "tea", "sugar", "bean", "fruit", "soup", "salt", "oil", "cake"]),
    ("居家", "家房屋室门窗床桌椅衣服鞋包箱院墙宅宿",
     ["home", "house", "room", "door", "window", "bed", "table", "chair", "clothes", "shoe", "bag", "box", "wall", "residence", "family"]),
    ("交通", "车船路桥站港航机铁轨驶运递邮马驾",
     ["car", "vehicle", "ship", "road", "bridge", "station", "port", "air", "rail", "drive", "transport", "mail", "horse"]),
    ("科技", "电网机器数码讯线屏光影声磁键科",
     ["electric", "machine", "computer", "number", "digital", "signal", "screen", "light", "sound", "science", "technology"]),
    ("健康", "病医药疼痛症癌菌毒伤血疗健康",
     ["ill", "disease", "medical", "medicine", "drug", "pain", "symptom", "cancer", "poison", "wound", "health", "heal"]),
    ("文化", "诗歌戏剧画琴棋舞礼史传佛寺庙节",
     ["poem", "song", "drama", "paint", "music", "dance", "ritual", "history", "religion", "temple", "festival", "culture"]),
    ("财物", "钱金银财货资费价账贷贵贱买卖商贸币贝",
     ["money", "gold", "silver", "wealth", "price", "buy", "sell", "trade", "capital", "fee", "debt", "property"]),
    ("器物", "刀笔纸杯瓶盘锅针线衣鞋帽包箱钟灯伞锁钥镜布",
     ["tool", "knife", "pen", "paper", "clothes", "cup", "bottle", "needle", "lock", "mirror", "vessel", "container", "cloth"]),
]


def infer_topic(word, item):
    character = item["character"]
    radical = item.get("radical", "")
    definition = (item.get("definition") or "").lower()
    scores = []
    for topic, chars, keywords in TOPIC_RULES:
        score = 0
        score += sum(4 for ch in word if ch in chars)
        if character in chars:
            score += 3
        if radical and radical in chars:
            score += 0.8
        for keyword in keywords:
            pattern = r"\b" + re.escape(keyword.lower()) + r"\b"
            if re.search(pattern, definition):
                score += 3
            elif keyword.lower() in definition:
                score += 1.5
        if score:
            scores.append((score, topic))
    if scores:
        return sorted(scores, key=lambda entry: (-entry[0], entry[1]))[0][1]
    return "综合"


def calc_difficulty(item, context):
    rank = min(item["frequency_rank"], 8000)
    strokes = item["stroke_count"]
    parts = len(item["groups"])

    rank_score = math.log10(rank + 20) / math.log10(8020) * 28
    stroke_score = max(0, min(1, (strokes - 4) / 16)) * 40
    part_score = max(0, min(1, (parts - 1) / 4)) * 18
    compact_complexity = max(0, parts - 3) * 3 + sum(1 for group in item["groups"] if group <= 2 and strokes >= 10) * 1.5
    context_penalty = max(0, 4.2 - (context.get("commonness") or 0)) * 1.6
    rare_bonus = 5 if rank >= 1600 else 0
    elementary_penalty = 18 if strokes <= 6 and rank <= 800 and parts <= 2 else 0

    score = 10 + rank_score + stroke_score + part_score + compact_complexity + context_penalty + rare_bonus - elementary_penalty
    return round(max(1, min(100, score)))


def difficulty_level(score):
    if score < 35:
        return "小学"
    if score < 52:
        return "初中"
    if score < 68:
        return "高中"
    if score < 84:
        return "大学"
    return "专业"


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


def read_standard_table():
    rows = []
    seen = set()
    for level_index, (level_name, path) in enumerate(LEVEL_PATHS, start=1):
        for level_order, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            ch = line.strip()
            if not CJK_RE.match(ch) or ch in seen:
                continue
            seen.add(ch)
            rows.append({
                "character": ch,
                "norm_level": level_name,
                "norm_level_index": level_index,
                "norm_level_order": level_order,
                "standard_order": len(rows) + 1,
            })
    return rows


def read_hanzi_writer_available_chars():
    with urllib.request.urlopen(HANZI_WRITER_FLAT_URL, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    chars = set()
    for item in payload.get("files", []):
        match = re.fullmatch(r"/([^/])\.json", item.get("name", ""))
        if match:
            chars.add(match.group(1))
    return chars


def coverage_report(standard_rows, hanzi_writer_chars):
    by_level = {}
    missing = []
    for row in standard_rows:
        level = row["norm_level"]
        bucket = by_level.setdefault(level, {"total": 0, "available": 0, "missing": 0, "missing_chars": []})
        bucket["total"] += 1
        if row["character"] in hanzi_writer_chars:
            bucket["available"] += 1
        else:
            bucket["missing"] += 1
            bucket["missing_chars"].append(row["character"])
            missing.append({"character": row["character"], "norm_level": level, "standard_order": row["standard_order"]})
    total = len(standard_rows)
    available = total - len(missing)
    return {
        "source": "通用规范汉字表 2013（sources/level-1.txt, level-2.txt, level-3.txt）",
        "hanzi_writer_data": HANZI_WRITER_FLAT_URL,
        "total": total,
        "available": available,
        "missing": len(missing),
        "by_level": by_level,
        "missing_chars": missing,
    }


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
    by_word = {}

    def add_word(word, freq, tag):
        if not CJK_WORD_RE.match(word):
            return
        current = by_word.get(word)
        if current is None:
            by_word[word] = {"word": word, "freq": freq, "tag": tag}
        elif freq > current["freq"]:
            current["freq"] = freq
            if current.get("tag") == "wf":
                current["tag"] = tag

    for line in JIEBA_DICT_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        word = parts[0]
        try:
            freq = int(parts[1])
        except ValueError:
            continue
        tag = parts[2] if len(parts) >= 3 else ""
        add_word(word, freq, tag)

    if top_n_list:
        for rank, word in enumerate(top_n_list("zh", 500000), start=1):
            # Use wordfreq as a recall net for common compounds missing from jieba.
            # The pseudo-frequency only ranks these supplemental words among themselves.
            add_word(word, 500001 - rank, "wf")

    by_char = {}
    for item in by_word.values():
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


def parse_first_int(value, fallback=0):
    match = re.search(r"\d+", str(value or ""))
    return int(match.group()) if match else fallback


def score_candidate(row, groups):
    rank = parse_first_int(row.get("frequency_rank"), 99999)
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


def choose_candidates(mm, standard_rows, hanzi_db_rows, hanzi_writer_chars):
    resolve_groups = build_group_resolver(mm)
    rows_by_char = {}
    for row in hanzi_db_rows:
        ch = row.get("character", "")
        if CJK_RE.match(ch) and ch not in rows_by_char:
            rows_by_char[ch] = row

    candidates = []
    skipped = {"no_hanzi_writer": [], "no_make_me_hanzi": [], "stroke_mismatch": []}
    for standard in standard_rows:
        ch = standard["character"]
        if ch not in hanzi_writer_chars:
            skipped["no_hanzi_writer"].append(standard)
            continue
        if ch not in mm:
            skipped["no_make_me_hanzi"].append(standard)
            continue
        row = rows_by_char.get(ch, {})
        strokes = parse_first_int(row.get("stroke_count"), len(mm[ch].get("matches") or []))
        rank = parse_first_int(row.get("frequency_rank"), 999999 + standard["standard_order"])
        groups = resolve_groups(ch)
        if sum(groups) != strokes:
            skipped["stroke_mismatch"].append({**standard, "groups": groups, "stroke_count": strokes})
            continue
        pinyin = mm[ch].get("pinyin") or [row.get("pinyin", "")]
        definition = row.get("definition") or mm[ch].get("definition") or ""
        candidates.append({
            "character": ch,
            "pinyin": pinyin[0] if pinyin else "",
            "definition": definition,
            "frequency_rank": rank,
            "standard_order": standard["standard_order"],
            "norm_level": standard["norm_level"],
            "norm_level_index": standard["norm_level_index"],
            "norm_level_order": standard["norm_level_order"],
            "stroke_count": strokes,
            "groups": groups,
            "decomposition": mm[ch].get("decomposition", ""),
            "radical": mm[ch].get("radical", row.get("radical", "")),
            "score": score_candidate(row, groups),
        })
    candidates.sort(key=lambda x: (x["frequency_rank"], x["norm_level_index"], x["standard_order"]))
    return candidates, skipped


def choose_context(item, word_index):
    character = item["character"]

    def build_context(word, source):
        if character not in word:
            raise ValueError(f"Context must contain {character}: {word}")
        idx = word.index(character)
        py = pinyin(word, style=Style.TONE, heteronym=False)[idx][0]
        match = next((entry for entry in word_index.get(character, []) if entry["word"] == word), None)
        freq = match["freq"] if match else 0
        tag = match["tag"] if match else "override"
        commonness = zipf_frequency(word, "zh") if zipf_frequency else 0
        return {"word": word, "ci": idx, "py": py, "word_freq": freq, "word_tag": tag, "commonness": commonness, "context_source": source}

    if character in CONTEXT_OVERRIDES:
        return build_context(CONTEXT_OVERRIDES[character], "override")

    candidates = []
    for word_item in word_index.get(character, []):
        word = word_item["word"]
        if character not in word:
            continue
        idx = word.index(character)
        py = pinyin(word, style=Style.TONE, heteronym=False)[idx][0]
        length = len(word)
        tag = word_item["tag"]
        commonness = zipf_frequency(word, "zh") if zipf_frequency else 1 + len(str(word_item["freq"]))
        proper_penalty = 0.0
        if tag.startswith("nr") or tag == "nrt":
            proper_penalty = 2.0
        elif tag in {"ns", "nt", "nz", "j", "t"}:
            proper_penalty = 0.8
        frequency_signal = math.log10(word_item["freq"] + 1)
        commonness_signal = commonness if commonness >= 3 else commonness * 0.25
        idiom_like = length == 4 and (tag in {"i", "l"} or commonness >= 2.8)
        length_penalty = 0.04 if idiom_like else {2: 0.0, 3: 0.08, 4: 0.16}[length]
        edge_penalty = abs(idx - (length - 1) / 2) * 0.04
        repeat_penalty = max(0, word.count(character) - 1) * 0.35
        score = (-(commonness_signal + 0.8 * frequency_signal) + proper_penalty + length_penalty + edge_penalty + repeat_penalty, -word_item["freq"], word)
        candidates.append((score, word, idx, py, word_item["freq"], tag, commonness))
    if not candidates:
        fallback = f"{character}字" if character != "字" else "汉字"
        return build_context(fallback, "fallback")
    _, word, idx, py, freq, tag, commonness = sorted(candidates, key=lambda entry: entry[0])[0]
    return {"word": word, "ci": idx, "py": py, "word_freq": freq, "word_tag": tag, "commonness": commonness, "context_source": "dict"}


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

    def check(item):
        data = fetch_char_data(item["character"])
        total = len(data.get("strokes", []))
        if total != sum(item["groups"]) or total != item["stroke_count"]:
            return (item["character"], item["groups"], total, item["stroke_count"])
        return None

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(check, item) for item in chosen]
        for future in as_completed(futures):
            result = future.result()
            if result:
                bad.append(result)
    if bad:
        raise RuntimeError(f"Stroke mismatches: {bad[:20]}")


def js_string(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def patch_index(chosen, word_index):
    """生成 deck-data.js（SEED/GROUPS 题库数据），并同步 index.html 里的 DECK_KEY。

    题库数据独立成文件后，index.html 只含界面与逻辑（~90KB）；
    数据更新时记得 bump sw.js 的 VERSION，旧缓存才会整体换新。
    """
    index_path = ROOT / "index.html"
    data_path = ROOT / "deck-data.js"
    core_path = ROOT / CORE_STROKE_SCRIPT
    html = index_path.read_text(encoding="utf-8")

    seed = []
    for item in chosen:
        context = choose_context(item, word_index)
        topic = infer_topic(context["word"], item)
        difficulty = calc_difficulty(item, context)
        level = difficulty_level(difficulty)
        item["context_word"] = context["word"]
        item["context_index"] = context["ci"]
        item["context_pinyin"] = context["py"]
        item["context_word_freq"] = context["word_freq"]
        item["context_word_tag"] = context["word_tag"]
        item["context_commonness"] = context["commonness"]
        item["context_source"] = context["context_source"]
        item["topic"] = topic
        item["difficulty"] = difficulty
        item["level"] = level
        seed.append({
            "py": context["py"],
            "hint": f"{item['norm_level']} · {level} · 常用语境 · {item['stroke_count']}画 · {len(item['groups'])}个部件 · 字频#{item['frequency_rank'] if item['frequency_rank'] < 999999 else '未收录'}",
            "ans": context["word"],
            "ci": context["ci"],
            "target": item["character"],
            "rank": item["frequency_rank"],
            "strokes": item["stroke_count"],
            "parts": len(item["groups"]),
            "topic": topic,
            "d": difficulty,
            "level": level,
            "common": round(context["commonness"] or 0, 2),
            "norm": item["norm_level"],
            "std": item["standard_order"],
            "ctx": context["context_source"],
        })
    groups = {item["character"]: item["groups"] for item in chosen}

    data_path.write_text(
        "// 拾字题库数据（由 scripts/build_8105_chars.py 生成，勿手改）\n"
        "// SEED：候选字词卡（拼音/语境词/难度/主题/规范等级）\n"
        "const SEED = " + js_string(seed) + ";\n"
        f"// 每个字的部件分组（自动生成：{len(chosen)} 个通用规范汉字候选，按 Make Me a Hanzi matches 递归部件分组）\n"
        "const GROUPS=" + js_string(groups) + ";\n",
        encoding="utf-8",
    )
    core_path.write_text(
        "// 由 scripts/build_8105_chars.py 同步生成：首日校准字优先，再按题库字频补满 600 字。\n"
        "(function(scope){\n"
        f"  const calibration={js_string(CALIBRATION_CORE_CHARS)};\n"
        f"  scope.SHIZI_CORE_STROKES=[...new Set([...calibration,...SEED.slice().sort((a,b)=>a.rank-b.rank).map(card=>card.target)])].slice(0,{CORE_STROKE_COUNT});\n"
        "})(self);\n",
        encoding="utf-8",
    )

    html, key_count = re.subn(
        r'const DECK_KEY="[^"]+"',
        f'const DECK_KEY="{DECK_KEY}"',
        html,
        count=1,
    )
    if key_count != 1:
        raise RuntimeError("Could not update DECK_KEY in index.html")
    index_path.write_text(html, encoding="utf-8")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    GENERATED_DIR.mkdir(exist_ok=True)
    mm = read_make_me_hanzi()
    standard_rows = read_standard_table()
    rows = read_hanzi_db()
    word_index = read_context_words()
    hanzi_writer_chars = read_hanzi_writer_available_chars()
    coverage = coverage_report(standard_rows, hanzi_writer_chars)
    (GENERATED_DIR / COVERAGE_JSON).write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    chosen, skipped = choose_candidates(mm, standard_rows, rows, hanzi_writer_chars)
    if not chosen:
        raise RuntimeError("No candidates selected")
    validate_and_fetch(chosen)
    patch_index(chosen, word_index)
    (GENERATED_DIR / GENERATED_JSON).write_text(
        json.dumps({"selected": chosen, "skipped": skipped}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"selected={len(chosen)}")
    print(f"standard_total={coverage['total']} hanzi_writer_available={coverage['available']} missing={coverage['missing']}")
    for level, item in coverage["by_level"].items():
        print(f"{level}: total={item['total']} available={item['available']} missing={item['missing']}")
    print("skipped_no_make_me_hanzi=", len(skipped["no_make_me_hanzi"]))
    print("skipped_stroke_mismatch=", len(skipped["stroke_mismatch"]))
    print("rank_range=", chosen[0]["frequency_rank"], chosen[-1]["frequency_rank"])
    print("stroke_range=", min(x["stroke_count"] for x in chosen), max(x["stroke_count"] for x in chosen))
    print("group_count_range=", min(len(x["groups"]) for x in chosen), max(len(x["groups"]) for x in chosen))
    print("norm_counts=", {level: sum(1 for x in chosen if x["norm_level"] == level) for level, _ in LEVEL_PATHS})
    print("sample=", "".join(x["character"] for x in chosen[:50]))


if __name__ == "__main__":
    main()
