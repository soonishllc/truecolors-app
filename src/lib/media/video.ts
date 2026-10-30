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

export async function revealVideo(shadeShot: Buffer, sunShot: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tc-reveal-"));
  try {
    const shade = path.join(dir, "shade.png");
    const sun = path.join(dir, "sun.png");
    const out = path.join(dir, "reveal.mp4");
    await writeFile(shade, shadeShot);
    await writeFile(sun, sunShot);
    // Fills the 9:16 frame, cropping the sides: a square flat lay becomes a close-up of the shirt's front.
    const scale = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p";
    await run([
      "-y",
      "-loop", "1", "-t", String(SHADE_S + SWEEP_S), "-i", shade,
      "-loop", "1", "-t", String(SWEEP_S + SUN_S), "-i", sun,
      "-filter_complex",
      `[0]${scale}[a];[1]${scale}[b];[a][b]xfade=transition=circleopen:duration=${SWEEP_S}:offset=${SHADE_S}[v]`,
      "-map", "[v]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Re-encodes a clip from an outside tool (often HEVC, which Chrome on Windows and Android can't play) as H.264 that
// plays everywhere, silent and ready to stream, at most `width` pixels wide.
export async function webVideo(clip: Buffer, width = 1080): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tc-web-"));
  try {
    const src = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    await writeFile(src, clip);
    await run([
      "-y", "-i", src, "-an",
      "-vf", `scale='min(${width},iw)':-2,format=yuv420p`,
      "-c:v", "libx264", "-profile:v", "high", "-crf", "23", "-preset", "slow", "-movflags", "+faststart", out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The card animation: the flat-lay shirt in the shade, then its print slowly fading into full colour, held at the
// end. 720x720, about 4.5 s. A plain dissolve: no light effects, so the colours are exactly the mockup's.
export async function fadeVideo(shadeShot: Buffer, sunShot: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "tc-fade-"));
  try {
    const shade = path.join(dir, "shade.png");
    const sun = path.join(dir, "sun.png");
    const out = path.join(dir, "fade.mp4");
    await writeFile(shade, shadeShot);
    await writeFile(sun, sunShot);
    const scale = "scale=720:720,setsar=1,fps=30,format=yuv420p";
    await run([
      "-y",
      "-loop", "1", "-t", "3", "-i", shade,
      "-loop", "1", "-t", "3.7", "-i", sun,
      "-filter_complex", `[0]${scale}[a];[1]${scale}[b];[a][b]xfade=transition=fade:duration=2.2:offset=0.8[v]`,
      "-map", "[v]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
