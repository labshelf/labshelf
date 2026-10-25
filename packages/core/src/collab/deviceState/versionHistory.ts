// Retains bounded device-local text versions for merge-base selection.
import type { ILogger } from "../../ports/index.js";
import type { CollabDeviceStateStorage } from "./collabStorage.js";
import { PersistedMap } from "./storedMap.js";

export const VERSIONS_PER_PATH = 50;
export interface StoredVersion { readonly hash: string; readonly text: string }

function isVersions(value: unknown): value is readonly StoredVersion[] {
  return Array.isArray(value) && value.length <= VERSIONS_PER_PATH && value.every((entry: unknown) =>
    entry !== null && typeof entry === "object" && "hash" in entry && typeof entry.hash === "string"
    && "text" in entry && typeof entry.text === "string");
}

export async function loadVersionHistory(storage: CollabDeviceStateStorage, logger: ILogger) {
  const versions = await PersistedMap.load({ storage, name: "versions", label: "stored file versions", isValue: isVersions, logger });
  return {
    storedVersions: (path: string): readonly StoredVersion[] => versions.get(path) ?? [],
    rememberVersion: (path: string, hash: string, text: string): void => {
      const entries = versions.get(path) ?? [];
      if (entries.at(-1)?.hash === hash) { return; }
      versions.set(path, [...entries, { hash, text }].slice(-VERSIONS_PER_PATH));
    },
    flush: () => versions.flush(),
  };
}
