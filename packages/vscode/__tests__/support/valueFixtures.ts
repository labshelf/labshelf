// Builds a project folder of value files on disk and the workspace the value providers read.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectSettings } from "@labshelf/core";
import { ProjectValues } from "../../src/writing/values/projectValues";
import { fakeLogger, fakeProjects, readyEntry } from "./writingFixtures";

const folders: string[] = [];

export function removeValueFolders(): void {
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
}

export function valuesFixture(files: Record<string, string>, settings: Partial<ProjectSettings> = {}) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "labshelf-values-"));
  folders.push(folder);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    writeFileSync(path.join(folder, name), text);
  }
  const format = settings.format ?? "latex";
  const entry = readyEntry(folder, { main: format === "latex" ? "main.tex" : "main.typ", settings: { id: "paper", format, values: ["results.json"], ...settings } });
  const changes = new vscode.EventEmitter<void>();
  const projects = Object.assign(fakeProjects([entry]), { onDidChange: changes.event });
  const logger = fakeLogger();
  const values = new ProjectValues({ projects, logger: () => logger });
  return { folder, projects, changes, logger, values, source: (name: string) => path.join(folder, name) };
}
