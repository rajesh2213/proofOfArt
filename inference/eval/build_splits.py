"""Build frozen, group-aware evaluation splits.

    cd inference
    python -m eval.build_splits            # create, or extend with new files
    python -m eval.build_splits --force    # rebuild from scratch (new split version only)

Existing rows keep their split forever; new files are assigned by the same
salted group hash. Test-only external sets live under eval/external/:

    external/<name>/real/*, external/<name>/fake/*                 classification
    external/<name>/edited/*, masks/*, [originals/*]              localization

Name a set `cross_generator_*`, `hard_fakes_*` or `object_removal_*` to fill the
matching required slice.
"""
import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

from eval.config import (
    AI_EDIT_SOURCES,
    CLASSIFICATION_DIR,
    CLASSIFICATION_SPLIT,
    EXTERNAL_DIR,
    GENERATED_MANIFEST_DIR,
    IMAGE_EXTENSIONS,
    INFERENCE_ROOT,
    LOCALIZATION_SPLIT,
    REQUIRED_SLICES,
    SPLIT_REPORT,
    SPLIT_VERSION,
    SPLITS_DIR,
    TAMPER_DIR,
    TAMPER_MANIFEST,
    TRADITIONAL_EDIT_SOURCES,
)
from eval.grouping import UnionFind, assign_split, dhash, group_key, near_duplicate_pairs

EXTERNAL_SLICE_PREFIXES = {
    "cross_generator": "classification_cross_generator",
    "hard_fakes": "classification_hard_fakes",
    "object_removal": "localization_object_removal",
}


def rel(path: Path) -> str:
    return path.resolve().relative_to(INFERENCE_ROOT).as_posix()


def list_images(folder: Path) -> List[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS)


def normalize_source(folder_name: str) -> str:
    name = folder_name.lower()
    return name[:-5] if name.endswith("_real") else name


def edit_family(source: str) -> str:
    if source in AI_EDIT_SOURCES:
        return "ai_local_edit"
    if source in TRADITIONAL_EDIT_SOURCES:
        return "traditional_edit"
    return "unknown_edit"


def legacy_editor(source: str) -> str:
    # Older tamper set: SD 1.5 inpaint, 5 steps, whole image re-encoded at 512px.
    return "manual" if source in TRADITIONAL_EDIT_SOURCES else "legacy_sd15_inpaint"


def loc_row(**kw) -> dict:
    base = {"mask_path": "", "edit_instruction": "", "external_set": "", "editor": "", "operation": "",
            "composite": "", "run_id": "", "inherit_split": ""}
    base.update(kw)
    return base


def load_edit_instructions() -> Dict[str, str]:
    """Map '<source>/<filename>' to the edit instruction.

    The manifest mixes two row layouts: 11 columns for IMD2020/early SD rows and
    6 columns (original, edited, mask, instruction, caption, sha) for later rows.
    """
    out: Dict[str, str] = {}
    if not TAMPER_MANIFEST.exists():
        return out
    with open(TAMPER_MANIFEST, encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) < 4:
                continue
            edited = Path(row[1].replace("\\", "/"))
            key = f"{edited.parent.name.lower()}/{edited.name}"
            out[key] = row[3].strip()
    return out


def scan_classification() -> List[dict]:
    rows = []
    for label_dir, label in (("ai_generated", 1), ("real", 0)):
        root = CLASSIFICATION_DIR / label_dir
        if not root.is_dir():
            continue
        for src_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            source = normalize_source(src_dir.name)
            for img in list_images(src_dir):
                rows.append({
                    "path": rel(img),
                    "label": label,
                    "taxonomy": "fully_synthetic" if label else "pristine_real",
                    "source": source,
                    "group_id": group_key(source, img.name),
                    "external_set": "",
                })
    return rows


def scan_localization(instructions: Dict[str, str]) -> List[dict]:
    rows = []
    edited_root, masks_root, orig_root = TAMPER_DIR / "edited", TAMPER_DIR / "masks", TAMPER_DIR / "originals"
    if not edited_root.is_dir():
        return rows
    for src_dir in sorted(p for p in edited_root.iterdir() if p.is_dir()):
        source = src_dir.name.lower()
        for img in list_images(src_dir):
            mask = masks_root / src_dir.name / img.name
            if not mask.exists():
                continue
            gid = group_key(source, img.name)
            rows.append(loc_row(
                path=rel(img), mask_path=rel(mask), kind="tampered", family=edit_family(source), source=source,
                edit_instruction=instructions.get(f"{source}/{img.name}", ""), group_id=gid,
                editor=legacy_editor(source), operation="manual" if source in TRADITIONAL_EDIT_SOURCES else "inpaint",
                composite=source in TRADITIONAL_EDIT_SOURCES,
            ))
            original = orig_root / src_dir.name / img.name
            if original.exists():
                rows.append(loc_row(path=rel(original), kind="pristine", family="pristine", source=source,
                                    group_id=gid))
    return rows


def scan_generated() -> List[dict]:
    """Rows from datagen.generate manifests: each edit plus its pristine twin."""
    rows = []
    if not GENERATED_MANIFEST_DIR.is_dir():
        return rows
    for manifest in sorted(GENERATED_MANIFEST_DIR.glob("*.csv")):
        df = pd.read_csv(manifest, keep_default_na=False)
        for r in df.itertuples(index=False):
            if not (INFERENCE_ROOT / r.edited_path).exists():
                continue
            source = f"gen_{r.source}"
            common = dict(source=source, group_id=r.group_id, run_id=r.run_id, inherit_split=r.split)
            rows.append(loc_row(path=r.edited_path, mask_path=r.mask_path, kind="tampered", family=r.label,
                                edit_instruction=r.prompt, editor=r.editor, operation=r.operation,
                                composite=r.composite, **common))
            rows.append(loc_row(path=r.pristine_path, kind="pristine", family="pristine", editor=r.editor,
                                **common))
    return rows


def scan_external() -> (List[dict], List[dict]):
    cls_rows, loc_rows = [], []
    if not EXTERNAL_DIR.is_dir():
        return cls_rows, loc_rows
    for set_dir in sorted(p for p in EXTERNAL_DIR.iterdir() if p.is_dir()):
        name = set_dir.name.lower()
        for sub, label in (("fake", 1), ("real", 0)):
            for img in list_images(set_dir / sub):
                cls_rows.append({
                    "path": rel(img),
                    "label": label,
                    "taxonomy": "fully_synthetic" if label else "pristine_real",
                    "source": f"{name}_{sub}",
                    "group_id": f"external:{name}:{img.stem.lower()}",
                    "external_set": name,
                })
        for img in list_images(set_dir / "edited"):
            mask = set_dir / "masks" / img.name
            if not mask.exists():
                continue
            loc_rows.append(loc_row(path=rel(img), mask_path=rel(mask), kind="tampered", family="ai_local_edit",
                                    source=name, group_id=f"external:{name}:{img.stem.lower()}",
                                    external_set=name, editor="external"))
        for img in list_images(set_dir / "originals"):
            loc_rows.append(loc_row(path=rel(img), kind="pristine", family="pristine", source=name,
                                    group_id=f"external:{name}:{img.stem.lower()}", external_set=name))
    return cls_rows, loc_rows


def _image_stats(args) -> tuple:
    path, mask_path = args
    full = INFERENCE_ROOT / path
    h = dhash(full)
    width = height = 0
    try:
        with Image.open(full) as im:
            width, height = im.size
    except Exception:
        pass
    ratio = -1.0
    if mask_path:
        try:
            with Image.open(INFERENCE_ROOT / mask_path) as m:
                arr = np.asarray(m.convert("L"))
            ratio = float((arr > 127).mean())
        except Exception:
            ratio = -1.0
    return path, h, width, height, ratio


def load_cached_stats() -> Dict[str, tuple]:
    cache = {}
    for path in (CLASSIFICATION_SPLIT, LOCALIZATION_SPLIT):
        if not path.exists():
            continue
        df = pd.read_csv(path, keep_default_na=False)
        ratios = df["mask_ratio"] if "mask_ratio" in df.columns else [-1.0] * len(df)
        for p, h, w, hgt, ratio in zip(df["path"], df["dhash"], df["width"], df["height"], ratios):
            cache[p] = (int(h, 16) if h else None, int(w), int(hgt), float(ratio) if ratio != "" else -1.0)
    return cache


def compute_stats(rows: List[dict], workers: int, cache: Dict[str, tuple]) -> Dict[str, tuple]:
    out = {r["path"]: cache[r["path"]] for r in rows if r["path"] in cache}
    jobs = sorted({(r["path"], r.get("mask_path", "")) for r in rows if r["path"] not in out})
    if not jobs:
        return out
    with Pool(workers) as pool:
        for path, h, w, hgt, ratio in tqdm(pool.imap_unordered(_image_stats, jobs, chunksize=64),
                                          total=len(jobs), desc="hashing"):
            out[path] = (h, w, hgt, ratio)
    return out


def load_frozen(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    df = pd.read_csv(path, usecols=["path", "split"], dtype=str)
    return dict(zip(df["path"], df["split"]))


def main(argv: Optional[List[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="Discard existing split assignments.")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args(argv)

    SPLITS_DIR.mkdir(parents=True, exist_ok=True)
    instructions = load_edit_instructions()
    cls_rows = scan_classification()
    loc_rows = scan_localization(instructions)
    gen_rows = scan_generated()
    ext_cls, ext_loc = scan_external()
    print(f"classification={len(cls_rows)} localization={len(loc_rows)} generated={len(gen_rows)} "
          f"external_cls={len(ext_cls)} external_loc={len(ext_loc)}")
    # Generated edits are derived from classification reals; they must follow their source.
    loc_rows = loc_rows + gen_rows

    all_rows = cls_rows + loc_rows + ext_cls + ext_loc
    stats = compute_stats(all_rows, args.workers, {} if args.force else load_cached_stats())

    uf = UnionFind()
    for r in all_rows:
        uf.find(r["group_id"])

    # Near-duplicates glue groups across tasks (e.g. a WikiArt painting used as a
    # real sample and as an inpainting source). External sets stay isolated so
    # their leakage into training is reported instead of silently absorbed.
    internal_hashes, group_of = [], {}
    for r in cls_rows + loc_rows:
        h = stats[r["path"]][0]
        if h is not None:
            internal_hashes.append((r["path"], h))
        group_of[r["path"]] = r["group_id"]
    frozen = {} if args.force else {**load_frozen(CLASSIFICATION_SPLIT), **load_frozen(LOCALIZATION_SPLIT)}
    # Per original group_id: which frozen split (if any) its members already occupy.
    frozen_by_gid: Dict[str, set] = defaultdict(set)
    for r in cls_rows + loc_rows:
        if r["path"] in frozen:
            frozen_by_gid[r["group_id"]].add(frozen[r["path"]])

    def frozen_splits_of(root: str) -> set:
        out = set()
        for gid, splits in frozen_by_gid.items():
            if uf.find(gid) == root:
                out |= splits
        return out

    merges = 0
    skipped_cross_source = 0
    skipped_split_conflict = 0
    for a, b, _ in near_duplicate_pairs(internal_hashes):
        ga, gb = group_of[a], group_of[b]
        if uf.find(ga) == uf.find(gb):
            continue
        # Cross-source dHash collisions (e.g. flat abstract art vs a photo) are
        # almost always false positives; only glue within the same source family.
        if ga.split(":", 1)[0] != gb.split(":", 1)[0]:
            skipped_cross_source += 1
            continue
        sa, sb = frozen_splits_of(uf.find(ga)), frozen_splits_of(uf.find(gb))
        if sa and sb and sa != sb:
            skipped_split_conflict += 1
            continue
        uf.union(ga, gb)
        merges += 1

    # A group already frozen into a split pulls any new member into that split.
    root_split: Dict[str, str] = {}
    for r in cls_rows + loc_rows:
        if r["path"] in frozen:
            root_split.setdefault(uf.find(r["group_id"]), frozen[r["path"]])

    def finalize(rows: List[dict]) -> pd.DataFrame:
        for r in rows:
            h, w, hgt, ratio = stats[r["path"]]
            r["dhash"] = f"{h:016x}" if h is not None else ""
            r["width"], r["height"] = w, hgt
            if "mask_path" in r:
                r["mask_ratio"] = round(ratio, 6) if r["kind"] == "tampered" else 0.0
            r["group_root"] = uf.find(r["group_id"])
            if r["external_set"]:
                r["split"] = f"external:{r['external_set']}"
            else:
                r["split"] = (frozen.get(r["path"]) or r.get("inherit_split")
                              or root_split.get(r["group_root"]) or assign_split(r["group_root"]))
        return pd.DataFrame(rows).drop(columns=["inherit_split"], errors="ignore")

    cls_df = finalize(cls_rows + ext_cls)
    loc_df = finalize(loc_rows + ext_loc)
    cls_df.to_csv(CLASSIFICATION_SPLIT, index=False)
    loc_df.to_csv(LOCALIZATION_SPLIT, index=False)

    # Leakage audit: a group root must map to one internal split.
    internal = pd.concat([cls_df, loc_df])
    internal = internal[~internal["split"].str.startswith("external:")]
    spans = internal.groupby("group_root")["split"].nunique()
    leaking_groups = int((spans > 1).sum())

    ext_leaks = 0
    train_hashes = [(p, int(h, 16)) for p, h in zip(internal.loc[internal.split == "train", "path"],
                                                    internal.loc[internal.split == "train", "dhash"]) if h]
    ext_hashes = [(r["path"], int(r["dhash"], 16)) for r in ext_cls + ext_loc if r["dhash"]]
    if ext_hashes:
        ext_paths = {p for p, _ in ext_hashes}
        for a, b, _ in near_duplicate_pairs(train_hashes + ext_hashes):
            if (a in ext_paths) != (b in ext_paths):
                ext_leaks += 1

    present = set()
    for name in {r["external_set"] for r in ext_cls + ext_loc}:
        for prefix, slice_name in EXTERNAL_SLICE_PREFIXES.items():
            if name.startswith(prefix):
                present.add(slice_name)

    def counts(df: pd.DataFrame, cols: List[str]) -> dict:
        return {"|".join(map(str, k)) if isinstance(k, tuple) else str(k): int(v)
                for k, v in df.groupby(cols).size().items()}

    report = {
        "split_version": SPLIT_VERSION,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "frozen_rows_reused": sum(1 for p in internal["path"] if p in frozen),
        "near_duplicate_group_merges": merges,
        "near_duplicate_skipped_cross_source": skipped_cross_source,
        "near_duplicate_skipped_split_conflict": skipped_split_conflict,
        "groups_spanning_splits": leaking_groups,
        "external_near_duplicates_of_train": ext_leaks,
        "classification": {
            "by_split_label": counts(cls_df, ["split", "label"]),
            "by_split_source": counts(cls_df, ["split", "source"]),
            "groups": int(cls_df["group_root"].nunique()),
        },
        "localization": {
            "by_split_family": counts(loc_df, ["split", "family"]),
            "by_split_source": counts(loc_df, ["split", "source"]),
            "groups": int(loc_df["group_root"].nunique()),
        },
        "missing_required_slices": {k: v for k, v in REQUIRED_SLICES.items() if k not in present},
        "notes": [
            "Real-image groups for COCO/LAION and generator groups for SD/LD/DiffusionDB fall back to file "
            "stem because prompt, artist and uploader metadata is not stored.",
            "IMD2020 is manual (non-AI) tampering and is reported as traditional_edit.",
        ],
    }
    SPLIT_REPORT.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("near_duplicate_group_merges", "groups_spanning_splits",
                                             "external_near_duplicates_of_train")}, indent=2))
    print(f"wrote {CLASSIFICATION_SPLIT}, {LOCALIZATION_SPLIT}, {SPLIT_REPORT}")
    if leaking_groups:
        print(f"WARNING: {leaking_groups} groups span splits (frozen rows now bridged by new data).")


if __name__ == "__main__":
    main()
