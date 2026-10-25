// Keeps the labels of a project's LaTeX files current, rescanning only the edited file after a pause.
import { scanLatexSource, type ILogger } from "@labshelf/core";

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
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let all: ProjectLabel[] = [];
  const scan = (file: string, text: string): void => {
    byFile.set(file, scanLatexSource(text).labels.map((label) => ({ name: label.name, file })));
    all = [...byFile.values()].flat();
  };
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
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => { timers.delete(file); scan(file, text()); }, SCAN_DELAY_MS));
    },
    dispose() { timers.forEach((timer) => clearTimeout(timer)); timers.clear(); },
  };
}
