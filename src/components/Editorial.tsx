import Link from "next/link";

type Media = { video: string; poster: string; alt: string } | { image: string; alt: string };

export type EditorialBreak = {
  id: string;
  media: Media;
  eyebrow: string;
  title: React.ReactNode;
  text: string;
  cta: { href: string; label: string };
};

// The editorial breaks between rows of designs: a lookbook photo or clip edge to edge beside one line in very big
// type, so a long scroll has moments to stop on. Videos are muted loops, as every clip on the site is.
export const EDITORIAL = {
  walk: (designHref: string): EditorialBreak => ({
    id: "walk",
    media: { video: "/displays/walk-video.mp4", poster: "/displays/tc-person-shade.jpg", alt: "A man walks out of a shop into the sun and his shirt turns full colour" },
    eyebrow: "Lookbook · 01",
    title: <>Step into <span className="sun-text">the sun.</span></>,
    text: "Grey line art indoors. Full colour the second daylight hits it, and back again in the shade. Every print, every time.",
    cta: { href: designHref, label: "Back a design" },
  }),
  surf: (createHref: string): EditorialBreak => ({
    id: "surf",
    media: { image: "/editorial/miami-surf.webp", alt: "A man on Miami Beach in a Truecolors surfboard tee, in full colour" },
    eyebrow: "Lookbook · 02",
    title: <>Drawn by someone. <span className="sun-text">Worn on the beach.</span></>,
    text: "Every community design started as one line typed into the studio. Yours could be the next one in the sun.",
    cta: { href: createHref, label: "Create yours" },
  }),
  split: (createHref: string): EditorialBreak => ({
    id: "split",
    media: { image: "/editorial/beach-split.webp", alt: "One shirt half in shade and half in sun: grey on one side, full colour on the other" },
    eyebrow: "Lookbook · 03",
    title: <>Half shade. <span className="sun-text">Half sun.</span></>,
    text: "The colour follows the light to the line. Printed in Cancún with UV-reactive ink that outlasts the shirt.",
    cta: { href: createHref, label: "Design one" },
  }),
};

export function Editorial({ item, flip = false }: { item: EditorialBreak; flip?: boolean }) {
  const { media } = item;
  return (
    <section className={`editorial${flip ? " flip" : ""}`} aria-label={item.eyebrow}>
      <div className="editorial-media">
        {"video" in media
          ? <video src={media.video} poster={media.poster} autoPlay muted loop playsInline preload="metadata" aria-label={media.alt} />
          : <img src={media.image} alt={media.alt} loading="lazy" decoding="async" />}
      </div>
      <div className="editorial-text">
        <div className="eyebrow">{item.eyebrow}</div>
        <h2>{item.title}</h2>
        <p>{item.text}</p>
        <Link href={item.cta.href} className="button sun-button">{item.cta.label}</Link>
      </div>
    </section>
  );
}
