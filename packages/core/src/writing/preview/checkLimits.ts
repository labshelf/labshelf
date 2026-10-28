// Holds a project's check limits as the preview carries them, the words of a root the word limit is held to, and the labshelf.yaml patch a reader's limits change writes.
import { readLatexProjectTexts, type ProjectSourceReader } from "../../latex/index.js";
import type { CheckLimitsChange } from "../../reader/index.js";
import { deriveReadingOrderTexts, countWordsUpTo } from "../checks/index.js";
import type { ProjectSettings, ProjectSettingsUpdate } from "../project/index.js";

/** The check limits of the project's labshelf.yaml; an undefined field is unset. */
export type PreviewLimits = NonNullable<ProjectSettingsUpdate["check"]>;

/** A number sets a limit, null removes it (undefined in the patch), and an absent field keeps what the file holds. */
export function deriveCheckLimitsPatch(change: CheckLimitsChange): PreviewLimits {
  const check: PreviewLimits = {};
  if (change.pages !== undefined) { check.pages = change.pages ?? undefined; }
  if (change.words !== undefined) { check.words = change.words ?? undefined; }
  if (change.countUpTo !== undefined) { check.countUpTo = change.countUpTo; }
  return check;
}

/** `root` is the project-relative path of the root file. A Typst root counts as its own file, since its includes are not followed. */
export async function countBuildRootWords(reader: ProjectSourceReader, settings: Pick<ProjectSettings, "format" | "check">, root: string): Promise<number> {
  const countUpTo = settings.check?.countUpTo ?? "references";
  if (settings.format === "typst") {
    const text = await reader.read(root);
    return text === undefined ? 0 : countWordsUpTo([{ text }], countUpTo);
  }
  const tree = await readLatexProjectTexts(root, reader);
  return countWordsUpTo(deriveReadingOrderTexts(tree.files, tree.texts), countUpTo);
}
