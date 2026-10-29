"""Photos for the Retail partners page with the OpenAI image model (OpenAI's Sora video API shut down on
24 September 2026, so the hero is a shade/sun photo pair). Same key as make_renders.py; each image is one paid call.
Usage: python make_media.py person | flat-<design> | frame | frame-sun | reshade-person"""
import base64
import sys

from openai import OpenAI

from make_renders import OUT, key, ref

CDN = "https://cdn.shopify.com/s/files/1/0819/7518/1554/files/"
DESIGNS = {  # sunlit product photos from the store, used as print references
    "target": CDN + "target_2.png?width=1024",
    "newyork": CDN + "newyork_3.png?width=1024",
    "newyork-shade": CDN + "newyork_2.png?width=1024",
    "target-shade": CDN + "target_3.png?width=1024",
    "beach": CDN + "beach_color.jpg?width=1024",
    "dune": CDN + "dunebashing_3_48b610ef-5c86-4f82-a4c4-9f81b799a2ab.png?width=1024",
    "emirati": CDN + "emirati_2.png?width=1024",
}
INK = ("Truecolors prints use UV-reactive ink: wherever direct sunlight falls on a print it is fully coloured; wherever "
       "it is out of direct sunlight (indoors or in shade) it shows only grey and white line art with no colour at all.")
FABRIC = ("The tee is soft, lightweight cotton jersey that drapes and wrinkles naturally; the print is screen-printed into "
          "it, follows the folds and takes the same light. No other words, logos or watermarks.")

SHADE_EDIT = ("The same photograph: keep the person, pose, clothes, framing, camera angle and background exactly the same, "
              "pixel-aligned. Only change this: the person is now fully in cool open shade (the awning's shadow covers "
              "them), no direct sunlight touches them, and the print on the tee shows only its grey line art with no "
              "colour at all. The background beyond the shade stays sunny. Photorealistic, no text.")
FLAT_SHADE = ("The same photograph: keep the shirt, its exact position, wrinkles, background, framing and lighting exactly "
              "the same. Only change this: the print shows only its grey line art with no colour at all, as it looks "
              "indoors. Photorealistic, no text.")


def flat(colour, name):
    return (f"Photorealistic product photograph from directly above: a soft {colour} cotton crew-neck tee laid flat and "
            "straight, front up, sleeves out, centred, filling about 85% of the frame, on a plain seamless off-white "
            "(#faf9f8) background, soft even studio light, faint contact shadow, gentle natural wrinkles. The tee carries "
            f"the {name} design from the reference image, reproduced faithfully in its full-colour sunlit version. "
            f"{INK} {FABRIC}")


JOBS = {
    # §02: a person wearing Target Destroyed, sun first, then the shade edit.
    "person": ("1024x1536", [DESIGNS["target"]],
        "Photorealistic lifestyle photo, vertical. One person only, a relaxed adult guest at a resort, framed from mid "
        "thigh up, centred, facing the camera with a slight smile, wearing sunglasses pushed up on their head, standing "
        "on a pale stone terrace just outside a hotel boutique. Bright midday sun with hard shadows; they have just "
        "stepped out of the shade into full direct sunlight. They wear a white tee with the TARGET DESTROYED design from "
        "the reference image across the chest, reproduced faithfully and fully, vividly coloured in the sun. Softly "
        "blurred background: whitewashed walls, palms, a strip of sea. Warm, natural colour grading like a premium "
        f"apparel brand. {INK} {FABRIC}", SHADE_EDIT),
    "flat-target": ("1024x1024", [DESIGNS["target"]], flat("white", "TARGET DESTROYED"), FLAT_SHADE),
    "flat-newyork": ("1024x1024", [DESIGNS["newyork"]], flat("black", "FUHGEDD ABOUD'IT"), FLAT_SHADE),
    "flat-beach": ("1024x1024", [DESIGNS["beach"]], flat("white", "surfboard beach-sunset"), FLAT_SHADE),
    "flat-dune": ("1024x1024", [DESIGNS["dune"]], flat("white", "I'D RATHER BE Dune Bashing"), FLAT_SHADE),
    "flat-emirati": ("1024x1024", [DESIGNS["emirati"]], flat("white", "WE'RE ALL EMIRATI"), FLAT_SHADE),
    # §05 frame: the guest in the shaded doorway, head to toe, Tower in the shop behind (the sun version is an edit of it).
    "frame": ("1024x1536", [DESIGNS["newyork-shade"], str(OUT / "tower.png")],
        "Photorealistic vertical video still, shot from a sunny street looking straight into the open doorway of a "
        "bright, modern hotel boutique. A man is walking out towards the camera and is still fully inside the doorway, "
        "under the shop's roof in cool shade: no sunlight touches him at all. He is shown in full, head to toe, centred, "
        "with clear space above his head and below his shoes: a relaxed, smiling adult guest with sunglasses pushed up on "
        "his head, mid-stride. He wears a black tee with the FUHGEDD ABOUD'IT design from the first reference image; "
        "because he is in the shade, the print shows only its grey line art with no colour. Behind him inside the shop, "
        "slightly soft but clearly recognisable and seen at an angle, stands the Truecolors Tower display from the second "
        "reference image, exactly as designed: charcoal cabinet, backlit truecolors logo header, front cubbies of folded "
        "tees under an S M L XL rail, and on its side a violet-lit gallery of ten face-out tees in full colour. "
        "In the foreground, outside the doorway, the pavement is in bright, hard midday sunlight; the sharp edge between "
        f"the shade and the sunlight runs across the threshold just in front of his feet. {FABRIC}", None),
}


def frame_sun(client, model):
    frame = (OUT / "frame.png").read_bytes()
    prompt = ("The same photograph: keep the man, his pose, clothes, the doorway, the shop interior, the Tower display, "
              "framing and camera exactly the same, pixel-aligned. Only change this: the low afternoon sun now shines "
              "straight in through the open doorway, so a bright beam of direct sunlight falls across the man's whole "
              "torso, and the FUHGEDD ABOUD'IT print on his black tee is fully, vividly coloured, exactly like the second "
              "reference image. Everything deeper inside the shop stays in shade. Photorealistic, no text.")
    r = client.images.edit(model=model, image=[("frame.png", frame, "image/png"), ref(DESIGNS["newyork"], "sunref.png")],
                           prompt=prompt, size="1024x1536", quality="high")
    (OUT / "frame-sun.png").write_bytes(base64.b64decode(r.data[0].b64_json))
    print("wrote frame sun", flush=True)


def reshade(client, model, job, size):
    """Redo a shade edit with the store's own shade photo as the reference for how dark the line art is."""
    sun = (OUT / f"{job}-sun.png").read_bytes()
    prompt = ((SHADE_EDIT if job == "person" else FLAT_SHADE) + " The grey line art must be as bold and dark as in the "
              "second reference image (crisp dark-grey and black linework, clearly readable), not faint or washed out.")
    r = client.images.edit(model=model, image=[("sun.png", sun, "image/png"), ref(DESIGNS["target-shade"], "shade-ref.png")],
                           prompt=prompt, size=size, quality="high")
    (OUT / f"{job}-shade.png").write_bytes(base64.b64decode(r.data[0].b64_json))
    print("wrote", job, "shade", flush=True)


def main():
    job = sys.argv[1]
    api_key, model = key()
    client = OpenAI(api_key=api_key, timeout=1200, max_retries=1)
    if job == "frame-sun":
        return frame_sun(client, model)
    if job.startswith("reshade-"):
        name = job.removeprefix("reshade-")
        return reshade(client, model, name, JOBS[name][0])
    size, refs, prompt, shade_prompt = JOBS[job]
    images = [ref(r, f"ref{i}.png") if r.startswith("http") else (f"ref{i}.png", open(r, "rb").read(), "image/png")
              for i, r in enumerate(refs)]
    out = base64.b64decode(client.images.edit(model=model, image=images, prompt=prompt, size=size, quality="high").data[0].b64_json)
    (OUT / f"{job}{'-sun' if shade_prompt else ''}.png").write_bytes(out)
    print("wrote", job, flush=True)
    if shade_prompt:
        shade = client.images.edit(model=model, image=[("sun.png", out, "image/png")], prompt=shade_prompt, size=size, quality="high")
        (OUT / f"{job}-shade.png").write_bytes(base64.b64decode(shade.data[0].b64_json))
        print("wrote", job, "shade", flush=True)


if __name__ == "__main__":
    main()
