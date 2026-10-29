// House-style presets. Each locks in a white tee chest print in the Truecolors look.

export type Preset = { id: string; label: string; style: string };

export const PRESETS: Preset[] = [
  {
    id: "souvenir",
    label: "Souvenir",
    style: "vintage souvenir t-shirt illustration, landmark vignette, friendly and nostalgic",
  },
  {
    id: "skyline",
    label: "City skyline",
    style: "city skyline illustration with recognisable landmarks, clean silhouettes",
  },
  {
    id: "lettering",
    label: "Lettering",
    style: "bold hand lettering as the main subject, short phrase, decorative flourishes",
  },
  {
    id: "patriotic",
    label: "Patriotic",
    style: "proud national-pride illustration using symbols and landscapes, no real people",
  },
  {
    id: "beach",
    label: "Beach",
    style: "sunny beach scene, palm trees, waves and sun, relaxed holiday mood",
  },
];

export function preset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}

export function lineArtPrompt(p: Preset, idea: string): string {
  return [
    `Black ink line art for a t-shirt chest print: ${idea}.`,
    `Style: ${p.style}.`,
    "Pure black lines on a plain white background. No shading, no grey, no colour, no fills.",
    "Bold, clean outlines at least 2 pt thick, closed shapes ready to be coloured in.",
    "Centered, fills the frame, no shirt, no mockup, no text unless asked for.",
  ].join(" ");
}

// For a designer's own drawing: the AI keeps their idea and composition and redraws it print-ready.
export function sketchPrompt(p: Preset, idea: string): string {
  return [
    `Redraw this hand-drawn sketch as black ink line art for a t-shirt chest print: ${idea}.`,
    "Keep the sketch's subject, composition and character; clean up and complete the drawing, don't replace it.",
    `Style: ${p.style}.`,
    "Pure black lines on a plain white background. No shading, no grey, no colour, no fills.",
    "Bold, clean outlines at least 2 pt thick, closed shapes ready to be coloured in.",
    "Centered, fills the frame, no shirt, no mockup, no paper texture, no text unless the sketch has it.",
  ].join(" ");
}

export function colourPrompt(idea: string, maxFillColours: number): string {
  return [
    `Colour in this line art for a t-shirt print: ${idea}.`,
    `Use flat solid fills only, at most ${maxFillColours} bright colours, no gradients or shading.`,
    "Keep every black line exactly where it is. Keep the background plain white.",
  ].join(" ");
}

export function refinePrompt(instruction: string): string {
  return [
    `Edit this black line art: ${instruction}.`,
    "Keep it pure black lines on white, no shading, no colour, same composition unless asked.",
  ].join(" ");
}

// Flags shown to the reviewer. Approval is still a human decision.
const WATCH_WORDS = [
  "logo", "nike", "adidas", "disney", "marvel", "coca", "ferrari", "gucci", "chanel",
  "president", "sheikh", "king", "queen", "prince", "minister", "trump", "biden",
  "celebrity", "messi", "ronaldo", "taylor swift", "flag of israel", "flag of palestine",
];

export function promptFlags(text: string): string[] {
  const t = text.toLowerCase();
  return WATCH_WORDS.filter((w) => t.includes(w)).map((w) => `mentions "${w}"`);
}
