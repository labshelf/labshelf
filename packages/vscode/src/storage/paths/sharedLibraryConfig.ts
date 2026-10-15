// Declares the config file the VS Code extension shares with the terminal app, so both open the same library.
import type { ILogger } from "@labshelf/core";

export interface SharedLibraryConfig {
  /** @returns the library root another app recorded, when there is one */
  readRoot(): Promise<string | undefined>;
  /** Records the root for the other apps; throws when the file cannot be written. */
  recordRoot(root: string, logger: ILogger): Promise<void>;
  /** @returns where the file lives, for log context */
  path(): string;
}
