/** Stores the user's description of one file in a paper folder under the `files` key of metadata.yaml. */
import type { PaperRecord } from "../../model/index.js";
import { readPaperOnDisk, writePaperRecord, type MutationContext } from "../mutations/index.js";
import { describePaperFile } from "./describePaperFile.js";
import { isHiddenPaperEntry } from "./hiddenEntries.js";

/**
 * Sets (trimmed) or clears the description of `name`, dropping descriptions of names missing from the folder.
 * @returns the paper as written, or undefined when the folder holds no paper
 * @throws when `name` is not a visible entry of the paper folder
 */
export async function describePaperFileOnDisk(
  ctx: MutationContext,
  folder: string,
  name: string,
  description: string,
): Promise<PaperRecord | undefined> {
  const current = await readPaperOnDisk(ctx, folder);
  if (!current) { return undefined; }
  const onDisk = (await ctx.fs.listDir(folder)).filter((entry) => !isHiddenPaperEntry(entry));
  const files = isHiddenPaperEntry(name) ? undefined : describePaperFile(current.files, name, description, onDisk);
  if (!files) { throw new Error(`Cannot describe "${name}": it is not a file of the paper in ${folder}`); }
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  const written = await writePaperRecord(ctx, { ...current, files }, { ownsStatus: true });
  await ctx.logger.log("INFO", "paperFiles", "File description saved", { id: current.id, name, cleared: !description.trim() });
  return written;
}
