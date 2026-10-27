/** Reads a project's device-local shared state: the files in its share index and the stored text versions and merge base of a file. */
import * as path from "node:path";
import * as Y from "yjs";
import { createDeviceLocalLayout, readOptionalFile } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { deriveTextSha256Hex } from "../../../hash/index.js";
import { parseProjectFile, PROJECT_FILE } from "../../project/index.js";
import { createNodeCollabStorage } from "../../../collab/session/node/index.js";
import { loadVersionHistory, StoredMap } from "../../../collab/session/index.js";
import { INDEX_DOC_KEY, readShareIndexDocFiles } from "../../../collab/index.js";

// Shared project state: the device-local storage of a project's share.

function createSharedProjectStorage(root: string, shareId: string) {
  if (!shareId || /[/\\\0]/.test(shareId) || shareId === '.' || shareId === '..') {
    throw new Error(`Invalid share id for project conflict scan: ${shareId}`);
  }
  return createNodeCollabStorage({ dir: path.join(createDeviceLocalLayout(root).collabDir, shareId), shareId });
}

export async function readSharedProjectFiles(root: string, shareId: string, logger: ILogger): Promise<ReadonlySet<string>> {
  const storage = createSharedProjectStorage(root, shareId);
  const stored = (await storage.loadDocs()).get(storage.docId(INDEX_DOC_KEY));
  if (!stored) return new Set();
  const doc = new Y.Doc();
  try {
    if (stored.torn) await logger.log('WARN', 'conflicts', 'Skipped a partial shared index record during conflict scan', { shareId });
    if (stored.snapshot) Y.applyUpdate(doc, stored.snapshot);
    for (const update of stored.updates) Y.applyUpdate(doc, update);
    return new Set(readShareIndexDocFiles(doc).keys());
  } finally {
    doc.destroy();
  }
}

// Shared project versions: the stored text versions and merge base of a file, read as merge-base candidates.

export async function readSharedProjectVersions(root: string, folder: string, relative: string, logger: ILogger): Promise<string[]> {
  const settings = await readOptionalFile(path.join(folder, PROJECT_FILE));
  if (settings === undefined) return [];
  const project = parseProjectFile(settings);
  if (!project.ok) throw new Error(`Cannot read project settings for merge history: ${folder}: ${project.reason}`);
  const shareId = project.settings.shared;
  if (!shareId) return [];
  const storage = createSharedProjectStorage(root, shareId);
  const versions = await loadVersionHistory(storage, logger);
  const texts: string[] = [];
  for (const version of versions.storedVersions(relative)) {
    if (await deriveTextSha256Hex(version.text) === version.hash) texts.push(version.text);
    else await logger.log('WARN', 'conflicts', 'Ignored a shared text version with a mismatched hash', { shareId, path: relative, hash: version.hash });
  }
  const bases = await StoredMap.load({ storage, name: 'bases', label: 'file merge bases', logger,
    isValue: (value: unknown): value is string => typeof value === 'string' });
  const base = bases.get(relative);
  if (base !== undefined) texts.push(base);
  return texts;
}
