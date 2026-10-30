"""Draws a clear "pressed" cue onto the press-for-sun clips: a flash on the button, two expanding rings and short
burst lines, half a second before the UV glow starts. The video model can't be relied on to show a click, so the
cue is drawn here, on the button wherever it sits in each clip, and timed from the glow itself.
Usage: python press_fx.py [sunbox prism tower]  (reads renders/hf-videos/<name>-v2.mp4, writes the web clip)"""
import math
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
SRC = HERE / "renders" / "hf-videos"
OUT = HERE.parent / "shopify-theme" / "files"
WIDTH = 640  # web clip width
# Roughly where each button sits (fraction of the frame); the exact spot is found by colour around here.
HINTS = {"sunbox": (0.26, 0.78), "prism": (0.75, 0.41), "tower": (0.10, 0.43)}
ORANGE, WHITE = (242, 154, 12), (255, 240, 210)


def read(path):
    gen = imageio_ffmpeg.read_frames(str(path))
    meta = next(gen)
    w, h = meta["size"]
    frames = [np.frombuffer(f, np.uint8).reshape(h, w, 3) for f in gen]
    return frames, meta["fps"]


def find_button(frame, hint):
    """Centre and radius of the orange button nearest the hint, from the lit last frame."""
    h, w, _ = frame.shape
    cx, cy, box = int(hint[0] * w), int(hint[1] * h), int(0.05 * w)  # tight, so orange prints nearby don't count
    x0, y0 = max(cx - box, 0), max(cy - box, 0)
    crop = frame[y0:cy + box, x0:cx + box].astype(int)
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    ys, xs = np.nonzero((r > 190) & (g > 70) & (g < 200) & (b < 90) & (r - b > 130))
    if not len(xs):
        return cx, cy, w * 0.012
    px, py = np.median(xs) + x0, np.median(ys) + y0
    radius = max(math.sqrt(len(xs) / math.pi), w * 0.008)
    return px, py, radius


def glow_onset(frames, fps):
    """Seconds into the clip when the violet UV glow starts rising."""
    score = []
    for f in frames:
        s = f[::4, ::4].astype(int)
        score.append(np.mean((s[..., 2] - s[..., 1] > 35) & (s[..., 2] > 120)))
    score = np.convolve(score, np.ones(5) / 5, mode="same")
    base, top = np.median(score[:6]), score.max()
    rising = np.nonzero(score > base + 0.15 * (top - base))[0]
    return (rising[0] if len(rising) else len(frames) // 3) / fps


def cue(img, t, press, bx, by, br):
    """Overlay for time t: flash, rings and burst lines around the button."""
    d = t - press
    if d < -0.18 or d > 0.9:
        return img
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if -0.18 <= d <= 0.35:  # flash: peaks at the press, then fades
        k = 1 - abs(d) / (0.18 if d < 0 else 0.35)
        for i in range(6, 0, -1):
            rr = br * (1 + i * 0.55)
            draw.ellipse([bx - rr, by - rr, bx + rr, by + rr], fill=WHITE[:3] + (int(42 * k * (7 - i) / 6),))
        draw.ellipse([bx - br, by - br, bx + br, by + br], fill=WHITE[:3] + (int(230 * k),))
    for start in (0.0, 0.2):  # two expanding rings
        e = d - start
        if 0 <= e <= 0.7:
            k = e / 0.7
            rr = br * (1.3 + 4.2 * k)
            draw.ellipse([bx - rr, by - rr, bx + rr, by + rr], outline=ORANGE + (int(235 * (1 - k)),), width=max(2, int(br * 0.32 * (1 - 0.5 * k))))
    if 0 <= d <= 0.4:  # burst lines
        k = d / 0.4
        for a in range(8):
            ang = a * math.pi / 4 + math.pi / 8
            r0, r1 = br * (1.8 + 1.6 * k), br * (2.6 + 2.2 * k)
            draw.line([bx + r0 * math.cos(ang), by + r0 * math.sin(ang), bx + r1 * math.cos(ang), by + r1 * math.sin(ang)],
                      fill=WHITE[:3] + (int(240 * (1 - k)),), width=max(2, int(br * 0.22)))
    layer = layer.filter(ImageFilter.GaussianBlur(br * 0.06))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def main():
    for name in sys.argv[1:] or HINTS:
        frames, fps = read(SRC / f"{name}-v2.mp4")
        bx, by, br = find_button(frames[-1], HINTS[name])
        press = max(glow_onset(frames, fps) - 0.5, 0.45)
        h, w, _ = frames[0].shape
        scale = WIDTH / w
        size = (WIDTH, int(round(h * scale / 16)) * 16)  # codec-friendly height
        out = imageio_ffmpeg.write_frames(str(OUT / f"{name}-clip.mp4"), size, fps=fps, codec="libx264",
                                          output_params=["-crf", "26", "-preset", "slow", "-movflags", "+faststart", "-an"])
        out.send(None)
        for i, f in enumerate(frames):
            img = Image.fromarray(f).resize(size, Image.LANCZOS)
            img = cue(img, i / fps, press, bx * scale, by * scale, br * scale)
            out.send(np.asarray(img).tobytes())
        out.close()
        print(f"{name}: button at ({bx:.0f}, {by:.0f}) r {br:.0f}px, press at {press:.2f}s")


if __name__ == "__main__":
    main()
