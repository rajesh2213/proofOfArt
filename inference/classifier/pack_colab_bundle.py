"""Pack a minimal P2 classifier training bundle for Colab / Drive.

    cd inference
    .\\.venv-gen\\Scripts\\python -m classifier.pack_colab_bundle --zip
"""
from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path

import pandas as pd

from classifier.config import INFERENCE_ROOT
from classifier.dataset import load_rows

BUNDLE_NAME = "p2_dinoprobe"
CODE_FILES = [
    "classifier/__init__.py",
    "classifier/config.py",
    "classifier/model.py",
    "classifier/dataset.py",
    "classifier/train.py",
    "classifier/colab_train.ipynb",
    "localizer/requirements.txt",
]


def copy_code(dst_root: Path) -> None:
    for rel in CODE_FILES:
        src = INFERENCE_ROOT / rel
        out = dst_root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, out)
    cfg = (dst_root / "classifier/config.py").read_text(encoding="utf-8")
    cfg = cfg.replace(
        'UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_v1.csv"',
        'UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_bundle.csv"',
    )
    (dst_root / "classifier/config.py").write_text(cfg, encoding="utf-8")


def materialize(rows: pd.DataFrame, dst_root: Path, split: str) -> pd.DataFrame:
    records = []
    for r in rows.itertuples(index=False):
        src_img = INFERENCE_ROOT / r.path
        dest_rel = Path("dataset/images") / split / r.label / Path(r.path).name
        dest_img = dst_root / dest_rel
        dest_img.parent.mkdir(parents=True, exist_ok=True)
        if not dest_img.exists():
            shutil.copy2(src_img, dest_img)
        records.append({
            "path": dest_rel.as_posix(),
            "label": r.label,
            "q1_target": getattr(r, "q1_target", int(r.label == "fully_synthetic")),
            "mask_path": "",
            "split": split,
            "group_root": getattr(r, "group_root", ""),
            "source": getattr(r, "source", ""),
            "editor": "",
            "operation": "",
            "composite": "",
            "mask_ratio": 0.0,
            "paired_with": "",
            "width": getattr(r, "width", 0),
            "height": getattr(r, "height", 0),
        })
    return pd.DataFrame(records)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=INFERENCE_ROOT / "colab_bundle" / BUNDLE_NAME)
    ap.add_argument("--max-per-class", type=int, default=4000)
    ap.add_argument("--zip", action="store_true")
    args = ap.parse_args(argv)

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)

    copy_code(args.out)
    train = load_rows("train", max_per_class=args.max_per_class)
    val = load_rows("val", max_per_class=min(args.max_per_class, 2000))
    print(f"packing train={len(train)} val={len(val)}")

    bundled = pd.concat([
        materialize(train, args.out, "train"),
        materialize(val, args.out, "val"),
    ], ignore_index=True)
    man_dir = args.out / "dataset/manifests"
    man_dir.mkdir(parents=True, exist_ok=True)
    bundled.to_csv(man_dir / "unified_bundle.csv", index=False)

    (args.out / "README_COLAB.txt").write_text(
        f"""P2 DinoProbe Colab bundle
train={len(train)} val={len(val)}
Upload to Drive e.g. MyDrive/collab-use/p2_dinoprobe/
Open classifier/colab_train.ipynb (GPU).
Download core/models/ai_detection/best_dinoprobe.pt home.
""",
        encoding="utf-8",
    )
    by = {f"{s}|{l}": int(n) for (s, l), n in bundled.groupby(["split", "label"]).size().items()}
    (args.out / "bundle_stats.json").write_text(
        json.dumps({"train": len(train), "val": len(val), "by_split_label": by}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")
    if args.zip:
        zip_path = args.out.with_suffix(".zip")
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for p in args.out.rglob("*"):
                if p.is_file():
                    zf.write(p, p.relative_to(args.out.parent))
        print(f"wrote {zip_path} ({zip_path.stat().st_size / 1e9:.2f} GB)")


if __name__ == "__main__":
    main()
