// Composes the page's sharing: its connections and the workflow ports over them, the resume that follows the project list.
import {
  createShareResumer, shareProject,
  type ILogger, type ProjectEntry, type RelayAccount, type RelayNetwork, type ResumeReports, type ShareWorkflowPorts,
} from "@labshelf/core";
import type { ShareSources } from "./browserShareConnection";
import { createBrowserShareCatalog, createBrowserSharePorts } from "./browserSharePorts";
import { createPageShares, type PageShares } from "./pageShares";
import type { LiveShare } from "./projectShareEntry";
import { createShareKeyStore } from "./shareKeyStore";

const LOG_MODULE = "collab.sharing";

export interface PageSharingOptions {
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

export interface PageSharing {
  ports: ShareWorkflowPorts;
  shares: PageShares;
  /** Resolves once the first read of the project list and the resume it starts are done. */
  ready(): Promise<void>;
  /** Re-reads the project list and resumes or closes the shares it changed. */
  reload(): Promise<void>;
  /** The live share of a shared project's file; `retry` reconnects it from its stored key instead of waiting for the resume. */
  liveShare(entry: ProjectEntry, retry: boolean): Promise<LiveShare | undefined>;
  /** Aborts when the page closes, so a join waiting for a member stops. */
  closing: AbortSignal;
  closeAll(): Promise<void>;
}

export function createPageSharing(options: PageSharingOptions): PageSharing {
  const { sources, libraryId, logger } = options;
  const keys = createShareKeyStore(libraryId);
  const closing = new AbortController();
  // The resumer runs on every reload of the catalog, which the workflows call too; it exists once the ports do.
  let sync = (): Promise<void> => Promise.resolve();
  const catalog = createBrowserShareCatalog(sources, logger, () => { if (!closing.signal.aborted) void sync(); });
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
    ports, shares, closing: closing.signal, reload,
    ready: () => first,
    liveShare: async (entry, retry) => {
      if (entry.kind !== "ready" || entry.settings.shared === undefined) { return undefined; }
      await first;
      if (retry) { await shareProject(ports, { folder: entry.folder, shared: entry.settings.shared, signal: closing.signal }); } else { await resumer.sync(); }
      return shares.live(entry.settings.id);
    },
    closeAll: async () => {
      closing.abort();
      await shares.closeAll();
    },
  };
}
