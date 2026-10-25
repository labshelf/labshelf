// Deletes a share's device-local state (Yjs docs, blobs, cursors) from the library's state dir.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createDeviceLocalLayout } from "@labshelf/core/node";

// CONTRACT: documents/contracts/collaboration.md#device-local-state
export const deriveShareDir = (libraryRoot: string, shareId: string): string => path.join(createDeviceLocalLayout(libraryRoot).collabDir, shareId);

export async function removeShareDir(libraryRoot: string, shareId: string): Promise<void> {
  await fs.rm(deriveShareDir(libraryRoot, shareId), { recursive: true, force: true });
}
