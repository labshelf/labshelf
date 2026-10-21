// Writes a Space as space.json bytes that every app produces identically.
// CONTRACT: documents/contracts/spaces.md#writing
import { SPACE_FORMAT_VERSION } from "./types.js";
import type { Space, SpaceDate, SpaceFolder, SpacePaperRef } from "./types.js";
import { withUnknownKeys } from "./json/index.js";

const folderJson = (folder: SpaceFolder) => withUnknownKeys({ id: folder.id, name: folder.name, parent: folder.parent }, folder.extra);

const paperJson = (paper: SpacePaperRef) => withUnknownKeys(
  { id: paper.id, folder: paper.folder, addedAt: paper.addedAt, focus: paper.focus ? true : undefined }, paper.extra,
);

function dateJson(date: SpaceDate): Record<string, unknown> {
  const known: Record<string, unknown> = { id: date.id, kind: date.kind, title: date.title, date: date.date };
  if (date.kind === "task") { known["done"] = date.done; }
  if (date.kind === "read") { known["paperIds"] = date.paperIds; }
  if (date.kind === "project") { known["projectId"] = date.projectId; }
  return withUnknownKeys(known, date.extra);
}

export function serializeSpaceFile(space: Space): string {
  const doc = withUnknownKeys({
    version: SPACE_FORMAT_VERSION, name: space.name, purpose: space.purpose, createdAt: space.createdAt,
    folders: [...space.folders.map(folderJson), ...space.invalid.folders],
    papers: [...space.papers.map(paperJson), ...space.invalid.papers],
    projects: [...space.projects, ...space.invalid.projects],
    dates: [...space.dates.map(dateJson), ...space.invalid.dates],
  }, space.extra);
  return `${JSON.stringify(doc, null, 2)}\n`;
}
