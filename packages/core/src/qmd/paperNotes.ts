// Reads and edits the items of one paper's notes.qmd through an injected file port, one queued load-modify-save at a time.
// CONTRACT: documents/contracts/library-format.md#layout
import { KeyedQueue } from "../async/index.js";
import type { ILogger } from "../ports/index.js";
import {
  addItem,
  extractLineContent,
  extractLineEnding,
  formatAnchor,
  formatDivOpener,
  newItemId,
  parseAnchor,
  parseDivOpener,
  parseItemFile,
  removeItem,
  serializeItemFile,
  setItemBody,
  type ItemAnchor,
  type ItemFile,
  type ItemSegment,
} from "./item/index.js";

export interface PaperNotesPort {
  /** The notes.qmd text, or null when the paper has none yet. */
  read(paperId: string): Promise<string | null>;
  write(paperId: string, text: string): Promise<void>;
}

export interface PaperNotesStoreOptions {
  /** Receives every write failure. */
  logger?: ILogger;
  newId?: () => string;
  now?: () => string;
}

export interface NewPaperNote {
  anchor?: ItemAnchor;
  body: string;
  author?: string;
  /** Defaults to the current time. */
  created?: string;
  /** Extra attributes kept on the opening line, after the known ones. */
  attrs?: readonly (readonly [string, string])[];
}

/**
 * Load-modify-save over one notes.qmd per paper. Every mutator of a paper runs in a per-paper queue, so two adds
 * racing on one paper both land; a failed write neither poisons the queue nor changes the file.
 */
export class PaperNotesStore {
  private readonly queue = new KeyedQueue();
  private readonly newId: () => string;
  private readonly now: () => string;
  private readonly logger: ILogger | undefined;

  constructor(private readonly port: PaperNotesPort, options: PaperNotesStoreOptions = {}) {
    this.newId = options.newId ?? newItemId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.logger = options.logger;
  }

  /** @returns the parsed notes file; a missing file reads as an empty one. */
  async read(paperId: string): Promise<ItemFile> {
    const text = await this.port.read(paperId);
    return parseItemFile(text ?? "");
  }

  private mutate<T>(paperId: string, change: (file: ItemFile) => { file: ItemFile; result: T }): Promise<T> {
    return this.queue.run(paperId, async () => {
      const { file, result } = change(await this.read(paperId));
      try {
        await this.port.write(paperId, serializeItemFile(file));
      } catch (error) {
        void this.logger?.error("paperNotes", error, { paperId });
        throw error;
      }
      return result;
    });
  }

  /** @returns the id of the new item. */
  addItem(paperId: string, input: NewPaperNote): Promise<string> {
    return this.mutate(paperId, (file) => {
      const id = this.newId();
      let next = addItem(file, {
        id,
        body: input.body,
        created: input.created ?? this.now(),
        ...(input.anchor ? { anchor: input.anchor } : {}),
        ...(input.author ? { author: input.author } : {}),
      });
      if (input.attrs && input.attrs.length > 0) {
        const extra = input.attrs;
        next = replaceItem(next, id, (item) => withAttrs(item, [...item.attrs, ...extra]));
      }
      return { file: next, result: id };
    });
  }

  /** Rejects, writing nothing, when no item has the id. */
  editItem(paperId: string, id: string, body: string): Promise<void> {
    return this.mutate(paperId, (file) => ({ file: setItemBody(file, id, body), result: undefined }));
  }

  /** Re-anchors an item; the anchor `{ kind: "none" }` drops it. Rejects, writing nothing, when no item has the id. */
  setAnchor(paperId: string, id: string, anchor: ItemAnchor): Promise<void> {
    return this.mutate(paperId, (file) => {
      const text = formatAnchor(anchor);
      const file2 = replaceItem(file, id, (item) => {
        const others = item.attrs.filter(([key]) => key !== "anchor");
        const index = item.attrs.findIndex(([key]) => key === "anchor");
        const attrs = text === "" ? others : index >= 0
          ? item.attrs.map((pair) => (pair[0] === "anchor" ? (["anchor", text] as const) : pair))
          : [["anchor", text] as const, ...item.attrs];
        return { ...withAttrs(item, attrs), anchor: parseAnchor(text) };
      });
      return { file: file2, result: undefined };
    });
  }

  /** Rejects, writing nothing, when no item has the id. */
  removeItem(paperId: string, id: string): Promise<void> {
    return this.mutate(paperId, (file) => ({ file: removeItem(file, id), result: undefined }));
  }
}

/** @returns the item bodies and loose text in file order, joined with newlines, without fences or ids. */
export function notesText(file: ItemFile): string {
  const parts: string[] = [];
  for (const segment of file.segments) {
    const text = (segment.kind === "loose" ? segment.text : segment.body).replace(/\r\n|\r/g, "\n").replace(/\n+$/, "");
    if (text.trim() !== "") { parts.push(text); }
  }
  return parts.join("\n");
}

function replaceItem(file: ItemFile, id: string, change: (item: ItemSegment) => ItemSegment): ItemFile {
  const indices = file.segments.flatMap((segment, index) => (segment.kind === "item" && segment.id === id ? [index] : []));
  if (indices.length !== 1) { throw new Error(`Item ${id}: found ${indices.length} items with this id, expected 1`); }
  const segments = [...file.segments];
  segments[indices[0]!] = change(segments[indices[0]!] as ItemSegment);
  return { segments };
}

/** Rewrites the opening line with the given attributes, keeping its id, classes and line ending. */
function withAttrs(item: ItemSegment, attrs: readonly (readonly [string, string])[]): ItemSegment {
  const content = extractLineContent(item.fence);
  const parsed = parseDivOpener(content);
  const eol = item.fence.slice(content.length) || extractLineEnding(item.close);
  const fence = formatDivOpener({ ...(parsed?.id !== undefined ? { id: parsed.id } : { id: item.id }), classes: item.classes, pairs: attrs }) + eol;
  return { ...item, attrs, fence };
}
