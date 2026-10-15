// Enumerates the local and remote file trees of a namespace into path-keyed maps consumed by the diff.
import type { ILogger, LocalFileSystem } from "../../../ports/index.js";
import type { TreeNode } from "../syncTypes.js";
import type { RemoteFile, RemoteProvider } from "../../provider/index.js";
import type { RemotePathResolver } from "../../provider/index.js";
import { sha256Hex } from "../../util/index.js";

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Recursively scans a local directory tree, hashing every file for comparison against the manifest base. A folder
 * that cannot be read is left out of this sync, with a warning, rather than failing the whole sync.
 */
export async function scanLocalTree(
  fs: LocalFileSystem,
  rootPath: string,
  logger?: ILogger,
): Promise<Map<string, TreeNode>> {
  const tree = new Map<string, TreeNode>();

  async function walk(absDir: string, relDir: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.listDir(absDir);
    } catch (error) {
      await logger?.log("WARN", "sync/treeScan", "Sync skipped a folder it could not read", {
        dir: absDir, message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const name of names) {
      const abs = `${absDir}/${name}`;
      const rel = joinPath(relDir, name);
      const stat = await fs.stat(abs);
      if (!stat) {
        continue;
      }
      if (stat.isDirectory) {
        await walk(abs, rel);
      } else if (stat.isFile) {
        const bytes = await fs.readFile(abs);
        tree.set(rel, {
          path: rel,
          contentHash: await sha256Hex(bytes),
          modifiedTime: new Date(stat.mtimeMs).toISOString(),
          size: stat.size,
        });
      }
    }
  }

  await walk(rootPath, "");
  return tree;
}

/** A proposed local name for a remote folder; a lower rank is a stronger claim on the name. */
export interface FolderNaming {
  name: string;
  rank: number;
}

/**
 * Decides the local name of a remote folder from the folder and what it directly holds; undefined falls back to the
 * display-name translation.
 */
export type RemoteFolderNamer = (folder: RemoteFile, children: RemoteFile[]) => Promise<FolderNaming | undefined>;

// Ranks of the fallbacks applied by scanRemoteTree itself.
const RANK_NAME_MAP = 3;
const RANK_DISPLAY = 4;

/**
 * Recursively scans a remote folder tree, registering discovered folders on the
 * resolver; folderNameMap translates remote display names to local names, and
 * nameFolder (when given) decides first, from the folder's contents.
 */
export async function scanRemoteTree(
  provider: RemoteProvider,
  rootId: string,
  resolver: RemotePathResolver,
  folderNameMap?: Map<string, string>,
  nameFolder?: RemoteFolderNamer,
): Promise<Map<string, TreeNode>> {
  const tree = new Map<string, TreeNode>();

  async function walk(folderId: string, relDir: string, listed?: RemoteFile[]): Promise<void> {
    const children = listed ?? await provider.list(folderId);
    const taken = new Set(children.filter((c) => !c.isFolder).map((c) => c.name));
    const folders = await rankedFolderNames(children.filter((c) => c.isFolder), provider, folderNameMap, nameFolder);
    for (const { folder, kids, naming } of folders) {
      const rel = joinPath(relDir, claimLocalName(naming, folder, taken));
      resolver.register(rel, folder.id);
      await walk(folder.id, rel, kids);
    }
    collectFileNodes(children, relDir, tree);
  }

  await walk(rootId, "");
  return tree;
}

type RankedFolder = { folder: RemoteFile; kids: RemoteFile[] | undefined; naming: FolderNaming };

// The namer needs a folder's contents to decide its name, strongest claim (lowest rank) first, falling back to the
// display-name translation, then the display name itself.
async function rankedFolderNames(
  folders: RemoteFile[],
  provider: RemoteProvider,
  folderNameMap: Map<string, string> | undefined,
  nameFolder: RemoteFolderNamer | undefined,
): Promise<RankedFolder[]> {
  const ranked: RankedFolder[] = [];
  for (const folder of folders) {
    // The namer needs the folder's contents; listing them here is the listing walk() would do anyway.
    const kids = nameFolder ? await provider.list(folder.id) : undefined;
    const mapped = folderNameMap?.get(folder.name);
    const naming = (kids ? await nameFolder!(folder, kids) : undefined)
      ?? (mapped ? { name: mapped, rank: RANK_NAME_MAP } : { name: folder.name, rank: RANK_DISPLAY });
    ranked.push({ folder, kids, naming });
  }
  return ranked.sort((a, b) => a.naming.rank - b.naming.rank);
}

// CONTRACT: documents/contracts/sync.md#folder-names
// Two remote folders must never share a local name — their files would be merged and one paper would overwrite the
// other — so a later claimant falls back to its display name, then to the display name plus part of its id.
function claimLocalName(naming: FolderNaming, folder: RemoteFile, taken: Set<string>): string {
  let localName = naming.name;
  if (taken.has(localName)) { localName = folder.name; }
  if (taken.has(localName)) { localName = `${folder.name} (${folder.id.slice(-6)})`; }
  taken.add(localName);
  return localName;
}

// TRAP: Drive allows two files with one name in a folder, so a paper folder can hold two data.json files.
// Keep the newest, the last one written.
function collectFileNodes(children: RemoteFile[], relDir: string, tree: Map<string, TreeNode>): void {
  for (const child of children) {
    if (child.isFolder) { continue; }
    const rel = joinPath(relDir, child.name);
    const node: TreeNode = { path: rel, modifiedTime: child.modifiedTime, remoteId: child.id };
    if (child.size !== undefined) { node.size = child.size; }
    const seen = tree.get(rel);
    if (!seen || seen.modifiedTime < child.modifiedTime) { tree.set(rel, node); }
  }
}
