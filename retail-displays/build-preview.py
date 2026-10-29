"""Turns shopify-theme/sections/tc-retail-partners.liquid into a standalone preview.html (no Shopify needed): strips comments and the
schema, swaps the contact form tags for a plain form, and wraps it with the store's fonts and a dark header."""
import re
import sys
from pathlib import Path

here = Path(__file__).parent
theme = here.parent / "shopify-theme"
src = (theme / "sections" / "tc-retail-partners.liquid").read_text()
src = re.sub(r"\{%-? comment -?%\}.*?\{%-? endcomment -?%\}", "", src, flags=re.S)
src = re.sub(r"\{% schema %\}.*?\{% endschema %\}", "", src, flags=re.S)
src = re.sub(r"\{%-? form 'contact'.*?-?%\}", '<form class="tcp-form" id="tcp-form" onsubmit="event.preventDefault();alert(\'Preview only: on Shopify this posts to the store contact form.\')">', src)
src = re.sub(r"\{%-? if form\.posted_successfully\? -?%\}.*?\{%-? endif -?%\}", "", src, flags=re.S)
src = re.sub(r"\{%-? endform -?%\}", "</form>", src)
# Theme assets resolve to ../shopify-theme/assets with the file's mtime, so the browser never serves a stale copy.
# Assets the store theme already has (the wholesale dot texture) come from the live store instead.
STORE_ASSETS = "https://www.truecolors.global/cdn/shop/t/14/assets/"
def asset(m):
    f = theme / "assets" / m.group(1)
    return f"../shopify-theme/assets/{m.group(1)}?v={int(f.stat().st_mtime)}" if f.exists() else STORE_ASSETS + m.group(1)
src = re.sub(r"\{\{ '([^']+)' \| asset_url \}\}", asset, src)
# Nothing is uploaded in the preview: keep each setting's theme-asset fallback.
src = re.sub(r"\{%- if section\.settings\.\w+ != blank -%\}.*?\{%- else -%\}(.*?)\{%- endif -%\}", r"\1", src, flags=re.S)
if "{%" in src or "{{" in src:
    sys.exit("Unhandled Liquid left in the preview")

page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Truecolors Retail Partners</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
<style>body{{margin:0;background:#faf9f8}}.pv-top{{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:#232220;color:#faf9f8;font:500 13px/1 'Space Grotesk',sans-serif;letter-spacing:.04em;text-transform:uppercase}}.pv-top img{{height:22px;display:block}}.pv-top nav{{display:flex;gap:22px}}@media(max-width:700px){{.pv-top nav{{display:none}}}}</style>
</head><body>
<header class="pv-top"><img src="https://www.truecolors.global/cdn/shop/files/TRUECOLORSNEW.png?width=300" alt="Truecolors"><nav><span>Shop</span><span>How it works</span><span>Wholesale</span><span>Retail partners</span><span>Our story</span></nav></header>
{src}
</body></html>"""
(here / "preview.html").write_text(page)
print("wrote", here / "preview.html")
