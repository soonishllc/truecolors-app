import type { Metadata } from "next";
import Link from "next/link";
import { DisplayCard } from "@/components/DisplayCard";
import { SunReveal } from "@/components/SunReveal";
import { CONTACT } from "@/lib/brand";
import { SETTLEMENT_DAYS } from "@/lib/rules";

export const metadata: Metadata = {
  title: "Retail displays · Truecolors",
  description: "Consignment displays for hotel boutiques, airports and attractions: each carries its own sun, so guests watch the shirts change colour indoors.",
};

// The wholesale front end's page for display partners, from the Retail partners landing page made for the store
// (shopify-theme/sections/tc-retail-partners.liquid) and its renders and clips (retail-displays/). Terms are
// agreed per location, so there are no prices here.
const DISPLAYS = [
  {
    name: "Sunbox", where: "Countertop", image: "/displays/tc-display-sunbox.jpg", clip: "/displays/sunbox-clip.mp4",
    what: "One shirt in a lit window, right next to the till. Guests press the button and watch the print colour up while they pay.",
    bestFor: "Front desks, small boutiques, checkouts",
    specs: [["Size", "42 × 30 cm, 60 cm tall"], ["Shows", "1 demo shirt"], ["Stock", "Behind the counter"], ["Power", "Plug-in 12 V adapter"]],
  },
  {
    name: "Prism", where: "Floor · 3-sided", image: "/displays/tc-display-prism.jpg", clip: "/displays/prism-clip.mp4",
    what: "A three-sided tower that draws people in from across the floor. One face plays the shade-to-sun change on a screen; the other two hold shirts guests light up themselves. No stock on it: they buy at your counter.",
    bestFor: "Airport gates, lobbies, corridors, tight corners",
    specs: [["Size", "60 cm a side, 185 cm tall"], ["Floor", "0.15 m²"], ["Shows", "32″ screen + 2 demo shirts"], ["Power", "1 standard socket"]],
  },
  {
    name: "Tower", where: "Floor · stock + gallery", image: "/displays/tc-display-tower.jpg", clip: "/displays/tower-clip.mp4",
    what: "A full shop-in-shop. A gallery of twenty designs behind glass lights up at the press of a button, with stock in through-cubbies by size, shoppable from both sides as an island.",
    bestFor: "Resort boutiques, gift shops, high-traffic outlets",
    specs: [["Size", "102 × 56 cm, 183 cm tall"], ["Floor", "0.57 m², island or wall"], ["Shows", "20 designs, lit on demand"], ["Stock", "About 340 shirts by size"], ["Power", "1 standard socket"]],
  },
];

const PLACES = ["Hotel & resort boutiques", "Airport retail & duty free", "Theme parks & attractions", "Beach clubs", "Cruise terminals", "Tour desks", "Water parks", "Museum shops"];

const FAQ = [
  ["What do we earn?", `A set share of every shirt sold, agreed with you up front for your location. Guests see one retail price everywhere. We settle every ${SETTLEMENT_DAYS} days, weekly once a location sells enough.`],
  ["Who takes the payment?", "Either works. We can put our own card terminal at the display, so you handle no cash and we pay you your share. Or you sell through your own till and pay us ours at each settlement."],
  ["Who owns the stock?", "We do, until it sells. It's on consignment: no purchase order and nothing to write off. At the end we collect the display and anything unsold."],
  ["Is the UV light safe for guests?", "Yes. It's UV-A, sealed behind UV-filtering acrylic, so guests see visible light and the colour change. It runs 20 seconds a press and switches off if the service door opens."],
  ["Can we have designs for our property?", "Yes. Our team draws designs around your city, resort or landmark, and you approve them before printing. We can start you on catalogue designs while yours are made."],
  ["What do the floor displays need?", "A level floor and one standard socket within 3 metres. In airports and busy areas we can fix the base to the floor."],
  ["What if it doesn't sell?", "Then it costs you nothing. We review sales with you after the first period, swap designs or move the display, and either of us can end the trial."],
];

const ask = encodeURIComponent("Hi, I'd like a Truecolors display. Venue: \nCity: \nDisplay: Sunbox / Prism / Tower / not sure");

export default function Displays() {
  const whatsapp = `${CONTACT.whatsapp.href}?text=${ask}`;
  const email = `mailto:${CONTACT.email}?subject=${encodeURIComponent("Truecolors display enquiry")}`;
  return (
    <div className="displays">
      <div className="eyebrow">Retail partners · Displays</div>
      <h1>Bring the sun indoors. <span className="sun-text">A display that sells itself.</span></h1>
      <p className="lede">
        Colour-changing tees for hotel boutiques, airport shops and attractions. We supply the display, the stock and the
        demo. You give us a few square feet and keep a share of every shirt sold.
      </p>
      <ul className="display-stats">
        <li><b>No upfront cost</b>Display, stock and install are ours</li>
        <li><b>Consignment</b>Settle only what sells</li>
        <li><b>Every {SETTLEMENT_DAYS} days</b>Settlement and restock</li>
      </ul>
      <p className="row display-ctas">
        <a className="button sun-button" href={whatsapp} target="_blank" rel="noreferrer">Request a display</a>
        <a className="button secondary" href="#displays">See the three displays</a>
      </p>

      <section>
        <div className="eyebrow">Why a display</div>
        <h2>Indoors, our tees look calm. So every display brings its own sun.</h2>
        <div className="displays-hero">
          <SunReveal shade="/displays/tc-person-shade.jpg" sun="/displays/tc-person-sun.jpg" alt="A guest in a Truecolors tee" />
        </div>
        <ul className="promise">
          <li><b>A souvenir guests play with.</b> Pressing the button turns browsing into a moment people film and share.</li>
          <li><b>Designs made for your location.</b> Your city, resort or landmark, drawn by our team for your shelf.</li>
          <li><b>Easy to sell.</b> The display does the explaining; your staff only ring it up.</li>
        </ul>
      </section>

      <section id="displays">
        <div className="eyebrow">The displays</div>
        <h2>Three displays, sized to the space you have</h2>
        <p className="muted">Every one has a working sun. Tap “Press for sun” to see what a guest sees.</p>
        <div className="display-cards">
          {DISPLAYS.map((d) => (
            <DisplayCard key={d.name} name={d.name} where={d.where} image={d.image} clip={d.clip}>
              <p>{d.what}</p>
              <dl className="display-specs">
                {d.specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <p className="small muted"><b>Best for:</b> {d.bestFor}</p>
            </DisplayCard>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow">How it works</div>
        <h2>Consignment, so the risk is ours</h2>
        <ol className="steps-list">
          <li><b>Choose the spot.</b> We visit or review photos with you and pick the display that fits.</li>
          <li><b>We install and stock it.</b> Display, shirts and demo set up in one visit, usually under an hour.</li>
          <li><b>Guests press for sun.</b> They light up a shirt, pick a size and pay, on our terminal or at your till.</li>
          <li><b>Settle and restock.</b> Every {SETTLEMENT_DAYS} days we count, pay you your share and refill what&apos;s running low. Sales reports, restocks and repairs all go through one WhatsApp chat.</li>
        </ol>
        <div className="bring-grid">
          <div>
            <h3>We bring</h3>
            <ul>
              <li>The display, delivered, installed and maintained</li>
              <li>Opening stock in the sizes your guests buy</li>
              <li>Designs for your location, or picks from our catalogue</li>
              <li>The demo: UV light, screen loop, shelf talkers</li>
              <li>Our own card terminal, if you&apos;d rather not handle payment</li>
            </ul>
          </div>
          <div>
            <h3>You bring</h3>
            <ul>
              <li>A visible spot, and a socket for floor units</li>
              <li>Selling at the set retail price</li>
              <li>On your own till: a record of units sold</li>
            </ul>
          </div>
        </div>
      </section>

      <section>
        <div className="eyebrow">Where it works</div>
        <h2>Anywhere guests are about to step into the sun</h2>
        <ul className="place-chips">{PLACES.map((p) => <li key={p}>{p}</li>)}</ul>
        <video className="walk-video" src="/displays/walk-video.mp4" poster="/displays/tc-person-shade.jpg" autoPlay muted loop playsInline aria-label="A guest walks out of the shade into the sun and the shirt colours up" />
      </section>

      <section>
        <h2>Questions partners ask</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}</summary><p>{a}</p></details>
          ))}
        </div>
      </section>

      <section className="displays-cta">
        <div className="eyebrow">Request a display</div>
        <h2>Tell us about your space</h2>
        <p className="muted">
          Send your venue, city and the display you like. Our wholesale team comes back with options, suggested designs and
          the terms for your location.
        </p>
        <a className="button sun-button" href={whatsapp} target="_blank" rel="noreferrer">Message us on WhatsApp</a>
        <p className="small muted">Or email <a href={email}>{CONTACT.email}</a>. Already a partner? <Link href="/wholesale">Sign in</Link>.</p>
      </section>
    </div>
  );
}
