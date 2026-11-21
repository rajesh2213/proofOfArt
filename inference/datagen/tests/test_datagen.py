import io

import numpy as np
from PIL import Image

from datagen.editors import CopyMove, OpenCVInpainter, composite, context_box
from datagen.generate import apply_postproc, qc, sample_postproc, stable_rng
from datagen.masks import MaskSpec, bbox_of, brush_mask, choose_mask
from datagen.taxonomy import EDITOR_LABEL, LABELS, Q1_TARGET


def textured(w=320, h=240, seed=0):
    rng = np.random.default_rng(seed)
    return Image.fromarray(rng.integers(0, 255, (h, w, 3), dtype=np.uint8))


def square_mask(h=240, w=320):
    m = np.zeros((h, w), bool)
    m[80:160, 100:200] = True
    return m


def test_taxonomy_keeps_ai_edits_out_of_q1():
    assert Q1_TARGET["ai_local_edit"] == 0 and Q1_TARGET["fully_synthetic"] == 1
    assert set(EDITOR_LABEL.values()) <= set(LABELS)


def test_composite_only_changes_pixels_near_the_mask():
    img, mask = textured(), square_mask()
    patch = Image.new("RGB", img.size, (0, 255, 0))
    res = composite(img, patch, (0, 0, *img.size), mask, feather_px=6)
    diff = np.abs(np.asarray(img, np.int16) - np.asarray(res.image, np.int16)).sum(axis=2)
    far = np.ones_like(mask)
    far[60:180, 80:220] = False
    assert diff[far].max() == 0
    assert res.gt_mask[mask].all()
    assert qc(img, res.image, res.gt_mask, True)[0] is None


def test_qc_rejects_edits_that_leak_outside_the_mask():
    img, mask = textured(), square_mask()
    leaked = Image.fromarray(np.clip(np.asarray(img, np.int16) + 30, 0, 255).astype(np.uint8))
    assert qc(img, leaked, mask, True)[0] == "leak_outside_mask"
    assert qc(img, img, mask, True)[0] == "edit_invisible"


def test_postproc_is_shared_and_moves_the_mask():
    rng = stable_rng("run", "img")
    pp = {"format": "jpeg", "quality": 80, "scale": 0.5}
    edited_bytes, mask = apply_postproc(textured(), square_mask(), pp)
    pristine_bytes, _ = apply_postproc(textured(seed=1), None, pp)
    a, b = Image.open(io.BytesIO(edited_bytes)), Image.open(io.BytesIO(pristine_bytes))
    assert a.format == b.format == "JPEG" and a.size == b.size == (160, 120) and mask.shape == (120, 160)
    assert sample_postproc(stable_rng("x")) == sample_postproc(stable_rng("x"))
    assert rng.random() == stable_rng("run", "img").random()


def test_masks_are_bounded_and_deterministic():
    m1 = brush_mask(256, 256, np.random.default_rng(3))
    m2 = brush_mask(256, 256, np.random.default_rng(3))
    assert np.array_equal(m1, m2) and 0.01 < m1.mean() < 0.4
    box = bbox_of(square_mask())
    assert box.sum() >= square_mask().sum()
    spec = choose_mask(textured(), None, np.random.default_rng(0))
    assert spec.kind == "brush" and spec.mask.shape == (240, 320)


def test_context_box_is_square_and_inside_image():
    x0, y0, x1, y1 = context_box(square_mask(), min_side=200)
    assert x1 - x0 == y1 - y0 and x0 >= 0 and y0 >= 0 and x1 <= 320 and y1 <= 240


def test_traditional_editors_change_the_region():
    img, mask = textured(), square_mask()
    rng = np.random.default_rng(1)
    for editor in (OpenCVInpainter(), CopyMove()):
        res = editor.edit(img, MaskSpec(mask, "instance"), rng)
        assert res is not None and res.image.size == img.size
        assert qc(img, res.image, res.gt_mask, True)[0] is None, editor.name
