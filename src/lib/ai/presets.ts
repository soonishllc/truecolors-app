// House-style presets. Each locks in a white tee print in the Truecolors look.

import type { DesignOptions, Placement } from "../db/schema";

export type Preset = {
  id: string;
  label: string;
  group: string;
  // One line for the style picker: what it's best for.
  hint: string;
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
    label: "Truecolors classic", hint: "Like our best sellers: a bold, detailed scene",
    group: "Signature",
    style: "the house look of the best-selling Truecolors shirts in the reference images: bold scenic illustration with crisp detail, sized for a chest print",
    refs: [`${STORE}/habibi_3.png?width=1024`, `${STORE}/dunebashing_4_ee00ea99-1b6d-4e97-8974-83434a6a2acc.png?width=1024`, `${STORE}/beach_mixed.jpg?width=1024`],
  },
  { id: "souvenir", label: "Souvenir", hint: "A place and its landmarks, gift-shop classic", group: "Places", style: "vintage souvenir t-shirt illustration, landmark vignette, friendly and nostalgic" },
  { id: "skyline", label: "City skyline", hint: "A city's skyline in clean silhouettes", group: "Places", style: "city skyline illustration with recognisable landmarks, clean silhouettes" },
  { id: "postcard", label: "Travel postcard", hint: "Retro travel poster with the place name", group: "Places", style: "retro travel-poster composition with a big landmark, sun rays and a banner for the place name", text: true },
  { id: "beach", label: "Beach", hint: "Palms, waves and sun", group: "Places", style: "sunny beach scene, palm trees, waves and sun, relaxed holiday mood" },
  { id: "lettering", label: "Lettering", hint: "A short phrase as the hero", group: "Words", style: "bold hand lettering as the main subject, short phrase, decorative flourishes", text: true },
  {
    id: "letter-fill", label: "Scene-filled letters", hint: "One big word, each letter a scene", group: "Words", text: true, backdrop: 0,
    style: "one word in huge block capitals spread across the chest, each letter filled with a different detailed scene, like the HABIBI shirt",
  },
  { id: "phrase", label: "Famous phrase", hint: "A saying set as a poster", group: "Words", style: "a well-known saying or proverb set as a typographic poster with small illustrated accents; public-domain sayings only, no song lyrics or brand slogans", text: true },
  { id: "varsity", label: "Varsity", hint: "College-style arch lettering", group: "Words", style: "collegiate varsity lettering in an arch with a year or number and a small mascot, for an invented team", text: true },
  { id: "meme", label: "Meme", hint: "A joke with a caption", group: "Fun", style: `a funny meme-style illustration with a short caption, exaggerated expression, internet-humour energy. ${ORIGINAL}`, text: true },
  { id: "pop", label: "Pop culture", hint: "Pop-art tribute to an era", group: "Fun", style: `a bold pop-art style tribute to a trend or era (retro gaming, 90s, sci-fi, sport), thick comic outlines and bold graphic shapes (no halftone dots, which are too fine to print). ${ORIGINAL}` },
  { id: "merch", label: "Creator merch", hint: "Loud mascot merch for a fanbase", group: "Fun", style: `bold streetwear creator-merch graphic: a big grinning cartoon mascot with thick outlines, explosive shapes and a short shout-out word, made to be worn by a fanbase. ${ORIGINAL}`, text: true },
  { id: "mascot", label: "Cute mascot", hint: "A cute character", group: "Fun", style: `a cute chunky cartoon character with big eyes, kawaii style, simple shapes. ${ORIGINAL}` },
  { id: "badge", label: "Retro badge", hint: "A round badge with a banner", group: "Classic", style: "a vintage circular badge or patch emblem with a scene inside, rope border and a ribbon banner", text: true },
  { id: "tattoo", label: "Tattoo flash", hint: "Bold flash: roses, daggers, swallows", group: "Classic", style: "old-school tattoo flash: bold outlines, a swallow, rose, dagger or anchor motif, banner scroll" },
  { id: "nature", label: "Nature", hint: "Animals and plants, field-guide style", group: "Classic", style: "detailed botanical or wildlife illustration, engraved field-guide line work" },
  { id: "patriotic", label: "Patriotic", hint: "National pride, symbols and landscapes", group: "Classic", style: "proud national-pride illustration using symbols and landscapes, no real people" },
];

export function preset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}

// Every prompt is labelled lines in a fixed order: what it is, the subject, style, line work, ink, words, layout.
// The image models follow labelled lines better than one run-on sentence, the designer's text sits in its own field
// (so it can't run on into, or override, the rules after it), and the print rules come last, where they stick.

// How much detail the line art carries. Both are sized for Cancún's screens: the shirt is printed up to 14 inches
// wide from a 1024 px drawing (about 0.35 mm a pixel); black ink holds lines from about 0.3 mm and gaps from about
// 0.4 mm, so nothing may be thinner than about 2 px at the drawing's size. A left-chest print is a third of that
// size, so it's always drawn bold. Large solid black hides the sun colour, so it's kept to small accents.
const LINE_STYLE = {
  bold:
    "Line work: bold, clean black ink like a screen-printed tee. Thick, confident outlines and simpler medium-weight " +
    "interior lines, with large open shapes inside the outlines for colour to fill. No hairlines, stippling, dot " +
    "shading or fine hatching; the white gaps between lines are at least as wide as the lines.",
  detailed:
    "Line work: detailed, confident black ink like a premium illustrated tee: varied line weights, crisp outlines and " +
    "interior detail, depth from clean black hatching. The finest line or gap is still clearly visible at full size " +
    "(no hairlines, single-pixel dots or speckle), and hatching lines are spaced at least their own width apart. Leave " +
    "open shapes for colour.",
};

const INK_ONLY =
  "Ink: pure black on plain white only. No grey tones, washes, colour, gradients, glow or drop shadows, and no large " +
  "solid black areas (small solid accents like pupils are fine).";

// Where it's worn decides the composition.
const PLACEMENT: Record<Placement, string> = {
  front: "a centred front print",
  back: "a large back print, which can be tall",
  chest: "a small left-chest emblem printed about 9 cm wide: one simple compact mark with few, chunky details, readable from across a room",
};

// Designer text goes inside the prompt's own quotes, so theirs become single quotes.
export const quoteSafe = (s: string) => s.replace(/["“”«»„`]/g, "'").replace(/\s+/g, " ").trim();

// Short Latin-script words are also spelled out: the image models letter more accurately from a spelling.
function spelled(text: string) {
  return text.length <= 30 && /^[\p{Script=Latin}\p{N}\s'!?.,&-]+$/u.test(text) ? ` (spelled ${[...text].map((c) => (c === " " ? "/" : c)).join("-")})` : "";
}

// The words on the shirt. Typed (or briefed) words are used exactly; otherwise lettering styles take them from the subject.
function lettering(p: Preset, text: string | undefined, placement: Placement) {
  const size = placement === "chest"
    ? "Letters big and heavy for a small print: thick strokes, simple bold capitals, nothing tiny."
    : "Letters large and heavy: strokes at least as thick as the main outlines, no small print.";
  if (text) return `Words: exactly "${quoteSafe(text)}"${spelled(quoteSafe(text))}, letter for letter, with correct letterforms and even spacing; add no other words. ${size}`;
  return p.text
    ? `Words: letter the words the subject asks for, spelled correctly, as bold outlined letters. ${size}`
    : "Words: none. No text, numbers or signatures.";
}

const FRAME = "Layout: centred, with a clear white margin all round; nothing touches or is cut off at the edges.";
const ARTWORK_ONLY = "Just the artwork: no shirt, mockup or frame.";

const detailFor = (o: DesignOptions) => (o.placement === "chest" ? "bold" : o.detail ?? "bold");

// `subject` is the brief's (see brief.ts), not the raw idea.
export function lineArtPrompt(p: Preset, subject: string, o: DesignOptions = {}): string {
  const placement = o.placement ?? "front";
  return [
    `T-shirt print artwork for a white tee: black ink line art for ${PLACEMENT[placement]}.`,
    `Subject: ${quoteSafe(subject)}.`,
    `Style: ${p.style.replace(/\.$/, "")}.`,
    p.refs ? "Match the drawing style of the reference shirts, but make a new design: don't copy their subjects or words." : "",
    LINE_STYLE[detailFor(o)],
    INK_ONLY,
    lettering(p, o.text, placement),
    `${FRAME} ${ARTWORK_ONLY}`,
  ].filter(Boolean).join("\n");
}

// The subject when a sketch comes with no usable idea: the drawing itself says what it is (brief.ts).
export const SKETCH_SUBJECT = "the subject of the sketch, as drawn";

// For a designer's own drawing: the AI keeps their idea and composition and redraws it print-ready. The upload has
// been cleaned (service.readSketch), but it's still a phone photo of paper: the model is told what to ignore, and
// that the sketch is the authority on what's drawn and where, with the subject line only naming it. `photo`: the
// upload wasn't a drawing (a person, pet or place), so it's redrawn as an illustration rather than traced.
export function sketchPrompt(p: Preset, subject: string, o: DesignOptions = {}, from: { photo?: boolean } = {}): string {
  const placement = o.placement ?? "front";
  const size = placement === "chest" ? "Letters big and heavy for a small print." : "Letters large and heavy: strokes at least as thick as the main outlines.";
  const words = o.text
    ? lettering(p, o.text, placement)
    : from.photo
      ? "Words: none. Leave out any text, logos or signs in the photo."
      : `Words: only the words written in the sketch, if any, letter for letter as written there (same spelling and capitals), redrawn as clean bold hand lettering in the same place; add no other words. ${size}`;
  if (from.photo) {
    return [
      `T-shirt print artwork for a white tee: turn this photo into black ink line art for ${PLACEMENT[placement]}.`,
      `Subject: ${quoteSafe(subject === SKETCH_SUBJECT ? "the main subject of the photo" : subject)}.`,
      "Redraw the photo's main subject as an illustration, not a traced photo: keep its pose and what makes it " +
        "recognisable, and leave out the photo's background clutter. Turn light and shadow into outlines, not tone.",
      `Style: ${p.style.replace(/\.$/, "")}.`,
      LINE_STYLE[detailFor(o)],
      INK_ONLY,
      words,
      `${FRAME} ${ARTWORK_ONLY}`,
    ].join("\n");
  }
  return [
    `T-shirt print artwork for a white tee: redraw this customer's hand-drawn sketch as finished black ink line art for ${PLACEMENT[placement]}.`,
    `Subject: ${quoteSafe(subject)}.`,
    "The sketch decides what is drawn and where: keep its subject, every element in it, their positions, " +
      "proportions, poses and expressions, and its charm; don't swap it for a different drawing or add new subjects.",
    "Finish it: make wobbly, shaky or doubled strokes into single confident lines, close gaps, and square up anything " +
      "skewed by the camera angle. Crayon, felt-pen or scribbled colour only shows where shapes are: draw them as " +
      "clean outlines with the inside left white.",
    "Ignore everything that isn't the drawing: paper edges and texture, notebook lines and holes, creases, shadows, " +
      "pencils and the table.",
    `Style: finished in this style, without losing the sketch's own look: ${p.style.replace(/\.$/, "")}.`,
    LINE_STYLE[detailFor(o)],
    INK_ONLY,
    words,
    `${FRAME} ${ARTWORK_ONLY}`,
  ].join("\n");
}

// The sun colours a designer can pick; "natural" leaves it to the subject.
export const PALETTES: { id: string; label: string; prompt: string }[] = [
  { id: "natural", label: "True to life", prompt: "natural, true-to-life colours for the subject, warm and sunlit" },
  { id: "sunset", label: "Sunset", prompt: "a warm sunset palette: magenta, coral, orange and gold" },
  { id: "tropical", label: "Tropical", prompt: "a tropical palette: turquoise, lime green, hot pink and sunny yellow" },
  { id: "desert", label: "Desert gold", prompt: "a desert palette: sand, amber, terracotta and deep teal" },
  { id: "ocean", label: "Ocean", prompt: "a cool ocean palette: aqua, cobalt, seafoam and white highlights" },
  { id: "neon", label: "Neon pop", prompt: "a loud pop palette: hot pink, lime green, violet and orange, as bright as ink gets (solid colour, not glowing)" },
];

export function palette(id: string | undefined) {
  return PALETTES.find((x) => x.id === id) ?? PALETTES[0];
}

// The colour prints in sun-reactive (photochromic) ink, which is weaker than normal ink: pale tints and fine texture
// vanish in the sun, and dark paint is taken for black line ink (layers.colourLines), so the AI is asked for strong
// mid-to-light colour with simple shading. Full colour: painted like the real shirts in the reference photos. Spot
// colour: flat fills the printer can separate.
const SUN_INK =
  "Sun-reactive ink: strong, saturated colour in every shape; no pale washes or near-white tints, and no black, " +
  "near-black, dark brown or very dark navy fills (every colour clearly lighter than the black lines). Smooth, simple " +
  "shading, at most a lighter and a deeper tone of each colour, with no speckle, grain or texture. No glow, neon or " +
  "blur effects.";

const KEEP_LINES = "Keep every black line exactly where it is, as solid black, and keep the drawing's composition; add no new black lines.";

// `subject`: what the drawing is of, from the tidied idea (brief.tidyIdea).
export function colourPrompt(subject: string, maxFillColours: number | null, withRefs = false, backdrop = true, paletteId?: string): string {
  const colours = `Colours: ${palette(paletteId).prompt}.`;
  const letters = "Colour the inside of any lettering too, so the words light up in the sun.";
  if (maxFillColours) {
    return [
      "Colour in this black line art for a t-shirt print.",
      `Subject: ${quoteSafe(subject)}.`,
      `Use flat solid fills only, at most ${maxFillColours} bright colours, no gradients or shading.`,
      colours, letters, SUN_INK,
      `${KEEP_LINES} Keep the background plain white.`,
    ].join("\n");
  }
  return [
    "Paint the first image, black line art for a t-shirt print, in full colour.",
    `Subject: ${quoteSafe(subject)}.`,
    withRefs ? "The other images are photos of real printed shirts: match how fully and boldly they're coloured and their painting style, not their subject or palette." : "",
    "Bold, saturated colour fills every shape inside the black outlines, edge to edge: leave nothing white except the whites of eyes, small highlights and anything the subject says is white.",
    "Colour each shape up to its black outline and stop there: never paint across a line or outside the drawing.",
    colours, letters, SUN_INK,
    backdrop
      ? "Behind the drawing, paint a slim backdrop (sky or landscape) that hugs its outline closely, with rough, torn edges; no big block of colour around it."
      : "Colour only inside the drawing's outlines (for lettering, only inside each letter); everything outside them stays plain white, with no backdrop.",
    `${KEEP_LINES} Everywhere else, keep the background plain white.`,
  ].filter(Boolean).join("\n");
}

// `instruction`: the tidied one (brief.tidyInstruction).
export function refinePrompt(instruction: string, o: DesignOptions = {}): string {
  return [
    "Edit this black line art for a t-shirt print.",
    `Change: ${quoteSafe(instruction)}.`,
    "Keep everything else the same: subject, composition and line style.",
    LINE_STYLE[detailFor(o)],
    INK_ONLY,
    o.text ? `Words: exactly "${quoteSafe(o.text)}"${spelled(quoteSafe(o.text))}, letter for letter; add no other words.` : "",
    FRAME,
  ].filter(Boolean).join("\n");
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
