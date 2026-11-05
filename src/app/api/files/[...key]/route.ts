import sharp from "sharp";
import { THUMB_WIDTHS, contentType, get } from "@/lib/storage";

// Files are named by random UUIDs, so a link is the only way to reach one. Byte ranges are served because iPhones
// won't play a video without them.
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  let body: Buffer;
  try {
    body = await get(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // ?w=320|640 on an image: a WebP that size, for phone grids. Only those widths, so it can't be used to churn CPU.
  const w = Number(new URL(req.url).searchParams.get("w"));
  if ((THUMB_WIDTHS as readonly number[]).includes(w) && /\.(png|jpe?g|webp)$/i.test(key)) {
    const small = await sharp(body).resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return new Response(new Uint8Array(small), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }
  const headers = {
    "Content-Type": contentType(key),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = body.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(body.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(body), { headers: { ...headers, "Content-Length": String(body.length) } });
}
