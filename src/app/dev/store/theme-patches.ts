// Local demo only: changes proposed for the store's theme, applied here to the live store's pages so they can be
// seen before anyone edits the theme. Each entry is a page and its edits; once accepted, make the same edits in the
// theme (the Our Story section and the collection template) and remove them here.

type Patch = [from: string | RegExp, to: string];

const IMG = "//www.truecolors.global/cdn/shop/files";
const EMAIL = "hello@truecolors.global";

export const THEME_PATCHES: Record<string, Patch[]> = {
  // Our Story: Truecolors is the consumer brand (not SunDrip), SolarShift licensing is coming soon, and the shop
  // button says Truecolors.
  "pages/our-story": [
    ["Truecolors Trading is the UAE company behind <strong>SunDrip™</strong>, sun-activated color-changing apparel,",
      "Truecolors Trading is the UAE company behind <strong>Truecolors</strong>, sun-activated colour-changing apparel,"],
    ["Shop SunDrip <span class=\"arr\">→</span>", "Shop Truecolors <span class=\"arr\">→</span>"],
    ["<a href=\"#solarshift\" class=\"os-btn ghost\">License SolarShift</a>", "<a href=\"#solarshift\" class=\"os-btn ghost\">SolarShift licensing · soon</a>"],
    // The consumer-brand tile: the Truecolors logo, and the tc logo tee from the home page going from shade to sun.
    [/<img src="[^"]*sundrip-horiz-color-black\.png[^"]*" alt="SunDrip" width="219" height="60" style="width: 219px;/,
      `<img src="${IMG}/TrueColors_1line_color_black_c417b7a7-1c04-4585-9b7d-b8f6764652fd.png?v=1781704361&width=600" alt="Truecolors" width="219" height="60" style="width: 219px;`],
    [/<img src="[^"]*sundrip-shirt-modes\.png[^"]*" alt="[^"]*" width="600" height="600" style="([^"]*)" \/>/,
      `<img src="${IMG}/mono.jpg?v=1780970111&width=900" alt="" width="600" height="600" style="$1" />` +
      `<img class="tc-os-sun" src="${IMG}/colour.jpg?v=1780970115&width=900" alt="The Truecolors logo tee, in the shade and in the sun" width="600" height="600" style="$1" />`],
    ["UAE Truecolors Collection</span>", "The Truecolors logo tee</span>"],
    ["@sundrip.ae · @sundrip_official", "@true.colors.global"],
    // SolarShift: licensing isn't open yet, so the button asks to hear when it is.
    ["The proprietary ink behind SunDrip. A mix of pigments and additives we spent years refining — licensed to select screen printers worldwide.",
      "The proprietary ink behind Truecolors. A mix of pigments and additives we spent years refining. Licensing to select screen printers worldwide is coming soon."],
    [/<a href="mailto:hello@truecolors\.ae\?subject=SolarShift%20license" class="os-btn primary">License the ink <span class="arr">→<\/span><\/a>\s*<span class="os-mono">Premixed · one tub · documented<\/span>/,
      `<span class="os-mono tc-soon">Licensing coming soon</span> <a href="mailto:${EMAIL}?subject=SolarShift%20licensing" class="os-btn primary">Hear first <span class="arr">→</span></a>`],
    ["</head>", `<style>
      .tc-os-sun { animation: tc-os-sun 6s ease-in-out infinite; }
      @keyframes tc-os-sun { 0%, 25% { opacity: 0; } 45%, 85% { opacity: 1; } 100% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .tc-os-sun { animation: none; } }
      .tc-soon { padding: 6px 12px; border: 1px solid #ffffff40; border-radius: 999px; color: #fff; }
    </style></head>`],
  ],
  // Wholesale numbers are bespoke, so no public minimum (the store said 50; the portal's real minimum is 24).
  "": [
    ["Wholesale orders start from just 50 units, so you can", "Start with a small first order, so you can"],
  ],
  "pages/wholesale": [
    ["Wholesale orders start from just 50 units, so you can", "Start with a small first order, so you can"],
    ["Starting from 50 units, sized the way your customers actually buy.", "Sized the way your customers actually buy, in a quantity we agree with you."],
  ],
  // The shop: only the categories there are. Every shirt is a tee for now, so one tab.
  "collections/all": [
    [/<button class="filter-tab" onclick="filterProducts\('tee', this\)">Tees<\/button>\s*/, ""],
    [/<button class="filter-tab" onclick="filterProducts\('heavy', this\)">Heavyweights<\/button>\s*/, ""],
    [/<button class="filter-tab" onclick="filterProducts\('collab', this\)">Collabs<\/button>\s*/, ""],
    ["<button class=\"filter-tab active\" onclick=\"filterProducts('all', this)\">All</button>", "<button class=\"filter-tab active\" onclick=\"filterProducts('all', this)\">Tees</button>"],
  ],
};

// The footer, on every page: three links went nowhere ("#") and Custom Print pointed at an old home-page section. In
// the theme these are the footer menu's links (Online Store → Navigation).
export const FOOTER_PATCHES: Patch[] = [
  ['<a href="#">SolarShift™ Ink</a>', '<a href="/pages/our-story#solarshift">SolarShift™ Ink</a>'],
  ['<a href="#">Truecolors Trading</a>', '<a href="/pages/our-story">Truecolors Trading</a>'],
  ['<a href="#">Press</a>', `<a href="mailto:${EMAIL}?subject=Press">Press</a>`],
  ['<a href="/#wholesale">Custom Print</a>', '<a href="/pages/wholesale">Custom Print</a>'],
];

export function patchPage(path: string, html: string) {
  return (THEME_PATCHES[path] ?? []).reduce((doc, [from, to]) => doc.replace(from, to), html);
}

// Where the visitor's store ships from. The collection header said "Ships from Dubai" in the USA store too; the
// rest of the theme already picks by market. In the collection template:
//   Ships from {% if localization.country.iso_code == 'US' %}Las Vegas{% else %}Dubai{% endif %}
export function patchMarket(html: string, market: "AE" | "US") {
  if (market !== "US") return html;
  return html.replace(/(<div class="collection-meta">[^<]*)Ships from Dubai/g, "$1Ships from Las Vegas");
}

export function patchFooter(html: string) {
  return FOOTER_PATCHES.reduce((doc, [from, to]) => doc.replaceAll(from as string, to), html);
}
