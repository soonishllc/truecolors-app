import Link from "next/link";
import { createDesignAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { CountedText, SketchPicker } from "@/components/SketchPicker";
import { PRESETS } from "@/lib/ai/presets";
import { requireUser } from "@/lib/auth/session";
import { CREDIT_COST } from "@/lib/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "New design · Truecolors" };

// Step 1 of a design, on its own screen: the idea first (and a sketch if there is one), then the exact words, a
// style, where it's printed and how detailed. The AI draws the line art and the design opens at step 2.
export default async function NewDesign() {
  const user = await requireUser();
  const enough = user.credits >= CREDIT_COST.line_art;
  const groups = [...new Set(PRESETS.map((p) => p.group))];
  return (
    <div className="design-flow">
      <p className="small"><Link href="/studio">← Studio</Link></p>
      <ol className="stepper" aria-label="Steps">
        <li className="on">Idea</li><li>Line art</li><li>Colour</li><li>Launch</li>
      </ol>
      <h1>What should we draw?</h1>
      <p className="muted">
        One idea per shirt. The AI draws it as black line art that shows in the shade; you&apos;ll add the sun&apos;s colours next.
      </p>
      <ActionForm
        action={createDesignAction} submit={`Draw it · ${CREDIT_COST.line_art} credit`} pendingText="Drawing…"
        busy="Drawing your line art"
      >
        <label>Your idea
          <CountedText name="idea" max={600} rows={4} required placeholder="A sea turtle gliding over a coral reef, with sunbeams from above" />
        </label>
        <SketchPicker />
        <label><span>Words on the shirt <span className="muted small">(optional)</span></span>
          <input name="text" maxLength={60} placeholder="WAIT FOR THE SUN" autoComplete="off" />
          <span className="small muted">Typed exactly as you want them spelled. Leave empty for no words.</span>
        </label>

        <fieldset className="style-cards">
          <legend>Style</legend>
          {groups.map((g) => (
            <div key={g} className="style-group">
              <div className="eyebrow">{g}</div>
              <div className="style-grid">
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <label key={p.id} className="style-card">
                    <input type="radio" name="preset" value={p.id} defaultChecked={p.id === "classic"} />
                    <b>{p.label}</b>
                    <span className="small muted">{p.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset className="segmented">
          <legend>Where it&apos;s printed</legend>
          <label><input type="radio" name="placement" value="front" defaultChecked /><span>Front</span></label>
          <label><input type="radio" name="placement" value="back" /><span>Back</span></label>
          <label><input type="radio" name="placement" value="chest" /><span>Left chest</span></label>
        </fieldset>
        <fieldset className="segmented">
          <legend>Detail</legend>
          <label><input type="radio" name="detail" value="bold" defaultChecked /><span>Bold and clean</span></label>
          <label><input type="radio" name="detail" value="detailed" /><span>Detailed</span></label>
        </fieldset>
        <p className="small muted">Bold and clean prints crisply and leaves room for the sun&apos;s colours. Detailed suits intricate illustration.</p>

        <label>Name it<input name="title" required maxLength={60} placeholder="Reef Turtle" /></label>
        <p className="small muted">No brands, logos, celebrities, real people or political figures.</p>
      </ActionForm>
      <p className={`small ${enough ? "muted" : "error"}`}>
        {enough ? `You have ${user.credits} credits.` : "You're out of credits. Message us and we'll top you up."}
      </p>
    </div>
  );
}
