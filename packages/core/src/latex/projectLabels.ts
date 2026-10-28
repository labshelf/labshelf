// Indexes the labels of a project's `.tex` files for reference completion, rescanning a file once its edits pause.

import { createKeyedDebouncer } from "../async/index.js";
import type { ILogger } from "../ports/index.js";
import { scanLatexSource } from "./source.js";

export interface ProjectLabel { name: string; file: string }

export interface ProjectLabels {
  labels(): readonly ProjectLabel[];
  /** Scans every `.tex` file the project lists; a file that cannot be read is logged and skipped. */
  load(files: readonly string[], read: (file: string) => Promise<string>): Promise<void>;
  /** Rescans `file` with its text read at the end of the pause, `SCAN_DELAY_MS` after the last call. */
  schedule(file: string, text: () => string): void;
  dispose(): void;
}

const SCAN_DELAY_MS = 300;
const MODULE = "editor.labelIndex";

export function createProjectLabels(logger: ILogger): ProjectLabels {
  const byFile = new Map<string, ProjectLabel[]>();
  const pendingText = new Map<string, () => string>();
  let all: ProjectLabel[] = [];
  const scan = (file: string, text: string): void => {
    byFile.set(file, scanLatexSource(text).labels.map((label) => ({ name: label.name, file })));
    all = [...byFile.values()].flat();
  };
  const scanLater = createKeyedDebouncer<string>(SCAN_DELAY_MS, (file) => {
    const text = pendingText.get(file);
    pendingText.delete(file);
    if (text) { scan(file, text()); }
  });
  return {
    labels: () => all,
    async load(files, read) {
      await Promise.all(files.filter((file) => file.endsWith(".tex")).map(async (file) => {
        try { scan(file, await read(file)); } catch (error) {
          void logger.error(MODULE, error, { action: "scanLabels", file });
        }
      }));
    },
    schedule(file, text) {
      pendingText.set(file, text);
      scanLater.call(file);
    },
    dispose() { scanLater.dispose(); pendingText.clear(); },
  };
}
