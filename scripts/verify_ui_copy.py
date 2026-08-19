#!/usr/bin/env python3
"""Guard the small set of high-risk, user-facing copy changed in this PR."""

from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parent.parent

FORBIDDEN_BY_FILE = {
    "index.html": (
        "打字十年",
        "你上次写它可能是十年前",
        "这个字十年没写了",
        "第一把拾完",
        "首答会写",
        "首答没写出",
        "提交字格",
        "无辅助",
        "趁手还热",
        "最划算",
        "书房声景",
        "好字成卡提示",
        "写得好时每天最多轻提示一次",
        "绝不上传",
        "字帖还在路上",
        "这些字，都在你的笔下真实出现过",
        "字是你的手写",
        "未能保存进度，请重试返回",
        "有一份记录损坏，已隔离，其余照常",
        "没能存到相册，请检查照片权限",
        "春节的手写福与春联，留待下一阶段",
        "每天写几个你会写错的汉字",
    ),
    "ios/ShiziApp/ShiziApp/WebViewController.swift": (
        "字帖图片生成失败",
        "请确认文件内容后重试",
        "字是你的手写",
    ),
    "ios/ShiziApp/ShiziApp/Info.plist": (
        "只在本机识别与保存",
    ),
    "manifest.webmanifest": (
        "每天写几个你会写错的汉字",
    ),
}

REQUIRED_BY_FILE = {
    "index.html": (
        "打字多了",
        "第一组完成",
        "第一次就写出",
        "第一次没写出",
        "练字背景音",
        "字卡提示",
        "独立写对后，每天最多提示一次",
        "应用不会在后台上传",
        "暂不支持练习，已先保存记录",
        "练过的不同汉字",
        "个独立写出",
        "恢复后可在 10 秒内撤销",
        "清空后仅可在 10 秒内撤销",
        "每天写几个容易提笔忘掉的汉字，重新找回手写记忆。",
    ),
    "ios/ShiziApp/ShiziApp/WebViewController.swift": (
        "没能生成备份文件，请稍后重新导出。",
        "图片暂时无法生成，请稍后再试。",
        "请选择由「拾字」导出的 .json 备份文件。",
    ),
    "ios/ShiziApp/ShiziApp/Info.plist": (
        "照片默认只在当前设备处理与保存",
        "主动导出备份时会包含在备份文件中",
        "保存到系统相册",
    ),
    "manifest.webmanifest": (
        "每天写几个容易提笔忘掉的汉字，重新找回手写记忆。",
    ),
}


def main() -> int:
    checked_files = set(FORBIDDEN_BY_FILE) | set(REQUIRED_BY_FILE)
    contents = {}
    failures = []

    for relative_path in sorted(checked_files):
        path = REPO_ROOT / relative_path
        try:
            contents[relative_path] = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            failures.append(f"{relative_path}: 无法读取：{error}")

    for relative_path, phrases in FORBIDDEN_BY_FILE.items():
        content = contents.get(relative_path)
        if content is None:
            continue
        for phrase in phrases:
            if phrase in content:
                failures.append(f"{relative_path}: 仍包含旧文案「{phrase}」")

    for relative_path, phrases in REQUIRED_BY_FILE.items():
        content = contents.get(relative_path)
        if content is None:
            continue
        for phrase in phrases:
            if phrase not in content:
                failures.append(f"{relative_path}: 缺少关键新文案「{phrase}」")

    if failures:
        print("UI copy verification failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    forbidden_count = sum(map(len, FORBIDDEN_BY_FILE.values()))
    required_count = sum(map(len, REQUIRED_BY_FILE.values()))
    print(
        f"UI copy verification OK: {len(checked_files)} files, "
        f"{forbidden_count} retired phrases, {required_count} required phrases."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
