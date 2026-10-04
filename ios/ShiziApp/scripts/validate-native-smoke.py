#!/usr/bin/env python3
"""Validate one stage of the DEBUG native WKWebView smoke (02 M5-3; 01 §8.2, §11).

The smoke script lives in ShiziApp/NativeSmoke.swift (Debug only). It drives the v10 page through the
public test hooks (window.__shiziTest, data-testid, bridge) and writes Documents/shizi-native-smoke.json.

Stages (smoke-simulator.sh / smoke-device.sh run them in this order):
  main      module load + fetch, localStorage, write one character and judge it, reload restore,
            edge back (refused on the write page, allowed on a sub page), backup export / restore / undo
            without reload, R-B06 for non-backup / >10 MB / cancelled picks, syncReminder, image save.
  relaunch  a second process launch still sees the smoke key and the records from `main`.
  deeplink  cold start with a reminder target: native dispatches after pageReady, clears the key only
            when the page returned true, and the page opens that character.
  restore   (device QA, Q32) write one stroke, reach the judge page, wait until shizi.v2.route and the
            session are persisted; smoke-device.sh then SIGKILLs the process (like swipe-to-kill).
  restorecheck  cold start after the kill lands back on the write page in the judge phase (F1 route restore).
  measure   (device QA, T1 non-touch part) 5 s rAF interval distribution on the idle home page and while
            synthetic strokes are drawn, page-visible hardware / media queries, the brush-detail decision,
            the text-size injection (P1-E6b) and native deviceInfo. Structural checks only: numbers are recorded,
            not judged.
  cleanup   (device) syncReminder enabled:false so the reminders `main` really scheduled are removed.
Release artifacts without __shiziNativeDev are checked by verify-archive.sh (not by this file).

Usage: validate-native-smoke.py RESULT.json STAGE [--allow-photos-denied]
"""

import json
import sys

STAGES = ("main", "relaunch", "deeplink", "restore", "restorecheck", "measure", "cleanup")
NOT_BACKUP = "notBackup"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 2 or args[1] not in STAGES or flags - {"--allow-photos-denied"}:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 64
    path, stage = args
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    checks = {"noError": not data.get("error"), "stage": data.get("stage") == stage}
    if stage == "main":
        checks.update(main_checks(data, "--allow-photos-denied" in flags))
    elif stage == "relaunch":
        checks.update(relaunch_checks(data))
    elif stage == "restore":
        checks.update(restore_checks(data))
    elif stage == "restorecheck":
        checks.update(restorecheck_checks(data))
    elif stage == "measure":
        checks.update(measure_checks(data))
    elif stage == "cleanup":
        c = data.get("cleanup") or {}
        checks["remindersCleared"] = c.get("sent") is True and c.get("enabled") is False and c.get("plannedDays") == []
    else:
        checks.update(deeplink_checks(data))

    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        print(f"Native WKWebView smoke ({stage}) failed: " + ", ".join(failed), file=sys.stderr)
        print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
        return 65
    print(f"Native WKWebView smoke ({stage}): {len(checks)} checks passed")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def main_checks(data: dict, allow_photos_denied: bool) -> dict:
    boot = data.get("boot") or {}
    storage = data.get("storage") or {}
    write = data.get("write") or {}
    reload = data.get("reload") or {}
    edge = data.get("edgeBack") or {}
    backup = data.get("backup") or {}
    restore = data.get("restore") or {}
    reject = data.get("reject") or {}
    copy = reject.get("copy") or {}
    reminder = data.get("reminder") or {}
    image = data.get("image") or {}
    native = data.get("native") or {}

    def rejected(name: str, reason: str, kind: str) -> bool:
        row = reject.get(name) or {}
        expected = copy.get(kind)
        return row.get("reason") == reason and row.get("kind") == kind and bool(expected) and row.get("text") == expected

    planned = reminder.get("plannedDays")
    return {
        # 模块加载 / fetchOk（shizi-resource:// 下的 ES 模块、经典脚本全局、笔顺 JSON、字体）
        "moduleLoad": boot.get("bridgeReady") is True
        and boot.get("nativeGlobals") is True
        and isinstance(boot.get("topScreen"), str)
        and bool(boot.get("topScreen")),
        "testHost": boot.get("testQuery") is True and boot.get("nativeDev") is True and boot.get("testHooks") is True,
        "deckGlobals": int(boot.get("seed") or 0) >= 7294
        and int(boot.get("groups") or 0) >= 7294
        and int(boot.get("contextOverrides") or 0) > 0
        and int(boot.get("coreStrokes") or 0) >= 600
        and boot.get("hanziWriter") is True,
        "fetchOk": boot.get("fetchOk") is True and int(boot.get("strokeCount") or 0) > 0,
        "fontLoaded": int(boot.get("fontFaces") or 0) > 0,
        "buildReady": bool(boot.get("buildReady")) and boot.get("buildReady") == boot.get("buildMeta"),
        "noServiceWorker": boot.get("serviceWorkerController") is False,
        # localStorage
        "localStorageWritable": storage.get("writable") is True and storage.get("storeAvailable") is True,
        # 写一字判断（合成指针事件 → 写好了 → 写对了 → judged 记录；第二字写错）
        "writeJudge": write.get("seeded") is True
        and write.get("judgedChar") == "永"
        and write.get("judgment") == "correct"
        and write.get("cardKey") == "base:永"
        and write.get("advanced") is True,
        "writeJudgeSecond": write.get("secondJudged") == ["和:wrong", "永:correct"],
        # 刷新恢复（W10）
        "reloadRestore": reload.get("topScreen") == "write"
        and reload.get("cursor") == "1"
        and reload.get("phase") == "recall"
        and reload.get("strokes") == 1,
        # 边缘返回：写字页整页门控 false → 原生拒绝；子页 → 派发 shizi-native-back → 页面返回一层
        "edgeBackGateOnWrite": edge.get("writeAllowed") is False
        and edge.get("writeStayed") is True
        and edge.get("writeGateSent") is False,
        "edgeBackOnSubpage": edge.get("subpageAllowed") is True
        and edge.get("subpageFired") is True
        and edge.get("poppedTo") not in (None, "backup", "write"),
        "edgeGestureInstalled": native.get("edgeGestureInstalled") is True
        and native.get("edgeGestureDelegate") is True
        and native.get("edgeGestureLeft") is True
        and native.get("backForwardGesturesDisabled") is True,
        # 备份导出（原生 shareBackup → markBackupExported）
        "backupExport": backup.get("written") is True
        and backup.get("app") == "shizi"
        and backup.get("version") == 2
        and backup.get("hasRecords") is True
        and backup.get("markedExported") is True,
        "backupExcludesSmokeKey": backup.get("excludesSmokeKey") is True and backup.get("excludesSafety") is True,
        # 备份导入：原生选文件（预检）→ shiziBackupPicked → 页内确认 → 替换 → 撤销，全程不 reload
        "backupImport": restore.get("delivered") is True
        and restore.get("confirmMode") == "replace"
        and restore.get("replacedMatchesBackup") is True
        and restore.get("judgedAfterReplace") == ["永"]
        and restore.get("undone") is True
        and restore.get("noReload") is True
        and restore.get("stayedOnBackup") is True,
        # R-B06：非备份文件 / 不是拾字的 JSON / 超过 10MB / 取消
        "backupRejectInvalid": rejected("invalid", "invalid", NOT_BACKUP),
        "backupRejectNotShizi": rejected("notShizi", "invalid", NOT_BACKUP),
        "backupRejectTooLarge": rejected("tooLarge", "tooLarge", NOT_BACKUP),
        "backupRejectCancelled": rejected("cancel", "cancelled", "cancelled"),
        "backupRejectNoReload": reject.get("noReload") is True,
        # syncReminder：页面下发 → Swift 解析与排期（同一个纯函数）
        "syncReminder": reminder.get("sent") is True
        and reminder.get("enabled") is True
        and isinstance(reminder.get("hour"), int)
        and 0 <= reminder.get("hour") <= 23
        and isinstance(reminder.get("minute"), int)
        and 0 <= reminder.get("minute") <= 59
        and reminder.get("validQuestions") == reminder.get("rawQuestions")
        and isinstance(planned, list)
        and len(planned) <= 7
        and (reminder.get("validQuestions", 0) == 0 or len(planned) > 0),
        "openAppSettings": reminder.get("openAppSettings") is True,
        # 图片保存：savePracticeCard → 相册 → shiziCardSaved（bridge.markReady 之后正常交付）
        "imageSave": image.get("via") == "native"
        and (
            (image.get("ok") is True and image.get("nativeSuccess") is True)
            or (allow_photos_denied and image.get("ok") is False and image.get("nativeSuccess") is False)
        ),
        # 所有写入经 storage.js（冒烟自己的 nativeSmoke 键除外）
        "noDirectWrites": data.get("directWrites") == [],
    }


def relaunch_checks(data: dict) -> dict:
    persist = data.get("persist") or {}
    return {
        "localStoragePersisted": isinstance(persist.get("smokeKey"), str) and bool(persist.get("smokeKey")),
        "recordsPersisted": persist.get("judged") == ["和:wrong", "永:correct"],
        "sessionPersisted": persist.get("sessionA") is True,
        "backupMetaPersisted": int(persist.get("lastExportAt") or 0) > 0,
    }


def deeplink_checks(data: dict) -> dict:
    link = data.get("deeplink") or {}
    session = link.get("sessionB") or {}
    queue = session.get("queue") or []
    return {
        "reminderDispatched": link.get("cardKey") == "base:春" and link.get("accepted") is True,
        "reminderKeyCleared": link.get("cleared") is True,
        "reminderHandled": link.get("handlerRegistered") is True and link.get("pendingInBridge") == [],
        "reminderOpensTarget": "base:春" in queue,
    }


def restore_checks(data: dict) -> dict:
    r = data.get("restore") or {}
    return {
        "armedOnJudgePage": r.get("armed") is True and r.get("topScreen") == "write" and r.get("phase") == "compare",
        "routePersisted": "write" in (r.get("routeStack") or []),
        "sessionPersisted": r.get("sessionPhase") == "compare" and r.get("sessionStrokes") == 1,
    }


def restorecheck_checks(data: dict) -> dict:
    c = data.get("restoreCheck") or {}
    return {
        "restoredToWrite": c.get("restored") is True and c.get("topScreen") == "write",
        "restoredJudgePhase": c.get("phase") == "compare" and c.get("judgeButtons") is True,
        "restoredCursor": c.get("cursor") == "0",
        "strokesKept": c.get("sessionStrokes") == 1,
    }


def measure_checks(data: dict) -> dict:
    def sample_ok(s: dict) -> bool:
        return int(s.get("frames") or 0) > 30 and all(isinstance(s.get(k), (int, float)) for k in ("medianMs", "p95Ms", "maxMs"))

    env = data.get("env") or {}
    text = data.get("textSize") or {}
    native = data.get("native") or {}
    return {
        "rafIdleHome": sample_ok(data.get("rafIdleHome") or {}),
        "rafWriteDrawing": sample_ok(data.get("rafWriteDrawing") or {})
        and int((data.get("rafWriteDrawing") or {}).get("syntheticStrokes") or 0) > 0,
        "envRecorded": isinstance(env.get("devicePixelRatio"), (int, float))
        and isinstance(env.get("brushDetailEnabled"), bool)
        and isinstance(env.get("prefersReducedMotion"), bool)
        and isinstance(env.get("prefersContrastMore"), bool),
        "textSizeRecorded": "kComputed" in text and "initialContentSize" in text,
        "nativeDeviceInfo": isinstance(native.get("maximumFramesPerSecond"), int) and bool(native.get("machine")),
    }


if __name__ == "__main__":
    raise SystemExit(main())
