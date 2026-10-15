// Declares the config file that stores the library root, shared with the terminal app so both open the same library.
import type { ILogger } from "@labshelf/core";

export interface SharedLibraryConfig {
  /** @returns the recorded library root, when there is one */
  readRoot(): Promise<string | undefined>;
  /** Records the root for every app; throws when the file cannot be written. */
  recordRoot(root: string, logger?: ILogger): Promise<void>;
  /** @returns where the file lives, for log context */
  path(): string;
}
