"""Synchronize brand themes and icons for download assistants.

Authoritative sources:
  - themes.json              brand colors
  - brand-assets/{id}.png    original icon art (kept intact)
  - shared/design-system.css shared visual rules

Generated / distributed:
  - brand-assets/processed/{id}.png   outer-bg removed master
  - each extension icons/, assets/, store/ icon copies
  - each extension shared/design-system.css (theme tokens embedded)

Usage:
  python scripts/sync_brand.py
  python scripts/sync_brand.py --check
  python scripts/sync_brand.py --platform bilibili --platform douyin

Default scope (no --platform): bilibili + douyin only. YouTube is not updated unless explicitly requested.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter, ImageChops

KIT = Path(__file__).resolve().parents[1]
WORKSPACE = KIT.parent
DEFAULT_PLATFORMS = ("bilibili", "douyin")
PANEL_CSS_TARGETS = {
    "douyin": ("douyin-downloader", "shared/panel.css"),
}
START_BRAND = "/* BEGIN SHARED DOWNLOAD BRAND */"
END_BRAND = "/* END SHARED DOWNLOAD BRAND */"
START_TOKENS = "/* BEGIN THEME TOKENS */"
END_TOKENS = "/* END THEME TOKENS */"
SIZES = (16, 32, 48, 128)

PLATFORM_META = {
    "bilibili": {
        "dir": "bilibili-downloader",
        "panel_selector": '#bili-dl-panel[data-theme="bilibili"]',
        "popup_selector": 'body[data-theme="bilibili"]',
        "aliases": ("bdl",),
        "css_strip": (
            "content/content.css",
            "popup/popup.css",
        ),
        "extra_icon_notes": (),
    },
    "youtube": {
        "dir": "youtube-downloader",
        "panel_selector": '#yt-dl-panel[data-theme="youtube"]',
        "popup_selector": 'body[data-theme="youtube"]',
        "aliases": ("ytd",),
        "css_strip": (
            "content/content.css",
            "popup/popup.css",
        ),
        # Historical alternate; do not overwrite or use as source.
        "extra_icon_notes": ("assets/icon-brand.png", "assets/icon-source.blackbg.png"),
    },
    "douyin": {
        "dir": "douyin-downloader",
        "panel_selector": '.dl-kit[data-theme="douyin"]',
        "popup_selector": 'body[data-theme="douyin"]',
        "aliases": ("dl",),
        "css_strip": (
            "content/content.css",
            "popup/popup.css",
            "shared/panel.css",
        ),
        "extra_icon_notes": (),
    },
    "tiktok": {
        "dir": "tiktok-downloader",
        "panel_selector": '.dl-kit[data-theme="tiktok"]',
        "popup_selector": 'body[data-theme="tiktok"]',
        "aliases": ("dl",),
        "css_strip": (
            "content/content.css",
            "popup/popup.css",
            "shared/panel.css",
        ),
        "extra_icon_notes": (),
    },
}


def load_themes() -> dict:
    data = json.loads((KIT / "themes.json").read_text(encoding="utf-8"))
    if "platforms" not in data:
        # backward compat: flat map
        data = {"neutral": {}, "platforms": data}
    canonical = WORKSPACE.parent / "主题" / "主题.json"
    if canonical.is_file():
        fixed = json.loads(canonical.read_text(encoding="utf-8-sig"))
        entries = fixed.get("themes") if isinstance(fixed, dict) else None
        if not isinstance(entries, list):
            raise SystemExit(f"固定主题文件缺少 themes 数组: {canonical}")
        seen: set[str] = set()
        for entry in entries:
            if (not isinstance(entry, dict)
                    or not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", str(entry.get("id", "")))
                    or entry["id"] in seen
                    or not isinstance(entry.get("name"), str)
                    or not isinstance(entry.get("colors"), dict)
                    or not isinstance(entry.get("gradients"), dict)):
                raise SystemExit(f"固定主题文件包含无效条目: {canonical}")
            colors = entry["colors"]
            required_colors = {
                "background", "surface", "surfaceHover", "surfaceStrong", "border", "borderSoft",
                "textPrimary", "textSecondary", "textMuted", "primary", "primaryStrong", "primaryHover",
                "primarySoft", "primaryBorder", "accent", "accentSecondary",
            }
            gradients = entry["gradients"]
            if not required_colors.issubset(colors):
                raise SystemExit(f"固定主题颜色字段不完整: {entry['id']}")
            if not all(re.fullmatch(r"#[0-9a-fA-F]{6}", str(value)) for value in colors.values()):
                raise SystemExit(f"固定主题颜色必须是六位 HEX: {entry['id']}")
            if not {"primaryButton", "preview", "header"}.issubset(gradients):
                raise SystemExit(f"固定主题渐变字段不完整: {entry['id']}")
            if not all(re.fullmatch(r"linear-gradient\([A-Za-z0-9\s,#.%()-]+\)", str(value))
                       for value in gradients.values()):
                raise SystemExit(f"固定主题渐变格式无效: {entry['id']}")
            seen.add(entry["id"])
        data["fixedThemes"] = entries
    else:
        data["fixedThemes"] = []
    return data
    return data


def sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def is_near_white(r: int, g: int, b: int, a: int) -> bool:
    if a < 8:
        return True
    return r > 242 and g > 242 and b > 242 and abs(r - g) < 10 and abs(g - b) < 10


def is_near_black(r: int, g: int, b: int, a: int) -> bool:
    if a < 8:
        return True
    return r < 18 and g < 18 and b < 18


def detect_outer_mode(img: Image.Image) -> str | None:
    px = img.load()
    w, h = img.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    avg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    if avg[0] > 240 and avg[1] > 240 and avg[2] > 240:
        return "white"
    if avg[0] < 20 and avg[1] < 20 and avg[2] < 20:
        return "black"
    return None


def remove_outer_background(img: Image.Image) -> Image.Image:
    """Flood-fill from edges only. Never global white/black→transparent."""
    out = img.convert("RGBA")
    mode = detect_outer_mode(out)
    if mode is None:
        return out

    # Work on a downscaled mask for speed, then upsample.
    max_side = 512
    scale = 1.0
    work = out
    if max(out.size) > max_side:
        scale = max_side / max(out.size)
        work = out.resize(
            (max(1, int(out.width * scale)), max(1, int(out.height * scale))),
            Image.Resampling.BILINEAR,
        )

    w, h = work.size
    px = work.load()
    matcher = is_near_white if mode == "white" else is_near_black
    visited = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    mask = Image.new("L", (w, h), 0)
    mask_px = mask.load()
    while q:
        x, y = q.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        r, g, b, a = px[x, y]
        if not matcher(r, g, b, a):
            continue
        mask_px[x, y] = 255
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                q.append((nx, ny))

    if scale != 1.0:
        mask = mask.resize(out.size, Image.Resampling.NEAREST)
    # Expand 1px to catch anti-aliased fringe on full-res edges
    mask = mask.filter(ImageFilter.MaxFilter(3))

    keep = mask.point(lambda v: 0 if v > 128 else 255)
    alpha = out.getchannel("A")
    out.putalpha(ImageChops.multiply(alpha, keep))
    return out


def square_pad(img: Image.Image, pad_ratio: float = 0.02) -> Image.Image:
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if not bbox:
        return img
    cropped = img.crop(bbox)
    side = max(cropped.size)
    margin = max(1, int(side * pad_ratio))
    canvas_side = side + margin * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    ox = (canvas_side - cropped.width) // 2
    oy = (canvas_side - cropped.height) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    return canvas


def process_master(source: Path) -> Image.Image:
    with Image.open(source) as im:
        cleaned = remove_outer_background(im)
    return square_pad(cleaned)


def resize_icon(master: Image.Image, size: int) -> Image.Image:
    if size <= 32:
        big = master.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
        big = big.filter(ImageFilter.UnsharpMask(radius=1.1, percent=130, threshold=2))
        return big.resize((size, size), Image.Resampling.LANCZOS)
    return master.resize((size, size), Image.Resampling.LANCZOS)


def strip_brand_blocks(text: str) -> str:
    while START_BRAND in text and END_BRAND in text:
        before, rest = text.split(START_BRAND, 1)
        _, after = rest.split(END_BRAND, 1)
        text = before.rstrip() + "\n" + after.lstrip("\n")
    return text.rstrip() + "\n"


def css_escape_value(value: str) -> str:
    return value


def build_token_block(themes: dict) -> str:
    neutral = themes.get("neutral") or {}
    platforms = themes["platforms"]
    lines = [START_TOKENS, "/* regenerated by sync_brand.py — do not edit by hand */", ""]

    def emit_neutral(selector: str) -> None:
        lines.append(f"{selector} {{")
        mapping = {
            "--bg": neutral.get("bg", "#FFFFFF"),
            "--surface": neutral.get("surface", "#F7F8FA"),
            "--surface-hover": neutral.get("surfaceHover", "#F2F4F7"),
            "--surface-strong": neutral.get("surfaceStrong", "#ECEFF3"),
            "--border": neutral.get("border", "#E5E7EB"),
            "--border-soft": neutral.get("borderSoft", "#EEF0F2"),
            "--text-primary": neutral.get("textPrimary", "#18181B"),
            "--text-secondary": neutral.get("textSecondary", "#52525B"),
            "--text-muted": neutral.get("textMuted", "#71717A"),
            "--footer-bg": neutral.get("footerBg", "#F3F4F6"),
            "--footer-text": neutral.get("footerText", "#52525B"),
        }
        for key, val in mapping.items():
            lines.append(f"  {key}: {css_escape_value(val)};")
        lines.append("}")
        lines.append("")

    # Shared neutral on all known roots (platform-specific brand below).
    for meta in PLATFORM_META.values():
        emit_neutral(meta["panel_selector"])
        emit_neutral(meta["popup_selector"])

    for name, theme in platforms.items():
        if name not in PLATFORM_META:
            continue
        meta = PLATFORM_META[name]
        cta = f"linear-gradient(135deg, {theme['ctaFrom']}, {theme['ctaTo']})"
        brand_vars = {
            "--brand": theme["brand"],
            "--brand-strong": theme["strong"],
            "--brand-hover": theme["hover"],
            "--brand-soft": theme["soft"],
            "--brand-border": theme["border"],
            "--brand-cta": cta,
        }
        if "cyan" in theme:
            brand_vars["--brand-cyan"] = theme["cyan"]
        if "pink" in theme:
            brand_vars["--brand-pink"] = theme["pink"]

        alias_map = {
            "primary": "var(--brand)",
            "accent": "var(--brand)",
            "primary-strong": "var(--brand-strong)",
            "accent-strong": "var(--brand-strong)",
            "primary-hover": "var(--brand-hover)",
            "primary-soft": "var(--brand-soft)",
            "primary-border": "var(--brand-border)",
            "primary-contrast": "#ffffff",
            "accent-soft": "var(--brand-soft)",
            "bg": "var(--bg)",
            "surface": "var(--surface)",
            "border": "var(--border)",
            "text": "var(--text-primary)",
            "text-secondary": "var(--text-secondary)",
            "text-muted": "var(--text-muted)",
            "header-text": "var(--text-primary)",
        }

        for selector in (meta["panel_selector"], meta["popup_selector"]):
            lines.append(f"{selector} {{")
            for key, val in brand_vars.items():
                lines.append(f"  {key}: {val};")
            for alias in meta["aliases"]:
                for short, ref in alias_map.items():
                    lines.append(f"  --{alias}-{short}: {ref};")
                # Bilibili historical names
                if alias == "bdl":
                    lines.append("  --bdl-accent: var(--brand);")
                    lines.append("  --bdl-accent-strong: var(--brand-strong);")
                    lines.append("  --bdl-accent-hover: var(--brand-hover);")
                    lines.append("  --bdl-accent-soft: var(--brand-soft);")
                    lines.append("  --bdl-accent-border: var(--brand-border);")
                    lines.append("  --bdl-accent-contrast: #ffffff;")
                if alias == "ytd":
                    lines.append("  --ytd-primary: var(--brand);")
                    lines.append("  --ytd-primary-strong: var(--brand-strong);")
                    lines.append("  --ytd-primary-hover: var(--brand-hover);")
                    lines.append("  --ytd-primary-soft: var(--brand-soft);")
                    lines.append("  --ytd-primary-contrast: #ffffff;")
                if alias == "dl":
                    lines.append("  --dl-primary: var(--brand);")
                    lines.append("  --dl-primary-hover: var(--brand-hover);")
                    lines.append("  --dl-primary-soft: var(--brand-soft);")
                    lines.append("  --dl-primary-contrast: #ffffff;")
            lines.append("}")
            lines.append("")

    palette_roots = (
        ".dl-kit[data-theme=\"{id}\"]",
        "body[data-theme=\"{id}\"]",
        "#bili-dl-panel[data-theme=\"{id}\"]",
        "#yt-dl-panel[data-theme=\"{id}\"]",
    )
    for theme in themes.get("fixedThemes", []):
        theme_id = theme["id"]
        colors = theme["colors"]
        gradients = theme["gradients"]
        roots = ",\n".join(selector.format(id=theme_id) for selector in palette_roots)
        lines.append(f"{roots} {{")
        palette_vars = {
            "--bg": colors["background"],
            "--surface": colors["surface"],
            "--surface-hover": colors["surfaceHover"],
            "--surface-strong": colors["surfaceStrong"],
            "--border": colors["border"],
            "--border-soft": colors["borderSoft"],
            "--text-primary": colors["textPrimary"],
            "--text-secondary": colors["textSecondary"],
            "--text-muted": colors["textMuted"],
            "--footer-bg": colors["surface"],
            "--footer-text": colors["textSecondary"],
            "--brand": colors["primary"],
            "--brand-strong": colors["primaryStrong"],
            "--brand-hover": colors["primaryHover"],
            "--brand-soft": colors["primarySoft"],
            "--brand-border": colors["primaryBorder"],
            "--brand-cta": gradients["primaryButton"],
            "--brand-accent": colors["accent"],
            "--brand-accent-secondary": colors["accentSecondary"],
            "--brand-deep-blue": colors.get("deepBlue", "#1E2A44"),
            "--brand-preview": gradients["preview"],
            "--brand-header": gradients["header"],
        }
        for key, value in palette_vars.items():
            lines.append(f"  {key}: {value};")
        for alias in ("bdl", "ytd", "dl"):
            lines.append(f"  --{alias}-primary: var(--brand);")
            lines.append(f"  --{alias}-primary-strong: var(--brand-strong);")
            lines.append(f"  --{alias}-primary-hover: var(--brand-hover);")
            lines.append(f"  --{alias}-primary-soft: var(--brand-soft);")
            lines.append(f"  --{alias}-primary-border: var(--brand-border);")
            lines.append(f"  --{alias}-primary-contrast: #ffffff;")
        lines.extend((
            "  --bdl-accent: var(--brand);",
            "  --bdl-accent-strong: var(--brand-strong);",
            "  --bdl-accent-hover: var(--brand-hover);",
            "  --bdl-accent-soft: var(--brand-soft);",
            "  --bdl-accent-border: var(--brand-border);",
            "  --bdl-accent-contrast: #ffffff;",
            "}",
            "",
        ))

    lines.append(END_TOKENS)
    return "\n".join(lines) + "\n"


def inject_tokens(design_css: str, token_block: str) -> str:
    if START_TOKENS not in design_css or END_TOKENS not in design_css:
        raise SystemExit("design-system.css missing THEME TOKENS markers")
    before, rest = design_css.split(START_TOKENS, 1)
    _, after = rest.split(END_TOKENS, 1)
    return before.rstrip() + "\n\n" + token_block.rstrip() + "\n" + after.lstrip("\n")


def write_if_changed(path: Path, data: bytes | str, check: bool, problems: list[str]) -> None:
    if isinstance(data, str):
        raw = data.encode("utf-8")
        text_mode = True
    else:
        raw = data
        text_mode = False
    if check:
        if not path.exists():
            problems.append(f"missing: {path}")
            return
        existing = path.read_bytes()
        if text_mode:
            # Normalize newlines for CSS/text compare
            if existing.replace(b"\r\n", b"\n") != raw.replace(b"\r\n", b"\n"):
                problems.append(f"drift: {path}")
        else:
            if existing != raw:
                problems.append(f"drift: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == raw:
        return
    path.write_bytes(raw)


def png_bytes(img: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def sync_platform(name: str, themes: dict, design_body: str, check: bool, problems: list[str]) -> None:
    meta = PLATFORM_META[name]
    root = WORKSPACE / meta["dir"]
    source = KIT / "brand-assets" / f"{name}.png"
    if not source.is_file():
        raise SystemExit(f"missing brand asset: {source}")

    master = process_master(source)
    processed_path = KIT / "brand-assets" / "processed" / f"{name}.png"
    write_if_changed(processed_path, png_bytes(master), check, problems)

    outputs: dict[Path, Image.Image] = {
        root / "assets" / "icon-source.png": master,
        root / "icons" / "icon-source.png": master,
        root / "store" / "logo-300.png": resize_icon(master, 300),
        root / "store" / "store-icon-128.png": resize_icon(master, 128),
    }
    for size in SIZES:
        small = resize_icon(master, size)
        outputs[root / "icons" / f"icon{size}.png"] = small
        outputs[root / "assets" / f"icon{size}.png"] = small

    for target, image in outputs.items():
        write_if_changed(target, png_bytes(image), check, problems)

    # Local design-system copy
    ds_dest = root / "shared" / "design-system.css"
    write_if_changed(ds_dest, design_body, check, problems)
    theme_source = KIT / "shared" / "themes.json"
    write_if_changed(root / "shared" / "themes.json", theme_source.read_bytes(), check, problems)

    # Strip obsolete injected brand blocks (replaced by design-system.css)
    for rel in meta["css_strip"]:
        path = root / rel
        if not path.is_file():
            if check:
                problems.append(f"missing css: {path}")
            continue
        original = path.read_text(encoding="utf-8")
        if check:
            if START_BRAND in original:
                problems.append(f"stale brand block: {path}")
        else:
            cleaned = strip_brand_blocks(original)
            if cleaned != original:
                path.write_text(cleaned, encoding="utf-8")

    processed_hash = sha12(processed_path) if processed_path.exists() else ("n/a" if check else sha12(source))
    print(f"{name}: source={sha12(source)} processed={processed_hash}")


def build_design_system(themes: dict) -> str:
    base = (KIT / "shared" / "design-system.css").read_text(encoding="utf-8")
    token_block = build_token_block(themes)
    return inject_tokens(base, token_block)


def panel_css_header() -> str:
    return (
        "/* Generated from shared-download-kit/shared/panel.css — do not edit by hand */\n"
        "/* Sync: python shared-download-kit/scripts/sync_brand.py --platform douyin */\n\n"
    )


def sync_panel_css(name: str, check: bool, problems: list[str]) -> None:
    if name not in PANEL_CSS_TARGETS:
        return
    rel_dir, rel_file = PANEL_CSS_TARGETS[name]
    source = KIT / "shared" / "panel.css"
    dest = WORKSPACE / rel_dir / rel_file
    body = source.read_text(encoding="utf-8")
    payload = panel_css_header() + body.lstrip("\ufeff")
    write_if_changed(dest, payload, check, problems)


def run(
    check: bool = False,
    platforms: list[str] | None = None,
    ui_only: bool = False,
    kit_only: bool = False,
) -> None:
    themes = load_themes()
    unknown = set(themes["platforms"]) - set(PLATFORM_META)
    # allow extra platforms in json for future, but only sync known three here
    design_body = build_design_system(themes)

    # Always refresh kit copy of design-system with tokens
    kit_ds = KIT / "shared" / "design-system.css"
    problems: list[str] = []
    fixed_source = WORKSPACE.parent / "主题" / "主题.json"
    fixed_snapshot: bytes | str
    if fixed_source.is_file():
        fixed_snapshot = fixed_source.read_bytes()
    else:
        fixed_snapshot = json.dumps(
            {"themes": themes.get("fixedThemes", [])}, ensure_ascii=False, indent=2
        ) + "\n"
    write_if_changed(KIT / "shared" / "themes.json", fixed_snapshot, check, problems)
    write_if_changed(kit_ds, design_body, check, problems)

    names = [] if kit_only else (list(platforms) if platforms else list(DEFAULT_PLATFORMS))
    bad = [n for n in names if n not in PLATFORM_META]
    if bad:
        raise SystemExit(f"unknown platform(s): {', '.join(bad)}. choose from {', '.join(PLATFORM_META)}")

    for name in names:
        if ui_only:
            # Theme maintenance must not reprocess already approved icon artwork.
            write_if_changed(WORKSPACE / PLATFORM_META[name]["dir"] / "shared" / "design-system.css",
                             design_body, check, problems)
        else:
            sync_platform(name, themes, design_body, check, problems)
        sync_panel_css(name, check, problems)

    if problems:
        raise SystemExit("Out of sync:\n" + "\n".join(problems))
    print("Brand verification passed." if check else "Brands synchronized.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync shared download brand assets and themes")
    parser.add_argument("--check", action="store_true", help="verify without writing")
    parser.add_argument("--ui-only", action="store_true", help="sync CSS only; never read or rewrite icons")
    parser.add_argument("--kit-only", action="store_true", help="refresh only the shared kit; do not touch extension directories")
    parser.add_argument(
        "--platform",
        action="append",
        choices=sorted(PLATFORM_META),
        dest="platforms",
        metavar="PLATFORM",
        help="sync one or more platforms (default: bilibili, douyin)",
    )
    args = parser.parse_args()
    run(check=args.check, platforms=args.platforms, ui_only=args.ui_only, kit_only=args.kit_only)


if __name__ == "__main__":
    main()
