// Reads per-paper sidecars (.research/papers/<id>/data.json): annotations, theme and reading position.
// Format and store come from @labshelf/core, so the terminal never writes a sidecar the other apps cannot read.
import { promises as fs } from "node:fs";

import { PaperNotesStore, PaperSidecarStore, compareAnnotations, notesText, type ILogger, type PaperSidecar } from "@labshelf/core";
import { createNodePaperNotesPort, createNodeSidecarPort } from "@labshelf/core/node";

import { LibraryRoot } from "./libraryRoot.js";

/** Cached sidecar reads, invalidated by mtime so edits from VS Code show up. Also holds the notes.qmd store of the library. */
export class SidecarReader {
  private readonly store: PaperSidecarStore;
  /** The papers' notes.qmd files; the terminal reads them and opens the file itself in $EDITOR. */
  readonly notes: PaperNotesStore;
  private readonly cache = new Map<string, { mtimeMs: number; data: PaperSidecar }>();

  constructor(private readonly paths: LibraryRoot, logger?: ILogger) {
    this.store = new PaperSidecarStore(createNodeSidecarPort(paths.layout, logger), logger ? { logger } : {});
    this.notes = new PaperNotesStore(createNodePaperNotesPort(paths.layout, logger), logger ? { logger } : {});
  }

  /**
   * The notes.qmd text of every paper that has notes, for the library search.
   * @returns paperId → item bodies and loose text
   */
  async notesIndex(paperIds: Iterable<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of paperIds) {
      const text = notesText(await this.notes.read(id));
      if (text) { out.set(id, text); }
    }
    return out;
  }

  /**
   * @returns the paper's sidecar (empty when it has none)
   */
  async load(paperId: string): Promise<PaperSidecar> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await fs.stat(this.paths.layout.paperDataPath(paperId))).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    const cached = this.cache.get(paperId);
    if (cached && cached.mtimeMs === mtimeMs) { return cached.data; }
    const data = await this.store.load(paperId);
    data.annotations.sort(compareAnnotations);
    this.cache.set(paperId, { mtimeMs, data });
    return data;
  }

  /**
   * Annotation text of every paper that has a sidecar, for the library search.
   * @returns paperId → concatenated annotation text
   */
  async annotationIndex(paperIds: Iterable<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of paperIds) {
      const data = await this.load(id);
      if (data.annotations.length) {
        out.set(id, data.annotations.map((a) => a.content).join("\n"));
      }
    }
    return out;
  }
}
