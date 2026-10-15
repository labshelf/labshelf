// Classifies every relative path by comparing the local tree, the remote tree and the manifest base.
// CONTRACT: documents/contracts/sync.md#three-way-diff
import type {
  DiffClass,
  SyncOperation,
  TreeNode,
} from "../syncTypes.js";
import type { SyncManifest } from "../state/index.js";
import type { RemoteNamespace } from "../../provider/index.js";

function localChanged(node: TreeNode, baseHash: string): boolean {
  return node.contentHash !== baseHash;
}

function remoteChanged(node: TreeNode, baseTime: string): boolean {
  return node.modifiedTime !== baseTime;
}

function classify(
  _path: string,
  local: TreeNode | undefined,
  remote: TreeNode | undefined,
  base: { contentHash: string; modifiedTime: string } | undefined,
): DiffClass {
  if (!base) {
    if (local && remote) {
      // Both appeared independently: conflict unless identical content.
      return local.contentHash &&
        remote.contentHash &&
        local.contentHash === remote.contentHash
        ? "unchanged"
        : "conflict";
    }
    return local ? "local-new" : "remote-new";
  }

  const lChanged = local ? localChanged(local, base.contentHash) : undefined;
  const rChanged = remote ? remoteChanged(remote, base.modifiedTime) : undefined;

  if (!local && !remote) {
    return "unchanged";
  }
  if (!local) {
    return rChanged ? "conflict" : "local-deleted";
  }
  if (!remote) {
    return lChanged ? "conflict" : "remote-deleted";
  }

  if (lChanged && rChanged) {
    return "conflict";
  }
  if (lChanged) {
    return "local-modified";
  }
  if (rChanged) {
    return "remote-modified";
  }
  return "unchanged";
}

/** Operations are sorted by path so a run is deterministic. */
export function diffNamespace(
  ns: RemoteNamespace,
  localTree: Map<string, TreeNode>,
  remoteTree: Map<string, TreeNode>,
  manifest: SyncManifest,
): SyncOperation[] {
  const paths = new Set<string>([
    ...localTree.keys(),
    ...remoteTree.keys(),
    ...manifest.paths(ns),
  ]);

  const ops: SyncOperation[] = [];
  for (const path of paths) {
    const local = localTree.get(path);
    const remote = remoteTree.get(path);
    const base = manifest.get(ns, path);
    const cls = classify(path, local, remote, base);
    const op: SyncOperation = { path, class: cls };
    if (local) {
      op.local = local;
    }
    if (remote) {
      op.remote = remote;
    }
    ops.push(op);
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path));
}
