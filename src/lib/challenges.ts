import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { campaigns, challengeEntries, challenges, designs, users, votes } from "./db/schema";
import { UserError } from "./design/service";
import { CHALLENGE_ENTRIES_PER_DESIGNER } from "./rules";

// Themed design challenges. Designers enter until submitBy; fans vote until voteBy; the top design wins the prize.

export type Challenge = typeof challenges.$inferSelect;
export type Phase = "open" | "voting" | "closed";

export function phase(ch: Challenge, now = new Date()): Phase {
  if (now < ch.submitBy) return "open";
  if (now < ch.voteBy) return "voting";
  return "closed";
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "challenge";

export async function createChallenge(input: { title: string; brief: string; prize: string; submitBy: Date; voteBy: Date }) {
  if (!input.title || !input.brief) throw new UserError("Give the challenge a title and a brief.");
  if (Number.isNaN(input.submitBy.getTime()) || Number.isNaN(input.voteBy.getTime())) throw new UserError("Set both dates.");
  if (input.voteBy <= input.submitBy) throw new UserError("Voting has to end after entries close.");
  const d = await db();
  let slug = slugify(input.title);
  for (let n = 2; (await d.select().from(challenges).where(eq(challenges.slug, slug))).length; n++) slug = `${slugify(input.title)}-${n}`;
  const [ch] = await d.insert(challenges).values({ ...input, slug }).returning();
  return ch;
}

export async function listChallenges() {
  const d = await db();
  return d.select().from(challenges).orderBy(desc(challenges.voteBy));
}

export async function challengeBySlug(slug: string) {
  const d = await db();
  const [ch] = await d.select().from(challenges).where(eq(challenges.slug, slug));
  return ch;
}

export async function enterChallenge(userId: string, challengeId: string, designId: string, now = new Date()) {
  const d = await db();
  const [ch] = await d.select().from(challenges).where(eq(challenges.id, challengeId));
  if (!ch || phase(ch, now) !== "open") throw new UserError("This challenge isn't taking entries.");
  const [design] = await d.select().from(designs).where(and(eq(designs.id, designId), eq(designs.userId, userId)));
  if (!design?.compositeKey) throw new UserError("Colour the design before you enter it.");
  const mine = await d
    .select({ id: challengeEntries.id })
    .from(challengeEntries)
    .where(and(eq(challengeEntries.challengeId, challengeId), eq(challengeEntries.userId, userId)));
  if (mine.length >= CHALLENGE_ENTRIES_PER_DESIGNER) {
    throw new UserError(`You can enter ${CHALLENGE_ENTRIES_PER_DESIGNER} designs in a challenge.`);
  }
  await d.insert(challengeEntries).values({ challengeId, designId, userId }).onConflictDoNothing();
}

// One vote per fan per design; voting again takes it back.
export async function toggleVote(fanId: string, entryId: string, now = new Date()) {
  const d = await db();
  const [row] = await d
    .select({ ch: challenges })
    .from(challengeEntries)
    .innerJoin(challenges, eq(challenges.id, challengeEntries.challengeId))
    .where(eq(challengeEntries.id, entryId));
  if (!row || phase(row.ch, now) === "closed") throw new UserError("Voting has closed.");
  const removed = await d
    .delete(votes)
    .where(and(eq(votes.entryId, entryId), eq(votes.fanId, fanId)))
    .returning();
  if (!removed.length) await d.insert(votes).values({ entryId, fanId });
  return row.ch.slug;
}

// Entries with their vote counts, most votes first. myVotes are the entries this fan has voted for.
export async function entries(challengeId: string, fanId?: string) {
  const d = await db();
  const rows = await d
    .select({
      id: challengeEntries.id,
      designId: challengeEntries.designId,
      title: designs.title,
      lineArt: designs.lineArtKey,
      art: designs.compositeKey,
      designer: users.name,
      handle: users.handle,
      votes: sql<number>`(select count(*) from ${votes} where ${votes.entryId} = ${challengeEntries.id})::int`,
      // The design's public campaign, if it has one, so fans can go straight to it.
      campaignSlug: sql<string | null>`(select ${campaigns.slug} from ${campaigns} where ${campaigns.designId} = ${challengeEntries.designId}
        and ${campaigns.status} in ('live', 'closing', 'funded', 'in_production', 'shipped') order by ${campaigns.createdAt} desc limit 1)`,
      campaignLive: sql<boolean>`exists (select 1 from ${campaigns} where ${campaigns.designId} = ${challengeEntries.designId} and ${campaigns.status} = 'live')`,
      mine: fanId
        ? sql<boolean>`exists (select 1 from ${votes} where ${votes.entryId} = ${challengeEntries.id} and ${votes.fanId} = ${fanId})`
        : sql<boolean>`false`,
    })
    .from(challengeEntries)
    .innerJoin(designs, eq(designs.id, challengeEntries.designId))
    .innerJoin(users, eq(users.id, challengeEntries.userId))
    .where(eq(challengeEntries.challengeId, challengeId));
  return rows.sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));
}
