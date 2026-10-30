// House-style presets. Each locks in a white tee chest print in the Truecolors look.

export type Preset = {
  id: string;
  label: string;
  group: string;
  style: string;
  // The design is built around words from the idea, so the AI must letter them exactly.
  text?: boolean;
  // Drawn from the store's best-selling shirts as style references instead of from words alone.
  refs?: string[];
  // Painted backdrop around the drawing, as a fraction of its width; 0 keeps colour strictly inside the drawing.
  backdrop?: number;
};

const STORE = "https://www.truecolors.global/cdn/shop/files";

// For styles that riff on culture: keep it original, so nothing needs a licence.
const ORIGINAL = "Original characters and jokes only: no existing cartoon or film characters, no logos, no real people, no brand names.";

export const PRESETS: Preset[] = [
  {
    id: "classic",
    label: "Truecolors classic",
    group: "Signature",
    style: "the house look of the best-selling Truecolors shirts in the reference images: bold scenic illustration with crisp detail, sized for a chest print",
    refs: [`${STORE}/habibi_3.png?width=1024`, `${STORE}/dunebashing_4_ee00ea99-1b6d-4e97-8974-83434a6a2acc.png?width=1024`, `${STORE}/beach_mixed.jpg?width=1024`],
  },
  { id: "souvenir", label: "Souvenir", group: "Places", style: "vintage souvenir t-shirt illustration, landmark vignette, friendly and nostalgic" },
  { id: "skyline", label: "City skyline", group: "Places", style: "city skyline illustration with recognisable landmarks, clean silhouettes" },
  { id: "postcard", label: "Travel postcard", group: "Places", style: "retro travel-poster composition with a big landmark, sun rays and a banner for the place name", text: true },
  { id: "beach", label: "Beach", group: "Places", style: "sunny beach scene, palm trees, waves and sun, relaxed holiday mood" },
  { id: "lettering", label: "Lettering", group: "Words", style: "bold hand lettering as the main subject, short phrase, decorative flourishes", text: true },
  {
    id: "letter-fill", label: "Scene-filled letters", group: "Words", text: true, backdrop: 0,
    style: "one word in huge block capitals spread across the chest, each letter filled with a different detailed scene, like the HABIBI shirt",
  },
  { id: "phrase", label: "Famous phrase", group: "Words", style: "a well-known saying or proverb set as a typographic poster with small illustrated accents; public-domain sayings only, no song lyrics or brand slogans", text: true },
  { id: "varsity", label: "Varsity", group: "Words", style: "collegiate varsity lettering in an arch with a year or number and a small mascot, for an invented team", text: true },
  { id: "meme", label: "Meme", group: "Fun", style: `a funny meme-style illustration with a short caption, exaggerated expression, internet-humour energy. ${ORIGINAL}`, text: true },
  { id: "pop", label: "Pop culture", group: "Fun", style: `a bold pop-art style tribute to a trend or era (retro gaming, 90s, sci-fi, sport), halftone dots and comic outlines. ${ORIGINAL}` },
  { id: "merch", label: "Creator merch", group: "Fun", style: `bold streetwear creator-merch graphic: a big grinning cartoon mascot with thick outlines, explosive shapes and a short shout-out word, made to be worn by a fanbase. ${ORIGINAL}`, text: true },
  { id: "mascot", label: "Cute mascot", group: "Fun", style: `a cute chunky cartoon character with big eyes, kawaii style, simple shapes. ${ORIGINAL}` },
  { id: "badge", label: "Retro badge", group: "Classic", style: "a vintage circular badge or patch emblem with a scene inside, rope border and a ribbon banner", text: true },
  { id: "tattoo", label: "Tattoo flash", group: "Classic", style: "old-school tattoo flash: bold outlines, a swallow, rose, dagger or anchor motif, banner scroll" },
  { id: "nature", label: "Nature", group: "Classic", style: "detailed botanical or wildlife illustration, engraved field-guide line work" },
  { id: "patriotic", label: "Patriotic", group: "Classic", style: "proud national-pride illustration using symbols and landscapes, no real people" },
];

export function preset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}

// Matches the shirts already printed: detailed illustration, not colouring-book outlines.
const LINE_STYLE =
  "Detailed, confident black ink illustration like a premium illustrated t-shirt, not a colouring book: varied line " +
  "weights, crisp outlines with fine interior detail, and depth built only from black hatching and stippling. Every " +
  "mark is solid black on a plain white background: no grey tones, washes, colour or filled areas.";

const lettering = (p: Preset) =>
  p.text
    ? "Lettering is part of the design: use the exact words from the idea, spelled correctly, as bold outlined letters."
    : "No text unless the idea asks for it.";

export function lineArtPrompt(p: Preset, idea: string): string {
  return [
    `Black ink line art for a t-shirt chest print: ${idea}.`,
    `Style: ${p.style}.`,
    p.refs ? "Match the style of the reference shirts, but make a new design: don't copy their subjects or words." : "",
    LINE_STYLE,
    `Centered, fills the frame, no shirt, no mockup. ${lettering(p)}`,
  ].filter(Boolean).join(" ");
}

// For a designer's own drawing: the AI keeps their idea and composition and redraws it print-ready.
export function sketchPrompt(p: Preset, idea: string): string {
  return [
    `Redraw this hand-drawn sketch as black ink line art for a t-shirt chest print: ${idea}.`,
    "Keep the sketch's subject, composition and character; clean up and complete the drawing, don't replace it.",
    `Style: ${p.style}.`,
    LINE_STYLE,
    `Centered, fills the frame, no shirt, no mockup, no paper texture. ${p.text ? lettering(p) : "No text unless the sketch has it."}`,
  ].join(" ");
}

// Full colour: painted like the real shirts in the reference photos. Spot colour: flat fills the printer can separate.
export function colourPrompt(idea: string, maxFillColours: number | null, withRefs = false, backdrop = true): string {
  if (maxFillColours) {
    return [
      `Colour in this line art for a t-shirt print: ${idea}.`,
      `Use flat solid fills only, at most ${maxFillColours} bright colours, no gradients or shading.`,
      "Keep every black line exactly where it is. Keep the background plain white.",
    ].join(" ");
  }
  return [
    `Paint the first image, black line art for a t-shirt print, in full colour: ${idea}.`,
    withRefs ? "The other images are photos of real printed shirts: match their painting style and warm, sunlit palette, not their subject." : "",
    "Rich painterly colour with shading, gradients, highlights and depth, like a premium illustrated tee.",
    backdrop
      ? "Behind the drawing, paint a slim backdrop (sky, landscape or glow) that hugs its outline closely, with rough, torn edges; no big block of colour around it."
      : "Colour only inside the drawing's outlines (for lettering, only inside each letter); everything outside them stays plain white, with no backdrop.",
    "Keep every black line exactly where it is and keep the drawing's composition. Everywhere else, keep the background plain white.",
  ].filter(Boolean).join(" ");
}

export function refinePrompt(instruction: string): string {
  return [
    `Edit this black line art: ${instruction}.`,
    "Keep it pure black lines on white, no shading, no colour, same composition unless asked.",
  ].join(" ");
}

// Flags shown to the reviewer. Approval is still a human decision.
const WATCH_WORDS = [
  "logo", "mrbeast", "mr beast", "pokemon", "pikachu", "mario", "simpsons", "spongebob", "star wars", "harry potter", "nike", "adidas", "disney", "marvel", "coca", "ferrari", "gucci", "chanel",
  "president", "sheikh", "king", "queen", "prince", "minister", "trump", "biden",
  "celebrity", "messi", "ronaldo", "taylor swift", "flag of israel", "flag of palestine",
];

export function promptFlags(text: string): string[] {
  const t = text.toLowerCase();
  return WATCH_WORDS.filter((w) => t.includes(w)).map((w) => `mentions "${w}"`);
}
