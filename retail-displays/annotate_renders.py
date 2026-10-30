"""Draws dimension callouts on the studio renders (like the reference stand image) and writes the web copies the page
and the build spec use: renders/<name>.png -> ../shopify-theme/assets/tc-display-<name>.jpg (800 × 1200), uploaded as theme assets.
Points are pixel positions on the 1024 × 1536 renders, read off a grid; re-check them if a render is remade.
Each render first gets extra studio background all round (PAD), so callouts never run off the edge."""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
FONTS = HERE / "fonts"
OUT = HERE.parent / "shopify-theme" / "assets"

# Extra background around each render, keeping 2:3: the callouts below are on the original render and get shifted.
PAD_X, PAD_Y = 112, 168

# Each callout: line start, line end, label, value (cm), value (in).
CALLOUTS = {
    "tower": [
        ((343, 1560), (952, 1477), "WIDTH", "101.6 cm", "40 in"),
        ((70, 1460), (318, 1560), "DEPTH", "55.9 cm", "22 in"),
        ((1010, 173), (1010, 1413), "HEIGHT", "182.9 cm", "72 in"),
    ],
    "prism": [
        ((190, 140), (190, 1240), "HEIGHT", "185 cm", "73 in"),
        ((520, 1508), (780, 1440), "EACH SIDE", "60 cm", "23.6 in"),
    ],
    "sunbox": [
        # The side is too foreshortened for its own line, so depth shares the width label.
        ((196, 160), (891, 197), "W × D", "42 × 30 cm", "16.5 × 11.8 in"),
        ((950, 244), (950, 1260), "HEIGHT", "60 cm", "23.6 in"),
    ],
}


def font(name, size):
    return ImageFont.truetype(str(FONTS / f"{name}.ttf"), size)


def callout(im, a, b, word, cm, inch):
    over = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    nx, ny = -math.sin(ang), math.cos(ang)
    # Soft shadow, then the white line with end ticks.
    for colour, w, off in (((0, 0, 0, 70), 7, 2), ((255, 255, 255, 235), 3, 0)):
        d.line([(a[0] + off, a[1] + off), (b[0] + off, b[1] + off)], fill=colour, width=w)
        for p in (a, b):
            d.line([(p[0] - nx * 16 + off, p[1] - ny * 16 + off), (p[0] + nx * 16 + off, p[1] + ny * 16 + off)], fill=colour, width=w)
    # Label: dark pill centred on the line.
    f_word, f_cm, f_in = font("JetBrainsMono-Bold", 17), font("SpaceGrotesk-Medium", 34), font("JetBrainsMono-Regular", 17)
    tw = max(d.textlength(word, font=f_word) + d.textlength("  " + inch, font=f_in), d.textlength(cm, font=f_cm))
    w, h = tw + 36, 82
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    x0 = min(max(cx - w / 2, 8), im.width - w - 8)
    y0 = min(max(cy - h / 2, 8), im.height - h - 8)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=10, fill=(35, 34, 32, 225))
    d.text((x0 + 18, y0 + 12), word, font=f_word, fill=(205, 170, 61, 255))
    d.text((x0 + 18 + d.textlength(word + "  ", font=f_word), y0 + 12), inch, font=f_in, fill=(185, 182, 174, 255))
    d.text((x0 + 18, y0 + 34), cm, font=f_cm, fill=(250, 249, 248, 255))
    im.alpha_composite(over)


def pad(im):
    """Extends the studio sweep outward: a heavily blurred edge-stretch of the render, with fine grain, and the
    original laid back on top with a soft seam."""
    w, h = im.size
    a = np.asarray(im.convert("RGB"))
    big = np.pad(a, ((PAD_Y, PAD_Y), (PAD_X, PAD_X), (0, 0)), mode="edge")
    bg = Image.fromarray(big).filter(ImageFilter.GaussianBlur(70))
    grain = np.random.default_rng(7).normal(0, 1.6, (bg.height, bg.width, 1))
    bg = Image.fromarray(np.clip(np.asarray(bg, dtype=np.float32) + grain, 0, 255).astype(np.uint8))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle([24, 24, w - 24, h - 24], fill=255)
    bg.paste(im.convert("RGB"), (PAD_X, PAD_Y), mask.filter(ImageFilter.GaussianBlur(12)))
    return bg.convert("RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, items in CALLOUTS.items():
        im = pad(Image.open(HERE / "renders" / f"{name}.png"))
        for a, b, *label in items:
            callout(im, (a[0] + PAD_X, a[1] + PAD_Y), (b[0] + PAD_X, b[1] + PAD_Y), *label)
        im.convert("RGB").resize((800, 1200), Image.LANCZOS).save(OUT / f"tc-display-{name}.jpg", quality=84, optimize=True, progressive=True)
        print("wrote", name)


if __name__ == "__main__":
    main()
