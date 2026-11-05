import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { campaigns, media, pledges, users } from "../db/schema";
import { sendEmail } from "../email";
import { publicUrl } from "../links";
import { fileUrl } from "../storage";
import { config } from "../config";

// What the designer hears while their campaign runs: that it's live (with everything to share), each of their first
// backers, a daily tally while people are backing it, the last two days, and how it ended. These bring designers
// back to share again, which is what gets a campaign to its goal. Each email has a key, so it goes once.

type Campaign = typeof campaigns.$inferSelect;
const DAY = 24 * 3600_000;
// Each of the first few backers gets its own email; after that, the daily tally.
const FIRST_BACKERS = 3;
const COUNTING = ["pledged", "charge_pending", "charged", "charge_failed"] as const;

async function designerOf(c: Campaign) {
  const [u] = await (await db()).select().from(users).where(eq(users.id, c.userId));
  return u;
}

const firstName = (name: string) => name.split(" ")[0];
const ownLink = (c: Campaign, handle: string) => `${publicUrl(`/c/${c.slug}`)}?ref=${encodeURIComponent(handle)}`;
const studio = () => publicUrl("/studio");

export async function designerLive(c: Campaign) {
  const u = await designerOf(c);
  if (!u?.email) return;
  const [video] = await (await db()).select().from(media).where(and(eq(media.designId, c.designId), eq(media.kind, "video")));
  const link = ownLink(c, u.handle);
  await sendEmail({
    to: u.email,
    key: `designer-live:${c.id}`,
    subject: `${c.title} is live: here's your kit`,
    body:
      `${firstName(u.name)}, ${c.title} is on pre-order now. It needs ${c.goal} pre-orders` +
      `${c.endsAt ? ` by ${c.endsAt.toDateString()}` : ""}. Nobody pays unless it gets there.\n\n` +
      `Your link (you earn 15% of every sale through it, 10% on the rest):\n${link}\n\n` +
      (video ? `Your reveal video, to post as a story or reel:\n${config().APP_URL}${fileUrl(video.key)}\n\n` : "") +
      `Three captions to start from:\n` +
      `1. Indoors it's black and white. Step into the sun 👀 Pre-order ${c.title}: ${link}\n` +
      `2. I designed a shirt that changes colour in the sun. If ${c.goal} people want it, it gets printed. Be one: ${link}\n` +
      `3. Numbered edition, first backers get the lowest numbers. ${c.title} ☀️ ${link}\n\n` +
      `The first two days matter most: share it today, then again when you hear it's halfway.`,
  });
}

export async function designerRejected(c: Campaign, note: string) {
  const u = await designerOf(c);
  if (!u?.email) return;
  await sendEmail({
    to: u.email,
    key: `designer-rejected:${c.id}`,
    subject: `${c.title} needs changes before it goes live`,
    body:
      `${firstName(u.name)}, thanks for sending ${c.title}. It can't go on pre-order as it is` +
      `${note ? `:\n\n${note}\n\n` : ". "}` +
      `You can change the design and send it again from your studio:\n${studio()}`,
  });
}

// After an order arrives: one email for each of the first few backers.
export async function designerBacked(c: Campaign, city: string | null) {
  const d = await db();
  const [{ n }] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(pledges)
    .where(and(eq(pledges.campaignId, c.id), inArray(pledges.status, [...COUNTING])));
  if (n > FIRST_BACKERS) return;
  const u = await designerOf(c);
  if (!u?.email) return;
  await sendEmail({
    to: u.email,
    key: `designer-backer:${c.id}:${n}`,
    subject: n === 1 ? `Your first backer for ${c.title}!` : `Backer ${n} for ${c.title}`,
    body:
      `Someone${city ? ` in ${city}` : ""} just pre-ordered ${c.title}. ` +
      (n === 1 ? "That's the hardest one done. " : "") +
      `Share it again while it's moving:\n${ownLink(c, u.handle)}`,
  });
}

// Run by the tick for each live campaign: a daily tally on days people backed it, and a nudge with two days left.
export async function designerUpdates(c: Campaign, now: Date) {
  if (c.status !== "live") return;
  const u = await designerOf(c);
  if (!u?.email) return;
  const d = await db();
  const [{ total, today }] = await d
    .select({
      total: sql<number>`coalesce(sum(${pledges.quantity}), 0)::int`,
      today: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.createdAt} >= ${new Date(now.getTime() - DAY)}), 0)::int`,
    })
    .from(pledges)
    .where(and(eq(pledges.campaignId, c.id), inArray(pledges.status, [...COUNTING]), gte(pledges.createdAt, c.startsAt ?? new Date(0))));
  const left = c.goal - total;
  const daysLeft = c.endsAt ? Math.max(0, Math.ceil((c.endsAt.getTime() - now.getTime()) / DAY)) : undefined;
  const link = ownLink(c, u.handle);

  if (today > 0 && total > FIRST_BACKERS) {
    await sendEmail({
      to: u.email,
      key: `designer-daily:${c.id}:${now.toISOString().slice(0, 10)}`,
      subject: `${c.title}: ${today} more today, ${total} of ${c.goal}`,
      body:
        `${today} new pre-order${today === 1 ? "" : "s"} in the last day. ${c.title} is at ${total} of ${c.goal}` +
        `${left > 0 ? `, ${left} to go` : ", goal reached"}${daysLeft !== undefined ? ` with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}.\n\n` +
        `Your link: ${link}`,
    });
  }
  if (c.endsAt && c.endsAt.getTime() - now.getTime() <= 2 * DAY && left > 0) {
    await sendEmail({
      to: u.email,
      key: `designer-48h:${c.id}`,
      subject: `48 hours left: ${c.title} needs ${left} more`,
      body:
        `${c.title} closes ${c.endsAt.toDateString()} and is ${left} pre-order${left === 1 ? "" : "s"} short. If it doesn't make it, ` +
        `nobody pays and it isn't printed. This is the moment to post again: a story with your reveal video works best.\n\n${link}`,
    });
  }
}

export async function designerFunded(c: Campaign, editionSize: number) {
  const u = await designerOf(c);
  if (!u?.email) return;
  await sendEmail({
    to: u.email,
    key: `designer-funded:${c.id}`,
    subject: `${c.title} is going to print 🎉`,
    body:
      `${firstName(u.name)}, ${c.title} closed with ${editionSize} shirts. It goes to print in Cancún now, and your ` +
      `earnings show in your studio as the shirts ship:\n${studio()}\n\nThank your backers: they'll get their edition numbers by email.`,
  });
}

export async function designerMissed(c: Campaign, pledged: number, comeback: number) {
  const u = await designerOf(c);
  if (!u?.email) return;
  await sendEmail({
    to: u.email,
    key: `designer-missed:${c.id}`,
    subject: `${c.title} missed by ${c.goal - pledged}: bring it back?`,
    body:
      `${c.title} ended with ${pledged} of ${c.goal} pre-orders, so it won't be printed this time and nobody was charged.\n\n` +
      `${comeback ? `${comeback} people will hear the moment it comes back. ` : ""}You can relaunch it in one tap from your studio, ` +
      `and everyone who backed it or asked will get an email when it's live again:\n${studio()}`,
  });
}
