// Composites the popup recording over the top-right corner of the page recording, where a toolbar popup drops down.
import { ffmpeg } from "../encode.mjs";

const MARGIN = 24;
const BORDER = 2;
const BORDER_COLOR = "0x454545";


/**
 * Writes `outPath` (.mkv): the page master with the popup master on top between `from` and `until` seconds.
 * @param {{ page: string, popup: string, outPath: string, from: number, until: number }} clip
 */
export function overlayPopup({ page, popup, outPath, from, until }) {
  const filter = [
    `[1:v]pad=iw+${2 * BORDER}:ih+${2 * BORDER}:${BORDER}:${BORDER}:color=${BORDER_COLOR},setpts=PTS-STARTPTS+${from}/TB[pop]`,
    `[0:v][pop]overlay=x=W-w-${MARGIN}:y=${MARGIN}:eof_action=pass:enable='between(t,${from},${until})'`,
  ].join(";");
  return ffmpeg(["-i", page, "-i", popup, "-filter_complex", filter, "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p", outPath]);
}
