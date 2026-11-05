import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

// An S3-compatible bucket (Cloudflare R2, AWS S3) when S3_BUCKET is set, otherwise local disk in STORAGE_DIR.
// Either way files are served through /api/files, so links never change if storage moves.

function root() {
  return path.resolve(config().STORAGE_DIR);
}

function resolve(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error(`Bad storage key: ${key}`);
  return full;
}

const TYPES: Record<string, string> = { png: "image/png", mp4: "video/mp4", jpg: "image/jpeg", webp: "image/webp" };
export const contentType = (key: string) => TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";

let client: Promise<S3Client> | undefined;

function s3() {
  const c = config();
  client ??= import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region: c.S3_REGION,
        endpoint: c.S3_ENDPOINT || undefined,
        credentials: { accessKeyId: c.S3_ACCESS_KEY_ID!, secretAccessKey: c.S3_SECRET_ACCESS_KEY! },
        // Only send checksums S3 requires; some S3-compatible stores reject the SDK's optional ones.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
  );
  return client;
}

export async function put(prefix: string, ext: string, data: Buffer): Promise<string> {
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const bucket = config().S3_BUCKET;
  if (bucket) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType(key) }));
    return key;
  }
  const full = resolve(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function get(key: string): Promise<Buffer> {
  const bucket = config().S3_BUCKET;
  if (bucket) {
    if (key.split("/").includes("..")) throw new Error(`Bad storage key: ${key}`);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await s3()).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  return readFile(resolve(key));
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

// A smaller WebP of an image file, for grids and thumbnails on phones (the originals are print-sized PNGs).
export const THUMB_WIDTHS = [320, 640] as const;
export function thumbUrl(key: string, width: (typeof THUMB_WIDTHS)[number] = 640): string {
  return /\.(png|jpe?g|webp)$/i.test(key) ? `${fileUrl(key)}?w=${width}` : fileUrl(key);
}
