// The VS Code "Send to…" of the reader: picks a project note (or a new one) and appends the quoted passage with its page link.
import * as vscode from "vscode";

import {
  createProjectNoteWriter, createRecentTargets, deriveSendTargetChoices, sendTo,
  type IKeyValueStore, type ILogger, type IProjectAssetWriter, type ProjectNotesStore, type ReadyProject, type SendTarget, type SendTargetChoice,
} from "@labshelf/core";
import type { WritingProjects } from "../writing/projects/index.js";

export const SEND_TO_RECENT_KEY = "labshelf.sendTo.recent";

export interface ReaderSendToDeps {
  projects: WritingProjects;
  notes: ProjectNotesStore;
  recent: ReturnType<typeof createRecentTargets>;
  logger: ILogger;
  newItemId(): string;
}

export type SendToNoteRequest = { key: string; page: number; text: string };

/** Device-local recent targets over a VS Code Memento (`context.globalState`). */
export function createMementoKeyValueStore(memento: vscode.Memento): IKeyValueStore {
  return {
    get: (key) => Promise.resolve(memento.get<unknown>(key)),
    set: async (key, value) => { await memento.update(key, value); },
  };
}

function readyProjects(projects: WritingProjects): ReadyProject[] {
  return projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready");
}

function projectFolder(projects: WritingProjects, projectId: string): string {
  const folder = readyProjects(projects).find((entry) => entry.settings.id === projectId)?.folder;
  if (folder === undefined) { throw new Error(`No open project has the id ${projectId}`); }
  return folder;
}

function noteFileUri(projects: WritingProjects, projectId: string, path: string): vscode.Uri {
  return vscode.Uri.file(projects.paths.join(projectFolder(projects, projectId), ...path.split("/")));
}

function createAssetWriter(projects: WritingProjects): IProjectAssetWriter {
  return {
    async write(projectId, path, bytes) {
      const file = projects.paths.join(projectFolder(projects, projectId), ...path.split("/"));
      await projects.fs.ensureDir(projects.paths.dirname(file));
      await projects.fs.writeFile(file, bytes);
    },
  };
}

type ChoiceItem = vscode.QuickPickItem & { choice?: SendTargetChoice };

function toItems(choices: readonly SendTargetChoice[]): ChoiceItem[] {
  const items: ChoiceItem[] = [];
  const recent = choices.filter((choice) => choice.kind === "target" && choice.recent);
  if (recent.length > 0) {
    items.push({ label: "Recent", kind: vscode.QuickPickItemKind.Separator });
    for (const choice of recent) { items.push({ label: choice.label, description: choice.description, choice }); }
  }
  let group: string | undefined;
  for (const choice of choices) {
    if (choice.kind === "target" && choice.recent) { continue; }
    if (choice.description !== group) {
      group = choice.description;
      items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({ label: choice.label, description: choice.description, choice });
  }
  return items;
}

/** The title of the note a target points at, for the success notice. */
async function noteTitle(deps: ReaderSendToDeps, target: Extract<SendTarget, { kind: "projectNote" }>): Promise<string> {
  const notes = await deps.notes.list(target.projectId);
  return notes.find((note) => note.path === target.path)?.title ?? target.path;
}

/** Turns a picked choice into a project note target; a new note is asked for and created first. @returns undefined when cancelled. */
async function resolveTarget(deps: ReaderSendToDeps, choice: SendTargetChoice): Promise<Extract<SendTarget, { kind: "projectNote" }> | undefined> {
  if (choice.kind === "target") {
    return choice.target.kind === "projectNote" ? choice.target : undefined;
  }
  const title = (await vscode.window.showInputBox({ prompt: "Note title" }))?.trim(); // D16: QMD_VOCABULARY.item
  if (!title) { return undefined; }
  const path = await deps.notes.create(choice.projectId, title);
  return { kind: "projectNote", projectId: choice.projectId, path };
}

/**
 * Errors propagate so the reader host notifies "Failed to send: …"; a cancel at any step does nothing.
 * @returns the reader's sendToNote port over the window's writing projects.
 */
export function createSendToNote(deps: ReaderSendToDeps): (request: SendToNoteRequest) => Promise<void> {
  const send = sendTo(
    { projectNote: createProjectNoteWriter(deps.notes, createAssetWriter(deps.projects)) },
    { logger: deps.logger, newItemId: () => deps.newItemId() },
  );
  return async ({ key, page, text }) => {
    const ready = readyProjects(deps.projects);
    if (ready.length === 0) {
      void vscode.window.showInformationMessage("Send to is not available here");
      return;
    }
    const projects = await Promise.all(ready.map(async (project) => ({
      projectId: project.settings.id,
      name: project.settings.title ?? project.settings.id,
      notes: await deps.notes.list(project.settings.id),
    })));
    const choices = deriveSendTargetChoices(await deps.recent.list(), projects);
    const picked = await vscode.window.showQuickPick(toItems(choices), { title: "Send to…", placeHolder: "Pick a note" }); // D16: QMD_VOCABULARY.item
    if (!picked?.choice) { return; }
    const target = await resolveTarget(deps, picked.choice);
    if (!target) { return; }
    await send({ target, payload: { kind: "quote", key, page, text } });
    await deps.recent.push(target);
    const open = "Open";
    void vscode.window.showInformationMessage(`Sent to ${await noteTitle(deps, target)}`, open).then(async (answer) => {
      if (answer === open) { await vscode.window.showTextDocument(noteFileUri(deps.projects, target.projectId, target.path)); }
    });
  };
}
