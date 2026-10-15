// Orchestrates a provider-agnostic sync run: scans both trees, diffs against the manifest, applies and persists.
import type { RemoteProvider, RemoteNamespace } from "../../provider/index.js";
import type { ILogger, LocalFileSystem } from "../../../ports/index.js";
import type {
  NamespaceResult,
  SyncResult,
} from "../syncTypes.js";
import type { SyncManifest } from "../state/index.js";
import { diffNamespace } from "./syncDiff.js";
import { applyOperations } from "./syncApply.js";
import { scanLocalTree, scanRemoteTree } from "./treeScan.js";
import { RemotePathResolver } from "../../provider/index.js";
import { createLibraryFolderNamer } from "../naming/index.js";

/** Maps each namespace to its absolute local root directory. */
export type NamespaceRoots = Record<RemoteNamespace, string>;

/** Name translation maps for one namespace (e.g. paperId ↔ paper title). */
export interface FolderNameMaps {
  /** Local folder name → remote display name (used when creating folders). */
  localToRemote: Map<string, string>;
  /** Remote display name → local folder name (used when scanning remote). */
  remoteToLocal: Map<string, string>;
}

/** Dependencies injected into the engine (no vscode, no ambient globals). */
export interface SyncEngineDeps {
  provider: RemoteProvider;
  fs: LocalFileSystem;
  manifest: SyncManifest;
  roots: NamespaceRoots;
  /** Clock override for deterministic conflict naming/results. */
  clock?: () => Date;
  /** Optional name translation for the 'library' namespace. */
  libraryFolderNames?: FolderNameMaps;
  /** Receives warnings about local folders the scan had to skip. */
  logger?: ILogger;
}

const NAMESPACES: RemoteNamespace[] = ["library", "appdata"];

/** Runs a bidirectional sync using only the injected RemoteProvider and LocalFileSystem. */
export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  private now(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  private async syncNamespace(ns: RemoteNamespace): Promise<NamespaceResult> {
    const { provider, fs, manifest, roots, libraryFolderNames } = this.deps;
    const root = await provider.resolveRoot(ns);

    const names = ns === "library" ? libraryFolderNames : undefined;
    const resolver = new RemotePathResolver(provider, root.id, [], names?.localToRemote);
    // Paper folders are matched to local ones by what they hold, not only by their (title) name.
    const namer = ns === "library"
      ? createLibraryFolderNamer({ provider, manifest, ...(names ? { titles: names.remoteToLocal } : {}) })
      : undefined;
    const remoteTree = await scanRemoteTree(provider, root.id, resolver, names?.remoteToLocal, namer);
    const localTree = await scanLocalTree(fs, roots[ns], this.deps.logger);

    // CONTRACT: documents/contracts/sync.md#remote-identity
    // The manifest only means "deleted on the other side" for the remote it was built against. Another account or
    // OAuth client (Drive's drive.file and appDataFolder are private to each) or a replaced Drive folder shows up as a
    // different root id; a manifest with no recorded root falls back to "the remote is suddenly empty".
    // Either would otherwise turn every synced file into a local deletion.
    const knownRoot = manifest.rootId(ns);
    const rebased = knownRoot !== undefined
      ? knownRoot !== root.id
      : remoteTree.size === 0 && manifest.paths(ns).length > 0;
    if (rebased) { manifest.clearNamespace(ns); }
    manifest.setRootId(ns, root.id);

    const ops = diffNamespace(ns, localTree, remoteTree, manifest);
    const result = await applyOperations(
      {
        namespace: ns,
        provider,
        fs,
        manifest,
        resolver,
        localRoot: roots[ns],
        now: this.now(),
      },
      ops,
    );
    return rebased ? { ...result, rebased: true } : result;
  }

  /** Syncs both namespaces, then persists the manifest only if no namespace threw. */
  async run(): Promise<SyncResult> {
    if (!this.deps.provider.isConnected()) {
      throw new Error("Sync provider is not connected");
    }
    const startedAt = this.now().toISOString();
    const namespaces: NamespaceResult[] = [];
    for (const ns of NAMESPACES) {
      namespaces.push(await this.syncNamespace(ns));
    }
    await this.deps.manifest.save();
    return {
      providerId: this.deps.provider.id,
      namespaces,
      startedAt,
      finishedAt: this.now().toISOString(),
    };
  }
}
