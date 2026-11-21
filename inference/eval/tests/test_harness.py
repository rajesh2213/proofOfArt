import numpy as np
from PIL import Image

from eval.adapters.base import DecisionConfig
from eval.degradations import DEGRADATIONS
from eval.gates import check_absolute, resolve
from eval.grouping import UnionFind, assign_split, group_key, near_duplicate_pairs
from eval.metrics import classification_metrics, fpr_at_tpr, localization_image_metrics, tpr_at_fpr


def test_group_keys_share_identity():
    assert group_key("wikiart", "aaron-siskind_acolman-1-1955.jpg") == group_key("wikiart", "aaron-siskind_x.jpg")
    assert group_key("imd2020", "-epsilon-_9110044287.jpg") == group_key("imd2020", "-epsilon-_9110045107.jpg")
    assert group_key("diffusiondb", "abc.jpg") == group_key("diffusiondb", "abc.png")


def test_split_assignment_is_deterministic_and_proportional():
    assert assign_split("wikiart:monet") == assign_split("wikiart:monet")
    splits = [assign_split(f"g{i}") for i in range(20000)]
    test_frac = splits.count("test") / len(splits)
    assert 0.13 < test_frac < 0.17


def test_union_find_root_is_order_independent():
    a, b = UnionFind(), UnionFind()
    a.union("x", "y"); a.union("y", "z")
    b.union("z", "y"); b.union("y", "x")
    assert a.find("z") == b.find("x") == "x"


def test_near_duplicates_found_within_two_bits():
    h = 0xF0F0F0F0F0F0F0F0
    pairs = list(near_duplicate_pairs([("a", h), ("b", h ^ 0b11), ("c", ~h & (2**64 - 1))]))
    assert [(p[0], p[1]) for p in pairs] == [("a", "b")]


def test_classification_metrics_perfect_and_inverted():
    y = np.array([0] * 50 + [1] * 50)
    s = np.linspace(0, 1, 100)
    m = classification_metrics(y, s, DecisionConfig(ai_threshold=0.5), with_ci=False)
    assert m["auc"] == 1.0 and m["balanced_acc@0.5"] == 1.0
    assert tpr_at_fpr(y, s, 0.01) == 1.0 and fpr_at_tpr(y, s, 0.95) == 0.0
    assert classification_metrics(y, 1 - s, DecisionConfig(), with_ci=False)["auc"] == 0.0


def test_localization_metrics_exact_mask():
    gt = np.zeros((100, 100), dtype=np.uint8)
    gt[20:60, 20:60] = 255
    prob = np.zeros((50, 50), dtype=np.float32)
    prob[10:30, 10:30] = 0.9
    m = localization_image_metrics(prob, Image.fromarray(gt), (100, 100), DecisionConfig(morph_closing=1))
    assert m["detected"] and abs(m["iou"] - 1.0) < 1e-6 and abs(m["f1"] - 1.0) < 1e-6
    empty = localization_image_metrics(np.zeros((50, 50), np.float32), None, (100, 100), DecisionConfig())
    assert not empty["detected"] and empty["area_ratio"] == 0.0


def test_geometric_degradations_move_the_mask():
    img = Image.new("RGB", (200, 100))
    mask = Image.new("L", (200, 100))
    for name in ("resize0.5", "crop0.8", "social"):
        out_img, out_mask = DEGRADATIONS[name](img, mask, "k")
        assert out_img.size == out_mask.size
    a, _ = DEGRADATIONS["noise5"](img, None, "same-key")
    b, _ = DEGRADATIONS["noise5"](img, None, "same-key")
    assert np.array_equal(np.asarray(a), np.asarray(b))


def test_gate_resolution_handles_dotted_keys_and_wildcards():
    report = {"classification": {"results": {"clean": {
        "overall": {"balanced_acc@0.5": 0.8, "n": 100},
        "external": {"cross_generator_flux": {"auc": 0.9, "n": 80}, "cross_generator_sd3": {"auc": 0.7, "n": 60}},
    }}}}
    assert resolve(report, "classification.results.clean.overall.balanced_acc@0.5") == [0.8]
    assert sorted(resolve(report, "classification.results.clean.external.cross_generator*.auc")) == [0.7, 0.9]
    gate = {"id": "g", "path": "classification.results.clean.external.cross_generator*.auc", "op": ">=",
            "value": 0.8, "n_path": "classification.results.clean.external.cross_generator*.n"}
    assert check_absolute(report, gate, 50)["status"] == "FAIL"
    assert check_absolute(report, {**gate, "path": "missing.path"}, 50)["status"] == "MISSING"
