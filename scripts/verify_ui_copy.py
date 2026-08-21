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
        "金菱 稍后再写",
        "之后都已独立写出",
        "看看哪些字要再练",
        "最近写不稳的字",
        "最近没写出的字",
        "清空全部数据",
        "要清空当前设备上的全部数据吗？",
        "数据已清空，可撤销本次操作",
        "用你刚写的这个字生成一张字卡。",
        "本月练习 ${monthPracticeDays",
        "本月盖章 ${monthPracticeDays",
        "累计练完 ${totalPracticeDays",
        "恢复后可撤销本次操作",
        "清空后可撤销本次操作",
        "每天写几个容易提笔忘掉的汉字，重新找回手写记忆。",
        "练过的字中字频最低的一个",
        "下一步会隐藏轮廓",
    ),
    "README.md": (
        "稍后再练用金菱",
        "「现在再写」口袋",
        "「看看哪些字要再练」",
        "10 秒到期后这份安全副本随即删除",
        "汇总年度字数",
        "最常提笔月份",
        "最生僻字",
        "最近写不稳的字",
        "清空全部数据",
        "字卡只重绘刚写的这个字",
        "本月实际练过的天数只在",
        "当月盖过章的天数和累计练完至少一组的天数",
        "练过的字中字频最低的一个",
    ),
    "ios/ShiziApp/README.md": (
        "手感诊断",
        "先描一遍",
        "描写本身不算掌握",
        "暂无字帖",
        "还没有字帖",
        "本月拾了 N 天",
        "本月练习 N 天",
        "本月盖章 N 天",
        "累计练完 N 天",
        "薄弱字口袋",
        "分享这张字帖",
        "最近写不稳的字",
    ),
    "ios/ShiziApp/DEVICE_QA.md": (
        "对错你说了算，没有考试",
        "无助手建议",
        "之前练过？恢复一份备份",
        "这几笔再对一眼",
        "「现在再写」口袋",
        "10 秒到期后安全副本被删除",
        "自动助手",
        "年度总字数",
        "最常提笔月份",
        "最生僻字",
        "最近写不稳的字",
        "清空全部数据",
        "本月练习天数只在",
        "本月盖章 N 天",
        "累计练完 N 天",
        "练过的字中字频最低的一个",
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
        "每天写几个容易提笔忘掉的汉字，重新找回手写记忆。",
    ),
}

REQUIRED_BY_FILE = {
    "index.html": (
        "打字多了",
        "第一组完成",
        "第一次就写出",
        "练字背景音",
        "字卡提示",
        "独立写对后，每天最多提示一次",
        "应用不会在后台上传",
        "暂不支持练习，已先保存记录",
        "练过的不同汉字",
        "个独立写出",
        "清空当前数据",
        "覆盖前的数据会作为一份安全副本留在当前设备",
        "操作前的数据会作为一份安全副本留在当前设备",
        "下次恢复或清空会覆盖这份副本",
        "页面底部会短暂显示「撤销恢复」",
        "页面底部会短暂显示「撤销清空」",
        "用这份笔迹做一张字卡。",
        "盖章 ${monthPracticeDays",
        "累计练习 ${totalPracticeDays",
        "每天练几个容易提笔忘掉的汉字，把这些字重新写熟。",
        "首次结果：无标记 独立写对",
        "金菱 看过提示 / 不确定",
        "个字第一次没写稳",
        "想巩固一下，可以趁现在再写一遍。",
        "看看写得不稳的字",
        "第一次不太确定",
        "第一次看过提示后写出",
        "轮廓隐藏后，再自己写一次",
        "已经练了 7 天",
        "练过的字里最少见的一个",
    ),
    "README.md": (
        "页面底部会短暂显示一次撤销入口",
        "清空当前数据",
        "安全副本不会随入口消失",
        "下次恢复或清空会覆盖它",
        "最近保存的这份笔迹",
        "沿用升级前的历史打开日，升级后只在完整练完一组的日期增加",
        "图例只说明首次结果",
        "可选的「再写一遍」口袋",
        "汇总本年练过的不同汉字数、练习天数最多的月份、练过的字里最少见的一个",
        "「写得不稳的字」",
    ),
    "ios/ShiziApp/README.md": (
        "写得不稳的字",
        "第 1 步：描红",
        "描红本身不算掌握",
        "暂不支持练习",
        "盖章 N 天",
        "累计练习 N 天",
        "存为字帖",
    ),
    "ios/ShiziApp/DEVICE_QA.md": (
        "对错由你判断，没有考试",
        "自动比对没有明确建议时",
        "练过了？恢复备份",
        "这几笔可以再和范字对照一下",
        "可选的「再写一遍」口袋",
        "点击后能完整还原操作前数据",
        "暂时无法自动对比，请和范字核对",
        "练过的不同汉字",
        "练习天数最多的月份",
        "清空当前数据",
        "撤销入口消失后，设备内安全副本仍保留",
        "用这份笔迹做一张字卡",
        "盖章 N 天",
        "累计练习 N 天",
        "练过的字里最少见的一个",
        "这一年练的第一个字",
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
        "每天练几个容易提笔忘掉的汉字，把这些字重新写熟。",
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
