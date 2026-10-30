"""L1 · 从 v1 发布产物生成 catalog.json / templates.json，并把 37 条切片复制进插件。

只读（v1）：
  03-tagged/aligned.tsv       status=ok 的 37 行（含 21/38 的 pro-accepted note）
  07-release/manifest.json    id / sha256 / bytes
  07-release/clips/CN_*.wav

产出（本插件）：
  assets/catalog.json         version 2，schema 对齐 columbina-voice
  assets/templates.json       {version, templates:[{trigger, ids:[...]}]}
  assets/clips/CN_*.wav       原样复制，不转码

运行：
  <bundled python> tools/build_catalog.py
断言失败直接非零退出。
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
V1 = Path(r"E:\AI-theme\muelsyse\.assets-src\voice\v1")
ALIGNED = V1 / "03-tagged" / "aligned.tsv"
MANIFEST = V1 / "07-release" / "manifest.json"
RELEASE_CLIPS = V1 / "07-release" / "clips"
OUT_CLIPS = PLUGIN / "assets" / "clips"
EXPECTED = 37


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(msg: str) -> None:
    print(f"STOP: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    if not ALIGNED.exists() or not MANIFEST.exists():
        fail(f"缺输入：{ALIGNED} / {MANIFEST}")

    rows = [r for r in csv.DictReader(open(ALIGNED, encoding="utf-8"), delimiter="\t")
            if r["status"] == "ok"]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    by_idx = {str(item["prts_idx"]): item for item in manifest["items"]}

    if len(rows) != EXPECTED:
        fail(f"aligned.tsv ok 行 {len(rows)} != {EXPECTED}")
    if len(manifest["items"]) != EXPECTED:
        fail(f"manifest {len(manifest['items'])} != {EXPECTED}")

    OUT_CLIPS.mkdir(parents=True, exist_ok=True)
    for stale in OUT_CLIPS.glob("CN_*.wav"):
        stale.unlink()

    clips, seen = [], set()
    for r in sorted(rows, key=lambda x: int(x["prts_idx"])):
        idx = str(int(r["prts_idx"]))
        name = f"CN_{int(idx):03d}.wav"
        if name in seen:
            fail(f"id 重复：{name}")
        seen.add(name)
        item = by_idx.get(idx)
        if item is None:
            fail(f"manifest 里没有 {idx}")
        src = RELEASE_CLIPS / name
        if not src.exists():
            fail(f"缺切片：{src}")
        got = sha256(src)
        if got != item["sha256"]:
            fail(f"sha256 不一致：{name} file={got[:12]} manifest={item['sha256'][:12]}")
        dst = OUT_CLIPS / name
        shutil.copyfile(src, dst)
        if sha256(dst) != got:
            fail(f"复制后 sha256 不一致：{name}")

        entry = {
            "id": f"CN_{int(idx):03d}",
            "file": f"clips/{name}",
            "text": r["ja_text"],
            "asrText": r["whisper_ja"],
            "cnText": r["cn_text"],
            "duration": round(float(r["dur_s"]), 3),
            "sourceStart": round(int(r["source_start_ms"]) / 1000, 3),
            "sourceEnd": round(int(r["source_end_ms"]) / 1000, 3),
            "tags": [r["trigger"]],
            "stem": "vocals",
        }
        if (r.get("note") or "").strip():
            entry["note"] = r["note"].strip()
        clips.append(entry)

    manifest_ids = {f"CN_{int(i['prts_idx']):03d}" for i in manifest["items"]}
    if {c["id"] for c in clips} != manifest_ids:
        fail("catalog id 集合与 manifest 不一致")

    groups: dict[str, list[str]] = {}
    for c in clips:
        for tag in c["tags"]:
            groups.setdefault(tag, []).append(c["id"])
    templates = [{"trigger": t, "ids": groups[t]} for t in sorted(groups)]
    empty = [t for t in templates if not t["ids"]]
    if empty:
        fail(f"空模板组：{empty}")

    catalog = {
        "version": 2.1,
        "source": "bilibili:BV17z421U71V",
        "clips": clips,
    }
    (PLUGIN / "assets" / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    (PLUGIN / "assets" / "templates.json").write_text(
        json.dumps({"version": 1, "templates": templates}, ensure_ascii=False, indent=1),
        encoding="utf-8")

    print(f"catalog {len(clips)} 条 / templates {len(templates)} 组 / clips {len(list(OUT_CLIPS.glob('CN_*.wav')))} 文件")
    for t in templates:
        print(f"  {t['trigger']:<20} {len(t['ids'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
