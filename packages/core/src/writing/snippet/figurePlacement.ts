// Decides where a figure's image file lives in a writing project and which file types a picker offers.
import type { PathOps } from "../../library/mutations/index.js";

type WritingLanguage = "latex" | "typst";

export const IMAGE_FOLDER = "images";

export const IMAGE_EXTENSIONS: Record<WritingLanguage, string[]> = {
  latex: ["png", "jpg", "jpeg", "pdf", "eps"],
  typst: ["png", "jpg", "jpeg", "gif", "svg"],
};

/** The first path in `folder` for `deriveFileName` that does not exist: `stem.ext`, `stem-2.ext`, `stem-3.ext`, ... */
export async function freeImageName(
  paths: Pick<PathOps, "join" | "extname" | "basename">,
  folder: string,
  fileName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const extension = paths.extname(fileName);
  const stem = paths.basename(fileName, extension);
  let target = paths.join(folder, stem + extension);
  for (let suffix = 2; await exists(target); suffix += 1) {
    target = paths.join(folder, `${stem}-${suffix}${extension}`);
  }
  return target;
}

/** LaTeX resolves graphics from the main file's folder; Typst from the folder of the file that names the image. */
export function imageBaseFolder(
  language: WritingLanguage,
  projectFolder: string,
  main: string | undefined,
  documentPath: string,
  paths: Pick<PathOps, "join" | "dirname">,
): string {
  if (language === "latex" && main) { return paths.dirname(paths.join(projectFolder, main)); }
  return paths.dirname(documentPath);
}
