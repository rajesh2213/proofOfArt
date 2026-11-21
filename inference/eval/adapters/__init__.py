from typing import Callable, Dict

from eval.adapters.base import ClassifierAdapter, LocalizerAdapter


def _baseline_classifier() -> ClassifierAdapter:
    from eval.adapters.keras_baseline import BaselineB0Classifier
    return BaselineB0Classifier()


def _baseline_localizer() -> LocalizerAdapter:
    from eval.adapters.keras_baseline import BaselineB0Localizer
    return BaselineB0Localizer()


def _dinolizer() -> LocalizerAdapter:
    from eval.adapters.dinolizer import DinoLizerAdapter
    return DinoLizerAdapter()


def _dinoprobe() -> ClassifierAdapter:
    from eval.adapters.dinoprobe import DinoProbeAdapter
    return DinoProbeAdapter()


CLASSIFIERS: Dict[str, Callable[[], ClassifierAdapter]] = {
    "baseline_b0": _baseline_classifier,
    "dinoprobe_v1": _dinoprobe,
}

LOCALIZERS: Dict[str, Callable[[], LocalizerAdapter]] = {
    "baseline_b0_multihead_mask": _baseline_localizer,
    "dinolizer_v1": _dinolizer,
}
