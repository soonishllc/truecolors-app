"""Moves the press-for-sun button to natural reach height on the Prism and Tower renders (image edit, so the rest of
the render stays the same). Writes renders/<name>.png and keeps the previous render as renders/<name>-low-button.png.
Same OpenAI key as make_renders.py; one paid call per render."""
import base64
import sys
from pathlib import Path

from openai import OpenAI

from make_renders import OUT, key

EDITS = {
    "prism": (
        "Edit this exact product render. Keep the column, camera, framing, lighting, background, logos, screen, window, "
        "tee and everything else exactly the same, pixel-aligned. Only move the round orange illuminated push button: "
        "remove it (and its small PRESS FOR SUN text) from below the right-hand window, filling that spot with the same "
        "plain matt charcoal panel, and place the identical button, the same small size (3 cm across), in the narrow "
        "charcoal margin immediately to the right of the right-hand window, vertically centred on the window, with tiny "
        "white text PRESS FOR SUN set vertically beside it. Photorealistic."),
    "tower": (
        "Edit this exact product render. Keep the cabinet, camera, framing, lighting, background, logo header, rail, "
        "cubbies, folded stock, the side gallery and everything else exactly the same, pixel-aligned. Only move the round "
        "orange illuminated push button: remove it from the vertical strip at the front-left corner (fill that spot with "
        "the same plain matt charcoal), and place the identical button, the same small size (3 cm across), on the left "
        "side panel in the narrow charcoal margin right beside the gallery glass, on the front edge of the gallery, at "
        "about 105 cm above the floor (a little above the cabinet's mid-height), with tiny white text PRESS FOR SUN set "
        "vertically beside it. Photorealistic."),
}


def main():
    api_key, model = key()
    client = OpenAI(api_key=api_key, timeout=900, max_retries=1)
    for name in sys.argv[1:] or EDITS:
        src = OUT / f"{name}.png"
        backup = OUT / f"{name}-low-button.png"
        if not backup.exists():
            backup.write_bytes(src.read_bytes())
        # Edit the current render, so moves build on each other; the very first version stays in the backup.
        r = client.images.edit(model=model, image=[("render.png", src.read_bytes(), "image/png")],
                               prompt=EDITS[name], size="1024x1536", quality="high")
        src.write_bytes(base64.b64decode(r.data[0].b64_json))
        print("wrote", name, flush=True)


if __name__ == "__main__":
    main()
