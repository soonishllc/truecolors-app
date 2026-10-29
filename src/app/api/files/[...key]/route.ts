import { contentType, get } from "@/lib/storage";

// Files are named by random UUIDs, so a link is the only way to reach one.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  try {
    const body = await get(key);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType(key),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
