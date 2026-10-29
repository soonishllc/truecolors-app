"""Matched sun/shade tee photos with the OpenAI image model: the sun photo is made from the design reference, then
the shade photo is an edit of it, so the two line up exactly for the sun sweep. Same key as make_renders.py.
Usage: python make_photos.py hero|flat"""
import base64
import io
import sys

from openai import OpenAI
from PIL import Image

from make_renders import DESIGN, OUT, key, ref

INK = ("Truecolors prints use UV-reactive ink: in direct sunlight a print is fully, vividly coloured; out of direct "
       "sunlight it shows only grey and black line art with no colour at all.")
PRINT = ("The print is screen-printed into the fabric: it follows the folds and drape of the cotton, takes the same light "
         "and shadow as the shirt and has a slight ink texture; it must not look pasted on. No other words, logos or "
         "watermarks anywhere.")

PAIRS = {
    "hero": (
        "Photorealistic product photograph. A soft, lightweight white cotton crew-neck tee hangs on a pale natural-wood "
        "hanger against a plain warm off-white plaster wall, shot straight on, centred, the shirt filling about 70% of "
        "the frame height, with natural drape, soft folds and gentle wrinkles. A wide, warm beam of direct sunlight from "
        "a window at the upper right falls across the whole shirt, casting a soft hanger shadow on the wall. The tee "
        "carries the HABIBI design from the reference image, reproduced faithfully in its full-colour sunlit version. "
        f"{INK} {PRINT}",
        "The same photograph: keep the shirt, hanger, wall, framing, folds and camera exactly the same. Only change "
        "this: there is no direct sunlight at all, just soft, even, slightly cool indoor shade light, so the wall has no "
        "sunbeam, and the print shows only its grey and black line art with no colour at all. Photorealistic, no text."),
    "flat": (
        "Photorealistic product photograph, shot from directly above: a soft white cotton crew-neck tee laid flat and "
        "straight, front side up, sleeves out, centred and filling about 85% of the frame, on a plain seamless "
        "off-white (#faf9f8) background, with soft even studio light, a faint contact shadow and gentle natural "
        "wrinkles. The tee carries the HABIBI design from the reference image, reproduced faithfully in its full-colour "
        f"version, as if lit by sunlight. {INK} {PRINT}",
        "The same photograph: keep the shirt, its exact position, wrinkles, background, framing and lighting exactly "
        "the same. Only change this: the print shows only its grey and black line art with no colour at all, as it "
        "looks indoors in the shade. Photorealistic, no text."),
}


def png(b64):
    return base64.b64decode(b64)


def main():
    name = sys.argv[1]
    sun_prompt, shade_prompt = PAIRS[name]
    api_key, model = key()
    client = OpenAI(api_key=api_key, timeout=900, max_retries=2)
    OUT.mkdir(exist_ok=True)
    sun = png(client.images.edit(model=model, image=[ref(DESIGN, "design.png")], prompt=sun_prompt,
                                 size="1024x1024", quality="high").data[0].b64_json)
    (OUT / f"tee-{name}-sun.png").write_bytes(sun)
    print("wrote sun", name, flush=True)
    shade = png(client.images.edit(model=model, image=[("sun.png", sun, "image/png")], prompt=shade_prompt,
                                   size="1024x1024", quality="high").data[0].b64_json)
    (OUT / f"tee-{name}-shade.png").write_bytes(shade)
    print("wrote shade", name, flush=True)


if __name__ == "__main__":
    main()
