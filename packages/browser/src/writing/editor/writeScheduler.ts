// Saves a source file shortly after the last edit and on close, keeping it dirty while a write fails.
import { AUTO_SAVE_DELAY_MS, createDebouncer, type ILogger } from "@labshelf/core";

const MODULE = "editor.save";

export interface WriteSchedulerDeps {
  file: string;
  text(): string;
  write(text: string): Promise<void>;
  logger: ILogger;
  /** Runs when the file turns dirty or clean. */
  onDirty(dirty: boolean): void;
  /** Runs after each successful write. */
  onSaved(): void;
}

export interface WriteScheduler {
  /** Marks the file dirty and restarts the save delay. */
  changed(): void;
  /** Writes now when dirty; resolves whether the file is clean afterwards. */
  flush(): Promise<boolean>;
  dirty(): boolean;
}

export function createWriteScheduler(deps: WriteSchedulerDeps): WriteScheduler {
  let edits = 0;
  let savedEdits = 0;
  let writing: Promise<void> = Promise.resolve();
  const isDirty = (): boolean => edits !== savedEdits;
  const write = async (): Promise<void> => {
    const target = edits;
    if (target === savedEdits) return;
    try {
      await deps.write(deps.text());
      savedEdits = target;
      deps.onSaved();
      if (!isDirty()) deps.onDirty(false);
    } catch (error) {
      void deps.logger.error(MODULE, error, { action: "writeSource", file: deps.file });
    }
  };
  // INVARIANT: writes run one at a time, so an older text never lands after a newer one.
  const flush = async (): Promise<boolean> => {
    autosave.cancel();
    writing = writing.then(write);
    await writing;
    return !isDirty();
  };
  const autosave = createDebouncer(() => { void flush(); }, AUTO_SAVE_DELAY_MS);
  return {
    changed() {
      if (!isDirty()) deps.onDirty(true);
      edits += 1;
      autosave.call();
    },
    flush,
    dirty: isDirty,
  };
}
