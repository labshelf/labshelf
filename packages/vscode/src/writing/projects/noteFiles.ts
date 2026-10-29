// The file port of the project notes store: a project's `notes/*.qmd` files on the project disk.
import type { IProjectNoteFiles } from "@labshelf/core";
import type { WritingProjects } from "./session.js";

const NOTES_DIR = "notes";

export function createProjectNoteFiles(projects: Pick<WritingProjects, "fs" | "paths" | "list">): IProjectNoteFiles {
  const { fs, paths } = projects;
  const folderOf = (projectId: string): string => {
    const folder = projects.list().find((entry) => entry.kind === "ready" && entry.settings.id === projectId)?.folder;
    if (folder === undefined) { throw new Error(`No open project has the id ${projectId}`); }
    return folder;
  };
  return {
    async list(projectId) {
      const dir = paths.join(folderOf(projectId), NOTES_DIR);
      if (!(await fs.exists(dir))) { return []; }
      const names = await fs.listDir(dir);
      return names.filter((name) => name.endsWith(".qmd")).map((name) => `${NOTES_DIR}/${name}`);
    },
    async read(projectId, path) {
      const file = paths.join(folderOf(projectId), path);
      return (await fs.exists(file)) ? await fs.readText(file) : null;
    },
    async write(projectId, path, text) {
      const file = paths.join(folderOf(projectId), path);
      await fs.ensureDir(paths.dirname(file));
      await fs.writeText(file, text);
    },
  };
}
