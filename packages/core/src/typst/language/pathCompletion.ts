// Completes project file paths inside the string argument of image, include, import, bibliography and the data loaders.
import type { ProjectFiles } from "./project/index.js";
import { relativeTypstPath } from "./project/index.js";
import type { TypstCursorContext } from "./syntax/index.js";
import type { TypstCompletions } from "./typstLanguageSpec.js";

/** The file extensions each path-taking call accepts; an empty list accepts any file. */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"],
  read: [],
  csv: ["csv"],
  json: ["json"],
  yaml: ["yaml", "yml"],
  toml: ["toml"],
  xml: ["xml"],
  cbor: ["cbor"],
  bibliography: ["bib", "yaml", "yml"],
  include: ["typ"],
  import: ["typ"],
};

/** Paths relative to the current file, or null when the string is not a path argument. */
export async function pathCompletions(files: ProjectFiles, string: NonNullable<TypstCursorContext["string"]>, offset: number): Promise<TypstCompletions | null> {
  const extensions = string.call === undefined ? undefined : EXTENSIONS[string.call];
  if (!extensions) { return null; }
  const current = files.current.path;
  const fits = (path: string) => extensions.length === 0 || extensions.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
  const options = (await files.list())
    .filter((path) => path !== current && fits(path))
    .map((path) => {
      const relative = relativeTypstPath(current, path);
      return { label: relative, kind: "file" as const, insert: relative, snippet: false };
    });
  return { from: string.from, to: offset, options };
}
