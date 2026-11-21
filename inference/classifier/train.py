"""Train P2 DINOv2 CLS probe for Q1 (whole-image AI).

    cd inference
    .\\.venv-gen\\Scripts\\python -m classifier.train --smoke
    .\\.venv-gen\\Scripts\\python -m classifier.train --epochs 8 --run-name dinoprobe_v1
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from classifier.config import (
    BACKBONE,
    BATCH_SIZE,
    CHECKPOINT_DIR,
    EPOCHS,
    IMAGE_SIZE,
    JPEG_PROB,
    LR,
    MAX_PER_CLASS,
    NUM_WORKERS,
    WEIGHT_DECAY,
)
from classifier.dataset import WholeImageDataset, load_rows
from classifier.model import DinoProbeClassifier


@torch.no_grad()
def evaluate(model, loader, device) -> dict:
    model.eval()
    losses, ys, ps = [], [], []
    for batch in loader:
        images = batch["image"].to(device)
        y = batch["y"].to(device)
        logit = model(images)
        loss = F.binary_cross_entropy_with_logits(logit, y)
        losses.append(loss.item())
        ys.append(y.cpu().numpy())
        ps.append(torch.sigmoid(logit).cpu().numpy())
    y = np.concatenate(ys) if ys else np.array([])
    p = np.concatenate(ps) if ps else np.array([])
    out = {"loss": float(np.mean(losses)) if losses else 0.0}
    if len(y) and y.min() != y.max():
        from sklearn.metrics import roc_auc_score

        out["auc"] = float(roc_auc_score(y, p))
        pred = (p >= 0.5).astype(np.float32)
        out["acc"] = float((pred == y).mean())
    else:
        out["auc"] = 0.0
        out["acc"] = 0.0
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backbone", default=BACKBONE)
    ap.add_argument("--image-size", type=int, default=IMAGE_SIZE)
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    ap.add_argument("--epochs", type=int, default=EPOCHS)
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--lora-r", type=int, default=0)
    ap.add_argument("--lora-alpha", type=int, default=16)
    ap.add_argument("--max-per-class", type=int, default=MAX_PER_CLASS)
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--init-from", type=str, default=None,
                    help="warm-start head/LoRA from a prior best.pt (continues from ckpt epoch+1)")
    ap.add_argument("--promote-best", action="store_true",
                    help="also copy improving checkpoints to CHECKPOINT_DIR/best_dinoprobe.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--run-name", default=None)
    args = ap.parse_args(argv)

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    if args.smoke:
        args.epochs = 2
        args.max_per_class = 32
        args.batch_size = 4
    if args.lr is None:
        args.lr = 2e-4 if args.lora_r > 0 else LR

    run_name = args.run_name or datetime.now().strftime("dinoprobe_%Y%m%d_%H%M%S")
    out_dir = CHECKPOINT_DIR / run_name
    out_dir.mkdir(parents=True, exist_ok=True)

    train_rows = load_rows("train", max_per_class=args.max_per_class)
    val_rows = load_rows("val", max_per_class=min(args.max_per_class, 2000))
    print(f"train={len(train_rows)} val={len(val_rows)} device={device} lora_r={args.lora_r}", flush=True)

    train_loader = DataLoader(
        WholeImageDataset(train_rows, args.image_size, train=True, jpeg_prob=0.0 if args.smoke else JPEG_PROB),
        batch_size=args.batch_size, shuffle=True, num_workers=NUM_WORKERS, pin_memory=device == "cuda",
    )
    val_loader = DataLoader(
        WholeImageDataset(val_rows, args.image_size, train=False, jpeg_prob=0.0),
        batch_size=args.batch_size, shuffle=False, num_workers=NUM_WORKERS, pin_memory=device == "cuda",
    )

    history, best_auc, best_path = [], -1.0, out_dir / "best.pt"
    start_epoch = 1
    if args.init_from:
        from pathlib import Path as _P
        from classifier.model import load_classifier

        init_path = _P(args.init_from)
        if not init_path.exists():
            init_path = CHECKPOINT_DIR / args.init_from
        model, _cfg = load_classifier(str(init_path), device, backbone=args.backbone)
        ckpt = torch.load(init_path, map_location="cpu", weights_only=False)
        start_epoch = int(ckpt.get("epoch", 0)) + 1
        metrics = ckpt.get("metrics") or {}
        if "auc" in metrics:
            best_auc = float(metrics["auc"])
        print(f"init-from {init_path} → start_epoch={start_epoch} best_auc={best_auc:.4f}", flush=True)
    else:
        model = DinoProbeClassifier(
            backbone=args.backbone, freeze_backbone=True, lora_r=args.lora_r, lora_alpha=args.lora_alpha,
        ).to(device)

    print(f"trainable_params={sum(p.numel() for p in model.trainable_parameters())}", flush=True)
    opt = torch.optim.AdamW(model.trainable_parameters(), lr=args.lr, weight_decay=WEIGHT_DECAY)

    if start_epoch > args.epochs:
        print(f"nothing to do: start_epoch={start_epoch} > epochs={args.epochs}", flush=True)
        return

    t0 = time.time()
    for epoch in range(start_epoch, args.epochs + 1):
        model.train()
        losses = []
        pbar = tqdm(train_loader, desc=f"epoch {epoch}/{args.epochs}", leave=False)
        for batch in pbar:
            images = batch["image"].to(device)
            y = batch["y"].to(device)
            opt.zero_grad(set_to_none=True)
            logit = model(images)
            loss = F.binary_cross_entropy_with_logits(logit, y)
            loss.backward()
            opt.step()
            losses.append(loss.item())
            pbar.set_postfix(loss=f"{np.mean(losses):.4f}")
        val = evaluate(model, val_loader, device)
        row = {"epoch": epoch, "train_loss": float(np.mean(losses)), **{f"val_{k}": v for k, v in val.items()}}
        history.append(row)
        print(json.dumps(row), flush=True)
        if val["auc"] > best_auc:
            best_auc = val["auc"]
            exported = model.export_trainable_state()
            payload = {
                "head": exported["head"],
                "config": {
                    "backbone": args.backbone,
                    "image_size": args.image_size,
                    "lora_r": args.lora_r,
                    "lora_alpha": args.lora_alpha,
                },
                "metrics": val,
                "epoch": epoch,
            }
            if "lora" in exported:
                payload["lora"] = exported["lora"]
            torch.save(payload, best_path)
            if args.promote_best and not args.smoke:
                torch.save(payload, CHECKPOINT_DIR / "best_dinoprobe.pt")
                print(f"promoted → {CHECKPOINT_DIR / 'best_dinoprobe.pt'}", flush=True)

    summary = {
        "run_name": run_name,
        "best_val_auc": best_auc,
        "elapsed_s": round(time.time() - t0, 1),
        "history": history,
        "checkpoint": str(best_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "train_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: summary[k] for k in ("run_name", "best_val_auc", "elapsed_s", "checkpoint")}, indent=2))


if __name__ == "__main__":
    main()
