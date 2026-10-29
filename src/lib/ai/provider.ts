import { config } from "../config";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";

export type Moderation = { flagged: boolean; categories: string[] };

export interface ImageProvider {
  name: string;
  // Black line art on white, PNG.
  // refs: style reference images (URLs) to draw from, for presets based on the store's shirts.
  lineArt(prompt: string, userId: string, refs?: string[]): Promise<Buffer>;
  // A designer's sketch (photo or scan) redrawn as line art like lineArt's.
  fromSketch(sketch: Buffer, prompt: string, userId: string): Promise<Buffer>;
  // Same line art coloured in, PNG, same size as the input.
  colour(lineArt: Buffer, prompt: string, userId: string): Promise<Buffer>;
  refine(lineArt: Buffer, prompt: string, userId: string): Promise<Buffer>;
  moderateText(text: string): Promise<Moderation>;
  moderateImage(png: Buffer): Promise<Moderation>;
}

export function imageProvider(): ImageProvider {
  return config().AI_PROVIDER === "openai" ? openaiProvider() : mockProvider;
}
