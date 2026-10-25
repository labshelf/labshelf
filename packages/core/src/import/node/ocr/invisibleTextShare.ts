// Measures how much of a page's text is drawn invisibly, which is how OCR tools lay text over a scan.
export interface OperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

// Text render modes that paint nothing: 3 is invisible, 7 adds to the clip only.
const INVISIBLE_MODES = new Set([3, 7]);

/**
 * Counts which share of a page's text-showing operators run in an invisible
 * render mode. The mode is graphics state, so it follows save/restore.
 * @returns A fraction from 0 to 1, or undefined when the page shows no text.
 */
export function deriveInvisibleShare(ops: OperatorList, OPS: Record<string, number>): number | undefined {
  const showText = new Set([OPS["showText"], OPS["showSpacedText"], OPS["nextLineShowText"], OPS["nextLineSetSpacingShowText"]]);
  const saved: number[] = [];
  let mode = 0;
  let runs = 0;
  let invisible = 0;
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === OPS["save"]) {
      saved.push(mode);
    } else if (fn === OPS["restore"]) {
      mode = saved.pop() ?? 0;
    } else if (fn === OPS["setTextRenderingMode"]) {
      mode = Number(ops.argsArray[i]?.[0] ?? 0);
    } else if (showText.has(fn)) {
      runs += 1;
      if (INVISIBLE_MODES.has(mode)) {
        invisible += 1;
      }
    }
  }
  return runs === 0 ? undefined : invisible / runs;
}
