// Deletes a share's device-local state (Yjs docs, blobs, cursors) from the library's state dir.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { deviceLocalLayout } from "@labshelf/core/node";

// CONTRACT: documents/contracts/collaboration.md#device-local-state
export const shareStateDir = (libraryRoot: string, shareId: string): string => path.join(deviceLocalLayout(libraryRoot).collabDir, shareId);

export async function deleteShareState(libraryRoot: string, shareId: string): Promise<void> {
  await fs.rm(shareStateDir(libraryRoot, shareId), { recursive: true, force: true });
}
