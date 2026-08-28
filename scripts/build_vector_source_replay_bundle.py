#!/usr/bin/env python3
"""Freeze the exact human-accepted candidate bytes needed for clean-clone replay."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RECORDS_PATH = ROOT / "audit/vector-data-460-evidence/records.json"
DEFAULT_OUTPUT = ROOT / "audit/vector-data-381-accepted-source-replay.json.gz"
EXPECTED_ROUTES = {"animcjk_363": 363, "moe_stroke_svg_10": 10, "human_generated_8": 8}


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-root",
        type=Path,
        required=True,
        help="Historical worktree root containing the tmp/vector-mve candidate paths",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    evidence = json.loads(RECORDS_PATH.read_text(encoding="utf-8"))
    frozen = []
    routes: Counter[str] = Counter()

    for record in evidence["records"]:
        review = record["human_review"]
        if "accepted_source_sha256" not in review or "accepted_target_sha256" in review:
            continue

        historical_path = record["source_fingerprint"]["historical_path"]
        source_path = args.source_root / historical_path
        source_bytes = source_path.read_bytes()
        source_sha256 = sha256_bytes(source_bytes)
        if source_sha256 != review["accepted_source_sha256"]:
            raise ValueError(f"accepted source hash mismatch: {record['character']}")

        source_payload = json.loads(source_bytes)
        target_payload = json.loads((ROOT / record["target"]["path"]).read_bytes())
        if source_payload.get("strokes") != target_payload.get("strokes"):
            raise ValueError(f"source/target strokes differ: {record['character']}")
        if source_payload.get("medians") != target_payload.get("medians"):
            raise ValueError(f"source/target medians differ: {record['character']}")

        routes[record["route"]] += 1
        frozen.append(
            {
                "character": record["character"],
                "route": record["route"],
                "historical_path": historical_path,
                "accepted_source_sha256": source_sha256,
                "payload_base64": base64.b64encode(source_bytes).decode("ascii"),
            }
        )

    if dict(routes) != EXPECTED_ROUTES or len(frozen) != 381:
        raise ValueError(f"unexpected replay scope: records={len(frozen)} routes={dict(routes)}")

    bundle = {
        "schema_version": 1,
        "artifact": "shizi-vector-data-381-accepted-source-replay",
        "records": sorted(frozen, key=lambda row: ord(row["character"])),
    }
    serialized = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, compresslevel=9, mtime=0) as archive:
        archive.write(serialized)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(compressed.getvalue())
    try:
        display_output = str(args.output.relative_to(ROOT))
    except ValueError:
        display_output = str(args.output)
    print(
        json.dumps(
            {
                "output": display_output,
                "records": len(frozen),
                "routes": dict(routes),
                "sha256": sha256_bytes(compressed.getvalue()),
                "bytes": len(compressed.getvalue()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
