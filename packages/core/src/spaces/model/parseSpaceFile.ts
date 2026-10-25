// Reads space.json text into a Space without ever throwing: broken files become unreadable, newer versions and wrong-typed keys read-only.
// CONTRACT: documents/contracts/spaces.md#reading
import type { SpaceReadResult } from "./space.js";
import { isNonEmptyString, isRecord, isString, readEntries, topLevelReadOnlyReason, unknownKeys } from "./json/index.js";
import { parseDate, parseFolder, parsePaperRef, readProjectIds } from "./parseSpaceEntries.js";
import { resolveSpaceReferences } from "./resolveSpaceReferences.js";

const SPACE_KEYS = ["version", "name", "purpose", "createdAt", "folders", "papers", "projects", "dates"];

/** `where.id` is the Space's folder name; `where.path` is echoed back so the caller can show and fix the file. */
export function parseSpaceFile<P>(text: string, where: { readonly id: string; readonly path: P }): SpaceReadResult<P> {
  const { id, path } = where;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { state: "unreadable", id, path, reason: `space.json is not valid JSON: ${(error as Error).message}` };
  }
  if (!isRecord(raw)) { return { state: "unreadable", id, path, reason: "space.json is not a JSON object" }; }

  const warnings: string[] = [];
  const { name, purpose, createdAt } = raw;
  const folders = readEntries(raw["folders"], "folders", parseFolder, warnings);
  const papers = readEntries(raw["papers"], "papers", parsePaperRef, warnings);
  const projects = readProjectIds(raw["projects"], warnings);
  const dates = readEntries(raw["dates"], "dates", parseDate, warnings);
  const space = {
    id, name: isNonEmptyString(name) ? name : id,
    ...(isString(purpose) ? { purpose } : {}), ...(isString(createdAt) ? { createdAt } : {}),
    ...resolveSpaceReferences(folders.valid, papers.valid, warnings),
    projects: projects.valid,
    dates: dates.valid,
    invalid: { folders: folders.raw, papers: papers.raw, projects: projects.raw, dates: dates.raw },
    extra: unknownKeys(raw, SPACE_KEYS),
  };
  const readOnlyReason = topLevelReadOnlyReason(raw, "space.json");
  return { state: "ready", path, space, warnings, ...(readOnlyReason === undefined ? {} : { readOnlyReason }) };
}
