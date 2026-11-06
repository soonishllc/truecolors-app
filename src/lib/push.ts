import { eq, inArray } from "drizzle-orm";
import { seal, unseal } from "./auth/session";
import { db } from "./db/client";
import { pushTokens } from "./db/schema";
import { publicUrl } from "./links";

// Push notifications to designers' phones, through Expo's push service (the app is built with Expo). A phone
// registers by sending its Expo token with a ticket from the designer's studio page, so we know whose it is
// without the app holding the site's session. Every push mirrors an email that has just gone out for the first
// time (lib/campaigns/designer-emails.ts), so each one is sent once.

const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

// A short-lived proof that the page asking for notifications belongs to this designer.
export const pushTicket = (userId: string) => seal({ push: userId }, 30);

export async function registerPushToken(input: { token: string; platform: string; ticket: string }) {
  const who = unseal<{ push: string }>(input.ticket);
  if (!who?.push) throw new Error("This page has expired: open your studio again.");
  if (!/^Expo(nent)?PushToken\[[\w-]+\]$/.test(input.token)) throw new Error("Not a push token");
  const platform = input.platform === "android" ? "android" : "ios";
  const d = await db();
  await d.insert(pushTokens).values({ token: input.token, userId: who.push, platform })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId: who.push, platform } });
}

export async function hasPushToken(userId: string) {
  const d = await db();
  return (await d.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId)).limit(1)).length > 0;
}

// `path` is an app page ("/studio", "/c/<slug>"): tapping the notification opens it in the app.
export async function pushToUser(userId: string, message: { title: string; body: string; path: string }) {
  try {
    const d = await db();
    const tokens = (await d.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId))).map((r) => r.token);
    if (!tokens.length) return;
    const res = await fetch(EXPO_PUSH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title: message.title, body: message.body, sound: "default", data: { url: publicUrl(message.path) } }))),
    });
    if (!res.ok) throw new Error(`Expo push ${res.status}: ${await res.text()}`);
    // A phone that uninstalled the app, or turned notifications off for good: forget it.
    const { data } = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
    const gone = tokens.filter((_, i) => data[i]?.details?.error === "DeviceNotRegistered");
    if (gone.length) await d.delete(pushTokens).where(inArray(pushTokens.token, gone));
  } catch (e) {
    console.error("[push]", (e as Error).message);
  }
}
