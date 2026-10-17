// Encodes recorded screencast frames into the site's clip formats: H.264 MP4, VP9 WebM and a JPG poster.
// Usage from a recorder: await framesToVideo(frames, master); await encodeClip(master, "website/media/<app>/<name>");
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const WIDTH = 1600;
const FPS = 30;

export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${args.join(" ")} exited ${code}: ${stderr}`))));
  });
}

/**
 * Turns timestamped frame images into a near-lossless constant-rate master video.
 * @param {{ file: string, timestamp: number }[]} frames absolute image paths, timestamps in seconds, ascending
 * @param {string} masterPath output path ending in .mkv
 * @param {number} [tailSeconds] how long the last frame stays on screen
 */
export async function framesToVideo(frames, masterPath, tailSeconds = 1) {
  if (frames.length === 0) throw new Error(`framesToVideo: no frames for ${masterPath}`);
  const lines = frames.flatMap((frame, i) => {
    const next = frames[i + 1]?.timestamp ?? frame.timestamp + tailSeconds;
    return [`file '${frame.file.replaceAll("'", "'\\''")}'`, `duration ${Math.max(next - frame.timestamp, 0.001).toFixed(4)}`];
  });
  // TRAP: the concat demuxer ignores the last entry's duration unless the file is listed once more.
  lines.push(`file '${frames.at(-1).file.replaceAll("'", "'\\''")}'`);
  const list = `${masterPath}.txt`;
  await mkdir(dirname(masterPath), { recursive: true });
  await writeFile(list, lines.join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${FPS},pad=ceil(iw/2)*2:ceil(ih/2)*2`, "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p", masterPath]);
}

/**
 * Writes `<outBase>.mp4`, `<outBase>.webm` and `<outBase>.jpg` at the site width from a master video.
 * @param {string} masterPath any video ffmpeg reads
 * @param {string} outBase output path without extension
 * @param {{ posterAt?: number }} [options] poster time in seconds
 */
export async function encodeClip(masterPath, outBase, { posterAt = 0 } = {}) {
  await mkdir(dirname(outBase), { recursive: true });
  const scale = `scale=${WIDTH}:-2:flags=lanczos,fps=${FPS}`;
  await ffmpeg(["-i", masterPath, "-vf", scale, "-an", "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${outBase}.mp4`]);
  await ffmpeg(["-i", masterPath, "-vf", scale, "-an", "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-row-mt", "1", "-deadline", "good", `${outBase}.webm`]);
  await ffmpeg(["-ss", String(posterAt), "-i", masterPath, "-frames:v", "1", "-vf", `scale=${WIDTH}:-2:flags=lanczos`, "-q:v", "3", `${outBase}.jpg`]);
}
