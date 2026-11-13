// The files a source editor panel's consult windows edit, one session per window key: a text file joins its URI's SourceAuthority as one more client,
// a qmd note takes the notes editor's item edits; a release or the panel's disposal ends each session exactly once.
import * as vscode from "vscode";
import {
  answerConsult, createPaperFiles, formatError,
  type ConsultDocOutbound, type ConsultFileInit, type ConsultInbound, type ConsultIo, type ConsultOutbound, type ConsultRef, type ILogger, type PaperRecord, type ReadyProject,
} from "@labshelf/core";
import type { WritingProjects } from "../writing/projects/index.js";
import { resolveCodeFile } from "../writing/codeSource.js";
import { createDocumentSync } from "../writing/sourceEditor/documentSync.js";
import { lineBreakOf, type SourceAuthorities } from "../writing/sourceEditor/authorities.js";
import { createItemApplier } from "../writing/notesEditor/provider.js";

export interface ConsultFilesDeps {
  post(message: ConsultInbound): void;
  io: ConsultIo;
  /** The panel's project; absent for a file in no project. */
  projectId?: string | undefined;
  projectFolder?: string | undefined;
  projects: Pick<WritingProjects, "list" | "paths">;
  library: { listPapers(): Promise<PaperRecord[]> };
  /** The shared registry of the source editor panels, so one SourceAuthority exists per URI. */
  authorities: SourceAuthorities;
  autosave: { schedule(document: vscode.TextDocument): void };
  logger: ILogger;
}

/** One consult window's open file. */
interface Session {
  receive(message: ConsultDocOutbound): Promise<void>;
  dispose(): void;
}

/** A file named by the window, with the path its init shows. */
interface Target { uri: vscode.Uri; path: string }

const isUnsafePath = (path: string): boolean =>
  path === "" || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes("..");

async function resolveTarget(deps: ConsultFilesDeps, ref: ConsultRef): Promise<Target> {
  switch (ref.kind) {
    case "manuscript":
    case "projectNote": {
      if (isUnsafePath(ref.path)) { throw new Error(`${ref.path} is not a path inside the project.`); }
      const project = deps.projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.settings.id === ref.projectId);
      if (!project) { throw new Error("The project is not open in this workspace."); }
      return { uri: vscode.Uri.file(deps.projects.paths.join(project.folder, ...ref.path.split("/"))), path: ref.path };
    }
    case "paperNotes": {
      const paper = (await deps.library.listPapers()).find((listed) => listed.id === ref.paperId);
      if (!paper) { throw new Error("The paper is not in the library."); }
      return { uri: vscode.Uri.file(createPaperFiles(paper.path, deps.projects.paths.join).notes), path: `${paper.title} notes.qmd` };
    }
    case "code": {
      const root = deps.projectFolder === undefined ? undefined : vscode.Uri.file(deps.projectFolder);
      return { uri: resolveCodeFile(root, ref.path), path: ref.path };
    }
    default:
      throw new Error("This file is not opened as text.");
  }
}

function openText(deps: ConsultFilesDeps, key: string, document: vscode.TextDocument, path: string): { session: Session; file: ConsultFileInit } {
  const { authorities } = deps;
  const authority = authorities.acquire(document);
  const sync = createDocumentSync({
    document, authority, applyEdit: (edit) => vscode.workspace.applyEdit(edit), logger: deps.logger,
    post: (message) => deps.post({ type: "consultDoc", key, message } as ConsultInbound),
  });
  let disposed = false;
  const file: ConsultFileInit = {
    kind: "text", path, text: authority.text().replace(/\r\n/g, "\n"), lineBreak: lineBreakOf(document), version: authority.version, dirty: document.isDirty,
  };
  const session: Session = {
    async receive(message) {
      if (message.type === "push" || message.type === "save") { await sync.receive(message); }
    },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      sync.dispose();
      authorities.release(document);
    },
  };
  return { session, file };
}

function openQmd(deps: ConsultFilesDeps, key: string, document: vscode.TextDocument, path: string): { session: Session; file: ConsultFileInit } {
  const post = (message: { type: "update"; text: string }): void => deps.post({ type: "consultDoc", key, message });
  const apply = createItemApplier(document, deps.logger, deps.autosave, post);
  const target = document.uri.toString();
  let listener: vscode.Disposable | undefined = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === target) { post({ type: "update", text: event.document.getText() }); }
  });
  const session: Session = {
    async receive(message) {
      if (message.type === "saveItem") { apply({ type: "save", itemId: message.itemId, body: message.body }); }
      else if (message.type === "createItem") { apply({ type: "create", itemId: message.itemId, body: message.body }); }
    },
    dispose() {
      listener?.dispose();
      listener = undefined;
    },
  };
  return { session, file: { kind: "qmd", path, text: document.getText() } };
}

export function createConsultFiles(deps: ConsultFilesDeps): { handle(message: ConsultOutbound): Promise<void>; dispose(): void } {
  const sessions = new Map<string, Session>();
  let disposed = false;

  const release = (key: string): void => {
    const session = sessions.get(key);
    sessions.delete(key);
    session?.dispose();
  };

  async function openFile(id: number, key: string, ref: ConsultRef): Promise<void> {
    release(key);
    let opened: { session: Session; file: ConsultFileInit };
    try {
      const target = await resolveTarget(deps, ref);
      const document = await vscode.workspace.openTextDocument(target.uri);
      if (disposed) { return; }
      opened = target.uri.path.toLowerCase().endsWith(".qmd") ? openQmd(deps, key, document, target.path) : openText(deps, key, document, target.path);
    } catch (error) {
      deps.post({ type: "consultFileReply", id, key, file: { error: `Could not open the file: ${formatError(error)}` } });
      return;
    }
    // A second open of the same key while this one was opening wins over this one.
    if (sessions.has(key)) { opened.session.dispose(); return; }
    sessions.set(key, opened.session);
    deps.post({ type: "consultFileReply", id, key, file: opened.file });
  }

  return {
    async handle(message) {
      if (disposed) { return; }
      switch (message.type) {
        case "consult": {
          const context = deps.projectId === undefined ? {} : { projectId: deps.projectId };
          let reply;
          try {
            reply = await answerConsult(deps.io, context, message.request);
          } catch (error) {
            reply = { ok: false as const, error: formatError(error) };
          }
          deps.post({ type: "consultReply", id: message.id, reply });
          return;
        }
        case "consultFile":
          await openFile(message.id, message.key, message.ref);
          return;
        case "consultDoc":
          await sessions.get(message.key)?.receive(message.message);
          return;
        case "consultRelease":
          release(message.key);
          return;
      }
    },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      for (const key of [...sessions.keys()]) { release(key); }
    },
  };
}
