// Reads the newest context size from the tail of a transcript without parsing the whole file.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { contextOf } from './budgets.mjs';

const TAIL_BYTES = 256 * 1024;

// Returns the context size of the last assistant turn found in the tail, or undefined.
export function latestContext(path, tailBytes = TAIL_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    // The first line of a mid-file tail is cut off; only a tail that starts at byte 0 keeps it.
    if (start > 0) lines.shift();
    for (const line of lines.reverse()) {
      if (!line.includes('"cache_read_input_tokens"') || !line.includes('"type":"assistant"')) continue;
      try {
        const usage = JSON.parse(line).message?.usage;
        if (usage) return contextOf(usage);
      } catch {
        // A line still being written is skipped; the previous turn answers instead.
      }
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}
