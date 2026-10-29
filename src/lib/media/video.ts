import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

// The shade-to-sun reveal: 2 s in the shade, a 3 s circular sun sweep, 3 s in full colour. 9:16, 1080x1920.

const SHADE_S = 2;
const SWEEP_S = 3;
const SUN_S = 3;

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // FFMPEG_PATH points at a system ffmpeg (the Docker image installs one).
    const bin = process.env.FFMPEG_PATH || ffmpegPath;
    if (!bin) return reject(new Error("ffmpeg binary not found"));
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-500)}`))));
  });
}

export async function revealVideo(shadeStory: Buffer, sunStory: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tc-reveal-"));
  try {
    const shade = path.join(dir, "shade.png");
    const sun = path.join(dir, "sun.png");
    const out = path.join(dir, "reveal.mp4");
    await writeFile(shade, shadeStory);
    await writeFile(sun, sunStory);
    const scale = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p";
    await run([
      "-y",
      "-loop", "1", "-t", String(SHADE_S + SWEEP_S), "-i", shade,
      "-loop", "1", "-t", String(SWEEP_S + SUN_S), "-i", sun,
      "-filter_complex",
      `[0]${scale}[a];[1]${scale}[b];[a][b]xfade=transition=circleopen:duration=${SWEEP_S}:offset=${SHADE_S}[v]`,
      "-map", "[v]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
