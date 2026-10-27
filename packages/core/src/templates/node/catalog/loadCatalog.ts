/** Reads every template folder of a catalog checkout into index entries, collecting a problem for each folder that breaks the rules. */
// CONTRACT: documents/contracts/templates.md#community-catalog

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseTemplateManifest, type CatalogAsset, type CatalogEntry } from "../../templateManifest/index.js";
import { readTemplateTree } from "../readTemplateTree.js";
import { readPreviews } from "./readPreviews.js";
import { formatError } from "../../../errors/index.js";

export interface CatalogProblem { id: string; reason: string }
export interface LoadedCatalog { entries: CatalogEntry[]; problems: CatalogProblem[] }

const describe = (bytes: Uint8Array): CatalogAsset => ({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });

/** The index entry of one template folder; throws a reason naming what is wrong. */
async function loadTemplate(folder: string, id: string): Promise<CatalogEntry> {
  const manifest = parseTemplateManifest(await fs.promises.readFile(path.join(folder, "template.yaml"), "utf8").catch(() => ""));
  if (!manifest.ok) { throw new Error(manifest.reason); }
  if (manifest.manifest.id !== id) { throw new Error(`id: "${manifest.manifest.id}" differs from the folder name "${id}"`); }
  const files = await readTemplateTree(path.join(folder, "files"));
  if (!files.some((file) => file.path === manifest.manifest.main)) { throw new Error("main: is not among files"); }
  const previews = await readPreviews(path.join(folder, "preview"));
  if ("problem" in previews) { throw new Error(previews.problem); }
  return {
    ...manifest.manifest,
    files: files.map((file) => ({ path: file.path, ...describe(file.bytes) })),
    thumbnail: describe(previews.value.thumbnail),
    sample: describe(previews.value.sample),
  };
}

async function templateFolders(root: string): Promise<string[] | undefined> {
  const found = await fs.promises.readdir(path.join(root, "templates"), { withFileTypes: true }).catch(() => undefined);
  return found?.filter((item) => item.isDirectory()).map((item) => item.name).sort();
}

/** Loads `<root>/templates/<id>/` for every id, sorted by id; a missing templates folder is one problem with an empty id. */
export async function loadCatalog(root: string): Promise<LoadedCatalog> {
  const ids = await templateFolders(root);
  if (ids === undefined) { return { entries: [], problems: [{ id: "", reason: "templates: folder is missing" }] }; }
  const result: LoadedCatalog = { entries: [], problems: [] };
  for (const id of ids) {
    try { result.entries.push(await loadTemplate(path.join(root, "templates", id), id)); } catch (error) {
      result.problems.push({ id, reason: formatError(error) });
    }
  }
  return result;
}
