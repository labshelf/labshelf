// Copies a picked image into the project's images folder and inserts the figure that shows it; a shared project's mirror shares the copy.
import { formatError, IMAGE_EXTENSIONS, IMAGE_FOLDER, findFreeImageName, deriveImageBaseFolder, createImageSnippet, posixPathOps, type ILogger, type LibraryFileSystem, type ProjectEntry } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import type { SourceUpdates, SourceLanguage } from "../sourceUpdates";

const MODULE = "tabs.source";

export interface ImageInsertion {
  edits: SourceUpdates;
  language: SourceLanguage;
  entry: Extract<ProjectEntry, { kind: "ready" }>;
  /** The edited file, relative to the project folder. */
  path: string;
  fs: LibraryFileSystem;
  logger: ILogger;
}

// PLATFORM: browsers open the file dialog only from the user's click, so the input is clicked before any await.
function pickImage(language: SourceLanguage): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS[language].map((extension) => `.${extension}`).join(",");
    input.addEventListener("change", () => resolve(input.files?.[0]));
    input.addEventListener("cancel", () => resolve(undefined));
    input.click();
  });
}

async function copyIntoProject({ edits, language, entry, path, fs, logger }: ImageInsertion, file: File): Promise<void> {
  const { join, dirname, relative } = posixPathOps;
  const target = await findFreeImageName(posixPathOps, join(entry.folder, IMAGE_FOLDER), file.name, (candidate) => fs.exists(candidate));
  await fs.ensureDir(dirname(target));
  await fs.writeFile(target, new Uint8Array(await file.arrayBuffer()));
  void logger.log("INFO", MODULE, "copied an image into the project", { source: path, image: target });
  const base = deriveImageBaseFolder(language, entry.folder, entry.main, join(entry.folder, path), posixPathOps);
  edits.insertSnippet(createImageSnippet(language, relative(base, target)));
}

export async function addImage(insertion: ImageInsertion): Promise<void> {
  const file = await pickImage(insertion.language);
  if (!file) return;
  try {
    await copyIntoProject(insertion, file);
  } catch (error) {
    void insertion.logger.error(MODULE, error, { source: insertion.path, folder: insertion.entry.folder, action: "insertImage" });
    showToast(`Could not copy the image into the project: ${formatError(error)}`, "error");
  }
}
