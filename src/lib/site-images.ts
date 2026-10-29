import { existsSync } from "node:fs";
import path from "node:path";
import { STORE_LOGO } from "./brand";

// Photos for the app's own pages (banners, "how it works"), made once with the OpenAI image model by
// `npm run site:images` and saved in public/site/. Pages show them when the file exists and fall back
// to plain colour when it doesn't, so the app works before they're generated.

// Truecolors product photos used as style references: sunny, real places, people in white tees.
const PHOTO_STYLE = [
  "https://www.truecolors.global/cdn/shop/files/beach_mixed.jpg?width=1024",
  "https://www.truecolors.global/cdn/shop/files/miami_surf_4_5.png?width=1024",
];
const LOGO = STORE_LOGO.replace("width=300", "width=1024");

// The ink is the whole story, so every photo has to show it truthfully: no half-coloured prints in bright rooms.
const STYLE =
  "Photorealistic lifestyle photo in the same style, natural light and warm colour grading as the reference photos " +
  "from the Truecolors clothing brand. Use new people and new shirt designs: do not copy the people or prints in the " +
  "references, and give every shirt in the image its own different design. Truecolors prints use UV-reactive ink: " +
  "out of direct sunlight (indoors, or in shade) a print shows only grey and black line art with no colour at all; " +
  "in direct sunlight the same print is fully coloured. Never show a print that is part grey and part colour. " +
  "No words, letters or watermarks anywhere in the image, apart from any logo the prompt asks for.";

// What the shirts look like on the store: each one a different kind of design, never the same shape twice.
const PRINT_REALISM =
  "Every print is screen-printed into the fabric: it follows the folds, creases and curve of the body, takes the " +
  "same light and shadow as the shirt, and has a slight ink texture. It must not look pasted on or flat.";

export type SiteImage = {
  id: string;
  size: "1536x1024" | "1024x1024";
  prompt: string;
  // Reference images sent with the prompt. Defaults to the store's product photos.
  refs?: string[];
  // Made by editing another site image instead of from the references, so the two match shot for shot.
  from?: string;
  // Logos: drawn on solid black, which is then keyed out to a transparent PNG trimmed to its edges.
  cutout?: boolean;
};

export const SITE_IMAGES: SiteImage[] = [
  {
    id: "wordmark",
    size: "1536x1024",
    refs: [LOGO],
    cutout: true,
    prompt:
      "A logo lockup for Truecolors Design, the brand's design studio, on a pure solid black background. Top line: " +
      "the Truecolors logo from the reference image reproduced exactly, same letterforms, same white italic serif " +
      "\"true\" and the same diagonal-striped pink-to-orange-to-yellow gradient \"COLORS\". Directly underneath, " +
      "centred and spanning the same width as the logo, the single word \"DESIGN\" in widely spaced, clean geometric " +
      "capitals drawn as thin outline strokes, like line art: the strokes start white on the left and pick up the same " +
      "pink-orange-yellow sunlight gradient towards the right, as if the sun is colouring them in. A thin gradient rule " +
      "between the two lines. Flat vector logo, crisp edges, no shadow, no mockup, no other text, nothing else.",
  },
  {
    id: "home-hero-sun",
    size: "1536x1024",
    prompt:
      "Wide shot, one person only and nobody else in the frame, subject on the right third, calm empty space on the " +
      "left for a headline. Bright midday sun with hard shadows on a beach promenade lined with palm trees. The " +
      "person has just stepped out of the dark shade of a café awning " +
      "into full direct sunlight, smiling up at the sun; their white tee has a bold, fully coloured print of a " +
      "desert-sunset scene with a falcon, glowing in the sunlight.",
  },
  {
    id: "home-hero-shade",
    size: "1536x1024",
    from: "home-hero-sun",
    prompt:
      "The same photo: keep the person, pose, framing, camera angle and background exactly the same. Only change " +
      "this: the person is now standing completely inside the cool shadow of the café awning, so no direct sunlight " +
      "touches them, and the print on their tee shows only its grey and black line art with no colour at all. The " +
      "beach and palm trees behind them are still sunny. Photorealistic, no text.",
  },
  {
    id: "studio-hero",
    size: "1536x1024",
    prompt:
      "Wide shot, calm empty space on the left for a headline. A calm design studio indoors. A designer sits at a " +
      "wooden desk in the right half of the frame, drawing black-and-white line art of a city skyline on a tablet. The " +
      "designer, the desk and a folded white tee with a grey line-art print on the desk are all in soft, even shade: " +
      "no sunlight touches them at all. Further right, a metre or two away from the designer, a window lets in one " +
      "narrow, sharply edged beam of direct sunlight that falls only on the windowsill, where a white tee lies flat. " +
      "The whole tee is inside the bright patch of sunlight, edge to edge, and its print is fully coloured: the only " +
      "colourful print in the room. The left half is a plain, softly lit wall.",
  },
  {
    id: "step-design",
    size: "1024x1024",
    prompt:
      "Indoors, soft daylight, no direct sun. Overhead shot of a desk: on the left, a rough pencil sketch of a falcon " +
      "on a sheet of paper; on the right, a laptop whose screen shows a clean design app where AI has redrawn that " +
      "sketch as crisp, bold black-and-white line art ready to print, with a soft glowing gradient highlight around " +
      "the new artwork and a few small thumbnails of alternative versions along the bottom of the screen. A white tee " +
      "lies folded beside the laptop with a grey line-art print. A hand rests on the trackpad.",
  },
  {
    id: "step-preorder",
    size: "1024x1024",
    prompt:
      "Two friends at a café table outside in bright, direct midday sunlight with hard shadows, looking at a phone " +
      "together and laughing; the phone screen faces away from the camera. Both wear white tees in full sun with " +
      "fully coloured prints in two completely different styles, like the variety in the brand's range: one has a " +
      "wide horizontal panorama of a city skyline at sunset across the chest; the other has a round emblem badge with " +
      "a paint-splash edge around a desert dune buggy. Neither print is shaped like a surfboard. " + PRINT_REALISM,
  },
  {
    id: "step-print",
    size: "1024x1024",
    refs: [...PHOTO_STYLE, LOGO],
    prompt:
      "A large, modern apparel factory floor, wide shot. In the centre, a big industrial automatic screen-printing " +
      "press: a ten-arm rotary carousel, with ten pallet arms radiating from a central hub, white tees loaded on the " +
      "pallets and print heads overhead, feeding a long conveyor dryer tunnel. Rows of production tables and stacked " +
      "boxes behind. The windows are blacked out and the hall is lit by warm amber UV-filtered industrial lights, " +
      "because UV-reactive ink must be kept out of sunlight. Three operators in black tees with the Truecolors logo " +
      "from the last reference image printed small on the chest, reproduced exactly, work the press. Every printed " +
      "white tee shows grey line-art prints only, with no colour, because there is no sunlight in the hall.",
  },
];

export function sitePrompt(img: SiteImage): string {
  return img.from || img.cutout ? img.prompt : `${img.prompt}\n\n${STYLE}`;
}

export function styleRefs(img: SiteImage): string[] {
  return img.refs ?? PHOTO_STYLE;
}

export const SITE_DIR = path.join(process.cwd(), "public", "site");

export const siteImageFile = (id: string) =>
  `${id}.${SITE_IMAGES.find((img) => img.id === id)?.cutout ? "png" : "webp"}`;

export function siteImageUrl(id: string): string | undefined {
  return existsSync(path.join(SITE_DIR, siteImageFile(id))) ? `/site/${siteImageFile(id)}` : undefined;
}
