// Keeps the reader's note edits the host has not acknowledged yet, so an editor never takes an older stored body over them.
import { sameItemBody } from "../../qmd/item/index.js";
import type { ReaderNote } from "../protocol/index.js";
import type { ReaderContext } from "./readerSession.js";

export class NoteDrafts {
  private readonly bodies = new Map<string, string>();

  constructor(private readonly host: ReaderContext["host"]) {}

  /** The unacknowledged bodies by note id, for the cell runs' bodies-before. */
  get map(): ReadonlyMap<string, string> { return this.bodies; }

  get(id: string): string | undefined { return this.bodies.get(id); }

  has(id: string): boolean { return this.bodies.has(id); }

  delete(id: string): void { this.bodies.delete(id); }

  /** Records an edit of note `id` and sends it to the host. */
  save(id: string, body: string): void {
    this.bodies.set(id, body);
    this.host.post({ command: "editNote", id, body });
  }

  /** Drops the drafts the stored notes acknowledge, or whose note is gone. */
  settle(notes: readonly ReaderNote[]): void {
    for (const [id, body] of this.bodies) {
      const stored = notes.find((note) => note.id === id);
      if (!stored || sameItemBody(stored.body, body)) { this.bodies.delete(id); }
    }
  }

  /** Whether an open editor of note `id` showing `shown` must take the stored body: it differs and the editor holds no unacknowledged edit. */
  takesStored(id: string, shown: string, stored: string): boolean {
    return !this.bodies.has(id) && !sameItemBody(shown, stored);
  }
}
