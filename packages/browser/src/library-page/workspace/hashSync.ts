// Keeps the page URL hash and the session copy of it in step with the open tabs.
import type { EditorTabInfo } from "@labshelf/core/dom";
import { formatWorkspaceHash, isFolderHash } from "./workspaceHash";

const STORED_HASH_KEY = "labshelf.library.tabs";

export type HashStorage = Pick<Storage, "getItem" | "setItem">;

export interface HashSync {
  write(): void;
  /** The tabs hash the session kept, or null. */
  stored(): string | null;
  isQuiet(): boolean;
  /** Runs `fn` with the hash left alone: a restore writes once at its end, and a hash change must not rewrite the hash it answers. */
  silently(fn: () => void): void;
}

export function createHashSync(tabs: () => EditorTabInfo[], storage: HashStorage): HashSync {
  let quiet = false;
  return {
    write() {
      if (quiet) return;
      const open = tabs();
      const next = formatWorkspaceHash({ tabs: open.map((t) => t.id), active: open.find((t) => t.focused)?.id ?? null });
      try { storage.setItem(STORED_HASH_KEY, next); } catch { /* storage unavailable: the hash alone carries the tabs */ }
      if (location.hash === next) return;
      // A folder deep link is a history entry the user can come back to; a tabs hash is replaced in place.
      if (isFolderHash(location.hash)) history.pushState(null, "", next);
      else history.replaceState(null, "", next);
    },
    stored() {
      try { return storage.getItem(STORED_HASH_KEY); } catch { return null; }
    },
    isQuiet: () => quiet,
    silently(fn) {
      const was = quiet;
      quiet = true;
      try { fn(); } finally { quiet = was; }
    },
  };
}
