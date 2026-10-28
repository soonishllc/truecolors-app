import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

// Local disk for Phase 1; swap for S3-compatible storage by keeping these three functions.

function root() {
  return path.resolve(config().STORAGE_DIR);
}

function resolve(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error(`Bad storage key: ${key}`);
  return full;
}

export async function put(prefix: string, ext: string, data: Buffer): Promise<string> {
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const full = resolve(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function get(key: string): Promise<Buffer> {
  return readFile(resolve(key));
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

export function localPath(key: string): string {
  return resolve(key);
}
