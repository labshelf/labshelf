// Picks biber's error messages out of its log (.blg), which latexmk does not report itself.

const ERROR_LINE = /^(?:\[\d+\] [^>]*> )?ERROR - (.+)$/;

export function extractBiberErrors(blg: string): string[] {
  return blg.split(/\r?\n/).flatMap((line) => {
    const message = ERROR_LINE.exec(line.trim())?.[1];
    return message === undefined ? [] : [message];
  });
}
