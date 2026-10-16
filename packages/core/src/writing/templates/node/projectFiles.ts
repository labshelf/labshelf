// Lists the files of a writing project that a template keeps, leaving out per-device state and build output.
import { PROJECT_FILE } from "../../project/index.js";
import { walkFolder, type FoundFile } from "./walkFolder.js";

// Per-device and per-draft state that a new project must not inherit.
const EXCLUDED_PATHS = new Set([
  PROJECT_FILE, ".labshelf/versions", ".labshelf/rebuttal", ".labshelf/comments.json", ".labshelf/state.json", ".labshelf/checklist.json",
]);

// Both builds copy the PDF next to each root source file, so a PDF with a same-named source beside it is build output.
function withoutBuiltPdfs(files: FoundFile[]): FoundFile[] {
  const paths = new Set(files.map((f) => f.path));
  return files.filter(({ path: p }) => {
    if (!p.endsWith(".pdf")) { return true; }
    const base = p.slice(0, -".pdf".length);
    return !paths.has(`${base}.tex`) && !paths.has(`${base}.typ`);
  });
}

/** The kept files of the project folder; `.git` is skipped, and a symbolic link or special file throws naming its path. */
export async function listProjectFiles(folder: string): Promise<FoundFile[]> {
  return withoutBuiltPdfs(await walkFolder(folder, (rel, name) => name === ".git" || EXCLUDED_PATHS.has(rel)));
}
