// Keeps the preview's check limits: the words of a root, the limits a reader change writes and the finding count of the last check.
import {
  readLatexProjectSources, deriveReadingOrderTexts, countWordsUpTo,
  type CheckLimitsChange, type ProjectSourceReader,
} from "@labshelf/core";
import type { ReadyProject } from "../commands/index.js";
import type { WritingProjects } from "../projects/index.js";

interface RootWordsDeps {
  /** Reads the files of a project folder, open editors first. */
  readerFor(folder: string): ProjectSourceReader;
}

/** `root` is the project-relative path of the root file. A Typst root counts as its own file, since its includes are not followed. */
export async function countBuildRootWords(deps: RootWordsDeps, project: ReadyProject, root: string): Promise<number> {
  const countUpTo = project.settings.check?.countUpTo ?? "references";
  const reader = deps.readerFor(project.folder);
  if (project.settings.format === "typst") {
    const text = await reader.read(root);
    return text === undefined ? 0 : countWordsUpTo([{ text }], countUpTo);
  }
  const texts = new Map<string, string>();
  const tree = await readLatexProjectSources(root, {
    read: async (path) => {
      const text = await reader.read(path);
      if (text !== undefined) { texts.set(path, text); }
      return text;
    },
  });
  return countWordsUpTo(deriveReadingOrderTexts(tree.files, texts), countUpTo);
}

/** A number sets a limit, null removes it, and an absent field keeps what the file holds. */
export async function setCheckLimits(
  projects: Pick<WritingProjects, "data" | "reload">,
  project: ReadyProject,
  change: CheckLimitsChange,
): Promise<void> {
  const check: { pages?: number | undefined; words?: number | undefined; countUpTo?: "references" | "end" } = {};
  if (change.pages !== undefined) { check.pages = change.pages ?? undefined; }
  if (change.words !== undefined) { check.words = change.words ?? undefined; }
  if (change.countUpTo !== undefined) { check.countUpTo = change.countUpTo; }
  await projects.data.updateProjectSettings(project.folder, { check });
  await projects.reload();
}

/** The finding count of each project's last check, kept so the preview can show it. */
export class CheckCounts {
  private readonly counts = new Map<string, number>();
  private readonly listeners = new Set<(folder: string) => void>();

  record(folder: string, count: number): void {
    this.counts.set(folder, count);
    for (const listener of this.listeners) { listener(folder); }
  }

  /** Undefined until the project has been checked in this session. */
  get(folder: string): number | undefined {
    return this.counts.get(folder);
  }

  onChange(listener: (folder: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
}
