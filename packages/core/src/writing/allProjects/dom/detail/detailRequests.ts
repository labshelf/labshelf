// Keeps the last detail of each project and asks the host for the selected one.
import type { ProjectDetail } from "../../projectDetail.js";
import type { AllProjectsToHost, HostToAllProjects } from "../../protocol/index.js";

export interface DetailRequests {
  request(id: string): void;
  receive(message: Extract<HostToAllProjects, { type: "detail" }>): void;
  /** The last detail received, kept while a newer one is on its way. */
  get(id: string): ProjectDetail | undefined;
  /** Why the last request for the project failed; cleared by the next detail. */
  error(id: string): string | undefined;
  /** The listener gets the id whose detail or error changed; returns the way to stop listening. */
  onChange(listener: (id: string) => void): () => void;
}

export function createDetailRequests(post: (message: AllProjectsToHost) => void): DetailRequests {
  const details = new Map<string, ProjectDetail>();
  const errors = new Map<string, string>();
  const listeners = new Set<(id: string) => void>();
  return {
    request: (id) => post({ type: "detail", id }),
    receive(message) {
      if ("error" in message) errors.set(message.id, message.error);
      else { details.set(message.id, message.detail); errors.delete(message.id); }
      listeners.forEach((listener) => listener(message.id));
    },
    get: (id) => details.get(id),
    error: (id) => errors.get(id),
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
