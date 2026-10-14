/**
 * The two ends of the library UI channel: the UI posts UiToHost and hears HostToUi, the host the other way round.
 */
import type { HostToUi, UiToHost } from "./messages.js";

export interface MessageEnd<Out, In> {
  post(message: Out): void;
  /** Starts listening; returns the function that stops it. */
  subscribe(handler: (message: In) => void): () => void;
}

/** The UI side of the channel. */
export type LibraryTransport = MessageEnd<UiToHost, HostToUi>;

/** The host side of the channel. */
export type HostEndpoint = MessageEnd<HostToUi, UiToHost>;
