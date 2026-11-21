"""Generate paired local edits (AI and traditional) from pristine real images.

    cd inference
    python -m datagen.generate --limit 20 --run-id smoke                 # quick check
    python -m datagen.generate --limit 2000 --split train --run-id edits_v1
    python -m datagen.generate --editors lama,opencv_inpaint --limit 500  # no SD needed

Every edit is paired with a "pristine twin": the untouched source saved with the
exact same final JPEG/resize chain, so format and resolution never leak the
label. Edits inherit the split and group of their source image. Runs are
resumable: rerunning the same --run-id skips finished sources.
"""
import argparse
import csv
import hashlib
import io
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

from datagen.masks import MaskSpec, choose_mask, dilate
from datagen.taxonomy import EDITOR_LABEL

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
CLASSIFICATION_SPLIT = INFERENCE_ROOT / "eval/splits/classification.csv"
OUTPUT_ROOT = INFERENCE_ROOT / "dataset/images/ai_edits"
MANIFEST_DIR = INFERENCE_ROOT / "dataset/manifests/ai_edits"
SOURCE_DOMAINS = ("coco", "laion", "wikiart")

# Editor name -> (weight, operation). SD operations share one loaded pipeline.
EDITOR_MIX = {
    "lama": (0.30, "object_removal"),
    "sd_remove": (0.15, "object_removal"),
    "sd_replace": (0.20, "object_replace"),
    "sd_regen": (0.10, "region_regen"),
    "opencv_inpaint": (0.12, "object_removal"),
    "copy_move": (0.13, "copy_move"),
}
FULL_VAE_PROB = 0.15
MIN_INSIDE_DIFF = 4.0
MAX_OUTSIDE_DIFF = 0.5
MAX_WORK_SIDE = 2048

MANIFEST_COLUMNS = [
    "id", "run_id", "edited_path", "mask_path", "pristine_path", "source_path", "source", "group_id", "split",
    "label", "editor", "operation", "mask_kind", "object_class", "composite", "feather_px", "prompt",
    "negative_prompt", "seed", "steps", "guidance", "mask_ratio", "postproc", "width", "height",
    "qc_inside_diff", "created_at",
]


def stable_rng(*parts) -> np.random.Generator:
    return np.random.default_rng(int.from_bytes(hashlib.sha1("|".join(map(str, parts)).encode()).digest()[:8], "big"))


def rel(path: Path) -> str:
    return path.resolve().relative_to(INFERENCE_ROOT).as_posix()


def sample_postproc(rng: np.random.Generator) -> Dict:
    """Final save chain shared by an edit and its pristine twin."""
    pp = {"format": "jpeg" if rng.random() < 0.8 else "png"}
    if pp["format"] == "jpeg":
        pp["quality"] = int(rng.integers(70, 97))
    if rng.random() < 0.3:
        pp["scale"] = round(float(rng.uniform(0.5, 0.9)), 3)
    return pp


def apply_postproc(img: Image.Image, mask: Optional[np.ndarray], pp: Dict):
    if "scale" in pp:
        size = (max(1, round(img.width * pp["scale"])), max(1, round(img.height * pp["scale"])))
        img = img.resize(size, Image.BICUBIC)
        if mask is not None:
            mask = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).resize(size, Image.NEAREST)) > 127
    buf = io.BytesIO()
    if pp["format"] == "jpeg":
        img.save(buf, format="JPEG", quality=pp["quality"])
    else:
        img.save(buf, format="PNG")
    return buf.getvalue(), mask


def qc(original: Image.Image, edited: Image.Image, gt: np.ndarray, is_composite: bool) -> (Optional[str], float):
    a = np.asarray(original.convert("RGB"), dtype=np.float32)
    b = np.asarray(edited.convert("RGB"), dtype=np.float32)
    diff = np.abs(a - b).mean(axis=2)
    inside = float(diff[gt].mean()) if gt.any() else 0.0
    ratio = float(gt.mean())
    if not 0.003 <= ratio <= 0.45:
        return f"mask_ratio_{ratio:.3f}", inside
    if inside < MIN_INSIDE_DIFF:
        return "edit_invisible", inside
    if is_composite:
        outside = ~dilate(gt, 16)
        if outside.any() and float(diff[outside].mean()) > MAX_OUTSIDE_DIFF:
            return "leak_outside_mask", inside
    return None, inside


class Editors:
    """Lazily loads only the models the requested editor mix needs."""

    def __init__(self, names, device: str, sd_steps: int, sd_offload: bool):
        self.device, self.sd_steps, self.sd_offload = device, sd_steps, sd_offload
        self.names, self._cache = names, {}

    def get(self, key: str):
        if key not in self._cache:
            from datagen import editors as E
            if key == "lama":
                self._cache[key] = E.LamaRemover(self.device)
            elif key == "sd":
                self._cache[key] = E.SDInpainter(self.device, steps=self.sd_steps, offload=self.sd_offload)
            elif key == "opencv_inpaint":
                self._cache[key] = E.OpenCVInpainter()
            elif key == "copy_move":
                self._cache[key] = E.CopyMove()
        return self._cache[key]

    def run(self, name: str, img: Image.Image, spec: MaskSpec, rng, domain: str):
        if name.startswith("sd_"):
            full_vae = rng.random() < FULL_VAE_PROB
            res = self.get("sd").edit(img, spec, rng, EDITOR_MIX[name][1], domain, composite_result=not full_vae)
            return res, "sd15_inpaint"
        return self.get(name).edit(img, spec, rng), name


def pick_sources(args) -> pd.DataFrame:
    df = pd.read_csv(CLASSIFICATION_SPLIT, keep_default_na=False)
    df = df[(df["label"] == 0) & (df["source"].isin(SOURCE_DOMAINS))]
    if args.split != "all":
        df = df[df["split"].isin(args.split.split(","))]
    # Deterministic, run-specific order so different runs use different images.
    df = df.assign(_k=[hashlib.sha1(f"{args.run_id}|{p}".encode()).hexdigest() for p in df["path"]])
    return df.sort_values("_k").drop(columns="_k")


def load_done(manifest: Path) -> set:
    if not manifest.exists():
        return set()
    return set(pd.read_csv(manifest, usecols=["source_path"], keep_default_na=False)["source_path"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", default=datetime.now().strftime("edits_%Y%m%d"))
    ap.add_argument("--limit", type=int, default=100, help="number of accepted edits to produce")
    ap.add_argument("--split", default="all", help="train,val,test or all (edits inherit source split)")
    ap.add_argument("--editors", default=",".join(EDITOR_MIX), help=f"subset of {list(EDITOR_MIX)}")
    ap.add_argument("--device", default=None)
    ap.add_argument("--sd-steps", type=int, default=25)
    ap.add_argument("--sd-offload", action="store_true", help="CPU-offload SD submodules (for <4 GB VRAM)")
    ap.add_argument("--no-detector", action="store_true", help="brush masks only (skips Mask R-CNN)")
    args = ap.parse_args(argv)

    import torch
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    names = [n.strip() for n in args.editors.split(",") if n.strip()]
    unknown = [n for n in names if n not in EDITOR_MIX]
    if unknown:
        raise SystemExit(f"Unknown editors {unknown}")
    weights = np.array([EDITOR_MIX[n][0] for n in names])
    weights = weights / weights.sum()

    out_dir = OUTPUT_ROOT / args.run_id
    for sub in ("edited", "masks", "pristine"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    manifest = MANIFEST_DIR / f"{args.run_id}.csv"
    done = load_done(manifest)

    detector = None
    if not args.no_detector:
        from datagen.masks import InstanceDetector
        detector = InstanceDetector(device)
    editors = Editors(names, device, args.sd_steps, args.sd_offload)

    sources = pick_sources(args)
    sources = sources[~sources["path"].isin(done)]
    stats, accepted = Counter(), 0
    new_file = not manifest.exists()
    t_start = time.time()
    with open(manifest, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=MANIFEST_COLUMNS)
        if new_file:
            writer.writeheader()
        pbar = tqdm(total=args.limit, desc=f"{args.run_id} ({device})")
        for row in sources.itertuples(index=False):
            if accepted >= args.limit:
                break
            rng = stable_rng(args.run_id, row.path)
            name = str(rng.choice(names, p=weights))
            try:
                with Image.open(INFERENCE_ROOT / row.path) as im:
                    img = im.convert("RGB")
                if max(img.size) > MAX_WORK_SIDE:
                    s = MAX_WORK_SIDE / max(img.size)
                    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
                prefer = "brush" if name in ("lama", "sd_regen") and rng.random() < 0.3 else "instance"
                spec = choose_mask(img, detector, rng, prefer=prefer)
                if name in ("sd_remove", "sd_replace") and spec.kind == "brush":
                    name = "sd_regen"
                res, editor = editors.run(name, img, spec, rng, row.source)
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                stats["reject_oom"] += 1
                continue
            except Exception as e:
                stats[f"error_{type(e).__name__}"] += 1
                continue
            if res is None:
                stats["reject_editor_declined"] += 1
                continue
            reason, inside = qc(img, res.image, res.gt_mask, res.meta.get("composite", True))
            if reason:
                stats[f"reject_{reason}"] += 1
                continue

            pp = sample_postproc(rng)
            edited_bytes, gt = apply_postproc(res.image, res.gt_mask, pp)
            pristine_bytes, _ = apply_postproc(img, None, pp)
            ext = "jpg" if pp["format"] == "jpeg" else "png"
            item_id = hashlib.sha1(f"{args.run_id}|{row.path}|{editor}".encode()).hexdigest()[:16]
            stem = f"{row.source}_{item_id}"
            edited_path = out_dir / "edited" / f"{stem}.{ext}"
            pristine_path = out_dir / "pristine" / f"{stem}.{ext}"
            mask_path = out_dir / "masks" / f"{stem}.png"
            edited_path.write_bytes(edited_bytes)
            pristine_path.write_bytes(pristine_bytes)
            Image.fromarray(gt.astype(np.uint8) * 255).save(mask_path)

            m = res.meta
            writer.writerow({
                "id": item_id, "run_id": args.run_id, "edited_path": rel(edited_path), "mask_path": rel(mask_path),
                "pristine_path": rel(pristine_path), "source_path": row.path, "source": row.source,
                "group_id": row.group_id, "split": row.split, "label": EDITOR_LABEL[editor], "editor": editor,
                "operation": m.get("operation", EDITOR_MIX[name][1]), "mask_kind": spec.kind,
                "object_class": spec.object_class, "composite": bool(m.get("composite", True)),
                "feather_px": m.get("feather_px", 0), "prompt": m.get("prompt", ""),
                "negative_prompt": m.get("negative_prompt", ""), "seed": m.get("seed", ""),
                "steps": m.get("steps", ""), "guidance": m.get("guidance", ""),
                "mask_ratio": round(float(gt.mean()), 6), "postproc": json.dumps(pp, sort_keys=True),
                "width": gt.shape[1], "height": gt.shape[0], "qc_inside_diff": round(inside, 2),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            fh.flush()
            accepted += 1
            stats[f"ok_{editor}_{m.get('operation', '')}"] += 1
            pbar.update(1)
        pbar.close()

    elapsed = time.time() - t_start
    summary = {"run_id": args.run_id, "device": device, "accepted": accepted, "elapsed_s": round(elapsed, 1),
               "sec_per_accepted": round(elapsed / max(accepted, 1), 2), "stats": dict(sorted(stats.items()))}
    (out_dir / "run_stats.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"manifest: {manifest}")


if __name__ == "__main__":
    main()
