// Builds the sharing host of the library page: paper-folder links over this browser's share list, library files and relay, plus the projects the project wiring adds.
import {
  createShareHost,
  createWorkerShareReader,
  PAPERS_DIR,
  PaperSidecarStore,
  posixPathOps,
  resolveRelayBackend,
  type ILogger,
  type RelayAccount,
  type ProjectShareDeps,
  type ShareHost,
} from "@labshelf/core";
import { bx } from "../../platform";
import { createBrowserShareRegistryStore } from "../../share";
import { createLibraryFileSystem, createSidecarPort, readCurrentLibraryId } from "../../storage";
import type { HostContext } from "./context";

interface PageSharingHost {
  host: ShareHost;
  /** Switches `host` to one that also shares projects and tells its offers listeners. */
  addProjects(deps: ProjectShareDeps): void;
}

/** `build` makes the host with the links half alone, or with the project half too when given its deps. */
export function createPageShareHost(build: (projects?: ProjectShareDeps) => ShareHost): PageSharingHost {
  let inner = build();
  const listeners = new Set<() => void>();
  const host: ShareHost = {
    place: inner.place,
    offers: () => inner.offers(),
    onOffersChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    projects: () => inner.projects(),
    projectStatus: (id) => inner.projectStatus(id),
    shareProject: (id, signal) => inner.shareProject(id, signal),
    inviteLink: (id) => inner.inviteLink(id),
    joinProject: (invite, signal) => inner.joinProject(invite, signal),
    leaveProject: (id) => inner.leaveProject(id),
    openProject: (id) => inner.openProject(id),
    shareableFolder: (path) => inner.shareableFolder(path),
    shareFolder: (path, withAnnotations, onProgress) => inner.shareFolder(path, withAnnotations, onProgress),
    sharedLinks: () => inner.sharedLinks(),
    revokeLink: (id) => inner.revokeLink(id),
    importLink: (text, onProgress) => inner.importLink(text, onProgress),
    openFolder: (path) => inner.openFolder(path),
    copyText: (text) => inner.copyText(text),
    openLink: (url) => inner.openLink(url),
  };
  return {
    host,
    addProjects(deps) {
      inner = build(deps);
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The owner's Cloudflare relay as the share links need it. */
export interface ShareLinkRelay {
  /** The connected account, or a connect the owner confirms first; undefined on cancel or failure (already shown). */
  requireRelay(): Promise<RelayAccount | undefined>;
  /** The connected account, without offering to connect. */
  connectedRelay(): Promise<RelayAccount | undefined>;
}

export function createBrowserShareHost(ctx: HostContext, relay: ShareLinkRelay, logger: ILogger): PageSharingHost {
  const fs = createLibraryFileSystem();
  const sidecars = new PaperSidecarStore(createSidecarPort(fs), { logger });
  return createPageShareHost((projects) => createShareHost({
    place: "this browser",
    logger,
    ...(projects ? { projects } : {}),
    links: {
      papers: () => ctx.snapshots.current().papers,
      papersRoot: PAPERS_DIR,
      sep: "/",
      sources: { fs, paths: posixPathOps, annotations: (paperId) => sidecars.getAnnotations(paperId) },
      registry: createBrowserShareRegistryStore({ get: (key) => bx.storage.local.get(key), set: (items) => bx.storage.local.set(items) }, readCurrentLibraryId),
      relay: { require: relay.requireRelay, connected: relay.connectedRelay },
      backendFor: resolveRelayBackend,
      readerFor: (relayUrl) => createWorkerShareReader({ relayUrl }),
      importLink: (options) => ctx.mutations.importShareLink(options),
      refresh: () => ctx.snapshots.refresh(),
      openFolder: async (folder) => { ctx.endpoint.post({ type: "navigate", folder }); },
    },
    clipboard: { write: (text) => navigator.clipboard.writeText(text) },
    // The link key sits in the fragment, which the new tab never sends to a server.
    openLink: async (url) => { window.open(url, "_blank", "noopener"); },
  }));
}
