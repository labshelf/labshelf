// Resolves the path of a Typst json() call to the value file it names in labshelf.yaml.
import * as path from "node:path";

import { valueFilePath } from "@labshelf/core/node";
import type { ReadyProject } from "../mainDocument.js";

/** The listed value file a `json("…")` path in a .typ file reads, relative to the project folder; undefined when `values:` does not list it. */
export function listedValueFile(project: ReadyProject, typFile: string, source: string): string | undefined {
  // PLATFORM: Typst resolves a path from the .typ file's folder, and a leading `/` from the project root.
  const absolute = source.startsWith("/") ? path.join(project.folder, source) : path.resolve(path.dirname(typFile), source);
  const relative = valueFilePath(path.relative(project.folder, absolute));
  return project.settings.values?.some((listed) => valueFilePath(listed) === relative) ? relative : undefined;
}
