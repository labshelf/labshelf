// Composes the page's sharing: its connections and the workflow ports over them, the resume that follows the project list.
import {
  createListeners,
  createShareResumer,
  startProjectShare,
  type ILogger,
  type ProjectEntry,
  type RelayAccount,
  type RelayNetwork,
  type ResumeReports,
  type ShareFlowPorts,
  posixPathOps,
  type ShareKeyStore,
} from "@labshelf/core";
import type { ShareSources } from "./browserShareConnection";
import { createPageShares, type PageShares } from "./pageShares";
import type { LiveShare } from "./projectShareEntry";
import { createShareKeyStore } from "./shareKeyStore";
import { createBrowserProjects, removeBrowserCollabDocs } from "../storage";

/** The project list the workflows read; `reload` re-reads the library's projects and then calls `reloaded`. */
interface BrowserShareCatalog {
  list(): readonly ProjectEntry[];
  reload(): Promise<void>;
}

function createBrowserShareCatalog(sources: ShareSources, logger: ILogger, reloaded: () => void): BrowserShareCatalog {
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

interface BrowserSharePortsOptions {
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

function createBrowserSharePorts(options: BrowserSharePortsOptions): ShareFlowPorts {
  const { sources, libraryId, keys, shares, projects, relay, requireRelay, logger } = options;
  return {
    keys, shares, projects, relay, requireRelay, logger,
    files: { fs: sources.fileSystem, paths: posixPathOps, logger },
    connect: (invite, start) => shares.connect(invite, start),
    deleteState: async (shareId) => removeBrowserCollabDocs(`${await libraryId()}/${shareId}`),
    userName: () => shares.name(),
    // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

const LOG_MODULE = "collab.sharing";

export interface PageShareOptions {
  sources: ShareSources;
  libraryId: () => Promise<string>;
  logger: ILogger;
  /** The owner's Cloudflare relay account, when this browser connected one. */
  relay: { get(): Promise<RelayAccount | undefined> };
  /** Offers to connect a relay; false when the owner did not. */
  requireRelay(): Promise<boolean>;
  /** What the resume reports once per share. */
  reports: ResumeReports;
  /** Tests pass relays that run in process. */
  network?: RelayNetwork;
  fetch?: typeof fetch;
}

export interface PageShare {
  ports: ShareFlowPorts;
  shares: PageShares;
  /** Resolves once the first read of the project list and the resume it starts are done. */
  ready(): Promise<void>;
  /** Re-reads the project list and resumes or closes the shares it changed. */
  reload(): Promise<void>;
  /** Calls `listener` after every re-read of the project list, the ones a share, join or leave makes included. */
  onProjectsChange(listener: () => void): void;
  /** The live share of a shared project's file; `retry` reconnects it from its stored key instead of waiting for the resume. */
  liveShare(entry: ProjectEntry, retry: boolean): Promise<LiveShare | undefined>;
  closeAll(): Promise<void>;
}

export function createPageShare(options: PageShareOptions): PageShare {
  const { sources, libraryId, logger } = options;
  const keys = createShareKeyStore(libraryId);
  const closing = new AbortController();
  // The resumer runs on every reload of the catalog, which the workflows call too; it exists once the ports do.
  let sync = (): Promise<void> => Promise.resolve();
  const listeners = createListeners();
  const catalog = createBrowserShareCatalog(sources, logger, () => {
    if (closing.signal.aborted) return;
    void sync();
    listeners.emit();
  });
  const projectIdOf = (folder: string): string | undefined => {
    const entry = catalog.list().find((candidate) => candidate.folder === folder);
    return entry?.kind === "ready" ? entry.settings.id : undefined;
  };
  const shares = createPageShares({ sources, libraryId, keys, projectIdOf, logger, network: options.network });
  const ports = createBrowserSharePorts({
    sources, libraryId, keys, shares, projects: catalog, relay: options.relay, requireRelay: options.requireRelay, logger, fetch: options.fetch,
  });
  const resumer = createShareResumer(ports, options.reports);
  sync = resumer.sync;
  const reload = async (): Promise<void> => {
    if (closing.signal.aborted) { return; }
    await catalog.reload();
    await resumer.sync();
  };
  const first = reload().catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "read the shared projects at page start" }));
  return {
    ports, shares, reload,
    onProjectsChange: (listener) => { listeners.add(listener); },
    ready: () => first,
    liveShare: async (entry, retry) => {
      if (entry.kind !== "ready" || entry.settings.shared === undefined) { return undefined; }
      await first;
      if (retry) { await startProjectShare(ports, { folder: entry.folder, shared: entry.settings.shared, signal: closing.signal }); } else { await resumer.sync(); }
      return shares.live(entry.settings.id);
    },
    closeAll: async () => {
      closing.abort();
      await shares.closeAll();
    },
  };
}
