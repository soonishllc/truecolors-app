import { registerPushToken } from "@/lib/push";

// The app sends its Expo push token here with the ticket from the designer's studio page (lib/push.ts).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string; platform?: string; ticket?: string };
    await registerPushToken({ token: String(body.token ?? ""), platform: String(body.platform ?? ""), ticket: String(body.ticket ?? "") });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
