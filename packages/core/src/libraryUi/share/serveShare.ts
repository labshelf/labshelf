// Answers the sharing dialogs' calls from another context by running them on a SharingHost.
import { errorMessage } from "../../logging/index.js";
import type { ILogger } from "../../ports/index.js";
import type { MessageEnd } from "../protocol/index.js";
import type { SharingHost, SharingProgress } from "./shareHost.js";
import { isSharingMessage, parseSharingCall, type SharingCall, type SharingReply } from "./shareMessages.js";

const LOG_MODULE = "sharing";

type Invocation = Extract<SharingCall, { type: "call" }>;

function invoke(host: SharingHost, call: Invocation, signal: AbortSignal, onProgress: (p: SharingProgress) => void): Promise<unknown> {
  switch (call.op) {
    case "projects": return host.projects();
    case "projectStatus": return host.projectStatus(...call.args);
    case "shareProject": return host.shareProject(call.args[0], signal);
    case "inviteLink": return host.inviteLink(...call.args);
    case "joinProject": return host.joinProject(call.args[0], signal);
    case "leaveProject": return host.leaveProject(...call.args);
    case "openProject": return host.openProject(...call.args);
    case "shareableFolder": return host.shareableFolder(...call.args);
    case "shareFolder": return host.shareFolder(call.args[0], call.args[1], onProgress);
    case "sharedLinks": return host.sharedLinks();
    case "revokeLink": return host.revokeLink(...call.args);
    case "importLink": return host.importLink(call.args[0], onProgress);
    case "openFolder": return host.openFolder(...call.args);
    case "copyText": return host.copyText(...call.args);
    case "openLink": return host.openLink(...call.args);
  }
}

/** Serves the host end of the sharing channel; messages of other channels pass by untouched. Returns the function that stops it. */
export function serveSharing(host: SharingHost, port: MessageEnd<SharingReply, unknown>, logger: ILogger): () => void {
  const running = new Map<number, AbortController>();
  let stopped = false;
  const post = (reply: SharingReply) => { if (!stopped) port.post(reply); };
  const postOffers = () => post({ channel: "sharing", type: "offers", offers: host.offers(), place: host.place });

  async function run(call: Invocation): Promise<void> {
    const controller = new AbortController();
    running.set(call.id, controller);
    const onProgress = (progress: SharingProgress) => post({ channel: "sharing", type: "progress", id: call.id, progress });
    try {
      const value = await invoke(host, call, controller.signal, onProgress);
      post({ channel: "sharing", type: "result", id: call.id, ok: true, value });
    } catch (error) {
      // TRAP: never log the arguments; invites and links carry the share's secret key.
      void logger.error(LOG_MODULE, error, { op: call.op, id: call.id });
      post({ channel: "sharing", type: "result", id: call.id, ok: false, error: errorMessage(error) });
    } finally {
      running.delete(call.id);
    }
  }

  const unsubscribe = port.subscribe((raw) => {
    if (!isSharingMessage(raw)) return;
    const call = parseSharingCall(raw);
    if (!call) {
      const type = (raw as Record<string, unknown>)["type"];
      void logger.log("WARN", LOG_MODULE, "Dropped a malformed sharing message", { type: typeof type === "string" ? type.slice(0, 32) : typeof type });
      return;
    }
    if (call.type === "hello") postOffers();
    else if (call.type === "cancel") running.get(call.id)?.abort();
    else void run(call);
  });
  const stopOffers = host.onOffersChange(postOffers);

  return () => {
    stopped = true;
    unsubscribe();
    stopOffers();
    for (const controller of running.values()) controller.abort();
    running.clear();
  };
}
