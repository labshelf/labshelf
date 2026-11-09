// Runs the Project chat in the page's right pane: it exists only for a shared project (D2), serves that project's .labshelf/chat.qmd
// through the core server and page source joined in one page, and is read-only in a tab that does not hold the project's share (D7).
// CONTRACT: documents/contracts/qmd-items.md#project-chat
import {
  createLoopbackTransport, createProjectChatPresencePort, createProjectChatStore, createRemoteProjectChat, projectChatFilePath, serveProjectChat,
  type HostToProjectChat, type ILogger, type LibraryFileSystem, type ProjectChatToHost, type ReadyProject,
} from "@labshelf/core";
import { mountProjectChat, showToast } from "@labshelf/core/dom";
import { onMirrorWrites, type PageShare } from "../collab";

/** The ready, shared project with the settings id `projectId` in the page's project list. */
export function findSharedProject(sharing: Pick<PageShare, "ports">, projectId: string): ReadyProject | undefined {
  return sharing.ports.projects.list().find((entry): entry is ReadyProject =>
    entry.kind === "ready" && entry.settings.id === projectId && entry.settings.shared !== undefined);
}

interface PageProjectChatDeps {
  sharing: PageShare;
  fs: LibraryFileSystem;
  logger: ILogger;
}

export interface PageProjectChat {
  /** Shows the chat of the project in front, or none; called when another tab comes to the front. */
  show(projectId: string | undefined): void;
  /** Starts serving chats once the page's project wiring has loaded; before that the pane shows no chat. */
  bind(deps: PageProjectChatDeps): void;
  /** Calls `listener` when the project in front gains or loses its chat. */
  onAvailabilityChange(listener: (available: boolean) => void): () => void;
  dispose(): void;
}

const projectTitle = (project: ReadyProject): string => project.settings.title ?? project.settings.id;
/** Changes when the pane must show another chat: another project, its title, its share, or whether this tab may write it. */
const keyOf = (project: ReadyProject | undefined, canWrite: boolean): string =>
  project ? JSON.stringify([project.folder, projectTitle(project), project.settings.shared, canWrite]) : "";

interface Bound {
  deps: PageProjectChatDeps;
  store: ReturnType<typeof createProjectChatStore>;
  presence: ReturnType<typeof createProjectChatPresencePort>;
  stopProjects: () => void;
}

export function createPageProjectChat(pane: HTMLElement): PageProjectChat {
  const chat = mountProjectChat(pane, { source: null, projectTitle: null });
  const listeners = new Set<(available: boolean) => void>();
  let projectId: string | undefined;
  let bound: Bound | undefined;
  let served: { key: string; stop(): void } = { key: "", stop: () => {} };

  const serve = (project: ReadyProject, canWrite: boolean, { deps, store, presence }: Bound): (() => void) => {
    const { ui, host } = createLoopbackTransport<ProjectChatToHost, HostToProjectChat>();
    const file = projectChatFilePath(project.folder);
    const stop = serveProjectChat({
      end: host, store, projectDir: project.folder, title: projectTitle(project), logger: deps.logger,
      author: () => deps.sharing.shares.name(), canWrite,
      onFileChange: (listener) => onMirrorWrites((paths) => { if (paths.includes(file)) listener(); }),
      presence: presence.presence(project.settings.shared ?? ""),
    });
    chat.setProject(projectTitle(project), createRemoteProjectChat(ui, { onError: (message) => { showToast(message, "error"); } }));
    return stop;
  };

  const refresh = (): void => {
    const project = bound && projectId !== undefined ? findSharedProject(bound.deps.sharing, projectId) : undefined;
    // INVARIANT: only the tab that runs the project's share writes the chat; another tab's write would never reach the members.
    const canWrite = project !== undefined && bound?.deps.sharing.shares.live(project.settings.id) !== undefined;
    const key = keyOf(project, canWrite);
    if (key === served.key) return;
    const had = served.key !== "";
    served.stop();
    served = { key, stop: () => {} };
    if (project && bound) served.stop = serve(project, canWrite, bound);
    else chat.setProject(null, null);
    if (had !== (key !== "")) for (const listener of [...listeners]) listener(key !== "");
  };

  return {
    show(next) { projectId = next; refresh(); },
    bind(deps) {
      const presence = createProjectChatPresencePort({
        presenceOf: (shareId) => deps.sharing.shares.active(shareId)?.presence,
        onConnectionsChange: (listener) => deps.sharing.shares.onChange(listener),
        self: () => deps.sharing.shares.name(),
      });
      const store = createProjectChatStore({ fs: deps.fs, logger: deps.logger, now: () => new Date().toISOString() });
      // A share connecting here or in another tab changes whether this tab may write the chat.
      const stops = [deps.sharing.onProjectsChange(refresh), deps.sharing.shares.onChange(refresh)];
      bound = { deps, store, presence, stopProjects: () => stops.forEach((stop) => stop()) };
      refresh();
    },
    onAvailabilityChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      served.stop();
      bound?.stopProjects();
      bound?.presence.dispose();
      listeners.clear();
      chat.dispose();
    },
  };
}
