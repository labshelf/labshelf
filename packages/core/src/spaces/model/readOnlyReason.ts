// Gives the reason a space.json or glossary.json must not be written: a version it cannot write or a known key of the wrong type.
// CONTRACT: documents/contracts/spaces.md#reading-and-writing
import { SPACE_FORMAT_VERSION } from "./space.js";
import { isOptional, isString } from "../../guards/index.js";

const TOP_LEVEL_CHECKS = {
  "space.json": { arrays: ["folders", "papers", "projects", "dates"], strings: ["name", "purpose", "createdAt"] },
  "glossary.json": { arrays: ["terms"], strings: [] },
} as const;

/** A missing version reads as 1. */
export function deriveTopLevelReadOnlyReason(raw: Record<string, unknown>, file: keyof typeof TOP_LEVEL_CHECKS): string | undefined {
  const version = raw["version"];
  if (version !== undefined && typeof version !== "number") {
    return `${file} has a version that is not a number, so it is read-only. Fix version to edit it.`;
  }
  if (typeof version === "number" && version > SPACE_FORMAT_VERSION) {
    return `${file} has version ${version}; this LabShelf writes version 1 only, so the Space is read-only. Update LabShelf to edit it.`;
  }
  const { arrays, strings } = TOP_LEVEL_CHECKS[file];
  const wrong = [
    ...arrays.filter((key) => !isOptional(raw[key], Array.isArray)),
    ...strings.filter((key) => !isOptional(raw[key], isString)),
  ];
  if (wrong.length === 0) { return undefined; }
  return `${file} has ${wrong.join(", ")} of the wrong type, so it is read-only. Fix ${wrong.length === 1 ? "it" : "them"} to edit it.`;
}
