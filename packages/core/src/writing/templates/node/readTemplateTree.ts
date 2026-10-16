/** Reads every file of a template folder from disk after checking the whole tree against the path rules. */
// CONTRACT: documents/contracts/templates.md#paths

import * as fs from "node:fs";

import { templateTreeProblem } from "../manifest/index.js";
import type { TemplateFile } from "../sources/index.js";
import { walkFolder } from "./walkFolder.js";

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
export async function readTemplateTree(folder: string): Promise<TemplateFile[]> {
  const found = await walkFolder(folder);
  // A hard link in an extracted archive can alias a file outside the template.
  const linked = found.find((file) => file.nlink > 1);
  if (linked !== undefined) { throw new Error(`"${linked.path}" is a hard link`); }
  const problem = templateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: new Uint8Array(await fs.promises.readFile(file.absolute)) })));
}
