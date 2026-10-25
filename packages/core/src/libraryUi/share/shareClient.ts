// Gives the sharing dialogs a SharingHost that forwards every operation over a message channel to the real host.
import type { MessageEnd } from "../protocol/index.js";
import type { ShareHost, ShareOffers, ShareProgress } from "./shareHost.js";
import { parseShareReply, type ShareArgs, type ShareCall, type ShareDialogRequest, type ShareOp, type ShareReply } from "./shareMessages.js";

export type ShareClient = ShareHost & {
  /** Calls `handler` whenever the host asks for a dialog; returns the function that stops it. */
  onOpen(handler: (request: ShareDialogRequest) => void): () => void;
  /** Stops listening and rejects every call still waiting for its result. */
  dispose(): void;
};

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress: ((progress: ShareProgress) => void) | undefined;
}

type Call = <K extends ShareOp>(op: K, args: ShareArgs[K], signal?: AbortSignal, onProgress?: (progress: ShareProgress) => void) => Promise<never>;

// Numbers each call and keeps it waiting until its result arrives.
function callTable(port: MessageEnd<ShareCall, ShareReply>) {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  // After an abort the call keeps waiting: the host settles it with its own cancellation error.
  const call: Call = (op, args, signal, onProgress) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as Pending["resolve"], reject, onProgress });
      port.post({ channel: "sharing", type: "call", id, op, args } as ShareCall);
      if (!signal) return;
      const cancel = () => port.post({ channel: "sharing", type: "cancel", id });
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    });
  };
  return {
    call,
    progress(id: number, progress: ShareProgress) { pending.get(id)?.onProgress?.(progress); },
    settle(reply: Extract<ShareReply, { type: "result" }>) {
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.ok) waiting?.resolve(reply.value);
      else waiting?.reject(new Error(reply.error));
    },
    rejectAll(error: Error) {
      for (const waiting of pending.values()) waiting.reject(error);
      pending.clear();
    },
  };
}

type Operations = Omit<ShareHost, "place" | "offers" | "onOffersChange">;

function forwardedOperations(call: Call): Operations {
  return {
    projects: () => call("projects", []),
    projectStatus: (projectId) => call("projectStatus", [projectId]),
    shareProject: (projectId, signal) => call("shareProject", [projectId], signal),
    inviteLink: (projectId) => call("inviteLink", [projectId]),
    joinProject: (invite, signal) => call("joinProject", [invite], signal),
    leaveProject: (projectId) => call("leaveProject", [projectId]),
    openProject: (projectId) => call("openProject", [projectId]),
    shareableFolder: (path) => call("shareableFolder", [path]),
    shareFolder: (path, withAnnotations, onProgress) => call("shareFolder", [path, withAnnotations], undefined, onProgress),
    sharedLinks: () => call("sharedLinks", []),
    revokeLink: (id) => call("revokeLink", [id]),
    importLink: (text, onProgress) => call("importLink", [text], undefined, onProgress),
    openFolder: (path) => call("openFolder", [path]),
    copyText: (text) => call("copyText", [text]),
    openLink: (url) => call("openLink", [url]),
  };
}

/** Wraps the UI end of the sharing channel; posts `hello` so the host answers with its offers. */
export function createShareClient(port: MessageEnd<ShareCall, ShareReply>): ShareClient {
  const calls = callTable(port);
  const offerListeners = new Set<() => void>();
  const openHandlers = new Set<(request: ShareDialogRequest) => void>();
  let offers: ShareOffers = { projects: false, links: false };
  let place = "";

  const unsubscribe = port.subscribe((raw: unknown) => {
    const reply = parseShareReply(raw);
    if (!reply) return;
    if (reply.type === "offers") {
      offers = reply.offers;
      place = reply.place;
      for (const listener of [...offerListeners]) listener();
    } else if (reply.type === "open") {
      for (const handler of [...openHandlers]) handler(reply.request);
    } else if (reply.type === "progress") calls.progress(reply.id, reply.progress);
    else calls.settle(reply);
  });
  port.post({ channel: "sharing", type: "hello" });

  return {
    ...forwardedOperations(calls.call),
    get place() { return place; },
    offers: () => offers,
    onOffersChange(listener) { offerListeners.add(listener); return () => { offerListeners.delete(listener); }; },
    onOpen(handler) { openHandlers.add(handler); return () => { openHandlers.delete(handler); }; },
    dispose() {
      unsubscribe();
      calls.rejectAll(new Error("The sharing channel closed"));
      offerListeners.clear();
      openHandlers.clear();
    },
  };
}
