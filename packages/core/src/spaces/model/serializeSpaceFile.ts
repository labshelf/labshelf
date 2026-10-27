// Writes a Space as space.json bytes that every app produces identically.
// CONTRACT: documents/contracts/spaces.md#reading-and-writing
import { SPACE_FORMAT_VERSION } from "./space.js";
import type { Space, SpaceDate, SpaceFolder, SpaceReference } from "./space.js";
import { withUnknownFields } from "./unknownFields.js";

const folderJson = (folder: SpaceFolder) => withUnknownFields({ id: folder.id, name: folder.name, parent: folder.parent }, folder.extra);

const paperJson = (paper: SpaceReference) => withUnknownFields(
  { id: paper.id, folder: paper.folder, addedAt: paper.addedAt, focus: paper.focus ? true : undefined }, paper.extra,
);

function dateJson(date: SpaceDate): Record<string, unknown> {
  const known: Record<string, unknown> = { id: date.id, kind: date.kind, title: date.title, date: date.date };
  if (date.kind === "task") { known["done"] = date.done; }
  if (date.kind === "read") { known["paperIds"] = date.paperIds; }
  if (date.kind === "project") { known["projectId"] = date.projectId; }
  return withUnknownFields(known, date.extra);
}

export function serializeSpaceFile(space: Space): string {
  const doc = withUnknownFields({
    version: SPACE_FORMAT_VERSION, name: space.name, purpose: space.purpose, createdAt: space.createdAt,
    folders: [...space.folders.map(folderJson), ...space.invalid.folders],
    papers: [...space.papers.map(paperJson), ...space.invalid.papers],
    projects: [...space.projects, ...space.invalid.projects],
    dates: [...space.dates.map(dateJson), ...space.invalid.dates],
  }, space.extra);
  return `${JSON.stringify(doc, null, 2)}\n`;
}
