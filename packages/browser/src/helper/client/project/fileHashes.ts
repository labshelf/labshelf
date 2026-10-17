// Hashes project files with SHA-256 for the helper's sync and PDF checks.
import type { HelperProjectFile, SyncedFile } from "@labshelf/core/helper";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function describeFiles(files: readonly HelperProjectFile[]): Promise<SyncedFile[]> {
  return Promise.all(files.map(async (file) => ({ path: file.path, sha256: await sha256Hex(file.bytes), size: file.bytes.length })));
}
