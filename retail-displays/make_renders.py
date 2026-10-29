"""Photoreal product renders of the three displays with the OpenAI image model, on a plain studio background.
Uses OPENAI_API_KEY / OPENAI_IMAGE_MODEL from truecolors-app/.env.local. Each render is one paid call.
Usage: python make_renders.py [id ...]   (no ids = any render not made yet)"""
import base64
import io
import sys
import urllib.request
from pathlib import Path

from openai import OpenAI
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "renders"
ENV = Path("/Users/kevinmurcko/Projects/truecolors-app/.env.local")

LOGO = "https://www.truecolors.global/cdn/shop/files/TRUECOLORSNEW.png?width=1024"
DESIGN = "https://www.truecolors.global/cdn/shop/files/habibi_4.png?width=1024"
CDN = "https://cdn.shopify.com/s/files/1/0819/7518/1554/files/"
# The Tower's gallery shows many designs, so it gets the catalogue's sunlit photos as references.
CATALOGUE = [CDN + n + "?width=768" for n in ("beach_color.jpg", "newyork_3.png", "target_2.png", "habibi_4.png",
             "dunebashing_3_48b610ef-5c86-4f82-a4c4-9f81b799a2ab.png", "emirati_2.png")]

STUDIO = (
    "Photorealistic commercial product render of a retail display unit, as a furniture maker or 3D visualiser would "
    "present it to a client: the unit alone on a seamless neutral light-grey studio sweep, soft even softbox lighting, "
    "a soft contact shadow on the floor, no room, no shop, no people, no props. Shot on a 70 mm lens at about chest "
    "height, true-to-life materials: matt charcoal (#232220) lacquered MDF with crisp edges, black anodised aluminium "
    "trim, clear acrylic with faint reflections. The Truecolors wordmark from the logo reference is reproduced exactly "
    "on a backlit header strip: white lowercase \"true\" and the diagonal-striped gradient \"COLORS\" (magenta to orange "
    "to yellow), on charcoal. Directly beneath every header runs a thin 4 mm gradient stripe from magenta through "
    "orange to yellow. Every demo shirt is a soft white cotton tee carrying the print from the design reference. "
    "The prints use UV-reactive ink: under the violet UV light inside a lit window the print is fully, vividly "
    "coloured; anywhere without that light it is only grey and black line art. No other words or logos, no "
    "watermarks."
)

RENDERS = {
    "sunbox": ("1024x1536",
        "A countertop display box, 42 cm wide, 30 cm deep, 60 cm tall (clearly taller than it is wide), standing on a low plinth so it sits in the middle of the frame with generous grey space above and below, seen at a three-quarter angle from the front left. "
        "Top 8 cm: the backlit logo header and gradient stripe. Middle: a square window (36 × 36 cm) of clear acrylic in a "
        "charcoal frame, with a matt off-white interior, holding one neatly retail-folded white tee showing the print on "
        "its chest. The window is lit from inside by a soft violet UV glow from hidden LED strips along its top and "
        "bottom edges, and the print is in full colour. Bottom 12 cm: a round orange illuminated push button on the left "
        "with small white text PRESS FOR SUN beside it, and a small white square QR code plate on the right."),
    "prism": ("1024x1536",
        "A tall slim three-sided display column, a triangular prism like a Toblerone bar stood on end: its footprint and "
        "its flat top are equilateral triangles, 60 cm per side, and it is 185 cm high. It is NOT a square or rectangular "
        "box. The camera is slightly above the top, looking down a little, so the triangular top surface is clearly "
        "visible, and it faces one vertical corner head-on: that front corner is a sharp 60-degree knife edge and the two "
        "visible faces recede steeply away from it on either side, each seen strongly foreshortened; the third face is "
        "hidden at the back. Each face has the backlit logo "
        "header in its top 20 cm with the gradient stripe beneath, and a recessed dark plinth at the bottom. The left "
        "face carries a slim black 32-inch portrait digital screen at eye level, showing a white tee on a dark background "
        "with the print half grey on the left and full colour on the right; below the screen a charcoal graphic panel "
        "with a small white QR plate. The right face carries a tall clear acrylic window (42 × 56 cm) with an off-white "
        "interior and one white tee laid flat with sleeves tucked behind; the window glows soft violet from hidden UV "
        "strips and the print is fully coloured; below the window, a round orange illuminated push button with small "
        "white text PRESS FOR SUN. Black anodised aluminium angle trims the vertical corner."),
    "tower": ("1024x1536",
        "A freestanding shop-in-shop display cabinet 102 cm wide, 56 cm deep, 183 cm tall, seen at a three-quarter "
        "angle from the front left so the front and the full left side are both clearly visible. Top: the backlit logo "
        "header with the gradient stripe beneath, wrapping around the front. FRONT: a slim label rail reading S, M, L, XL "
        "over four columns, then seven rows of open charcoal cubbies, each holding a soft stack of folded white or black "
        "tees whose prints show only grey line art (no UV light reaches them). LEFT SIDE: a design gallery behind clear "
        "acrylic: two columns by five rows of face-out folded tees on slim ledges, ten different designs, one per tee, "
        "each a different design from the design references (repeat a design only if you run out). The gallery glows soft "
        "violet from hidden UV strips, so every gallery print is fully, vividly coloured. Below the gallery on the same "
        "side: one round orange illuminated push button with small white text PRESS FOR SUN. Recessed dark plinth."),
}


def key():
    vals = dict(l.split("=", 1) for l in ENV.read_text().splitlines() if "=" in l and not l.lstrip().startswith("#"))
    return vals["OPENAI_API_KEY"].strip().strip('"'), vals.get("OPENAI_IMAGE_MODEL", "gpt-image-2").strip().strip('"')


def ref(url, name):
    raw = urllib.request.urlopen(url, timeout=60).read()
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    flat = Image.new("RGB", im.size, (0, 0, 0))
    flat.paste(im, mask=im.split()[3])
    buf = io.BytesIO()
    flat.save(buf, "PNG")
    return (name, buf.getvalue(), "image/png")


def main():
    api_key, model = key()
    client = OpenAI(api_key=api_key, timeout=900, max_retries=2)
    OUT.mkdir(exist_ok=True)
    wanted = sys.argv[1:] or [k for k in RENDERS if not (OUT / f"{k}.png").exists()]
    refs = [ref(LOGO, "logo.png"), ref(DESIGN, "design.png")]
    tower_refs = [ref(LOGO, "logo.png")] + [ref(u, f"design{i}.png") for i, u in enumerate(CATALOGUE)]
    for rid in wanted:
        size, prompt = RENDERS[rid]
        print("rendering", rid, flush=True)
        res = client.images.edit(model=model, image=tower_refs if rid == "tower" else refs, prompt=f"{prompt}\n\n{STUDIO}", size=size, quality="high")
        (OUT / f"{rid}.png").write_bytes(base64.b64decode(res.data[0].b64_json))
        print("wrote", OUT / f"{rid}.png", flush=True)


if __name__ == "__main__":
    main()
