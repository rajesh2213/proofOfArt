"""Pack a minimal P3 training bundle for Google Colab / Drive.

    cd inference
    .\\.venv-gen\\Scripts\\python -m localizer.pack_colab_bundle
    .\\.venv-gen\\Scripts\\python -m localizer.pack_colab_bundle --zip

Creates:
  colab_bundle/p3_dinolizer/
    localizer/          # training code
    eval/adapters/base.py + dinolizer bits not required for train
    dataset/manifests/unified_train.csv   # remapped relative paths
    dataset/images/...                    # only sampled train/val files + masks
    README_COLAB.txt

Upload that folder (or the .zip) to Drive, then open localizer/colab_train.ipynb.
"""
from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path

import pandas as pd

from localizer.config import INFERENCE_ROOT
from localizer.dataset import load_rows

BUNDLE_NAME = "p3_dinolizer"
CODE_FILES = [
    "localizer/__init__.py",
    "localizer/config.py",
    "localizer/model.py",
    "localizer/dataset.py",
    "localizer/train.py",
    "localizer/infer.py",
    "localizer/requirements.txt",
    "localizer/colab_train.ipynb",
]


def copy_code(dst_root: Path) -> None:
    for rel in CODE_FILES:
        src = INFERENCE_ROOT / rel
        out = dst_root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, out)
    # Point UNIFIED_MANIFEST at the bundle copy via a tiny overlay.
    cfg = (dst_root / "localizer/config.py").read_text(encoding="utf-8")
    cfg = cfg.replace(
        'UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_v1.csv"',
        'UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_bundle.csv"',
    )
    (dst_root / "localizer/config.py").write_text(cfg, encoding="utf-8")


def materialize(rows: pd.DataFrame, dst_root: Path, split: str) -> pd.DataFrame:
    records = []
    for r in rows.itertuples(index=False):
        src_img = INFERENCE_ROOT / r.path
        # Keep a flat-ish but unique destination to avoid collisions.
        dest_rel = Path("dataset/images") / split / r.label / Path(r.path).name
        dest_img = dst_root / dest_rel
        dest_img.parent.mkdir(parents=True, exist_ok=True)
        if not dest_img.exists():
            shutil.copy2(src_img, dest_img)

        mask_rel = ""
        if r.mask_path:
            src_mask = INFERENCE_ROOT / r.mask_path
            mask_rel = Path("dataset/images") / split / "masks" / f"{Path(r.path).stem}.png"
            dest_mask = dst_root / mask_rel
            dest_mask.parent.mkdir(parents=True, exist_ok=True)
            if not dest_mask.exists():
                shutil.copy2(src_mask, dest_mask)
            mask_rel = mask_rel.as_posix()

        records.append({
            "path": dest_rel.as_posix(),
            "label": r.label,
            "q1_target": getattr(r, "q1_target", 0),
            "mask_path": mask_rel,
            "split": split,
            "group_root": r.group_root,
            "source": r.source,
            "editor": getattr(r, "editor", ""),
            "operation": getattr(r, "operation", ""),
            "composite": getattr(r, "composite", ""),
            "mask_ratio": getattr(r, "mask_ratio", 0.0),
            "paired_with": "",
            "width": getattr(r, "width", 0),
            "height": getattr(r, "height", 0),
        })
    return pd.DataFrame(records)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=INFERENCE_ROOT / "colab_bundle" / BUNDLE_NAME)
    ap.add_argument("--max-per-label", type=int, default=None,
                    help="cap traditional/pristine (default: train.py defaults = 2000)")
    ap.add_argument("--zip", action="store_true")
    args = ap.parse_args(argv)

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)

    copy_code(args.out)
    train = load_rows("train", max_per_label=args.max_per_label)
    val = load_rows("val", max_per_label=args.max_per_label)
    print(f"packing train={len(train)} val={len(val)}")

    bundled = pd.concat([
        materialize(train, args.out, "train"),
        materialize(val, args.out, "val"),
    ], ignore_index=True)
    man_dir = args.out / "dataset/manifests"
    man_dir.mkdir(parents=True, exist_ok=True)
    bundled.to_csv(man_dir / "unified_bundle.csv", index=False)

    readme = f"""P3 DinoLizer Colab bundle
========================
train rows: {len(train)}
val rows:   {len(val)}
images+masks copied under dataset/images/

1. Upload this whole folder to Google Drive, e.g.
   MyDrive/proofOfArt/p3_dinolizer/

2. Open localizer/colab_train.ipynb in Colab (Runtime → GPU).

3. Set INFERENCE_ROOT to that Drive path and run all cells.

4. Download core/models/ai_edit_localization/best_dinolizer.pt back to your PC.
"""
    (args.out / "README_COLAB.txt").write_text(readme, encoding="utf-8")
    by_split_label = {
        f"{s}|{l}": int(n) for (s, l), n in bundled.groupby(["split", "label"]).size().items()
    }
    (args.out / "bundle_stats.json").write_text(json.dumps({
        "train": int(len(train)),
        "val": int(len(val)),
        "by_split_label": by_split_label,
    }, indent=2), encoding="utf-8")

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
