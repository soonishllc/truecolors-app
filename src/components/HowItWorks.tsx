import { TileSweep } from "@/components/TileSweep";
import { money } from "@/lib/format";
import { FUNDING_GOAL, PREORDER_PRICE } from "@/lib/rules";
import { siteImageUrl, siteVideoUrl } from "@/lib/site-images";

// How the community works, in three animated photos: a design, the pre-orders, the print.
export function HowItWorks() {
  const steps = [
    { id: "step-design", title: "Designers create it", text: "Anyone can describe an idea or snap a sketch; the AI studio turns it into print-ready art that changes colour in the sun." },
    { id: "step-preorder", title: "Fans pre-order", text: `Pre-order for ${money(PREORDER_PRICE.AE.cents, "AED")} in the UAE or ${money(PREORDER_PRICE.US.cents, "USD")} in the USA. Nobody is charged unless the design reaches ${FUNDING_GOAL}.` },
    { id: "step-print", title: `We print at ${FUNDING_GOAL}`, text: "Funded designs are printed in Cancún and shipped, and the designer earns on every shirt.", once: true },
  ];
  return (
    <div className="steps">
      {steps.map((st, i) => {
        const img = siteImageUrl(st.id);
        const clip = siteVideoUrl(st.id);
        return (
          <div key={st.id}>
            {clip && img && st.once ? (
              // An action shot: plays once each time it scrolls into view and holds its last frame.
              <div className="tile-art"><img className="art" src={img} alt="" /><TileSweep src={clip} inView /></div>
            ) : clip ? <video className="art" src={clip} poster={img} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
              : img ? <img className="art" src={img} alt="" /> : <div className="art step-fallback"><span className="sun-text">{i + 1}</span></div>}
            <h3>{i + 1}. {st.title}</h3>
            <p className="muted small">{st.text}</p>
          </div>
        );
      })}
    </div>
  );
}
