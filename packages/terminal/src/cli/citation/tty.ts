// Opens the controlling terminal as separate input and output streams, so the picker never touches stdin or stdout.
import * as fs from "node:fs";
import * as tty from "node:tty";

import { UsageError } from "../usage.js";

/** The terminal the picker uses; `close` releases the descriptors. */
export interface CitationTty {
  input: tty.ReadStream;
  output: tty.WriteStream;
  close(): void;
}

/**
 * @throws UsageError when the process has no controlling terminal (cron, CI)
 */
export function openDevTty(): CitationTty {
  let readFd: number | undefined;
  let writeFd: number | undefined;
  try {
    readFd = fs.openSync("/dev/tty", "r");
    writeFd = fs.openSync("/dev/tty", "w");
  } catch (error) {
    for (const fd of [readFd, writeFd]) { if (fd !== undefined) { fs.closeSync(fd); } }
    throw new UsageError(`cite needs a terminal to pick a paper: /dev/tty cannot be opened (${(error as Error).message}).`);
  }
  const input = new tty.ReadStream(readFd);
  const output = new tty.WriteStream(writeFd);
  // Destroying a stream closes its descriptor.
  return { input, output, close: () => { input.destroy(); output.destroy(); } };
}
