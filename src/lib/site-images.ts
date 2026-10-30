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

// Designs that have sold on the store, shown on the shirts in the pre-order photo. As campaigns get funded,
// swap in their sun mockups and remake it: npm run site:images -- step-preorder
const SOLD_DESIGNS = [
  "https://www.truecolors.global/cdn/shop/files/habibi_4.png?width=1024",
  "https://www.truecolors.global/cdn/shop/files/dunebashing_3_48b610ef-5c86-4f82-a4c4-9f81b799a2ab.png?width=1024",
];

// The ink is the whole story, so every photo has to show it truthfully: colour exactly where the sun falls.
const INK =
  "Truecolors prints use UV-reactive ink: wherever direct sunlight falls on a print it is fully coloured, and " +
  "wherever it is out of direct sunlight (indoors, or in shade) it shows only grey and black line art with no colour " +
  "at all. If the edge of a sunbeam or shadow crosses a shirt, the print is coloured on the sunlit side and grey on " +
  "the shaded side, and the change follows that light edge exactly. A print in bright indoor light that isn't " +
  "direct sun is still grey.";
// Every shirt, worn, held, folded, on a machine or on a belt, is soft, light cotton: never stiff or board-like.
const FABRIC =
  "Every t-shirt in the image is thin, lightweight cotton jersey and behaves like it: it drapes, sags and wrinkles " +
  "under its own weight, held shirts hang softly, shirts laid down lie relaxed with soft wrinkles and uneven edges, " +
  "and folded shirts are soft, puffy bundles with rounded folds in slightly uneven stacks, never flat, stiff, " +
  "rigid or paper-like.";

const STYLE =
  "Photorealistic lifestyle photo in the same style, natural light and warm colour grading as the reference photos " +
  "from the Truecolors clothing brand. Use new people and new shirt designs: do not copy the people or prints in the " +
  "references. " + INK + " " + FABRIC + " No words, letters or watermarks anywhere in the image, apart from any logo or lettering " +
  "the prompt asks for.";

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
  // Copy the prints from the reference images instead of inventing new ones.
  ownPrints?: boolean;
  // Logos: drawn on solid black, which is then keyed out to a transparent PNG trimmed to its edges.
  cutout?: boolean;
};

export const SITE_IMAGES: SiteImage[] = [
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
      "touches them, the print on their tee shows only its grey and black line art with no colour at all, and they " +
      "have pushed the same sunglasses up to rest on top of their head, so their eyes are now visible. The " +
      "beach and palm trees behind them are still sunny. Photorealistic, no text.",
  },
  {
    id: "studio-hero",
    size: "1536x1024",
    prompt:
      "Wide shot, calm empty space on the left for a headline. A calm design studio indoors. In the right half of " +
      "the frame a designer sits at a wooden desk in soft, even shade, drawing on a tablet; no sunlight touches them. " +
      "The designer wears a white tee printed with a city skyline at sunset; because they are in the shade, their " +
      "print shows only grey and black line art. Behind them on the right is a window. A second white tee with exactly " +
      "the same skyline print hangs on a hanger by the window, and a sharp-edged beam of direct sunlight falls " +
      "diagonally across it: the sunlit part of that print glows in full sunset colour, while the part just outside " +
      "the beam stays grey line art, the change following the edge of the light exactly. The two shirts are the same " +
      "design, so it's obvious the sun is what colours it. The left half is a plain, softly lit wall.",
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
    refs: [...SOLD_DESIGNS, PHOTO_STYLE[0]],
    ownPrints: true,
    prompt:
      "Two friends at a café table outside in bright, direct midday sunlight with hard shadows, looking at a phone " +
      "together and laughing; the phone screen faces away from the camera. Both wear white tees in full sun, so both " +
      "prints are fully, vividly coloured. The friend on the left wears the HABIBI design from the first reference " +
      "image: the word HABIBI in huge block capitals filled with Dubai skyline, palm and sea scenes, spread wide " +
      "across the chest. The friend on the right wears the Dune Bashing design from the second reference image: a " +
      "Dubai skyline and an SUV kicking up desert sand, with the script lettering \"I'd rather be Dune Bashing\" above " +
      "it. Reproduce both designs and their lettering faithfully, in their sunlit full-colour version, rich and " +
      "saturated. Use new people, not the models from the references. " + PRINT_REALISM,
  },
  {
    id: "step-print",
    size: "1024x1024",
    refs: [...PHOTO_STYLE, LOGO],
    prompt:
      "A professional screen-printing factory, wide shot. In the foreground, a big M&R-style automatic screen-printing " +
      "press: a 12-station carousel with a central hub, a ring of printing heads holding mesh screens, a heavy-duty " +
      "industrial steel frame, and red flash-cure units glowing orange-red between stations. Exactly two operators: " +
      "one loads blank white tees onto the pallets on one side, and the other stands at the exit of a conveyor dryer " +
      "next to the press. Its short exit belt ends in a steel roller, with an open cardboard box of folded finished " +
      "tees on the floor just past it; she lifts the only shirt on the belt, by its shoulders, as it comes out. Behind them: a wall rack of aluminium-framed mesh " +
      "screens lined up side by side, neat stacks of normal retail-folded tees (each about the size of a shoebox lid, " +
      "in realistic proportion to the people), and shipping boxes, taped and ready to go. The windows are blacked out and the hall is " +
      "lit by warm amber UV-filtered lights, because UV-reactive ink must be kept out of sunlight. Both operators wear " +
      "black tees with the Truecolors logo from the last reference image printed small on the chest, reproduced " +
      "exactly. Every printed white tee shows grey line-art prints only, with no colour, because there is no sunlight.",
  },
];

export function sitePrompt(img: SiteImage): string {
  if (img.from || img.cutout) return img.prompt;
  if (img.ownPrints) return `${img.prompt}\n\nPhotorealistic lifestyle photo with natural light and warm colour grading. ${INK} ${FABRIC}`;
  return `${img.prompt}\n\n${STYLE}`;
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

// A short looping clip of the same scene (made with Higgsfield from the photo), where one exists.
export function siteVideoUrl(id: string): string | undefined {
  return existsSync(path.join(SITE_DIR, `${id}.mp4`)) ? `/site/${id}.mp4` : undefined;
}
