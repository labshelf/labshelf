// Reads the shared index to keep tracked files out of content-copy prompts.
import * as Y from 'yjs';
import { indexFiles } from '../../../../collab/model/index.js';
import { INDEX_DOC_KEY } from "../../../../collab/doc/index.js";
import type { ILogger } from '../../../../ports/index.js';
import { createSharedProjectStorage } from './createSharedProjectStorage.js';

export async function readSharedProjectFiles(root: string, shareId: string, logger: ILogger): Promise<ReadonlySet<string>> {
  const storage = createSharedProjectStorage(root, shareId);
  const stored = (await storage.loadDocs()).get(storage.docId(INDEX_DOC_KEY));
  if (!stored) return new Set();
  const doc = new Y.Doc();
  try {
    if (stored.torn) await logger.log('WARN', 'conflicts', 'Skipped a partial shared index record during conflict scan', { shareId });
    if (stored.snapshot) Y.applyUpdate(doc, stored.snapshot);
    for (const update of stored.updates) Y.applyUpdate(doc, update);
    return new Set(indexFiles(doc).keys());
  } finally {
    doc.destroy();
  }
}
