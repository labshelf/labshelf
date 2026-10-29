// Remembers the recent "Send to…" targets per device through an injected key-value store, most recent first.
import { isString } from "../../guards/index.js";
import type { SendTarget } from "./sendTo.js";

/** Device-local storage: VS Code `globalState`, browser `chrome.storage.local`; never the library. */
export interface IKeyValueStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }

const MAX_RECENT = 8;

function isSendTarget(value: unknown): value is SendTarget {
  if (typeof value !== "object" || value === null) { return false; }
  const target = value as Record<string, unknown>;
  if (!isString(target.path)) { return false; }
  switch (target.kind) {
    case "projectNote": return isString(target.projectId);
    case "spaceNote":
    case "discussion": return isString(target.spaceId);
    default: return false;
  }
}

function owner(target: SendTarget): string {
  return target.kind === "projectNote" ? target.projectId : target.spaceId;
}

function sameTarget(a: SendTarget, b: SendTarget): boolean {
  return a.kind === b.kind && owner(a) === owner(b) && a.path === b.path;
}

export function createRecentTargets(
  store: IKeyValueStore,
  key: string,
): { list(): Promise<SendTarget[]>; push(target: SendTarget): Promise<void> } {
  const list = async (): Promise<SendTarget[]> => {
    const value = await store.get(key);
    if (!Array.isArray(value) || !value.every(isSendTarget)) { return []; }
    return value.slice(0, MAX_RECENT);
  };
  return {
    list,
    async push(target) {
      const rest = (await list()).filter((entry) => !sameTarget(entry, target));
      await store.set(key, [target, ...rest].slice(0, MAX_RECENT));
    },
  };
}
