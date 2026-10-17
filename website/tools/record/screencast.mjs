// Records a page's CDP screencast into timestamped JPG frames on disk, for encode.mjs's framesToVideo.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Starts a screencast of `page` and returns its frame list, which grows until `stop()` resolves.
 * @param {import("playwright-core").Page} page
 * @param {string} framesDir where frame files are written
 * @param {string} prefix file name prefix, unique per recorded page
 * @param {{ width: number, height: number }} size device pixels
 */
export async function startScreencast(page, framesDir, prefix, size) {
  const session = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(framesDir, `${prefix}-${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ file, timestamp: metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(data, "base64")));
    void session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      // PLATFORM: a page that closed itself (the popup calls window.close) has no session left to stop.
      await session.send("Page.stopScreencast").catch(() => undefined);
      await Promise.all(writes);
      // The screencast sends frames only on change; the last one is held until the moment recording stops.
      if (frames.length > 0) frames.push({ file: frames.at(-1).file, timestamp: Date.now() / 1000 });
      return frames;
    },
  };
}
