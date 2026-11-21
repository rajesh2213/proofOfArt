"""Train the P3 DinoLizer-style patch localizer.

    cd inference
    .\\.venv-gen\\Scripts\\python -m localizer.train --epochs 12
    .\\.venv-gen\\Scripts\\python -m localizer.train --lora-r 8 --epochs 12 --run-name dinolizer_lora_v2
    .\\.venv-gen\\Scripts\\python -m localizer.train --resume --run-name dinolizer_lora_v2 --lora-r 8 --epochs 12
    .\\.venv-gen\\Scripts\\python -m localizer.train --smoke
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from localizer.config import (
    BACKBONE,
    BATCH_SIZE,
    CHECKPOINT_DIR,
    EPOCHS,
    IMAGE_SIZE,
    JPEG_PROB,
    LR,
    NUM_WORKERS,
    PATCH,
    POS_WEIGHT,
    WEIGHT_DECAY,
)
from localizer.dataset import EditLocalizationDataset, load_rows
from localizer.model import DinoPatchLocalizer


def soft_dice_loss(logits: torch.Tensor, targets: torch.Tensor, eps: float = 1.0) -> torch.Tensor:
    probs = torch.sigmoid(logits)
    dims = tuple(range(1, probs.ndim))
    inter = (probs * targets).sum(dim=dims)
    denom = probs.sum(dim=dims) + targets.sum(dim=dims)
    return 1.0 - ((2 * inter + eps) / (denom + eps)).mean()


def combined_loss(logits: torch.Tensor, targets: torch.Tensor, pos_weight: torch.Tensor, dice_w: float) -> torch.Tensor:
    bce = F.binary_cross_entropy_with_logits(logits, targets, pos_weight=pos_weight)
    if dice_w <= 0:
        return bce
    return (1.0 - dice_w) * bce + dice_w * soft_dice_loss(logits, targets)


def patch_metrics(logits: torch.Tensor, targets: torch.Tensor) -> dict:
    preds = (torch.sigmoid(logits) >= 0.5).float()
    tp = (preds * targets).sum().item()
    fp = (preds * (1 - targets)).sum().item()
    fn = ((1 - preds) * targets).sum().item()
    inter = tp
    union = tp + fp + fn
    return {
        "iou": inter / union if union else 1.0,
        "f1": 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 1.0,
        "pos_rate": float(targets.mean()),
    }


def _forward(model, batch, device):
    images = batch["image"].to(device)
    residual = batch["residual"].to(device) if "residual" in batch and getattr(model, "dual_stream", False) else None
    return model(images, residual=residual)


@torch.no_grad()
def evaluate(model, loader, device, pos_weight, dice_w) -> dict:
    model.eval()
    losses, ious, f1s = [], [], []
    for batch in loader:
        targets = batch["patches"].to(device)
        out = _forward(model, batch, device)
        loss = combined_loss(out.logits, targets, pos_weight, dice_w)
        m = patch_metrics(out.logits, targets)
        losses.append(loss.item())
        ious.append(m["iou"])
        f1s.append(m["f1"])
    return {
        "loss": float(np.mean(losses)) if losses else 0.0,
        "iou": float(np.mean(ious)) if ious else 0.0,
        "f1": float(np.mean(f1s)) if f1s else 0.0,
    }


def save_payload(model, args, val, epoch, path: Path, opt=None, history=None, best_iou=None):
    exported = model.export_trainable_state()
    payload = {
        "head": exported["head"],
        "config": {
            "backbone": args.backbone,
            "image_size": args.image_size,
            "patch": PATCH,
            "train_backbone": False,
            "lora_r": args.lora_r,
            "lora_alpha": args.lora_alpha,
            "dice_weight": args.dice_weight,
            "dual_stream": bool(args.dual_stream),
            "residual_dim": 64,
        },
        "metrics": val,
        "epoch": epoch,
        "history": history or [],
        "best_iou": best_iou,
        "dual_stream": bool(args.dual_stream),
    }
    if "lora" in exported:
        payload["lora"] = exported["lora"]
    if "residual_enc" in exported:
        payload["residual_enc"] = exported["residual_enc"]
    if opt is not None:
        payload["optimizer"] = opt.state_dict()
    torch.save(payload, path)
    return payload


def history_from_log(log_path: Path) -> list:
    rows = []
    if not log_path.exists():
        return rows
    for line in log_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line.startswith('{"epoch":'):
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    # Keep last row per epoch number
    by_ep = {int(r["epoch"]): r for r in rows if "epoch" in r}
    return [by_ep[k] for k in sorted(by_ep)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backbone", default=BACKBONE)
    ap.add_argument("--image-size", type=int, default=IMAGE_SIZE)
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    ap.add_argument("--epochs", type=int, default=EPOCHS)
    ap.add_argument("--lr", type=float, default=None, help="default 1e-3 head-only, 2e-4 with LoRA")
    ap.add_argument("--lora-r", type=int, default=0, help="PEFT LoRA rank; 0 = frozen backbone + head")
    ap.add_argument("--lora-alpha", type=int, default=16)
    ap.add_argument("--dice-weight", type=float, default=0.5, help="mix SoftDice into BCE (0=BCE only)")
    ap.add_argument("--pos-weight", type=float, default=None,
                    help="BCE positive class weight (default from config; lower ⇒ less hallucination)")
    ap.add_argument("--dual-stream", action="store_true", help="RGB DINO + high-pass residual CNN")
    ap.add_argument("--max-per-label", type=int, default=None, help="cap train samples per label")
    ap.add_argument("--smoke", action="store_true", help="32 images, few epochs, overfit check")
    ap.add_argument("--init-from", type=Path, default=None,
                    help="warm-start head (and LoRA if present) from an existing .pt")
    ap.add_argument("--resume", action="store_true",
                    help="continue run-name from last.pt (or best.pt); skips finished epochs")
    ap.add_argument("--promote-best", action="store_true",
                    help="also copy improving checkpoints to CHECKPOINT_DIR/best_dinolizer.pt (prod). "
                         "Off by default so experimental dual-stream runs cannot overwrite LoRA prod mid-train.")
    ap.add_argument("--device", default=None)
    ap.add_argument("--run-name", default=None)
    args = ap.parse_args(argv)

    if args.image_size % PATCH:
        raise SystemExit(f"--image-size must be divisible by {PATCH}")
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    if args.smoke:
        args.epochs = 3
        args.max_per_label = 16
        args.batch_size = 2
    if args.lr is None:
        args.lr = 2e-4 if args.lora_r > 0 else LR
    if args.pos_weight is None:
        args.pos_weight = POS_WEIGHT

    run_name = args.run_name or datetime.now().strftime("dinolizer_%Y%m%d_%H%M%S")
    out_dir = CHECKPOINT_DIR / run_name
    out_dir.mkdir(parents=True, exist_ok=True)
    last_path = out_dir / "last.pt"
    best_path = out_dir / "best.pt"
    log_path = CHECKPOINT_DIR / f"train_{run_name}.log"

    train_rows = load_rows("train", max_per_label=args.max_per_label, keep_all_ai=not args.smoke)
    val_rows = load_rows("val", max_per_label=args.max_per_label, keep_all_ai=not args.smoke)
    print(
        f"train={len(train_rows)} val={len(val_rows)} device={device} "
        f"size={args.image_size} lora_r={args.lora_r} dice_w={args.dice_weight} "
        f"dual_stream={args.dual_stream}"
    )

    train_ds = EditLocalizationDataset(
        train_rows, args.image_size, PATCH, train=True, jpeg_prob=0.0 if args.smoke else JPEG_PROB
    )
    val_ds = EditLocalizationDataset(val_rows, args.image_size, PATCH, train=False)
    train_loader = DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True,
        num_workers=0 if args.smoke else NUM_WORKERS, pin_memory=device == "cuda",
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False,
        num_workers=0 if args.smoke else NUM_WORKERS, pin_memory=device == "cuda",
    )

    model = DinoPatchLocalizer(
        backbone=args.backbone,
        freeze_backbone=True,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        dual_stream=args.dual_stream,
    ).to(device)

    history = []
    best_iou = -1.0
    start_epoch = 1
    resume_ckpt = None

    if args.resume:
        cand = last_path if last_path.exists() else best_path
        if not cand.exists():
            # Fall back to log-derived history + best_dinolizer / best.pt
            history = history_from_log(log_path)
            if history:
                start_epoch = int(history[-1]["epoch"]) + 1
                best_iou = max(float(r.get("val_iou", -1)) for r in history)
            if best_path.exists():
                resume_ckpt = best_path
            elif (CHECKPOINT_DIR / "best_dinolizer.pt").exists():
                resume_ckpt = CHECKPOINT_DIR / "best_dinolizer.pt"
            else:
                raise SystemExit(f"--resume but no checkpoint under {out_dir}")
        else:
            resume_ckpt = cand
        print(f"resuming from {resume_ckpt}")

    init_path = resume_ckpt or args.init_from
    if init_path:
        init_path = Path(init_path)
        if not init_path.exists():
            raise SystemExit(f"checkpoint not found: {init_path}")
        ckpt = torch.load(init_path, map_location=device, weights_only=False)
        # Head layout may differ when toggling dual_stream; load what fits.
        try:
            model.head.load_state_dict(ckpt["head"])
        except RuntimeError as e:
            print(f"head warm-start skipped (shape mismatch): {e}")
        if args.dual_stream and "residual_enc" in ckpt and model.residual_enc is not None:
            model.residual_enc.load_state_dict(ckpt["residual_enc"])
        if args.lora_r > 0 and "lora" in ckpt:
            model.backbone.load_state_dict(ckpt["lora"], strict=False)
        if args.resume:
            logged = history_from_log(log_path)
            if "history" in ckpt and ckpt["history"]:
                history = list(ckpt["history"])
            if logged:
                # Prefer denser log history when ckpt has none / fewer rows.
                if len(logged) >= len(history):
                    history = logged
            if history:
                start_epoch = max(start_epoch, int(history[-1]["epoch"]) + 1)
            elif ckpt.get("epoch"):
                start_epoch = int(ckpt["epoch"]) + 1
            candidates = [best_iou]
            if ckpt.get("best_iou") is not None:
                candidates.append(float(ckpt["best_iou"]))
            if ckpt.get("metrics", {}).get("iou") is not None:
                candidates.append(float(ckpt["metrics"]["iou"]))
            if history:
                candidates.append(max(float(r.get("val_iou", -1)) for r in history))
            # Prefer metrics on dedicated best.pt if present (last.pt can lag best_iou).
            best_file = out_dir / "best.pt"
            if best_file.exists() and Path(init_path).resolve() != best_file.resolve():
                try:
                    bck = torch.load(best_file, map_location="cpu", weights_only=False)
                    if bck.get("best_iou") is not None:
                        candidates.append(float(bck["best_iou"]))
                    if bck.get("metrics", {}).get("iou") is not None:
                        candidates.append(float(bck["metrics"]["iou"]))
                except Exception:
                    pass
            best_iou = max(candidates)
        print(
            f"loaded {init_path} (ckpt_epoch={ckpt.get('epoch')}) "
            f"→ start_epoch={start_epoch} best_iou={best_iou:.4f} history={len(history)}"
        )

    n_train = sum(p.numel() for p in model.trainable_parameters())
    print(f"trainable_params={n_train}")
    opt = torch.optim.AdamW(model.trainable_parameters(), lr=args.lr, weight_decay=WEIGHT_DECAY)
    if args.resume and resume_ckpt:
        ckpt = torch.load(resume_ckpt, map_location=device, weights_only=False)
        if "optimizer" in ckpt:
            try:
                opt.load_state_dict(ckpt["optimizer"])
                print("restored optimizer state")
            except Exception as e:
                print(f"optimizer restore skipped: {e}")
    pos_weight = torch.tensor(float(args.pos_weight), device=device)
    print(f"pos_weight={float(args.pos_weight)}")

    if start_epoch > args.epochs:
        print(f"nothing to do: start_epoch={start_epoch} > epochs={args.epochs}")
        return

    t0 = time.time()
    for epoch in range(start_epoch, args.epochs + 1):
        model.train()
        losses = []
        pbar = tqdm(train_loader, desc=f"epoch {epoch}/{args.epochs}", leave=False)
        for batch in pbar:
            targets = batch["patches"].to(device)
            opt.zero_grad(set_to_none=True)
            out = _forward(model, batch, device)
            loss = combined_loss(out.logits, targets, pos_weight, args.dice_weight)
            loss.backward()
            opt.step()
            losses.append(loss.item())
            pbar.set_postfix(loss=f"{np.mean(losses):.4f}")
            if device == "cuda":
                torch.cuda.empty_cache()

        val = evaluate(model, val_loader, device, pos_weight, args.dice_weight)
        row = {"epoch": epoch, "train_loss": float(np.mean(losses)), **{f"val_{k}": v for k, v in val.items()}}
        history.append(row)
        print(json.dumps(row), flush=True)

        if val["iou"] > best_iou:
            best_iou = val["iou"]
            payload = save_payload(model, args, val, epoch, best_path, opt=opt, history=history, best_iou=best_iou)
            # Never auto-clobber prod during smoke or experimental runs without --promote-best.
            if args.promote_best and not args.smoke:
                torch.save(payload, CHECKPOINT_DIR / "best_dinolizer.pt")
                print(f"promoted → {CHECKPOINT_DIR / 'best_dinolizer.pt'}", flush=True)

        # Always checkpoint last epoch for crash resume (after best_iou update).
        save_payload(model, args, val, epoch, last_path, opt=opt, history=history, best_iou=best_iou)

    summary = {
        "run_name": run_name,
        "best_val_iou": best_iou,
        "elapsed_s": round(time.time() - t0, 1),
        "history": history,
        "checkpoint": str(best_path),
        "lora_r": args.lora_r,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resumed": bool(args.resume),
    }
    (out_dir / "train_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: summary[k] for k in ("run_name", "best_val_iou", "elapsed_s", "checkpoint", "lora_r")}, indent=2))


if __name__ == "__main__":
    main()
