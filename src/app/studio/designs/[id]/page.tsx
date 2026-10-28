import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { designStepAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { campaigns, designs, media } from "@/lib/db/schema";
import { PRINT } from "@/lib/rules";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const d = await db();
  const [design] = await d.select().from(designs).where(and(eq(designs.id, id), eq(designs.userId, user.id)));
  if (!design) notFound();
  const files = await d.select().from(media).where(eq(media.designId, id));
  const launched = await d.select().from(campaigns).where(eq(campaigns.designId, id));
  const video = files.find((m) => m.kind === "video");
  const mockups = files.filter((m) => m.kind === "mockup");
  const report = design.printReport;
  const step = (name: string) => <input type="hidden" name="step" value={name} />;
  const hidden = <input type="hidden" name="designId" value={id} />;

  return (
    <>
      <h1>{design.title}</h1>
      <p className="muted">{design.prompt}</p>

      <h2>1. Line art</h2>
      <div className="pair">
        <div>
          <img className="art" src={fileUrl(design.lineArtKey!)} alt="Line art, as it looks in the shade" />
          <p className="small muted">In the shade: only the black line art shows.</p>
        </div>
        <div className="card">
          <ActionForm action={designStepAction} submit="Change it (1 credit)" pendingText="Redrawing…">
            {hidden}{step("refine")}
            <label>What should change?<textarea name="instruction" required maxLength={400} placeholder="Make the palm trees bigger and add a crescent moon" /></label>
            <p className="small muted">Changing the line art clears the colour and mockups.</p>
          </ActionForm>
        </div>
      </div>

      <h2>2. Colour in the sun</h2>
      {design.compositeKey ? (
        <div className="pair">
          <div>
            <img className="art" src={fileUrl(design.compositeKey)} alt="Design in full colour, as it looks in the sun" />
            <p className="small muted">In the sun: the SolarShift colours appear.</p>
          </div>
          <div className="card">
            <h3>Print check</h3>
            {report && (
              <>
                <p className={report.ok ? "good" : "error"}>{report.ok ? "Ready to print." : "Needs changes before launch."}</p>
                <p className="small">{report.colours} of {report.maxColours} colours · {report.widthPx}×{report.heightPx}px at {PRINT.dpi} dpi ({PRINT.widthIn}×{PRINT.heightIn} in max)</p>
                <ul className="small">{report.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </>
            )}
            <ActionForm action={designStepAction} submit="Recolour (1 credit)" pendingText="Colouring…">{hidden}{step("colour")}</ActionForm>
          </div>
        </div>
      ) : (
        <ActionForm action={designStepAction} submit="Colour it in (1 credit)" pendingText="Colouring… up to a minute">{hidden}{step("colour")}</ActionForm>
      )}

      {design.compositeKey && (
        <>
          <h2>3. Mockups and reveal video</h2>
          {mockups.length > 0 && (
            <div className="grid">
              {video && <video className="art" src={fileUrl(video.key)} controls muted loop playsInline />}
              {mockups.map((m) => (
                <a key={m.id} href={fileUrl(m.key)} download><img className="art" src={fileUrl(m.key)} alt={`${m.template} ${m.view}`} /></a>
              ))}
            </div>
          )}
          <ActionForm action={designStepAction} className="row" submit={mockups.length ? "Remake mockups" : "Make mockups and video (free)"} pendingText="Rendering…">{hidden}{step("media")}</ActionForm>
        </>
      )}

      {video && report?.ok && (
        <>
          <h2>4. Launch a campaign</h2>
          {launched.length > 0 ? (
            <p>Campaign status: <span className="badge">{launched[launched.length - 1].status.replace("_", " ")}</span></p>
          ) : (
            <div className="card">
              <p className="small muted">
                US only · $36 a shirt · sizes S–XL · needs 100 pre-orders in 21 days. Buyers are only charged once it
                reaches 100. You earn 10% of net sales, 15% through your own link.
              </p>
              <ActionForm action={designStepAction} submit="Send for review" pendingText="Sending…">
                {hidden}{step("launch")}
                <label>Campaign title<input name="title" defaultValue={design.title} required maxLength={60} /></label>
                <label>The story behind it<textarea name="story" required maxLength={800} /></label>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </>
  );
}
