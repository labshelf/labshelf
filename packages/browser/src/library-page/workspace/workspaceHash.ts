// Writes and reads the page hash that lists the open tabs and the active one (`#/tabs/library,templates;active=library`).
import { PAPERS_DIR } from "@labshelf/core";

const TABS_PREFIX = "#/tabs/";
const ACTIVE_MARK = ";active=";

export interface WorkspaceHashState {
  tabs: string[];
  active: string | null;
}

export function formatWorkspaceHash({ tabs, active }: WorkspaceHashState): string {
  return `${TABS_PREFIX}${tabs.map(encodeURIComponent).join(",")}${active === null ? "" : ACTIVE_MARK + encodeURIComponent(active)}`;
}

const decode = (part: string): string | null => {
  try { return decodeURIComponent(part); } catch { return null; }
};

/** Reads a tabs hash; null for any other hash. A badly encoded id is dropped, and so is an active id that is not open. */
export function parseWorkspaceHash(hash: string): WorkspaceHashState | null {
  if (!hash.startsWith(TABS_PREFIX)) return null;
  const body = hash.slice(TABS_PREFIX.length);
  const split = body.indexOf(ACTIVE_MARK);
  const list = split === -1 ? body : body.slice(0, split);
  const tabs = list.split(",").filter((part) => part !== "").flatMap((part) => decode(part) ?? []);
  const active = split === -1 ? null : decode(body.slice(split + ACTIVE_MARK.length));
  return { tabs, active: active !== null && tabs.includes(active) ? active : null };
}

/** True for a folder deep link (`#/papers/...`), the hash the library router writes. */
export const isFolderHash = (hash: string): boolean => hash === `#/${PAPERS_DIR}` || hash.startsWith(`#/${PAPERS_DIR}/`);
