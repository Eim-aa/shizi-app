#!/usr/bin/env python3
"""privacy.html / support.html 的事实门禁。

#133 的验收里有一条：「隐私政策的每一句都能在代码里找到对应行为（逐条对照一次）」。
对照一次是不够的——政策是对用户的承诺，代码会继续往前走。这里把政策里那些
**可机器核对**的断言钉回代码，任何一条不再成立就让门禁红，逼着政策同步改。

覆盖的断言：零外部域名、只读同源 data/、无 Cookie/IndexedDB/信标/定位、
原生层不联网、隐私清单声明为空、以及「导出备份会包含拍字照片」这条负面承诺。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "index.html"
WORKER = ROOT / "sw.js"
PRIVACY = ROOT / "privacy.html"
SUPPORT = ROOT / "support.html"
SWIFT_DIR = ROOT / "ios" / "ShiziApp" / "ShiziApp"
MANIFEST = SWIFT_DIR / "PrivacyInfo.xcprivacy"
INFO_PLIST = SWIFT_DIR / "Info.plist"

# XML 命名空间不是网络请求，是 SVG 规范里的固定标识符。
ALLOWED_URLS = {"http://www.w3.org/2000/svg"}

failures: list[str] = []


def check(condition: bool, message: str, details: object = None) -> None:
    if not condition:
        failures.append(f"{message}{'' if details is None else f': {details!r}'}")


def main() -> int:
    for path in (APP, WORKER, PRIVACY, SUPPORT, MANIFEST, INFO_PLIST):
        check(path.exists(), f"缺少 {path.relative_to(ROOT)}")
    if failures:
        for item in failures:
            print(f"[privacy] 失败：{item}", file=sys.stderr)
        return 1

    app = APP.read_text(encoding="utf-8")
    worker = WORKER.read_text(encoding="utf-8")
    privacy = PRIVACY.read_text(encoding="utf-8")
    support = SUPPORT.read_text(encoding="utf-8")

    # ① 「全文没有任何外部域名」
    for label, source in (("index.html", app), ("sw.js", worker)):
        urls = set(re.findall(r"https?://[^\s\"'`<>()]+", source)) - ALLOWED_URLS
        check(not urls, f"{label} 出现了外部地址，隐私政策「不向任何第三方发送数据」不再成立", sorted(urls)[:5])

    # ② 「全部网络请求都指向同源 data/」
    # 钉不变量，不钉"三处"这种实现细节——#151 把 fetch 包了一层超时控制，
    # 请求依然同源，但数量和字面量都变了。写死数字只会误伤正当改动。
    targets = [re.split(r",", raw, 1)[0].strip() for raw in re.findall(r"fetch\(([^)]*)", app)]
    for target in targets:
        same_origin = "data/" in target
        # 裸标识符（局部变量或函数参数）交给断言 ① 兜底：全文没有外部域名，
        # 它就不可能被赋成第三方地址。带协议或拼接域名的写法一律拒绝。
        opaque = bool(re.fullmatch(r"[A-Za-z_$][\w$.]*", target))
        check(same_origin or opaque, "出现了可能不同源的 fetch()", target[:80])
    check("'data/'+encodeURIComponent(char)+'.json'" in app,
          "charLoader 不再由同源 data/ 拼出路径，隐私政策需重新核对")

    # ③ 明确承诺"没有"的能力
    for pattern, claim in (
        (r"\bXMLHttpRequest\b", "没有 XMLHttpRequest"),
        (r"\bsendBeacon\b", "没有 sendBeacon"),
        (r"\bnew WebSocket\b", "没有 WebSocket"),
        (r"\bdocument\.cookie\b", "不使用 Cookie"),
        (r"\bindexedDB\b", "不使用 IndexedDB"),
        (r"\bgeolocation\b", "不读取定位"),
    ):
        check(not re.search(pattern, app), f"隐私政策「{claim}」不再成立")

    # ④ 原生层不联网
    swift = "\n".join(p.read_text(encoding="utf-8") for p in sorted(SWIFT_DIR.glob("*.swift")))
    check("URLSession" not in swift, "iOS 原生层出现 URLSession，隐私政策「原生层不发起任何网络请求」不再成立")
    check("VNRecognizeTextRequest" in swift, "拍字识别不再走本机 Vision，「照片不上传、本机识别」需重新核对")

    # ⑤ 隐私清单必须仍然声明为空
    manifest = MANIFEST.read_text(encoding="utf-8")
    check("<key>NSPrivacyTracking</key>\n\t<false/>" in manifest.replace("    ", "\t"),
          "PrivacyInfo.xcprivacy 不再声明 NSPrivacyTracking = false")
    for key in ("NSPrivacyCollectedDataTypes", "NSPrivacyTrackingDomains", "NSPrivacyAccessedAPITypes"):
        check(re.search(rf"<key>{key}</key>\s*<array/>", manifest) is not None,
              f"PrivacyInfo.xcprivacy 的 {key} 不再为空，隐私政策需同步")

    # ⑥ 负面承诺：导出备份确实会带上拍字照片，这条警告必须留着
    check(re.search(r"const BACKUP_KEYS=\[[^\]]*WILD_KEY", app) is not None,
          "WILD_KEY 已不在 BACKUP_KEYS 中：隐私政策里「导出备份会包含照片」的警告变成了过度警告，应改")
    # 泛泛地找"照片"两个字不够：页面别处也在讲照片，那条具体警告没了照样能过。
    # 这里钉死承载警告的那一句本身。
    check("照片会包含在这个文件中" in privacy,
          "privacy.html 丢掉了「导出备份时照片会包含在文件中」这句具体警告")
    check("还包含你拍下的照片" in support,
          "support.html 丢掉了「贴备份到公开 issue 会带上照片」这句具体警告")
    check("NSCameraUsageDescription" in INFO_PLIST.read_text(encoding="utf-8"),
          "Info.plist 缺少相机用途说明")

    # ⑦ 支持页写了「提醒默认关」
    check("r.enabled=r.enabled===true" in app, "提醒不再默认关，support.html 的说法需同步")

    # ⑧ 两个页面自包含：GitHub Pages 上不能依赖任何外部资源
    for source, label in ((privacy, "privacy.html"), (support, "support.html")):
        external = [u for u in re.findall(r'(?:src|href)="(https?://[^"]+)"', source)
                    if not u.startswith("https://github.com/Eim-aa/shizi-app")]
        check(not external, f"{label} 引用了外部资源，静态页必须自包含", external[:3])

    if failures:
        for item in failures:
            print(f"[privacy] 失败：{item}", file=sys.stderr)
        return 1
    print(f"[privacy] 隐私声明与代码一致：{len(targets)} 处 fetch 均同源、零外部域名、"
          "原生层不联网、隐私清单为空、备份含照片的警告仍然准确")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
