// Scans the projects present on this device, locally and in their Drive folders, into one tree keyed `<id>/<path>`.
import type { ILogger, LocalFileSystem } from "../../../ports/index.js";
import type { RemotePathResolver, RemoteProvider } from "../../provider/index.js";
import type { SyncProject, TreeNode } from "../syncTypes.js";
import { isSafeFolderName } from "../naming/index.js";
import { isIgnoredProjectPath } from "./projectIgnore.js";
import { scanLocalTree, scanRemoteTree, type ScanScope } from "./treeScan.js";

export interface ProjectsScan {
  localTree: Map<string, TreeNode>;
  remoteTree: Map<string, TreeNode>;
  /** Project-prefixed paths of the local folders that could not be read. */
  unreadable: string[];
  /** Local root folder of each scanned project, by id. */
  roots: Map<string, string>;
  /** Names of the Drive folders that no scanned project has. */
  onlyOnDrive: string[];
}

function scopeOf(project: SyncProject): ScanScope {
  return {
    prefix: project.id,
    ignored: (path) => isIgnoredProjectPath(path.slice(project.id.length + 1), project.ignore),
  };
}

async function usableProjects(projects: readonly SyncProject[], logger?: ILogger): Promise<SyncProject[]> {
  const seen = new Set<string>();
  const usable: SyncProject[] = [];
  for (const project of projects) {
    // INVARIANT: ids are unique among the projects; a repeat or an id that is no folder name is left out.
    if (!isSafeFolderName(project.id) || seen.has(project.id)) {
      await logger?.log("WARN", "sync/projects", "Sync skipped a project whose id cannot name a Drive folder", {
        id: project.id, root: project.root,
      });
      continue;
    }
    seen.add(project.id);
    usable.push(project);
  }
  return usable;
}

/** Scans each project against its own Drive folder; a project with no Drive folder yet has an empty remote side. */
export async function scanProjects(
  provider: RemoteProvider,
  fs: LocalFileSystem,
  resolver: RemotePathResolver,
  rootId: string,
  projects: readonly SyncProject[],
  logger?: ILogger,
): Promise<ProjectsScan> {
  const scan: ProjectsScan = {
    localTree: new Map(), remoteTree: new Map(), unreadable: [], roots: new Map(), onlyOnDrive: [],
  };
  const folders = (await provider.list(rootId)).filter((child) => child.isFolder);
  for (const project of await usableProjects(projects, logger)) {
    const scope = scopeOf(project);
    scan.roots.set(project.id, project.root);
    const folder = folders.find((candidate) => candidate.name === project.id);
    if (folder) {
      resolver.register(project.id, folder.id);
      const remote = await scanRemoteTree(provider, folder.id, resolver, undefined, undefined, scope);
      remote.forEach((node, path) => scan.remoteTree.set(path, node));
    }
    const local = await scanLocalTree(fs, project.root, logger, scope);
    local.tree.forEach((node, path) => scan.localTree.set(path, node));
    scan.unreadable.push(...local.unreadable);
  }
  scan.onlyOnDrive = folders.map((folder) => folder.name).filter((name) => !scan.roots.has(name));
  return scan;
}
