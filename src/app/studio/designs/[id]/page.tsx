import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { designStepAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ShadeSun } from "@/components/ShadeSun";
import { PALETTES, preset } from "@/lib/ai/presets";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { campaigns, designs, media, type DesignOptions } from "@/lib/db/schema";
import { money } from "@/lib/format";
import { CAMPAIGN_DAYS, FUNDING_GOAL, MAX_LIVE_CAMPAIGNS_PER_DESIGNER, PREORDER_PRICE, PRINT, SIZES } from "@/lib/rules";
import { fileUrl, thumbUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PLACEMENT_LABEL = { front: "Front print", back: "Back print", chest: "Left-chest print" } as const;
// Campaign states in which the design is what backers are buying, so it can't change.
const LOCKED = ["in_review", "live", "closing", "funded", "in_production", "shipped"] as const;
const OPEN = ["in_review", "live", "closing"] as const;

// The sun's colours for this colouring: a palette, and whether to paint a glow behind the drawing.
function ColourChoices({ options }: { options: DesignOptions }) {
  return (
    <>
      <fieldset className="palette-pick">
        <legend>Sun colours</legend>
        {PALETTES.map((p) => (
          <label key={p.id}>
            <input type="radio" name="palette" value={p.id} defaultChecked={(options.palette ?? "natural") === p.id} />
            <span className={`swatch swatch-${p.id}`} aria-hidden="true" />
            <span>{p.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="check toggle-row">
        <input type="checkbox" name="glow" defaultChecked={options.glow} />
        <span>Paint a sun glow behind the drawing <span className="small muted">(otherwise colour stays inside the lines)</span></span>
      </label>
    </>
  );
}

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const d = await db();
  const [design] = await d.select().from(designs).where(and(eq(designs.id, id), eq(designs.userId, user.id)));
  if (!design) notFound();
  const files = await d.select().from(media).where(eq(media.designId, id));
  const launched = await d.select().from(campaigns).where(eq(campaigns.designId, id));
  const current = launched.find((c) => (LOCKED as readonly string[]).includes(c.status));
  const open = await d.select({ id: campaigns.id }).from(campaigns)
    .where(and(eq(campaigns.userId, user.id), inArray(campaigns.status, [...OPEN])));
  const atLimit = open.length >= MAX_LIVE_CAMPAIGNS_PER_DESIGNER;
  const video = files.find((m) => m.kind === "video");
  const mockups = files.filter((m) => m.kind === "mockup");
  const report = design.printReport;
  const options = design.options;
  const step = (name: string) => <input type="hidden" name="step" value={name} />;
  const hidden = <input type="hidden" name="designId" value={id} />;
  // Where this design is: line art, then colour, then mockups and launch.
  const at = launched.length || video ? 4 : design.compositeKey ? 3 : 2;
  const steps = ["Idea", "Line art", "Colour", "Launch"];
  const enlarged = report?.sourcePx && report.widthPx / report.sourcePx > 1.5 ? report.widthPx / report.sourcePx : undefined;

  return (
    <div className="design-flow">
      <p className="small"><Link href="/studio">← Studio</Link></p>
      <ol className="stepper" aria-label="Steps">
        {steps.map((label, i) => (
          <li key={label} className={i + 1 < at ? "done" : i + 1 === at ? "on" : undefined} aria-current={i + 1 === at ? "step" : undefined}>{label}</li>
        ))}
      </ol>
      <h1>{design.title}</h1>
      <p className="small muted design-facts">
        {preset(design.preset).label} · {PLACEMENT_LABEL[options.placement ?? "front"]} · {options.detail === "detailed" ? "Detailed" : "Bold and clean"}
        {options.text && <> · “{options.text}”</>}
      </p>
      <details className="idea-full"><summary className="small muted">Your idea</summary><p className="small">{design.prompt}</p></details>

      {current && (
        <p className="notice">
          This design is in a campaign ({current.status.replace("_", " ")}), so it can&apos;t be changed now.
        </p>
      )}

      {/* Each step leads with the thing to do next; changing an earlier step is one tap away, not in the way. */}
      <h2>Line art</h2>
      {!design.compositeKey ? (
        <>
          <img className="art" src={fileUrl(design.lineArtKey!)} alt="Line art, as it looks in the shade" />
          <p className="small muted">This is how it looks in the shade. Next, the colours it shows in the sun.</p>
          {!current && (
            <ActionForm action={designStepAction} submit="Next: colour it in · 1 credit" pendingText="Colouring…" busy="Colouring it for the sun">
              {hidden}{step("colour")}
              <ColourChoices options={options} />
            </ActionForm>
          )}
        </>
      ) : (
        // After colouring, the line art stays in view beside the colour, so the two can be judged together.
        <div className="layer-pair">
          <figure><img className="art" src={fileUrl(design.lineArtKey!)} alt="Line art" /><figcaption className="small muted">Shade</figcaption></figure>
          <figure><img className="art" src={fileUrl(design.compositeKey)} alt="In the sun" /><figcaption className="small muted">Sun</figcaption></figure>
        </div>
      )}
      {!current && (
        <details className="step-change">
          <summary>{design.compositeKey ? "Change the line art" : "Not quite right? Change it"}</summary>
          <ActionForm action={designStepAction} submit="Redraw it · 1 credit" pendingText="Redrawing…" busy="Redrawing your line art">
            {hidden}{step("refine")}
            <label>What should change?<textarea name="instruction" required maxLength={400} placeholder="Make the lines bolder and simplify the background" /></label>
            <p className="small muted">Redrawing clears the colour and mockups.</p>
          </ActionForm>
        </details>
      )}

      {design.compositeKey && (
        <>
          <h2>Colour in the sun</h2>
          <ShadeSun shade={fileUrl(design.lineArtKey!)} sun={fileUrl(design.compositeKey)} alt={design.title} />
          <p className="small muted">Drag the sun across it: line art in the shade, colour in the sun.</p>
          {report && (
            <div className={`print-check ${report.ok ? "ok" : "bad"}`}>
              <b>{report.ok ? "✓ Ready to print" : "Needs changes before launch"}</b>
              <span className="small muted">
                {report.ok ? "Sharp at full shirt size." : ""}{enlarged && " Very fine detail can soften a little when it's enlarged; bold lines stay crisp."}
              </span>
              <details className="small muted"><summary>Print details</summary>
                {PRINT.fullColour ? "Full colour" : `${report.colours} of ${report.maxColours} colours`} · {report.widthPx}×{report.heightPx}px at {PRINT.dpi} dpi
                {enlarged && <>, enlarged {enlarged.toFixed(1)}× from the {report.sourcePx}px drawing</>}
              </details>
              {report.problems.length > 0 && <ul className="small">{report.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
          {!current && (
            // For designs coloured before the latest improvements to how layers are made: free, no AI.
            <details className="step-change">
              <summary>Update to our newest print look · free</summary>
              <ActionForm action={designStepAction} submit="Refresh it · free" pendingText="Refreshing…" busy="Refreshing your design">
                {hidden}{step("refresh")}
                <p className="small muted">Remakes the shade and sun views and mockups from the colours you have, with lines and colour lined up and grey shading indoors. No credit.</p>
              </ActionForm>
            </details>
          )}
          {!current && (
            <details className="step-change">
              <summary>Try different colours</summary>
              <ActionForm action={designStepAction} submit="Recolour · 1 credit" pendingText="Colouring…" busy="Recolouring it for the sun">
                {hidden}{step("colour")}
                <ColourChoices options={options} />
              </ActionForm>
            </details>
          )}
        </>
      )}

      {design.compositeKey && (
        <>
          <h2>Mockups and reveal video</h2>
          {options.placement === "back" && <p className="small muted">Shown at its size on a front view; it&apos;s printed on the back.</p>}
          {mockups.length > 0 && (
            <div className="grid">
              {video && <video className="art" src={fileUrl(video.key)} controls muted loop playsInline />}
              {mockups.map((m) => (
                <a key={m.id} href={fileUrl(m.key)} download><img className="art" src={thumbUrl(m.key)} alt={`${m.template} ${m.view}`} loading="lazy" decoding="async" /></a>
              ))}
            </div>
          )}
          {mockups.length ? (
            !current && (
              <details className="step-change">
                <summary>Remake the mockups</summary>
                <ActionForm action={designStepAction} submit="Remake them · free" pendingText="Rendering…">{hidden}{step("media")}</ActionForm>
              </details>
            )
          ) : (
            <ActionForm action={designStepAction} submit="Next: make mockups and video · free" pendingText="Rendering…" busy="Making your mockups and video">{hidden}{step("media")}</ActionForm>
          )}
        </>
      )}

      {video && report?.ok && (
        <>
          <h2>Launch it</h2>
          {current ? (
            <div className="card launched">
              <p><b>{current.status === "in_review" ? "Sent for review." : `Campaign ${current.status.replace("_", " ")}.`}</b></p>
              {current.status === "in_review" ? (
                <p className="small muted">
                  The team checks every design before it goes on pre-order. You&apos;ll get an email when it&apos;s approved, and it
                  goes live with its own page to share.
                </p>
              ) : (
                <p className="small"><Link href={`/c/${current.slug}`}>See its page and share it →</Link></p>
              )}
            </div>
          ) : atLimit ? (
            <p className="notice">
              You have {open.length} campaigns open, the most at a time. This one can launch when one of them ends.{" "}
              <Link href="/studio">See your campaigns</Link>
            </p>
          ) : (
            <div className="card">
              <p className="small muted">
                Sold in the UAE ({money(PREORDER_PRICE.AE.cents, PREORDER_PRICE.AE.currency)}) and the USA
                ({money(PREORDER_PRICE.US.cents, PREORDER_PRICE.US.currency)}) · sizes {SIZES[0]}–{SIZES[SIZES.length - 1]} · needs {FUNDING_GOAL} pre-orders
                in {CAMPAIGN_DAYS} days. Buyers are only charged once it reaches {FUNDING_GOAL}. The team reviews it before it goes live.
                You earn 10% of net sales, 15% through your own link. You can have {MAX_LIVE_CAMPAIGNS_PER_DESIGNER} campaigns open at a time.
              </p>
              <ActionForm action={designStepAction} submit="Send for review" pendingText="Sending…">
                {hidden}{step("launch")}
                <label>Campaign title<input name="title" defaultValue={design.title} required maxLength={60} /></label>
                <label>The story behind it
                  <textarea name="story" required maxLength={800} placeholder="What inspired it, and why it's best in the sun. A few sentences backers will read." />
                </label>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </div>
  );
}
