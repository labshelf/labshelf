/**
 * Holds what every library page host handler shares: the channel to the UI, the snapshots, the core library mutations, the
 * logger and the folder the UI shows.
 */
import { PAPERS_DIR, type HostEndpoint, type ILogger, type PaperRecord, type PaperRef } from "@labshelf/core";
import { createLibraryMutations, type LibraryMutations } from "../../storage";
import { createLibrarySnapshots, createSidecarReads, type LibrarySnapshots, type SidecarReads } from "./snapshots";

export interface HostContext {
  endpoint: HostEndpoint;
  snapshots: LibrarySnapshots;
  sidecars: SidecarReads;
  mutations: LibraryMutations;
  log: ILogger;
  /** The folder the UI shows, kept from its navigate messages. */
  folder: string;
  notice(kind: "info" | "ok" | "error", text: string): void;
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): PaperRecord[];
}

export function createHostContext(endpoint: HostEndpoint, log: ILogger): HostContext {
  const sidecars = createSidecarReads(log);
  const snapshots = createLibrarySnapshots(endpoint, sidecars);
  return {
    endpoint, snapshots, sidecars, log,
    mutations: createLibraryMutations(log),
    folder: PAPERS_DIR,
    notice: (kind, text) => endpoint.post({ type: "notice", kind, text }),
    papers: (ids) => {
      const byId = new Map(snapshots.current().papers.map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
    },
  };
}

export const asRefs = (papers: readonly PaperRecord[]): PaperRef[] => papers.map((p) => ({ id: p.id, path: p.path }));
