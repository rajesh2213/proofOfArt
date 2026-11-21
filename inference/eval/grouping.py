import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from PIL import Image

from eval.config import SPLIT_FRACTIONS, SPLIT_SALT

DHASH_MAX_BUCKET = 50
NEAR_DUP_HAMMING = 2


def group_key(source: str, filename: str) -> str:
    """Identity that must never straddle splits.

    Filenames carry the only identity signal available today: WikiArt encodes
    the artist, IMD2020 encodes the Flickr uploader, and derived files (jpg/png
    twins, edited/original/mask triples) share a stem.
    """
    source = source.lower()
    stem = Path(filename).stem
    if source in {"wikiart"}:
        return f"wikiart:{stem.split('_', 1)[0].lower()}"
    if source == "imd2020":
        return f"imd2020:{stem.rsplit('_', 1)[0].lower()}"
    return f"{source}:{stem.lower()}"


def dhash(path: Path) -> Optional[int]:
    try:
        with Image.open(path) as img:
            img.draft("L", (64, 64))
            small = img.convert("L").resize((9, 8), Image.BILINEAR)
            px = list(small.getdata())
    except Exception:
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | int(px[row * 9 + col] > px[row * 9 + col + 1])
    return bits


def assign_split(group_id: str) -> str:
    digest = hashlib.sha1(f"{SPLIT_SALT}:{group_id}".encode()).digest()
    u = int.from_bytes(digest[:8], "big") / 2**64
    edge = 0.0
    for name, frac in SPLIT_FRACTIONS.items():
        edge += frac
        if u < edge:
            return name
    return "test"


class UnionFind:
    def __init__(self):
        self.parent: Dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Deterministic root keeps split assignment stable across runs.
            lo, hi = sorted((ra, rb))
            self.parent[hi] = lo


def near_duplicate_pairs(hashes: List[Tuple[str, int]]) -> Iterable[Tuple[str, str, int]]:
    """Yield (id_a, id_b, hamming) for dHashes within NEAR_DUP_HAMMING bits.

    Four 16-bit bands: by pigeonhole any pair within 3 bits shares a band.
    Oversized buckets are flat/solid images and would glue unrelated groups.
    """
    seen = set()
    for band in range(4):
        buckets: Dict[int, List[Tuple[str, int]]] = defaultdict(list)
        shift = band * 16
        for item_id, h in hashes:
            buckets[(h >> shift) & 0xFFFF].append((item_id, h))
        for members in buckets.values():
            if len(members) < 2 or len(members) > DHASH_MAX_BUCKET:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    (a, ha), (b, hb) = members[i], members[j]
                    dist = bin(ha ^ hb).count("1")
                    if dist <= NEAR_DUP_HAMMING:
                        key = (a, b) if a < b else (b, a)
                        if key not in seen:
                            seen.add(key)
                            yield key[0], key[1], dist
