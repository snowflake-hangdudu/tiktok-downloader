"""Generate platform icons from shared-download-kit brand-assets.

All three downloaders must call this (or sync_brand.py) — never remap from
YouTube source or shared-extension-core. Those paths restore obsolete art.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/gen_icons.py` from kit or from a downloader that adds this file.
KIT = Path(__file__).resolve().parents[1]
if KIT.name != "shared-download-kit":
    # When copied/linked under an extension, resolve sibling kit.
    KIT = Path(__file__).resolve().parents[2] / "shared-download-kit"

sys.path.insert(0, str(KIT / "scripts"))
from sync_brand import PLATFORM_META, process_master, resize_icon, SIZES  # noqa: E402

from PIL import Image  # noqa: E402


def generate_for(platform: str, dest_root: Path | None = None) -> None:
    if platform not in PLATFORM_META:
        raise SystemExit(f"unknown platform: {platform}. expected one of {', '.join(PLATFORM_META)}")
    source = KIT / "brand-assets" / f"{platform}.png"
    if not source.is_file():
        raise SystemExit(f"missing brand asset: {source}")
    root = dest_root or (KIT.parent / PLATFORM_META[platform]["dir"])
    master = process_master(source)
    processed = KIT / "brand-assets" / "processed" / f"{platform}.png"
    processed.parent.mkdir(parents=True, exist_ok=True)
    master.save(processed, "PNG", optimize=True)

    targets = {
        root / "assets" / "icon-source.png": master,
        root / "icons" / "icon-source.png": master,
    }
    for size in SIZES:
        small = resize_icon(master, size)
        targets[root / "icons" / f"icon{size}.png"] = small
        targets[root / "assets" / f"icon{size}.png"] = small
    targets[root / "store" / "logo-300.png"] = resize_icon(master, 300)
    targets[root / "store" / "store-icon-128.png"] = resize_icon(master, 128)

    for path, image in targets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, "PNG", optimize=True)
        print("OK", path.relative_to(root) if root in path.parents or path == root else path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate icons from kit brand-assets")
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORM_META))
    parser.add_argument("--root", default="", help="extension root (default: sibling *-downloader)")
    args = parser.parse_args()
    dest = Path(args.root).resolve() if args.root else None
    generate_for(args.platform, dest)


if __name__ == "__main__":
    main()
