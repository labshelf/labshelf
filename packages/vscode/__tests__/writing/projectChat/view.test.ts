// The Project chat view exists only for a shared open project (D2, A1) and serves that project's chat with the collab author over the page channel (A2).
import * as vscode from "vscode";
import type { ProjectChatMessage, ProjectChatPresence, ProjectChatStore, ReadyProject } from "@labshelf/core";
import { projectChatAvailability, provideProjectChatBackend, registerProjectChat } from "../../../src/writing/projectChat/index";

const FOLDER = "/lib/projects/paper";

function project(shared: string | undefined): ReadyProject {
  return { kind: "ready", folder: FOLDER, location: "library", main: "main.tex", settings: { id: "paper", title: "My Paper", ...(shared ? { shared } : {}) } } as unknown as ReadyProject;
}

function fakeView() {
  const listeners: Array<(raw: unknown) => void> = [];
  const posted: unknown[] = [];
  const view = {
    visible: true,
    webview: {
      options: {}, html: "", cspSource: "vscode-resource:",
      asWebviewUri: (uri: unknown) => uri,
      postMessage: jest.fn(async (message: unknown) => { posted.push(message); return true; }),
      onDidReceiveMessage: (listener: (raw: unknown) => void) => {
        listeners.push(listener);
        return { dispose: () => { listeners.splice(listeners.indexOf(listener), 1); } };
      },
    },
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeVisibility: () => ({ dispose: () => {} }),
  };
  return { view, posted, send: (raw: unknown) => [...listeners].forEach((listener) => listener(raw)) };
}

function setup(initial: ReadyProject) {
  let current = initial;
  const projectsChanged = new vscode.EventEmitter<void>();
  const sessionChanged = new vscode.EventEmitter<ReadyProject | undefined>();
  const context = { subscriptions: [] as vscode.Disposable[], extensionUri: vscode.Uri.file("/ext") } as unknown as vscode.ExtensionContext;
  registerProjectChat(context, {
    session: { get project() { return current; }, onDidChange: sessionChanged.event },
    projects: { list: () => [current], onDidChange: projectsChanged.event } as never,
    logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as never,
  });
  const provider = (vscode.window.registerWebviewViewProvider as jest.Mock).mock.calls.at(-1)?.[1] as vscode.WebviewViewProvider;
  return {
    context, provider,
    change(next: ReadyProject) { current = next; projectsChanged.fire(); },
  };
}

const contextValue = (): unknown => (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(([command, key]) => command === "setContext" && key === "labshelf.projectChat.available").at(-1)?.[2];
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function backend(messages: ProjectChatMessage[]) {
  const store = { read: jest.fn(async () => messages), add: jest.fn(async () => "m2"), edit: jest.fn(), remove: jest.fn(), onChange: () => () => {} } as unknown as ProjectChatStore;
  const presence: ProjectChatPresence = { set: jest.fn(), peers: () => [], onChange: () => () => {} };
  return { store, presence, provided: provideProjectChatBackend({ store, author: () => "luca", presence: () => presence }) };
}

afterEach(() => { jest.clearAllMocks(); });

test("an unshared project has no chat: the context key is off, the icon is absent and the page shows no chat", async () => {
  const { provided } = backend([]);
  const { provider, context } = setup(project(undefined));
  expect(contextValue()).toBe(false);
  expect(projectChatAvailability.isAvailable(FOLDER)).toBe(false);
  const page = fakeView();
  await provider.resolveWebviewView(page.view as unknown as vscode.WebviewView, {} as never, {} as never);
  page.send({ type: "ready" });
  expect(page.posted).toContainEqual({ type: "project", key: "", title: null });
  context.subscriptions.forEach((subscription) => subscription.dispose());
  provided.dispose();
});

test("a shared project's chat is served with the collab author and appears and disappears with the share without a reload", async () => {
  const message: ProjectChatMessage = { id: "m1", author: "ana", created: "2026-11-09T10:00:00.000Z", body: "hi" };
  const { store, presence, provided } = backend([message]);
  const { provider, context, change } = setup(project("share-1"));
  expect(contextValue()).toBe(true);
  expect(projectChatAvailability.isAvailable(FOLDER)).toBe(true);

  const page = fakeView();
  await provider.resolveWebviewView(page.view as unknown as vscode.WebviewView, {} as never, {} as never);
  page.send({ type: "ready" });
  expect(page.posted).toContainEqual(expect.objectContaining({ type: "project", title: "My Paper" }));
  page.send({ type: "projectChat.ready" });
  await flush();
  expect(page.posted).toContainEqual({ type: "projectChat.chat", title: "My Paper", author: "luca", canWrite: true, messages: [message] });
  page.send({ type: "projectChat.add", body: "hello" });
  expect(store.add).toHaveBeenCalledWith(FOLDER, "hello", "luca");

  change(project(undefined));
  expect(contextValue()).toBe(false);
  expect(projectChatAvailability.isAvailable(FOLDER)).toBe(false);
  expect(page.posted.at(-1)).toEqual({ type: "project", key: "", title: null });
  await flush();
  expect(presence.set).toHaveBeenLastCalledWith(null);
  context.subscriptions.forEach((subscription) => subscription.dispose());
  provided.dispose();
});
