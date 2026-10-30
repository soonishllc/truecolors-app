# Retail displays

The B2B offer for hotel boutiques, airports and attractions: consignment displays that carry their own UV "sun" so guests can see the shirts change colour indoors. Three stands: **Sunbox** (countertop), **Prism** (three-sided floor stand with a screen) and **Tower** (stock by size plus a 20-design gallery).

| What | Where |
| --- | --- |
| Landing page (Shopify section) | `shopify-theme/sections/tc-retail-partners.liquid` |
| Page images, 3D viewer script | `shopify-theme/assets/` |
| Page videos (walk-out, press-for-sun clips, screen loop) | `shopify-theme/files/` |
| Prism screen loop for the fabricator (1080 × 1920) | `retail-displays/media/screen-loop-1080x1920.mp4` |
| Build spec for fabricators | `retail-displays/Truecolors-Display-Build-Spec.pdf` |
| Scripts that make the images and the PDF | `retail-displays/*.py` |

## Put the page on the store

1. Upload `shopify-theme/sections/tc-retail-partners.liquid` to the theme's `sections/` folder and everything in `shopify-theme/assets/` to its `assets/` folder.
2. Create a page "Retail partners" (handle `retail-partners`) with a template that holds only the Retail partners section.
3. In the theme editor, upload the videos in `shopify-theme/files/` to the section's video settings: `walk-video.mp4` (§05), `screen-video.mp4` (the 3D Prism's screen), and `sunbox-clip.mp4`, `prism-clip.mp4`, `tower-clip.mp4` (press-for-sun clips on the cards). Each is optional: without it §05 shows the photo loop, the 3D screen draws its own sweep and the cards stay still. Card images can be replaced the same way.

Enquiries go through the store's contact form, so they land in the same inbox as Wholesale.

## Preview it locally

```bash
python3 retail-displays/build-preview.py
```

Then start `displays-preview` from `.claude/launch.json` (or `python3 -m http.server 8765` in the repo root) and open http://localhost:8765/retail-displays/preview.html.

## Remake images or the PDF

The scripts need Python packages in their own environment:

```bash
python3 -m venv .venv-displays && .venv-displays/bin/pip install -r retail-displays/requirements.txt
```

| Script | Makes |
| --- | --- |
| `build_specs.py` | The build spec PDF |
| `make_renders.py` | Studio renders of the stands (OpenAI image model, key from `.env.local`; one paid call each) |
| `make_media.py`, `make_photos.py` | Shirt flat-lays, the §02 person pair and the §05 doorway pair |
| `align_pair.py` | Lines a shade photo up with its sun photo so the sweep doesn't jump |
| `annotate_renders.py` | Dimension callouts on the renders → `shopify-theme/assets/tc-display-*.jpg` |
| `gallery_texture.py` | The Tower's gallery, cut from its render, for the 3D viewer |

The videos were made with Higgsfield (FLUX 3 Video) from the renders and photos here, then cropped, looped and compressed with ffmpeg; full-size originals are in `retail-displays/renders/hf-videos/`.

Raw renders and videos live in `retail-displays/renders/`, which is not committed (about 50 MB). Callout and gallery positions are read off those exact renders, so re-check them if a render is remade. OpenAI's Sora video API shut down on 24 September 2026, which is why the videos come from Higgsfield.
