// Serves the All projects protocol over the Details view's `projects` channel.
import { serveAllProjects, type AllProjectsEndpoint, type AllProjectsToHost, type HostToAllProjects, type ILogger, type ProjectLibraryPort } from "@labshelf/core";

export interface ProjectsChannel {
  /** Hands a message the page sent on the projects channel to the server. */
  deliver(message: AllProjectsToHost): void;
  stop(): void;
}

export function startProjectsChannel(post: (message: { channel: "projects"; msg: HostToAllProjects }) => void, port: ProjectLibraryPort, logger: ILogger): ProjectsChannel {
  const handlers = new Set<(message: AllProjectsToHost) => void>();
  const endpoint: AllProjectsEndpoint = {
    post: (msg) => post({ channel: "projects", msg }),
    subscribe: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
  };
  const stop = serveAllProjects(endpoint, port, logger);
  return { deliver: (message) => handlers.forEach((handler) => handler(message)), stop };
}
