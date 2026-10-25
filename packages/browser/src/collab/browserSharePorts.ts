// Adapts the page's share keys, connections, project list, relay account and IndexedDB state to the ports of the core share workflows.
import { posixPathOps, type ILogger, type ProjectEntry, type RelayAccount, type ShareKeyStore, type ShareWorkflowPorts } from "@labshelf/core";
import { deleteBrowserCollabState } from "../storage";
import { createBrowserProjects } from "../storage/projects";
import type { ShareSources } from "./browserShareConnection";
import type { PageShares } from "./pageShares";

/** The project list the workflows read; `reload` re-reads the library's projects and then calls `reloaded`. */
export interface BrowserShareCatalog {
  list(): readonly ProjectEntry[];
  reload(): Promise<void>;
}

export function createBrowserShareCatalog(sources: ShareSources, logger: ILogger, reloaded: () => void): BrowserShareCatalog {
  const projects = createBrowserProjects({ fileSystem: sources.fileSystem, logger });
  let entries: readonly ProjectEntry[] = [];
  return {
    list: () => entries,
    reload: async () => {
      entries = await projects.listBrowserProjects();
      reloaded();
    },
  };
}

export interface BrowserSharePortsOptions {
  sources: ShareSources;
  libraryId: () => Promise<string>;
  keys: ShareKeyStore;
  shares: PageShares;
  projects: BrowserShareCatalog;
  relay: { get(): Promise<RelayAccount | undefined> };
  requireRelay(): Promise<boolean>;
  logger: ILogger;
  fetch?: typeof fetch | undefined;
}

export function createBrowserSharePorts(options: BrowserSharePortsOptions): ShareWorkflowPorts {
  const { sources, libraryId, keys, shares, projects, relay, requireRelay, logger } = options;
  return {
    keys, shares, projects, relay, requireRelay, logger,
    files: { fs: sources.fileSystem, paths: posixPathOps, logger },
    connect: (invite, start) => shares.connect(invite, start),
    deleteState: async (shareId) => deleteBrowserCollabState(`${await libraryId()}/${shareId}`),
    userName: () => shares.name(),
    // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  };
}
