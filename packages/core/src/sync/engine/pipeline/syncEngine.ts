// Orchestrates a provider-agnostic sync run: scans both trees, diffs against the manifest, applies and persists.
import type { RemoteProvider, RemoteNamespace } from "../../provider/index.js";
import type { ILogger, LocalFileSystem } from "../../../ports/index.js";
import type {
  NamespaceResult,
  SyncOperation,
  SyncProject,
  SyncResult,
  TreeNode,
} from "../syncTypes.js";
import type { SyncManifest } from "../state/index.js";
import { diffNamespace } from "./syncDiff.js";
import { applyOperations } from "./syncApply.js";
import { scanLocalTree, scanRemoteTree } from "./treeScan.js";
import { scanProjects } from "./projectScan.js";
import { RemotePathResolver } from "../../provider/index.js";
import { createLibraryFolderNamer } from "../naming/index.js";

/** The namespaces that are one local folder; the projects namespace spans one folder per project. */
type FolderNamespace = Exclude<RemoteNamespace, "projects">;

/** Maps each folder namespace to its absolute local root directory. */
export type NamespaceRoots = Record<FolderNamespace, string>;

/** What a namespace's two sides hold, ready to reconcile. */
interface NamespaceScan {
  resolver: RemotePathResolver;
  remoteTree: Map<string, TreeNode>;
  localTree: Map<string, TreeNode>;
  unreadable: string[];
  localPath(path: string): string;
}

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
  /** The projects on this device; the projects namespace runs only when this is given. */
  projects?: readonly SyncProject[];
  /** Receives warnings about local folders the scan could not read and the paths held back under them. */
  logger?: ILogger;
}

const NAMESPACES: FolderNamespace[] = ["library", "appdata"];

function emptyResult(namespace: RemoteNamespace): NamespaceResult {
  return { namespace, uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [] };
}

/** Runs a bidirectional sync using only the injected RemoteProvider and LocalFileSystem. */
export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  private now(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  private async syncNamespace(ns: FolderNamespace): Promise<NamespaceResult> {
    const { provider, fs, manifest, roots, libraryFolderNames } = this.deps;
    const root = await provider.resolveRoot(ns);

    const names = ns === "library" ? libraryFolderNames : undefined;
    const resolver = new RemotePathResolver(provider, root.id, [], names?.localToRemote);
    // Paper folders are matched to local ones by what they hold, not only by their (title) name.
    const namer = ns === "library"
      ? createLibraryFolderNamer({ provider, manifest, ...(names ? { titles: names.remoteToLocal } : {}) })
      : undefined;
    const remoteTree = await scanRemoteTree(provider, root.id, resolver, names?.remoteToLocal, namer);
    const { tree: localTree, unreadable } = await scanLocalTree(fs, roots[ns], this.deps.logger);
    return this.reconcile(ns, root.id, {
      resolver, remoteTree, localTree, unreadable, localPath: (path) => `${roots[ns]}/${path}`,
    });
  }

  // CONTRACT: documents/contracts/sync.md#projects
  // Only the projects on this device take part: the trees hold nothing of the others, and a manifest entry that
  // neither tree holds is left as it is, so a project that is absent here never deletes anything on Drive.
  private async syncProjects(projects: readonly SyncProject[]): Promise<{ result: NamespaceResult; onlyOnDrive: string[] }> {
    const { provider, fs, logger } = this.deps;
    try {
      // CONTRACT: documents/contracts/sync.md#projects
      // The Drive folder is created by the first project upload: with no project here, the run only looks.
      const root = projects.length > 0 ? await provider.resolveRoot("projects") : await provider.findRoot("projects");
      if (!root) { return { result: emptyResult("projects"), onlyOnDrive: [] }; }
      const resolver = new RemotePathResolver(provider, root.id);
      const scan = await scanProjects(provider, fs, resolver, root.id, projects, logger);
      const localPath = (path: string): string => {
        const id = path.slice(0, path.indexOf("/"));
        const projectRoot = scan.roots.get(id);
        if (projectRoot === undefined) { throw new Error(`No project folder on this device for ${path}`); }
        return `${projectRoot}/${path.slice(id.length + 1)}`;
      };
      const result = await this.reconcile("projects", root.id, { ...scan, resolver, localPath });
      await logger?.log("INFO", "sync/projects", "Sync ran the projects namespace", {
        projects: scan.roots.size, onlyOnDrive: scan.onlyOnDrive.length,
        uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts.length,
      });
      return { result, onlyOnDrive: scan.onlyOnDrive };
    } catch (error) {
      await logger?.error("sync/projects", error, { projects: projects.map((project) => project.id) });
      throw error;
    }
  }

  private async reconcile(ns: RemoteNamespace, rootId: string, scan: NamespaceScan): Promise<NamespaceResult> {
    const { provider, fs, manifest } = this.deps;
    const { resolver, remoteTree, localTree, unreadable, localPath } = scan;

    // CONTRACT: documents/contracts/sync.md#remote-identity
    // The manifest only means "deleted on the other side" for the remote it was built against. Another account or
    // OAuth client (Drive's drive.file and appDataFolder are private to each) or a replaced Drive folder shows up as a
    // different root id; a manifest with no recorded root falls back to "the remote is suddenly empty".
    // Either would otherwise turn every synced file into a local deletion.
    const knownRoot = manifest.rootId(ns);
    const rebased = knownRoot !== undefined
      ? knownRoot !== rootId
      : remoteTree.size === 0 && manifest.paths(ns).length > 0;
    if (rebased) { manifest.clearNamespace(ns); }
    manifest.setRootId(ns, rootId);

    const ops = await this.holdBackUnreadable(ns, diffNamespace(ns, localTree, remoteTree, manifest), unreadable);
    const result = await applyOperations(
      {
        namespace: ns,
        provider,
        fs,
        manifest,
        resolver,
        localPath,
        now: this.now(),
      },
      ops,
    );
    return rebased ? { ...result, rebased: true } : result;
  }

  // CONTRACT: documents/contracts/sync.md#three-way-diff
  // A folder the scan could not read looks locally deleted to the diff; acting on that would remove its files from
  // the remote. Its paths sit out the run, so their manifest entries stay as they were.
  private async holdBackUnreadable(
    ns: RemoteNamespace,
    ops: SyncOperation[],
    unreadable: string[],
  ): Promise<SyncOperation[]> {
    let kept = ops;
    for (const prefix of unreadable) {
      const under = (path: string): boolean => prefix === "" || path.startsWith(`${prefix}/`);
      const held = kept.filter((op) => under(op.path)).length;
      kept = kept.filter((op) => !under(op.path));
      await this.deps.logger?.log("WARN", "sync/engine", "Sync held back the paths under an unreadable folder", {
        namespace: ns, folder: prefix, heldBack: held,
      });
    }
    return kept;
  }

  /** Syncs the namespaces, then persists the manifest only if no namespace threw. */
  async run(): Promise<SyncResult> {
    if (!this.deps.provider.isConnected()) {
      throw new Error("Sync provider is not connected");
    }
    const startedAt = this.now().toISOString();
    const namespaces: NamespaceResult[] = [];
    for (const ns of NAMESPACES) {
      namespaces.push(await this.syncNamespace(ns));
    }
    const projects = this.deps.projects ? await this.syncProjects(this.deps.projects) : undefined;
    if (projects) { namespaces.push(projects.result); }
    await this.deps.manifest.save();
    return {
      providerId: this.deps.provider.id,
      namespaces,
      ...(projects ? { projectsOnlyOnDrive: projects.onlyOnDrive } : {}),
      startedAt,
      finishedAt: this.now().toISOString(),
    };
  }
}
