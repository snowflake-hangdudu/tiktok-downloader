"""生成公共 kit 的黑白下载图标。"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"


def draw_source(size: int = 512) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    pad = int(size * 0.06)
    radius = int(size * 0.22)
    draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=radius, fill=(17, 17, 17, 255))

    cx = size / 2
    shaft_w = size * 0.11
    shaft_top = size * 0.26
    shaft_bottom = size * 0.55
    draw.rectangle((cx - shaft_w / 2, shaft_top, cx + shaft_w / 2, shaft_bottom), fill=(255, 255, 255, 255))

    head = [
        (cx, size * 0.74),
        (size * 0.30, size * 0.52),
        (size * 0.70, size * 0.52),
    ]
    draw.polygon(head, fill=(255, 255, 255, 255))

    tray_y = size * 0.78
    draw.rounded_rectangle((size * 0.28, tray_y, size * 0.72, tray_y + size * 0.06), radius=size * 0.02, fill=(255, 255, 255, 255))
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = draw_source()
    source_path = OUT / "icon-source.png"
    source.save(source_path, "PNG", optimize=True)
    for size in (16, 32, 48, 128):
        img = source.resize((size * 4, size * 4), Image.Resampling.LANCZOS) if size <= 32 else source.resize((size, size), Image.Resampling.LANCZOS)
        if size <= 32:
            img = img.filter(ImageFilter.UnsharpMask(radius=1, percent=120, threshold=2)).resize((size, size), Image.Resampling.LANCZOS)
        img.save(OUT / f"icon{size}.png", "PNG", optimize=True)
        print("OK", f"icon{size}.png")
    print("OK", source_path.name)


if __name__ == "__main__":
    main()
