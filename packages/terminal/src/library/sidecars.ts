// Reads per-paper sidecars (.research/papers/<id>/data.json): annotations, theme and reading position.
// Format and store come from @labshelf/core, so the terminal never writes a sidecar the other apps cannot read.
import { promises as fs } from "node:fs";

import { PaperDataStore, byPageThenCreated, type ILogger, type PaperData } from "@labshelf/core";
import { createNodeSidecarPort } from "@labshelf/core/node";

import { LibraryRoot } from "./libraryRoot.js";

/** Cached sidecar reads, invalidated by mtime so edits from VS Code or a sync show up. */
export class SidecarReader {
  private readonly store: PaperDataStore;
  private readonly cache = new Map<string, { mtimeMs: number; data: PaperData }>();

  constructor(private readonly paths: LibraryRoot, logger?: ILogger) {
    this.store = new PaperDataStore(createNodeSidecarPort(paths.layout, logger), logger ? { logger } : {});
  }

  /**
   * @returns the paper's sidecar (empty when it has none)
   */
  async load(paperId: string): Promise<PaperData> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await fs.stat(this.paths.layout.paperDataPath(paperId))).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    const cached = this.cache.get(paperId);
    if (cached && cached.mtimeMs === mtimeMs) { return cached.data; }
    const data = await this.store.load(paperId);
    data.annotations.sort(byPageThenCreated);
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
