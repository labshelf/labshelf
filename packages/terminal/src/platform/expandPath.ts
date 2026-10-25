/** Expands the ~ the user types in paths to their home directory. */
import * as os from "node:os";

/**
 * Expands a leading ~ to the home directory and leaves the rest as typed, so a trailing slash survives for completion.
 * @returns the expanded path
 */
export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, os.homedir());
}
