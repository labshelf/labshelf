// Builds a project of value files held in memory and the workspace the value providers read.
import * as path from "node:path";
import * as vscode from "vscode";

import { deriveProjectValueLeaves, type ProjectSettings } from "@labshelf/core";
import { ProjectValues } from "../../src/writing/citations/projectValues";
import { fakeLogger, fakeProjects, readyEntry } from "./writingFixtures";

const FOLDER = path.join(path.sep, "projects", "paper");

export function valuesFixture(files: Record<string, string>, settings: Partial<ProjectSettings> = {}) {
  const contents = new Map(Object.entries(files));
  const folder = FOLDER;
  const format = settings.format ?? "latex";
  const entry = readyEntry(folder, { main: format === "latex" ? "main.tex" : "main.typ", settings: { id: "paper", format, values: ["results.json"], ...settings } });
  const changes = new vscode.EventEmitter<void>();
  const projects = Object.assign(fakeProjects([entry]), { onDidChange: changes.event });
  projects.data.readProjectValues.mockImplementation(async (project: { settings: ProjectSettings }) =>
    (project.settings.values ?? []).flatMap((listed) => {
      // The port skips a file it cannot read or parse.
      try { return deriveProjectValueLeaves(listed, JSON.parse(contents.get(listed) ?? "")).leaves; } catch { return []; }
    }));
  const logger = fakeLogger();
  const values = new ProjectValues({ projects, logger: () => logger });
  return { folder, projects, changes, logger, values, source: (name: string) => path.join(folder, name), writeFile: (name: string, text: string) => { contents.set(name, text); } };
}
