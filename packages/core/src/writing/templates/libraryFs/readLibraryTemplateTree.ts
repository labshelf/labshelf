// Reads every file of a template folder in the library after checking the whole tree against the path rules.
// CONTRACT: documents/contracts/templates.md#paths
import type { LibraryFileSystem } from "../../../ports/index.js";
import type { PathOps } from "../../../library/index.js";
import { templateTreeProblem } from "../manifest/index.js";
import type { TemplateFile } from "../sources/index.js";
import { walkLibraryFolder } from "./walkLibraryFolder.js";

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
export async function readLibraryTemplateTree(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<TemplateFile[]> {
  const found = await walkLibraryFolder(fs, paths, folder);
  const problem = templateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: await fs.readFile(file.absolute) })));
}
