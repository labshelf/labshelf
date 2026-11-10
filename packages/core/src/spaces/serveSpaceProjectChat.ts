// Serves the Project chat of a shared project linked to the open Space over the Spaces channel, one chat at a time, as the page opens and closes it.
import { formatError } from "../errors/index.js";
import { createLoopbackTransport } from "../libraryUi/protocol/transport.js";
import type { ILogger } from "../ports/index.js";
import type { HostToProjectChat, ProjectChatHostEnd, ProjectChatToHost } from "../projectChat/projectChatProtocol.js";
import { serveProjectChat } from "../projectChat/serveProjectChat.js";
import type { SpaceProjectChat, SpacesHostPort } from "./spacesHostPort.js";

const MODULE = "spaces/projectChat";

export interface SpaceProjectChats {
  /** Serves the project's chat in place of the one served; null serves none. */
  open(spaceId: string, projectId: string | null): void;
  /** Passes a page message to the served chat; dropped while none is served. */
  receive(message: ProjectChatToHost): void;
  close(): void;
}

export interface SpaceProjectChatsDeps {
  readonly port: SpacesHostPort;
  readonly post: (message: HostToProjectChat) => void;
  readonly logger: ILogger;
  /** Whether the project is linked to the Space the page has open. */
  readonly isLinked: (spaceId: string, projectId: string) => Promise<boolean>;
}

type Subscribe = (handler: (message: ProjectChatToHost) => void) => () => void;

/** Serves the chat over `end`; the stop also releases what the host bound to it. */
export function startProjectChat({ dispose, ...options }: SpaceProjectChat, end: ProjectChatHostEnd): () => void {
  const stop = serveProjectChat({ ...options, end });
  return () => { stop(); dispose?.(); };
}

export function createSpaceProjectChats({ port, post, logger, isLinked }: SpaceProjectChatsDeps): SpaceProjectChats {
  let served: { receive(message: ProjectChatToHost): void; stop(): void } | undefined;
  let generation = 0;
  const close = (): void => {
    generation += 1;
    served?.stop();
    served = undefined;
  };
  /** @returns the stop of the started server, or undefined when none started. */
  const start = async (spaceId: string, projectId: string, mine: number, subscribe: Subscribe): Promise<(() => void) | undefined> => {
    const chat = (await isLinked(spaceId, projectId)) ? await port.projectChat?.(projectId) : undefined;
    if (mine !== generation) { chat?.dispose?.(); return undefined; }
    if (!chat) { post({ type: "projectChat.error", message: "This project's chat is not available here." }); return undefined; }
    return startProjectChat(chat, { post, subscribe });
  };
  return {
    open(spaceId, projectId) {
      close();
      if (projectId === null) { return; }
      const mine = generation;
      // INVARIANT: the page posts projectChat.ready right after the open; the loopback keeps it until the server subscribes.
      const loop = createLoopbackTransport<ProjectChatToHost, HostToProjectChat>();
      let stop: (() => void) | undefined;
      let stopped = false;
      served = { receive: (message) => loop.ui.post(message), stop: () => { stopped = true; stop?.(); } };
      start(spaceId, projectId, mine, loop.host.subscribe).then((next) => {
        // TRAP: a close that lands after the server started must still stop it.
        if (stopped) { next?.(); } else { stop = next; }
      }).catch((error: unknown) => {
        const reason = formatError(error);
        void logger.log("ERROR", MODULE, "Open project chat failed", { spaceId, projectId, error: reason });
        if (mine === generation) { post({ type: "projectChat.error", message: `Open project chat failed: ${reason}` }); }
      });
    },
    receive: (message) => served?.receive(message),
    close,
  };
}
