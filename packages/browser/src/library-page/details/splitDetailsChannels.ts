// Splits the Details channel into a library endpoint and an All projects endpoint, and sends details.show after each channel's ready.
import type { AllProjectsEndpoint, DetailsTarget, DetailsToHost, HostEndpoint, HostToDetails, MessageEnd } from "@labshelf/core";

export interface DetailsChannelOptions {
  /** The target Details shows when it mounts. */
  current(): DetailsTarget;
  /** Details asked to open a folder in the paper list; the host never sees this message. */
  onFolderOpen(folder: string): void;
}

type Channel = DetailsToHost["channel"];

export function splitDetailsChannels(
  end: MessageEnd<HostToDetails, DetailsToHost>, { current, onFolderOpen }: DetailsChannelOptions,
): { library: HostEndpoint; projects: AllProjectsEndpoint } {
  const handlers: Record<Channel, Set<(msg: never) => void>> = { library: new Set(), projects: new Set() };
  // The host's answer to a channel's ready comes later (and may be asynchronous), so details.show waits for it.
  const awaitingAnswer = new Set<Channel>();
  end.subscribe((m) => {
    if (m.msg.type === "ready") awaitingAnswer.add(m.channel);
    if (m.channel === "library" && m.msg.type === "folder.open") { onFolderOpen(m.msg.folder); return; }
    for (const handler of [...handlers[m.channel]]) handler(m.msg as never);
  });
  const endpoint = <Out, In>(channel: Channel): MessageEnd<Out, In> => ({
    post: (msg) => {
      end.post({ channel, msg } as HostToDetails);
      if (awaitingAnswer.delete(channel)) end.post({ type: "details.show", target: current() });
    },
    subscribe: (handler) => {
      handlers[channel].add(handler as (msg: never) => void);
      return () => { handlers[channel].delete(handler as (msg: never) => void); };
    },
  });
  return { library: endpoint("library"), projects: endpoint("projects") };
}
