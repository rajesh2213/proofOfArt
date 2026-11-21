"""Single four-label training/eval manifest derived from the frozen splits.

    cd inference
    python -m eval.build_splits        # after generating new edits
    python -m datagen.unified          # writes dataset/manifests/unified_v1.csv

    from datagen.unified import load_unified
    train = load_unified(split="train", labels=["pristine_real", "ai_local_edit"])

Splits come only from eval/splits/*.csv, so training can never see an image
(or a sibling in its identity group) that eval treats as held out.
"""
import argparse
import json
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

from datagen.taxonomy import FULLY_SYNTHETIC, HAS_MASK, LABELS, PRISTINE_REAL, Q1_TARGET

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
SPLITS_DIR = INFERENCE_ROOT / "eval/splits"
UNIFIED_PATH = INFERENCE_ROOT / "dataset/manifests/unified_v1.csv"

COLUMNS = ["path", "label", "q1_target", "mask_path", "split", "group_root", "source", "editor", "operation",
           "composite", "mask_ratio", "paired_with", "width", "height"]


def build() -> pd.DataFrame:
    cls = pd.read_csv(SPLITS_DIR / "classification.csv", keep_default_na=False)
    loc = pd.read_csv(SPLITS_DIR / "localization.csv", keep_default_na=False)
    cls = cls[~cls["split"].str.startswith("external:")]
    loc = loc[~loc["split"].str.startswith("external:")]

    cls_out = pd.DataFrame({
        "path": cls["path"],
        "label": cls["label"].map({0: PRISTINE_REAL, 1: FULLY_SYNTHETIC}),
        "mask_path": "", "split": cls["split"], "group_root": cls["group_root"], "source": cls["source"],
        "editor": "", "operation": "", "composite": "", "mask_ratio": 0.0, "paired_with": "",
        "width": cls["width"], "height": cls["height"],
    })

    tampered = loc[loc["kind"] == "tampered"]
    pristine = loc[loc["kind"] == "pristine"]
    # Edits and their pristine twins share source, run and file stem; record the partner for paired losses.
    key = loc["source"] + "|" + loc["run_id"] + "|" + loc["path"].map(lambda p: Path(p).stem)
    twin_of = {}
    for _, grp in loc.assign(_key=key).groupby("_key"):
        t, p = grp[grp.kind == "tampered"]["path"].tolist(), grp[grp.kind == "pristine"]["path"].tolist()
        if len(t) == 1 and len(p) == 1:
            twin_of[t[0]], twin_of[p[0]] = p[0], t[0]

    def loc_frame(df: pd.DataFrame, label_col) -> pd.DataFrame:
        return pd.DataFrame({
            "path": df["path"], "label": label_col, "mask_path": df["mask_path"], "split": df["split"],
            "group_root": df["group_root"], "source": df["source"], "editor": df["editor"],
            "operation": df["operation"], "composite": df["composite"], "mask_ratio": df["mask_ratio"],
            "paired_with": df["path"].map(twin_of).fillna(""), "width": df["width"], "height": df["height"],
        })

    out = pd.concat([cls_out, loc_frame(tampered, tampered["family"]), loc_frame(pristine, PRISTINE_REAL)],
                    ignore_index=True)
    out = out.drop_duplicates("path")
    out["q1_target"] = out["label"].map(Q1_TARGET)
    bad = set(out["label"]) - set(LABELS)
    if bad:
        raise ValueError(f"Unknown labels in splits: {bad}")
    missing_mask = out[out["label"].map(HAS_MASK) & (out["mask_path"] == "")]
    if len(missing_mask):
        raise ValueError(f"{len(missing_mask)} edited rows have no mask")
    spans = out.groupby("group_root")["split"].nunique()
    if (spans > 1).any():
        raise ValueError(f"{int((spans > 1).sum())} groups span splits; rerun eval.build_splits")
    return out[COLUMNS]


def load_unified(split: Optional[str] = None, labels: Optional[Iterable[str]] = None,
                 path: Path = UNIFIED_PATH) -> pd.DataFrame:
    df = pd.read_csv(path, keep_default_na=False)
    if split:
        df = df[df["split"] == split]
    if labels:
        df = df[df["label"].isin(list(labels))]
    return df.reset_index(drop=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args(argv)
    df = build()
    UNIFIED_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(UNIFIED_PATH, index=False)
    table = df.groupby(["split", "label"]).size().unstack(fill_value=0).reindex(columns=LABELS, fill_value=0)
    print(table.to_string())
    editors = df[df["editor"] != ""].groupby(["label", "editor"]).size()
    print("\n" + editors.to_string())
    (UNIFIED_PATH.with_suffix(".stats.json")).write_text(json.dumps({
        "by_split_label": {f"{s}|{l}": int(n) for (s, l), n in df.groupby(["split", "label"]).size().items()},
        "by_label_editor": {f"{l}|{e}": int(n) for (l, e), n in editors.items()},
    }, indent=2))
    print(f"\nwrote {UNIFIED_PATH}")


if __name__ == "__main__":
    main()
